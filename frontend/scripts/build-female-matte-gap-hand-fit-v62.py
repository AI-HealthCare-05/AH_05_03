"""Build v62 from restored v59: matte muscles, local gap covers, fitted hand accessories."""

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


COLLECTION_NAME = "FEMALE_LOCAL_GAP_COVERAGE_V66"
HAND_BONE_PATTERN = re.compile(r"^FEMALE_HAND_[LR]_\d+_WORK$", re.I)
HAND_MEDIAL_SCALE = 0.988
REGIONS = {
    "clavicle_sternum": {
        "pattern": re.compile(r"clavicle|sternum|manubrium", re.I),
        # Keep this local to the upper thorax, but include the shallow gaps at
        # both acromial ends that remained visible in the v65 QA render.
        "boneLimit": 0.055,
        "muscleGap": 0.0,
        "bounds": ((0.77, 1.17), (-0.18, 0.025), (1.18, 1.425)),
        "label": "Local matte fascia over clavicle and sternum gaps",
    },
    "posterior_pelvis_sacrum": {
        "pattern": re.compile(r"hip.bone|sacrum|coccyx", re.I),
        # The posterior iliac exposure sits farther from the reference shell
        # than the central sacrum.  A larger search radius closes only this
        # bounded pelvic patch; the head, breasts, limbs, hands and feet are
        # outside these bounds and cannot be picked up.
        "boneLimit": 0.100,
        "muscleGap": 0.0,
        "bounds": ((0.75, 1.18), (-0.005, 0.15), (0.75, 1.015)),
        "label": "Local matte fascia over posterior pelvic and sacral gaps",
    },
}


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--shell", required=True)
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def recursive_objects(collection):
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def import_glb(path: Path, prefix: str):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    result = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    for obj in result:
        obj.name = f"{prefix}__{obj.name}"
    return result


def tree_from_objects(objects, maximum=None):
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


def geometry_digest(objects):
    digest = hashlib.sha256()
    for obj in sorted(objects, key=lambda item: item.name):
        digest.update(obj.name.encode("utf-8"))
        digest.update(struct.pack("<16d", *(value for row in obj.matrix_world for value in row)))
        for vertex in obj.data.vertices:
            digest.update(struct.pack("<3f", *vertex.co))
    return digest.hexdigest()


def principled_material(name, color):
    material = bpy.data.materials.get(name) or bpy.data.materials.new(name)
    material.diffuse_color = (*color, 1.0)
    material.metallic = 0.0
    material.roughness = 0.95
    material.use_backface_culling = False
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    if node:
        node.inputs["Base Color"].default_value = (*color, 1.0)
        node.inputs["Metallic"].default_value = 0.0
        node.inputs["Roughness"].default_value = 0.95
        if "IOR Level" in node.inputs:
            node.inputs["IOR Level"].default_value = 0.18
        if "Coat Weight" in node.inputs:
            node.inputs["Coat Weight"].default_value = 0.0
    return material


def normalize_muscle_materials(muscle_objects):
    muscle = principled_material("IEOBOM_V66_MUSCLE_MATTE", (0.34, 0.12, 0.075))
    fascia = principled_material("IEOBOM_V66_FASCIA_MATTE", (0.40, 0.17, 0.10))
    changed = 0
    for obj in muscle_objects:
        search = " ".join((obj.name, str(obj.get("tissueType", "")), str(obj.get("sourceName", ""))))
        selected = fascia if re.search(r"fascia|aponeuros|retinacul|tendon|sheath", search, re.I) else muscle
        obj.data.materials.clear()
        obj.data.materials.append(selected)
        changed += 1
    return changed, muscle, fascia


def is_hand_point(point, center_x):
    return 0.70 <= point.z <= 1.02 and abs(point.x - center_x) >= 0.235


