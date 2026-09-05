"""Non-destructive fitting controls for the IEOBOM female anatomy workspace.

Run this file from Blender's Scripting workspace.  It adds a ``Female Fit``
panel to the 3D View sidebar (N).  The panel creates reversible Empty-based
controllers for:

* the rib cage, sternum, thoracic vertebrae, and clavicles as one vertical
  adjustment while leaving the scapulae in place;
* left/right scapulae;
* left/right clavicles, pivoted near the sternoclavicular ends;
* left/right lower-limb chains, pivoted near the femoral heads.

The script never edits mesh vertices and never applies transforms.  A JSON
snapshot records original parents and world matrices before controllers are
created, so ``Full Restore`` can return to the pre-setup state.

This is intentionally a fitting aid, not an automatic anatomical solver.
Default adjustment values are zero.  Use small increments while inspecting
front, side, rear, and top orthographic views.
"""

from __future__ import annotations

import json
import math
from typing import Iterable

import bpy
from bpy.props import FloatProperty, PointerProperty
from bpy.types import Operator, Panel, PropertyGroup
from mathutils import Matrix, Vector


bl_info = {
    "name": "IEOBOM Female Anatomy Fit Controls",
    "author": "IEOBOM / OpenAI Codex",
    "version": (1, 0, 0),
    "blender": (5, 0, 0),
    "location": "3D View > Sidebar > Female Fit",
    "description": "Reversible fitting controls for female anatomy assets",
    "category": "Object",
}

SOURCE_COLLECTION = "SKELETON_V27"
WORK_COLLECTION = "FEMALE_WORK"
CONTROLLER_COLLECTION = "FEMALE_FIT_CONTROLLERS"
SNAPSHOT_KEY = "ieobom_female_fit_snapshot_v1"

CONTROLLERS = {
    "thorax": "FEMALE_THORAX_CTRL",
    "scapula_l": "FEMALE_SCAPULA_L_CTRL",
    "scapula_r": "FEMALE_SCAPULA_R_CTRL",
    "clavicle_l": "FEMALE_CLAVICLE_L_CTRL",
    "clavicle_r": "FEMALE_CLAVICLE_R_CTRL",
    "leg_l": "FEMALE_LEG_L_CTRL",
    "leg_r": "FEMALE_LEG_R_CTRL",
}

THORAX_KEYWORDS = (
    "-rib-",
    "sternum",
    "vertebra-t",
    "xiphoid",
)

PRIMARY_BONES = {
    "scapula_l": "appendicular-skeleton-scapula-left__Scapulal",
    "scapula_r": "appendicular-skeleton-scapula-right__Scapular",
    "clavicle_l": "appendicular-skeleton-clavicle-left__Claviclel",
    "clavicle_r": "appendicular-skeleton-clavicle-right__Clavicler",
    "femur_l": "appendicular-skeleton-femur-left__Femurl",
    "femur_r": "appendicular-skeleton-femur-right__Femurr",
}

LOWER_LIMB_KEYWORDS = (
    "femur",
    "patella",
    "tibia",
    "fibula",
    "talus",
    "calcaneus",
    "cuboid",
    "cuneiform",
    "navicular",
    "metatarsal",
    "finger-of-foot",
)


def flatten_matrix(matrix: Matrix) -> list[float]:
    return [float(value) for row in matrix for value in row]


def inflate_matrix(values: list[float]) -> Matrix:
    if len(values) != 16:
        raise ValueError("Expected a flattened 4x4 matrix")
    return Matrix([values[index : index + 4] for index in range(0, 16, 4)])


def source_collection() -> bpy.types.Collection:
    collection = bpy.data.collections.get(SOURCE_COLLECTION)
    if collection is None:
        raise RuntimeError(f"Collection '{SOURCE_COLLECTION}' was not found")
    return collection


def target_object(name: str) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise RuntimeError(f"Required object '{name}' was not found")
    return obj


