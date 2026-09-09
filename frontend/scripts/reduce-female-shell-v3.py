"""Create the versioned female web shell v3 at male-like visual density.

The v2 shell already contains a 3x distal hand/foot density bias. Applying one
uniform reduction pass preserves that relative bias while bringing the whole
surface close to the male shell's visible wire density.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


SHELL_NAME = "IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"
TARGET_TRIANGLES = 160_000


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
        raise RuntimeError("Shell is already below the v3 triangle target")

    bpy.context.view_layer.objects.active = shell
    shell.hide_set(False)
    shell.hide_viewport = False
    shell.select_set(True)
    modifier = shell.modifiers.new(name="IEOBOM_WEB_SHELL_V3_DECIMATE", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    shell.select_set(False)

    after_vertices = len(shell.data.vertices)
    after_triangles = len(shell.data.polygons)
    shell["IEOBOM_webShellVersion"] = "v3"
    shell["IEOBOM_previousWebShellVersion"] = "v2"
    shell["IEOBOM_v2Vertices"] = before_vertices
    shell["IEOBOM_v2Triangles"] = before_triangles
    shell["IEOBOM_v3TargetTriangles"] = TARGET_TRIANGLES
    shell["IEOBOM_v3Vertices"] = after_vertices
    shell["IEOBOM_v3Triangles"] = after_triangles
    shell["IEOBOM_v3InheritedDistalDensityMultiplier"] = 3.0
    shell["IEOBOM_v3ReductionNote"] = (
        "Uniform v2-to-v3 pass; inherited fingertip/toe-tip density bias remains 3x relative to body"
    )

    report = {
        "sourceBlend": bpy.data.filepath,
        "version": "v3",
        "previousVersion": "v2",
        "targetTriangles": TARGET_TRIANGLES,
        "before": {"vertices": before_vertices, "triangles": before_triangles},
        "after": {"vertices": after_vertices, "triangles": after_triangles},
        "inheritedDistalDensityMultiplier": 3.0,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
