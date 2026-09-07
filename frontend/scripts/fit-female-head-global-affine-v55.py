"""Fit a stable male-to-female head affine from corresponding scalp meshes."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(values)


def main() -> None:
    args = parse_args()
    scalp = bpy.data.collections.get("FEMALE_MUSCLE_SCALP")
    if scalp is None:
        raise RuntimeError("Missing FEMALE_MUSCLE_SCALP")

    sources: list[list[float]] = []
    targets: list[list[float]] = []
    pairs = []
    for female in scalp.all_objects:
        if female.type != "MESH":
            continue
        source_name = str(female.get("sourceName") or "")
        if not source_name and female.name.startswith("FEMALE_SCALP_"):
            source_name = female.name.removeprefix("FEMALE_SCALP_")
        source = bpy.data.objects.get(source_name)
        if source is None or source.type != "MESH" or len(source.data.vertices) != len(female.data.vertices):
            continue
        stride = max(1, len(source.data.vertices) // 1000)
        for index in range(0, len(source.data.vertices), stride):
            source_point = source.matrix_world @ source.data.vertices[index].co
            target_point = female.matrix_world @ female.data.vertices[index].co
            sources.append([source_point.x, source_point.y, source_point.z, 1.0])
            targets.append([target_point.x, target_point.y, target_point.z])
        pairs.append({"female": female.name, "source": source.name, "vertices": len(source.data.vertices)})

    source_array = np.asarray(sources, dtype=np.float64)
    target_array = np.asarray(targets, dtype=np.float64)
    coefficients, _, _, _ = np.linalg.lstsq(source_array, target_array, rcond=None)
    predicted = source_array @ coefficients
    errors = np.linalg.norm(predicted - target_array, axis=1)
    report = {
        "sourceBlend": bpy.data.filepath,
        "pairs": pairs,
        "sampleCount": len(sources),
        "coefficients4x3": coefficients.tolist(),
        "rmseMm": float(np.sqrt(np.mean(errors**2)) * 1000.0),
        "medianErrorMm": float(np.median(errors) * 1000.0),
        "maxErrorMm": float(np.max(errors) * 1000.0),
    }
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(
        "IEOBOM_HEAD_AFFINE",
        json.dumps({k: report[k] for k in ("sampleCount", "rmseMm", "medianErrorMm", "maxErrorMm")}),
    )


if __name__ == "__main__":
    main()
