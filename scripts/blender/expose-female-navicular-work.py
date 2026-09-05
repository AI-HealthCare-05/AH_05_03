"""Expose the fitted female navicular bones for unambiguous Blender review.

The female objects already occupy the navicular slots, but their generated
anatomy-ID names are easily confused with the short-named male guide objects.
This script gives the female pair explicit work names, moves them into a
dedicated child collection, preserves all geometry and controller parenting,
and saves a new authoring version.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
from mathutils import Vector


SKELETON_COLLECTION = "SKELETON_V27"
NAVICULAR_COLLECTION = "FEMALE_FOOT_NAVICULAR_WORK"
VERSION = "34.0.0-explicit-female-navicular-review"

SIDES = {
    "left": {
        "anatomy_id": "appendicular-skeleton-navicular-bone-left",
        "object_name": "FEMALE_NAVICULAR_L_WORK",
        "mesh_name": "FEMALE_NAVICULAR_L_WORK_MESH",
        "source_name": "Navicular bone.l",
    },
    "right": {
        "anatomy_id": "appendicular-skeleton-navicular-bone-right",
        "object_name": "FEMALE_NAVICULAR_R_WORK",
        "mesh_name": "FEMALE_NAVICULAR_R_WORK_MESH",
        "source_name": "Navicular bone.r",
    },
}


def parse_args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report")
    return parser.parse_args(raw)


def world_center(obj: bpy.types.Object) -> Vector:
    return (
        sum(
            (obj.matrix_world @ Vector(corner) for corner in obj.bound_box),
            Vector(),
        )
        / 8.0
    )


def main() -> None:
    parsed = parse_args()
    output = Path(parsed.output).expanduser().resolve()
    report_path = Path(parsed.report).expanduser().resolve() if parsed.report else output.with_suffix(".report.json")
    source = Path(bpy.data.filepath).resolve()
    if output == source:
        raise RuntimeError("Refusing to overwrite the source blend file")

    skeleton = bpy.data.collections.get(SKELETON_COLLECTION)
    if skeleton is None:
        raise RuntimeError(f"Missing collection: {SKELETON_COLLECTION}")

    review = bpy.data.collections.get(NAVICULAR_COLLECTION)
    if review is None:
        review = bpy.data.collections.new(NAVICULAR_COLLECTION)
    if review.name not in {child.name for child in skeleton.children}:
        skeleton.children.link(review)

    rows = []
    for side, spec in SIDES.items():
        matches = [
            obj for obj in skeleton.all_objects if obj.type == "MESH" and obj.get("anatomyId") == spec["anatomy_id"]
        ]
        if len(matches) != 1:
            raise RuntimeError(f"Expected one fitted {side} navicular; found {len(matches)}")
        obj = matches[0]
        if obj.data.users > 1:
            obj.data = obj.data.copy()

        for collection in list(obj.users_collection):
            collection.objects.unlink(obj)
        review.objects.link(obj)

        obj.name = spec["object_name"]
        obj.data.name = spec["mesh_name"]
        obj["sourceName"] = spec["source_name"]
        obj["anatomyId"] = spec["anatomy_id"]
        obj["ieobomNavicularReviewVersion"] = VERSION
        obj["ieobomReviewLabel"] = f"Female {side} navicular (foot)"
        obj.hide_viewport = False
        obj.hide_render = False
        obj.hide_select = False
        obj.hide_set(False)

        rows.append(
            {
                "side": side,
                "name": obj.name,
                "mesh": obj.data.name,
                "anatomyId": obj.get("anatomyId"),
                "sourceName": obj.get("sourceName"),
                "parent": obj.parent.name if obj.parent else None,
                "collections": [collection.name for collection in obj.users_collection],
                "vertices": len(obj.data.vertices),
                "worldCenter": [round(value, 6) for value in world_center(obj)],
                "dimensions": [round(value, 6) for value in obj.dimensions],
            }
        )

    for obj in bpy.context.selected_objects:
        obj.select_set(False)
    left = bpy.data.objects[SIDES["left"]["object_name"]]
    right = bpy.data.objects[SIDES["right"]["object_name"]]
    left.select_set(True)
    right.select_set(True)
    bpy.context.view_layer.objects.active = left

    output.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(
        json.dumps(
            {
                "source": str(source),
                "output": str(output),
                "version": VERSION,
                "geometryChanged": False,
                "objects": rows,
            },
            ensure_ascii=False,
            indent=2,
        )
        + "\n",
        encoding="utf-8",
    )
    print(json.dumps(rows, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
