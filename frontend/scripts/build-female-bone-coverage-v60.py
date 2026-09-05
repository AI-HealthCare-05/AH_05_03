"""Build shell-constrained superficial fascia patches over exposed female bones."""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree


COLLECTION_NAME = "FEMALE_BONE_COVERAGE_V60"
REGIONS = {
    "thorax_spine": {
        "pattern": re.compile(r"clavicle|scapula|sternum|manubrium|rib|vertebra", re.I),
        "boneLimit": 0.060,
        "muscleGap": 0.0,
        "surfaceOffset": -0.006,
        "label": "Thoracic and vertebral superficial fascia coverage",
    },
    "pelvis_sacrum": {
        "pattern": re.compile(r"hip.bone|sacrum|coccyx", re.I),
        "boneLimit": 0.065,
        "muscleGap": 0.001,
        "surfaceOffset": 0.002,
        "label": "Pelvic and sacrococcygeal superficial fascia coverage",
    },
    "feet_ankles": {
        "pattern": re.compile(r"talus|calcaneus|tarsal|metatarsal|finger.of.foot|sesamoid.bones.of.foot", re.I),
        "boneLimit": 0.045,
        "muscleGap": 0.0,
        "surfaceOffset": -0.006,
        "label": "Foot and ankle superficial fascia coverage",
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


def matte_fascia_material() -> bpy.types.Material:
    material = bpy.data.materials.get("IEOBOM_FEMALE_COVERAGE_FASCIA_MATTE")
    if material is None:
        material = bpy.data.materials.new("IEOBOM_FEMALE_COVERAGE_FASCIA_MATTE")
    material.diffuse_color = (0.34, 0.12, 0.075, 1.0)
    material.metallic = 0.0
    material.roughness = 0.92
    return material


def make_patch(
    region_name: str,
    settings: dict[str, object],
    shell: bpy.types.Object,
    muscle_tree: KDTree,
    bone_tree: KDTree,
    collection: bpy.types.Collection,
    material: bpy.types.Material,
) -> dict[str, object]:
    vertex_data = []
    normal_matrix = shell.matrix_world.to_3x3().inverted().transposed()
    for vertex in shell.data.vertices:
        point = shell.matrix_world @ vertex.co
        normal = (normal_matrix @ vertex.normal).normalized()
        bone_distance = bone_tree.find(point)[2]
        muscle_distance = muscle_tree.find(point)[2]
        vertex_data.append((point, normal, bone_distance, muscle_distance))

    bone_limit = float(settings["boneLimit"])
    muscle_gap = float(settings["muscleGap"])
    surface_offset = float(settings["surfaceOffset"])
    seed_faces = set()
    for polygon in shell.data.polygons:
        values = [vertex_data[index] for index in polygon.vertices]
        candidates = sum(
            bone_distance <= bone_limit and muscle_distance >= muscle_gap
            for _point, _normal, bone_distance, muscle_distance in values
        )
        if candidates >= 1:
            seed_faces.add(polygon.index)

    # Add one constrained topology ring to remove pinholes and soften boundaries.
    seed_vertices = {
        index
        for face_index in seed_faces
        for index in shell.data.polygons[face_index].vertices
    }
    selected_faces = set(seed_faces)
    for polygon in shell.data.polygons:
        if polygon.index in selected_faces or not any(index in seed_vertices for index in polygon.vertices):
            continue
        values = [vertex_data[index] for index in polygon.vertices]
        if (
            min(value[2] for value in values) <= bone_limit * 1.18
            and max(value[3] for value in values) >= muscle_gap * 0.55
        ):
            selected_faces.add(polygon.index)

    used_indices = sorted({
        index
        for face_index in selected_faces
        for index in shell.data.polygons[face_index].vertices
    })
    remap = {source: target for target, source in enumerate(used_indices)}
    vertices = []
    for source_index in used_indices:
        point, normal, _bone_distance, _muscle_distance = vertex_data[source_index]
        vertices.append(tuple(point - normal * surface_offset))
    faces = [
        tuple(remap[index] for index in shell.data.polygons[face_index].vertices)
        for face_index in sorted(selected_faces)
    ]

    mesh = bpy.data.meshes.new(f"IEOBOM_FEMALE_{region_name.upper()}_COVERAGE_V60_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(f"FEMALE_COVERAGE_{region_name.upper()}_V60", mesh)
    collection.objects.link(obj)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.materials.append(material)
    obj["anatomyId"] = f"female-muscular-superficial-coverage-{region_name.replace('_', '-')}"
    obj["anatomySystem"] = "muscular"
    obj["sourceName"] = str(settings["label"])
    obj["label"] = str(settings["label"])
    obj["tissueType"] = "fascia"
    obj["IEOBOM_boneCoverageVersion"] = "v60"
    return {
        "region": region_name,
        "object": obj.name,
        "vertices": len(mesh.vertices),
        "polygons": len(mesh.polygons),
        "seedPolygons": len(seed_faces),
        "boneLimitMm": round(bone_limit * 1000.0, 3),
        "muscleGapMm": round(muscle_gap * 1000.0, 3),
        "surfaceOffsetMm": round(surface_offset * 1000.0, 3),
    }


def main() -> None:
    args = parse_args()
    source_blend = bpy.data.filepath
    work = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if work is None:
        raise RuntimeError("FEMALE_MUSCLE_WORK missing")
    if bpy.data.collections.get(COLLECTION_NAME) is not None:
        raise RuntimeError(f"{COLLECTION_NAME} already exists")
    existing = [obj for obj in recursive_objects(work) if obj.type == "MESH"]
    existing_digest = geometry_digest(existing)
    visible_muscles = [
        obj for obj in existing
        if obj.data.polygons and not bool(obj.get("IEOBOM_webExclude"))
    ]
    muscle_tree = tree_from_objects(visible_muscles, 500_000)
    shell_objects = import_glb(Path(args.shell).resolve(), "V60_SHELL")
    skeleton = import_glb(Path(args.skeleton).resolve(), "V60_BONE")
    if len(shell_objects) != 1:
        raise RuntimeError(f"Expected one shell mesh, got {len(shell_objects)}")
    shell = shell_objects[0]

    coverage_collection = bpy.data.collections.new(COLLECTION_NAME)
    work.children.link(coverage_collection)
    material = matte_fascia_material()
    records = []
    for region_name, settings in REGIONS.items():
        bones = [obj for obj in skeleton if settings["pattern"].search(obj.name)]
        if not bones:
            raise RuntimeError(f"No bones found for {region_name}")
        records.append(make_patch(
            region_name,
            settings,
            shell,
            muscle_tree,
            tree_from_objects(bones),
            coverage_collection,
            material,
        ))
        print("IEOBOM_V60_PROGRESS", json.dumps(records[-1]), flush=True)

    # Imported QA references must not become part of the authoring file.
    imported = shell_objects + skeleton
    imported_collections = {collection for obj in imported for collection in obj.users_collection}
    for obj in imported:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for collection in imported_collections:
        if not collection.objects and not collection.children and collection.users == 0:
            bpy.data.collections.remove(collection)

    unchanged = geometry_digest(existing) == existing_digest
    if not unchanged:
        raise RuntimeError("Existing female muscle geometry changed")
    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    scene_record = {
        "version": "v60-bone-coverage",
        "sourceBlend": source_blend,
        "coverageObjects": len(records),
        "coverageVertices": sum(record["vertices"] for record in records),
        "coveragePolygons": sum(record["polygons"] for record in records),
        "existingFemaleGeometryUnchanged": unchanged,
    }
    bpy.context.scene["IEOBOM_V60_BONE_COVERAGE"] = json.dumps(scene_record)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        **scene_record,
        "outputBlend": str(output),
        "shell": str(Path(args.shell).resolve()),
        "skeleton": str(Path(args.skeleton).resolve()),
        "existingFemaleGeometrySha256": existing_digest,
        "records": records,
        "notes": [
            "Coverage was generated only where target bones are shell-adjacent and the existing muscle surface leaves a measurable gap.",
            "Patches follow the approved female shell; thorax and feet use a 6 mm outward clearance to cover female bones that protrude beyond the reference shell, while pelvis remains 2 mm inward.",
            "Named muscles, their attachment geometry, the skeleton, and the external shell were not edited.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V60_COMPLETE", json.dumps(report, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