def fit_hand_accessories(objects, shell, excluded):
    shell_points = [shell.matrix_world @ vertex.co for vertex in shell.data.vertices]
    center = sum(shell_points, Vector()) / len(shell_points)
    center_x = center.x
    moved_objects = 0
    moved_vertices = 0
    maximum_shift = 0.0
    records = []
    for obj in sorted(objects, key=lambda item: item.name):
        if obj in excluded or HAND_BONE_PATTERN.match(obj.name):
            continue
        system = str(obj.get("anatomySystem", "")).lower()
        if system in {"skeletal", "joints"}:
            continue
        inverse = obj.matrix_world.inverted()
        moved = 0
        object_maximum = 0.0
        for vertex in obj.data.vertices:
            world = obj.matrix_world @ vertex.co
            if not is_hand_point(world, center_x):
                continue
            fade = 1.0 if world.z <= 0.90 else max(0.0, min(1.0, (1.02 - world.z) / 0.12))
            scale = 1.0 - (1.0 - HAND_MEDIAL_SCALE) * fade
            fitted = world.copy()
            fitted.x = center_x + (world.x - center_x) * scale
            shift = abs(fitted.x - world.x)
            if shift > 1e-7:
                vertex.co = inverse @ fitted
                moved += 1
                object_maximum = max(object_maximum, shift)
        if moved:
            obj.data.update()
            moved_objects += 1
            moved_vertices += moved
            maximum_shift = max(maximum_shift, object_maximum)
            records.append({"object": obj.name, "vertices": moved, "maxMedialShiftMm": round(object_maximum * 1000, 3)})
    return {
        "objects": moved_objects,
        "vertices": moved_vertices,
        "maximumMedialShiftMm": round(maximum_shift * 1000, 3),
        "medialScale": HAND_MEDIAL_SCALE,
        "records": records,
    }


def inside_bounds(point, bounds):
    return all(low <= point[axis] <= high for axis, (low, high) in enumerate(bounds))


