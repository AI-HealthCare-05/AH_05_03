"""Export the corrected female skeleton and four web hand-pose clips.

Run with Blender 5.2 or newer:

    Blender --background path/to/source.blend --python this-file.py -- \
      --output path/to/skeleton-v35.glb

The source scene keeps the original SKELETON_V27 upper-limb objects as a hidden
fallback.  This exporter replaces those objects by anatomyId with the 60
FEMALE_*_WORK meshes, includes their controller ancestry, and turns the hand
drivers into ordinary NLA animation tracks that glTF/Three.js can play.
"""

from __future__ import annotations

import argparse
import json
import re
import struct
import sys
from pathlib import Path

import bpy
import bmesh
from mathutils import Matrix


POSES = {
    "Open Hand": {"Fist": 0.0, "Spread": 0.0, "Thumb Opposition": 0.0, "Wrist Curl": 0.0},
    "Fist": {"Fist": 1.0, "Spread": 0.0, "Thumb Opposition": 0.0, "Wrist Curl": 0.0},
    "Spread": {"Fist": 0.0, "Spread": 1.0, "Thumb Opposition": 0.0, "Wrist Curl": 0.0},
    "Point": {"Fist": 1.0, "Spread": 0.0, "Thumb Opposition": 0.0, "Wrist Curl": 0.0},
}

HAND_CONTROLLER_TOKENS = ("_WRIST_", "_THUMB_", "_INDEX_", "_MIDDLE_", "_RING_", "_LITTLE_")
MASTER_NAMES = ("FEMALE_HAND_L_MASTER_CTRL", "FEMALE_HAND_R_MASTER_CTRL")
RIGHT_TRIQUETRUM_WORK_NAME = "FEMALE_HAND_R_16_WORK"
RIGHT_TRIQUETRUM_ID = "appendicular-skeleton-triquetrum-bone-right"
# These two authored work copies have lost their controller-space placement and
# evaluate at the scene origin. The same Blender model still contains the
# correctly placed v27 right radius/ulna, whose bounds match the fitted left
# forearm, so export those in-model meshes instead of synthesizing replacements.
UNPLACED_WORK_MESHES = {"FEMALE_RADIUS_R_WORK", "FEMALE_ULNA_R_WORK"}


def parse_args() -> argparse.Namespace:
    args = sys.argv[sys.argv.index("--") + 1 :] if "--" in sys.argv else []
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", required=True)
    parser.add_argument("--report")
    parser.add_argument(
        "--static-shell-output",
        help="Also export the source scene shell as a static world-baked GLB.",
    )
    parser.add_argument(
        "--static-skeleton-only",
        action="store_true",
        help="Export only the static world-baked skeleton without rebuilding the shell.",
    )
    parser.add_argument(
        "--preserve-hierarchy",
        action="store_true",
        help="Keep Blender controller parents and animate the 32 hand controllers.",
    )
    return parser.parse_args(args)


def set_hand_pose(values: dict[str, float]) -> None:
    for master_name in MASTER_NAMES:
        master = bpy.data.objects[master_name]
        for key, value in values.items():
            master[key] = value
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


def hand_controllers() -> list[bpy.types.Object]:
    return sorted(
        (
            obj
            for obj in bpy.data.objects
            if obj.type == "EMPTY"
            and obj.name.startswith("FEMALE_")
            and obj.name.endswith("_CTRL")
            and any(token in obj.name for token in HAND_CONTROLLER_TOKENS)
        ),
        key=lambda obj: obj.name,
    )


def capture_pose_values(
    controllers: list[bpy.types.Object],
    pose_values: dict[str, float],
) -> dict[str, tuple[float, float, float]]:
    """Evaluate the simple numeric driver expressions without relying on a UI redraw.

    Blender background mode does not always dirty custom-property driver relations
    after assigning an ID property at the current frame.  These drivers contain only
    arithmetic over the four hand master properties, so evaluating their expressions
    directly is deterministic and avoids exporting an all-zero pose.
    """
    captured: dict[str, tuple[float, float, float]] = {}
    for obj in controllers:
        rotation = [0.0, 0.0, 0.0]
        animation_data = obj.animation_data
        for fcurve in animation_data.drivers if animation_data else []:
            if fcurve.data_path != "delta_rotation_euler":
                continue
            variables: dict[str, float] = {}
            for variable in fcurve.driver.variables:
                target_path = variable.targets[0].data_path
                match = re.fullmatch(r'\["(.+)"\]', target_path)
                if not match:
                    raise RuntimeError(f"Unsupported driver target path: {target_path}")
                variables[variable.name] = pose_values[match.group(1)]
            rotation[fcurve.array_index] = float(eval(fcurve.driver.expression, {"__builtins__": {}}, variables))
        captured[obj.name] = tuple(rotation)
    return captured