def mesh_world_vertices(obj: bpy.types.Object) -> list[Vector]:
    if obj.type != "MESH" or obj.data is None:
        raise RuntimeError(f"'{obj.name}' is not a mesh")
    return [obj.matrix_world @ vertex.co for vertex in obj.data.vertices]


def geometry_center(obj: bpy.types.Object) -> Vector:
    points = mesh_world_vertices(obj)
    if not points:
        return obj.matrix_world.translation.copy()
    return sum(points, Vector()) / len(points)


def objects_geometry_center(objects: Iterable[bpy.types.Object]) -> Vector:
    centers = [geometry_center(obj) for obj in objects]
    if not centers:
        raise RuntimeError("Cannot calculate a center for an empty object group")
    return sum(centers, Vector()) / len(centers)


def thorax_bottom_pivot(objects: Iterable[bpy.types.Object]) -> Vector:
    """Use the inferior T12 surface as the fixed thoracolumbar endpoint."""

    t12 = next(
        (obj for obj in objects if "vertebra-t12__" in obj.name.lower()),
        None,
    )
    if t12 is None:
        raise RuntimeError("T12 was not found in the thorax target group")
    points = mesh_world_vertices(t12)
    center = sum(points, Vector()) / len(points)
    center.z = min(point.z for point in points)
    return center


def group_top_z(objects: Iterable[bpy.types.Object]) -> float:
    values = [point.z for obj in objects for point in mesh_world_vertices(obj)]
    if not values:
        raise RuntimeError("Cannot calculate the top of an empty object group")
    return max(values)


def female_midline_x() -> float:
    workspace_root = bpy.data.objects.get("IEOBOM_Female_Workspace_Root")
    if workspace_root is not None:
        return float(workspace_root.matrix_world.translation.x)

    left = geometry_center(target_object(PRIMARY_BONES["femur_l"]))
    right = geometry_center(target_object(PRIMARY_BONES["femur_r"]))
    return float((left.x + right.x) * 0.5)


def medial_clavicle_pivot(obj: bpy.types.Object, midline_x: float) -> Vector:
    """Approximate the sternoclavicular end from actual mesh vertices."""

    points = mesh_world_vertices(obj)
    points.sort(key=lambda point: abs(point.x - midline_x))
    count = max(8, int(len(points) * 0.08))
    return sum(points[:count], Vector()) / count


def femoral_head_pivot(
    obj: bpy.types.Object,
    midline_x: float,
) -> Vector:
    """Approximate the femoral-head center from superior/medial vertices."""

    points = mesh_world_vertices(obj)
    if not points:
        return obj.matrix_world.translation.copy()

    z_values = sorted(point.z for point in points)
    superior_threshold = z_values[max(0, int(len(z_values) * 0.72) - 1)]
    superior = [point for point in points if point.z >= superior_threshold]
    superior.sort(key=lambda point: abs(point.x - midline_x))
    count = max(12, int(len(superior) * 0.25))
    return sum(superior[:count], Vector()) / count


def lower_limb_objects(side: str) -> list[bpy.types.Object]:
    side_token = f"-{side}__"
    result = []
    for obj in source_collection().all_objects:
        lowered = obj.name.lower()
        if obj.type != "MESH" or side_token not in lowered:
            continue
        if any(keyword in lowered for keyword in LOWER_LIMB_KEYWORDS):
            # Explicitly exclude hand phalanges from the broad phalanx match.
            if "finger-of-hand" not in lowered:
                result.append(obj)
    return sorted(result, key=lambda item: item.name)


def thorax_objects() -> list[bpy.types.Object]:
    """Ribs, sternum and T1-T12; clavicles are moved in Apply Preview.

    Clavicles already use their own pivot controllers, so they cannot also be
    parented to the thorax controller.  The same thorax Z delta is therefore
    applied to both clavicle controllers during preview.
    """

    result = []
    for obj in source_collection().all_objects:
        lowered = obj.name.lower()
        if obj.type == "MESH" and any(key in lowered for key in THORAX_KEYWORDS):
            result.append(obj)
    return sorted(result, key=lambda item: item.name)


