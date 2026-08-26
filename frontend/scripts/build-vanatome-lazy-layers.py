"""Extract focus-triggered Vanatome layers from the full-body GLB.

Usage:
  blender --background --python scripts/build-vanatome-lazy-layers.py -- \
    <full-body.glb> <output-directory>
"""

import bpy
import hashlib
import json
import sys
from pathlib import Path


arguments = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
if len(arguments) != 2:
    raise SystemExit("expected <full-body.glb> <output-directory>")

source = Path(arguments[0]).resolve()
output_directory = Path(arguments[1]).resolve()
output_directory.mkdir(parents=True, exist_ok=True)

bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(source))
meshes = [obj for obj in bpy.context.scene.objects if obj.type == "MESH"]


def anatomy_id(obj):
    return str(obj.get("anatomyId", "")).lower()


def anatomy_system(obj):
    return str(obj.get("anatomySystem", "")).lower()


muscles = [obj for obj in meshes if anatomy_system(obj) == "muscular"]

head_neck_prefixes = ("facial-expression-muscles-", "neck-muscles-")
hand_prefixes = ("hand-muscles-",)
lower_prefixes = (
    "deep-gluteal-muscles-",
    "superficial-gluteal-muscles-",
    "inguinal-ligaments-",
)

head_neck = [obj for obj in muscles if anatomy_id(obj).startswith(head_neck_prefixes)]
hand = [obj for obj in muscles if anatomy_id(obj).startswith(hand_prefixes)]
lower = [obj for obj in muscles if anatomy_id(obj).startswith(lower_prefixes)]
assigned = set(head_neck + hand + lower)
upper = [obj for obj in muscles if obj not in assigned]

layers = {
    "muscles-upper-core": upper,
    "muscles-lower-pelvic": lower,
    "muscles-hands": hand,
}

if set().union(set(head_neck), *[set(objects) for objects in layers.values()]) != set(muscles):
    raise RuntimeError("lazy-layer classification did not match the requested focus structures")


def export_layer(layer_id, objects):
    output = output_directory / f"vanatome-1.4.0-{layer_id}.glb"
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.select_set(True)
    bpy.context.view_layer.objects.active = objects[0]
    bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_apply=True,
        export_materials="EXPORT",
        export_extras=True,
    )
    return {
        "id": layer_id,
        "objects": len(objects),
        "vertices": sum(len(obj.data.vertices) for obj in objects),
        "triangles": sum(len(obj.data.polygons) for obj in objects),
        "bytes": output.stat().st_size,
        "sha256": hashlib.sha256(output.read_bytes()).hexdigest(),
        "output": output.name,
    }


report = {
    "source": source.name,
    "policy": "regional muscular layers only; the 97 head/neck muscles are supplied by the official complete-head layer",
    "excludedHeadNeckMuscles": len(head_neck),
    "layers": [export_layer(layer_id, objects) for layer_id, objects in layers.items()],
}
(output_directory / "vanatome-1.4.0-lazy-layers.report.json").write_text(
    json.dumps(report, ensure_ascii=False, indent=2) + "\n",
    encoding="utf-8",
)
print("IEOBOM_VANATOME_LAZY_LAYERS=" + json.dumps(report, ensure_ascii=False))