def capture_hand_poses(
    controllers: list[bpy.types.Object],
) -> tuple[dict[str, dict[str, tuple[float, float, float]]], dict[str, int]]:
    captured: dict[str, dict[str, tuple[float, float, float]]] = {}
    for pose_name, values in POSES.items():
        set_hand_pose(values)
        captured[pose_name] = capture_pose_values(controllers, values)

    # Point is a fist with both index chains restored to their open values.
    for controller_name in captured["Point"]:
        if "_INDEX_" in controller_name:
            captured["Point"][controller_name] = captured["Open Hand"][controller_name]

    set_hand_pose(POSES["Open Hand"])
    for obj in controllers:
        animation_data = obj.animation_data_create()
        for driver in animation_data.drivers:
            driver.mute = True
        obj.delta_rotation_euler = captured["Open Hand"][obj.name]

    bpy.context.scene.frame_start = 1
    bpy.context.scene.frame_end = 12
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()
    counts = {
        pose_name: sum(
            1 for controller_name, values in captured[pose_name].items() if any(abs(value) > 1e-8 for value in values)
        )
        for pose_name in POSES
    }
    return captured, counts


def set_captured_controller_pose(
    controllers: list[bpy.types.Object],
    captured: dict[str, tuple[float, float, float]],
) -> None:
    for obj in controllers:
        obj.delta_rotation_euler = captured[obj.name]
    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


def create_hierarchy_pose_tracks(
    controllers: list[bpy.types.Object],
    captured: dict[str, dict[str, tuple[float, float, float]]],
) -> None:
    """Bake the four poses onto controller-local rotations without flattening parents."""
    for obj in controllers:
        animation_data = obj.animation_data_create()
        animation_data.action = None
        for track in list(animation_data.nla_tracks):
            animation_data.nla_tracks.remove(track)

        for pose_name in POSES:
            action = bpy.data.actions.new(f"IEOBOM_{pose_name.replace(' ', '_')}__{obj.name}")
            animation_data.action = action
            obj.delta_rotation_euler = captured[pose_name][obj.name]
            obj.keyframe_insert(data_path="delta_rotation_euler", frame=1, group="Hand Pose")
            obj.keyframe_insert(data_path="delta_rotation_euler", frame=12, group="Hand Pose")
            animation_data.action = None

            track = animation_data.nla_tracks.new()
            track.name = pose_name
            strip = track.strips.new(pose_name, 1, action)
            strip.action_frame_start = 1
            strip.action_frame_end = 12

        obj.delta_rotation_euler = captured["Open Hand"][obj.name]

    bpy.context.scene.frame_set(1)
    bpy.context.view_layer.update()


def include_parent_hierarchy(
    objects: set[bpy.types.Object],
) -> set[bpy.types.Object]:
    selected = set(objects)
    for obj in tuple(objects):
        parent = obj.parent
        while parent is not None:
            selected.add(parent)
            parent = parent.parent
    return selected


