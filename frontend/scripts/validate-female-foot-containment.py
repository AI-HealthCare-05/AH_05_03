"""Sample corrected foot meshes against the female shell surface."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils.bvhtree import BVHTree


FOOT_ID = re.compile(
    r"appendicular-skeleton-(?:calcaneus|cuboid-bone|.*cuneiform-bone|"
    r"navicular-bone|talus|.*metatarsal-bone|.*phalanx-of-.*-finger-of-foot|"
    r"sesamoid-bones-of-foot)-(?:left|right)$"
)


def args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--samples-per-object", type=int, default=120)
    return parser.parse_args(raw)


def main() -> None:
    parsed = args()
    depsgraph = bpy.context.evaluated_depsgraph_get()
    shell = bpy.data.objects["IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"]
    surface = BVHTree.FromObject(shell, depsgraph)
    shell_inverse = shell.matrix_world.inverted()
    shell_scale = sum(shell.matrix_world.to_scale()) / 3
    skeleton = bpy.data.collections["SKELETON_V27"]
    objects = sorted(
        (
            obj
            for obj in skeleton.all_objects
            if obj.type == "MESH" and FOOT_ID.fullmatch(str(obj.get("anatomyId", "")))
        ),
        key=lambda obj: obj.name,
    )
    if len(objects) != 54:
        raise RuntimeError(f"Expected 54 corrected foot meshes; found {len(objects)}")

    rows = []
    for obj in objects:
        step = max(1, len(obj.data.vertices) // parsed.samples_per_object)
        signed = []
        for index, vertex in enumerate(obj.data.vertices):
            if index % step:
                continue
            point = shell_inverse @ (obj.matrix_world @ vertex.co)
            nearest = surface.find_nearest(point)
            if nearest is None:
                continue
            surface_point, normal, _face_index, _distance = nearest
            signed.append((point - surface_point).dot(normal) * shell_scale)
        rows.append(
            {
                "name": obj.name,
                "anatomyId": obj.get("anatomyId"),
                "samples": len(signed),
                "maxSignedMm": round(max(signed) * 1000, 3),
                "outside05mm": sum(value > 0.0005 for value in signed),
                "outside15mm": sum(value > 0.0015 for value in signed),
            }
        )

    report = {
        "source": bpy.data.filepath,
        "correctedFootMeshes": len(objects),
        "samples": sum(row["samples"] for row in rows),
        "maxSignedMm": max(row["maxSignedMm"] for row in rows),
        "outside05mm": sum(row["outside05mm"] for row in rows),
        "outside15mm": sum(row["outside15mm"] for row in rows),
        "objectsOutside05mm": [row for row in rows if row["outside05mm"]],
    }
    output = Path(parsed.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
