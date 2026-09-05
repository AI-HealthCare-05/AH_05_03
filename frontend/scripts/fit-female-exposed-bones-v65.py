"""Fit shallow exposed clavicle/sternum/pelvis vertices inside the female shell."""

from __future__ import annotations

import argparse
import importlib.util
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


PATTERN = re.compile(r"clavicle|sternum|manubrium|hip.?bone|sacrum|coccyx", re.I)
MAX_SHELL_DISTANCE = 0.010
SAFE_DEPTH = 0.001


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1:] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--shell", required=True)
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--skeleton-output", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def import_meshes(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]


def load_helpers():
    path = Path(__file__).with_name("export-female-final-anatomy-layers.py")
    spec = importlib.util.spec_from_file_location("ieobom_export_helpers_v65", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def searchable(obj):
    return " ".join((obj.name, str(obj.get("sourceName", "")), str(obj.get("label", "")), str(obj.get("anatomyId", ""))))


def fit(objects, bvh, center):
    records = []
    for obj in sorted(objects, key=lambda value: value.name):
        if not PATTERN.search(searchable(obj)):
            continue
        inverse = obj.matrix_world.inverted()
        moved = 0
        maximum = 0.0
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            nearest, normal, _face, distance = bvh.find_nearest(point)
            if nearest is None or normal is None or distance > MAX_SHELL_DISTANCE:
                continue
            if normal.dot(nearest - center) < 0:
                normal = -normal
            signed = (point - nearest).dot(normal)
            if signed <= 0.0001:
                continue
            vertex.co = inverse @ (nearest - normal * SAFE_DEPTH)
            moved += 1
            maximum = max(maximum, signed)
        if moved:
            obj.data.update()
            records.append({"object": obj.name, "vertices": moved, "maxOutsideBeforeMm": round(maximum * 1000, 3)})
    return records


def main():
    args = parse_args()
    shell_objects = import_meshes(Path(args.shell).resolve())
    if len(shell_objects) != 1:
        raise RuntimeError(f"Expected one shell object, got {len(shell_objects)}")
    shell = shell_objects[0]
    shell_points = [shell.matrix_world @ vertex.co for vertex in shell.data.vertices]
    center = sum(shell_points, Vector()) / len(shell_points)
    bvh = BVHTree.FromPolygons(shell_points, [tuple(polygon.vertices) for polygon in shell.data.polygons])

    imported_skeleton = import_meshes(Path(args.skeleton).resolve())
    imported_records = fit(imported_skeleton, bvh, center)
    authoring_skeleton = [
        obj for obj in bpy.data.objects
        if obj.type == "MESH" and obj not in imported_skeleton and obj is not shell
        and (str(obj.get("anatomySystem", "")).lower() == "skeletal" or any(collection.name == "SKELETON_V27" for collection in obj.users_collection))
    ]
    authoring_records = fit(authoring_skeleton, bvh, center)
    export_report = load_helpers().export_layer(Path(args.skeleton_output).resolve(), set(imported_skeleton), "skeletal")

    imported = imported_skeleton + shell_objects
    imported_collections = {collection for obj in imported for collection in obj.users_collection}
    for obj in imported:
        mesh = obj.data
        bpy.data.objects.remove(obj, do_unlink=True)
        if mesh.users == 0:
            bpy.data.meshes.remove(mesh)
    for collection in imported_collections:
        if not collection.objects and not collection.children and collection.users == 0:
            bpy.data.collections.remove(collection)

    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene["IEOBOM_V65_EXPOSED_BONE_FIT"] = json.dumps({
        "safeDepthMm": SAFE_DEPTH * 1000,
        "authoringObjects": len(authoring_records),
        "authoringVertices": sum(record["vertices"] for record in authoring_records),
    })
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        "version": "v65-exposed-bone-fit",
        "sourceBlend": bpy.data.filepath,
        "outputBlend": str(output),
        "safeDepthMm": SAFE_DEPTH * 1000,
        "maximumShellSearchMm": MAX_SHELL_DISTANCE * 1000,
        "authoring": authoring_records,
        "exportedSkeleton": imported_records,
        "skeletonExport": export_report,
        "notes": [
            "Only target bone vertices both outside the shell and within 10 mm of it were moved.",
            "Every corrected vertex was placed 1 mm inside the approved shell.",
            "All other skeleton vertices, joints, shell topology, and muscle attachments were preserved.",
        ],
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V65_COMPLETE", json.dumps({
        "authoringObjects": len(authoring_records),
        "authoringVertices": sum(record["vertices"] for record in authoring_records),
        "skeletonObjects": len(imported_records),
        "skeletonVertices": sum(record["vertices"] for record in imported_records),
        "skeletonExport": export_report,
    }), flush=True)


if __name__ == "__main__":
    main()