def repair_and_validate_work_metadata() -> list[str]:
    """Repair the known R16 label leak and verify every mirrored hand slot."""
    repaired: list[str] = []
    right_triquetrum = bpy.data.objects.get(RIGHT_TRIQUETRUM_WORK_NAME)
    if right_triquetrum is None:
        raise RuntimeError(f"Missing corrected hand object: {RIGHT_TRIQUETRUM_WORK_NAME}")
    if right_triquetrum.get("anatomyId") != RIGHT_TRIQUETRUM_ID:
        right_triquetrum["anatomyId"] = RIGHT_TRIQUETRUM_ID
        right_triquetrum["anatomyParentId"] = "appendicular-skeleton"
        right_triquetrum["anatomySystem"] = "skeletal"
        right_triquetrum["name"] = "appendicular-skeleton-triquetrum-bone-right__Triquetrum bone.r"
        right_triquetrum["sourceName"] = "Triquetrum bone.r"
        right_triquetrum["ieobomRole"] = "female_hand_right_work_bone"
        right_triquetrum["ieobomMetadataRepair"] = (
            "v37: replaced stale Navicular bone.r metadata on mirrored Triquetrum"
        )
        repaired.append(RIGHT_TRIQUETRUM_WORK_NAME)

    for left in bpy.data.objects:
        match = re.fullmatch(r"FEMALE_HAND_L_(\d+)_WORK", left.name)
        if match is None:
            continue
        right_name = f"FEMALE_HAND_R_{match.group(1)}_WORK"
        right = bpy.data.objects.get(right_name)
        if right is None:
            raise RuntimeError(f"Missing mirrored corrected hand object: {right_name}")
        expected = str(left.get("anatomyId", "")).replace("-left", "-right")
        actual = str(right.get("anatomyId", ""))
        if not expected:
            raise RuntimeError(f"Missing left-hand anatomy ID: {left.name}")
        if actual != expected:
            source_name = str(left.get("sourceName", "")).removesuffix(".l") + ".r"
            right["anatomyId"] = expected
            right["anatomyParentId"] = str(left.get("anatomyParentId", "appendicular-skeleton"))
            right["anatomySystem"] = str(left.get("anatomySystem", "skeletal"))
            right["sourceName"] = source_name
            right["name"] = f"{expected}__{source_name}"
            right["label"] = source_name
            right["ieobomRole"] = "female_hand_right_work_bone"
            right["ieobomMetadataRepair"] = "export: restored right-side metadata after mirrored mesh copy"
            repaired.append(right_name)

    for bone in ("HUMERUS", "RADIUS", "ULNA"):
        left = bpy.data.objects[f"FEMALE_{bone}_L_WORK"]
        right = bpy.data.objects[f"FEMALE_{bone}_R_WORK"]
        expected = str(left.get("anatomyId", "")).replace("-left", "-right")
        if not expected:
            raise RuntimeError(f"Missing left-side anatomy ID: {left.name}")
        if right.get("anatomyId") != expected:
            source_name = str(left.get("sourceName", "")).removesuffix(".l") + ".r"
            right["anatomyId"] = expected
            right["anatomyParentId"] = str(left.get("anatomyParentId", "appendicular-skeleton"))
            right["anatomySystem"] = str(left.get("anatomySystem", "skeletal"))
            right["sourceName"] = source_name
            right["name"] = f"{expected}__{source_name}"
            right["label"] = source_name
            right["ieobomMetadataRepair"] = "export: restored right-side metadata after mirrored mesh copy"
            repaired.append(right.name)
    return repaired


def matrix_distance(left, right) -> float:
    return max(abs(left[row][column] - right[row][column]) for row in range(4) for column in range(4))


