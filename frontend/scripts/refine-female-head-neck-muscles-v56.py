"""Contain submandibular muscles and reconnect nape insertions to the fitted head."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree


JAW_CONTAINMENT_TERMS = (
    "anterior belly of digastric",
    "posterior belly of digastric",
    "mylohyoid",
    "geniohyoid",
    "orbicularis oris",
)
NAPE_TERMS = (
    "capitis",
    "splenius colli",
    "sternocleidomastoid",
    "descending part of trapezius",
)
FEMALE_PREFIXES = (
    "FEMALE_DEEP_BACK_",
    "FEMALE_DEEP_NECK_",
    "FEMALE_EXTERNAL_NECK_",
    "FEMALE_MUSCLE_TRUNK_",
    "FEMALE_SCALP_",
)


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def raw_source_name(obj: bpy.types.Object) -> str:
    stored = str(obj.get("sourceName") or "")
    if stored:
        return stored
    for prefix in FEMALE_PREFIXES:
        if obj.name.startswith(prefix):
            return obj.name.removeprefix(prefix)
    return ""


def fit_head_affine(scalp: bpy.types.Collection) -> np.ndarray:
    source_rows: list[list[float]] = []
    target_rows: list[list[float]] = []
    for female in scalp.all_objects:
        if female.type != "MESH" or "Epicranial aponeurosis" in female.name:
            continue
        source = bpy.data.objects.get(raw_source_name(female))
        if source is None or source.type != "MESH" or len(source.data.vertices) != len(female.data.vertices):
            continue
        stride = max(1, len(source.data.vertices) // 1000)
        for index in range(0, len(source.data.vertices), stride):
            source_point = source.matrix_world @ source.data.vertices[index].co
            target_point = female.matrix_world @ female.data.vertices[index].co
            source_rows.append([source_point.x, source_point.y, source_point.z, 1.0])
            target_rows.append([target_point.x, target_point.y, target_point.z])
    coefficients, _, _, _ = np.linalg.lstsq(
        np.asarray(source_rows, dtype=np.float64),
        np.asarray(target_rows, dtype=np.float64),
        rcond=None,
    )
    return coefficients


def mapped_source_point(source: bpy.types.Object, index: int, coefficients: np.ndarray) -> np.ndarray:
    point = source.matrix_world @ source.data.vertices[index].co
    return np.asarray([point.x, point.y, point.z, 1.0], dtype=np.float64) @ coefficients


def smoothstep(value: float) -> float:
    value = min(1.0, max(0.0, value))
    return value * value * (3.0 - 2.0 * value)


def main() -> None:
    args = parse_args()
    source_blend = bpy.data.filepath
    muscles = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    scalp = bpy.data.collections.get("FEMALE_MUSCLE_SCALP")
    shell_collection = bpy.data.collections.get("SHELL_V15")
    if muscles is None or scalp is None or shell_collection is None:
        raise RuntimeError("Missing required female muscle/scalp/shell collections")
    shell = next((obj for obj in shell_collection.all_objects if obj.type == "MESH"), None)
    if shell is None:
        raise RuntimeError("Female shell mesh not found")

    depsgraph = bpy.context.evaluated_depsgraph_get()
    bvh = BVHTree.FromObject(shell, depsgraph)
    shell_inverse = shell.matrix_world.inverted()
    shell_normal_matrix = shell.matrix_world.to_3x3().inverted().transposed()
    jaw_report = []
    containment_margin = 0.001

    for obj in muscles.all_objects:
        if obj.type != "MESH" or not any(term in obj.name.lower() for term in JAW_CONTAINMENT_TERMS):
            continue
        inverse = obj.matrix_world.inverted()
        moved = 0
        max_move = 0.0
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            nearest, normal, _, _ = bvh.find_nearest(shell_inverse @ point)
            if nearest is None or normal is None:
                continue
            nearest_world = shell.matrix_world @ nearest
            normal_world = (shell_normal_matrix @ normal).normalized()
            signed_distance = (point - nearest_world).dot(normal_world)
            if signed_distance <= -containment_margin:
                continue
            target = nearest_world - normal_world * containment_margin
            distance = (target - point).length
            vertex.co = inverse @ target
            moved += 1
            max_move = max(max_move, distance)
        obj.data.update()
        jaw_report.append(
            {
                "name": obj.name,
                "movedVertices": moved,
                "maxMoveMm": round(max_move * 1000.0, 3),
            }
        )

    coefficients = fit_head_affine(scalp)
    nape_report = []
    for obj in muscles.all_objects:
        if obj.type != "MESH" or not any(term in obj.name.lower() for term in NAPE_TERMS):
            continue
        source = bpy.data.objects.get(raw_source_name(obj))
        if source is None or source.type != "MESH" or len(source.data.vertices) != len(obj.data.vertices):
            continue
        inverse = obj.matrix_world.inverted()
        moved = 0
        max_move = 0.0
        for index, vertex in enumerate(obj.data.vertices):
            current = obj.matrix_world @ vertex.co
            weight = smoothstep((current.z - 1.43) / 0.105)
            if weight <= 0.0:
                continue
            target_array = mapped_source_point(source, index, coefficients)
            target = current.copy()
            target.x = float(target_array[0])
            target.y = float(target_array[1])
            target.z = float(target_array[2])
            displacement = (target - current) * weight
            # Guard against bad source correspondence before touching geometry.
            if displacement.length > 0.05:
                continue
            vertex.co = inverse @ (current + displacement)
            moved += 1
            max_move = max(max_move, displacement.length)
        obj.data.update()
        nape_report.append(
            {
                "name": obj.name,
                "sourceName": source.name,
                "movedVertices": moved,
                "maxMoveMm": round(max_move * 1000.0, 3),
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
        "version": "v56-jaw-containment-nape-attachment",
        "jawContainmentMarginMm": containment_margin * 1000.0,
        "jaw": jaw_report,
        "nape": nape_report,
        "notes": [
            "Only out-of-shell submandibular/lip vertices were projected inward.",
            "Only upper nape vertices were blended toward the verified head affine.",
            "Hands, feet, skeleton, shell, and lower neck/body attachments were not edited.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(
        "IEOBOM_V56_REFINEMENT",
        json.dumps(
            {
                "jawObjects": len(jaw_report),
                "jawMovedVertices": sum(item["movedVertices"] for item in jaw_report),
                "napeObjects": len(nape_report),
                "napeMovedVertices": sum(item["movedVertices"] for item in nape_report),
                "maxJawMoveMm": max((item["maxMoveMm"] for item in jaw_report), default=0.0),
                "maxNapeMoveMm": max((item["maxMoveMm"] for item in nape_report), default=0.0),
            },
            ensure_ascii=False,
        ),
    )


if __name__ == "__main__":
    main()
