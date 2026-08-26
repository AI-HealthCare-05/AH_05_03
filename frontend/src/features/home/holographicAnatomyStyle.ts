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

const ORGAN_COLORS: Record<string, number> = {
  cardiovascular: 0xe45f63,
  digestive: 0xe7a565,
  endocrine: 0xd28fe2,
  mammary: 0xf0a3bd,
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
      clone.color.setHex(0xd9f7ff);
      clone.emissive.setHex(0x17475a);
      clone.emissiveIntensity = 0.18;
      clone.transparent = true;
      clone.opacity = skeletonOpacity;
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
    if (clone instanceof THREE.MeshStandardMaterial) {
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

export function materialsOf(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

export function createFocusPresets(bounds: THREE.Box3) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const frontDistance = Math.max(size.y * 1.45, 4.8);
  const lowerDistance = frontDistance * 0.6;
  const closeDistance = Math.max(size.y * 0.31, 1.25);
  const upperDistance = Math.max(size.y * 0.68, 2.8);
  const kneeDistance = Math.max(size.y * 0.45, 1.85);
  const footDistance = Math.max(size.y * 0.46, 1.9);
  const handX = center.x + size.x * 0.43;
  const waistY = center.y - size.y * 0.02;
  const kneeY = center.y - size.y * 0.31;
  const footY = bounds.min.y + size.y * 0.09;

  return {
    full: {
      position: new THREE.Vector3(center.x, center.y, frontDistance),
      target: center.clone(),
    },
    head: {
      position: new THREE.Vector3(center.x, bounds.max.y - size.y * 0.1, closeDistance),
      target: new THREE.Vector3(center.x, bounds.max.y - size.y * 0.1, center.z),
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
      position: new THREE.Vector3(handX, center.y - size.y * 0.04, closeDistance),
      target: new THREE.Vector3(handX, center.y - size.y * 0.04, center.z),
    },
  };
}
