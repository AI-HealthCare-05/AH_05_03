"""List transplanted v59 meshes whose bounds fall outside the female body envelope."""

from __future__ import annotations

import json

import bpy
from mathutils import Vector


def bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    return (
        Vector(tuple(min(point[axis] for point in points) for axis in range(3))),
        Vector(tuple(max(point[axis] for point in points) for axis in range(3))),
    )


def main() -> None:
    collection = bpy.data.collections.get("FEMALE_SUPERFICIAL_COVERAGE_V59")
    if collection is None:
        raise RuntimeError("FEMALE_SUPERFICIAL_COVERAGE_V59 missing")
    rows = []
    for obj in collection.all_objects:
        if obj.type != "MESH" or not obj.data.polygons:
            continue
        low, high = bounds(obj)
        rows.append(
            {
                "name": obj.name,
                "source": obj.get("sourceName"),
                "low": [round(value, 5) for value in low],
                "high": [round(value, 5) for value in high],
                "vertices": len(obj.data.vertices),
                "polygons": len(obj.data.polygons),
            }
        )
    print("IEOBOM_V59_LOWEST", json.dumps(sorted(rows, key=lambda row: row["low"][2])[:15]))
    print(
        "IEOBOM_V59_WIDEST",
        json.dumps(sorted(rows, key=lambda row: max(abs(row["low"][0]), abs(row["high"][0])), reverse=True)[:10]),
    )
    depsgraph = bpy.context.evaluated_depsgraph_get()
    source_rows = []
    for row in sorted(rows, key=lambda item: item["low"][2])[:15]:
        source = bpy.data.objects.get(str(row["source"]))
        evaluated = source.evaluated_get(depsgraph)
        evaluated_mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
        try:
            points = [evaluated.matrix_world @ vertex.co for vertex in evaluated_mesh.vertices]
            source_rows.append(
                {
                    "name": source.name,
                    "modifiers": [modifier.type for modifier in source.modifiers],
                    "baseVertices": len(source.data.vertices),
                    "evaluatedVertices": len(evaluated_mesh.vertices),
                    "evaluatedLow": [round(min(point[axis] for point in points), 5) for axis in range(3)],
                    "evaluatedHigh": [round(max(point[axis] for point in points), 5) for axis in range(3)],
                    "hideViewport": source.hide_viewport,
                    "hideRender": source.hide_render,
                }
            )
        finally:
            bpy.data.meshes.remove(evaluated_mesh)
    print("IEOBOM_V59_SOURCE_EVALUATED", json.dumps(source_rows))
    visibility = []
    for obj in collection.all_objects:
        if obj.type != "MESH" or not obj.data.polygons:
            continue
        source = bpy.data.objects.get(str(obj.get("sourceName") or ""))
        visibility.append(
            {
                "name": source.name,
                "hideRender": source.hide_render,
                "hideViewport": source.hide_viewport,
                "polygons": len(source.data.polygons),
            }
        )
    print(
        "IEOBOM_V59_VISIBILITY",
        json.dumps(
            {
                "renderable": len(visibility),
                "sourceVisibleRender": sum(not row["hideRender"] for row in visibility),
                "sourceHiddenRender": sum(row["hideRender"] for row in visibility),
                "hiddenNames": [row["name"] for row in visibility if row["hideRender"]],
            }
        ),
    )


if __name__ == "__main__":
    main()
