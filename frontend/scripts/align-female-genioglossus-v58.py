"""Place the female genioglossus pair inside the oral cavity without reshaping it."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np


PAIRS = (
    ("Genioglossus muscle.l", "FEMALE_TONGUE_Genioglossus muscle.l"),
    ("Genioglossus muscle.r", "FEMALE_TONGUE_Genioglossus muscle.r"),
)


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def source_name(obj: bpy.types.Object) -> str:
    stored = str(obj.get("sourceName") or "")
    if stored:
        return stored
    if obj.name.startswith("FEMALE_SCALP_"):
        return obj.name.removeprefix("FEMALE_SCALP_")
    return ""


def fit_head_affine() -> tuple[np.ndarray, float, int]:
    scalp = bpy.data.collections.get("FEMALE_MUSCLE_SCALP")
    if scalp is None:
        raise RuntimeError("FEMALE_MUSCLE_SCALP missing")
    source_rows: list[list[float]] = []
    target_rows: list[list[float]] = []
    for female in scalp.all_objects:
        if female.type != "MESH" or "Epicranial aponeurosis" in female.name:
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
    if not source_rows:
        raise RuntimeError("Cannot derive head affine")
    source_array = np.asarray(source_rows, dtype=np.float64)
    target_array = np.asarray(target_rows, dtype=np.float64)
    coefficients = np.linalg.lstsq(source_array, target_array, rcond=None)[0]
    residuals = source_array @ coefficients - target_array
    rmse_mm = float(np.sqrt(np.mean(np.sum(residuals * residuals, axis=1))) * 1000.0)
    return coefficients, rmse_mm, len(source_rows)


def bounds(points: list[np.ndarray]) -> dict[str, list[float]]:
    return {
        axis: [
            round(float(min(point[index] for point in points)), 6),
            round(float(max(point[index] for point in points)), 6),
        ]
        for index, axis in enumerate(("x", "y", "z"))
    }


def main() -> None:
    args = parse_args()
    source_blend = bpy.data.filepath
    coefficients, affine_rmse_mm, affine_samples = fit_head_affine()
    records = []

    tongue = bpy.data.objects.get("Tongue")
    if tongue is None or tongue.type != "MESH":
        raise RuntimeError("Original male Tongue mesh missing")
    mapped_tongue_points = []
    for vertex in tongue.data.vertices:
        point = tongue.matrix_world @ vertex.co
        mapped_tongue_points.append(np.asarray([point.x, point.y, point.z, 1.0]) @ coefficients)
    tongue_bounds = bounds(mapped_tongue_points)

    for male_name, female_name in PAIRS:
        male = bpy.data.objects.get(male_name)
        female = bpy.data.objects.get(female_name)
        if male is None or female is None or male.type != "MESH" or female.type != "MESH":
            raise RuntimeError(f"Missing genioglossus pair: {male_name} / {female_name}")
        if len(male.data.vertices) != len(female.data.vertices):
            raise RuntimeError(f"Topology mismatch: {male_name} / {female_name}")

        inverse = female.matrix_world.inverted()
        before = []
        after = []
        moves = []
        for index, vertex in enumerate(female.data.vertices):
            current = female.matrix_world @ vertex.co
            source_point = male.matrix_world @ male.data.vertices[index].co
            target_array = np.asarray([source_point.x, source_point.y, source_point.z, 1.0]) @ coefficients
            target = current.copy()
            target.x = float(target_array[0])
            target.y = float(target_array[1])
            target.z = float(target_array[2])
            before.append(np.asarray(current))
            after.append(np.asarray(target))
            moves.append((target - current).length)
            vertex.co = inverse @ target
        female.data.update()
        female["IEOBOM_genioglossusAlignmentVersion"] = "v58"

        inside_mapped_tongue_bounds = sum(
            tongue_bounds[axis][0] <= point[index] <= tongue_bounds[axis][1]
            for point in after
            for index, axis in enumerate(("x", "y", "z"))
        )
        total_axis_checks = len(after) * 3
        records.append(
            {
                "maleSource": male_name,
                "femaleTarget": female_name,
                "vertices": len(after),
                "polygons": len(female.data.polygons),
                "topologyChanged": False,
                "beforeBounds": bounds(before),
                "afterBounds": bounds(after),
                "movementMm": {
                    "min": round(min(moves) * 1000.0, 3),
                    "max": round(max(moves) * 1000.0, 3),
                    "mean": round(sum(moves) * 1000.0 / len(moves), 3),
                },
                "mappedTongueBoundsAxisContainmentPercent": round(
                    inside_mapped_tongue_bounds * 100.0 / total_axis_checks,
                    3,
                ),
            }
        )

    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene["IEOBOM_V58_GENIOGLOSSUS_ALIGNMENT"] = json.dumps(
        {
            "objects": [female for _, female in PAIRS],
            "headAffineRmseMm": affine_rmse_mm,
        }
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output),
        "version": "v58-genioglossus-oral-alignment",
        "headAffineSamples": affine_samples,
        "headAffineRmseMm": round(affine_rmse_mm, 6),
        "mappedTongueBounds": tongue_bounds,
        "records": records,
        "notes": [
            "Only FEMALE_TONGUE_Genioglossus muscle.l/r were moved.",
            "Every target vertex was placed from its exact same-model male source counterpart.",
            "No vertices, edges, polygons, materials, skeleton, shell, or other muscles were changed.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V58_GENIOGLOSSUS", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
