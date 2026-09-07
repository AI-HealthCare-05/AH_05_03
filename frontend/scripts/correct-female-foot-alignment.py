"""Correct the bilateral female foot skeleton against the male Z-Anatomy layout.

The v32 authoring file stores the fitted female skeleton in ``SKELETON_V27``.
Foot meshes share the lower-limb controller transform, so changing object scale
would scale them around an unrelated origin.  This script edits each mesh around
its own centroid in the leg-controller coordinate frame instead.  Parents,
object names, metadata, and click targets remain intact.

Run with Blender 5.2 or newer::

    Blender --background source-v32.blend --python correct-female-foot-alignment.py -- \
      --output source-v33-foot-alignment.blend
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector


FOOT_ID = re.compile(
    r"appendicular-skeleton-(?:"
    r"calcaneus|cuboid-bone|(?:intermediate|lateral|medial)-cuneiform-bone|"
    r"navicular-bone|talus|(?:first|second|third|fourth|fifth)-metatarsal-bone|"
    r"(?:distal|middle|proximal)-phalanx-of-(?:first|second|third|fourth|fifth)-finger-of-foot|"
    r"sesamoid-bones-of-foot"
    r")-(left|right)$"
)

SKELETON_COLLECTION = "SKELETON_V27"
SHELL_NAME = "IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"
ROOT_NAME = "IEOBOM_Female_Workspace_Root"
VERSION = "33.0.0-bilateral-foot-alignment"

# The external shell has substantially more room than the v32 foot skeleton.
# These conservative targets improve continuity without forcing a male-sized
# foot into the female surface.
TARGET_WIDTH_SCALE = 1.18
TARGET_LENGTH_SCALE = 1.0
TARGET_HEIGHT_SCALE = 0.95

GROUP_BLEND = {
    "tarsal": {
        "center": Vector((0.80, 0.45, 0.55)),
        "size": Vector((0.75, 0.25, 0.25)),
    },
    "metatarsal": {
        "center": Vector((0.55, 0.0, 0.25)),
        "size": Vector((0.40, 0.0, 0.10)),
    },
    "phalanx": {
        "center": Vector((0.0, 0.0, 0.0)),
        "size": Vector((0.0, 0.0, 0.0)),
    },
    "sesamoid": {
        "center": Vector((0.65, 0.10, 0.55)),
        "size": Vector((0.45, 0.0, 0.20)),
    },
}


def parse_args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report")
    return parser.parse_args(raw)


def group_for(anatomy_id: str) -> str:
    if "metatarsal-bone" in anatomy_id:
        return "metatarsal"
    if "phalanx-of-" in anatomy_id:
        return "phalanx"
    if "sesamoid-bones" in anatomy_id:
        return "sesamoid"
    return "tarsal"


def bounds(points: list[Vector]) -> tuple[Vector, Vector]:
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def object_points(obj: bpy.types.Object, frame: bpy.types.Object | None) -> list[Vector]:
    to_frame = frame.matrix_world.inverted() if frame else None
    if to_frame is None:
        return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    return [to_frame @ (obj.matrix_world @ vertex.co) for vertex in obj.data.vertices]


def object_metrics(
    obj: bpy.types.Object,
    frame: bpy.types.Object | None,
) -> dict[str, Vector]:
    low, high = bounds(object_points(obj, frame))
    return {"low": low, "high": high, "center": (low + high) * 0.5, "size": high - low}


def assembly_metrics(
    objects: list[bpy.types.Object],
    frame: bpy.types.Object | None,
) -> dict[str, Vector]:
    low, high = bounds([point for obj in objects for point in object_points(obj, frame)])
    return {"low": low, "high": high, "center": (low + high) * 0.5, "size": high - low}


def female_foot_objects(side: str) -> list[bpy.types.Object]:
    skeleton = bpy.data.collections.get(SKELETON_COLLECTION)
    if skeleton is None:
        raise RuntimeError(f"Missing collection: {SKELETON_COLLECTION}")
    objects = sorted(
        (
            obj
            for obj in skeleton.all_objects
            if obj.type == "MESH"
            and FOOT_ID.fullmatch(str(obj.get("anatomyId", "")))
            and str(obj.get("anatomyId", "")).endswith(f"-{side}")
        ),
        key=lambda obj: str(obj.get("anatomyId", "")),
    )
    if len(objects) != 27:
        raise RuntimeError(f"Expected 27 {side} foot meshes; found {len(objects)}")
    return objects


def male_foot_objects(female_objects: list[bpy.types.Object]) -> list[bpy.types.Object]:
    guides: list[bpy.types.Object] = []
    for female in female_objects:
        source_name = str(female.get("sourceName", ""))
        guide = bpy.data.objects.get(source_name)
        if guide is None or guide.type != "MESH" or guide is female:
            raise RuntimeError(f"Missing male guide for {female.name}: sourceName={source_name!r}")
        guides.append(guide)
    return guides


def target_assembly(before: dict[str, Vector], shared_width: float) -> dict[str, Vector]:
    size = before["size"].copy()
    size.x = shared_width * TARGET_WIDTH_SCALE
    size.y *= TARGET_LENGTH_SCALE
    size.z *= TARGET_HEIGHT_SCALE

    # Keep the heel and plantar boundaries stable.  Additional length grows
    # toward the toes, while reduced height creates more dorsal clearance.
    high = before["high"].copy()
    low = before["low"].copy()
    center_x = before["center"].x
    low.x = center_x - size.x * 0.5
    high.x = center_x + size.x * 0.5
    low.y = high.y - size.y
    high.z = low.z + size.z
    return {"low": low, "high": high, "center": (low + high) * 0.5, "size": high - low}


def apply_alignment(
    female_objects: list[bpy.types.Object],
    male_objects: list[bpy.types.Object],
    leg: bpy.types.Object,
    desired_assembly: dict[str, Vector],
) -> list[dict[str, object]]:
    male_assembly = assembly_metrics(male_objects, None)
    rows: list[dict[str, object]] = []

    for female, male in zip(female_objects, male_objects, strict=True):
        anatomy_id = str(female.get("anatomyId", ""))
        group = group_for(anatomy_id)
        blend = GROUP_BLEND[group]
        before = object_metrics(female, leg)
        male_metric = object_metrics(male, None)

        male_center_normalized = Vector(
            tuple(
                (male_metric["center"][axis] - male_assembly["low"][axis]) / male_assembly["size"][axis]
                for axis in range(3)
            )
        )
        male_size_normalized = Vector(
            tuple(male_metric["size"][axis] / male_assembly["size"][axis] for axis in range(3))
        )
        mapped_center = desired_assembly["low"] + Vector(
            tuple(male_center_normalized[axis] * desired_assembly["size"][axis] for axis in range(3))
        )
        mapped_size = Vector(tuple(male_size_normalized[axis] * desired_assembly["size"][axis] for axis in range(3)))
        new_center = Vector(
            tuple(
                before["center"][axis] + (mapped_center[axis] - before["center"][axis]) * blend["center"][axis]
                for axis in range(3)
            )
        )
        new_size = Vector(
            tuple(
                before["size"][axis] + (mapped_size[axis] - before["size"][axis]) * blend["size"][axis]
                for axis in range(3)
            )
        )
        scale = Vector(tuple(new_size[axis] / before["size"][axis] for axis in range(3)))

        # Avoid editing a data block used by a male guide or the opposite side.
        if female.data.users > 1:
            female.data = female.data.copy()
        object_inverse = female.matrix_world.inverted()
        leg_to_world = leg.matrix_world
        for vertex in female.data.vertices:
            point = leg.matrix_world.inverted() @ (female.matrix_world @ vertex.co)
            corrected = new_center + Vector(
                tuple((point[axis] - before["center"][axis]) * scale[axis] for axis in range(3))
            )
            vertex.co = object_inverse @ (leg_to_world @ corrected)
        female.data.update()
        female["ieobomFootAlignmentVersion"] = VERSION
        female["ieobomFootAlignmentGroup"] = group

        after = object_metrics(female, leg)
        rows.append(
            {
                "anatomyId": anatomy_id,
                "sourceName": str(female.get("sourceName", "")),
                "group": group,
                "centerShiftMm": [
                    round((after["center"][axis] - before["center"][axis]) * 1000, 3) for axis in range(3)
                ],
                "sizeScale": [round(scale[axis], 4) for axis in range(3)],
            }
        )
    return rows


def shell_low_bounds(root: bpy.types.Object) -> dict[str, Vector]:
    shell = bpy.data.objects.get(SHELL_NAME)
    if shell is None:
        raise RuntimeError(f"Missing female shell: {SHELL_NAME}")
    root_inverse = root.matrix_world.inverted()
    points = [
        root_inverse @ (shell.matrix_world @ vertex.co)
        for vertex in shell.data.vertices
        if (root_inverse @ (shell.matrix_world @ vertex.co)).z < 0.13
    ]
    low, high = bounds(points)
    return {"low": low, "high": high, "size": high - low}


def vec(values: Vector) -> list[float]:
    return [round(value, 6) for value in values]


def main() -> None:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve() if args.report else output.with_suffix(".report.json")
    if output == Path(bpy.data.filepath).resolve():
        raise RuntimeError("Refusing to overwrite the v32 source file")
    output.parent.mkdir(parents=True, exist_ok=True)

    root = bpy.data.objects.get(ROOT_NAME)
    if root is None:
        raise RuntimeError(f"Missing female workspace root: {ROOT_NAME}")

    sides: dict[str, dict[str, object]] = {}
    female_by_side = {side: female_foot_objects(side) for side in ("left", "right")}
    before_by_side = {
        side: assembly_metrics(objects, bpy.data.objects[f"FEMALE_LEG_{side[0].upper()}_CTRL"])
        for side, objects in female_by_side.items()
    }
    shared_width = sum(metric["size"].x for metric in before_by_side.values()) / 2

    for side in ("left", "right"):
        leg = bpy.data.objects[f"FEMALE_LEG_{side[0].upper()}_CTRL"]
        female_objects = female_by_side[side]
        guides = male_foot_objects(female_objects)
        desired = target_assembly(before_by_side[side], shared_width)
        rows = apply_alignment(female_objects, guides, leg, desired)
        after = assembly_metrics(female_objects, leg)
        sides[side] = {
            "beforeBounds": {
                "low": vec(before_by_side[side]["low"]),
                "high": vec(before_by_side[side]["high"]),
                "size": vec(before_by_side[side]["size"]),
            },
            "desiredBounds": {
                "low": vec(desired["low"]),
                "high": vec(desired["high"]),
                "size": vec(desired["size"]),
            },
            "afterBounds": {
                "low": vec(after["low"]),
                "high": vec(after["high"]),
                "size": vec(after["size"]),
            },
            "objects": rows,
        }

    bpy.context.scene["ieobomFootAlignmentVersion"] = VERSION
    bpy.context.scene["ieobomFootAlignmentSource"] = bpy.data.filepath
    bpy.ops.wm.save_as_mainfile(filepath=str(output), check_existing=False)

    shell_bounds = shell_low_bounds(root)
    report = {
        "version": VERSION,
        "source": bpy.context.scene["ieobomFootAlignmentSource"],
        "output": str(output),
        "parameters": {
            "targetWidthScale": TARGET_WIDTH_SCALE,
            "targetLengthScale": TARGET_LENGTH_SCALE,
            "targetHeightScale": TARGET_HEIGHT_SCALE,
            "policy": "blend male normalized layout into female shell; preserve hierarchy and metadata",
        },
        "shellLowBounds": {
            "low": vec(shell_bounds["low"]),
            "high": vec(shell_bounds["high"]),
            "size": vec(shell_bounds["size"]),
        },
        "sides": sides,
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