def make_flat_baked_meshes(
    source_meshes: set[bpy.types.Object],
    controllers: list[bpy.types.Object],
    captured: dict[str, dict[str, tuple[float, float, float]]],
) -> tuple[set[bpy.types.Object], int]:
    """Duplicate evaluated Blender meshes at world level and bake pose matrices.

    Flattening the authoring hierarchy is required to reproduce exactly what is
    visible in Blender, but doing that directly would detach the hand meshes from
    their controllers.  These duplicates therefore receive world-space transform
    clips directly; Three.js no longer depends on Blender-only parent controllers.
    """
    pose_matrices: dict[str, dict[bpy.types.Object, object]] = {}
    for pose_name in POSES:
        set_captured_controller_pose(controllers, captured[pose_name])
        depsgraph = bpy.context.evaluated_depsgraph_get()
        pose_matrices[pose_name] = {obj: obj.evaluated_get(depsgraph).matrix_world.copy() for obj in source_meshes}

    set_captured_controller_pose(controllers, captured["Open Hand"])
    open_depsgraph = bpy.context.evaluated_depsgraph_get()
    collection = bpy.data.collections.new("IEOBOM_GLTF_FLAT_EXPORT")
    bpy.context.scene.collection.children.link(collection)
    duplicates: set[bpy.types.Object] = set()
    animated_meshes = 0

    for source in sorted(source_meshes, key=lambda obj: obj.name):
        export_name = source.name
        source.name = f"__IEOBOM_SOURCE__{export_name}"
        duplicate = source.copy()
        open_matrix = pose_matrices["Open Hand"][source]
        # Store the open-pose world coordinates in the mesh itself.  Several
        # authoring objects use non-trivial parent inverses; relying on a copied
        # object transform can make glTF apply those offsets twice.
        duplicate.data = bpy.data.meshes.new_from_object(source.evaluated_get(open_depsgraph), depsgraph=open_depsgraph)
        duplicate.data.transform(open_matrix)
        duplicate.name = export_name
        duplicate.parent = None
        duplicate.matrix_parent_inverse.identity()
        duplicate.constraints.clear()
        duplicate.modifiers.clear()
        duplicate.animation_data_clear()
        duplicate.rotation_mode = "QUATERNION"
        duplicate.delta_location = (0.0, 0.0, 0.0)
        duplicate.delta_rotation_euler = (0.0, 0.0, 0.0)
        duplicate.delta_scale = (1.0, 1.0, 1.0)
        collection.objects.link(duplicate)
        duplicates.add(duplicate)

        changes_with_pose = any(
            matrix_distance(open_matrix, pose_matrices[pose_name][source]) > 1e-7 for pose_name in POSES
        )
        if changes_with_pose:
            animated_meshes += 1
            animation_data = duplicate.animation_data_create()
            open_inverse = open_matrix.inverted_safe()
            for pose_name in POSES:
                action = bpy.data.actions.new(f"IEOBOM_{pose_name.replace(' ', '_')}__{export_name}")
                animation_data.action = action
                pose_delta = pose_matrices[pose_name][source] @ open_inverse
                location, rotation, scale = pose_delta.decompose()
                duplicate.location = location
                duplicate.rotation_quaternion = rotation
                duplicate.scale = scale
                duplicate.keyframe_insert(data_path="location", frame=1, group="Hand Pose")
                duplicate.keyframe_insert(data_path="location", frame=12, group="Hand Pose")
                duplicate.keyframe_insert(data_path="rotation_quaternion", frame=1, group="Hand Pose")
                duplicate.keyframe_insert(data_path="rotation_quaternion", frame=12, group="Hand Pose")
                duplicate.keyframe_insert(data_path="scale", frame=1, group="Hand Pose")
                duplicate.keyframe_insert(data_path="scale", frame=12, group="Hand Pose")
                animation_data.action = None

                track = animation_data.nla_tracks.new()
                track.name = pose_name
                strip = track.strips.new(pose_name, 1, action)
                strip.action_frame_start = 1
                strip.action_frame_end = 12

        duplicate.location = (0.0, 0.0, 0.0)
        duplicate.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        duplicate.scale = (1.0, 1.0, 1.0)

    set_captured_controller_pose(controllers, captured["Open Hand"])
    bpy.context.view_layer.update()
    return duplicates, animated_meshes


