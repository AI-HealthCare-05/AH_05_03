"""Export a non-duplicating upper-body supplement from official Z-Anatomy.

Usage:
  blender --background <Startup.blend> --python scripts/build-z-anatomy-complete-upper-layer.py -- \
    <core.glb> <full-body.metadata.json> <output.glb> <report.json>

The output covers trunk and both upper limbs through the wrists. Structures
already present in the initial Ieobom core, taxonomy helpers, external surface
regions, hands, and pelvis-only structures are excluded.
"""

import bpy
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path


arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(arguments) != 4:
    raise SystemExit("expected <core.glb> <metadata.json> <output.glb> <report.json>")

core_path = Path(arguments[0]).resolve()
metadata_path = Path(arguments[1]).resolve()
output = Path(arguments[2]).resolve()
report_path = Path(arguments[3]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
report_path.parent.mkdir(parents=True, exist_ok=True)

REGION_COLLECTIONS = ("Trunk", "Left upper limb", "Right upper limb")
EXCLUDED_REGION_COLLECTIONS = {"Pelvis", "Left hand", "Right hand"}
SYSTEM_COLLECTIONS = {
    "1: Skeletal system": "skeletal",
    "3: Joints": "skeletal",
    "4: Muscular system": "muscular",
    "5: Cardiovascular system": "cardiovascular",
    "6: Lymphoid organs": "lymphatic",
    "7: Nervous system & Sense organs": "nervous",
}
SYSTEM_COLORS = {
    "skeletal": (0.76, 0.90, 0.96, 1.0),
    "muscular": (0.68, 0.27, 0.20, 1.0),
    "cardiovascular": (0.72, 0.12, 0.16, 1.0),
    "lymphatic": (0.25, 0.62, 0.38, 1.0),
    "nervous": (0.82, 0.67, 0.18, 1.0),
    "digestive": (0.70, 0.42, 0.18, 1.0),
    "endocrine": (0.63, 0.30, 0.72, 1.0),
    "reproductive": (0.72, 0.32, 0.48, 1.0),
    "respiratory": (0.42, 0.67, 0.80, 1.0),
    "urinary": (0.60, 0.42, 0.68, 1.0),
}


def normalized_name(value):
    value = value.strip().lower()
    value = re.sub(r"\s*\(([lr])\)\s*$", r".\1", value)
    value = value.replace("left", "l").replace("right", "r")
    return re.sub(r"[^a-z0-9]+", "", value)


def slugify(value):
    side = ""
    if value.endswith(".l"):
        value, side = value[:-2], "-left"
    elif value.endswith(".r"):
        value, side = value[:-2], "-right"
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return f"official-upper-{slug}{side}"


def visceral_system(collection_names):
    if "Respiratory system" in collection_names:
        return "respiratory"
    if "Urinary system" in collection_names:
        return "urinary"
    if "Endocrine glands" in collection_names:
        return "endocrine"
    if "Genital systems'" in collection_names:
        return "reproductive"
    return "digestive"


def system_of(obj):
    names = {collection.name for collection in obj.users_collection}
    matches = {system for collection, system in SYSTEM_COLLECTIONS.items() if collection in names}
    if "8: Visceral systems" in names:
        matches.add(visceral_system(names))
    if len(matches) != 1:
        raise RuntimeError(f"ambiguous upper anatomy system for {obj.name}: {sorted(matches)}")
    return next(iter(matches))


metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
metadata_by_id = {structure["id"]: structure for structure in metadata["structures"]}
official_objects = set(bpy.data.objects)
bpy.ops.import_scene.gltf(filepath=str(core_path))
imported_core_objects = [obj for obj in bpy.data.objects if obj not in official_objects]
core_names = {
    normalized_name(metadata_by_id[anatomy_id]["name"])
    for obj in imported_core_objects
    if (anatomy_id := str(obj.get("anatomyId", ""))) in metadata_by_id
}
for obj in imported_core_objects:
    bpy.data.objects.remove(obj, do_unlink=True)

region_objects = set()
for collection_name in REGION_COLLECTIONS:
    collection = bpy.data.collections.get(collection_name)
    if collection is None:
        raise RuntimeError(f"official Z-Anatomy collection was not found: {collection_name}")
    region_objects.update(collection.objects)


def is_renderable_region_anatomy(obj):
    names = {collection.name for collection in obj.users_collection}
    if names & EXCLUDED_REGION_COLLECTIONS or "9: Regions of human body" in names:
        return False
    if not (names & set(SYSTEM_COLLECTIONS) or "8: Visceral systems" in names):
        return False
    if obj.type == "MESH":
        return len(obj.data.vertices) > 3
    if obj.type == "CURVE":
        return len(obj.data.splines) > 0
    return False


def is_renderable_supplement(obj):
    if not is_renderable_region_anatomy(obj):
        return False
    if normalized_name(obj.name) in core_names:
        return False
    return True


source_objects = sorted(
    (obj for obj in region_objects if is_renderable_supplement(obj)),
    key=lambda obj: obj.name,
)
core_duplicates_excluded = sum(
    is_renderable_region_anatomy(obj) and normalized_name(obj.name) in core_names
    for obj in region_objects
)
anatomy_ids = [slugify(obj.name) for obj in source_objects]
if len(anatomy_ids) != len(set(anatomy_ids)):
    raise RuntimeError("complete upper selection produced duplicate anatomy IDs")

export_collection = bpy.data.collections.new("IEOBOM_Complete_Upper")
bpy.context.scene.collection.children.link(export_collection)
materials = {}
for system, color in SYSTEM_COLORS.items():
    material = bpy.data.materials.new(f"IEOBOM_{system}")
    material.diffuse_color = color
    materials[system] = material

depsgraph = bpy.context.evaluated_depsgraph_get()
system_counts = Counter()
type_counts = Counter()
exported_objects = []
for source in source_objects:
    system = system_of(source)
    mesh = bpy.data.meshes.new_from_object(
        source.evaluated_get(depsgraph),
        preserve_all_data_layers=True,
        depsgraph=depsgraph,
    )
    if not mesh.vertices or not mesh.polygons:
        bpy.data.meshes.remove(mesh)
        continue

    mesh.materials.clear()
    mesh.materials.append(materials[system])
    for polygon in mesh.polygons:
        polygon.material_index = 0

    exported = bpy.data.objects.new(source.name, mesh)
    exported.matrix_world = source.matrix_world.copy()
    exported["anatomyId"] = slugify(source.name)
    exported["anatomySystem"] = system
    exported["label"] = source.name
    exported["sourceAtlas"] = "Z-Anatomy official 32693313"
    export_collection.objects.link(exported)
    exported_objects.append(exported)
    system_counts[system] += 1
    type_counts[source.type] += 1

if not exported_objects:
    raise RuntimeError("complete upper export selected no renderable objects")

bpy.ops.object.select_all(action="DESELECT")
for obj in exported_objects:
    obj.select_set(True)
bpy.context.view_layer.objects.active = exported_objects[0]
bpy.ops.export_scene.gltf(
    filepath=str(output),
    export_format="GLB",
    use_selection=True,
    export_apply=True,
    export_materials="EXPORT",
    export_extras=True,
    export_draco_mesh_compression_enable=True,
    export_draco_mesh_compression_level=6,
)

report = {
    "source": "Z-Anatomy official Models-of-human-anatomy@32693313",
    "policy": "renderable trunk and bilateral upper-limb structures through the wrists; excludes initial-core duplicates, taxonomy helpers, external regions, hands, and pelvis-only structures",
    "coreStructureNames": len(core_names),
    "coreDuplicatesExcluded": core_duplicates_excluded,
    "objects": len(exported_objects),
    "sourceTypes": dict(sorted(type_counts.items())),
    "systems": dict(sorted(system_counts.items())),
    "vertices": sum(len(obj.data.vertices) for obj in exported_objects),
    "triangles": sum(len(obj.data.polygons) for obj in exported_objects),
    "bytes": output.stat().st_size,
    "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    "output": output.name,
}
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("IEOBOM_Z_ANATOMY_COMPLETE_UPPER=" + json.dumps(report, ensure_ascii=False))
