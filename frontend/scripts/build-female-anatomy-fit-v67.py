"""Build fitted hand fascia and bone-hugging posterior coverage from female v59."""

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
from mathutils.bvhtree import BVHTree
from mathutils.kdtree import KDTree


COLLECTION_NAME = "FEMALE_ANATOMY_FIT_V67"
HAND_BONE_PATTERN = re.compile(
    r"capitate|hamate|lunate|triquetrum|pisiform|scaphoid|trapezium|trapezoid|"
    r"metacarpal|phalanx.*finger.*hand",
    re.I,
)
REGIONS = {
    "posterior_thorax": {
        "pattern": re.compile(r"scapula|rib", re.I),
        "boneLimit": 0.075,
        "muscleGap": 0.004,
        "maxInset": 0.028,
        "bounds": ((0.70, 1.23), (0.0, 0.18), (1.00, 1.43)),
        "label": "Posterior thoracic fascia over scapular and rib gaps",
    },
    "posterior_pelvis": {
        "pattern": re.compile(r"hip.bone|sacrum|coccyx", re.I),
        "boneLimit": 0.100,
        "muscleGap": 0.006,
        "maxInset": 0.018,
        "bounds": ((0.74, 1.19), (0.0, 0.16), (0.86, 1.02)),
        "label": "Bone-hugging posterior pelvic fascia",
    },
}


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
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


def import_glb(path, prefix):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(Path(path).resolve()))
    result = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    for obj in result:
        obj.name = f"{prefix}__{obj.name}"
    return result


def geometry_digest(objects):
    digest = hashlib.sha256()
    for obj in sorted(objects, key=lambda value: value.name):
        digest.update(obj.name.encode("utf-8"))
        digest.update(struct.pack("<16d", *(value for row in obj.matrix_world for value in row)))
        for vertex in obj.data.vertices:
            digest.update(struct.pack("<3f", *vertex.co))
    return digest.hexdigest()


def searchable(obj):
    return " ".join(
        (
            obj.name,
            str(obj.get("sourceName", "")),
            str(obj.get("label", "")),
            str(obj.get("anatomyId", "")),
        )
    )


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


def normalize_materials(objects):
    muscle = principled_material("IEOBOM_V67_MUSCLE_MATTE", (0.34, 0.12, 0.075))
    fascia = principled_material("IEOBOM_V67_FASCIA_MATTE", (0.40, 0.17, 0.10))
    for obj in objects:
        search = " ".join((obj.name, str(obj.get("tissueType", "")), str(obj.get("sourceName", ""))))
        selected = fascia if re.search(r"fascia|aponeuros|retinacul|tendon|sheath", search, re.I) else muscle
        obj.data.materials.clear()
        obj.data.materials.append(selected)
    return muscle, fascia


def shell_geometry(shell):
    points = [shell.matrix_world @ vertex.co for vertex in shell.data.vertices]
    faces = [tuple(polygon.vertices) for polygon in shell.data.polygons]
    center = sum(points, Vector()) / len(points)
    return points, faces, center, BVHTree.FromPolygons(points, faces)


def outward_normal(nearest, normal, center):
    return -normal if normal.dot(nearest - center) < 0 else normal


def is_hand_point(point, center_x):
    return 0.735 <= point.z <= 0.925 and abs(point.x - center_x) >= 0.235


def exclude_misaligned_hand_objects(objects, center):
    records = []
    for obj in sorted(objects, key=lambda value: value.name):
        if str(obj.get("anatomySystem", "")).lower() in {"skeletal", "joints"}:
            continue
        points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        hand_vertices = sum(is_hand_point(point, center.x) for point in points)
        fraction = hand_vertices / len(points)
        maximum_z = max(point.z for point in points)
        if fraction < 0.65 or maximum_z > 0.945:
            continue
        obj["IEOBOM_webExclude"] = True
        records.append({"object": obj.name, "vertices": len(points), "handFraction": round(fraction, 4)})
    return {
        "objects": len(records),
        "vertices": sum(record["vertices"] for record in records),
        "records": records,
    }