def make_static_world_baked_meshes(
    source_meshes: set[bpy.types.Object],
    collection_name: str,
) -> set[bpy.types.Object]:
    """Bake evaluated meshes into world coordinates without parents or animation."""
    depsgraph = bpy.context.evaluated_depsgraph_get()
    collection = bpy.data.collections.new(collection_name)
    bpy.context.scene.collection.children.link(collection)
    duplicates: set[bpy.types.Object] = set()
    web_metadata = {"anatomyId", "anatomyParentId", "anatomySystem", "sourceName", "label"}
    for source in sorted(source_meshes, key=lambda obj: obj.name):
        export_name = source.name
        source.name = f"__IEOBOM_STATIC_SOURCE__{export_name}"
        evaluated = source.evaluated_get(depsgraph)
        duplicate = source.copy()
        duplicate.data = bpy.data.meshes.new_from_object(evaluated, depsgraph=depsgraph)
        duplicate.data.transform(evaluated.matrix_world)
        # Normalize the actual baked face winding rather than relying only on
        # the object determinant. Some fitted skull parts are mirrored through
        # a negative parent transform, while several original left foot bones
        # already contain inward winding despite a positive object transform.
        # Both cases have negative signed volume after world baking.
        duplicate.data.calc_loop_triangles()
        signed_volume = sum(
            duplicate.data.vertices[triangle.vertices[0]].co.dot(
                duplicate.data.vertices[triangle.vertices[1]].co.cross(
                    duplicate.data.vertices[triangle.vertices[2]].co,
                ),
            ) / 6.0
            for triangle in duplicate.data.loop_triangles
        )
        if signed_volume < 0.0:
            mirrored_mesh = bmesh.new()
            mirrored_mesh.from_mesh(duplicate.data)
            bmesh.ops.reverse_faces(mirrored_mesh, faces=list(mirrored_mesh.faces))
            mirrored_mesh.to_mesh(duplicate.data)
            mirrored_mesh.free()
            duplicate.data.update()
        # Static web assets use renderer-owned colors exclusively. Remove
        # Blender vertex-color layers as well as materials so glTF cannot emit
        # COLOR_0 attributes that tint individual bones red or green.
        for color_attribute in list(duplicate.data.color_attributes):
            duplicate.data.color_attributes.remove(color_attribute)
        duplicate.name = export_name
        duplicate.parent = None
        duplicate.matrix_parent_inverse.identity()
        duplicate.constraints.clear()
        duplicate.modifiers.clear()
        duplicate.animation_data_clear()
        for key in list(duplicate.keys()):
            if key not in web_metadata:
                del duplicate[key]
        # The evaluated world matrix has already been baked into the mesh. Some
        # fitted head and corrected limb objects carry their authored placement
        # in delta transforms rather than ordinary location/rotation channels.
        # Leaving those values on the detached copy applies the placement a
        # second time and creates remote skull/limb fragments that also corrupt
        # the viewer's automatic framing bounds.
        duplicate.location = (0.0, 0.0, 0.0)
        duplicate.rotation_mode = "QUATERNION"
        duplicate.rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        duplicate.scale = (1.0, 1.0, 1.0)
        duplicate.delta_location = (0.0, 0.0, 0.0)
        duplicate.delta_rotation_euler = (0.0, 0.0, 0.0)
        duplicate.delta_rotation_quaternion = (1.0, 0.0, 0.0, 0.0)
        duplicate.delta_scale = (1.0, 1.0, 1.0)
        duplicate.matrix_world = Matrix.Identity(4)
        collection.objects.link(duplicate)
        duplicates.add(duplicate)
    return duplicates


def export_static_selection(objects: set[bpy.types.Object], output: Path) -> None:
    bpy.ops.object.select_all(action="DESELECT")
    for obj in objects:
        obj.hide_select = False
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(objects))
    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        export_hierarchy_flatten_objs=True,
        # The web renderer assigns its own hologram materials. Keeping Blender
        # materials here only embeds unused textures and inflates both files.
        export_materials="NONE",
        export_animations=False,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"Static glTF export failed: {result}")


def export_objects() -> tuple[set[bpy.types.Object], set[str], set[str]]:
    repair_and_validate_work_metadata()
    skeleton = bpy.data.collections["SKELETON_V27"]
    work_meshes = {
        obj
        for obj in bpy.data.objects
        if obj.type == "MESH" and obj.name.startswith("FEMALE_") and obj.name.endswith("_WORK")
    }
    all_work_ids = {str(obj.get("anatomyId", "")) for obj in work_meshes}
    # The current integrated file adds the two explicitly corrected navicular
    # meshes to the historical 60 upper-limb work meshes.
    if len(work_meshes) not in {60, 62} or len(all_work_ids) != len(work_meshes):
        raise RuntimeError(
            f"Expected 60 or 62 uniquely identified corrected work meshes; "
            f"found {len(work_meshes)} meshes and {len(all_work_ids)} anatomy IDs"
        )

    placed_work_meshes = {obj for obj in work_meshes if obj.name not in UNPLACED_WORK_MESHES}
    replacement_ids = {str(obj.get("anatomyId", "")) for obj in placed_work_meshes}
    selected = {obj for obj in skeleton.all_objects if str(obj.get("anatomyId", "")) not in replacement_ids}
    selected.update(placed_work_meshes)

    # The historical 181-mesh web skeleton intentionally omitted the skull.
    # The fitted female skull, mandible, and teeth live in the separate HEAD
    # hierarchy and do not carry Vanatome metadata, so assign stable export IDs.
    head = bpy.data.collections["HEAD"]
    head_meshes = {obj for obj in head.all_objects if obj.type == "MESH"}
    if len(head_meshes) != 50:
        raise RuntimeError(f"Expected 50 fitted female head meshes; found {len(head_meshes)}")
    head_ids: set[str] = set()
    for obj in head_meshes:
        source_name = re.sub(r"\.001$", "", obj.name)
        slug = re.sub(r"[^a-z0-9]+", "-", source_name.lower()).strip("-")
        anatomy_id = f"female-reference-head-{slug}"
        if anatomy_id in head_ids:
            raise RuntimeError(f"Duplicate generated head anatomy ID: {anatomy_id}")
        head_ids.add(anatomy_id)
        obj["anatomyId"] = anatomy_id
        obj["anatomyParentId"] = "axial-skeleton"
        obj["anatomySystem"] = "skeletal"
        obj["sourceName"] = source_name
        obj["label"] = source_name
    selected.update(head_meshes)

    return selected, replacement_ids, head_ids


