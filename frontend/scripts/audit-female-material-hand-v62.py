"""Audit female authoring materials and distal upper-limb structures for v62."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import bpy


HAND_PATTERN = re.compile(r"hand|finger|digit|thumb|wrist|carpal|metacarp|palmar|dorsal fascia", re.I)


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--shell", required=True)
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--report")
    return parser.parse_args(values)


def recursive_objects(collection):
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def bounds(obj):
    points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    return {
        "min": [round(min(point[i] for point in points), 5) for i in range(3)],
        "max": [round(max(point[i] for point in points), 5) for i in range(3)],
    }


def import_meshes(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]


def main():
    args = parse_args()
    work_collections = [
        collection
        for collection in bpy.data.collections
        if collection.name.startswith("FEMALE_") and "WORK" in collection.name
    ]
    work_objects = {
        obj
        for collection in work_collections
        for obj in recursive_objects(collection)
        if obj.type == "MESH" and obj.data.polygons
    }
    materials = {}
    for obj in work_objects:
        for material in obj.data.materials:
            if material is None:
                continue
            materials[material.name] = {
                "roughness": round(material.roughness, 4),
                "metallic": round(material.metallic, 4),
                "diffuse": [round(value, 4) for value in material.diffuse_color],
                "users": material.users,
            }
    hand_objects = []
    for obj in sorted(work_objects, key=lambda item: item.name):
        search = " ".join((obj.name, str(obj.get("sourceName", "")), str(obj.get("label", ""))))
        if HAND_PATTERN.search(search):
            hand_objects.append(
                {
                    "name": obj.name,
                    "collections": sorted(collection.name for collection in obj.users_collection),
                    "bounds": bounds(obj),
                }
            )
    shell = import_meshes(Path(args.shell).resolve())
    skeleton = import_meshes(Path(args.skeleton).resolve())
    skeleton_hands = [obj for obj in skeleton if HAND_PATTERN.search(obj.name)]
    payload = {
        "workCollections": {
            collection.name: len(
                [obj for obj in recursive_objects(collection) if obj.type == "MESH" and obj.data.polygons]
            )
            for collection in work_collections
        },
        "materials": materials,
        "handObjects": hand_objects,
        "shellBounds": bounds(shell[0]),
        "skeletonHandObjects": [{"name": obj.name, "bounds": bounds(obj)} for obj in skeleton_hands],
    }
    if args.report:
        Path(args.report).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(
        "IEOBOM_V62_AUDIT",
        json.dumps(
            {
                "workCollections": payload["workCollections"],
                "materials": len(materials),
                "handObjects": len(hand_objects),
                "skeletonHandObjects": len(skeleton_hands),
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
