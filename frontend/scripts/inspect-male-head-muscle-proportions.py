"""Measure selected male head muscles and skull landmarks from web GLBs."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


TOKENS = (
    "frontalis",
    "temporalis",
    "orbicularis oculi",
    "palpebral",
    "corrugator",
    "procerus",
    "zygomaticus",
    "masseter",
    "mandible",
    "frontal bone",
    "zygomatic bone",
    "maxilla",
    "parietal bone",
    "sphenoid bone",
    "temporal bone",
)


def record(obj: bpy.types.Object) -> dict[str, object]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    minimum = Vector(tuple(min(point[i] for point in points) for i in range(3)))
    maximum = Vector(tuple(max(point[i] for point in points) for i in range(3)))
    return {
        "name": obj.name,
        "anatomyId": str(obj.get("anatomyId") or ""),
        "anatomySystem": str(obj.get("anatomySystem") or ""),
        "center": list((minimum + maximum) * 0.5),
        "size": list(maximum - minimum),
        "minimum": list(minimum),
        "maximum": list(maximum),
    }


def main() -> None:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if not values:
        raise SystemExit("usage: blender -b --python SCRIPT -- FILE.glb [FILE.glb ...]")
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    for value in values:
        bpy.ops.import_scene.gltf(filepath=str(Path(value).resolve()))
    records = []
    for obj in bpy.context.scene.objects:
        if obj.type != "MESH":
            continue
        haystack = " ".join((obj.name, str(obj.get("anatomyId") or ""), str(obj.get("label") or ""))).lower()
        if any(token in haystack for token in TOKENS):
            records.append(record(obj))
    records.sort(key=lambda item: item["name"])
    print("IEOBOM_MALE_HEAD_PROPORTIONS", json.dumps(records, ensure_ascii=False))


if __name__ == "__main__":
    main()
