"""Create an easy-to-review v53 blend without changing anatomy or materials."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

import bpy
from mathutils import Vector


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    return parser.parse_args(values)


def collection_objects(name: str) -> set[bpy.types.Object]:
    collection = bpy.data.collections.get(name)
    if collection is None:
        raise RuntimeError(f"Missing collection: {name}")
    return set(collection.all_objects)


def main() -> None:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    skeleton = collection_objects("SKELETON_V27")
    muscles = collection_objects("FEMALE_MUSCLE_WORK")
    visible = skeleton | muscles

    for obj in bpy.data.objects:
        show = obj in visible
        obj.hide_viewport = not show
        obj.hide_render = not show
        # Some source objects are intentionally absent from the active view layer.
        # Their global viewport flag is sufficient; hide_set only works in-view-layer.
        try:
            obj.hide_set(not show)
        except RuntimeError:
            pass
        if obj in skeleton:
            obj.color = (0.72, 0.78, 0.80, 1.0)
        elif obj in muscles:
            obj.color = (0.48, 0.14, 0.08, 1.0)

    # Keep every collection traversable in the Outliner; object visibility above
    # performs the actual isolation and avoids losing the original hierarchy.
    for collection in bpy.data.collections:
        collection.hide_viewport = False

    for workspace in bpy.data.workspaces:
        for screen in workspace.screens:
            for area in screen.areas:
                if area.type != "VIEW_3D":
                    continue
                space = area.spaces.active
                space.shading.type = "SOLID"
                space.shading.light = "STUDIO"
                space.shading.color_type = "OBJECT"
                space.shading.show_shadows = True
                space.shading.show_cavity = True
                space.shading.cavity_type = "WORLD"
                space.shading.curvature_ridge_factor = 1.5
                space.shading.curvature_valley_factor = 1.0
                space.shading.background_type = "VIEWPORT"
                space.shading.background_color = (0.035, 0.045, 0.055)
                space.clip_start = 0.001
                space.clip_end = 100.0
                if space.region_3d is not None:
                    # Front view centered on the head/upper torso where v53 changed.
                    space.region_3d.view_perspective = "ORTHO"
                    space.region_3d.view_location = Vector((0.964, 0.0, 1.50))
                    space.region_3d.view_distance = 0.42

    bpy.context.window.workspace = bpy.data.workspaces.get("Anatomy", bpy.context.window.workspace)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)
    print(
        "IEOBOM_REVIEW_READY",
        str(output),
        "skeletonObjects=",
        len(skeleton),
        "muscleObjects=",
        len(muscles),
    )


if __name__ == "__main__":
    main()
