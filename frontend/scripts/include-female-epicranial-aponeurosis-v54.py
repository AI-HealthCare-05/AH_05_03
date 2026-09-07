"""Include the already fitted female epicranial aponeurosis in the muscle layer."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


SOURCE_NAMES = (
    "FEMALE_SUPPORT_Epicranial aponeurosis.l",
    "FEMALE_SUPPORT_Epicranial aponeurosis.r",
)


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def main() -> None:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    source_blend = bpy.data.filepath
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)

    scalp = bpy.data.collections.get("FEMALE_MUSCLE_SCALP")
    if scalp is None:
        raise RuntimeError("Missing FEMALE_MUSCLE_SCALP collection")

    matrix_before = {obj: obj.matrix_world.copy() for obj in bpy.data.objects}
    included: list[dict[str, object]] = []

    for source_name in SOURCE_NAMES:
        obj = bpy.data.objects.get(source_name)
        if obj is None or obj.type != "MESH":
            raise RuntimeError(f"Missing fitted aponeurosis mesh: {source_name}")

        if scalp.objects.get(obj.name) is None:
            scalp.objects.link(obj)

        side = "left" if source_name.endswith(".l") else "right"
        obj.name = f"FEMALE_SCALP_Epicranial aponeurosis.{source_name[-1]}"
        obj["anatomySystem"] = "muscular"
        obj["anatomyId"] = f"muscular-epicranial-aponeurosis-{side}"
        obj["label"] = f"Epicranial aponeurosis ({side})"
        obj["ieobom_layer_inclusion_version"] = "v54"
        obj.hide_viewport = False
        obj.hide_render = False
        included.append(
            {
                "name": obj.name,
                "side": side,
                "vertices": len(obj.data.vertices),
                "polygons": len(obj.data.polygons),
                "sourceFitStage": obj.get("ieobom_generated_stage"),
                "sourceFitRmseMm": obj.get("ieobom_local_affine_fit_rmse_mm"),
            }
        )

    changed_matrices = []
    for obj, matrix in matrix_before.items():
        if obj.name in bpy.data.objects and any(
            abs(obj.matrix_world[row][column] - matrix[row][column]) > 1e-8 for row in range(4) for column in range(4)
        ):
            changed_matrices.append(obj.name)
    if changed_matrices:
        raise RuntimeError(f"Unexpected transform changes: {changed_matrices[:10]}")

    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output),
        "version": "v54-epicranial-aponeurosis-inclusion",
        "included": included,
        "geometryOrTransformChanges": [],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V54_REPORT", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
