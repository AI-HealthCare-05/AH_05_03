"""Export the complete renderable head anatomy from the official Z-Anatomy blend.

Usage:
  blender --background <Startup.blend> --python scripts/build-z-anatomy-complete-head-layer.py -- \
    <output.glb> <report.json>

The official file contains two-vertex taxonomy helpers and external surface-region
meshes alongside anatomy. This exporter keeps every renderable skeletal, joint,
muscular, cardiovascular, lymphatic, nervous, and sense-organ object linked to
the Head collection while excluding those helpers and the redundant skin regions.
"""

import bpy
import hashlib
import json
import re
import sys
from collections import Counter
from pathlib import Path


arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(arguments) != 2:
    raise SystemExit("expected <output.glb> <report.json>")

output = Path(arguments[0]).resolve()
report_path = Path(arguments[1]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
report_path.parent.mkdir(parents=True, exist_ok=True)

head = bpy.data.collections.get("Head")
if head is None:
    raise RuntimeError("official Z-Anatomy Head collection was not found")

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
}


def system_of(obj):
    names = {collection.name for collection in obj.users_collection}
    matches = [system for collection, system in SYSTEM_COLLECTIONS.items() if collection in names]
    if len(set(matches)) != 1:
        raise RuntimeError(f"ambiguous head anatomy system for {obj.name}: {matches}")
    return matches[0]


def is_renderable_anatomy(obj):
    collection_names = {collection.name for collection in obj.users_collection}
    if "9: Regions of human body" in collection_names:
        return False
    if not any(collection in collection_names for collection in SYSTEM_COLLECTIONS):
        return False
    if obj.type == "MESH":
        return len(obj.data.vertices) > 3
    if obj.type == "CURVE":
        return len(obj.data.splines) > 0
    return False


def slugify(value):
    side = ""
    if value.endswith(".l"):
        value, side = value[:-2], "-left"
    elif value.endswith(".r"):
        value, side = value[:-2], "-right"
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return f"official-head-{slug}{side}"


export_collection = bpy.data.collections.new("IEOBOM_Complete_Head")
bpy.context.scene.collection.children.link(export_collection)
materials = {}
for system, color in SYSTEM_COLORS.items():
    material = bpy.data.materials.new(f"IEOBOM_{system}")
    material.diffuse_color = color
    materials[system] = material

depsgraph = bpy.context.evaluated_depsgraph_get()
source_objects = sorted(
    (obj for obj in head.objects if is_renderable_anatomy(obj)),
    key=lambda obj: obj.name,
)
system_counts = Counter()
type_counts = Counter()
exported_objects = []

for source in source_objects:
    system = system_of(source)
    evaluated = source.evaluated_get(depsgraph)
    mesh = bpy.data.meshes.new_from_object(
        evaluated,
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
    raise RuntimeError("complete head export selected no renderable objects")

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
)

report = {
    "source": "Z-Anatomy official Models-of-human-anatomy@32693313",
    "policy": "every renderable Head object in systems 1, 3, 4, 5, 6, and 7; excludes two-vertex taxonomy helpers and system 9 external surface regions",
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
print("IEOBOM_Z_ANATOMY_COMPLETE_HEAD=" + json.dumps(report, ensure_ascii=False))
