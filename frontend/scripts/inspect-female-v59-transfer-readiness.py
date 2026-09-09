"""Measure whether male source meshes retain usable vertex correspondence in female v58."""

from __future__ import annotations

import json
import re

import bpy


FEMALE_PREFIX = re.compile(r"^FEMALE_(?:[A-Z0-9]+_)*")
SURFACE_TERMS = ("fascia", "aponeurosis", "retinaculum", "iliotibial tract", "tendon")


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def canonical_name(obj: bpy.types.Object) -> str:
    return str(obj.get("sourceName") or FEMALE_PREFIX.sub("", obj.name))


def main() -> None:
    male_collection = bpy.data.collections.get("4: Muscular system")
    female_collection = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if male_collection is None or female_collection is None:
        raise RuntimeError("Required collections are missing")

    male = {obj for obj in recursive_objects(male_collection) if obj.type == "MESH"}
    female = {obj for obj in recursive_objects(female_collection) if obj.type == "MESH"}
    male_by_name = {obj.name.casefold(): obj for obj in male}

    rows = []
    same_topology = 0
    correspondence_vertices = 0
    for obj in sorted(female, key=lambda item: item.name):
        source = male_by_name.get(canonical_name(obj).casefold())
        if source is None:
            continue
        same = len(source.data.vertices) == len(obj.data.vertices) and len(source.data.polygons) == len(
            obj.data.polygons
        )
        if same:
            same_topology += 1
            correspondence_vertices += len(obj.data.vertices)
        rows.append(
            {
                "female": obj.name,
                "source": source.name,
                "femaleVertices": len(obj.data.vertices),
                "maleVertices": len(source.data.vertices),
                "sameTopology": same,
            }
        )

    payload = {
        "maleMeshes": len(male),
        "femaleMeshes": len(female),
        "matchedByCanonicalName": len(rows),
        "sameTopologyPairs": same_topology,
        "correspondenceVertices": correspondence_vertices,
        "unmatchedFemale": len(female) - len(rows),
        "topologyMismatch": [row for row in rows if not row["sameTopology"]],
    }
    female_names = {canonical_name(obj).casefold() for obj in female}
    missing = [
        obj
        for obj in male
        if any(term in obj.name.casefold() for term in SURFACE_TERMS) and obj.name.casefold() not in female_names
    ]
    payload["missingSurface"] = {
        "objects": len(missing),
        "renderableObjects": sum(bool(obj.data.polygons) for obj in missing),
        "vertices": sum(len(obj.data.vertices) for obj in missing),
        "polygons": sum(len(obj.data.polygons) for obj in missing),
        "zeroPolygonHelpers": sorted(obj.name for obj in missing if not obj.data.polygons),
    }
    print("IEOBOM_V59_READINESS", json.dumps(payload, ensure_ascii=False))


if __name__ == "__main__":
    main()
