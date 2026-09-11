import * as THREE from "three";

import type { AnatomyVisualRole } from "./anatomyAtlas";

const SELECTED_COLOR = new THREE.Color(0x38bdf8);
export const INTERNALS_READABILITY_STYLE = {
  shellFillOpacity: 0.05,
  bodyGuideOpacity: 0.18,
  detailGuideOpacity: 0.14,
  regionalBoundaryOpacity: 0.12,
  skeletonOpacity: 0.96,
} as const;
export const COSTAL_CARTILAGE_STYLE = {
  defaultOpacity: 0.82,
  upperFocusOpacity: 0.32,
} as const;

const ORGAN_COLORS: Record<string, number> = {
  cardiovascular: 0xe45f63,
  digestive: 0xe7a565,
  endocrine: 0xd28fe2,
  lymphatic: 0x77c99a,
  mammary: 0xf0a3bd,
  muscular: 0xd97865,
  nervous: 0xf0cf69,
  reproductive: 0xe895b1,
  respiratory: 0x9ecce8,
  urinary: 0xd8a5cc,
};

export function createHolographicMaterials(
  source: THREE.Material | THREE.Material[],
  visualRole: Exclude<AnatomyVisualRole, "atlas">,
  system: string,
  ownedMaterials: Set<THREE.Material>,
  skeletonOpacity = 0.72,
) {
  const styled = materialsOf(source).map((material) => {
    const clone = material.clone();
    ownedMaterials.add(clone);
    if (!(clone instanceof THREE.MeshStandardMaterial)) return clone;

    clone.metalness = 0;
    clone.roughness = 0.48;
    if (visualRole === "shell") {
      clone.color.setHex(0x4de4ff);
      clone.emissive.setHex(0x0b7895);
      clone.emissiveIntensity = 0.75;
      clone.transparent = true;
      clone.opacity = 0.17;
      clone.depthWrite = false;
      clone.wireframe = true;
    } else if (visualRole === "skeleton") {
      // Several Blender anatomy meshes carry diagnostic red/green COLOR_0
      // attributes. GLTFLoader enables vertexColors for those primitives, which
      // multiplies the atlas color and produces mismatched bones even though the
      // Blender materials themselves were excluded from the static export.
      clone.vertexColors = false;
      clone.color.setHex(system === "joints" ? 0x9fcfd8 : 0xd9f7ff);
      clone.emissive.setHex(system === "joints" ? 0x244b52 : 0x17475a);
      clone.emissiveIntensity = 0.18;
      clone.opacity = system === "joints" ? Math.min(skeletonOpacity, 0.68) : skeletonOpacity;
      clone.transparent = clone.opacity < 1;
      clone.depthWrite = true;
      clone.needsUpdate = true;
    } else if (system === "mammary") {
      clone.color.setHex(ORGAN_COLORS.mammary);
      clone.emissive.copy(clone.color).multiplyScalar(0.1);
      clone.emissiveIntensity = 0.22;
      clone.transparent = true;
      clone.opacity = 0.38;
      clone.depthWrite = false;
      clone.side = THREE.FrontSide;
    } else {
      const color = ORGAN_COLORS[system];
      if (color) clone.color.setHex(color);
      clone.emissive.copy(clone.color).multiplyScalar(0.12);
      clone.emissiveIntensity = 0.25;
      clone.transparent = false;
      clone.opacity = 1;
    }
    return clone;
  });
  return Array.isArray(source) ? styled : styled[0];
}

export function createMatteScalpMaterials(
  source: THREE.Material | THREE.Material[],
  ownedMaterials: Set<THREE.Material>,
) {
  const styled = materialsOf(source).map((material) => {
    const matte = new THREE.MeshLambertMaterial({
      color: ORGAN_COLORS.muscular,
      emissive: new THREE.Color(ORGAN_COLORS.muscular).multiplyScalar(0.035),
      emissiveIntensity: 0.12,
      transparent: false,
      opacity: 1,
      depthWrite: true,
      depthTest: true,
      side: material.side,
      vertexColors: false,
    });
    matte.name = `${material.name || "muscular"}-matte-scalp`;
    ownedMaterials.add(matte);
    return matte;
  });
  return Array.isArray(source) ? styled : styled[0];
}

