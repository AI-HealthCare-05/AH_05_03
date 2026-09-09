"""Print world-space bounds for the female shell and coverage target bones."""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

import bpy
from mathutils import Vector
from mathutils.bvhtree import BVHTree


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--shell", required=True)
    parser.add_argument("--skeleton", required=True)
    parser.add_argument("--report")
    return parser.parse_args(values)


def imported_meshes(path: Path) -> list[bpy.types.Object]:
    before = set(bpy.data.objects)
    bpy.ops.import_scene.gltf(filepath=str(path))
    return [obj for obj in bpy.data.objects if obj not in before and obj.type == "MESH"]


def bounds(objects: list[bpy.types.Object]) -> dict[str, list[float]]:
    points = [obj.matrix_world @ vertex.co for obj in objects for vertex in obj.data.vertices]
    if not points:
        return {"min": [], "max": []}
    return {
        "min": [round(min(point[i] for point in points), 5) for i in range(3)],
        "max": [round(max(point[i] for point in points), 5) for i in range(3)],
    }


def main() -> None:
    args = parse_args()
    shell = imported_meshes(Path(args.shell).resolve())
    skeleton = imported_meshes(Path(args.skeleton).resolve())
    groups = {
        "clavicle_sternum": re.compile(r"clavicle|sternum|manubrium", re.I),
        "scapula_ribs_thoracic": re.compile(r"scapula|rib|thoracic vertebra", re.I),
        "lumbar": re.compile(r"lumbar vertebra", re.I),
        "pelvis": re.compile(r"hip.bone|sacrum|coccyx", re.I),
        "feet": re.compile(r"talus|calcaneus|tarsal|metatarsal|finger.of.foot|sesamoid.bones.of.foot", re.I),
    }
    shell_points = [shell[0].matrix_world @ vertex.co for vertex in shell[0].data.vertices]
    shell_center = sum(shell_points, Vector()) / len(shell_points)
    shell_bvh = BVHTree.FromPolygons(shell_points, [tuple(polygon.vertices) for polygon in shell[0].data.polygons])
    payload = {"shell": bounds(shell)}
    for name, pattern in groups.items():
        matches = [obj for obj in skeleton if pattern.search(obj.name)]
        signed_values = []
        near_outside = []
        for obj in matches:
            for vertex in obj.data.vertices:
                point = obj.matrix_world @ vertex.co
                nearest, normal, _face, _distance = shell_bvh.find_nearest(point)
                if nearest is None or normal is None:
                    continue
                if normal.dot(nearest - shell_center) < 0:
                    normal = -normal
                signed = (point - nearest).dot(normal)
                signed_values.append(signed)
                distance = (point - nearest).length
                if signed > 0.0001 and distance <= 0.010:
                    near_outside.append((obj.name, signed, distance))
        payload[name] = {
            "count": len(matches),
            "bounds": bounds(matches),
            "names": sorted(obj.name for obj in matches),
            "outside": {
                "verticesOver0_1mm": sum(value > 0.0001 for value in signed_values),
                "maxMm": round(max(signed_values) * 1000, 3) if signed_values else 0,
                "nearShellVertices": len(near_outside),
                "nearShellMaxMm": round(max((value[1] for value in near_outside), default=0) * 1000, 3),
            },
        }
    if args.report:
        Path(args.report).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print(
        "IEOBOM_V61_ZONES",
        json.dumps(
            {
                name: value.get("outside")
                for name, value in payload.items()
                if isinstance(value, dict) and "outside" in value
            },
            ensure_ascii=False,
        ),
        flush=True,
    )


if __name__ == "__main__":
    main()