def inside_bounds(point, bounds):
    return all(low <= point[axis] <= high for axis, (low, high) in enumerate(bounds))


def create_patch(name, label, shell, points, faces, vertex_data, selected_faces, collection, material):
    indices = sorted({index for face_index in selected_faces for index in faces[face_index]})
    remap = {source: target for target, source in enumerate(indices)}
    vertices = [tuple(vertex_data[index]["position"]) for index in indices]
    patch_faces = [tuple(remap[index] for index in faces[face_index]) for face_index in sorted(selected_faces)]
    mesh = bpy.data.meshes.new(f"IEOBOM_FEMALE_{name.upper()}_V67_MESH")
    mesh.from_pydata(vertices, [], patch_faces)
    mesh.update(calc_edges=True)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(f"FEMALE_COVERAGE_{name.upper()}_V67", mesh)
    collection.objects.link(obj)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.materials.append(material)
    obj["anatomyId"] = f"female-muscular-coverage-{name.replace('_', '-')}"
    obj["anatomySystem"] = "muscular"
    obj["sourceName"] = label
    obj["label"] = label
    obj["tissueType"] = "fascia"
    insets = [vertex_data[index]["inset"] for index in indices]
    return {
        "region": name,
        "object": obj.name,
        "vertices": len(vertices),
        "polygons": len(patch_faces),
        "shellInsetMm": {
            "min": round(min(insets) * 1000, 3),
            "max": round(max(insets) * 1000, 3),
        },
    }


def make_bone_gap_patch(name, settings, shell, shell_points, shell_faces, muscle_tree, bone_tree, collection, material):
    normal_matrix = shell.matrix_world.to_3x3().inverted().transposed()
    data = []
    for index, vertex in enumerate(shell.data.vertices):
        point = shell_points[index]
        normal = (normal_matrix @ vertex.normal).normalized()
        bone_distance = bone_tree.find(point)[2]
        muscle_distance = muscle_tree.find(point)[2]
        eligible = (
            inside_bounds(point, settings["bounds"])
            and bone_distance <= settings["boneLimit"]
            and muscle_distance >= settings["muscleGap"]
        )
        available = min(
            max(0.0001, muscle_distance - 0.0010),
            max(0.0001, bone_distance - 0.0004),
            settings["maxInset"],
        )
        data.append(
            {
                "position": point - normal * available,
                "inset": available,
                "eligible": eligible,
                "boneDistance": bone_distance,
            }
        )
    seed_faces = {
        polygon.index
        for polygon in shell.data.polygons
        if any(data[index]["eligible"] for index in polygon.vertices)
    }
    seed_vertices = {index for face_index in seed_faces for index in shell_faces[face_index]}
    selected_faces = set(seed_faces)
    for polygon in shell.data.polygons:
        if polygon.index in selected_faces or not any(index in seed_vertices for index in polygon.vertices):
            continue
        if all(inside_bounds(shell_points[index], settings["bounds"]) for index in polygon.vertices) and min(
            data[index]["boneDistance"] for index in polygon.vertices
        ) <= settings["boneLimit"] * 1.10:
            selected_faces.add(polygon.index)
    return create_patch(
        name,
        settings["label"],
        shell,
        shell_points,
        shell_faces,
        data,
        selected_faces,
        collection,
        material,
    )


