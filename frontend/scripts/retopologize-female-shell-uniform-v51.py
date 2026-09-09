"""Build the female v51 shell with one uniform quad-flow density.

The source shell is voxel-remeshed uniformly and then projected back onto the
original surface.  No hand, fingertip, foot, or toe density exception is used.
The skeleton and every non-shell object are left untouched in the versioned
Blend copy.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bmesh
import bpy


SHELL_NAME = "IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"
VOXEL_SIZE_METERS = 0.0032
VERSION = "v51-uniform-quad-flow"


def topology(mesh: bpy.types.Mesh) -> dict[str, object]:
    face_sizes: dict[str, int] = {}
    triangle_equivalent = 0
    for polygon in mesh.polygons:
        size = len(polygon.vertices)
        face_sizes[str(size)] = face_sizes.get(str(size), 0) + 1
        triangle_equivalent += max(1, size - 2)
    return {
        "vertices": len(mesh.vertices),
        "edges": len(mesh.edges),
        "faces": len(mesh.polygons),
        "faceSizes": face_sizes,
        "triangleEquivalent": triangle_equivalent,
    }


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
        raise RuntimeError("Shell has unapplied modifiers; refusing an ambiguous retopology")

    before = topology(shell.data)
    non_shell_signatures = {
        obj.name: (obj.type, len(obj.data.vertices) if obj.type == "MESH" else None)
        for obj in bpy.data.objects
        if obj != shell
    }

    bpy.ops.object.select_all(action="DESELECT")
    shell.hide_set(False)
    shell.hide_viewport = False
    shell.select_set(True)
    bpy.context.view_layer.objects.active = shell

    reference = shell.copy()
    reference.data = shell.data.copy()
    reference.name = "IEOBOM_FEMALE_SHELL_V51_SURFACE_REFERENCE"
    bpy.context.scene.collection.objects.link(reference)
    reference.hide_render = True

    repair = bmesh.new()
    repair.from_mesh(shell.data)
    boundary_edges_before = sum(1 for edge in repair.edges if edge.is_boundary)
    non_manifold_edges_before = sum(1 for edge in repair.edges if not edge.is_manifold)
    boundary_edges = [edge for edge in repair.edges if edge.is_boundary]
    if boundary_edges:
        bmesh.ops.holes_fill(repair, edges=boundary_edges, sides=0)
    bmesh.ops.recalc_face_normals(repair, faces=repair.faces)
    repair.to_mesh(shell.data)
    repair.free()
    shell.data.update()

    shell.data.remesh_voxel_size = VOXEL_SIZE_METERS
    shell.data.remesh_voxel_adaptivity = 0.0
    shell.data.use_remesh_preserve_volume = True
    shell.data.use_remesh_preserve_attributes = False
    bpy.ops.object.voxel_remesh()
    voxel_pass = topology(shell.data)

    shrinkwrap = shell.modifiers.new(name="IEOBOM_FEMALE_SHELL_V51_SURFACE_REPROJECT", type="SHRINKWRAP")
    shrinkwrap.wrap_method = "NEAREST_SURFACEPOINT"
    shrinkwrap.wrap_mode = "ON_SURFACE"
    shrinkwrap.target = reference
    bpy.ops.object.modifier_apply(modifier=shrinkwrap.name)

    final_mesh = bmesh.new()
    final_mesh.from_mesh(shell.data)
    bmesh.ops.recalc_face_normals(final_mesh, faces=final_mesh.faces)
    final_mesh.to_mesh(shell.data)
    final_mesh.free()
    shell.data.update()

    reference_mesh = reference.data
    bpy.data.objects.remove(reference, do_unlink=True)
    if reference_mesh.users == 0:
        bpy.data.meshes.remove(reference_mesh)

    after = topology(shell.data)
    if after["faceSizes"].get("4", 0) / after["faces"] < 0.98:
        raise RuntimeError(f"Result is not quad-dominant: {after['faceSizes']}")

    changed_non_shell = []
    for name, signature in non_shell_signatures.items():
        obj = bpy.data.objects.get(name)
        current = (
            None
            if obj is None
            else (
                obj.type,
                len(obj.data.vertices) if obj.type == "MESH" else None,
            )
        )
        if current != signature:
            changed_non_shell.append({"name": name, "before": signature, "after": current})
    if changed_non_shell:
        raise RuntimeError(f"Non-shell objects changed: {changed_non_shell[:10]}")

    shell["IEOBOM_webShellVersion"] = VERSION
    shell["IEOBOM_previousWebShellVersion"] = "v47"
    shell["IEOBOM_v51VoxelSizeMeters"] = VOXEL_SIZE_METERS
    shell["IEOBOM_v51UniformDensity"] = True
    shell["IEOBOM_v51DistalDensityException"] = False
    shell["IEOBOM_v51TopologyNote"] = "Uniform voxel quad flow over the complete shell; no distal subdivision"

    output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))
    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output_blend),
        "version": VERSION,
        "uniformDensity": True,
        "distalDensityException": False,
        "voxelSizeMeters": VOXEL_SIZE_METERS,
        "before": before,
        "repair": {
            "boundaryEdgesBefore": boundary_edges_before,
            "nonManifoldEdgesBefore": non_manifold_edges_before,
        },
        "voxelPass": voxel_pass,
        "after": after,
        "nonShellObjectsChanged": changed_non_shell,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V51_REPORT", json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
