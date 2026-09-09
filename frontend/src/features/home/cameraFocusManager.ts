import * as THREE from "three";

export interface FocusBounds {
  center: THREE.Vector3;
  size: THREE.Vector3;
  radius: number;
}

/**
 * 주어진 단일 메쉬 또는 복수 메쉬의 월드 좌표계 바운딩 박스와 중심점, 반경을 계산합니다.
 */
export function calculateFocusBounds(
  targets: THREE.Object3D | THREE.Object3D[],
): FocusBounds {
  const box = new THREE.Box3();
  const list = Array.isArray(targets) ? targets : [targets];

  for (const obj of list) {
    if (!obj) continue;
    box.expandByObject(obj);
  }

  if (box.isEmpty()) {
    return {
      center: new THREE.Vector3(0, 1.2, 0),
      size: new THREE.Vector3(0.5, 0.5, 0.5),
      radius: 0.5,
    };
  }

  const center = new THREE.Vector3();
  box.getCenter(center);

  const size = new THREE.Vector3();
  box.getSize(size);

  const maxDimension = Math.max(size.x, size.y, size.z);
  const radius = maxDimension / 2;

  return { center, size, radius };
}

export type ViewAngle = "front" | "side" | "top" | "current";

/**
 * 바운딩 박스가 카메라 뷰포트에 잘리지 않고 시야각(FOV) 내에 쾌적하게 들어오도록
 * 이상적인 카메라 목표 위치(`camera.position`)를 계산합니다.
 */
export function calculateTargetCameraPosition(
  bounds: FocusBounds,
  camera: THREE.PerspectiveCamera,
  options: {
    viewAngle?: ViewAngle;
    marginFactor?: number;
    minDistance?: number;
    maxDistance?: number;
  } = {},
): THREE.Vector3 {
  const margin = options.marginFactor ?? 1.6;
  const minDistance = options.minDistance ?? 0.25;
  const maxDistance = options.maxDistance ?? 4.0;
  const angle = options.viewAngle ?? "current";

  // 수직 FOV 기준 이상적 거리 산출
  const fovRad = THREE.MathUtils.degToRad(camera.fov / 2);
  const idealDistance = Math.max(
    minDistance,
    Math.min(maxDistance, (bounds.radius * margin) / Math.sin(fovRad)),
  );

  const direction = new THREE.Vector3();

  switch (angle) {
    case "front":
      direction.set(0, 0, 1);
      break;
    case "side":
      direction.set(1, 0, 0);
      break;
    case "top":
      direction.set(0, 1, 0.001); // 약간의 z 오프셋으로 업벡터 충돌 방지
      break;
    case "current":
    default: {
      direction.subVectors(camera.position, bounds.center).normalize();
      if (direction.lengthSq() < 0.0001) {
        direction.set(0, 0, 1);
      }
      break;
    }
  }

  return bounds.center.clone().add(direction.multiplyScalar(idealDistance));
}

/**
 * 투시모드 (Isolate/See-Through):
 * - 선택된 구조 중 '표층'(surface)에 위치한 부위는 반투명(transparent) 셰이딩을 적용하여 내부 심부 구조를 투시할 수 있도록 합니다.
 * - 선택되지 않은 주변 메쉬들은 고스트(opacity 0.08)화합니다.
 */
export function applyIsolateShading(
  allMeshes: THREE.Mesh[],
  selectedMeshes: Set<THREE.Mesh>,
  options: {
    ghostOpacity?: number;
    originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    ghostMaterialsMap: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    isSurfaceMesh?: (mesh: THREE.Mesh) => boolean;
    createSelectedTransparentMaterial?: (orig: THREE.Material | THREE.Material[]) => THREE.Material | THREE.Material[];
    createSelectedMaterial?: (orig: THREE.Material | THREE.Material[]) => THREE.Material | THREE.Material[];
  },
): void {
  const ghostOpacity = options.ghostOpacity ?? 0.08;

  for (const mesh of allMeshes) {
    if (!mesh.visible) continue;

    if (!options.originalMaterials.has(mesh)) {
      options.originalMaterials.set(mesh, mesh.material);
    }

    if (selectedMeshes.has(mesh)) {
      const orig = options.originalMaterials.get(mesh) ?? mesh.material;
      const isSurface = options.isSurfaceMesh ? options.isSurfaceMesh(mesh) : false;
      if (isSurface && options.createSelectedTransparentMaterial) {
        mesh.material = options.createSelectedTransparentMaterial(orig);
        mesh.renderOrder = 15;
      } else if (options.createSelectedMaterial) {
        mesh.material = options.createSelectedMaterial(orig);
        mesh.renderOrder = 20;
      } else {
        mesh.renderOrder = 20;
      }
    } else {
      // 주변 메쉬: 고스트 셰이딩
      let ghostMat = options.ghostMaterialsMap.get(mesh);
      if (!ghostMat) {
        const sourceMat = options.originalMaterials.get(mesh) ?? mesh.material;
        ghostMat = cloneToIsolateGhost(sourceMat, ghostOpacity);
        options.ghostMaterialsMap.set(mesh, ghostMat);
      }
      mesh.material = ghostMat;
      mesh.renderOrder = 1;
    }
  }
}

/**
 * 투시모드 해제 시 모든 메쉬의 원본 재질 및 renderOrder를 복원합니다.
 * 만약 선택된 메쉬가 남아있다면 표준 선택 재질(불투명 하이라이트)로 복귀시킵니다.
 */
export function restoreIsolateShading(
  allMeshes: THREE.Mesh[],
  originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>,
  selectedMeshes?: Set<THREE.Mesh>,
  createSelectedMaterial?: (orig: THREE.Material | THREE.Material[]) => THREE.Material | THREE.Material[],
): void {
  for (const mesh of allMeshes) {
    if (selectedMeshes && selectedMeshes.has(mesh) && createSelectedMaterial) {
      const orig = originalMaterials.get(mesh) ?? mesh.material;
      mesh.material = createSelectedMaterial(orig);
      mesh.renderOrder = 20;
    } else {
      const orig = originalMaterials.get(mesh);
      if (orig) {
        mesh.material = orig;
        mesh.renderOrder = 0;
      }
    }
  }
}

export function cloneToIsolateGhost(
  source: THREE.Material | THREE.Material[],
  opacity: number,
): THREE.Material | THREE.Material[] {
  if (Array.isArray(source)) {
    return source.map((m) => cloneSingle(m, opacity));
  }
  return cloneSingle(source, opacity);
}

function cloneSingle(mat: THREE.Material, opacity: number): THREE.Material {
  const cloned = mat.clone();
  cloned.transparent = true;
  cloned.opacity = opacity;
  cloned.depthWrite = false;
  return cloned;
}
