"""Create a compact Blender review file for the original male genioglossus."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


TARGET_NAMES = ("Genioglossus muscle.l", "Genioglossus muscle.r")
COVER_NAMES = ("Tongue",)
CONTEXT_NAMES = (
    "Hyoglossus muscle.l",
    "Hyoglossus muscle.r",
    "Mylohyoid muscle.l",
    "Mylohyoid muscle.r",
)


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--source", required=True)
    parser.add_argument("--output", required=True)
    parser.add_argument("--render-dir", required=True)
    return parser.parse_args(values)


def make_material(name: str, color: tuple[float, float, float, float]) -> bpy.types.Material:
    material = bpy.data.materials.new(name)
    material.diffuse_color = color
    material.use_nodes = True
    node = material.node_tree.nodes.get("Principled BSDF")
    if node:
        node.inputs["Base Color"].default_value = color
        node.inputs["Roughness"].default_value = 0.72
    return material


def assign(obj: bpy.types.Object, material: bpy.types.Material) -> None:
    obj.data.materials.clear()
    obj.data.materials.append(material)
    obj.color = material.diffuse_color


def look_at(camera: bpy.types.Object, target: Vector) -> None:
    camera.rotation_euler = (target - camera.location).to_track_quat("-Z", "Y").to_euler()


def main() -> None:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    render_dir = Path(args.render_dir).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    render_dir.mkdir(parents=True, exist_ok=True)

    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    keep_names = set(TARGET_NAMES + COVER_NAMES + CONTEXT_NAMES)
    source_path = str(Path(args.source).expanduser().resolve())
    with bpy.data.libraries.load(source_path, link=False) as (data_from, data_to):
        data_to.objects = [name for name in keep_names if name in data_from.objects]
    review_collection = bpy.data.collections.new("MALE_GENIOGLOSSUS_SOURCE_REVIEW")
    bpy.context.scene.collection.children.link(review_collection)
    for obj in data_to.objects:
        if obj is not None:
            review_collection.objects.link(obj)

    targets = [bpy.data.objects[name] for name in TARGET_NAMES]
    cover = [bpy.data.objects[name] for name in COVER_NAMES]
    context = [bpy.data.objects[name] for name in CONTEXT_NAMES if name in bpy.data.objects]

    target_material = make_material("REVIEW_Genioglossus_Coral", (0.65, 0.12, 0.07, 1.0))
    cover_material = make_material("REVIEW_Tongue_Cover_Cyan", (0.20, 0.62, 0.75, 1.0))
    context_material = make_material("REVIEW_Neighbor_Ochre", (0.55, 0.34, 0.10, 1.0))
    for obj in targets:
        assign(obj, target_material)
        obj.display_type = "SOLID"
        obj.hide_viewport = False
        obj.hide_render = False
    for obj in cover:
        assign(obj, cover_material)
        obj.display_type = "WIRE"
        obj.hide_viewport = False
        obj.hide_render = False
        obj.show_in_front = True
    for obj in context:
        assign(obj, context_material)
        obj.display_type = "WIRE"
        obj.hide_viewport = False
        obj.hide_render = True

    scene = bpy.context.scene
    scene["IEOBOM_REVIEW_PURPOSE"] = (
        "Original male Genioglossus muscle.l/r. Tongue is wireframe in the viewport "
        "to show that the angular fan-shaped muscle is normally enclosed."
    )
    scene.render.engine = "BLENDER_WORKBENCH"
    scene.render.resolution_x = 900
    scene.render.resolution_y = 900
    scene.render.resolution_percentage = 100
    scene.render.image_settings.file_format = "PNG"
    scene.display.shading.light = "STUDIO"
    scene.display.shading.color_type = "MATERIAL"
    scene.display.shading.show_shadows = True
    scene.display.shading.show_cavity = True
    scene.display.shading.cavity_type = "WORLD"
    scene.display.shading.background_type = "VIEWPORT"
    scene.display.shading.background_color = (0.012, 0.025, 0.035)

    camera_data = bpy.data.cameras.new("GENIOGLOSSUS_REVIEW_CAMERA")
    camera_data.type = "ORTHO"
    camera_data.ortho_scale = 0.105
    camera = bpy.data.objects.new("GENIOGLOSSUS_REVIEW_CAMERA", camera_data)
    scene.collection.objects.link(camera)
    scene.camera = camera
    center = Vector((0.0, -0.053, 1.518))
    camera.location = Vector((-0.22, -0.11, 1.525))
    look_at(camera, center)

    for obj in cover:
        obj.hide_render = True
    scene.render.filepath = str(render_dir / "male-genioglossus-isolated.png")
    bpy.ops.render.render(write_still=True)

    for obj in cover:
        obj.hide_render = False
    scene.render.filepath = str(render_dir / "male-genioglossus-covered-by-tongue.png")
    bpy.ops.render.render(write_still=True)

    # Leave the interactive file in the useful X-ray arrangement: target solid,
    # enclosing Tongue and neighboring tongue-floor muscles in wire display.
    bpy.ops.object.select_all(action="DESELECT")
    for obj in targets:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = targets[0]
    scene.render.filepath = ""
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    print(f"IEOBOM_GENIOGLOSSUS_REVIEW {output}")


if __name__ == "__main__":
    main()
