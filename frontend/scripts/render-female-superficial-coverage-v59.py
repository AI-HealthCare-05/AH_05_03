"""Render v59 female muscles with transplanted superficial layers highlighted."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    return parser.parse_args(values)


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for obj in objects for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def make_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    value = bpy.data.materials.new(name)
    value.diffuse_color = color
    value.roughness = 0.9
    return value


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)
    work = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    added = bpy.data.collections.get("FEMALE_SUPERFICIAL_COVERAGE_V59")
    if work is None or added is None:
        raise RuntimeError("v59 collections are missing")
    all_female = [obj for obj in recursive_objects(work) if obj.type == "MESH" and obj.data.polygons]
    all_added = {obj for obj in recursive_objects(added) if obj.type == "MESH"}
    added_set = {
        obj
        for obj in recursive_objects(added)
        if obj.type == "MESH" and obj.data.polygons and not bool(obj.get("IEOBOM_webExclude"))
    }
    original = [obj for obj in all_female if obj not in all_added]

    for obj in bpy.data.objects:
        obj.hide_render = True
    muscle = make_material("IEOBOM_QA_EXISTING", (0.34, 0.12, 0.075, 1.0))
    fascia = make_material("IEOBOM_QA_ADDED", (0.92, 0.34, 0.045, 1.0))
    for obj in original:
        obj.hide_render = False
        obj.data.materials.clear()
        obj.data.materials.append(muscle)
    for obj in added_set:
        obj.hide_render = False
        obj.data.materials.clear()
        obj.data.materials.append(fascia)

    low, high = bounds(all_female)
    center = (low + high) * 0.5
    height = high.z - low.z
    width = high.x - low.x
    depth = high.y - low.y

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 760
    scene.render.resolution_y = 1100
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.curvature_ridge_factor = 1.6
    scene.display.shading.curvature_valley_factor = 1.2
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.012, 0.025, 0.035)

    camera_data = bpy.data.cameras.new("IEOBOM_V59_QA_CAMERA")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = max(height * 1.06, width * 1.12)
    camera = bpy.data.objects.new("IEOBOM_V59_QA_CAMERA", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    distance = max(width, depth, height) * 3.0
    views = {
        "front": Vector((center.x, center.y - distance, center.z)),
        "rear": Vector((center.x, center.y + distance, center.z)),
        "left": Vector((center.x - distance, center.y, center.z)),
        "right": Vector((center.x + distance, center.y, center.z)),
    }
    for name, location in views.items():
        camera.location = location
        look_at(camera, center)
        scene.render.filepath = str(output_dir / f"v59-{name}.png")
        bpy.ops.render.render(write_still=True)
    print(f"IEOBOM_V59_RENDERED {output_dir}")


if __name__ == "__main__":
    main()
