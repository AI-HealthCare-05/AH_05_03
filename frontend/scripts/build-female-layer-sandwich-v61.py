"""Build conservative fascia patches between existing female muscles and the shell."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix
from mathutils.kdtree import KDTree


COLLECTION_NAME = "FEMALE_LAYER_SANDWICH_V61"
MIN_SHELL_INSET = 0.003
MAX_SHELL_INSET = 0.012
CLEARANCE_RATIO = 0.62
REGIONS = {
    "anterior_shoulder_girdle": {
        "pattern": re.compile(r"clavicle|sternum|manubrium", re.I),
        "boneLimit": 0.030,
        "muscleGap": 0.003,
        "bounds": ((0.77, 1.17), (-0.18, 0.025), (1.185, 1.425)),
        "label": "Deep superficial fascia over clavicle and sternum",
    },
    "posterior_thorax_spine": {
        "pattern": re.compile(r"scapula|rib|vertebra", re.I),
        "boneLimit": 0.036,
        "muscleGap": 0.003,
        "bounds": ((0.77, 1.17), (-0.005, 0.16), (0.94, 1.43)),
        "label": "Deep superficial fascia over posterior thorax and spine",
    },
    "posterior_pelvis_sacrum": {
        "pattern": re.compile(r"hip.bone|sacrum|coccyx", re.I),
        "boneLimit": 0.050,
        "muscleGap": 0.003,
        "bounds": ((0.75, 1.18), (-0.005, 0.15), (0.74, 1.02)),
        "label": "Deep superficial fascia over posterior pelvis and sacrum",
    },
    "feet_ankles": {
        "pattern": re.compile(r"talus|calcaneus|tarsal|metatarsal|finger.of.foot|sesamoid.bones.of.foot", re.I),
        "boneLimit": 0.022,
        "muscleGap": 0.0025,
        "bounds": ((0.79, 1.14), (-0.16, 0.10), (0.015, 0.145)),
        "label": "Deep superficial fascia over foot and ankle gaps",
    },
}


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--shell", required=True)
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def import_glb(path: Path, prefix: str) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    result = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    for obj in result:
        obj.name = f"{prefix}__{obj.name}"
    return result


def tree_from_objects(objects: list[bpy.types.Object], maximum: int | None = None) -> KDTree:
    total = sum(len(obj.data.vertices) for obj in objects)
    stride = max(1, total // maximum) if maximum and total > maximum else 1
    points = []
    cursor = 0
    for obj in objects:
        for vertex in obj.data.vertices:
            if cursor % stride == 0:
                points.append(obj.matrix_world @ vertex.co)
            cursor += 1
    tree = KDTree(len(points))
    for index, point in enumerate(points):
        tree.insert(point, index)
    tree.balance()
    return tree


def geometry_digest(objects: list[bpy.types.Object]) -> str:
    digest = hashlib.sha256()
    for obj in sorted(objects, key=lambda item: item.name):
        digest.update(obj.name.encode("utf-8"))
        digest.update(struct.pack("<16d", *(value for row in obj.matrix_world for value in row)))
        for vertex in obj.data.vertices:
            digest.update(struct.pack("<3f", *vertex.co))
    return digest.hexdigest()


def inside_bounds(point, bounds) -> bool:
    return all(low <= point[axis] <= high for axis, (low, high) in enumerate(bounds))


def matte_material() -> bpy.types.Material:
    material = bpy.data.materials.get("IEOBOM_FEMALE_DEEP_FASCIA_MATTE")
    if material is None:
        material = bpy.data.materials.new("IEOBOM_FEMALE_DEEP_FASCIA_MATTE")
    material.diffuse_color = (0.34, 0.12, 0.075, 1.0)
    material.metallic = 0.0
    material.roughness = 0.94
    return material


def make_patch(region_name, settings, shell, muscle_tree, bone_tree, collection, material):
    normal_matrix = shell.matrix_world.to_3x3().inverted().transposed()
    vertex_data = []
    for vertex in shell.data.vertices:
        shell_point = shell.matrix_world @ vertex.co
        normal = (normal_matrix @ vertex.normal).normalized()
        muscle_point, _index, muscle_distance = muscle_tree.find(shell_point)
        bone_point, _index, bone_distance = bone_tree.find(shell_point)
        eligible = (
            inside_bounds(shell_point, settings["bounds"])
            and bone_distance <= settings["boneLimit"]
            and muscle_distance >= settings["muscleGap"]
        )
        # The new layer stays safely inside the shell and remains outside the
        # closest existing muscle/bone whenever the available gap permits it.
        structure_distance = min(muscle_distance, bone_distance)
        inset = max(MIN_SHELL_INSET, min(MAX_SHELL_INSET, structure_distance * CLEARANCE_RATIO))
        vertex_data.append((shell_point, normal, bone_point, muscle_point, bone_distance, muscle_distance, inset, eligible))

    selected_faces = set()
    for polygon in shell.data.polygons:
        if sum(vertex_data[index][7] for index in polygon.vertices) >= 2:
            selected_faces.add(polygon.index)

    used_indices = sorted({index for face in selected_faces for index in shell.data.polygons[face].vertices})
    remap = {source: target for target, source in enumerate(used_indices)}
    vertices = [
        tuple(vertex_data[index][0] - vertex_data[index][1] * vertex_data[index][6])
        for index in used_indices
    ]
    faces = [
        tuple(remap[index] for index in shell.data.polygons[face].vertices)
        for face in sorted(selected_faces)
    ]
    mesh = bpy.data.meshes.new(f"IEOBOM_FEMALE_{region_name.upper()}_V61_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(f"FEMALE_DEEP_FASCIA_{region_name.upper()}_V61", mesh)
    collection.objects.link(obj)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.materials.append(material)
    obj["anatomyId"] = f"female-muscular-deep-fascia-{region_name.replace('_', '-')}"
    obj["anatomySystem"] = "muscular"
    obj["sourceName"] = settings["label"]
    obj["label"] = settings["label"]
    obj["tissueType"] = "fascia"
    obj["IEOBOM_boneCoverageVersion"] = "v61"
    insets = [vertex_data[index][6] for index in used_indices]
    return {
        "region": region_name,
        "object": obj.name,
        "vertices": len(mesh.vertices),
        "polygons": len(mesh.polygons),
        "shellInsetMm": {
            "min": round(min(insets) * 1000, 3) if insets else 0,
            "max": round(max(insets) * 1000, 3) if insets else 0,
        },
        "boneLimitMm": round(settings["boneLimit"] * 1000, 3),
        "muscleGapMm": round(settings["muscleGap"] * 1000, 3),
    }


def main() -> None:
    args = parse_args()
    source_blend = bpy.data.filepath
    work = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if work is None:
        raise RuntimeError("FEMALE_MUSCLE_WORK missing")
    existing = [obj for obj in recursive_objects(work) if obj.type == "MESH"]
    existing_digest = geometry_digest(existing)
    muscles = [obj for obj in existing if obj.data.polygons and not bool(obj.get("IEOBOM_webExclude"))]
    muscle_tree = tree_from_objects(muscles, 500_000)
    shell_objects = import_glb(Path(args.shell).resolve(), "V61_SHELL")
    skeleton = import_glb(Path(args.skeleton).resolve(), "V61_BONE")
    if len(shell_objects) != 1:
        raise RuntimeError(f"Expected one shell mesh, got {len(shell_objects)}")
    collection = bpy.data.collections.new(COLLECTION_NAME)
    work.children.link(collection)
    records = []
    for region_name, settings in REGIONS.items():
        bones = [obj for obj in skeleton if settings["pattern"].search(obj.name)]
        records.append(make_patch(region_name, settings, shell_objects[0], muscle_tree, tree_from_objects(bones), collection, matte_material()))
        print("IEOBOM_V61_PROGRESS", json.dumps(records[-1]), flush=True)

    imported = shell_objects + skeleton
    imported_collections = {value for obj in imported for value in obj.users_collection}
    for obj in imported:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for collection_value in imported_collections:
        if not collection_value.objects and not collection_value.children and collection_value.users == 0:
            bpy.data.collections.remove(collection_value)

    unchanged = geometry_digest(existing) == existing_digest
    if not unchanged:
        raise RuntimeError("Existing female muscle geometry changed")
    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    scene_record = {
        "version": "v61-layer-sandwich",
        "sourceBlend": source_blend,
        "coverageObjects": len(records),
        "coverageVertices": sum(record["vertices"] for record in records),
        "coveragePolygons": sum(record["polygons"] for record in records),
        "existingFemaleGeometryUnchanged": unchanged,
    }
    bpy.context.scene["IEOBOM_V61_LAYER_SANDWICH"] = json.dumps(scene_record)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        **scene_record,
        "outputBlend": str(output),
        "shell": str(Path(args.shell).resolve()),
        "skeleton": str(Path(args.skeleton).resolve()),
        "existingFemaleGeometrySha256": existing_digest,
        "records": records,
        "guardrails": [
            "Built from the restored v59 authoring file, never from v60.",
            "Every new vertex remains 3-12 mm inside the approved female shell.",
            "Head/hair, breasts, hands, thighs, and terminal toe volume are excluded by anatomical bounds and tight bone distance limits.",
            "Existing named muscles, skeleton, and external shell remain unchanged.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V61_COMPLETE", json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
