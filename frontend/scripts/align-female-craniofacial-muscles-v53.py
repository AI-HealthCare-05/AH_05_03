"""Align female craniofacial muscles to the fitted female skull.

Male/female homologous landmark measurements show that the female muscle sizes
already match the fitted skull scale.  Only the craniofacial muscle frame is
offset: approximately 13 mm posterior and 17 mm inferior relative to the skull.
Apply one rigid world-space correction to skull-attached muscle families.  Neck,
hyoid, tongue, pharynx, trunk, shell, and skeleton objects remain untouched.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


VERSION = "v53-craniofacial-muscle-alignment"
MUSCLE_COLLECTION = "FEMALE_MUSCLE_WORK"
TARGET_PREFIXES = (
    "FEMALE_SCALP_",
    "FEMALE_NASAL_",
    "FEMALE_OCULAR_FACE_",
    "FEMALE_EXTRAOCULAR_",
    "FEMALE_MASTICATORY_",
    "FEMALE_ORAL_",
)
WORLD_DELTA = Vector((0.0, -0.013, 0.017))


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    objects = set(collection.objects)
    for child in collection.children:
        objects.update(recursive_objects(child))
    return objects


def world_bounds(obj: bpy.types.Object) -> tuple[list[float], list[float]]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        [min(point[index] for point in points) for index in range(3)],
        [max(point[index] for point in points) for index in range(3)],
    )


def main() -> None:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 2:
        raise SystemExit("usage: blender -b SOURCE.blend --python SCRIPT -- OUTPUT.blend REPORT.json")
    output_blend = Path(values[0]).resolve()
    report_path = Path(values[1]).resolve()
    source_blend = bpy.data.filepath

    collection = bpy.data.collections.get(MUSCLE_COLLECTION)
    if collection is None:
        raise RuntimeError(f"Missing collection: {MUSCLE_COLLECTION}")
    targets = sorted(
        (
            obj
            for obj in recursive_objects(collection)
            if obj.type in {"MESH", "CURVE", "SURFACE"} and obj.name.startswith(TARGET_PREFIXES)
        ),
        key=lambda obj: obj.name,
    )
    if len(targets) < 40:
        raise RuntimeError(f"Unexpected craniofacial target count: {len(targets)}")

    protected = {obj.name: obj.matrix_world.copy() for obj in bpy.data.objects if obj not in targets}
    before = {obj.name: world_bounds(obj) for obj in targets}
    translation = Matrix.Translation(WORLD_DELTA)
    for obj in targets:
        obj.matrix_world = translation @ obj.matrix_world
        obj["IEOBOM_craniofacialAlignmentVersion"] = VERSION
        obj["IEOBOM_craniofacialAlignmentDeltaMeters"] = list(WORLD_DELTA)
    bpy.context.view_layer.update()

    changed_protected = []
    for name, matrix in protected.items():
        obj = bpy.data.objects.get(name)
        if obj is None or any(
            abs(a - b) > 1e-9
            for row_a, row_b in zip(obj.matrix_world, matrix, strict=True)
            for a, b in zip(row_a, row_b, strict=True)
        ):
            changed_protected.append(name)
    if changed_protected:
        raise RuntimeError(f"Protected objects changed: {changed_protected[:10]}")

    after = {obj.name: world_bounds(obj) for obj in targets}
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))
    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output_blend),
        "version": VERSION,
        "worldDeltaMeters": list(WORLD_DELTA),
        "targetPrefixes": list(TARGET_PREFIXES),
        "targetCount": len(targets),
        "targets": [obj.name for obj in targets],
        "sampleBefore": {name: before[name] for name in list(before)[:8]},
        "sampleAfter": {name: after[name] for name in list(after)[:8]},
        "protectedObjectsChanged": changed_protected,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V53_REPORT", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