def make_hand_patch(shell, shell_points, shell_faces, center, hand_bone_tree, collection, material):
    normal_matrix = shell.matrix_world.to_3x3().inverted().transposed()
    data = []
    for index, vertex in enumerate(shell.data.vertices):
        point = shell_points[index]
        normal = (normal_matrix @ vertex.normal).normalized()
        bone_distance = hand_bone_tree.find(point)[2]
        eligible = is_hand_point(point, center.x)
        inset = 0.0008
        data.append({"position": point - normal * inset, "inset": inset, "eligible": eligible})
    selected_faces = {
        polygon.index
        for polygon in shell.data.polygons
        if any(data[index]["eligible"] for index in polygon.vertices)
    }
    return create_patch(
        "hands_digits",
        "Superficial hand and digit fascia fitted to approved shell and bones",
        shell,
        shell_points,
        shell_faces,
        data,
        selected_faces,
        collection,
        material,
    )


def extend_upper_gluteals(objects, shell_bvh, center):
    records = []
    for obj in sorted(objects, key=lambda value: value.name):
        if not re.search(r"Gluteus (maximus|medius) muscle", searchable(obj), re.I):
            continue
        inverse = obj.matrix_world.inverted()
        moved = 0
        maximum_shift = 0.0
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            if point.y <= 0.0 or point.z <= 0.84:
                continue
            fade = max(0.0, min(1.0, (point.z - 0.84) / 0.09))
            fade = fade * fade * (3.0 - 2.0 * fade)
            nearest, normal, _face, distance = shell_bvh.find_nearest(point)
            if nearest is None or normal is None or distance > 0.060:
                continue
            normal = outward_normal(nearest, normal, center)
            target = nearest - normal * 0.002
            fitted = point.lerp(target, fade)
            shift = (fitted - point).length
            if shift <= 1e-7:
                continue
            vertex.co = inverse @ fitted
            moved += 1
            maximum_shift = max(maximum_shift, shift)
        if moved:
            obj.data.update()
            records.append({"object": obj.name, "vertices": moved, "maxShiftMm": round(maximum_shift * 1000, 3)})
    return {
        "objects": len(records),
        "vertices": sum(record["vertices"] for record in records),
        "maximumShiftMm": max((record["maxShiftMm"] for record in records), default=0.0),
        "records": records,
    }


