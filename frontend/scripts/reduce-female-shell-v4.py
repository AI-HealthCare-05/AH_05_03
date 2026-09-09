"""Create female web shell v4 with visibly coarser body topology.

The v3 shell is still much denser than the male atlas on the torso and legs.
This pass targets about 60k triangles while weighting the outermost hand and
foot vertices 3x during collapse so fingertip and toe-tip silhouettes retain
more geometry than the rest of the body.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


SHELL_NAME = "IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"
TARGET_TRIANGLES = 60_000
DISTAL_DENSITY_MULTIPLIER = 3.0
PROTECTION_GROUP = "IEOBOM_WEB_V4_DISTAL_3X"


def main() -> None:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 1:
        raise SystemExit("usage: blender -b FILE --python SCRIPT -- REPORT.json")
    report_path = Path(values[0]).resolve()

    shell = bpy.data.objects.get(SHELL_NAME)
    if shell is None or shell.type != "MESH":
        raise RuntimeError(f"Missing mesh: {SHELL_NAME}")
    if shell.modifiers:
        raise RuntimeError("Shell has unapplied modifiers; refusing an ambiguous reduction")

    before_vertices = len(shell.data.vertices)
    before_triangles = len(shell.data.polygons)
    ratio = min(1.0, TARGET_TRIANGLES / before_triangles)
    if ratio >= 1.0:
        raise RuntimeError("Shell is already below the v4 triangle target")

    coordinates = [vertex.co for vertex in shell.data.vertices]
    min_z = min(co.z for co in coordinates)
    max_z = max(co.z for co in coordinates)
    max_abs_x = max(abs(co.x) for co in coordinates)
    height = max_z - min_z

    # With the authored A-pose, the lateral-most 14% contains the fingertips.
    # The lowest 4.5% contains feet and toe tips. A soft transition band avoids
    # a visible topology seam where protected and ordinary regions meet.
    distal_weights: list[tuple[int, float]] = []
    for vertex in shell.data.vertices:
        co = vertex.co
        lateral = abs(co.x) / max_abs_x
        low = (co.z - min_z) / height
        hand_weight = max(0.0, min(1.0, (lateral - 0.78) / 0.08))
        foot_weight = max(0.0, min(1.0, (0.075 - low) / 0.03))
        weight = max(hand_weight, foot_weight)
        if weight > 0.0:
            distal_weights.append((vertex.index, weight))

    old_group = shell.vertex_groups.get(PROTECTION_GROUP)
    if old_group is not None:
        shell.vertex_groups.remove(old_group)
    group = shell.vertex_groups.new(name=PROTECTION_GROUP)
    for vertex_index, weight in distal_weights:
        group.add([vertex_index], weight, "REPLACE")

    bpy.context.view_layer.objects.active = shell
    shell.hide_set(False)
    shell.hide_viewport = False
    shell.select_set(True)
    modifier = shell.modifiers.new(name="IEOBOM_WEB_SHELL_V4_DECIMATE", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    modifier.vertex_group = group.name
    modifier.vertex_group_factor = DISTAL_DENSITY_MULTIPLIER
    bpy.ops.object.modifier_apply(modifier=modifier.name)

    protected_pass_vertices = len(shell.data.vertices)
    protected_pass_triangles = len(shell.data.polygons)
    if protected_pass_triangles > TARGET_TRIANGLES:
        # Weighted collapse intentionally retains extra distal topology. Finish
        # uniformly so the 3x relative bias baked by the first pass remains,
        # while the web asset reaches the requested total budget.
        finish = shell.modifiers.new(name="IEOBOM_WEB_SHELL_V4_TARGET_FINISH", type="DECIMATE")
        finish.decimate_type = "COLLAPSE"
        finish.ratio = TARGET_TRIANGLES / protected_pass_triangles
        finish.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=finish.name)
    shell.select_set(False)

    after_vertices = len(shell.data.vertices)
    after_triangles = len(shell.data.polygons)
    shell["IEOBOM_webShellVersion"] = "v4"
    shell["IEOBOM_previousWebShellVersion"] = "v3"
    shell["IEOBOM_v3Vertices"] = before_vertices
    shell["IEOBOM_v3Triangles"] = before_triangles
    shell["IEOBOM_v4TargetTriangles"] = TARGET_TRIANGLES
    shell["IEOBOM_v4Vertices"] = after_vertices
    shell["IEOBOM_v4Triangles"] = after_triangles
    shell["IEOBOM_v4DistalDensityMultiplier"] = DISTAL_DENSITY_MULTIPLIER
    shell["IEOBOM_v4ProtectedVertexCountBefore"] = len(distal_weights)
    shell["IEOBOM_v4ReductionNote"] = (
        "Body reduced toward 60k triangles; lateral hand and low foot/toe regions weighted 3x"
    )

    report = {
        "sourceBlend": bpy.data.filepath,
        "version": "v4",
        "previousVersion": "v3",
        "targetTriangles": TARGET_TRIANGLES,
        "before": {"vertices": before_vertices, "triangles": before_triangles},
        "protectedPass": {
            "vertices": protected_pass_vertices,
            "triangles": protected_pass_triangles,
        },
        "after": {"vertices": after_vertices, "triangles": after_triangles},
        "distalDensityMultiplier": DISTAL_DENSITY_MULTIPLIER,
        "protectedVertexCountBefore": len(distal_weights),
        "protectionRule": {
            "hand": "outermost 22%, full weight at outermost 14%",
            "foot": "lowest 7.5%, full weight at lowest 4.5%",
        },
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
