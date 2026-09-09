"""Inspect authoring and approved hand bones for per-digit accessory fitting."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector


HAND_PATTERN = re.compile(
    r"hand|finger|thumb|carpal|metacarp|phalan|digit|palmar|dorsal|retinacul|lumbrical|interosse",
    re.I,
)


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def recursive_objects(collection):
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def searchable(obj):
    return " ".join(
        (
            obj.name,
            str(obj.get("sourceName", "")),
            str(obj.get("label", "")),
            str(obj.get("anatomyId", "")),
        )
    )


def record(obj):
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    center = sum(points, Vector()) / len(points)
    minimum = Vector(min(point[i] for point in points) for i in range(3))
    maximum = Vector(max(point[i] for point in points) for i in range(3))
    return {
        "name": obj.name,
        "sourceName": str(obj.get("sourceName", "")),
        "label": str(obj.get("label", "")),
        "anatomyId": str(obj.get("anatomyId", "")),
        "system": str(obj.get("anatomySystem", "")),
        "collections": sorted(collection.name for collection in obj.users_collection),
        "vertices": len(obj.data.vertices),
        "center": [round(value, 6) for value in center],
        "size": [round(value, 6) for value in maximum - minimum],
    }


def main():
    args = parse_args()
    work_collections = [
        collection
        for collection in bpy.data.collections
        if collection.name.startswith("FEMALE_") and "WORK" in collection.name
    ]
    authoring = {
        obj
        for collection in work_collections
        for obj in recursive_objects(collection)
        if obj.type == "MESH" and obj.data.vertices and HAND_PATTERN.search(searchable(obj))
    }
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(Path(args.skeleton).resolve()))
    approved = {
        obj
        for obj in bpy.data.objects
        if obj not in before and obj.type == "MESH" and obj.data.vertices and HAND_PATTERN.search(searchable(obj))
    }
    payload = {
        "authoring": [record(obj) for obj in sorted(authoring, key=lambda value: value.name)],
        "approved": [record(obj) for obj in sorted(approved, key=lambda value: value.name)],
    }
    Path(args.report).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(
        "IEOBOM_V67_HAND_INSPECT",
        json.dumps({"authoring": len(authoring), "approved": len(approved)}, ensure_ascii=False),
        flush=True,
    )


if __name__ == "__main__":
    main()
