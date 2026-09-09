"""Render normalized male and corrected female feet for Blender QA."""

from __future__ import annotations

import argparse
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector


FOOT_ID = re.compile(
    r"appendicular-skeleton-(?:calcaneus|cuboid-bone|.*cuneiform-bone|"
    r"navicular-bone|talus|.*metatarsal-bone|.*phalanx-of-.*-finger-of-foot|"
    r"sesamoid-bones-of-foot)-(?:left|right)$"
)


def args() -> argparse.Namespace:
    raw = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--female-only", action="store_true")
    parser.add_argument("--highlight-navicular", action="store_true")
    return parser.parse_args(raw)


def points(objects: list[bpy.types.Object]) -> list[Vector]:
    return [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]


def bounds(objects: list[bpy.types.Object]) -> tuple[Vector, Vector]:
    cloud = points(objects)
    return (
        Vector(tuple(min(point[axis] for point in cloud) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in cloud) for axis in range(3))),
    )


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def render_set(
    label: str,
    objects: list[bpy.types.Object],
    output_dir: Path,
    camera: bpy.types.Object,
    highlight_navicular: bool,
) -> None:
    neutral_material = bpy.data.materials.get("IEOBOM_FOOT_QA_NEUTRAL")
    if neutral_material is None:
        neutral_material = bpy.data.materials.new("IEOBOM_FOOT_QA_NEUTRAL")
    neutral_material.diffuse_color = (0.50, 0.70, 0.82, 1.0)
    navicular_material = bpy.data.materials.get("IEOBOM_FOOT_QA_NAVICULAR")
    if navicular_material is None:
        navicular_material = bpy.data.materials.new("IEOBOM_FOOT_QA_NAVICULAR")
    navicular_material.diffuse_color = (0.95, 0.03, 0.01, 1.0)

    for obj in bpy.data.objects:
        obj.hide_render = True
    for obj in objects:
        obj.hide_render = False
        is_navicular = "navicular-bone" in str(obj.get("anatomyId", ""))
        obj.data.materials.clear()
        obj.data.materials.append(navicular_material if highlight_navicular and is_navicular else neutral_material)

    low, high = bounds(objects)
    center = (low + high) * 0.5
    size = high - low
    views = {
        "dorsal": (center + Vector((0.0, 0.0, 1.0)), max(size.x * 1.35, size.y * 1.22)),
        "plantar": (center - Vector((0.0, 0.0, 1.0)), max(size.x * 1.35, size.y * 1.22)),
        "medial": (center + Vector((1.0, 0.0, 0.0)), max(size.y * 1.22, size.z * 1.7)),
    }
    scene = bpy.context.scene
    for view, (location, scale) in views.items():
        camera.location = location
        camera.data.ortho_scale = scale
        look_at(camera, center)
        scene.render.filepath = str(output_dir / f"{label}-{view}.png")
        bpy.ops.render.render(write_still=True)


def main() -> None:
    parsed = args()
    output_dir = Path(parsed.output_dir).expanduser().resolve()
    output_dir.mkdir(parents=True, exist_ok=True)

    scene = bpy.context.scene
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.render.film_transparent = False
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.035, 0.045, 0.055)

    camera_data = bpy.data.cameras.new("IEOBOM_FOOT_QA_CAMERA")
    camera_data.type = "ORTHO"
    camera_data.lens = 50
    camera = bpy.data.objects.new("IEOBOM_FOOT_QA_CAMERA", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera

    skeleton = bpy.data.collections["SKELETON_V27"]
    female = [
        obj for obj in skeleton.all_objects if obj.type == "MESH" and FOOT_ID.fullmatch(str(obj.get("anatomyId", "")))
    ]
    male = [bpy.data.objects[str(obj.get("sourceName"))] for obj in female]
    if len(female) != 54 or len(set(male)) != 54:
        raise RuntimeError(f"Expected 54 female and male foot meshes; found {len(female)} and {len(set(male))}")

    render_set(
        "female-v33",
        female,
        output_dir,
        camera,
        parsed.highlight_navicular,
    )
    if not parsed.female_only:
        render_set(
            "male-reference",
            list(set(male)),
            output_dir,
            camera,
            parsed.highlight_navicular,
        )


if __name__ == "__main__":
    main()
