"""Inspect and render a versioned female shell without modifying project assets."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--glb", required=True)
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--label", required=True)
    return parser.parse_args(values)


def point_camera(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_view(
    scene: bpy.types.Scene,
    camera: bpy.types.Object,
    center: Vector,
    width: float,
    height: float,
    output: Path,
) -> None:
    camera.location = Vector((center.x, center.y - 4.0, center.z))
    point_camera(camera, center)
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = max(height * 1.08, width * 1.35)
    scene.render.filepath = str(output)
    bpy.ops.render.render(write_still=True)


def main() -> None:
    args = parse_args()
    glb = Path(args.glb).resolve()
    output_dir = Path(args.output_dir).resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(glb))
    meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]
    if not meshes:
        raise RuntimeError("GLB contains no meshes")

    vertices = sum(len(obj.data.vertices) for obj in meshes)
    polygons = sum(len(obj.data.polygons) for obj in meshes)
    triangle_equivalent = sum(max(1, len(polygon.vertices) - 2) for obj in meshes for polygon in obj.data.polygons)
    boundary_edges = 0
    non_manifold_edges = 0
    for obj in meshes:
        mesh = bmesh.new()
        mesh.from_mesh(obj.data)
        boundary_edges += sum(1 for edge in mesh.edges if edge.is_boundary)
        non_manifold_edges += sum(1 for edge in mesh.edges if not edge.is_manifold)
        mesh.free()

    world_points = [obj.matrix_world @ vertex.co for obj in meshes for vertex in obj.data.vertices]
    minimum = Vector(tuple(min(point[index] for point in world_points) for index in range(3)))
    maximum = Vector(tuple(max(point[index] for point in world_points) for index in range(3)))
    size = maximum - minimum

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 700
    scene.render.resolution_y = 1000
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "SINGLE"
    scene.display.shading.single_color = (0.08, 0.72, 0.9)
    for obj in meshes:
        obj.show_wire = True
        obj.show_all_edges = True
        obj.color = (0.08, 0.72, 0.9, 1.0)
    scene.display.shading.show_shadows = False
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.curvature_ridge_factor = 1.5
    scene.display.shading.curvature_valley_factor = 1.0
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.003, 0.025, 0.04)

    bpy.ops.object.camera_add()
    camera = bpy.context.object
    scene.camera = camera
    body_center = (minimum + maximum) * 0.5
    render_view(scene, camera, body_center, size.x, size.z, output_dir / f"{args.label}-full.png")

    hand_center = Vector((maximum.x - size.x * 0.06, body_center.y, minimum.z + size.z * 0.43))
    render_view(scene, camera, hand_center, size.x * 0.22, size.z * 0.24, output_dir / f"{args.label}-right-hand.png")

    feet_center = Vector((body_center.x, body_center.y, minimum.z + size.z * 0.07))
    render_view(scene, camera, feet_center, size.x * 0.55, size.z * 0.18, output_dir / f"{args.label}-feet.png")

    crotch_center = Vector((body_center.x, body_center.y, minimum.z + size.z * 0.43))
    render_view(scene, camera, crotch_center, size.x * 0.34, size.z * 0.18, output_dir / f"{args.label}-crotch.png")

    report = {
        "label": args.label,
        "file": str(glb),
        "bytes": glb.stat().st_size,
        "meshObjects": len(meshes),
        "vertices": vertices,
        "polygons": polygons,
        "triangleEquivalent": triangle_equivalent,
        "boundaryEdges": boundary_edges,
        "nonManifoldEdges": non_manifold_edges,
        "bounds": {"minimum": list(minimum), "maximum": list(maximum)},
    }
    (output_dir / f"{args.label}-audit.json").write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
