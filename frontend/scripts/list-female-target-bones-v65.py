"""List target bone objects and metadata in the female authoring file."""

import json
import re

import bpy


pattern = re.compile(r"clavicle|sternum|manubrium|hip.?bone|sacrum|coccyx", re.I)
records = []
for obj in bpy.data.objects:
    if obj.type != "MESH" or not obj.data.polygons:
        continue
    text = " ".join(
        (obj.name, str(obj.get("sourceName", "")), str(obj.get("label", "")), str(obj.get("anatomyId", "")))
    )
    if pattern.search(text):
        records.append(
            {
                "name": obj.name,
                "sourceName": obj.get("sourceName"),
                "label": obj.get("label"),
                "anatomyId": obj.get("anatomyId"),
                "system": obj.get("anatomySystem"),
                "collections": [collection.name for collection in obj.users_collection],
                "vertices": len(obj.data.vertices),
            }
        )
print("IEOBOM_V65_TARGET_BONES", json.dumps(records, ensure_ascii=False), flush=True)
