import bpy


CLEARANCE_MM = 2.0
CLEARANCE = CLEARANCE_MM / 1000.0

OBJECT_NAMES = (
    "skeleton-hip-bone-left__Hip_bonel",
    "skeleton-hip-bone-right__Hip_boner",
)
SHAPE_KEY_NAME = "IEOBOM_PELVIS_CLEARANCE"


def smoothstep(edge0, edge1, value):
    if edge1 == edge0:
        return 0.0

    amount = (value - edge0) / (edge1 - edge0)
    amount = max(0.0, min(1.0, amount))
    return amount * amount * (3.0 - 2.0 * amount)


def require_hips():
    hips = []

    for name in OBJECT_NAMES:
        obj = bpy.data.objects.get(name)

        if obj is None:
            raise RuntimeError(f"골반뼈 없음: {name}")
        if obj.type != "MESH":
            raise RuntimeError(f"메시가 아님: {name}")
        if obj.data.shape_keys is None:
            raise RuntimeError(f"Shape Key가 없음: {name}")
        if obj.data.shape_keys.key_blocks.get(SHAPE_KEY_NAME) is None:
            raise RuntimeError(f"{SHAPE_KEY_NAME}가 없음: {name}")

        hips.append(obj)

    return hips


def apply_clearance(hips):
    all_points = []

    for obj in hips:
        basis = obj.data.shape_keys.reference_key

        for point in basis.data:
            all_points.append(obj.matrix_world @ point.co)

    min_x = min(point.x for point in all_points)
    max_x = max(point.x for point in all_points)
    min_z = min(point.z for point in all_points)
    max_z = max(point.z for point in all_points)

    mid_x = (min_x + max_x) * 0.5
    height = max_z - min_z
    max_lateral = max(abs(point.x - mid_x) for point in all_points)

    # Keep the acetabula, pubic symphysis, and lower pelvis unchanged.
    z_start = min_z + height * 0.55
    z_full = min_z + height * 0.82

    # Keep the medial sacroiliac area unchanged and affect the outer wings.
    lateral_start = max_lateral * 0.42
    lateral_full = max_lateral * 0.75

    results = []

    for obj in hips:
        shape_keys = obj.data.shape_keys
        keys = shape_keys.key_blocks
        basis = shape_keys.reference_key
        target = keys[SHAPE_KEY_NAME]

        matrix = obj.matrix_world.copy()
        inverse = matrix.inverted_safe()
        moved = 0

        for index, basis_point in enumerate(basis.data):
            world = matrix @ basis_point.co

            vertical_weight = smoothstep(z_start, z_full, world.z)
            lateral_distance = abs(world.x - mid_x)
            lateral_weight = smoothstep(
                lateral_start,
                lateral_full,
                lateral_distance,
            )
            weight = vertical_weight * lateral_weight
            changed = world.copy()

            if weight > 0.0:
                side = 1.0 if world.x > mid_x else -1.0
                changed.x -= side * CLEARANCE * weight
                moved += 1

            # Always rebuild from Basis so rerunning never accumulates changes.
            target.data[index].co = inverse @ changed

        target.value = 1.0
        results.append((obj.name, moved))

    bpy.context.view_layer.update()
    return results


def show_result(results):
    def draw_popup(self, context):
        self.layout.label(text=f"장골능 최대 {CLEARANCE_MM:.1f}mm 안쪽 보정")
        for name, moved in results:
            self.layout.label(text=f"{name}: 정점 {moved}개")
        self.layout.separator()
        self.layout.label(text="Shape Key Value 0=원본, 1=보정")

    bpy.context.window_manager.popup_menu(
        draw_popup,
        title="IEOBOM 골반 여유 보정",
        icon="CHECKMARK",
    )


hips = require_hips()
results = apply_clearance(hips)
show_result(results)
