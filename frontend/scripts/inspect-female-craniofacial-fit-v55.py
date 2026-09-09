"""Inspect female craniofacial muscles, nape attachments, and source counterparts."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(values)


def bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def record(obj: bpy.types.Object) -> dict[str, object]:
    low, high = bounds(obj)
    source_name = str(obj.get("sourceName") or "")
    source = bpy.data.objects.get(source_name) if source_name else None
    value: dict[str, object] = {
        "name": obj.name,
        "sourceName": source_name,
        "vertices": len(obj.data.vertices) if obj.type == "MESH" else 0,
        "minimum": list(low),
        "maximum": list(high),
        "center": list((low + high) * 0.5),
        "size": list(high - low),
    }
    if source is not None and source.type == "MESH":
        source_low, source_high = bounds(source)
        value["sourceBounds"] = {
            "minimum": list(source_low),
            "maximum": list(source_high),
            "center": list((source_low + source_high) * 0.5),
            "size": list(source_high - source_low),
        }
    return value


def objects_in(name: str) -> list[bpy.types.Object]:
    collection = bpy.data.collections.get(name)
    if collection is None:
        return []
    return [obj for obj in collection.all_objects if obj.type == "MESH"]


def main() -> None:
    args = parse_args()
    head = objects_in("FEMALE_MUSCLE_HEAD_WORK")
    external_neck = objects_in("FEMALE_MUSCLE_EXTERNAL_NECK")
    deep_neck = objects_in("FEMALE_MUSCLE_DEEP_NECK")
    nape_terms = ("capitis", "trapezius", "occip", "semispinalis", "splenius", "longissimus")
    nape = [
        obj
        for obj in external_neck + deep_neck
        if any(term in (obj.name + str(obj.get("sourceName") or "")).lower() for term in nape_terms)
    ]
    jaw_terms = ("masseter", "pterygoid", "depressor", "mentalis", "orbicularis oris", "digastric")
    jaw = [
        obj
        for obj in head + external_neck + deep_neck
        if any(term in (obj.name + str(obj.get("sourceName") or "")).lower() for term in jaw_terms)
    ]
    support = [
        bpy.data.objects[name]
        for name in (
            "FEMALE_SUPPORT_Epicranial aponeurosis.l",
            "FEMALE_SUPPORT_Epicranial aponeurosis.r",
        )
        if name in bpy.data.objects
    ]

    output = {
        "sourceBlend": bpy.data.filepath,
        "counts": {
            "head": len(head),
            "externalNeck": len(external_neck),
            "deepNeck": len(deep_neck),
            "napeCandidates": len(nape),
            "jawCandidates": len(jaw),
        },
        "nape": sorted((record(obj) for obj in nape), key=lambda item: item["name"]),
        "jaw": sorted((record(obj) for obj in jaw), key=lambda item: item["name"]),
        "femaleSupportAponeurosis": [record(obj) for obj in support],
        "maleAponeurosis": [
            record(bpy.data.objects[name])
            for name in ("Epicranial aponeurosis.l", "Epicranial aponeurosis.r")
            if name in bpy.data.objects
        ],
    }
    path = Path(args.output).expanduser().resolve()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(output, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V55_INSPECTION", json.dumps(output["counts"], ensure_ascii=False))


if __name__ == "__main__":
    main()
