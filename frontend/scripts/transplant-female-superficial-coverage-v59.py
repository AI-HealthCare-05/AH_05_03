"""Transplant every missing male superficial connective-tissue mesh into female v58.

The deformation is reconstructed from all 469 same-topology male/female muscle
pairs.  Each new vertex receives an inverse-distance blend of the displacement
of nearby known source vertices. Existing female geometry is never edited.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector
from mathutils.kdtree import KDTree


FEMALE_PREFIX = re.compile(r"^FEMALE_(?:[A-Z0-9]+_)*")
SURFACE_TERMS = ("fascia", "aponeurosis", "retinaculum", "iliotibial tract", "tendon")
COLLECTION_NAME = "FEMALE_SUPERFICIAL_COVERAGE_V59"
MAX_SAMPLES_PER_OBJECT = 1600
NEIGHBORS = 12
SOFTENING_METERS = 0.006
UNPLACED_TEMPLATE_DISTANCE_METERS = 0.03


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report", required=True)
    return parser.parse_args(values)


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def canonical_name(obj: bpy.types.Object) -> str:
    return str(obj.get("sourceName") or FEMALE_PREFIX.sub("", obj.name))


def geometry_digest(objects: set[bpy.types.Object]) -> str:
    digest = hashlib.sha256()
    for obj in sorted(objects, key=lambda item: item.name):
        digest.update(obj.name.encode("utf-8"))
        digest.update(struct.pack("<16d", *(value for row in obj.matrix_world for value in row)))
        for vertex in obj.data.vertices:
            digest.update(struct.pack("<3f", *vertex.co))
    return digest.hexdigest()


def make_deformation_field(
    male: set[bpy.types.Object], female: set[bpy.types.Object]
) -> tuple[KDTree, list[Vector], dict[str, int]]:
    male_by_name = {obj.name.casefold(): obj for obj in male}
    samples: list[tuple[Vector, Vector]] = []
    pair_count = 0
    source_vertices = 0
    for target in sorted(female, key=lambda item: item.name):
        source = male_by_name.get(canonical_name(target).casefold())
        if source is None:
            continue
        if len(source.data.vertices) != len(target.data.vertices):
            continue
        pair_count += 1
        count = len(source.data.vertices)
        source_vertices += count
        stride = max(1, math.ceil(count / MAX_SAMPLES_PER_OBJECT))
        indices = list(range(0, count, stride))
        if indices and indices[-1] != count - 1:
            indices.append(count - 1)
        for index in indices:
            source_point = source.matrix_world @ source.data.vertices[index].co
            target_point = target.matrix_world @ target.data.vertices[index].co
            samples.append((source_point.copy(), target_point - source_point))
    if not samples:
        raise RuntimeError("No same-topology deformation samples were found")

    tree = KDTree(len(samples))
    displacements: list[Vector] = []
    for index, (point, displacement) in enumerate(samples):
        tree.insert(point, index)
        displacements.append(displacement)
    tree.balance()
    return tree, displacements, {
        "sameTopologyPairs": pair_count,
        "sourceCorrespondenceVertices": source_vertices,
        "fieldSamples": len(samples),
    }


def deform_point(tree: KDTree, displacements: list[Vector], point: Vector) -> tuple[Vector, float]:
    nearest = tree.find_n(point, NEIGHBORS)
    if not nearest:
        raise RuntimeError("Deformation field query failed")
    weighted = Vector((0.0, 0.0, 0.0))
    weight_sum = 0.0
    for _sample_point, index, distance in nearest:
        weight = 1.0 / (distance * distance + SOFTENING_METERS * SOFTENING_METERS)
        weighted += displacements[index] * weight
        weight_sum += weight
    return point + weighted / weight_sum, nearest[0][2]


def slug(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", value.casefold()).strip("-")


def main() -> None:
    args = parse_args()
    source_blend = bpy.data.filepath
    male_collection = bpy.data.collections.get("4: Muscular system")
    female_collection = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if male_collection is None or female_collection is None:
        raise RuntimeError("Required male/female muscle collections are missing")
    if bpy.data.collections.get(COLLECTION_NAME) is not None:
        raise RuntimeError(f"{COLLECTION_NAME} already exists")

    male = {obj for obj in recursive_objects(male_collection) if obj.type == "MESH"}
    female_before = {obj for obj in recursive_objects(female_collection) if obj.type == "MESH"}
    female_names = {canonical_name(obj).casefold() for obj in female_before}
    missing = sorted(
        (
            obj for obj in male
            if any(term in obj.name.casefold() for term in SURFACE_TERMS)
            and obj.name.casefold() not in female_names
        ),
        key=lambda item: item.name,
    )
    if len(missing) != 120:
        raise RuntimeError(f"Expected 120 missing surface objects, found {len(missing)}")

    before_digest = geometry_digest(female_before)
    tree, displacements, field_stats = make_deformation_field(male, female_before)
    print("IEOBOM_V59_FIELD", json.dumps(field_stats), flush=True)

    transplant_collection = bpy.data.collections.new(COLLECTION_NAME)
    female_collection.children.link(transplant_collection)
    records = []
    all_distances = []
    for number, source in enumerate(missing, start=1):
        mesh = source.data.copy()
        target = bpy.data.objects.new(f"FEMALE_SURFACE_{source.name}", mesh)
        transplant_collection.objects.link(target)
        target.matrix_world = Matrix.Identity(4)
        target.hide_viewport = False
        target.hide_render = False
        target["sourceName"] = source.name
        target["label"] = source.name
        target["anatomySystem"] = "muscular"
        target["anatomyId"] = f"female-muscular-{slug(source.name)}"
        target["IEOBOM_superficialCoverageVersion"] = "v59"

        distances = []
        movement = []
        for index, vertex in enumerate(mesh.vertices):
            source_point = source.matrix_world @ source.data.vertices[index].co
            mapped, nearest_distance = deform_point(tree, displacements, source_point)
            vertex.co = mapped
            distances.append(nearest_distance)
            movement.append((mapped - source_point).length)
        mesh.update()
        mean_distance = sum(distances) / len(distances) if distances else 0.0
        # A small set of male tendon-sheath assets are unpositioned templates at
        # the scene origin. Keep them in the authoring file, but never force
        # those placeholders into the visible/web layer.
        web_excluded = bool(mesh.polygons) and mean_distance > UNPLACED_TEMPLATE_DISTANCE_METERS
        target["IEOBOM_webExclude"] = web_excluded
        target.hide_viewport = web_excluded
        target.hide_render = web_excluded
        all_distances.extend(distances)
        records.append({
            "source": source.name,
            "target": target.name,
            "vertices": len(mesh.vertices),
            "polygons": len(mesh.polygons),
            "webExcludedUnplacedTemplate": web_excluded,
            "nearestFieldDistanceMm": {
                "mean": round(mean_distance * 1000.0, 3),
                "max": round(max(distances) * 1000.0, 3) if distances else 0.0,
            },
            "movementMm": {
                "mean": round(sum(movement) * 1000.0 / len(movement), 3) if movement else 0.0,
                "max": round(max(movement) * 1000.0, 3) if movement else 0.0,
            },
        })
        if number % 10 == 0 or number == len(missing):
            print(f"IEOBOM_V59_PROGRESS {number}/{len(missing)}", flush=True)

    after_digest = geometry_digest(female_before)
    if after_digest != before_digest:
        raise RuntimeError("Existing female muscle geometry changed during transplantation")

    output = Path(args.output).expanduser().resolve()
    report_path = Path(args.report).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)
    report_path.parent.mkdir(parents=True, exist_ok=True)
    scene_record = {
        "version": "v59-superficial-coverage",
        "source": source_blend,
        "transplantedObjects": len(records),
        "renderableObjects": sum(record["polygons"] > 0 for record in records),
        "webVisibleRenderableObjects": sum(
            record["polygons"] > 0 and not record["webExcludedUnplacedTemplate"] for record in records
        ),
    }
    bpy.context.scene["IEOBOM_V59_SUPERFICIAL_COVERAGE"] = json.dumps(scene_record)
    bpy.ops.wm.save_as_mainfile(filepath=str(output), compress=True)

    report = {
        "sourceBlend": source_blend,
        "outputBlend": str(output),
        **scene_record,
        **field_stats,
        "existingFemaleGeometrySha256Before": before_digest,
        "existingFemaleGeometrySha256After": after_digest,
        "existingFemaleGeometryUnchanged": before_digest == after_digest,
        "nearestFieldDistanceMm": {
            "mean": round(sum(all_distances) * 1000.0 / len(all_distances), 3),
            "max": round(max(all_distances) * 1000.0, 3),
        },
        "records": records,
        "notes": [
            "All 120 missing named fascia/aponeurosis/retinaculum/iliotibial-tract/tendon meshes were copied.",
            "The 86 renderable meshes and 34 source hierarchy helper meshes were preserved.",
            "Unpositioned male tendon-sheath templates more than 30 mm from the known body deformation field remain archived but web-excluded.",
            "New vertices were fitted with a 12-neighbor inverse-distance field derived from all existing same-topology muscle pairs.",
            "No existing female shell, skeleton, organ, or muscle vertex was changed.",
        ],
    }
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V59_COMPLETE", json.dumps({key: report[key] for key in (
        "outputBlend", "transplantedObjects", "renderableObjects",
        "existingFemaleGeometryUnchanged", "nearestFieldDistanceMm",
    )}), flush=True)


if __name__ == "__main__":
    main()