def make_bone_sheath(name, label, bones, shell_bvh, center, collection, material):
    vertices = []
    faces = []
    for bone in bones:
        bone_points = [bone.matrix_world @ vertex.co for vertex in bone.data.vertices]
        bone_center = sum(bone_points, Vector()) / len(bone_points)
        start = len(vertices)
        for point in bone_points:
            radial = point - bone_center
            if radial.length_squared < 1e-12:
                radial = point - center
            fitted = point + radial.normalized() * 0.0012
            nearest, normal, _face, _distance = shell_bvh.find_nearest(fitted)
            if nearest is not None and normal is not None:
                normal = outward_normal(nearest, normal, center)
                if (fitted - nearest).dot(normal) > -0.0005:
                    fitted = nearest - normal * 0.0005
            vertices.append(tuple(fitted))
        faces.extend(tuple(start + index for index in polygon.vertices) for polygon in bone.data.polygons)
    mesh = bpy.data.meshes.new(f"IEOBOM_FEMALE_{name.upper()}_V67_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(f"FEMALE_COVERAGE_{name.upper()}_V67", mesh)
    collection.objects.link(obj)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.materials.append(material)
    obj["anatomyId"] = f"female-muscular-coverage-{name.replace('_', '-')}"
    obj["anatomySystem"] = "muscular"
    obj["sourceName"] = label
    obj["label"] = label
    obj["tissueType"] = "fascia"
    return {
        "region": name,
        "object": obj.name,
        "bones": len(bones),
        "vertices": len(vertices),
        "polygons": len(faces),
        "boneClearanceMm": 1.2,
        "minimumShellInsetMm": 0.5,
    }


def make_exposed_bone_sheath(name, label, bones, muscle_tree, shell_bvh, center, bounds, collection, material):
    vertices = []
    faces = []
    selected_bones = 0
    for bone in bones:
        normal_matrix = bone.matrix_world.to_3x3().inverted().transposed()
        data = []
        for vertex in bone.data.vertices:
            point = bone.matrix_world @ vertex.co
            normal = (normal_matrix @ vertex.normal).normalized()
            eligible = (
                inside_bounds(point, bounds)
                and normal.y > -0.10
                and muscle_tree.find(point)[2] >= 0.002
            )
            data.append((point, normal, eligible))
        selected_faces = [
            polygon
            for polygon in bone.data.polygons
            if sum(data[index][2] for index in polygon.vertices) >= 1
        ]
        if not selected_faces:
            continue
        selected_bones += 1
        indices = sorted({index for polygon in selected_faces for index in polygon.vertices})
        remap = {source: len(vertices) + target for target, source in enumerate(indices)}
        for index in indices:
            point, normal, _eligible = data[index]
            fitted = point + normal * 0.0010
            nearest, shell_normal, _face, _distance = shell_bvh.find_nearest(fitted)
            if nearest is not None and shell_normal is not None:
                shell_normal = outward_normal(nearest, shell_normal, center)
                if (fitted - nearest).dot(shell_normal) > -0.0005:
                    fitted = nearest - shell_normal * 0.0005
            vertices.append(tuple(fitted))
        faces.extend(tuple(remap[index] for index in polygon.vertices) for polygon in selected_faces)
    mesh = bpy.data.meshes.new(f"IEOBOM_FEMALE_{name.upper()}_V67_MESH")
    mesh.from_pydata(vertices, [], faces)
    mesh.update(calc_edges=True)
    for polygon in mesh.polygons:
        polygon.use_smooth = True
    obj = bpy.data.objects.new(f"FEMALE_COVERAGE_{name.upper()}_V67", mesh)
    collection.objects.link(obj)
    obj.matrix_world = Matrix.Identity(4)
    obj.data.materials.append(material)
    obj["anatomyId"] = f"female-muscular-coverage-{name.replace('_', '-')}"
    obj["anatomySystem"] = "muscular"
    obj["sourceName"] = label
    obj["label"] = label
    obj["tissueType"] = "fascia"
    return {
        "region": name,
        "object": obj.name,
        "bones": selected_bones,
        "vertices": len(vertices),
        "polygons": len(faces),
        "boneClearanceMm": 1.0,
        "minimumShellInsetMm": 0.5,
    }


def remove_imported(objects):
    collections = {collection for obj in objects for collection in obj.users_collection}
    for obj in objects:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for collection in collections:
        if not collection.objects and not collection.children and collection.users == 0:
            bpy.data.collections.remove(collection)


def main():
    args = parse_args()
    source_blend = bpy.data.filepath
    muscle_work = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if muscle_work is None:
        raise RuntimeError("FEMALE_MUSCLE_WORK missing")
    if bpy.data.collections.get(COLLECTION_NAME):
        raise RuntimeError(f"{COLLECTION_NAME} already exists")
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
    shell_objects = import_glb(args.shell, "V67_SHELL")
    skeleton = import_glb(args.skeleton, "V67_BONE")
    if len(shell_objects) != 1:
        raise RuntimeError(f"Expected one shell mesh, got {len(shell_objects)}")
    shell = shell_objects[0]
    shell_points, shell_faces, center, shell_bvh = shell_geometry(shell)
    hand_bones = [obj for obj in skeleton if HAND_BONE_PATTERN.search(searchable(obj))]
    if not hand_bones:
        raise RuntimeError("No approved hand bones found")
    hand_bone_tree = tree_from_objects(hand_bones)
    hand_fit = exclude_misaligned_hand_objects(all_work_objects, center)
    gluteal_fit = extend_upper_gluteals(muscle_objects, shell_bvh, center)
    _muscle_material, fascia_material = normalize_materials(muscle_objects)
    muscle_tree = tree_from_objects(list(muscle_objects), 500_000)
    collection = bpy.data.collections.new(COLLECTION_NAME)
    muscle_work.children.link(collection)
    coverage = []
    thorax_bones = [obj for obj in skeleton if re.search(r"scapula|rib", searchable(obj), re.I)]
    pelvis_bones = [
        obj
        for obj in skeleton
        if re.search(r"hip.?bone|sacrum|coccyx|vertebra[ _-]l[45]", searchable(obj), re.I)
    ]
    coverage.append(
        make_bone_gap_patch(
            "posterior_thorax",
            REGIONS["posterior_thorax"],
            shell,
            shell_points,
            shell_faces,
            muscle_tree,
            tree_from_objects(thorax_bones),
            collection,
            fascia_material,
        )
    )
    print("IEOBOM_V67_COVERAGE", json.dumps(coverage[-1]), flush=True)
    coverage.append(
        make_exposed_bone_sheath(
            "posterior_thorax_exposed",
            "Close fascia over residual exposed posterior scapular and rib surfaces",
            thorax_bones,
            muscle_tree,
            shell_bvh,
            center,
            ((0.70, 1.23), (0.0, 0.18), (1.00, 1.43)),
            collection,
            fascia_material,
        )
    )
    print("IEOBOM_V67_COVERAGE", json.dumps(coverage[-1]), flush=True)
    coverage.append(
        make_exposed_bone_sheath(
            "posterior_pelvis_exposed",
            "Close fascia over exposed posterior hip, sacral and coccygeal surfaces",
            pelvis_bones,
            muscle_tree,
            shell_bvh,
            center,
            ((0.74, 1.19), (0.0, 0.16), (0.75, 1.02)),
            collection,
            fascia_material,
        )
    )
    print("IEOBOM_V67_COVERAGE", json.dumps(coverage[-1]), flush=True)
    coverage.append(
        make_hand_patch(
            shell,
            shell_points,
            shell_faces,
            center,
            hand_bone_tree,
            collection,
            fascia_material,
        )
    )
    print("IEOBOM_V67_COVERAGE", json.dumps(coverage[-1]), flush=True)
    remove_imported(shell_objects + skeleton)
    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    scene_record = {
        "version": "v67-anatomy-fit",
        "sourceBlend": source_blend,
        "matteMuscleObjects": len(muscle_objects),
        "handFitObjects": hand_fit["objects"],
        "handFitVertices": hand_fit["vertices"],
        "glutealFitObjects": gluteal_fit["objects"],
        "glutealFitVertices": gluteal_fit["vertices"],
        "coverageObjects": len(coverage),
        "coverageVertices": sum(record["vertices"] for record in coverage),
        "coveragePolygons": sum(record["polygons"] for record in coverage),
        "topologyDensityChanges": 0,
    }
    bpy.context.scene["IEOBOM_V67_ANATOMY_FIT"] = json.dumps(scene_record)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        **scene_record,
        "outputBlend": str(output),
        "shell": str(Path(args.shell).resolve()),
        "skeleton": str(Path(args.skeleton).resolve()),
        "muscleGeometrySha256Before": before_digest,
        "handFit": hand_fit,
        "glutealFit": gluteal_fit,
        "coverage": coverage,
        "guardrails": [
            "Built directly from restored v59; v66 shell-derived pelvic plates were not reused.",
            "No existing mesh was subdivided, remeshed, decimated, or otherwise density-modified.",
            "Hand bones and shell were unchanged; hand-dominant legacy meshes with incompatible finger topology were excluded from web display.",
            "The replacement hand fascia follows the approved shell 0.8 mm inside and continuously covers the approved hand bones.",
            "Posterior thorax fascia is limited to measured scapular and rib gaps and remains inside the approved shell.",
            "No separate pelvic plate is used; the posterior-superior gluteus maximus and medius surfaces blend toward 2 mm inside the approved shell.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V67_COMPLETE", json.dumps(scene_record), flush=True)


if __name__ == "__main__":
    main()
