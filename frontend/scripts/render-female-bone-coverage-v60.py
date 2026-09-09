"""Render v60 bone coverage with the approved female skeleton visible."""

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
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--collection", default="FEMALE_BONE_COVERAGE_V60")
    parser.add_argument("--prefix", default="v60")
    parser.add_argument("--views", default="")
    return parser.parse_args(values)


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def import_glb(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.roughness = 0.9
    return value


def apply_material(objects: list[bpy.types.Object], value: bpy.types.Material) -> None:
    for obj in objects:
        obj.hide_render = False
        obj.data.materials.clear()
        obj.data.materials.append(value)


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    work = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    patches = None if args.collection == "NONE" else bpy.data.collections.get(args.collection)
    if work is None or (args.collection != "NONE" and patches is None):
        raise RuntimeError(f"coverage collection is missing: {args.collection}")
    all_patch_objects = {obj for obj in recursive_objects(patches) if obj.type == "MESH"} if patches else set()
    muscles = [
        obj
        for obj in recursive_objects(work)
        if obj.type == "MESH"
        and obj.data.polygons
        and obj not in all_patch_objects
        and not bool(obj.get("IEOBOM_webExclude"))
    ]
    patch_objects = [obj for obj in all_patch_objects if obj.data.polygons]
    skeleton = import_glb(Path(args.skeleton).resolve())
    for obj in bpy.data.objects:
        obj.hide_render = True
    apply_material(muscles, material("V60_MUSCLE", (0.34, 0.12, 0.075, 1.0)))
    apply_material(patch_objects, material("V60_COVERAGE", (0.82, 0.24, 0.035, 1.0)))
    apply_material(skeleton, material("V60_BONE", (0.36, 0.78, 0.9, 1.0)))

    low, high = bounds(muscles)
    center = (low + high) * 0.5
    height = high.z - low.z
    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 780
    scene.render.resolution_y = 1080
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
    camera_data = bpy.data.cameras.new("V60_QA_CAMERA")
    camera_data.type = "ORTHO"
    camera = bpy.data.objects.new("V60_QA_CAMERA", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    distance = height * 3.0
    views = [
        ("full-front", Vector((center.x, center.y - distance, center.z)), center, height * 1.06),
        ("full-rear", Vector((center.x, center.y + distance, center.z)), center, height * 1.06),
        ("upper-front", Vector((center.x, center.y - distance, 1.30)), Vector((center.x, center.y, 1.30)), 0.75),
        ("upper-rear", Vector((center.x, center.y + distance, 1.30)), Vector((center.x, center.y, 1.30)), 0.75),
        ("upper-left", Vector((high.x + distance, center.y, 1.30)), Vector((center.x, center.y, 1.30)), 0.75),
        ("upper-right", Vector((low.x - distance, center.y, 1.30)), Vector((center.x, center.y, 1.30)), 0.75),
        ("pelvis-rear", Vector((center.x, center.y + distance, 0.78)), Vector((center.x, center.y, 0.78)), 0.58),
        ("pelvis-left", Vector((high.x + distance, center.y, 0.82)), Vector((center.x, center.y, 0.82)), 0.58),
        ("pelvis-right", Vector((low.x - distance, center.y, 0.82)), Vector((center.x, center.y, 0.82)), 0.58),
        ("feet-left", Vector((center.x - distance, center.y, 0.11)), Vector((center.x, center.y, 0.11)), 0.42),
        (
            "hand-right-front",
            Vector((low.x + 0.045, center.y - distance, 0.82)),
            Vector((low.x + 0.045, center.y, 0.82)),
            0.24,
        ),
        (
            "hand-left-front",
            Vector((high.x - 0.045, center.y - distance, 0.82)),
            Vector((high.x - 0.045, center.y, 0.82)),
            0.24,
        ),
    ]
    requested_views = {value.strip() for value in args.views.split(",") if value.strip()}
    if requested_views:
        views = [view for view in views if view[0] in requested_views]
    for name, location, target, scale in views:
        camera.data.ortho_scale = scale
        camera.location = location
        look_at(camera, target)
        scene.render.filepath = str(output_dir / f"{args.prefix}-{name}.png")
        bpy.ops.render.render(write_still=True)
    print(f"IEOBOM_COVERAGE_RENDERED {args.prefix} {output_dir}", flush=True)


if __name__ == "__main__":
    main()
