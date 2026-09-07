"""Export the 20 bilateral costal cartilages from official Z-Anatomy.

Usage:
  blender --background <Startup.blend> --python scripts/build-z-anatomy-costal-cartilage-layer.py -- \
    <output.glb> <report.json>
"""

import bpy
import hashlib
import json
import re
import sys
from pathlib import Path


arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(arguments) != 2:
    raise SystemExit("expected <output.glb> <report.json>")

output = Path(arguments[0]).resolve()
report_path = Path(arguments[1]).resolve()
output.parent.mkdir(parents=True, exist_ok=True)
report_path.parent.mkdir(parents=True, exist_ok=True)

ORDINALS = {
    "first": 1,
    "second": 2,
    "third": 3,
    "fourth": 4,
    "fifth": 5,
    "sixth": 6,
    "seventh": 7,
    "eighth": 8,
    "ninth": 9,
    "tenth": 10,
}
NAME_PATTERN = re.compile(
    r"^Costal cartilage of (first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth) rib\.([lr])$"
)


def anatomy_id(name):
    match = NAME_PATTERN.fullmatch(name)
    if not match:
        raise RuntimeError(f"unexpected costal cartilage name: {name}")
    ordinal, side = match.groups()
    side_name = "left" if side == "l" else "right"
    return f"costal-cartilage-rib-{ORDINALS[ordinal]:02d}-{side_name}"


source_objects = sorted(
    (obj for obj in bpy.data.objects if obj.type == "MESH" and NAME_PATTERN.fullmatch(obj.name)),
    key=lambda obj: anatomy_id(obj.name),
)
if len(source_objects) != 20:
    raise RuntimeError(
        f"expected exactly 20 individual costal cartilages, found {len(source_objects)}: "
        + ", ".join(obj.name for obj in source_objects)
    )

export_collection = bpy.data.collections.new("IEOBOM_Costal_Cartilages")
bpy.context.scene.collection.children.link(export_collection)
material = bpy.data.materials.new("IEOBOM_costal_cartilage")
material.diffuse_color = (0.73, 0.88, 0.93, 1.0)

depsgraph = bpy.context.evaluated_depsgraph_get()
exported_objects = []
for source in source_objects:
    mesh = bpy.data.meshes.new_from_object(
        source.evaluated_get(depsgraph),
        preserve_all_data_layers=True,
        depsgraph=depsgraph,
    )
    if not mesh.vertices or not mesh.polygons:
        bpy.data.meshes.remove(mesh)
        raise RuntimeError(f"costal cartilage is not renderable: {source.name}")

    mesh.materials.clear()
    mesh.materials.append(material)
    for polygon in mesh.polygons:
        polygon.material_index = 0

    exported = bpy.data.objects.new(source.name, mesh)
    exported.matrix_world = source.matrix_world.copy()
    exported["anatomyId"] = anatomy_id(source.name)
    exported["anatomySystem"] = "skeletal"
    exported["tissueType"] = "costal-cartilage"
    exported["label"] = source.name
    exported["sourceAtlas"] = "Z-Anatomy official 32693313"
    export_collection.objects.link(exported)
    exported_objects.append(exported)

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
    "policy": "individual left and right first-through-tenth costal cartilages; excludes labels and aggregate/helper meshes",
    "objects": len(exported_objects),
    "systems": {"skeletal": len(exported_objects)},
    "tissueType": "costal-cartilage",
    "vertices": sum(len(obj.data.vertices) for obj in exported_objects),
    "triangles": sum(len(obj.data.polygons) for obj in exported_objects),
    "names": [obj.name for obj in exported_objects],
    "bytes": output.stat().st_size,
    "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
    "output": output.name,
}
report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
print("IEOBOM_Z_ANATOMY_COSTAL_CARTILAGES=" + json.dumps(report, ensure_ascii=False))
