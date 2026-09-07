"""Pull the upper platysma beneath the female shell and close the visible jaw band."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree


PLATYSMA_NAMES = (
    "FEMALE_EXTERNAL_NECK_Platysma.l",
    "FEMALE_EXTERNAL_NECK_Platysma.r",
)
BLEND_START_Z = 1.425
FULL_FIT_Z = 1.455
SHELL_MARGIN = 0.0008
HEAD_BLEND_START_Z = 1.39
HEAD_BLEND_END_Z = 1.46


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def smoothstep(value: float) -> float:
    value = min(1.0, max(0.0, value))
    return value * value * (3.0 - 2.0 * value)


def shell_distance(point, shell, shell_inverse, normal_matrix, bvh):
    nearest, normal, _, _ = bvh.find_nearest(shell_inverse @ point)
    if nearest is None or normal is None:
        return None
    nearest_world = shell.matrix_world @ nearest
    normal_world = (normal_matrix @ normal).normalized()
    return (point - nearest_world).dot(normal_world), normal_world


def stats(values: list[float]) -> dict[str, float | int]:
    if not values:
        return {"vertices": 0, "outsideVertices": 0, "minMm": 0.0, "maxMm": 0.0, "meanMm": 0.0}
    return {
        "vertices": len(values),
        "outsideVertices": sum(value > 0.0 for value in values),
        "minMm": round(min(values) * 1000.0, 3),
        "maxMm": round(max(values) * 1000.0, 3),
        "meanMm": round(sum(values) * 1000.0 / len(values), 3),
    }


def fit_head_affine() -> np.ndarray:
    scalp = bpy.data.collections.get("FEMALE_MUSCLE_SCALP")
    if scalp is None:
        raise RuntimeError("FEMALE_MUSCLE_SCALP missing")
    source_rows: list[list[float]] = []
    target_rows: list[list[float]] = []
    for female in scalp.all_objects:
        if female.type != "MESH" or "Epicranial aponeurosis" in female.name:
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
            source_rows.append([source_point.x, source_point.y, source_point.z, 1.0])
            target_rows.append([target_point.x, target_point.y, target_point.z])
    if not source_rows:
        raise RuntimeError("Cannot fit female head affine")
    return np.linalg.lstsq(np.asarray(source_rows), np.asarray(target_rows), rcond=None)[0]


def main() -> None:
    args = parse_args()
    source_blend = bpy.data.filepath
    shell_collection = bpy.data.collections.get("SHELL_V15")
    if shell_collection is None:
        raise RuntimeError("SHELL_V15 missing")
    shell = next((obj for obj in shell_collection.all_objects if obj.type == "MESH"), None)
    if shell is None:
        raise RuntimeError("Female shell mesh missing")

    bvh = BVHTree.FromObject(shell, bpy.context.evaluated_depsgraph_get())
    shell_inverse = shell.matrix_world.inverted()
    normal_matrix = shell.matrix_world.to_3x3().inverted().transposed()
    head_affine = fit_head_affine()
    records = []

    for name in PLATYSMA_NAMES:
        obj = bpy.data.objects.get(name)
        if obj is None or obj.type != "MESH":
            raise RuntimeError(f"Missing platysma mesh: {name}")
        inverse = obj.matrix_world.inverted()
        source_name = str(obj.get("sourceName") or name.removeprefix("FEMALE_EXTERNAL_NECK_"))
        source = bpy.data.objects.get(source_name)
        if source is None or source.type != "MESH" or len(source.data.vertices) != len(obj.data.vertices):
            raise RuntimeError(f"Missing corresponding source platysma: {source_name}")
        head_mapped = 0
        max_head_move = 0.0
        for index, vertex in enumerate(obj.data.vertices):
            current = obj.matrix_world @ vertex.co
            weight = smoothstep((current.z - HEAD_BLEND_START_Z) / (HEAD_BLEND_END_Z - HEAD_BLEND_START_Z))
            if weight <= 0.0:
                continue
            source_point = source.matrix_world @ source.data.vertices[index].co
            mapped = np.asarray([source_point.x, source_point.y, source_point.z, 1.0]) @ head_affine
            target = current.copy()
            target.x = float(mapped[0])
            target.y = float(mapped[1])
            target.z = float(mapped[2])
            displacement = (target - current) * weight
            if displacement.length > 0.05:
                continue
            vertex.co = inverse @ (current + displacement)
            head_mapped += 1
            max_head_move = max(max_head_move, displacement.length)
        obj.data.update()

        before_distances: list[float] = []
        moved = 0
        max_move = 0.0

        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            if point.z < BLEND_START_Z:
                continue
            result = shell_distance(point, shell, shell_inverse, normal_matrix, bvh)
            if result is None:
                continue
            signed_distance, normal_world = result
            before_distances.append(signed_distance)
            weight = smoothstep((point.z - BLEND_START_Z) / (FULL_FIT_Z - BLEND_START_Z))
            if signed_distance <= -SHELL_MARGIN or weight <= 0.0:
                continue
            displacement = normal_world * ((-SHELL_MARGIN - signed_distance) * weight)
            vertex.co = inverse @ (point + displacement)
            moved += 1
            max_move = max(max_move, displacement.length)

        obj.data.update()

        # The second pass makes the actual jaw band fully contained.  The lower
        # transition stays smoothly blended, so the neck and torso attachments
        # retain their approved v56 placement.
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            if point.z < FULL_FIT_Z:
                continue
            result = shell_distance(point, shell, shell_inverse, normal_matrix, bvh)
            if result is None:
                continue
            signed_distance, normal_world = result
            if signed_distance <= -SHELL_MARGIN:
                continue
            displacement = normal_world * (-SHELL_MARGIN - signed_distance)
            vertex.co = inverse @ (point + displacement)
            moved += 1
            max_move = max(max_move, displacement.length)
        obj.data.update()

        # White tendon caps at the upper platysma boundary read as exposed bone
        # in the layered viewer.  Keep the geometry and topology, but continue
        # the muscle material across only this jaw-contact band.
        recolored_faces = 0
        for polygon in obj.data.polygons:
            center = obj.matrix_world @ polygon.center
            if center.z >= FULL_FIT_Z and polygon.material_index != 0:
                polygon.material_index = 0
                recolored_faces += 1
        obj.data.update()

        after_distances: list[float] = []
        for vertex in obj.data.vertices:
            point = obj.matrix_world @ vertex.co
            if point.z < FULL_FIT_Z:
                continue
            result = shell_distance(point, shell, shell_inverse, normal_matrix, bvh)
            if result is not None:
                after_distances.append(result[0])
        obj["IEOBOM_jawWrapVersion"] = "v57"
        records.append(
            {
                "name": name,
                "headAffineMappedVertices": head_mapped,
                "maxHeadAffineMoveMm": round(max_head_move * 1000.0, 3),
                "movedVertices": moved,
                "maxMoveMm": round(max_move * 1000.0, 3),
                "recoloredUpperTendonFaces": recolored_faces,
                "beforeUpperRegion": stats(before_distances),
                "afterJawBand": stats(after_distances),
            }
        )

    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    bpy.context.scene["IEOBOM_V57_JAW_WRAP"] = json.dumps(
        {
            "objects": list(PLATYSMA_NAMES),
            "blendStartZ": BLEND_START_Z,
            "fullFitZ": FULL_FIT_Z,
            "shellMarginMm": SHELL_MARGIN * 1000.0,
            "headBlendZ": [HEAD_BLEND_START_Z, HEAD_BLEND_END_Z],
        }
    )
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output),
        "version": "v57-platysma-jaw-wrap",
        "shellMarginMm": SHELL_MARGIN * 1000.0,
        "records": records,
        "notes": [
            "Only the two platysma meshes were edited.",
            "Their upper vertices follow the verified same-model male-to-female head affine before containment.",
            "Upper platysma vertices were pulled beneath the existing female shell.",
            "The lower neck transition, skeleton, shell, hands, feet, and other muscles were unchanged.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V57_JAW_WRAP", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