def fitting_targets() -> dict[str, list[bpy.types.Object]]:
    return {
        "thorax": thorax_objects(),
        "scapula_l": [target_object(PRIMARY_BONES["scapula_l"])],
        "scapula_r": [target_object(PRIMARY_BONES["scapula_r"])],
        "clavicle_l": [target_object(PRIMARY_BONES["clavicle_l"])],
        "clavicle_r": [target_object(PRIMARY_BONES["clavicle_r"])],
        "leg_l": lower_limb_objects("left"),
        "leg_r": lower_limb_objects("right"),
    }


def all_fitting_objects() -> list[bpy.types.Object]:
    unique: dict[str, bpy.types.Object] = {}
    for objects in fitting_targets().values():
        for obj in objects:
            unique[obj.name] = obj
    return list(unique.values())


def ensure_controller_collection() -> bpy.types.Collection:
    collection = bpy.data.collections.get(CONTROLLER_COLLECTION)
    if collection is None:
        collection = bpy.data.collections.new(CONTROLLER_COLLECTION)

    parent = bpy.data.collections.get(WORK_COLLECTION)
    if parent is None:
        parent = bpy.context.scene.collection

    if parent.children.get(collection.name) is None:
        parent.children.link(collection)
    return collection


def snapshot_original_state(scene: bpy.types.Scene) -> None:
    if SNAPSHOT_KEY in scene:
        return

    entries = {}
    for obj in all_fitting_objects():
        entries[obj.name] = {
            "parent": obj.parent.name if obj.parent else None,
            "matrix_world": flatten_matrix(obj.matrix_world),
        }

    scene[SNAPSHOT_KEY] = json.dumps(entries, separators=(",", ":"))


def snapshot_entries(scene: bpy.types.Scene) -> dict:
    raw = scene.get(SNAPSHOT_KEY)
    return json.loads(raw) if raw else {}


def preserve_world_parent(
    obj: bpy.types.Object,
    parent: bpy.types.Object | None,
) -> None:
    world = obj.matrix_world.copy()
    obj.parent = parent
    obj.matrix_world = world


def create_controller(
    name: str,
    pivot: Vector,
    objects: Iterable[bpy.types.Object],
    collection: bpy.types.Collection,
) -> bpy.types.Object:
    existing = bpy.data.objects.get(name)
    if existing is not None:
        return existing

    objects = list(objects)
    common_parent = objects[0].parent if objects else None
    controller = bpy.data.objects.new(name, None)
    collection.objects.link(controller)
    controller.empty_display_type = "PLAIN_AXES"
    controller.empty_display_size = 0.035

    if common_parent is not None:
        controller.parent = common_parent
    controller.matrix_world = Matrix.Translation(pivot)
    controller["ieobom_fit_base_world"] = flatten_matrix(controller.matrix_world)

    for obj in objects:
        preserve_world_parent(obj, controller)
    return controller


def controller(name: str) -> bpy.types.Object:
    obj = bpy.data.objects.get(name)
    if obj is None:
        raise RuntimeError("Run 'Create Reversible Controls' first")
    return obj


def base_world(obj: bpy.types.Object) -> Matrix:
    values = obj.get("ieobom_fit_base_world")
    if values is None:
        raise RuntimeError(f"Controller '{obj.name}' has no base transform")
    return inflate_matrix(list(values))


def set_controller_delta(
    obj: bpy.types.Object,
    translation: Vector,
    y_rotation_radians: float,
) -> None:
    base = base_world(obj)
    pivot = base.translation.copy()
    transform = Matrix.Translation(pivot + translation) @ Matrix.Rotation(y_rotation_radians, 4, "Y")
    obj.matrix_world = transform


