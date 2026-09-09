"""Reduce only the heavy female web layers and save the current Blend.

Run this against a disposable/external-backup-protected authoring file. Small
joint, nerve, lymphatic, urinary and reproductive structures are intentionally
left untouched. Distal hand/foot anatomy keeps three times the general muscle
ratio so fingertips and toe-tip silhouettes remain legible.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

import bpy


DISTAL_PATTERN = re.compile(
    r"(hand|finger|digit|thumb|pollic|metacarp|carpal|foot|toe|halluc|metatars|tarsal)",
    re.IGNORECASE,
)
MAMMARY_DETAIL_PATTERN = re.compile(r"(duct|ligament|nipple|areola)", re.IGNORECASE)


def parse_args():
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    if len(values) != 1:
        raise SystemExit("usage: blender -b FILE --python SCRIPT -- REPORT.json")
    return Path(values[0]).resolve()


def recursive_objects(collection: bpy.types.Collection) -> set[bpy.types.Object]:
    objects = set(collection.objects)
    for child in collection.children:
        objects.update(recursive_objects(child))
    return objects


def collection_objects(name: str) -> set[bpy.types.Object]:
    collection = bpy.data.collections.get(name)
    if collection is None:
        raise RuntimeError(f"Missing collection: {name}")
    return recursive_objects(collection)


def mesh_stats(objects: set[bpy.types.Object]) -> dict[str, int]:
    meshes = [obj for obj in objects if obj.type == "MESH" and obj.data is not None]
    return {
        "objects": len(meshes),
        "vertices": sum(len(obj.data.vertices) for obj in meshes),
        "polygons": sum(len(obj.data.polygons) for obj in meshes),
    }


def decimate(objects: set[bpy.types.Object], ratio_for, minimum_polygons: int) -> int:
    changed = 0
    for obj in sorted(objects, key=lambda item: item.name):
        if obj.type != "MESH" or obj.data is None:
            continue
        polygons = len(obj.data.polygons)
        if polygons <= minimum_polygons:
            continue
        ratio = max(float(ratio_for(obj)), minimum_polygons / polygons)
        ratio = min(1.0, ratio)
        if ratio >= 0.999:
            continue
        if obj.data.users > 1:
            obj.data = obj.data.copy()
        bpy.context.view_layer.objects.active = obj
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.select_set(True)
        modifier = obj.modifiers.new(name="IEOBOM_WEB_DECIMATE", type="DECIMATE")
        modifier.decimate_type = "COLLAPSE"
        modifier.ratio = ratio
        modifier.use_collapse_triangulate = True
        bpy.ops.object.modifier_apply(modifier=modifier.name)
        obj.select_set(False)
        changed += 1
    return changed


def main() -> None:
    report_path = parse_args()
    muscles = collection_objects("FEMALE_MUSCLE_WORK")
    mammary = collection_objects("FEMALE_HRA_MAMMARY_L_WORK") | collection_objects("FEMALE_HRA_MAMMARY_R_WORK")
    organs = {obj for obj in collection_objects("ORGANS_V28") if str(obj.get("anatomyId") or "").lower() != "bladder"}

    groups = {"muscles": muscles, "mammary": mammary, "organs": organs}
    before = {name: mesh_stats(objects) for name, objects in groups.items()}

    # General muscles retain 30%; distal hand/foot structures retain 90% (3x).
    changed = {
        "muscles": decimate(
            muscles,
            lambda obj: 0.90 if DISTAL_PATTERN.search(obj.name) else 0.30,
            minimum_polygons=240,
        ),
        "mammary": decimate(
            mammary,
            lambda obj: 0.70 if MAMMARY_DETAIL_PATTERN.search(obj.name) else 0.35,
            minimum_polygons=500,
        ),
        "organs": decimate(organs, lambda _obj: 0.50, minimum_polygons=500),
    }

    removed_internal_backup = []
    backup_collection = bpy.data.collections.get("FEMALE_HIRES_SHELL_BACKUP")
    if backup_collection is not None:
        for obj in list(recursive_objects(backup_collection)):
            removed_internal_backup.append(obj.name)
            mesh = obj.data if obj.type == "MESH" else None
            bpy.data.objects.remove(obj, do_unlink=True)
            if mesh is not None and mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(backup_collection)

    after = {name: mesh_stats(objects) for name, objects in groups.items()}
    report = {
        "blend": bpy.data.filepath,
        "before": before,
        "after": after,
        "modifiedObjects": changed,
        "removedInternalShellBackup": removed_internal_backup,
    }
    report_path.parent.mkdir(parents=True, exist_ok=True)
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    bpy.ops.wm.save_as_mainfile(filepath=bpy.data.filepath)
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
