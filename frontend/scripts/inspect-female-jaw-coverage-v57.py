"""Inspect fitted female jaw muscle bounds, boundary vertices, and materials."""

from __future__ import annotations

import json

import bpy
import numpy as np
from mathutils.bvhtree import BVHTree


TERMS = (
    "masseter",
    "temporalis",
    "depressor",
    "mentalis",
    "orbicularis oris",
    "digastric",
    "mylohyoid",
    "geniohyoid",
    "platysma",
    "risorius",
    "buccinator",
)


def boundary_indices(mesh: bpy.types.Mesh) -> set[int]:
    edge_faces = [0] * len(mesh.edges)
    edge_lookup = {tuple(sorted(edge.vertices)): edge.index for edge in mesh.edges}
    for polygon in mesh.polygons:
        for index in range(len(polygon.vertices)):
            pair = tuple(sorted((polygon.vertices[index], polygon.vertices[(index + 1) % len(polygon.vertices)])))
            edge_faces[edge_lookup[pair]] += 1
    result: set[int] = set()
    for edge, count in zip(mesh.edges, edge_faces, strict=False):
        if count == 1:
            result.update(edge.vertices)
    return result


def main() -> None:
    collection = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if collection is None:
        raise RuntimeError("FEMALE_MUSCLE_WORK missing")
    shell_collection = bpy.data.collections.get("SHELL_V15")
    shell = (
        next((obj for obj in shell_collection.all_objects if obj.type == "MESH"), None) if shell_collection else None
    )
    bvh = BVHTree.FromObject(shell, bpy.context.evaluated_depsgraph_get()) if shell else None
    shell_inverse = shell.matrix_world.inverted() if shell else None
    shell_normal_matrix = shell.matrix_world.to_3x3().inverted().transposed() if shell else None
    scalp = bpy.data.collections.get("FEMALE_MUSCLE_SCALP")
    source_rows = []
    target_rows = []
    if scalp:
        for female in scalp.all_objects:
            source_name = str(female.get("sourceName") or "")
            if not source_name and female.name.startswith("FEMALE_SCALP_"):
                source_name = female.name.removeprefix("FEMALE_SCALP_")
            source = bpy.data.objects.get(source_name)
            if (
                female.type != "MESH"
                or source is None
                or source.type != "MESH"
                or "Epicranial aponeurosis" in female.name
            ):
                continue
            if len(source.data.vertices) != len(female.data.vertices):
                continue
            stride = max(1, len(source.data.vertices) // 1000)
            for index in range(0, len(source.data.vertices), stride):
                source_point = source.matrix_world @ source.data.vertices[index].co
                target_point = female.matrix_world @ female.data.vertices[index].co
                source_rows.append([source_point.x, source_point.y, source_point.z, 1.0])
                target_rows.append([target_point.x, target_point.y, target_point.z])
    coefficients = np.linalg.lstsq(np.asarray(source_rows), np.asarray(target_rows), rcond=None)[0]
    records = []
    for obj in collection.all_objects:
        name = obj.name.lower()
        if obj.type != "MESH" or not any(term in name for term in TERMS):
            continue
        points = [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]
        boundary = boundary_indices(obj.data)
        boundary_points = [obj.matrix_world @ obj.data.vertices[index].co for index in boundary]
        material_faces: dict[str, int] = {}
        for polygon in obj.data.polygons:
            slot = (
                obj.material_slots[polygon.material_index] if polygon.material_index < len(obj.material_slots) else None
            )
            material_name = slot.material.name if slot and slot.material else "<none>"
            material_faces[material_name] = material_faces.get(material_name, 0) + 1
        upper_samples = []
        if bvh and "platysma" in name:
            for point in points:
                if point.z < 1.455 or point.y > -0.015:
                    continue
                nearest, normal, _, _ = bvh.find_nearest(shell_inverse @ point)
                if nearest is None or normal is None:
                    continue
                nearest_world = shell.matrix_world @ nearest
                normal_world = (shell_normal_matrix @ normal).normalized()
                upper_samples.append((point - nearest_world).dot(normal_world) * 1000.0)
        mapped_bounds = None
        source = bpy.data.objects.get(str(obj.get("sourceName") or ""))
        if source is not None and source.type == "MESH" and len(source.data.vertices) == len(obj.data.vertices):
            mapped = []
            for vertex in source.data.vertices:
                p = source.matrix_world @ vertex.co
                mapped.append(np.asarray([p.x, p.y, p.z, 1.0]) @ coefficients)
            mapped_bounds = {
                "x": [round(float(min(p[0] for p in mapped)), 5), round(float(max(p[0] for p in mapped)), 5)],
                "y": [round(float(min(p[1] for p in mapped)), 5), round(float(max(p[1] for p in mapped)), 5)],
                "z": [round(float(min(p[2] for p in mapped)), 5), round(float(max(p[2] for p in mapped)), 5)],
            }
        records.append(
            {
                "name": obj.name,
                "sourceName": obj.get("sourceName"),
                "vertices": len(points),
                "polygons": len(obj.data.polygons),
                "boundaryVertices": len(boundary),
                "bounds": {
                    "x": [round(min(p.x for p in points), 5), round(max(p.x for p in points), 5)],
                    "y": [round(min(p.y for p in points), 5), round(max(p.y for p in points), 5)],
                    "z": [round(min(p.z for p in points), 5), round(max(p.z for p in points), 5)],
                },
                "boundaryBounds": None
                if not boundary_points
                else {
                    "x": [round(min(p.x for p in boundary_points), 5), round(max(p.x for p in boundary_points), 5)],
                    "y": [round(min(p.y for p in boundary_points), 5), round(max(p.y for p in boundary_points), 5)],
                    "z": [round(min(p.z for p in boundary_points), 5), round(max(p.z for p in boundary_points), 5)],
                },
                "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
                "materialFaces": material_faces,
                "upperAnteriorShellDistanceMm": None
                if not upper_samples
                else {
                    "vertices": len(upper_samples),
                    "min": round(min(upper_samples), 3),
                    "max": round(max(upper_samples), 3),
                    "mean": round(sum(upper_samples) / len(upper_samples), 3),
                    "deeperThan4mm": sum(value < -4.0 for value in upper_samples),
                },
                "headAffineMappedBounds": mapped_bounds,
            }
        )
    records.sort(key=lambda row: row["name"])
    print("IEOBOM_JAW_INSPECTION", json.dumps(records, ensure_ascii=False))


if __name__ == "__main__":
    main()