def set_controller_vertical_fit(
    obj: bpy.types.Object,
    bottom_offset_meters: float,
    top_offset_meters: float,
) -> None:
    """Fit bottom/top offsets with one continuous vertical deformation."""

    base = base_world(obj)
    height = float(obj.get("ieobom_fit_vertical_height", 0.0))
    if height <= 0.0:
        raise RuntimeError(f"Controller '{obj.name}' has no valid thorax height")
    scale_z = 1.0 + ((top_offset_meters - bottom_offset_meters) / height)
    if scale_z <= 0.0:
        raise RuntimeError("Thorax extension would produce an invalid scale")
    pivot = base.translation.copy()
    obj.matrix_world = Matrix.Translation(pivot + Vector((0.0, 0.0, bottom_offset_meters))) @ Matrix.Diagonal(
        (1.0, 1.0, scale_z, 1.0)
    )


def reset_controllers() -> None:
    for name in CONTROLLERS.values():
        obj = bpy.data.objects.get(name)
        if obj is not None and obj.get("ieobom_fit_base_world") is not None:
            obj.matrix_world = base_world(obj)


class FemaleFitSettings(PropertyGroup):
    thorax_up_mm: FloatProperty(
        name="Thorax top + clavicles (mm)",
        description=(
            "Keep the T12-L1 endpoint fixed, extend ribs/sternum/T1-T12 "
            "upward, and move both clavicles by the entered amount; "
            "scapulae remain independent"
        ),
        default=0.0,
        min=-20.0,
        max=30.0,
        precision=1,
    )
    t12_l1_gap_mm: FloatProperty(
        name="T12-L1 disc space (mm)",
        description=(
            "Raise the inferior T12 endpoint to reserve space for the "
            "T12-L1 intervertebral disc while preserving the thorax top"
        ),
        default=0.0,
        min=0.0,
        max=15.0,
        precision=1,
    )
    scapula_medial_mm: FloatProperty(
        name="Scapula medial (mm)",
        description="Move each scapula toward the spine",
        default=0.0,
        min=-20.0,
        max=30.0,
        precision=1,
    )
    scapula_up_mm: FloatProperty(
        name="Scapula up (mm)",
        default=0.0,
        min=-20.0,
        max=30.0,
        precision=1,
    )
    scapula_posterior_mm: FloatProperty(
        name="Scapula posterior (mm)",
        description="Positive values move scapulae toward the back (+Y)",
        default=0.0,
        min=-20.0,
        max=20.0,
        precision=1,
    )
    scapula_rotation_deg: FloatProperty(
        name="Scapula upward rotation (deg)",
        default=0.0,
        min=-15.0,
        max=15.0,
        precision=1,
    )
    clavicle_elevation_deg: FloatProperty(
        name="Clavicle elevation (deg)",
        description="Raise lateral clavicle ends around sternoclavicular pivots",
        default=0.0,
        min=-12.0,
        max=12.0,
        precision=1,
    )
    leg_abduction_deg: FloatProperty(
        name="Leg outward angle (deg)",
        description="Rotate each complete leg outward around its femoral head",
        default=0.0,
        min=-6.0,
        max=6.0,
        precision=2,
    )


class IEOBOM_OT_analyze_female_fit(Operator):
    bl_idname = "ieobom.analyze_female_fit"
    bl_label = "Analyze Required Bones"
    bl_options = {"REGISTER"}

    def execute(self, context):
        try:
            targets = fitting_targets()
            counts = {name: len(objects) for name, objects in targets.items()}
            if counts["leg_l"] != counts["leg_r"]:
                self.report(
                    {"WARNING"},
                    f"Left/right leg counts differ: {counts}",
                )
            else:
                self.report(
                    {"INFO"},
                    "Targets found: "
                    f"{counts['thorax']} thorax bones, 4 shoulder bones, "
                    f"{counts['leg_l']} bones per leg",
                )
            print("[IEOBOM Female Fit] target counts:", counts)
            for group, objects in targets.items():
                print(group, [obj.name for obj in objects])
        except Exception as exc:  # Blender operators must report UI-safe errors.
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        return {"FINISHED"}


