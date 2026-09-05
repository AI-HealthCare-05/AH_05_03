"""Fit male epicranial aponeurosis topology into the female cranial frame."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils import Matrix


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def source_name(female: bpy.types.Object) -> str:
    stored = str(female.get("sourceName") or "")
    return stored or female.name.removeprefix("FEMALE_SCALP_")


def fit_affine(scalp: bpy.types.Collection) -> tuple[np.ndarray, dict[str, float]]:
    source_rows: list[list[float]] = []
    target_rows: list[list[float]] = []
    for female in scalp.all_objects:
        if female.type != "MESH" or not female.name.startswith("FEMALE_SCALP_"):
            continue
        source = bpy.data.objects.get(source_name(female))
        if source is None or source.type != "MESH" or len(source.data.vertices) != len(female.data.vertices):
            continue
        stride = max(1, len(source.data.vertices) // 1000)
        for index in range(0, len(source.data.vertices), stride):
            source_point = source.matrix_world @ source.data.vertices[index].co
            target_point = female.matrix_world @ female.data.vertices[index].co
            source_rows.append([source_point.x, source_point.y, source_point.z, 1.0])
            target_rows.append([target_point.x, target_point.y, target_point.z])
    source_array = np.asarray(source_rows, dtype=np.float64)
    target_array = np.asarray(target_rows, dtype=np.float64)
    coefficients, _, _, _ = np.linalg.lstsq(source_array, target_array, rcond=None)
    errors = np.linalg.norm(source_array @ coefficients - target_array, axis=1)
    return coefficients, {
        "sampleCount": len(source_rows),
        "rmseMm": float(np.sqrt(np.mean(errors**2)) * 1000.0),
        "maxErrorMm": float(np.max(errors) * 1000.0),
    }


def transform_point(point, coefficients: np.ndarray) -> tuple[float, float, float]:
    mapped = np.asarray([point.x, point.y, point.z, 1.0], dtype=np.float64) @ coefficients
    return float(mapped[0]), float(mapped[1]), float(mapped[2])


def main() -> None:
    args = parse_args()
    source_blend = bpy.data.filepath
    scalp = bpy.data.collections.get("FEMALE_MUSCLE_SCALP")
    if scalp is None:
        raise RuntimeError("Missing FEMALE_MUSCLE_SCALP")
    coefficients, fit = fit_affine(scalp)

    created = []
    for side, suffix in (("left", "l"), ("right", "r")):
        source = bpy.data.objects.get(f"Epicranial aponeurosis.{suffix}")
        if source is None or source.type != "MESH":
            raise RuntimeError(f"Missing source aponeurosis: {suffix}")
        duplicate = source.copy()
        duplicate.data = source.data.copy()
        duplicate.name = f"FEMALE_SCALP_Epicranial aponeurosis.{suffix}"
        duplicate.matrix_world = Matrix.Identity(4)
        for vertex, source_vertex in zip(duplicate.data.vertices, source.data.vertices, strict=True):
            world_point = source.matrix_world @ source_vertex.co
            vertex.co = transform_point(world_point, coefficients)
        duplicate["sourceName"] = source.name
        duplicate["anatomySystem"] = "muscular"
        duplicate["anatomyId"] = f"muscular-epicranial-aponeurosis-{side}"
        duplicate["label"] = f"Epicranial aponeurosis ({side})"
        duplicate["ieobom_generated_stage"] = "V55_GLOBAL_SCALP_AFFINE"
        duplicate["ieobom_affine_rmse_mm"] = fit["rmseMm"]
        scalp.objects.link(duplicate)
        created.append(
            {
                "name": duplicate.name,
                "sourceName": source.name,
                "vertices": len(duplicate.data.vertices),
                "polygons": len(duplicate.data.polygons),
            }
        )

    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output),
        "version": "v55-global-affine-epicranial-aponeurosis",
        "affineCoefficients4x3": coefficients.tolist(),
        "fit": fit,
        "created": created,
        "existingObjectsChanged": [],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V55_APONEUROSIS", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
