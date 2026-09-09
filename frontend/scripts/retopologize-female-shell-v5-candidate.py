"""Build a non-destructive quad-retopology candidate from the v4 female shell.

The candidate remains quad-dominant in Blender. glTF export triangulates each
quad along a diagonal, producing the regular woven wire pattern used by the
male atlas instead of Decimate's irregular triangle field.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy
import bmesh


SHELL_NAME = "IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"
TARGET_QUADS = 30_000
VOXEL_SIZE_METERS = 0.005


def main() -> None:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 2:
        raise SystemExit("usage: blender -b SOURCE.blend --python SCRIPT -- OUTPUT.blend REPORT.json")
    output_blend = Path(values[0]).resolve()
    report_path = Path(values[1]).resolve()

    shell = bpy.data.objects.get(SHELL_NAME)
    if shell is None or shell.type != "MESH":
        raise RuntimeError(f"Missing mesh: {SHELL_NAME}")
    if shell.modifiers:
        raise RuntimeError("Shell has unapplied modifiers; refusing an ambiguous retopology")

    before = {
        "vertices": len(shell.data.vertices),
        "edges": len(shell.data.edges),
        "faces": len(shell.data.polygons),
    }
    bpy.context.view_layer.objects.active = shell
    shell.select_set(True)
    reference = shell.copy()
    reference.data = shell.data.copy()
    reference.name = "IEOBOM_FEMALE_SHELL_V5_SHRINKWRAP_REFERENCE"
    bpy.context.scene.collection.objects.link(reference)
    reference.hide_render = True
    repair_mesh = bmesh.new()
    repair_mesh.from_mesh(shell.data)
    boundary_edges = [edge for edge in repair_mesh.edges if edge.is_boundary]
    non_manifold_edges = [edge for edge in repair_mesh.edges if not edge.is_manifold]
    if boundary_edges:
        bmesh.ops.holes_fill(repair_mesh, edges=boundary_edges, sides=0)
    bmesh.ops.recalc_face_normals(repair_mesh, faces=repair_mesh.faces)
    repair_mesh.to_mesh(shell.data)
    repair_mesh.free()
    shell.data.update()
    verify_mesh = bmesh.new()
    verify_mesh.from_mesh(shell.data)
    repaired_topology = {
        "boundaryEdges": sum(1 for edge in verify_mesh.edges if edge.is_boundary),
        "nonManifoldEdges": sum(1 for edge in verify_mesh.edges if not edge.is_manifold),
        "nonManifoldVertices": sum(1 for vertex in verify_mesh.verts if not vertex.is_manifold),
    }
    verify_mesh.free()
    visited: set[int] = set()
    adjacency: list[list[int]] = [[] for _ in shell.data.vertices]
    for edge in shell.data.edges:
        left, right = edge.vertices
        adjacency[left].append(right)
        adjacency[right].append(left)
    component_sizes: list[int] = []
    for vertex in shell.data.vertices:
        if vertex.index in visited:
            continue
        stack = [vertex.index]
        visited.add(vertex.index)
        size = 0
        while stack:
            current = stack.pop()
            size += 1
            for neighbor in adjacency[current]:
                if neighbor not in visited:
                    visited.add(neighbor)
                    stack.append(neighbor)
        component_sizes.append(size)
    component_sizes.sort(reverse=True)
    print("IEOBOM_TOPOLOGY", json.dumps({"components": component_sizes, **repaired_topology}))
    shell.data.remesh_voxel_size = VOXEL_SIZE_METERS
    shell.data.remesh_voxel_adaptivity = 0.0
    shell.data.use_remesh_preserve_volume = True
    shell.data.use_remesh_preserve_attributes = False
    bpy.ops.object.voxel_remesh()
    voxel_pass = {
        "vertices": len(shell.data.vertices),
        "edges": len(shell.data.edges),
        "faces": len(shell.data.polygons),
    }
    print("IEOBOM_VOXEL_PASS", json.dumps(voxel_pass))
    shrinkwrap = shell.modifiers.new(name="IEOBOM_WEB_SHELL_V5_SURFACE_REPROJECT", type="SHRINKWRAP")
    shrinkwrap.wrap_method = "NEAREST_SURFACEPOINT"
    shrinkwrap.wrap_mode = "ON_SURFACE"
    shrinkwrap.target = reference
    bpy.context.view_layer.objects.active = shell
    bpy.ops.object.modifier_apply(modifier=shrinkwrap.name)

    distal_mesh = bmesh.new()
    distal_mesh.from_mesh(shell.data)
    min_z = min(vertex.co.z for vertex in distal_mesh.verts)
    max_z = max(vertex.co.z for vertex in distal_mesh.verts)
    max_abs_x = max(abs(vertex.co.x) for vertex in distal_mesh.verts)
    height = max_z - min_z
    distal_faces = [
        face
        for face in distal_mesh.faces
        if abs(face.calc_center_median().x) >= max_abs_x * 0.86
        or (face.calc_center_median().z - min_z) / height <= 0.045
    ]
    distal_edges = {edge for face in distal_faces for edge in face.edges}
    if distal_edges:
        bmesh.ops.subdivide_edges(
            distal_mesh,
            edges=list(distal_edges),
            cuts=1,
            use_grid_fill=True,
        )
    distal_mesh.to_mesh(shell.data)
    distal_mesh.free()
    shell.data.update()
    distal_refit = shell.modifiers.new(name="IEOBOM_WEB_SHELL_V5_DISTAL_REFIT", type="SHRINKWRAP")
    distal_refit.wrap_method = "NEAREST_SURFACEPOINT"
    distal_refit.wrap_mode = "ON_SURFACE"
    distal_refit.target = reference
    bpy.ops.object.modifier_apply(modifier=distal_refit.name)
    reference_mesh = reference.data
    bpy.data.objects.remove(reference, do_unlink=True)
    if reference_mesh.users == 0:
        bpy.data.meshes.remove(reference_mesh)

    face_sizes: dict[str, int] = {}
    triangle_equivalent = 0
    for polygon in shell.data.polygons:
        size = len(polygon.vertices)
        face_sizes[str(size)] = face_sizes.get(str(size), 0) + 1
        triangle_equivalent += max(1, size - 2)

    shell["IEOBOM_webShellVersion"] = "v5-quad-candidate"
    shell["IEOBOM_previousWebShellVersion"] = "v4"
    shell["IEOBOM_v5TargetQuads"] = TARGET_QUADS
    shell["IEOBOM_v5TriangleEquivalent"] = triangle_equivalent
    shell["IEOBOM_v5DistalMinimumDensityMultiplier"] = 3.0
    shell["IEOBOM_v5DistalSubdivisionFaceCountBefore"] = len(distal_faces)
    shell["IEOBOM_v5TopologyNote"] = "Voxel quads reprojected to source; glTF diagonally triangulates faces"

    output_blend.parent.mkdir(parents=True, exist_ok=True)
    bpy.ops.wm.save_as_mainfile(filepath=str(output_blend))
    report = {
        "sourceBlend": values[0],
        "outputBlend": str(output_blend),
        "version": "v5-quad-candidate",
        "targetQuads": TARGET_QUADS,
        "before": before,
        "repair": {
            "boundaryEdges": len(boundary_edges),
            "nonManifoldEdges": len(non_manifold_edges),
            "operation": "fill boundary holes and recalculate face normals",
        },
        "voxelPass": {"voxelSizeMeters": VOXEL_SIZE_METERS, **voxel_pass},
        "distalSubdivision": {
            "requestedMinimumDensityMultiplier": 3.0,
            "quadSubdivisionDensityMultiplier": 4.0,
            "facesBeforeSubdivision": len(distal_faces),
            "selection": "outermost 14% hand region and lowest 4.5% foot/toe region",
        },
        "after": {
            "vertices": len(shell.data.vertices),
            "edges": len(shell.data.edges),
            "faces": len(shell.data.polygons),
            "faceSizes": face_sizes,
            "triangleEquivalent": triangle_equivalent,
        },
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
