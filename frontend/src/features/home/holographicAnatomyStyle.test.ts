import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  createAdaptiveFlowGuideMaterial,
  createFocusPresets,
  createHolographicMaterials,
  createRegionalBoundaryMaterial,
  createStructuredFlowShellFillMaterials,
  INTERNALS_READABILITY_STYLE,
} from "./holographicAnatomyStyle";

describe("final anatomy hologram materials", () => {
  it("v28 외피와 적응형 가이드를 내부 구조용 강도로 감광한다", () => {
    const ownedMaterials = new Set<THREE.Material>();
    const source = new THREE.MeshStandardMaterial();
    const shell = createStructuredFlowShellFillMaterials(
      source,
      ownedMaterials,
      INTERNALS_READABILITY_STYLE.shellFillOpacity,
    ) as THREE.MeshStandardMaterial;
    const bodyGuide = createAdaptiveFlowGuideMaterial(
      ownedMaterials,
      false,
      INTERNALS_READABILITY_STYLE.bodyGuideOpacity,
    );
    const detailGuide = createAdaptiveFlowGuideMaterial(
      ownedMaterials,
      true,
      INTERNALS_READABILITY_STYLE.detailGuideOpacity,
    );

    expect(shell.wireframe).toBe(false);
    expect(shell.opacity).toBeCloseTo(0.05);
    expect(shell.depthWrite).toBe(false);
    expect(bodyGuide.wireframe).toBe(true);
    expect(bodyGuide.opacity).toBeCloseTo(0.18);
    expect(detailGuide.opacity).toBeCloseTo(0.14);
  });

  it("구획선은 외피와 같은 색으로 낮게 표시한다", () => {
    const ownedMaterials = new Set<THREE.Material>();
    const boundary = createRegionalBoundaryMaterial(
      ownedMaterials,
      INTERNALS_READABILITY_STYLE.regionalBoundaryOpacity,
    );

    expect(boundary.wireframe).toBe(false);
    expect(boundary.color.getHex()).toBe(0x4de4ff);
    expect(boundary.opacity).toBeCloseTo(0.12);
    expect(boundary.depthWrite).toBe(false);
  });

  it("v28 골격은 외피 안에서 높은 불투명도를 유지한다", () => {
    const ownedMaterials = new Set<THREE.Material>();
    const source = new THREE.MeshStandardMaterial();
    const skeleton = createHolographicMaterials(
      source,
      "skeleton",
      "skeletal",
      ownedMaterials,
      INTERNALS_READABILITY_STYLE.skeletonOpacity,
    ) as THREE.MeshStandardMaterial;

    expect(skeleton.opacity).toBeCloseTo(0.96);
    expect(skeleton.transparent).toBe(true);
  });

  it("지연 로드된 근육과 신경계에 서로 다른 계통 색상을 적용한다", () => {
    const ownedMaterials = new Set<THREE.Material>();
    const source = new THREE.MeshStandardMaterial();
    const muscle = createHolographicMaterials(
      source,
      "organ",
      "muscular",
      ownedMaterials,
    ) as THREE.MeshStandardMaterial;
    const nervous = createHolographicMaterials(
      source,
      "organ",
      "nervous",
      ownedMaterials,
    ) as THREE.MeshStandardMaterial;

    expect(muscle.color.getHex()).toBe(0xd97865);
    expect(nervous.color.getHex()).toBe(0xf0cf69);
  });
});

describe("anatomy camera focus presets", () => {
  it("하반신·무릎·발 확대 위치를 순서대로 구성한다", () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-1, -2.35, -0.5),
      new THREE.Vector3(1, 2.35, 0.5),
    );
    const presets = createFocusPresets(bounds);

    expect(presets.lower.target.y).toBeCloseTo(-0.094);
    expect(presets.knee.target.y).toBeCloseTo(-1.457);
    expect(presets.foot.target.y).toBeCloseTo(-1.927);
    expect(presets.lower.target.y).toBeGreaterThan(presets.knee.target.y);
    expect(presets.knee.target.y).toBeGreaterThan(presets.foot.target.y);
  });
});
