"""Measure muscle vertices against the fitted female shell surface."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils.bvhtree import BVHTree


JAW_TERMS = (
    "masseter",
    "pterygoid",
    "depressor",
    "mentalis",
    "orbicularis oris",
    "digastric",
    "mylohyoid",
    "geniohyoid",
    "stylohyoid",
)


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--all", action="store_true")
    parser.add_argument("--stride", type=int, default=1)
    return parser.parse_args(values)


def main() -> None:
    args = parse_args()
    shell_collection = bpy.data.collections.get("SHELL_V15")
    muscles_collection = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if shell_collection is None or muscles_collection is None:
        raise RuntimeError("Missing SHELL_V15 or FEMALE_MUSCLE_WORK")
    shell = next((obj for obj in shell_collection.all_objects if obj.type == "MESH"), None)
    if shell is None:
        raise RuntimeError("Female shell mesh not found")
    depsgraph = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(shell, depsgraph)
    normal_matrix = shell.matrix_world.to_3x3().inverted().transposed()

    records = []
    for obj in muscles_collection.all_objects:
        if obj.type != "MESH" or (not args.all and not any(term in obj.name.lower() for term in JAW_TERMS)):
            continue
        signed = []
        for index in range(0, len(obj.data.vertices), max(1, args.stride)):
            vertex = obj.data.vertices[index]
            point = obj.matrix_world @ vertex.co
            nearest, normal, _, _ = bvh.find_nearest(shell.matrix_world.inverted() @ point)
            if nearest is None or normal is None:
                continue
            nearest_world = shell.matrix_world @ nearest
            normal_world = (normal_matrix @ normal).normalized()
            signed.append((point - nearest_world).dot(normal_world))
        outside = [distance for distance in signed if distance > 0.0]
        records.append(
            {
                "name": obj.name,
                "vertices": len(signed),
                "outsideVertices": len(outside),
                "outsidePercent": round(len(outside) * 100.0 / max(1, len(signed)), 3),
                "maxOutsideMm": round(max(outside, default=0.0) * 1000.0, 3),
                "meanOutsideMm": round(sum(outside) * 1000.0 / max(1, len(outside)), 3),
                "minSignedMm": round(min(signed, default=0.0) * 1000.0, 3),
            }
        )
    records.sort(key=lambda item: (-item["maxOutsideMm"], item["name"]))
    report = {"sourceBlend": bpy.data.filepath, "shell": shell.name, "jawObjects": records}
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_JAW_CONTAINMENT", json.dumps(records[:10], ensure_ascii=False))


if __name__ == "__main__":
    main()
