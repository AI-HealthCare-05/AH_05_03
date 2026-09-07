import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  applyCostalCartilageStyle,
  COSTAL_CARTILAGE_STYLE,
  createAdaptiveFlowGuideMaterial,
  createFocusPresets,
  createHolographicMaterials,
  createMatteScalpMaterials,
  createRegionalBoundaryMaterial,
  createSelectedMaterials,
  createStructuredFlowShellFillMaterials,
  INTERNALS_READABILITY_STYLE,
  shouldReturnToFullBody,
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
    source.vertexColors = true;
    const skeleton = createHolographicMaterials(
      source,
      "skeleton",
      "skeletal",
      ownedMaterials,
      INTERNALS_READABILITY_STYLE.skeletonOpacity,
    ) as THREE.MeshStandardMaterial;

    expect(skeleton.opacity).toBeCloseTo(0.96);
    expect(skeleton.transparent).toBe(true);
    expect(skeleton.vertexColors).toBe(false);
  });

  it("GLB 진단용 정점 색상이 골격 및 선택 강조색에 섞이지 않는다", () => {
    const source = new THREE.MeshStandardMaterial({ vertexColors: true });
    const selected = createSelectedMaterials(source) as THREE.MeshStandardMaterial;

    expect(selected.vertexColors).toBe(false);
    expect(selected.color.getHex()).toBe(0x38bdf8);
  });

  it("골격 단독 화면은 분절된 두개골이 조각처럼 보이지 않도록 불투명하게 렌더링한다", () => {
    const skeleton = createHolographicMaterials(
      new THREE.MeshStandardMaterial(),
      "skeleton",
      "skeletal",
      new Set<THREE.Material>(),
      1,
    ) as THREE.MeshStandardMaterial;

    expect(skeleton.opacity).toBe(1);
    expect(skeleton.transparent).toBe(false);
    expect(skeleton.depthWrite).toBe(true);
  });

  it("관절·인대·막은 골격과 구분되는 연골색과 투명도를 사용한다", () => {
    const ownedMaterials = new Set<THREE.Material>();
    const joint = createHolographicMaterials(
      new THREE.MeshStandardMaterial(),
      "skeleton",
      "joints",
      ownedMaterials,
    ) as THREE.MeshStandardMaterial;

    expect(joint.color.getHex()).toBe(0x9fcfd8);
    expect(joint.opacity).toBeCloseTo(0.68);
    expect(joint.transparent).toBe(true);
  });

  it("지연 로드된 근육·신경계·림프계에 서로 다른 계통 색상을 적용한다", () => {
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
    const lymphatic = createHolographicMaterials(
      source,
      "organ",
      "lymphatic",
      ownedMaterials,
    ) as THREE.MeshStandardMaterial;

    expect(muscle.color.getHex()).toBe(0xd97865);
    expect(nervous.color.getHex()).toBe(0xf0cf69);
    expect(lymphatic.color.getHex()).toBe(0x77c99a);
  });

  it("여성 두개건막은 반사광 없는 Lambert 무광 재질을 사용한다", () => {
    const ownedMaterials = new Set<THREE.Material>();
    const source = new THREE.MeshStandardMaterial({
      metalness: 0.8,
      roughness: 0.1,
      vertexColors: true,
    });
    const scalp = createMatteScalpMaterials(
      source,
      ownedMaterials,
    ) as THREE.MeshLambertMaterial;

    expect(scalp).toBeInstanceOf(THREE.MeshLambertMaterial);
    expect(scalp.color.getHex()).toBe(0xd97865);
    expect(scalp.vertexColors).toBe(false);
    expect(scalp.transparent).toBe(false);
    expect(scalp.depthWrite).toBe(true);
    expect(ownedMaterials.has(scalp)).toBe(true);
  });

  it("갈비연골은 골격보다 연한 색으로 보이고 상반신 확대 시 투명해진다", () => {
    const material = new THREE.MeshStandardMaterial();

    applyCostalCartilageStyle(material, false);
    expect(material.color.getHex()).toBe(0xb9e2eb);
    expect(material.opacity).toBeCloseTo(COSTAL_CARTILAGE_STYLE.defaultOpacity);
    expect(material.depthWrite).toBe(true);

    applyCostalCartilageStyle(material, true);
    expect(material.opacity).toBeCloseTo(COSTAL_CARTILAGE_STYLE.upperFocusOpacity);
    expect(material.transparent).toBe(true);
    expect(material.depthWrite).toBe(true);
  });
});

describe("anatomy camera focus presets", () => {
  it("하반신·무릎·발 확대 위치를 순서대로 구성한다", () => {
    const bounds = new THREE.Box3(
      new THREE.Vector3(-1, -2.35, -0.5),
      new THREE.Vector3(1, 2.35, 0.5),
    );
    const presets = createFocusPresets(bounds);

    expect(presets.head.target.y).toBeCloseTo(2.1385);
    expect(presets.lower.target.y).toBeCloseTo(-0.094);
    expect(presets.knee.target.y).toBeCloseTo(-1.457);
    expect(presets.foot.target.y).toBeCloseTo(-1.927);
    expect(presets.lower.target.y).toBeGreaterThan(presets.knee.target.y);
    expect(presets.knee.target.y).toBeGreaterThan(presets.foot.target.y);
    expect(presets.leftHand.target.x).toBeGreaterThan(presets.full.target.x);
    expect(presets.rightHand.target.x).toBeLessThan(presets.full.target.x);
    expect(presets.leftHand.target.x - presets.full.target.x).toBeCloseTo(
      presets.full.target.x - presets.rightHand.target.x,
    );
  });
});

describe("focused anatomy camera zoom-out return", () => {
  it("빠른 확대 중 전신 거리의 45% 이상 줌아웃하면 전체 보기로 복귀한다", () => {
    expect(shouldReturnToFullBody("head", 3.06, 6.8)).toBe(true);
    expect(shouldReturnToFullBody("head", 3.05, 6.8)).toBe(false);
  });

  it("이미 전체 보기라면 같은 거리에서도 다시 전환하지 않는다", () => {
    expect(shouldReturnToFullBody("full", 6.8, 6.8)).toBe(false);
  });
});