export function applyCostalCartilageStyle(
  source: THREE.Material | THREE.Material[],
  upperBodyFocused: boolean,
) {
  for (const material of materialsOf(source)) {
    if (!(material instanceof THREE.MeshStandardMaterial)) continue;
    material.color.setHex(0xb9e2eb);
    material.emissive.setHex(0x204c59);
    material.emissiveIntensity = 0.2;
    material.transparent = true;
    material.opacity = upperBodyFocused
      ? COSTAL_CARTILAGE_STYLE.upperFocusOpacity
      : COSTAL_CARTILAGE_STYLE.defaultOpacity;
    // Costal cartilage and ribs share an attachment boundary. Keeping depth
    // writes enabled avoids transparent-object sorting that makes the
    // cartilage appear posteriorly displaced from the rib ends.
    material.depthWrite = true;
    material.needsUpdate = true;
  }
}

export function createStructuredFlowShellFillMaterials(
  source: THREE.Material | THREE.Material[],
  ownedMaterials: Set<THREE.Material>,
  opacity = 0.1,
) {
  const styled = materialsOf(source).map((material) => {
    const clone = material.clone();
    ownedMaterials.add(clone);
    if (!(clone instanceof THREE.MeshStandardMaterial)) return clone;

    clone.color.setHex(0x1689a5);
    clone.emissive.setHex(0x063c4c);
    clone.emissiveIntensity = 0.48;
    clone.metalness = 0;
    clone.roughness = 0.58;
    clone.transparent = true;
    clone.opacity = opacity;
    clone.depthWrite = false;
    clone.side = THREE.FrontSide;
    clone.wireframe = false;
    clone.flatShading = false;
    clone.needsUpdate = true;
    return clone;
  });
  return Array.isArray(source) ? styled : styled[0];
}

