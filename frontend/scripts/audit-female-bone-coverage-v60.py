"""Audit shell-adjacent gaps over enlarged female bones before v60 patching."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils.kdtree import KDTree


REGIONS = {
    "thorax": re.compile(r"clavicle|scapula|sternum|manubrium|rib|vertebra", re.I),
    "pelvis": re.compile(r"hip.bone|sacrum|coccyx", re.I),
    "feet": re.compile(r"talus|calcaneus|tarsal|metatarsal|finger.of.foot|sesamoid.bones.of.foot", re.I),
}
THRESHOLDS = {
    "thorax": (0.028, 0.006),
    "pelvis": (0.032, 0.006),
    "feet": (0.018, 0.004),
}


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--shell", required=True)
    parser.add_argument("--skeleton", required=True)
    return parser.parse_args(values)


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def import_glb(path: Path, prefix: str) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    result = [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]
    for obj in result:
        obj.name = f"{prefix}__{obj.name}"
    return result


def tree_from_objects(objects: list[bpy.types.Object], maximum: int | None = None) -> tuple[KDTree, int]:
    total = sum(len(obj.data.vertices) for obj in objects)
    stride = max(1, total // maximum) if maximum and total > maximum else 1
    points = []
    cursor = 0
    for obj in objects:
        for _index, vertex in enumerate(obj.data.vertices):
            if cursor % stride == 0:
                points.append(obj.matrix_world @ vertex.co)
            cursor += 1
    tree = KDTree(len(points))
    for index, point in enumerate(points):
        tree.insert(point, index)
    tree.balance()
    return tree, len(points)


def percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]


def main() -> None:
    args = parse_args()
    work = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if work is None:
        raise RuntimeError("FEMALE_MUSCLE_WORK missing")
    muscles = [
        obj
        for obj in recursive_objects(work)
        if obj.type == "MESH" and obj.data.polygons and not bool(obj.get("IEOBOM_webExclude"))
    ]
    muscle_tree, muscle_samples = tree_from_objects(muscles, 500_000)
    shell_objects = import_glb(Path(args.shell).resolve(), "V60_SHELL")
    skeleton = import_glb(Path(args.skeleton).resolve(), "V60_BONE")
    if len(shell_objects) != 1:
        raise RuntimeError(f"Expected one shell mesh, got {len(shell_objects)}")
    shell = shell_objects[0]

    payload = {
        "muscleObjects": len(muscles),
        "muscleSamples": muscle_samples,
        "shellVertices": len(shell.data.vertices),
        "shellPolygons": len(shell.data.polygons),
        "regions": {},
    }
    for region, pattern in REGIONS.items():
        bones = [obj for obj in skeleton if pattern.search(obj.name)]
        bone_tree, bone_samples = tree_from_objects(bones)
        bone_limit, muscle_gap = THRESHOLDS[region]
        candidates = 0
        bone_distances = []
        muscle_distances = []
        for vertex in shell.data.vertices:
            point = shell.matrix_world @ vertex.co
            bone_distance = bone_tree.find(point)[2]
            if bone_distance > bone_limit:
                continue
            muscle_distance = muscle_tree.find(point)[2]
            bone_distances.append(bone_distance)
            muscle_distances.append(muscle_distance)
            if muscle_distance > muscle_gap:
                candidates += 1
        payload["regions"][region] = {
            "bones": len(bones),
            "boneSamples": bone_samples,
            "boneNames": sorted(obj.name.removeprefix("V60_BONE__") for obj in bones),
            "shellVerticesNearBone": len(bone_distances),
            "candidateGapVertices": candidates,
            "candidatePercent": round(candidates * 100.0 / len(bone_distances), 3) if bone_distances else 0.0,
            "nearBoneDistanceMm": {
                "median": round(percentile(bone_distances, 0.5) * 1000.0, 3),
                "p90": round(percentile(bone_distances, 0.9) * 1000.0, 3),
            },
            "muscleDistanceMm": {
                "median": round(percentile(muscle_distances, 0.5) * 1000.0, 3),
                "p90": round(percentile(muscle_distances, 0.9) * 1000.0, 3),
                "max": round(max(muscle_distances) * 1000.0, 3) if muscle_distances else 0.0,
            },
        }
    print("IEOBOM_V60_COVERAGE_AUDIT", json.dumps(payload, ensure_ascii=False), flush=True)


if __name__ == "__main__":
    main()