def make_gap_patch(region_name, settings, shell, muscle_tree, bone_tree, collection, material):
    normal_matrix = shell.matrix_world.to_3x3().inverted().transposed()
    data = []
    for vertex in shell.data.vertices:
        point = shell.matrix_world @ vertex.co
        normal = (normal_matrix @ vertex.normal).normalized()
        bone_distance = bone_tree.find(point)[2]
        muscle_distance = muscle_tree.find(point)[2]
        eligible = (
            inside_bounds(point, settings["bounds"])
            and bone_distance <= settings["boneLimit"]
            and muscle_distance >= settings["muscleGap"]
        )
        # Local bone-aware inset: always inside the shell, but outward of a
        # shallow bone whenever that is geometrically possible.
        inset = max(0.0001, min(0.0020, bone_distance * 0.25, muscle_distance * 0.35))
        data.append((point, normal, inset, eligible))
    selected_faces = {
        polygon.index for polygon in shell.data.polygons if sum(data[index][3] for index in polygon.vertices) >= 1
    }
    indices = sorted({index for face in selected_faces for index in shell.data.polygons[face].vertices})
    remap = {source: target for target, source in enumerate(indices)}
    vertices = [tuple(data[index][0] - data[index][1] * data[index][2]) for index in indices]
    faces = [tuple(remap[index] for index in shell.data.polygons[face].vertices) for face in sorted(selected_faces)]
    mesh = bpy.data.meshes.new(f"IEOBOM_FEMALE_{region_name.upper()}_V66_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(f"FEMALE_LOCAL_COVERAGE_{region_name.upper()}_V66", mesh)
    collection.objects.link(obj)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.materials.append(material)
    obj["anatomyId"] = f"female-muscular-local-coverage-{region_name.replace('_', '-')}"
    obj["anatomySystem"] = "muscular"
    obj["sourceName"] = settings["label"]
    obj["label"] = settings["label"]
    obj["tissueType"] = "fascia"
    insets = [data[index][2] for index in indices]
    return {
        "region": region_name,
        "object": obj.name,
        "vertices": len(vertices),
        "polygons": len(faces),
        "shellInsetMm": {"min": round(min(insets) * 1000, 3), "max": round(max(insets) * 1000, 3)} if insets else {},
    }


def main():
    args = parse_args()
    source_blend = bpy.data.filepath
    muscle_work = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if muscle_work is None:
        raise RuntimeError("FEMALE_MUSCLE_WORK missing")
    muscle_objects = {
        obj
        for obj in recursive_objects(muscle_work)
        if obj.type == "MESH" and obj.data.polygons and not bool(obj.get("IEOBOM_webExclude"))
    }
    all_work_collections = [
        collection
        for collection in bpy.data.collections
        if collection.name.startswith("FEMALE_") and "WORK" in collection.name
    ]
    all_work_objects = {
        obj
        for collection in all_work_collections
        for obj in recursive_objects(collection)
        if obj.type == "MESH" and obj.data.polygons
    }
    before_digest = geometry_digest(list(muscle_objects))
    shell_objects = import_glb(Path(args.shell).resolve(), "V64_SHELL")
    skeleton = import_glb(Path(args.skeleton).resolve(), "V64_BONE")
    if len(shell_objects) != 1:
        raise RuntimeError(f"Expected one shell mesh, got {len(shell_objects)}")
    shell = shell_objects[0]
    hand_fit = fit_hand_accessories(all_work_objects, shell, set())
    material_count, _muscle_material, fascia_material = normalize_muscle_materials(muscle_objects)
    muscle_tree = tree_from_objects(list(muscle_objects), 500_000)
    collection = bpy.data.collections.new(COLLECTION_NAME)
    muscle_work.children.link(collection)
    coverage = []
    for region_name, settings in REGIONS.items():
        bones = [obj for obj in skeleton if settings["pattern"].search(obj.name)]
        coverage.append(
            make_gap_patch(
                region_name, settings, shell, muscle_tree, tree_from_objects(bones), collection, fascia_material
            )
        )
        print("IEOBOM_V64_COVERAGE", json.dumps(coverage[-1]), flush=True)

    imported = shell_objects + skeleton
    imported_collections = {collection_value for obj in imported for collection_value in obj.users_collection}
    for obj in imported:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for collection_value in imported_collections:
        if not collection_value.objects and not collection_value.children and collection_value.users == 0:
            bpy.data.collections.remove(collection_value)

    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    scene_record = {
        "version": "v66-matte-gap-hand-fit",
        "sourceBlend": source_blend,
        "matteMuscleObjects": material_count,
        "handFitObjects": hand_fit["objects"],
        "handFitVertices": hand_fit["vertices"],
        "coverageObjects": len(coverage),
        "coverageVertices": sum(record["vertices"] for record in coverage),
        "coveragePolygons": sum(record["polygons"] for record in coverage),
    }
    bpy.context.scene["IEOBOM_V66_MATTE_GAP_HAND_FIT"] = json.dumps(scene_record)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        **scene_record,
        "outputBlend": str(output),
        "shell": str(Path(args.shell).resolve()),
        "skeleton": str(Path(args.skeleton).resolve()),
        "muscleGeometrySha256Before": before_digest,
        "handFit": hand_fit,
        "coverage": coverage,
        "guardrails": [
            "Built directly from the restored v59 file; v60 and v61 geometry were not reused.",
            "All rendered muscle materials use roughness 0.95, zero metallic and coat, low specular, and double-sided rendering.",
            "Approved hand bones were not moved; non-skeletal distal-hand accessories were fitted medially by 1.2 percent with a smooth zero transition through the forearm.",
            "New coverage is limited to clavicle/sternum and posterior pelvis/sacrum gaps and always remains inside the shell.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V64_COMPLETE", json.dumps(scene_record), flush=True)


if __name__ == "__main__":
    main()
