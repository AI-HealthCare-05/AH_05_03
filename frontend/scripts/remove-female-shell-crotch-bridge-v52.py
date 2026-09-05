"""Remove only stretched quad faces bridging the female shell crotch gap."""

from __future__ import annotations

import itertools
import json
import sys
from pathlib import Path

import bmesh
import bpy


SHELL_NAME = "IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"
VERSION = "v52-crotch-bridge-cleanup"
MIN_LONG_SPAN_METERS = 0.008
Z_MIN_METERS = 0.70
Z_MAX_METERS = 0.77


def main() -> None:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 2:
        raise SystemExit(
            "usage: blender -b SOURCE.blend --python SCRIPT -- OUTPUT.blend REPORT.json"
        )
    output_blend = Path(values[0]).resolve()
    report_path = Path(values[1]).resolve()
    source_blend = bpy.data.filepath

    shell = bpy.data.objects.get(SHELL_NAME)
    if shell is None or shell.type != "MESH":
        raise RuntimeError(f"Missing mesh: {SHELL_NAME}")
    if shell.modifiers:
        raise RuntimeError("Shell has unapplied modifiers; refusing an ambiguous cleanup")

    non_shell_signatures = {
        obj.name: (obj.type, len(obj.data.vertices) if obj.type == "MESH" else None)
        for obj in bpy.data.objects
        if obj != shell
    }
    matrix = shell.matrix_world
    world_points = [matrix @ vertex.co for vertex in shell.data.vertices]
    center_x = (
        min(point.x for point in world_points) + max(point.x for point in world_points)
    ) / 2

    mesh = bmesh.new()
    mesh.from_mesh(shell.data)
    mesh.verts.ensure_lookup_table()
    candidates = []
    for face in mesh.faces:
        points = [matrix @ vertex.co for vertex in face.verts]
        center_z = sum(point.z for point in points) / len(points)
        if not Z_MIN_METERS <= center_z <= Z_MAX_METERS:
            continue
        if not min(point.x for point in points) < center_x < max(point.x for point in points):
            continue
        maximum_span = max((a - b).length for a, b in itertools.combinations(points, 2))
        if maximum_span < MIN_LONG_SPAN_METERS:
            continue
        candidates.append((face, maximum_span, points))

    if not candidates:
        raise RuntimeError("No stretched crotch bridge faces matched the protected criteria")
    selected_vertices = [point for _, _, points in candidates for point in points]
    selected_report = {
        "faces": len(candidates),
        "maximumSpanMeters": max(span for _, span, _ in candidates),
        "bounds": {
            "minimum": [min(point[i] for point in selected_vertices) for i in range(3)],
            "maximum": [max(point[i] for point in selected_vertices) for i in range(3)],
        },
    }
    bmesh.ops.delete(mesh, geom=[face for face, _, _ in candidates], context="FACES")
    isolated = [vertex for vertex in mesh.verts if not vertex.link_faces]
    if isolated:
        bmesh.ops.delete(mesh, geom=isolated, context="VERTS")
    bmesh.ops.recalc_face_normals(mesh, faces=mesh.faces)
    mesh.to_mesh(shell.data)
    mesh.free()
    shell.data.update()

    changed_non_shell = []
    for name, signature in non_shell_signatures.items():
        obj = bpy.data.objects.get(name)
        current = None if obj is None else (
            obj.type,
            len(obj.data.vertices) if obj.type == "MESH" else None,
        )
        if current != signature:
            changed_non_shell.append({"name": name, "before": signature, "after": current})
    if changed_non_shell:
        raise RuntimeError(f"Non-shell objects changed: {changed_non_shell[:10]}")

    face_sizes: dict[str, int] = {}
    for face in shell.data.polygons:
        size = len(face.vertices)
        face_sizes[str(size)] = face_sizes.get(str(size), 0) + 1
    shell["IEOBOM_webShellVersion"] = VERSION
    shell["IEOBOM_previousWebShellVersion"] = "v51-uniform-quad-flow"
    shell["IEOBOM_v52RemovedCrotchBridgeFaces"] = len(candidates)
    shell["IEOBOM_v52MinimumRemovedSpanMeters"] = MIN_LONG_SPAN_METERS
    shell["IEOBOM_v52EditScope"] = "stretched center-crossing crotch faces only"

    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output_blend),
        "version": VERSION,
        "criteria": {
            "centerX": center_x,
            "zMeters": [Z_MIN_METERS, Z_MAX_METERS],
            "minimumLongSpanMeters": MIN_LONG_SPAN_METERS,
            "mustCrossCenterX": True,
        },
        "removed": selected_report,
        "after": {
            "vertices": len(shell.data.vertices),
            "faces": len(shell.data.polygons),
            "faceSizes": face_sizes,
        },
        "nonShellObjectsChanged": changed_non_shell,
    }
    output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V52_REPORT", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
