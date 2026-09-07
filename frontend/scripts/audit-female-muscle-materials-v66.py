"""Verify that every exported female muscle mesh uses the approved matte shader."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

import bpy


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--report", required=True)
    parser.add_argument("--version", default="v66")
    return parser.parse_args(values)


def recursive_objects(collection):
    result = set(collection.objects)
    for child in collection.children:
        result.update(recursive_objects(child))
    return result


def main():
    args = parse_args()
    collection = bpy.data.collections.get("FEMALE_MUSCLE_WORK")
    if collection is None:
        raise RuntimeError("FEMALE_MUSCLE_WORK missing")
    objects = sorted(
        (
            obj
            for obj in recursive_objects(collection)
            if obj.type == "MESH" and obj.data.polygons and not bool(obj.get("IEOBOM_webExclude"))
        ),
        key=lambda obj: obj.name,
    )
    violations = []
    material_names = set()
    for obj in objects:
        if len(obj.data.materials) != 1 or obj.data.materials[0] is None:
            violations.append({"object": obj.name, "reason": "expected exactly one material"})
            continue
        material = obj.data.materials[0]
        material_names.add(material.name)
        node = material.node_tree.nodes.get("Principled BSDF") if material.use_nodes and material.node_tree else None
        metallic = float(node.inputs["Metallic"].default_value) if node else float(material.metallic)
        roughness = float(node.inputs["Roughness"].default_value) if node else float(material.roughness)
        coat = float(node.inputs["Coat Weight"].default_value) if node and "Coat Weight" in node.inputs else 0.0
        if metallic > 1e-6 or roughness < 0.9 or coat > 1e-6:
            violations.append(
                {
                    "object": obj.name,
                    "material": material.name,
                    "metallic": round(metallic, 6),
                    "roughness": round(roughness, 6),
                    "coat": round(coat, 6),
                }
            )
    payload = {
        "version": args.version,
        "objects": len(objects),
        "materials": sorted(material_names),
        "requirements": {"metallicMax": 0.0, "roughnessMin": 0.9, "coatMax": 0.0},
        "violations": violations,
        "passed": not violations,
    }
    Path(args.report).write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n")
    print("IEOBOM_V66_MATERIAL_AUDIT", json.dumps(payload, ensure_ascii=False), flush=True)
    if violations:
        raise RuntimeError(f"Matte material audit failed for {len(violations)} objects")


if __name__ == "__main__":
    main()
