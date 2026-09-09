"""Render before/after female craniofacial muscle alignment against one skeleton."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--before", required=True)
    parser.add_argument("--after", required=True)
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(values)


def import_glb(path: Path, prefix: str) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    imported = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    for obj in imported:
        obj.name = f"{prefix}__{obj.name}"
    return imported


def world_bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    return value


def set_material(objects: list[bpy.types.Object], value: bpy.types.Material) -> None:
    for obj in objects:
        obj.data.materials.clear()
        obj.data.materials.append(value)
        obj.color = value.diffuse_color


def render_version(
    scene: bpy.types.Scene,
    camera: bpy.types.Object,
    skeleton: list[bpy.types.Object],
    active_muscles: list[bpy.types.Object],
    inactive_muscles: list[bpy.types.Object],
    output_dir: Path,
    label: str,
) -> None:
    for obj in inactive_muscles:
        obj.hide_render = True
    for obj in skeleton + active_muscles:
        obj.hide_render = False

    head_objects = [obj for obj in skeleton + active_muscles if (world_bounds([obj])[1].z >= 1.43)]
    low, high = world_bounds(head_objects)
    center = (low + high) * 0.5
    # Crop to cranium, face and upper neck so eye sockets and mandible are readable.
    center.z = 1.565
    camera.data.type = "ORTHO"
    camera.data.ortho_scale = 0.38

    views = {
        "front": Vector((center.x, center.y - 4.0, center.z)),
        "left": Vector((center.x - 4.0, center.y, center.z)),
        "rear": Vector((center.x, center.y + 4.0, center.z)),
        "top": Vector((center.x, center.y, center.z + 4.0)),
        "three-quarter": Vector((center.x - 3.0, center.y - 3.0, center.z)),
    }
    for view, location in views.items():
        camera.location = location
        look_at(camera, center)
        scene.render.filepath = str(output_dir / f"{label}-{view}.png")
        bpy.ops.render.render(write_still=True)


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)

    skeleton = import_glb(Path(args.skeleton).resolve(), "SKELETON")
    before = import_glb(Path(args.before).resolve(), "BEFORE")
    after = import_glb(Path(args.after).resolve(), "AFTER")
    if not skeleton or not before or not after:
        raise RuntimeError("Skeleton, before muscles, and after muscles must all contain meshes")

    bone_material = material("IEOBOM_QA_BONE", (0.58, 0.72, 0.76, 1.0))
    muscle_material = material("IEOBOM_QA_MUSCLE", (0.48, 0.16, 0.10, 1.0))
    aponeurosis_material = material("IEOBOM_QA_APONEUROSIS", (0.82, 0.55, 0.06, 1.0))
    set_material(skeleton, bone_material)
    set_material(before + after, muscle_material)
    set_material(
        [obj for obj in before + after if "epicranial aponeurosis" in obj.name.lower()],
        aponeurosis_material,
    )

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 800
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.curvature_ridge_factor = 1.5
    scene.display.shading.curvature_valley_factor = 1.0
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.012, 0.025, 0.035)

    camera_data = bpy.data.cameras.new("IEOBOM_HEAD_QA_CAMERA")
    camera = bpy.data.objects.new("IEOBOM_HEAD_QA_CAMERA", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    render_version(scene, camera, skeleton, before, after, output_dir, "before-v3")
    render_version(scene, camera, skeleton, after, before, output_dir, "after-v53")


if __name__ == "__main__":
    main()