class IEOBOM_OT_create_female_fit_controls(Operator):
    bl_idname = "ieobom.create_female_fit_controls"
    bl_label = "Create Reversible Controls"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        try:
            targets = fitting_targets()
            snapshot_original_state(context.scene)
            collection = ensure_controller_collection()
            midline = female_midline_x()

            thorax_pivot = thorax_bottom_pivot(targets["thorax"])
            thorax_controller = create_controller(
                CONTROLLERS["thorax"],
                thorax_pivot,
                targets["thorax"],
                collection,
            )
            thorax_controller["ieobom_fit_vertical_height"] = group_top_z(targets["thorax"]) - thorax_pivot.z

            create_controller(
                CONTROLLERS["scapula_l"],
                geometry_center(targets["scapula_l"][0]),
                targets["scapula_l"],
                collection,
            )
            create_controller(
                CONTROLLERS["scapula_r"],
                geometry_center(targets["scapula_r"][0]),
                targets["scapula_r"],
                collection,
            )
            create_controller(
                CONTROLLERS["clavicle_l"],
                medial_clavicle_pivot(targets["clavicle_l"][0], midline),
                targets["clavicle_l"],
                collection,
            )
            create_controller(
                CONTROLLERS["clavicle_r"],
                medial_clavicle_pivot(targets["clavicle_r"][0], midline),
                targets["clavicle_r"],
                collection,
            )
            create_controller(
                CONTROLLERS["leg_l"],
                femoral_head_pivot(target_object(PRIMARY_BONES["femur_l"]), midline),
                targets["leg_l"],
                collection,
            )
            create_controller(
                CONTROLLERS["leg_r"],
                femoral_head_pivot(target_object(PRIMARY_BONES["femur_r"]), midline),
                targets["leg_r"],
                collection,
            )
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}

        self.report({"INFO"}, "Reversible female fitting controls created")
        return {"FINISHED"}


class IEOBOM_OT_apply_female_fit_preview(Operator):
    bl_idname = "ieobom.apply_female_fit_preview"
    bl_label = "Apply Preview Values"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        settings = context.scene.ieobom_female_fit_settings
        millimeters = 0.001

        try:
            thorax_delta = Vector((0.0, 0.0, settings.thorax_up_mm * millimeters))
            set_controller_vertical_fit(
                controller(CONTROLLERS["thorax"]),
                settings.t12_l1_gap_mm * millimeters,
                settings.thorax_up_mm * millimeters,
            )

            # Anatomical left is +X in this file; right is -X.
            for key, side_sign in (("l", 1.0), ("r", -1.0)):
                scapula = controller(CONTROLLERS[f"scapula_{key}"])
                set_controller_delta(
                    scapula,
                    Vector(
                        (
                            -side_sign * settings.scapula_medial_mm * millimeters,
                            settings.scapula_posterior_mm * millimeters,
                            settings.scapula_up_mm * millimeters,
                        )
                    ),
                    -side_sign * math.radians(settings.scapula_rotation_deg),
                )

                clavicle = controller(CONTROLLERS[f"clavicle_{key}"])
                set_controller_delta(
                    clavicle,
                    thorax_delta,
                    -side_sign * math.radians(settings.clavicle_elevation_deg),
                )

                leg = controller(CONTROLLERS[f"leg_{key}"])
                set_controller_delta(
                    leg,
                    Vector(),
                    -side_sign * math.radians(settings.leg_abduction_deg),
                )
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}

        self.report({"INFO"}, "Preview values applied; inspect all orthographic views")
        return {"FINISHED"}


class IEOBOM_OT_reset_female_fit_preview(Operator):
    bl_idname = "ieobom.reset_female_fit_preview"
    bl_label = "Reset Preview"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        try:
            reset_controllers()
            settings = context.scene.ieobom_female_fit_settings
            for property_name in (
                "thorax_up_mm",
                "t12_l1_gap_mm",
                "scapula_medial_mm",
                "scapula_up_mm",
                "scapula_posterior_mm",
                "scapula_rotation_deg",
                "clavicle_elevation_deg",
                "leg_abduction_deg",
            ):
                setattr(settings, property_name, 0.0)
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}
        return {"FINISHED"}


