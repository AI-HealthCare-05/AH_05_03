"""Compare the in-file male source and fitted female genioglossus meshes."""

from __future__ import annotations

import json

import bpy
from mathutils import Vector


PAIRS = (
    ("Genioglossus muscle.l", "FEMALE_TONGUE_Genioglossus muscle.l"),
    ("Genioglossus muscle.r", "FEMALE_TONGUE_Genioglossus muscle.r"),
)


def bounds(obj: bpy.types.Object) -> dict[str, list[float]]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return {
        axis: [round(min(point[index] for point in points), 6), round(max(point[index] for point in points), 6)]
        for index, axis in enumerate(("x", "y", "z"))
    }


def record(obj: bpy.types.Object) -> dict[str, object]:
    actual_points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
    return {
        "name": obj.name,
        "dataName": obj.data.name,
        "collections": [collection.name for collection in obj.users_collection],
        "vertices": len(obj.data.vertices),
        "edges": len(obj.data.edges),
        "polygons": len(obj.data.polygons),
        "bounds": bounds(obj),
        "actualVertexBounds": {
            axis: [
                round(min(point[index] for point in actual_points), 6),
                round(max(point[index] for point in actual_points), 6),
            ]
            for index, axis in enumerate(("x", "y", "z"))
        },
        "matrixWorld": [[round(value, 6) for value in row] for row in obj.matrix_world],
        "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
        "hiddenViewport": obj.hide_viewport,
        "hiddenRender": obj.hide_render,
    }


def main() -> None:
    pairs = []
    for male_name, female_name in PAIRS:
        male = bpy.data.objects.get(male_name)
        female = bpy.data.objects.get(female_name)
        if male is None or female is None:
            raise RuntimeError(f"Missing pair: {male_name} / {female_name}")
        male_points = [male.matrix_world @ vertex.co for vertex in male.data.vertices]
        female_points = [female.matrix_world @ vertex.co for vertex in female.data.vertices]
        paired = min(len(male_points), len(female_points))
        deltas = [(female_points[index] - male_points[index]).length for index in range(paired)]
        pairs.append(
            {
                "male": record(male),
                "female": record(female),
                "sameTopologyCounts": (
                    len(male.data.vertices) == len(female.data.vertices)
                    and len(male.data.edges) == len(female.data.edges)
                    and len(male.data.polygons) == len(female.data.polygons)
                ),
                "sharedMeshData": male.data == female.data,
                "pairedWorldDeltaMm": {
                    "min": round(min(deltas) * 1000.0, 4),
                    "max": round(max(deltas) * 1000.0, 4),
                    "mean": round(sum(deltas) * 1000.0 / max(1, len(deltas)), 4),
                },
            }
        )

    neighbors = []
    for obj in bpy.data.objects:
        lower = obj.name.lower()
        if obj.type == "MESH" and any(
            term in lower for term in ("tongue", "genioglossus", "hyoglossus", "styloglossus")
        ):
            neighbors.append(record(obj))
    print("IEOBOM_GENIOGLOSSUS", json.dumps({"pairs": pairs, "neighbors": neighbors}, ensure_ascii=False))


if __name__ == "__main__":
    main()
