"""Warp an official Z-Anatomy supplement into the retained female skeleton.

Usage:
  blender --background --python scripts/build-female-aligned-anatomy-layer.py -- \
    <base-core.glb> <female-skeleton.glb> <female-shell.glb> <source-layer.glb> \
    <output.glb> <report.json> <region-id>

The 181 matching skeletal structures form a deformation cage. Each source
vertex is mapped by blending the axis-aligned local transforms of the nearest
bones, so the retained thorax, pelvis, arm, hand, and foot corrections are
inherited without modifying the approved exterior or v27 skeleton.
"""

import bpy
import hashlib
import json
import sys
from collections import Counter
from pathlib import Path

import numpy as np
from mathutils.bvhtree import BVHTree


arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(arguments) != 7:
    raise SystemExit(
        "expected <base-core.glb> <female-skeleton.glb> <female-shell.glb> "
        "<source-layer.glb> "
        "<output.glb> <report.json> <region-id>"
    )

base_core_path = Path(arguments[0]).resolve()
female_skeleton_path = Path(arguments[1]).resolve()
female_shell_path = Path(arguments[2]).resolve()
source_layer_path = Path(arguments[3]).resolve()
output_path = Path(arguments[4]).resolve()
report_path = Path(arguments[5]).resolve()
region_id = arguments[6]
output_path.parent.mkdir(parents=True, exist_ok=True)
report_path.parent.mkdir(parents=True, exist_ok=True)

NEIGHBOR_BONES = 8
CHUNK_SIZE = 8192
MIN_EXTENT = 0.002
EXCLUDED_TARGET_SYSTEMS = {"reproductive"}
SHELL_INSET = 0.0015


def imported_meshes(path):
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]


def skeletal_objects(path):
    imported = imported_meshes(path)
    result = {
        str(obj.get("anatomyId", "")): obj
        for obj in imported
        if str(obj.get("anatomyId", ""))
        and str(obj.get("anatomySystem", "")) == "skeletal"
    }
    return imported, result


def world_vertices(obj):
    local = np.empty(len(obj.data.vertices) * 3, dtype=np.float64)
    obj.data.vertices.foreach_get("co", local)
    local = local.reshape((-1, 3))
    matrix = np.asarray(obj.matrix_world, dtype=np.float64)
    return local @ matrix[:3, :3].T + matrix[:3, 3]


def bounds(obj):
    points = world_vertices(obj)
    return points.min(axis=0), points.max(axis=0)


def build_shell_bvh(path):
    shell_objects = imported_meshes(path)
    vertices = []
    polygons = []
    for obj in shell_objects:
        offset = len(vertices)
        vertices.extend(obj.matrix_world @ vertex.co for vertex in obj.data.vertices)
        polygons.extend(
            tuple(offset + vertex_index for vertex_index in polygon.vertices)
            for polygon in obj.data.polygons
        )
    bvh = BVHTree.FromPolygons(vertices, polygons, all_triangles=False)
    for obj in shell_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
    return bvh


bpy.ops.wm.read_factory_settings(use_empty=True)
base_imported, base_skeleton = skeletal_objects(base_core_path)
female_imported, female_skeleton = skeletal_objects(female_skeleton_path)
common_ids = sorted(set(base_skeleton).intersection(female_skeleton))
if len(common_ids) != 181:
    raise RuntimeError(
        f"female deformation cage must contain 181 matching bones, got {len(common_ids)}"
    )

base_lows = []
base_highs = []
female_lows = []
female_highs = []
for anatomy_id in common_ids:
    base_low, base_high = bounds(base_skeleton[anatomy_id])
    female_low, female_high = bounds(female_skeleton[anatomy_id])
    base_lows.append(base_low)
    base_highs.append(base_high)
    female_lows.append(female_low)
    female_highs.append(female_high)

base_lows = np.asarray(base_lows)
base_highs = np.asarray(base_highs)
female_lows = np.asarray(female_lows)
female_highs = np.asarray(female_highs)
base_centers = (base_lows + base_highs) * 0.5
female_centers = (female_lows + female_highs) * 0.5
base_extents = np.maximum(base_highs - base_lows, MIN_EXTENT)
female_extents = np.maximum(female_highs - female_lows, MIN_EXTENT)
local_scales = female_extents / base_extents
bone_radii = np.linalg.norm(base_extents, axis=1) * 0.5

for obj in base_imported + female_imported:
    bpy.data.objects.remove(obj, do_unlink=True)

shell_bvh = build_shell_bvh(female_shell_path)

