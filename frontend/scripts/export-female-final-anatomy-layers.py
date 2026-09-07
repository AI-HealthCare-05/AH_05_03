"""Export the approved female anatomy work as web GLB layers.

This script is intended to run against the currently saved authoring blend in a
disposable background Blender process. It never saves a blend file. Backup,
temporary, reference, label, camera and light objects are intentionally omitted.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import struct
import sys
from pathlib import Path

import bpy
from mathutils import Matrix, Vector


FINAL_REPRODUCTIVE = (
    "FEMALE_HRA_TX_VH_F_uterus_cervix_vagina_tubes_ContinuousV54_CATMULL_CONTINUITY",
    "FEMALE_HRA_TX_VH_F_left_ovary",
    "FEMALE_HRA_TX_VH_F_right_ovary",
    "FEMALE_HRA_FIT_ovarian_ligament_L",
    "FEMALE_HRA_FIT_ovarian_ligament_R",
)

FINAL_URINARY = (
    "FEMALE_HRA_TX_VH_F_urinary_bladder_ureters_continuous",
    "FEMALE_HRA_FIT_VH_F_urethra",
)

URINARY_DETAIL_PREFIXES = (
    "FEMALE_HRA_TX_VH_F_major_calyx_",
    "FEMALE_HRA_TX_VH_F_minor_calyx_",
    "FEMALE_HRA_TX_VH_F_renal_pelvis_",
    "FEMALE_HRA_TX_VH_F_trigone_of_urinary_bladder",
    "FEMALE_HRA_TX_VH_F_ureteral_orifice_",
    "FEMALE_HRA_TX_VH_F_urinary_bladder_neck_smooth_muscle",
)

JOINT_SUPPORT_COLLECTION_PREFIXES = (
    "FEMALE_SUPPORT_PHASE5",
    "FEMALE_SUPPORT_PHASE6",
)

NERVOUS_COLLECTIONS = (
    "Central nervous system",
    "Accessory nerve (XI)",
    "Axillary nerve",
    "Common fibular nerve",
    "Deep branch of radial nerve",
    "Deep fibular nerve",
    "Femoral nerve",
    "Glossopharyngeal nerve (IX)",
    "Hypoglossal nerve (XII)",
    "Median nerve",
    "Musculocutaneous nerve",
    "Obturator nerve",
    "Oculomotor nerve (III)",
    "Olfactory nerve (I)",
    "Optic nerve (II)",
    "Radial nerve",
    "Sciatic nerve",
    "Tibial nerve",
    "Trigeminal nerve (V)",
    "Ulnar nerve",
    "Vagus nerve (X)",
    "Vestibulocochlear nerve (VIII)",
)

FEMALE_NERVOUS_SOURCE_COLLECTION = "FEMALE_NERVOUS_EXPORT_SOURCE"
FEMALE_LYMPHATIC_SOURCE_COLLECTION = "FEMALE_LYMPHATIC_EXPORT_SOURCE"


def parse_args() -> argparse.Namespace:
    values = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output-dir", required=True)
    parser.add_argument("--report", required=True)
    parser.add_argument("--shell-version", default="v5")
    parser.add_argument(
        "--only",
        action="append",
        choices=(
            "shell",
            "organs",
            "muscles",
            "support",
            "nervous",
            "lymphatic",
            "reproductive",
            "urinary",
            "mammary",
        ),
        help="Export only the named layer. May be repeated.",
    )
    return parser.parse_args(values)


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


def objects_within_female_frame(
    sources: set[bpy.types.Object],
    authoring_to_world: Matrix,
) -> set[bpy.types.Object]:
    """Drop source-atlas helpers and malformed meshes outside the fitted body."""
    lower = Vector((0.50, -0.20, -0.05))
    upper = Vector((1.43, 0.16, 1.76))
    accepted: set[bpy.types.Object] = set()
    for source in sources:
        if source.type not in {"MESH", "CURVE", "SURFACE"}:
            continue
        points = [authoring_to_world @ source.matrix_world @ Vector(corner) for corner in source.bound_box]
        if all(
            lower.x <= point.x <= upper.x and lower.y <= point.y <= upper.y and lower.z <= point.z <= upper.z
            for point in points
        ):
            accepted.add(source)
    return accepted


def slug(value: str) -> str:
    value = re.sub(r"^(FEMALE_SOURCE__|FEMALE_HRA_(TX|FIT)_|FEMALE_MUSCLE_|FEMALE_SUPPORT_)", "", value)
    value = re.sub(r"[^A-Za-z0-9]+", "-", value).strip("-").lower()
    return value or "structure"


def label(value: str) -> str:
    value = re.sub(r"^(FEMALE_SOURCE__|FEMALE_HRA_(TX|FIT)_|FEMALE_MUSCLE_|FEMALE_SUPPORT_)", "", value)
    return value.replace("_", " ")


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def strip_scene_extras(path: Path) -> None:
    """Remove Blender authoring metadata while preserving object anatomy extras."""
    payload = path.read_bytes()
    if len(payload) < 20 or payload[:4] != b"glTF":
        raise RuntimeError(f"Not a binary glTF file: {path}")

    magic, version, _ = struct.unpack_from("<4sII", payload, 0)
    if magic != b"glTF" or version != 2:
        raise RuntimeError(f"Unsupported glTF header: {path}")

    offset = 12
    chunks: list[tuple[int, bytes]] = []
    while offset < len(payload):
        length, chunk_type = struct.unpack_from("<II", payload, offset)
        offset += 8
        chunks.append((chunk_type, payload[offset : offset + length]))
        offset += length

    json_type = 0x4E4F534A
    compacted: list[tuple[int, bytes]] = []
    for chunk_type, chunk in chunks:
        if chunk_type == json_type:
            document = json.loads(chunk.rstrip(b" \t\r\n\x00").decode("utf-8"))
            for scene in document.get("scenes", []):
                scene.pop("extras", None)
            chunk = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
            chunk += b" " * ((-len(chunk)) % 4)
        compacted.append((chunk_type, chunk))

    total_length = 12 + sum(8 + len(chunk) for _, chunk in compacted)
    output = bytearray(struct.pack("<4sII", b"glTF", 2, total_length))
    for chunk_type, chunk in compacted:
        output.extend(struct.pack("<II", len(chunk), chunk_type))
        output.extend(chunk)
    path.write_bytes(output)


def export_layer(
    output: Path,
    sources: set[bpy.types.Object],
    system: str,
    *,
    authoring_to_world: Matrix | None = None,
    transform_authoring_frame: bool = False,
    transform_all_authoring_frame: bool = False,
) -> dict[str, object]:
    mesh_sources = sorted(
        (obj for obj in sources if obj.type in {"MESH", "CURVE", "SURFACE"}),
        key=lambda obj: obj.name,
    )
    if not mesh_sources:
        raise RuntimeError(f"No exportable objects for {output.name}")

    depsgraph = bpy.context.evaluated_depsgraph_get()
    export_collection = bpy.data.collections.new(f"IEOBOM_WEB_EXPORT_{system.upper()}")
    bpy.context.scene.collection.children.link(export_collection)
    duplicates: list[bpy.types.Object] = []
    selected_before = list(bpy.context.selected_objects)
    active_before = bpy.context.view_layer.objects.active

    try:
        for index, source in enumerate(mesh_sources):
            evaluated = source.evaluated_get(depsgraph)
            mesh = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
            duplicate = bpy.data.objects.new(source.name, mesh)
            world = source.matrix_world.copy()
            if transform_authoring_frame and authoring_to_world is not None:
                center = sum((Vector(corner) for corner in source.bound_box), Vector()) / 8.0
                center = world @ center
                # The curated core-organ collection contains both original
                # authoring-frame organs (around X=0) and already fitted organs
                # (around X=0.96). Apply the current shell's exact Blender
                # transform only to the former; never estimate placement in JS.
                if transform_all_authoring_frame or center.x < 0.5:
                    world = authoring_to_world @ world
            duplicate.matrix_world = world
            anatomy_id = str(source.get("anatomyId") or f"female-{system}-{slug(source.name)}")
            duplicate["anatomyId"] = anatomy_id
            duplicate["anatomyParentId"] = str(source.get("anatomyParentId") or f"female-{system}")
            duplicate["anatomySystem"] = str(source.get("anatomySystem") or system)
            duplicate["label"] = str(source.get("label") or label(source.name))
            duplicate["sourceName"] = str(source.get("sourceName") or source.name)
            duplicate["ieobomWebLayer"] = system
            duplicate["ieobomWebOrdinal"] = index
            export_collection.objects.link(duplicate)
            duplicates.append(duplicate)

        bpy.ops.object.select_all(action="DESELECT")
        for duplicate in duplicates:
            duplicate.hide_set(False)
            duplicate.hide_viewport = False
            duplicate.hide_render = False
            duplicate.select_set(True)
        bpy.context.view_layer.objects.active = duplicates[0]
        output.parent.mkdir(parents=True, exist_ok=True)
        result = bpy.ops.export_scene.gltf(
            filepath=str(output),
            export_format="GLB",
            use_selection=True,
            export_extras=True,
            export_yup=True,
            export_apply=False,
            export_hierarchy_flatten_objs=True,
            export_materials="EXPORT",
            export_animations=False,
            export_draco_mesh_compression_enable=True,
            export_draco_mesh_compression_level=6,
        )
        if "FINISHED" not in result:
            raise RuntimeError(f"glTF export failed: {output}")
        strip_scene_extras(output)
        return {
            "file": output.name,
            "bytes": output.stat().st_size,
            "sha256": sha256(output),
            "objects": len(duplicates),
            "system": system,
        }
    finally:
        bpy.ops.object.select_all(action="DESELECT")
        for duplicate in duplicates:
            mesh = duplicate.data
            bpy.data.objects.remove(duplicate, do_unlink=True)
            if mesh.users == 0:
                bpy.data.meshes.remove(mesh)
        bpy.data.collections.remove(export_collection)
        for obj in selected_before:
            if obj.name in bpy.data.objects:
                obj.select_set(True)
        if active_before and active_before.name in bpy.data.objects:
            bpy.context.view_layer.objects.active = active_before


def main() -> None:
    args = parse_args()
    output_dir = Path(args.output_dir).resolve()

    shell = bpy.data.objects.get("IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01")
    if shell is None:
        raise RuntimeError("Missing approved female shell")
    authoring_to_world = shell.matrix_world.copy()

    muscles = collection_objects("FEMALE_MUSCLE_WORK")
    supports: set[bpy.types.Object] = set()
    for collection in bpy.data.collections:
        if collection.name.startswith(JOINT_SUPPORT_COLLECTION_PREFIXES):
            supports.update(recursive_objects(collection))

    reproductive = {bpy.data.objects[name] for name in FINAL_REPRODUCTIVE}
    urinary = {bpy.data.objects[name] for name in FINAL_URINARY}
    urinary.update(obj for obj in bpy.data.objects if obj.name.startswith(URINARY_DETAIL_PREFIXES))
    mammary = collection_objects("FEMALE_HRA_MAMMARY_L_WORK")
    mammary.update(collection_objects("FEMALE_HRA_MAMMARY_R_WORK"))
    core_organs = {
        obj for obj in collection_objects("ORGANS_V28") if str(obj.get("anatomyId") or "").lower() != "bladder"
    }
    # The upstream nerve collections also contain the muscles they innervate
    # and nested superficial branches. Export the CNS plus only each requested
    # major nerve trunk; otherwise those muscles and cutaneous branches render
    # as a second, oversized body outline around the fitted female atlas.
    female_nervous_source = bpy.data.collections.get(FEMALE_NERVOUS_SOURCE_COLLECTION)
    if female_nervous_source is not None:
        nervous = recursive_objects(female_nervous_source)
        nervous_in_world_frame = True
    else:
        nervous_sources = set(bpy.data.collections["Central nervous system"].objects)
        for collection_name in NERVOUS_COLLECTIONS[1:]:
            collection = bpy.data.collections[collection_name]
            nervous_sources.update(
                obj
                for obj in collection.objects
                if re.sub(r"\.[lr]$", "", obj.name, flags=re.IGNORECASE).casefold() == collection_name.casefold()
            )
        nervous = objects_within_female_frame(nervous_sources, authoring_to_world)
        nervous_in_world_frame = False
    female_lymphatic_source = bpy.data.collections.get(FEMALE_LYMPHATIC_SOURCE_COLLECTION)
    if female_lymphatic_source is not None:
        lymphatic = recursive_objects(female_lymphatic_source)
        lymphatic_in_world_frame = True
    else:
        lymphatic = objects_within_female_frame(collection_objects("6: Lymphoid organs"), authoring_to_world)
        lymphatic_in_world_frame = False

    requested = set(
        args.only
        or (
            "shell",
            "organs",
            "muscles",
            "support",
            "nervous",
            "lymphatic",
            "reproductive",
            "urinary",
            "mammary",
        )
    )
    layers: list[dict[str, object]] = []
    if "shell" in requested:
        layers.append(
            export_layer(
                output_dir / f"ieobom-female-shell-shared-frame-{args.shell_version}.glb",
                {shell},
                "integumentary",
            )
        )
    if "organs" in requested:
        layers.append(
            export_layer(
                output_dir / "ieobom-female-organs-core-v2.glb",
                core_organs,
                "regional-anatomy",
                authoring_to_world=authoring_to_world,
                transform_authoring_frame=True,
            )
        )
    if "muscles" in requested:
        layers.append(export_layer(output_dir / "ieobom-female-muscles-v3-full-body.glb", muscles, "muscular"))
    if "support" in requested:
        layers.append(
            export_layer(
                output_dir / "ieobom-female-support-v3-joints-ligaments.glb",
                supports,
                "joints",
            )
        )
    if "nervous" in requested:
        layers.append(
            export_layer(
                output_dir / "ieobom-female-nervous-v4-central-major.glb",
                nervous,
                "nervous",
                authoring_to_world=None if nervous_in_world_frame else authoring_to_world,
                transform_authoring_frame=not nervous_in_world_frame,
                transform_all_authoring_frame=not nervous_in_world_frame,
            )
        )
    if "lymphatic" in requested:
        layers.append(
            export_layer(
                output_dir / "ieobom-female-lymphatic-v3-curated.glb",
                lymphatic,
                "lymphatic",
                authoring_to_world=None if lymphatic_in_world_frame else authoring_to_world,
                transform_authoring_frame=not lymphatic_in_world_frame,
                transform_all_authoring_frame=not lymphatic_in_world_frame,
            )
        )
    if "reproductive" in requested:
        layers.append(export_layer(output_dir / "ieobom-female-reproductive-v2.glb", reproductive, "reproductive"))
    if "urinary" in requested:
        layers.append(export_layer(output_dir / "ieobom-female-urinary-v2.glb", urinary, "urinary"))
    if "mammary" in requested:
        layers.append(export_layer(output_dir / "ieobom-female-mammary-v2.glb", mammary, "mammary"))
    report = {
        "sourceBlend": bpy.data.filepath,
        "layers": layers,
        "totalObjects": sum(int(layer["objects"]) for layer in layers),
        "totalBytes": sum(int(layer["bytes"]) for layer in layers),
    }
    Path(args.report).write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
