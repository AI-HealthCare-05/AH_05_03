"""Report unusually long edges around the female shell crotch gap."""

from __future__ import annotations

import json
import sys
from pathlib import Path

import bpy


def main() -> None:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 1:
        raise SystemExit("usage: blender -b --python SCRIPT -- SHELL.glb")
    source = Path(values[0]).resolve()
    bpy.ops.object.select_all(action="SELECT")
    bpy.ops.object.delete(use_global=False)
    bpy.ops.import_scene.gltf(filepath=str(source))
    shell = next(obj for obj in bpy.context.scene.objects if obj.type == "MESH")
    mesh = shell.data
    points = [shell.matrix_world @ vertex.co for vertex in mesh.vertices]
    minimum = [min(point[i] for point in points) for i in range(3)]
    maximum = [max(point[i] for point in points) for i in range(3)]
    center_x = (minimum[0] + maximum[0]) / 2
    height = maximum[2] - minimum[2]
    # Pelvis/crotch band, deliberately broad for diagnosis only.
    z_low = minimum[2] + height * 0.34
    z_high = minimum[2] + height * 0.58
    candidates = []
    for edge in mesh.edges:
        a = points[edge.vertices[0]]
        b = points[edge.vertices[1]]
        midpoint = (a + b) * 0.5
        length = (a - b).length
        crosses_center = (a.x - center_x) * (b.x - center_x) < 0
        if z_low <= midpoint.z <= z_high and crosses_center:
            candidates.append(
                {
                    "edge": edge.index,
                    "vertices": list(edge.vertices),
                    "length": length,
                    "a": list(a),
                    "b": list(b),
                    "midpoint": list(midpoint),
                }
            )
    candidates.sort(key=lambda item: item["length"], reverse=True)
    histogram = {}
    for item in candidates:
        z_bin = f"{int(item['midpoint'][2] * 100) / 100:.2f}"
        bucket = histogram.setdefault(z_bin, {"count": 0, "over8mm": 0, "over12mm": 0})
        bucket["count"] += 1
        bucket["over8mm"] += item["length"] >= 0.008
        bucket["over12mm"] += item["length"] >= 0.012
    print(
        "IEOBOM_CROTCH_EDGE_REPORT",
        json.dumps(
            {
                "bounds": {"minimum": minimum, "maximum": maximum},
                "centerX": center_x,
                "bandZ": [z_low, z_high],
                "candidateCount": len(candidates),
                "histogram": histogram,
                "longest": candidates,
            }
        ),
    )


if __name__ == "__main__":
    main()
