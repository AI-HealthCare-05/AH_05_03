"""Report female head-muscle and fitted-skull bounds without modifying the scene."""

from __future__ import annotations

import json

import bpy
from mathutils import Vector


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    objects = set(collection.objects)
    for child in collection.children:
        objects.update(recursive_objects(child))
    return objects


def bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[index] for point in points) for index in range(3))),
        Vector(tuple(max(point[index] for point in points) for index in range(3))),
    )


def record(obj: bpy.types.Object) -> dict[str, object]:
    minimum, maximum = bounds(obj)
    center = (minimum + maximum) * 0.5
    return {
        "name": obj.name,
        "anatomyId": str(obj.get("anatomyId") or ""),
        "label": str(obj.get("label") or ""),
        "minimum": list(minimum),
        "maximum": list(maximum),
        "center": list(center),
        "size": list(maximum - minimum),
        "vertices": len(obj.data.vertices) if obj.type == "MESH" else None,
    }


def main() -> None:
    muscles_collection = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    head_collection = bpy.data.collections.get("HEAD")
    if muscles_collection is None or head_collection is None:
        raise RuntimeError("Missing FEMALE_MUSCLE_WORK or HEAD collection")

    muscle_records = []
    for obj in recursive_objects(muscles_collection):
        if obj.type not in {"MESH", "CURVE", "SURFACE"}:
            continue
        minimum, maximum = bounds(obj)
        if maximum.z >= 1.36:
            muscle_records.append(record(obj))
    muscle_records.sort(key=lambda item: (-item["center"][2], item["name"]))

    head_records = [record(obj) for obj in recursive_objects(head_collection) if obj.type == "MESH"]
    head_records.sort(key=lambda item: item["name"])
    print(
        "IEOBOM_HEAD_ALIGNMENT_REPORT",
        json.dumps(
            {
                "muscleCount": len(muscle_records),
                "muscles": muscle_records,
                "headBoneCount": len(head_records),
                "headBones": head_records,
            },
            ensure_ascii=False,
        ),
    )


if __name__ == "__main__":
    main()
