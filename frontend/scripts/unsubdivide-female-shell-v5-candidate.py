"""Recover a coarse quad-like flow from the original triangulated female shell.

Three Un-Subdivide iterations should reduce a subdivision-derived surface by
roughly 4^3 while dissolving alternating diagonal edges. The source Blend is
opened read-only and the result is saved to a separate candidate file.
"""

from __future__ import annotations

import json
import math
import sys
from pathlib import Path

import bpy


SHELL_NAME = "IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"
ITERATIONS = 3


def main() -> None:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 2:
        raise SystemExit("usage: blender -b SOURCE.blend --python SCRIPT -- OUTPUT.blend REPORT.json")
    output_blend = Path(values[0]).resolve()
    report_path = Path(values[1]).resolve()
    source_blend = bpy.data.filepath

    shell = bpy.data.objects.get(SHELL_NAME)
    if shell is None or shell.type != "MESH":
        raise RuntimeError(f"Missing mesh: {SHELL_NAME}")
    if shell.modifiers:
        raise RuntimeError("Shell has unapplied modifiers; refusing an ambiguous reduction")

    before = {
        "vertices": len(shell.data.vertices),
        "edges": len(shell.data.edges),
        "faces": len(shell.data.polygons),
    }
    bpy.ops.object.select_all(action="DESELECT")
    shell.hide_set(False)
    shell.hide_viewport = False
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.mode_set(mode="EDIT")
    bpy.ops.mesh.select_all(action="SELECT")
    bpy.ops.mesh.tris_convert_to_quads(
        face_threshold=math.pi,
        shape_threshold=math.pi,
        uvs=False,
        vcols=False,
        sharp=False,
        materials=False,
    )
    bpy.ops.object.mode_set(mode="OBJECT")
    paired_face_sizes: dict[str, int] = {}
    for polygon in shell.data.polygons:
        size = len(polygon.vertices)
        paired_face_sizes[str(size)] = paired_face_sizes.get(str(size), 0) + 1
    paired = {
        "vertices": len(shell.data.vertices),
        "edges": len(shell.data.edges),
        "faces": len(shell.data.polygons),
        "faceSizes": paired_face_sizes,
    }
    modifier = shell.modifiers.new(name="IEOBOM_WEB_SHELL_V5_UNSUBDIVIDE", type="DECIMATE")
    modifier.decimate_type = "UNSUBDIV"
    modifier.iterations = ITERATIONS
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    shell.select_set(False)

    face_sizes: dict[str, int] = {}
    triangle_equivalent = 0
    for polygon in shell.data.polygons:
        size = len(polygon.vertices)
        face_sizes[str(size)] = face_sizes.get(str(size), 0) + 1
        triangle_equivalent += max(1, size - 2)

    after = {
        "vertices": len(shell.data.vertices),
        "edges": len(shell.data.edges),
        "faces": len(shell.data.polygons),
        "faceSizes": face_sizes,
        "triangleEquivalent": triangle_equivalent,
    }
    shell["IEOBOM_webShellVersion"] = "v5-unsubdivide-candidate"
    shell["IEOBOM_previousWebShellVersion"] = "v4"
    shell["IEOBOM_v5UnsubdivideIterations"] = ITERATIONS
    shell["IEOBOM_v5TriangleEquivalent"] = triangle_equivalent
    shell["IEOBOM_v5TopologyNote"] = "Recovered alternating-edge flow from original triangulation"

    output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))
    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output_blend),
        "version": "v5-unsubdivide-candidate",
        "iterations": ITERATIONS,
        "before": before,
        "paired": paired,
        "after": after,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
