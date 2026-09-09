"""Create a uniformly decimated female web shell from the untouched source.

Unlike v2/v4, this pass does not create or reference a vertex group. Hands,
fingertips, feet, and toe tips therefore receive exactly the same collapse
policy as the rest of the body.
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


SHELL_NAME = "IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"
DEFAULT_TARGET_TRIANGLES = 60_000


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-blend", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--target-triangles", type=int, default=DEFAULT_TARGET_TRIANGLES)
    return parser.parse_args(values)


def triangle_count(mesh: bpy.types.Mesh) -> int:
    return sum(len(polygon.vertices) - 2 for polygon in mesh.polygons)


def main() -> None:
    args = parse_args()
    output_blend = Path(args.output_blend).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    source_blend = str(Path(bpy.data.filepath).resolve())

    shell = bpy.data.objects.get(SHELL_NAME)
    if shell is None or shell.type != "MESH":
        raise RuntimeError(f"Missing mesh: {SHELL_NAME}")
    if shell.modifiers:
        raise RuntimeError("Shell has unapplied modifiers; refusing an ambiguous reduction")
    if shell.vertex_groups:
        raise RuntimeError(
            "Source shell has vertex groups; use the untouched pre-decimation source "
            "so no distal density bias can be inherited"
        )

    before_vertices = len(shell.data.vertices)
    before_triangles = triangle_count(shell.data)
    if args.target_triangles <= 0 or args.target_triangles >= before_triangles:
        raise RuntimeError(f"Target must be between 1 and {before_triangles - 1}; got {args.target_triangles}")

    ratio = args.target_triangles / before_triangles
    bpy.ops.object.select_all(action="DESELECT")
    bpy.context.view_layer.objects.active = shell
    shell.hide_set(False)
    shell.hide_viewport = False
    shell.select_set(True)
    modifier = shell.modifiers.new(name="IEOBOM_WEB_SHELL_V41_UNIFORM_DECIMATE", type="DECIMATE")
    modifier.decimate_type = "COLLAPSE"
    modifier.ratio = ratio
    modifier.use_collapse_triangulate = True
    bpy.ops.object.modifier_apply(modifier=modifier.name)
    shell.select_set(False)

    after_vertices = len(shell.data.vertices)
    after_triangles = triangle_count(shell.data)
    shell["IEOBOM_webShellVersion"] = "v41-uniform"
    shell["IEOBOM_v41TargetTriangles"] = args.target_triangles
    shell["IEOBOM_v41Vertices"] = after_vertices
    shell["IEOBOM_v41Triangles"] = after_triangles
    shell["IEOBOM_v41DistalDensityMultiplier"] = 1.0
    shell["IEOBOM_v41ReductionNote"] = (
        "Direct uniform collapse from untouched high-density shell; no hand, fingertip, "
        "foot, or toe-tip vertex-group weighting"
    )

    output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))

    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output_blend),
        "version": "v41-uniform",
        "targetTriangles": args.target_triangles,
        "before": {"vertices": before_vertices, "triangles": before_triangles},
        "after": {"vertices": after_vertices, "triangles": after_triangles},
        "modifier": {
            "type": "DECIMATE",
            "decimateType": "COLLAPSE",
            "ratio": ratio,
            "triangulate": True,
            "vertexGroup": None,
            "distalDensityMultiplier": 1.0,
        },
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