class IEOBOM_OT_restore_female_fit_snapshot(Operator):
    bl_idname = "ieobom.restore_female_fit_snapshot"
    bl_label = "Full Restore (Remove Controls)"
    bl_options = {"REGISTER", "UNDO"}

    def execute(self, context):
        entries = snapshot_entries(context.scene)
        if not entries:
            self.report({"ERROR"}, "No fitting snapshot exists")
            return {"CANCELLED"}

        try:
            for name, entry in entries.items():
                obj = bpy.data.objects.get(name)
                if obj is None:
                    continue
                parent_name = entry.get("parent")
                obj.parent = bpy.data.objects.get(parent_name) if parent_name else None
                obj.matrix_world = inflate_matrix(entry["matrix_world"])

            for name in CONTROLLERS.values():
                obj = bpy.data.objects.get(name)
                if obj is not None:
                    bpy.data.objects.remove(obj, do_unlink=True)

            collection = bpy.data.collections.get(CONTROLLER_COLLECTION)
            if collection is not None and not collection.objects:
                bpy.data.collections.remove(collection)

            del context.scene[SNAPSHOT_KEY]
        except Exception as exc:
            self.report({"ERROR"}, str(exc))
            return {"CANCELLED"}

        self.report({"INFO"}, "Original parents and transforms restored")
        return {"FINISHED"}


class IEOBOM_PT_female_fit(Panel):
    bl_label = "Female Anatomy Fit"
    bl_idname = "IEOBOM_PT_female_fit"
    bl_space_type = "VIEW_3D"
    bl_region_type = "UI"
    bl_category = "Female Fit"

    def draw(self, context):
        layout = self.layout
        settings = context.scene.ieobom_female_fit_settings

        layout.operator("ieobom.analyze_female_fit", icon="VIEWZOOM")
        layout.operator("ieobom.create_female_fit_controls", icon="EMPTY_AXIS")

        box = layout.box()
        box.label(text="Thorax (scapulae excluded)")
        box.prop(settings, "thorax_up_mm")
        box.prop(settings, "t12_l1_gap_mm")
        box.label(text="Top stays fixed while disc space opens", icon="INFO")

        box = layout.box()
        box.label(text="Shoulder girdle (small steps)")
        box.prop(settings, "scapula_medial_mm")
        box.prop(settings, "scapula_up_mm")
        box.prop(settings, "scapula_posterior_mm")
        box.prop(settings, "scapula_rotation_deg")
        box.prop(settings, "clavicle_elevation_deg")

        box = layout.box()
        box.label(text="Lower limbs")
        box.prop(settings, "leg_abduction_deg")
        box.label(text="Check sole height after abduction", icon="INFO")

        layout.operator("ieobom.apply_female_fit_preview", icon="PLAY")
        layout.operator("ieobom.reset_female_fit_preview", icon="LOOP_BACK")
        layout.separator()
        layout.operator("ieobom.restore_female_fit_snapshot", icon="RECOVER_LAST")
        layout.label(text="Do not Apply Transform during preview", icon="ERROR")


CLASSES = (
    FemaleFitSettings,
    IEOBOM_OT_analyze_female_fit,
    IEOBOM_OT_create_female_fit_controls,
    IEOBOM_OT_apply_female_fit_preview,
    IEOBOM_OT_reset_female_fit_preview,
    IEOBOM_OT_restore_female_fit_snapshot,
    IEOBOM_PT_female_fit,
)


def register():
    for cls in CLASSES:
        bpy.utils.register_class(cls)
    bpy.types.Scene.ieobom_female_fit_settings = PointerProperty(type=FemaleFitSettings)


def unregister():
    if hasattr(bpy.types.Scene, "ieobom_female_fit_settings"):
        del bpy.types.Scene.ieobom_female_fit_settings
    for cls in reversed(CLASSES):
        bpy.utils.unregister_class(cls)


if __name__ == "__main__":
    try:
        unregister()
    except Exception:
        pass
    register()