imported_source_objects = imported_meshes(source_layer_path)
excluded_system_counts = Counter(
    str(obj.get("anatomySystem", "regional-anatomy"))
    for obj in imported_source_objects
    if str(obj.get("anatomySystem", "regional-anatomy")) in EXCLUDED_TARGET_SYSTEMS
)
source_objects = [
    obj
    for obj in imported_source_objects
    if str(obj.get("anatomySystem", "regional-anatomy")) not in EXCLUDED_TARGET_SYSTEMS
]
for obj in imported_source_objects:
    if obj not in source_objects:
        bpy.data.objects.remove(obj, do_unlink=True)
if not source_objects:
    raise RuntimeError("source supplement contains no mesh objects")


def warp_points(points):
    warped = np.empty_like(points)
    neighbor_count = min(NEIGHBOR_BONES, len(base_centers))
    for start in range(0, len(points), CHUNK_SIZE):
        chunk = points[start : start + CHUNK_SIZE]
        center_delta = chunk[:, None, :] - base_centers[None, :, :]
        center_distance_sq = np.einsum("nbi,nbi->nb", center_delta, center_delta)
        candidates = np.argpartition(
            center_distance_sq,
            neighbor_count - 1,
            axis=1,
        )[:, :neighbor_count]

        rows = np.arange(len(chunk))[:, None]
        candidate_lows = base_lows[candidates]
        candidate_highs = base_highs[candidates]
        outside = np.maximum(
            np.maximum(candidate_lows - chunk[:, None, :], chunk[:, None, :] - candidate_highs),
            0.0,
        )
        aabb_distance_sq = np.einsum("nbi,nbi->nb", outside, outside)
        softness = np.maximum(bone_radii[candidates] * 0.22, 0.004)
        weights = 1.0 / (aabb_distance_sq + softness * softness)
        weights /= weights.sum(axis=1, keepdims=True)

        mapped = female_centers[candidates] + (
            chunk[:, None, :] - base_centers[candidates]
        ) * local_scales[candidates]
        warped[start : start + len(chunk)] = np.einsum("nb,nbi->ni", weights, mapped)
    return warped


def clamp_points_inside_shell(points):
    clamped = points.copy()
    clamped_count = 0
    max_outside_distance = 0.0
    for index, point in enumerate(points):
        nearest, normal, _, distance = shell_bvh.find_nearest(point)
        if nearest is None or normal is None:
            continue
        signed_distance = (point - nearest).dot(normal)
        if signed_distance > -SHELL_INSET:
            clamped[index] = nearest - normal * SHELL_INSET
            clamped_count += 1
            max_outside_distance = max(max_outside_distance, max(signed_distance, 0.0))
    return clamped, clamped_count, max_outside_distance


system_counts = Counter()
vertex_count = 0
triangle_count = 0
clamped_vertices = 0
max_outside_distance = 0.0
clamped_objects = 0
for obj in source_objects:
    points = world_vertices(obj)
    warped = warp_points(points)
    warped, object_clamped_vertices, object_max_outside = clamp_points_inside_shell(warped)
    if object_clamped_vertices:
        clamped_objects += 1
        clamped_vertices += object_clamped_vertices
        max_outside_distance = max(max_outside_distance, object_max_outside)
    obj.matrix_world.identity()
    obj.data.vertices.foreach_set("co", warped.astype(np.float32).reshape(-1))
    obj.data.update()
    obj["femaleAlignment"] = "v29-skeletal-cage-shell-clamped"
    obj["sourceAtlas"] = "Z-Anatomy official 32693313; aligned to Ieobom female v27 skeleton"
    system_counts[str(obj.get("anatomySystem", "regional-anatomy"))] += 1
    vertex_count += len(obj.data.vertices)
    triangle_count += len(obj.data.polygons)

bpy.ops.object.select_all(action="DESELECT")
for obj in source_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = source_objects[0]
bpy.ops.export_scene.gltf(
    filepath=str(output_path),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_materials="EXPORT",
    export_extras=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
)

report = {
    "source": source_layer_path.name,
    "targetSkeleton": female_skeleton_path.name,
    "region": region_id,
    "policy": "181-bone nearest-cage blended axis-aligned deformation plus female-shell inward clamp; approved female shell, skeleton, and v28 organs unchanged",
    "cageBones": len(common_ids),
    "neighborBones": NEIGHBOR_BONES,
    "excludedSystems": dict(sorted(excluded_system_counts.items())),
    "shellInset": SHELL_INSET,
    "clampedObjects": clamped_objects,
    "clampedVertices": clamped_vertices,
    "maxOutsideDistanceBeforeClamp": max_outside_distance,
    "objects": len(source_objects),
    "systems": dict(sorted(system_counts.items())),
    "vertices": vertex_count,
    "triangles": triangle_count,
    "bytes": output_path.stat().st_size,
    "sha256": hashlib.sha256(output_path.read_bytes()).hexdigest(),
    "output": output_path.name,
}
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("IEOBOM_FEMALE_ALIGNED_LAYER=" + json.dumps(report, ensure_ascii=False))