export function createAdaptiveFlowGuideMaterial(
  ownedMaterials: Set<THREE.Material>,
  isDetailRegion: boolean,
  opacity = isDetailRegion ? 0.3 : 0.38,
) {
  const material = new THREE.MeshBasicMaterial({
    color: isDetailRegion ? 0x79edff : 0x4de4ff,
    transparent: true,
    opacity,
    wireframe: true,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  material.toneMapped = false;
  ownedMaterials.add(material);
  return material;
}

export function createRegionalBoundaryMaterial(
  ownedMaterials: Set<THREE.Material>,
  opacity = 0.26,
) {
  const material = new THREE.MeshBasicMaterial({
    color: 0x4de4ff,
    transparent: true,
    opacity,
    wireframe: false,
    depthWrite: false,
    depthTest: true,
    side: THREE.FrontSide,
    blending: THREE.NormalBlending,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  material.toneMapped = false;
  ownedMaterials.add(material);
  return material;
}

export function createSelectedMaterials(source: THREE.Material | THREE.Material[]) {
  const highlighted = materialsOf(source).map((material) => {
    const clone = material.clone();
    if (clone instanceof THREE.MeshStandardMaterial || clone instanceof THREE.MeshLambertMaterial) {
      clone.vertexColors = false;
      clone.color.copy(SELECTED_COLOR);
      clone.emissive.setHex(0x0e7490);
      clone.emissiveIntensity = 0.85;
      clone.opacity = 1;
      clone.transparent = false;
      clone.wireframe = false;
    }
    return clone;
  });
  return Array.isArray(source) ? highlighted : highlighted[0];
}

export function createSelectedTransparentMaterials(
  source: THREE.Material | THREE.Material[],
  opacity = 0.35,
) {
  const highlighted = materialsOf(source).map((material) => {
    const clone = material.clone();
    if (
      clone instanceof THREE.MeshStandardMaterial ||
      clone instanceof THREE.MeshLambertMaterial ||
      clone instanceof THREE.MeshBasicMaterial
    ) {
      if ("vertexColors" in clone) clone.vertexColors = false;
      clone.color.copy(SELECTED_COLOR);
      if ("emissive" in clone) {
        clone.emissive.setHex(0x0284c7);
        clone.emissiveIntensity = 0.85;
      }
      clone.opacity = opacity;
      clone.transparent = true;
      clone.depthWrite = false;
      clone.depthTest = true;
      clone.wireframe = false;
      clone.side = THREE.DoubleSide;
    }
    return clone;
  });
  return Array.isArray(source) ? highlighted : highlighted[0];
}

const DANGER_ORGAN_COLOR = new THREE.Color(0xf43f5e);

export function createDangerOrganHighlightMaterials(source: THREE.Material | THREE.Material[]) {
  const highlighted = materialsOf(source).map((material) => {
    const clone = material.clone();
    if (
      clone instanceof THREE.MeshStandardMaterial ||
      clone instanceof THREE.MeshLambertMaterial ||
      clone instanceof THREE.MeshBasicMaterial
    ) {
      if ("vertexColors" in clone) clone.vertexColors = false;
      clone.color.copy(DANGER_ORGAN_COLOR);
      if ("emissive" in clone) {
        (clone as THREE.MeshStandardMaterial).emissive.setHex(0xe11d48);
        (clone as THREE.MeshStandardMaterial).emissiveIntensity = 0.95;
      }
      clone.opacity = 0.78; // 부드러운 반투명 깊이감
      clone.transparent = true;
      clone.depthTest = true;
      clone.depthWrite = false; // 반투명 겹침 블렌딩
      clone.wireframe = false;
      clone.needsUpdate = true;
    }
    return clone;
  });
  return Array.isArray(source) ? highlighted : highlighted[0];
}

export function createDangerOrganHoverMaterials(source: THREE.Material | THREE.Material[]) {
  const highlighted = materialsOf(source).map((material) => {
    const clone = material.clone();
    if (
      clone instanceof THREE.MeshStandardMaterial ||
      clone instanceof THREE.MeshLambertMaterial ||
      clone instanceof THREE.MeshBasicMaterial
    ) {
      if ("vertexColors" in clone) clone.vertexColors = false;
      clone.color.setHex(0xff2d55);
      if ("emissive" in clone) {
        (clone as THREE.MeshStandardMaterial).emissive.setHex(0xff0033);
        (clone as THREE.MeshStandardMaterial).emissiveIntensity = 1.3;
      }
      clone.opacity = 0.9;
      clone.transparent = true;
      clone.depthTest = true;
      clone.depthWrite = false;
      clone.wireframe = false;
      clone.needsUpdate = true;
    }
    return clone;
  });
  return Array.isArray(source) ? highlighted : highlighted[0];
}

const PAIN_STROKE_COLOR = new THREE.Color(0xf43f5e);

export function createPaintStrokeMaterials(source: THREE.Material | THREE.Material[]) {
  const highlighted = materialsOf(source).map((material) => {
    const clone = material.clone();
    if (clone instanceof THREE.MeshStandardMaterial || clone instanceof THREE.MeshLambertMaterial) {
      clone.vertexColors = false;
      clone.color.copy(PAIN_STROKE_COLOR);
      clone.emissive.setHex(0xbe123c);
      clone.emissiveIntensity = 0.85;
      clone.opacity = 0.95;
      clone.transparent = false;
      clone.wireframe = false;
    }
    return clone;
  });
  return Array.isArray(source) ? highlighted : highlighted[0];
}

const HOVER_COLOR = new THREE.Color(0xf59e0b);

export function createHoverMaterials(source: THREE.Material | THREE.Material[]) {
  const highlighted = materialsOf(source).map((material) => {
    const clone = material.clone();
    if (
      clone instanceof THREE.MeshStandardMaterial ||
      clone instanceof THREE.MeshLambertMaterial ||
      clone instanceof THREE.MeshBasicMaterial
    ) {
      if ("vertexColors" in clone) clone.vertexColors = false;
      clone.color.copy(HOVER_COLOR);
      if ("emissive" in clone) {
        (clone as THREE.MeshStandardMaterial).emissive.setHex(0xd97706);
        (clone as THREE.MeshStandardMaterial).emissiveIntensity = 0.85;
      }
      clone.opacity = 1.0;
      clone.transparent = false;
      clone.wireframe = false;
      clone.depthTest = true;
      clone.depthWrite = true;
      clone.needsUpdate = true;
    }
    return clone;
  });
  return Array.isArray(source) ? highlighted : highlighted[0];
}

export function materialsOf(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

export function createFocusPresets(bounds: THREE.Box3) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const frontDistance = Math.max(size.y * 1.70, 5.6);
  const lowerDistance = frontDistance * 0.6;
  const closeDistance = Math.max(size.y * 0.31, 1.25);
  const upperDistance = Math.max(size.y * 0.68, 2.8);
  const kneeDistance = Math.max(size.y * 0.45, 1.85);
  const footDistance = Math.max(size.y * 0.46, 1.9);
  const leftHandX = center.x + size.x * 0.43;
  const rightHandX = center.x - size.x * 0.43;
  const waistY = center.y - size.y * 0.02;
  const kneeY = center.y - size.y * 0.31;
  const footY = bounds.min.y + size.y * 0.09;

  return {
    full: {
      position: new THREE.Vector3(center.x, center.y - size.y * 0.03, frontDistance),
      target: new THREE.Vector3(center.x, center.y - size.y * 0.03, center.z),
    },
    head: {
      position: new THREE.Vector3(center.x, bounds.max.y - size.y * 0.09, closeDistance),
      target: new THREE.Vector3(center.x, bounds.max.y - size.y * 0.09, center.z),
    },
    upper: {
      position: new THREE.Vector3(center.x, center.y + size.y * 0.18, upperDistance),
      target: new THREE.Vector3(center.x, center.y + size.y * 0.18, center.z),
    },
    lower: {
      position: new THREE.Vector3(center.x, waistY, lowerDistance),
      target: new THREE.Vector3(center.x, waistY, center.z),
    },
    knee: {
      position: new THREE.Vector3(center.x, kneeY, kneeDistance),
      target: new THREE.Vector3(center.x, kneeY, center.z),
    },
    foot: {
      position: new THREE.Vector3(center.x, footY, footDistance),
      target: new THREE.Vector3(center.x, footY, center.z),
    },
    hand: {
      position: new THREE.Vector3(leftHandX, center.y - size.y * 0.04, closeDistance),
      target: new THREE.Vector3(leftHandX, center.y - size.y * 0.04, center.z),
    },
    leftHand: {
      position: new THREE.Vector3(leftHandX, center.y - size.y * 0.04, closeDistance),
      target: new THREE.Vector3(leftHandX, center.y - size.y * 0.04, center.z),
    },
    rightHand: {
      position: new THREE.Vector3(rightHandX, center.y - size.y * 0.04, closeDistance),
      target: new THREE.Vector3(rightHandX, center.y - size.y * 0.04, center.z),
    },
  };
}

export interface FullBodyReturnThresholdOptions {
  thresholdRatio?: number;
  frontThreshold?: number;
  backThreshold?: number;
  cameraPosition?: { x: number; z: number };
  targetPosition?: { x: number; z: number };
}

/**
 * 전신 복귀 판정 임계 비율을 계산합니다:
 * - 정면(Front): 0.85 (85%)
 * - 후면(Back): 0.95 (95% - 후면 체감 거리가 짧아 튕기는 현상 완화)
 * - 측면 및 회전 중: 코사인 보간을 통해 매끄러운 임계값 적용
 */
export function getFullBodyReturnThreshold(
  options?: FullBodyReturnThresholdOptions | number,
): number {
  if (typeof options === "number") {
    return options;
  }
  if (options?.thresholdRatio !== undefined) {
    return options.thresholdRatio;
  }
  const front = options?.frontThreshold ?? 0.85;
  const back = options?.backThreshold ?? 0.95;
  if (!options?.cameraPosition || !options?.targetPosition) {
    return front;
  }
  const dx = options.cameraPosition.x - options.targetPosition.x;
  const dz = options.cameraPosition.z - options.targetPosition.z;
  const radius = Math.hypot(dx, dz);
  if (radius < 1e-6) {
    return dz >= 0 ? front : back;
  }
  // dz > 0: 카메라가 모델 앞쪽에 위치 (정면 cosTheta = 1)
  // dz < 0: 카메라가 모델 뒤쪽에 위치 (후면 cosTheta = -1)
  const cosTheta = Math.max(-1, Math.min(1, dz / radius));
  const backFactor = (1 - cosTheta) / 2;
  return Number((front + (back - front) * backFactor).toFixed(4));
}

export function shouldReturnToFullBody(
  activeFocus: string,
  cameraDistance: number,
  fullBodyDistance: number,
  thresholdOrOptions: FullBodyReturnThresholdOptions | number = {
    frontThreshold: 0.85,
    backThreshold: 0.95,
  },
) {
  if (activeFocus === "full") return false;
  const thresholdRatio = getFullBodyReturnThreshold(thresholdOrOptions);
  return cameraDistance >= fullBodyDistance * thresholdRatio;
}

export interface AdaptiveSprayMetrics {
  sprayRadius: number;
  particleMinScale: number;
  particleMaxScale: number;
  particleCount: number;
  scaleFactor: number;
  agitationMultiplier?: number;
}

/**
 * 3D 통증 범위 칠하기(스프레이 브러시) 입자 흩뿌림 반경 및 알갱이 크기 계산:
 * 1) 카메라 거리/확대 비율 적응:
 *    전신 원거리 뷰에서는 지나치게 옆으로 흩뿌려지지 않도록 기본 반경(0.055m, 5.5cm)과 알갱이 크기를 유지하고,
 *    얼굴/머리/관절 등 특정 부위를 확대(줌인)했을 때는 섬세한 분사가 가능하도록
 *    줌 배율에 반비례 이상(지수 1.15)의 비율로 흩어지는 반경과 입자 크기를 축소합니다.
 * 2) 커서 흔들림(Agitation) 동적 적응:
 *    커서를 흔들며 빠르게 칠할수록 흩뿌림 반경과 입자 알갱이가 점차 스무스하게 커지며,
 *    칠하기를 멈추거나 천천히 움직이면 부드럽게 원래의 정밀한 상태로 복귀합니다.
 */
export function calculateAdaptiveSprayMetrics(options: {
  cameraDistance: number;
  referenceDistance?: number;
  baseRadius?: number;
  baseParticleMinScale?: number;
  baseParticleMaxScale?: number;
  exponent?: number;
  agitation?: number;
  maxAgitationRadiusMultiplier?: number;
  maxAgitationParticleMultiplier?: number;
}): AdaptiveSprayMetrics {
  const reference = options.referenceDistance ?? 5.0;
  const baseRadius = options.baseRadius ?? 0.055;
  const baseMin = options.baseParticleMinScale ?? 0.004;
  const baseMax = options.baseParticleMaxScale ?? 0.008;
  const exponent = options.exponent ?? 1.15;
  const agitation = Math.max(0, Math.min(1, options.agitation ?? 0));
  const maxRadiusMultiplier = options.maxAgitationRadiusMultiplier ?? 2.55;
  const maxParticleMultiplier = options.maxAgitationParticleMultiplier ?? 2.1;

  const rawRatio = options.cameraDistance / Math.max(0.1, reference);
  const clampedRatio = Math.max(0.1, Math.min(1.25, rawRatio));
  const scaleFactor = Math.pow(clampedRatio, exponent);

  // 커서를 흔드는 정도에 따라 스무스하게 흩뿌림 반경 및 입자 크기 확장 (초기 버전과 대폭 확대 버전의 황금 밸런스)
  const radiusMultiplier = 1.0 + agitation * (maxRadiusMultiplier - 1.0);
  const particleMultiplier = 1.0 + agitation * (maxParticleMultiplier - 1.0);

  const sprayRadius = Number((baseRadius * scaleFactor * radiusMultiplier).toFixed(5));
  const particleMinScale = Number((baseMin * scaleFactor * particleMultiplier).toFixed(6));
  const particleMaxScale = Number((baseMax * scaleFactor * particleMultiplier).toFixed(6));

  const baseCount = Math.max(8, Math.min(15, Math.round(15 * Math.pow(clampedRatio, 0.25))));
  // 흔들며 칠할 때 입자수도 균형감 있게 15개 -> 최대 30개로 증량
  const particleCount = Math.round(baseCount * (1.0 + agitation * 1.0));

  return {
    sprayRadius,
    particleMinScale,
    particleMaxScale,
    particleCount,
    scaleFactor,
    agitationMultiplier: Number(radiusMultiplier.toFixed(3)),
  };
}

export interface SprayAgitationState {
  smoothedAgitation: number;
  lastX: number;
  lastY: number;
  lastTime: number;
  lastDx: number;
  lastDy: number;
}

export function createSprayAgitationState(x: number, y: number, time: number): SprayAgitationState {
  return {
    smoothedAgitation: 0,
    lastX: x,
    lastY: y,
    lastTime: time,
    lastDx: 0,
    lastDy: 0,
  };
}

export function updateSprayAgitation(
  state: SprayAgitationState,
  currentX: number,
  currentY: number,
  currentTime: number,
): number {
  const dt = Math.max(1, Math.min(100, currentTime - state.lastTime));
  const dx = currentX - state.lastX;
  const dy = currentY - state.lastY;
  const dist = Math.hypot(dx, dy);

  const speed = dist / dt; // px / ms

  let shakeBonus = 1.0;
  if (dist > 3 && (state.lastDx !== 0 || state.lastDy !== 0)) {
    const prevDist = Math.hypot(state.lastDx, state.lastDy);
    if (prevDist > 1) {
      const dot = (dx * state.lastDx + dy * state.lastDy) / (dist * prevDist);
      if (dot < 0.2) {
        shakeBonus = 1.0 + Math.min(1.5, (0.2 - dot) * 1.25);
      }
    }
  }

  const effectiveSpeed = Math.max(0, speed - 0.18) * shakeBonus;
  const targetAgitation = Math.min(1.0, effectiveSpeed / 2.0);

  const isAttacking = targetAgitation > state.smoothedAgitation;
  const smoothingFactor = isAttacking ? 0.27 : 0.08;
  state.smoothedAgitation += (targetAgitation - state.smoothedAgitation) * smoothingFactor;
  state.smoothedAgitation = Math.max(0, Math.min(1, state.smoothedAgitation));

  state.lastX = currentX;
  state.lastY = currentY;
  state.lastTime = currentTime;
  if (dist > 2) {
    state.lastDx = dx;
    state.lastDy = dy;
  }

  return state.smoothedAgitation;
}