def normalize_glb_default_pose(output: Path, pose_name: str) -> None:
    """Set glTF node defaults to the first sample of the requested pose.

    The exporter correctly emits each same-named NLA track as a separate clip,
    but Blender evaluates the top overlapping NLA track when it gathers static
    node transforms.  Without this normalization the unloaded/default pose would
    be Point even though Open Hand is the intended rest state.
    """
    raw = output.read_bytes()
    if raw[:4] != b"glTF":
        raise RuntimeError("Exported file is not a binary glTF")
    json_length, json_type = struct.unpack_from("<II", raw, 12)
    if json_type != 0x4E4F534A:
        raise RuntimeError("First GLB chunk is not JSON")
    json_end = 20 + json_length
    document = json.loads(raw[20:json_end].decode("utf-8"))

    bin_length, bin_type = struct.unpack_from("<II", raw, json_end)
    if bin_type != 0x004E4942:
        raise RuntimeError("Second GLB chunk is not BIN")
    binary = raw[json_end + 8 : json_end + 8 + bin_length]
    components = {"SCALAR": 1, "VEC2": 2, "VEC3": 3, "VEC4": 4}
    animation = next(
        (candidate for candidate in document.get("animations", []) if candidate.get("name") == pose_name),
        None,
    )
    if animation is None:
        raise RuntimeError(f"Missing default pose animation: {pose_name}")

    for channel in animation["channels"]:
        path = channel["target"]["path"]
        if path not in {"translation", "rotation", "scale"}:
            continue
        sampler = animation["samplers"][channel["sampler"]]
        accessor = document["accessors"][sampler["output"]]
        if accessor["componentType"] != 5126:
            raise RuntimeError("Expected float animation output")
        buffer_view = document["bufferViews"][accessor["bufferView"]]
        component_count = components[accessor["type"]]
        offset = buffer_view.get("byteOffset", 0) + accessor.get("byteOffset", 0)
        values = list(struct.unpack_from(f"<{component_count}f", binary, offset))
        node = document["nodes"][channel["target"]["node"]]
        node.pop("matrix", None)
        node[path] = values

    encoded = json.dumps(document, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
    encoded += b" " * ((-len(encoded)) % 4)
    remainder = raw[json_end:]
    total_length = 12 + 8 + len(encoded) + len(remainder)
    normalized = (
        struct.pack("<4sII", b"glTF", 2, total_length)
        + struct.pack("<II", len(encoded), 0x4E4F534A)
        + encoded
        + remainder
    )
    output.write_bytes(normalized)


def main() -> None:
    args = parse_args()
    output = Path(args.output).expanduser().resolve()
    output.parent.mkdir(parents=True, exist_ok=True)

    if args.static_shell_output or args.static_skeleton_only:
        selected, replacement_ids, head_ids = export_objects()
        skeleton_meshes = make_static_world_baked_meshes(
            {obj for obj in selected if obj.type == "MESH"},
            "IEOBOM_STATIC_SKELETON_EXPORT",
        )
        export_static_selection(skeleton_meshes, output)
        report = {
            "source": bpy.data.filepath,
            "skeletonOutput": str(output),
            "skeletonBytes": output.stat().st_size,
            "skeletonMeshes": len(skeleton_meshes),
            "correctedWorkMeshes": len(replacement_ids),
            "fittedFemaleHeadMeshes": len(head_ids),
            "staticWorldBaked": True,
            "controllers": 0,
            "animations": 0,
        }
        if args.static_shell_output:
            shell_output = Path(args.static_shell_output).expanduser().resolve()
            shell_output.parent.mkdir(parents=True, exist_ok=True)
            shell_source = bpy.data.objects["IEOBOM_TripoTriangle200K_ExtremitiesScaled_v01"]
            shell_meshes = make_static_world_baked_meshes(
                {shell_source},
                "IEOBOM_STATIC_SHELL_EXPORT",
            )
            export_static_selection(shell_meshes, shell_output)
            report.update({
                "shellOutput": str(shell_output),
                "shellBytes": shell_output.stat().st_size,
                "shellVertices": len(next(iter(shell_meshes)).data.vertices),
                "shellTriangles": sum(
                    len(p.vertices) - 2
                    for p in next(iter(shell_meshes)).data.polygons
                ),
            })
        report_path = Path(args.report).expanduser().resolve() if args.report else output.with_suffix(".report.json")
        report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        print(json.dumps(report, ensure_ascii=False))
        return

    controllers = hand_controllers()
    # Older v32 authoring files have 32 wrist/phalange controllers. The current
    # integrated female file also has one metacarpal controller per digit (10),
    # which belongs to the same hand hierarchy and must be exported with it.
    if len(controllers) not in {32, 42}:
        raise RuntimeError(f"Expected 32 or 42 wrist/finger controllers; found {len(controllers)}")
    captured, pose_track_counts = capture_hand_poses(controllers)
    selected, replacement_ids, head_ids = export_objects()
    source_meshes = {obj for obj in selected if obj.type == "MESH"}
    if args.preserve_hierarchy:
        create_hierarchy_pose_tracks(controllers, captured)
        selected.update(controllers)
        selected = include_parent_hierarchy(selected)
        animated_meshes = 0
    else:
        selected, animated_meshes = make_flat_baked_meshes(source_meshes, controllers, captured)

    # Selection export only sees objects enabled in the active View Layer. The
    # authoring file intentionally excludes several heavy reference collections,
    # so reveal them in this disposable background process before selecting the
    # exact export set.
    for collection in bpy.data.collections:
        collection.hide_viewport = False
        collection.hide_render = False

    def reveal_layer_collection(layer_collection: bpy.types.LayerCollection) -> None:
        layer_collection.exclude = False
        layer_collection.hide_viewport = False
        for child in layer_collection.children:
            reveal_layer_collection(child)

    reveal_layer_collection(bpy.context.view_layer.layer_collection)
    bpy.ops.object.select_all(action="DESELECT")
    for obj in selected:
        obj.hide_select = False
        obj.hide_set(False)
        obj.hide_viewport = False
        obj.hide_render = False
        obj.select_set(True)
    bpy.context.view_layer.objects.active = next(iter(selected))

    result = bpy.ops.export_scene.gltf(
        filepath=str(output),
        export_format="GLB",
        use_selection=True,
        export_extras=True,
        export_yup=True,
        export_apply=False,
        # The flat path has already removed its parents; the hierarchy path must
        # preserve the controller ancestry used by the hand animation clips.
        export_hierarchy_flatten_objs=False,
        export_materials="EXPORT",
        export_animations=True,
        export_animation_mode="NLA_TRACKS",
        export_merge_animation="NLA_TRACK",
        export_force_sampling=True,
        export_frame_range=True,
        export_optimize_animation_size=True,
        export_optimize_animation_keep_anim_object=True,
        export_draco_mesh_compression_enable=True,
        export_draco_mesh_compression_level=6,
    )
    if "FINISHED" not in result:
        raise RuntimeError(f"glTF export failed: {result}")
    normalize_glb_default_pose(output, "Open Hand")

    report = {
        "source": bpy.data.filepath,
        "output": str(output),
        "bytes": output.stat().st_size,
        "selectedObjects": len(selected),
        "actuallySelectedObjects": sum(1 for obj in selected if obj.select_get()),
        "correctedUpperLimbMeshes": len(replacement_ids),
        "fittedFemaleHeadMeshes": len(head_ids),
        "handControllers": len(controllers),
        "animatedMeshObjects": animated_meshes,
        "flattenedObjectHierarchy": not args.preserve_hierarchy,
        "poseTrackCounts": pose_track_counts,
        "poses": list(POSES),
    }
    report_path = Path(args.report).expanduser().resolve() if args.report else output.with_suffix(".report.json")
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False))


if __name__ == "__main__":
    main()
