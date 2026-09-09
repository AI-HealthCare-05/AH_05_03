"""Audit broad superficial muscle/fascia coverage in the male source and female export."""

from __future__ import annotations

import json
import re

import bpy
from mathutils import Vector


SURFACE_TERMS = (
    "fascia",
    "aponeurosis",
    "retinaculum",
    "iliotibial tract",
    "tendon",
)
REGION_TERMS = (
    "trapezius",
    "deltoid",
    "latissimus",
    "rhomboid",
    "infraspinatus",
    "supraspinatus",
    "subscapularis",
    "pectoralis",
    "gluteus maximus",
    "gluteus medius",
    "tensor fasciae latae",
    "iliotibial",
    "quadriceps",
    "rectus femoris",
    "vastus",
    "patellar",
    "gastrocnemius",
    "soleus",
)
FEMALE_PREFIX = re.compile(r"^FEMALE_(?:[A-Z0-9]+_)*")


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def canonical_name(obj: bpy.types.Object) -> str:
    source = str(obj.get("sourceName") or "")
    if source:
        return source
    return FEMALE_PREFIX.sub("", obj.name)


def world_bounds(obj: bpy.types.Object) -> tuple[Vector, Vector]:
    points = [obj.matrix_world @ Vector(corner) for corner in obj.bound_box]
    low = Vector(tuple(min(point[axis] for point in points) for axis in range(3)))
    high = Vector(tuple(max(point[axis] for point in points) for axis in range(3)))
    return low, high


def mesh_area(obj: bpy.types.Object) -> float:
    scale = obj.matrix_world.to_3x3()
    return sum(
        (
            (scale @ (obj.data.vertices[p.vertices[1]].co - obj.data.vertices[p.vertices[0]].co)).cross(
                scale @ (obj.data.vertices[p.vertices[2]].co - obj.data.vertices[p.vertices[0]].co)
            )
        ).length
        * 0.5
        for p in obj.data.polygons
        if len(p.vertices) >= 3
    )


def record(obj: bpy.types.Object) -> dict[str, object]:
    low, high = world_bounds(obj)
    return {
        "name": obj.name,
        "canonicalName": canonical_name(obj),
        "collections": sorted(collection.name for collection in obj.users_collection),
        "vertices": len(obj.data.vertices),
        "polygons": len(obj.data.polygons),
        "surfaceAreaCm2": round(mesh_area(obj) * 10000.0, 2),
        "sizeMm": [round((high[axis] - low[axis]) * 1000.0, 2) for axis in range(3)],
        "materials": [slot.material.name if slot.material else None for slot in obj.material_slots],
        "hiddenViewport": obj.hide_viewport,
        "hiddenRender": obj.hide_render,
    }


def main() -> None:
    male_collection = bpy.data.collections.get("4: Muscular system")
    female_collection = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if male_collection is None or female_collection is None:
        raise RuntimeError("Required male/female muscle collections missing")
    male = {obj for obj in recursive_objects(male_collection) if obj.type == "MESH"}
    female = {obj for obj in recursive_objects(female_collection) if obj.type == "MESH"}

    male_by_name = {obj.name.casefold(): obj for obj in male}
    female_by_canonical: dict[str, list[bpy.types.Object]] = {}
    for obj in female:
        female_by_canonical.setdefault(canonical_name(obj).casefold(), []).append(obj)

    male_surface = [obj for obj in male if any(term in obj.name.casefold() for term in SURFACE_TERMS)]
    female_surface = [obj for obj in female if any(term in canonical_name(obj).casefold() for term in SURFACE_TERMS)]
    missing_surface = []
    for obj in male_surface:
        if obj.name.casefold() not in female_by_canonical:
            missing_surface.append(record(obj))

    regional = []
    candidates = {
        canonical_name(obj).casefold()
        for obj in male | female
        if any(term in canonical_name(obj).casefold() for term in REGION_TERMS)
    }
    for name in sorted(candidates):
        male_obj = male_by_name.get(name)
        female_objs = female_by_canonical.get(name, [])
        regional.append(
            {
                "canonicalName": name,
                "male": record(male_obj) if male_obj else None,
                "female": [record(obj) for obj in female_objs],
            }
        )

    largest_male = sorted((record(obj) for obj in male), key=lambda row: -row["surfaceAreaCm2"])[:30]
    largest_female = sorted((record(obj) for obj in female), key=lambda row: -row["surfaceAreaCm2"])[:30]
    selected = bpy.data.objects.get("Superficial investing cervical fascia.l")
    payload = {
        "counts": {
            "maleMuscleMeshes": len(male),
            "femaleExportMeshes": len(female),
            "maleNamedSurfaceLayers": len(male_surface),
            "femaleNamedSurfaceLayers": len(female_surface),
            "maleSurfaceLayersMissingFromFemaleExport": len(missing_surface),
        },
        "selectedMaleExample": record(selected) if selected and selected.type == "MESH" else None,
        "femaleSurfaceLayers": sorted((record(obj) for obj in female_surface), key=lambda row: -row["surfaceAreaCm2"]),
        "missingSurfaceLayers": sorted(missing_surface, key=lambda row: -row["surfaceAreaCm2"]),
        "regionalPairs": regional,
        "largestMale": largest_male,
        "largestFemale": largest_female,
    }
    print("IEOBOM_SUPERFICIAL_COVERAGE", json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
