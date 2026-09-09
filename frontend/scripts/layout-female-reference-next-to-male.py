"""Arrange the retained female reference beside the Z-Anatomy male model.

The mesh data remains untouched.  All female reference objects are parented to
one reversible Empty, uniformly scaled to the visible male skeleton height,
floor-aligned, depth-centered, and placed to the male model's right.

Usage:
  blender --background <work.blend> --python this-script.py -- \
    <report.json>
"""

import bpy
import json
import sys
from mathutils import Vector
from pathlib import Path


arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(arguments) != 1:
    raise SystemExit("expected <report.json>")

report_path = Path(arguments[0]).resolve()

FEMALE_COLLECTION = "FEMALE_REFERENCE"
FEMALE_SHELL_COLLECTION = "SHELL_V15"
MALE_SKELETON_COLLECTION = "1: Skeletal system"
ROOT_NAME = "IEOBOM_Female_Workspace_Root"


def collection(name):
    value = bpy.data.collections.get(name)
    if value is None:
        raise RuntimeError(f"missing collection: {name}")
    return value


def world_bounds(objects):
    points = [obj.matrix_world @ Vector(corner) for obj in objects if obj.type == "MESH" for corner in obj.bound_box]
    if not points:
        raise RuntimeError("cannot calculate empty mesh bounds")
    minimum = Vector(min(point[axis] for point in points) for axis in range(3))
    maximum = Vector(max(point[axis] for point in points) for axis in range(3))
    return minimum, maximum


female_collection = collection(FEMALE_COLLECTION)
shell_collection = collection(FEMALE_SHELL_COLLECTION)
male_collection = collection(MALE_SKELETON_COLLECTION)

if bpy.data.objects.get(ROOT_NAME):
    raise RuntimeError(f"{ROOT_NAME} already exists; refusing to apply the workspace transform twice")

male_objects = [
    obj for obj in male_collection.all_objects if obj.type == "MESH" and not obj.hide_get() and not obj.hide_viewport
]
female_objects = [obj for obj in female_collection.all_objects if obj.type == "MESH"]
shell_objects = [obj for obj in shell_collection.all_objects if obj.type == "MESH"]

male_min, male_max = world_bounds(male_objects)
female_min, female_max = world_bounds(shell_objects)
male_height = male_max.z - male_min.z
female_height = female_max.z - female_min.z
uniform_scale = male_height / female_height

female_center = (female_min + female_max) * 0.5
male_center = (male_min + male_max) * 0.5
root_origin = Vector((female_center.x, female_center.y, female_min.z))

root = bpy.data.objects.new(ROOT_NAME, None)
root.empty_display_type = "PLAIN_AXES"
root.empty_display_size = male_height * 0.08
root.location = root_origin
root["ieobomRole"] = "female-workspace-layout-root"
root["uniformScaleToMale"] = uniform_scale
root["sourceFemaleHeightM"] = female_height
root["targetMaleHeightM"] = male_height
root["reversibleLayout"] = True
female_collection.objects.link(root)

for obj in female_objects:
    world_matrix = obj.matrix_world.copy()
    obj.parent = root
    obj.matrix_parent_inverse = root.matrix_world.inverted()
    obj.matrix_world = world_matrix

root.scale = (uniform_scale,) * 3

scaled_female_min_x = root_origin.x + (female_min.x - root_origin.x) * uniform_scale
scaled_female_center_y = root_origin.y + (female_center.y - root_origin.y) * uniform_scale
scaled_female_min_z = root_origin.z + (female_min.z - root_origin.z) * uniform_scale
gap = male_height * 0.15
translation = Vector(
    (
        male_max.x + gap - scaled_female_min_x,
        male_center.y - scaled_female_center_y,
        male_min.z - scaled_female_min_z,
    )
)
root.location += translation
bpy.context.view_layer.update()

arranged_min, arranged_max = world_bounds(female_objects)
report = {
    "blend": bpy.data.filepath,
    "root": ROOT_NAME,
    "femaleObjects": len(female_objects),
    "femaleCostalCartilages": 0,
    "maleVisibleSkeletonObjects": len(male_objects),
    "sourceFemaleHeightM": round(female_height, 6),
    "targetMaleHeightM": round(male_height, 6),
    "uniformScale": round(uniform_scale, 9),
    "gapM": round(gap, 6),
    "rootLocation": [round(value, 6) for value in root.location],
    "arrangedFemaleBounds": {
        "min": [round(value, 6) for value in arranged_min],
        "max": [round(value, 6) for value in arranged_max],
    },
}
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")

bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
print("IEOBOM_FEMALE_WORKSPACE_LAYOUT=" + json.dumps(report, ensure_ascii=False))
