import { describe, expect, it } from "vitest";
import * as THREE from "three";

import {
  applyCostalCartilageStyle,
  COSTAL_CARTILAGE_STYLE,
  createAdaptiveFlowGuideMaterial,
  createFocusPresets,
  createHolographicMaterials,
  createHoverMaterials,
  createMatteScalpMaterials,
  createPaintStrokeMaterials,
  createRegionalBoundaryMaterial,
  createSelectedMaterials,
  createSelectedTransparentMaterials,
  createStructuredFlowShellFillMaterials,
  INTERNALS_READABILITY_STYLE,
  shouldReturnToFullBody,
  getFullBodyReturnThreshold,
  calculateAdaptiveSprayMetrics,
  createSprayAgitationState,
  updateSprayAgitation,
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

  it("createSelectedTransparentMaterials는 표층 투시용 반투명 사이안 셰이딩을 생성한다", () => {
    const source = new THREE.MeshStandardMaterial({ vertexColors: true });
    const selected = createSelectedTransparentMaterials(source, 0.35) as THREE.MeshStandardMaterial;

    expect(selected.vertexColors).toBe(false);
    expect(selected.color.getHex()).toBe(0x38bdf8);
    expect(selected.transparent).toBe(true);
    expect(selected.opacity).toBe(0.35);
    expect(selected.depthWrite).toBe(false);
    expect(selected.side).toBe(THREE.DoubleSide);
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

    expect(presets.head.target.y).toBeCloseTo(1.927);
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
  it("전면에서는 85%, 후면에서는 95% 임계값을 적용하여 후면 조작 시 튕김을 방지한다", () => {
    // 1) 전면 카메라 (z > target.z)
    const frontOpts = {
      cameraPosition: { x: 0, z: 6.8 },
      targetPosition: { x: 0, z: 0 },
    };
    expect(getFullBodyReturnThreshold(frontOpts)).toBe(0.85);
    // 전면: 6.8 * 0.85 = 5.78m
    expect(shouldReturnToFullBody("head", 5.80, 6.8, frontOpts)).toBe(true);
    expect(shouldReturnToFullBody("head", 5.75, 6.8, frontOpts)).toBe(false);

    // 2) 후면 카메라 (z < target.z)
    const backOpts = {
      cameraPosition: { x: 0, z: -6.8 },
      targetPosition: { x: 0, z: 0 },
    };
    expect(getFullBodyReturnThreshold(backOpts)).toBe(0.95);
    // 후면: 6.8 * 0.95 = 6.46m (후면에서는 6.46m까지 더 멀리 빼야만 복귀)
    expect(shouldReturnToFullBody("head", 6.47, 6.8, backOpts)).toBe(true);
    expect(shouldReturnToFullBody("head", 6.40, 6.8, backOpts)).toBe(false);

    // 3) 측면 카메라 (z = target.z) - 90% 중간값 보간
    const sideOpts = {
      cameraPosition: { x: 6.8, z: 0 },
      targetPosition: { x: 0, z: 0 },
    };
    expect(getFullBodyReturnThreshold(sideOpts)).toBe(0.90);
  });

  it("단일 숫자 비율 지정 시 해당 비율을 우선 적용한다", () => {
    expect(shouldReturnToFullBody("head", 6.35, 6.8, 0.93)).toBe(true);
    expect(shouldReturnToFullBody("head", 6.30, 6.8, 0.93)).toBe(false);
  });

  it("이미 전체 보기라면 같은 거리에서도 다시 전환하지 않는다", () => {
    expect(shouldReturnToFullBody("full", 6.8, 6.8)).toBe(false);
  });

  it("통증 부위 칠하기 재질은 붉은색 계열 하이라이트와 발광을 적용한다", () => {
    const source = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const paintMat = createPaintStrokeMaterials(source) as THREE.MeshStandardMaterial;

    expect(paintMat.color.getHexString()).toBe("f43f5e");
    expect(paintMat.emissive.getHexString()).toBe("be123c");
    expect(paintMat.emissiveIntensity).toBeCloseTo(0.85);
  });

  it("마우스 오버 재질은 고대비 앰버/골드 계열 하이라이트를 적용한다", () => {
    const source = new THREE.MeshStandardMaterial({ color: 0xcccccc });
    const hoverMat = createHoverMaterials(source) as THREE.MeshStandardMaterial;

    expect(hoverMat.color.getHexString()).toBe("f59e0b");
    expect(hoverMat.emissive.getHexString()).toBe("d97706");
    expect(hoverMat.emissiveIntensity).toBeCloseTo(0.85);
  });
});

describe("calculateAdaptiveSprayMetrics (스프레이 브러시 확대 적응형 크기/반경)", () => {
  it("전신 거리(5.0m)에서는 단정해진 기본 반경(0.055m)과 기본 입자 크기(0.004~0.008)를 유지한다", () => {
    const metrics = calculateAdaptiveSprayMetrics({
      cameraDistance: 5.0,
      referenceDistance: 5.0,
    });

    expect(metrics.sprayRadius).toBe(0.055);
    expect(metrics.particleMinScale).toBe(0.004);
    expect(metrics.particleMaxScale).toBe(0.008);
    expect(metrics.scaleFactor).toBe(1.0);
    expect(metrics.particleCount).toBe(15);
  });

  it("머리/얼굴 확대 거리(1.25m)에서는 반경과 입자 크기가 줌 비율에 반비례 이상으로 대폭 축소된다", () => {
    const fullMetrics = calculateAdaptiveSprayMetrics({
      cameraDistance: 5.0,
      referenceDistance: 5.0,
    });
    const headMetrics = calculateAdaptiveSprayMetrics({
      cameraDistance: 1.25,
      referenceDistance: 5.0,
    });

    // 4배 줌인 시, 단순 선형 비율(0.25)보다 더 크게 축소(지수 1.15 -> 약 0.203)
    expect(headMetrics.sprayRadius).toBeLessThan(fullMetrics.sprayRadius * 0.25);
    expect(headMetrics.particleMinScale).toBeLessThan(fullMetrics.particleMinScale * 0.25);
    expect(headMetrics.particleMaxScale).toBeLessThan(fullMetrics.particleMaxScale * 0.25);

    // 구체적 수치 검증: 반경 약 1.1cm 수준으로 초섬세 분사 지원
    expect(headMetrics.sprayRadius).toBeCloseTo(0.0112, 3);
    expect(headMetrics.particleMinScale).toBeCloseTo(0.00081, 4);
    expect(headMetrics.particleMaxScale).toBeCloseTo(0.00162, 4);
  });

  it("초근접 확대(0.8m) 시에도 최소 안전 계수(0.1)가 적용되어 0으로 퇴화하지 않는다", () => {
    const metrics = calculateAdaptiveSprayMetrics({
      cameraDistance: 0.8,
      referenceDistance: 5.0,
    });

    expect(metrics.sprayRadius).toBeGreaterThan(0.005);
    expect(metrics.particleMinScale).toBeGreaterThan(0.0003);
    expect(metrics.particleCount).toBeGreaterThanOrEqual(8);
  });

  it("커서 흔들림(agitation) 강도에 따라 흩뿌림 반경과 입자 크기가 스무스하게 확대된다", () => {
    const calmMetrics = calculateAdaptiveSprayMetrics({
      cameraDistance: 5.0,
      referenceDistance: 5.0,
      agitation: 0.0,
    });
    const midMetrics = calculateAdaptiveSprayMetrics({
      cameraDistance: 5.0,
      referenceDistance: 5.0,
      agitation: 0.5,
    });
    const vigorousMetrics = calculateAdaptiveSprayMetrics({
      cameraDistance: 5.0,
      referenceDistance: 5.0,
      agitation: 1.0,
    });

    // 흩뿌림 반경: 0.055m -> 최대 2.55배 (약 0.140m)
    expect(midMetrics.sprayRadius).toBeGreaterThan(calmMetrics.sprayRadius);
    expect(vigorousMetrics.sprayRadius).toBeCloseTo(calmMetrics.sprayRadius * 2.55, 3);

    // 알갱이 크기: 0.004~0.008 -> 최대 2.1배 (0.0084~0.0168)
    expect(vigorousMetrics.particleMinScale).toBeCloseTo(calmMetrics.particleMinScale * 2.1, 4);
    expect(vigorousMetrics.particleMaxScale).toBeCloseTo(calmMetrics.particleMaxScale * 2.1, 4);

    // 입자 개수도 균형감 있게 15개 -> 최대 30개로 증량
    expect(vigorousMetrics.particleCount).toBe(30);
  });

  it("updateSprayAgitation은 커서를 빠르게 왕복 흔들 때 점차 스무스하게 강도를 높이고, 정지 시 부드럽게 감쇠한다", () => {
    const state = createSprayAgitationState(100, 100, 1000);
    expect(state.smoothedAgitation).toBe(0);

    // 1. 느린 미세 이동 (speed < 0.2 px/ms)
    updateSprayAgitation(state, 102, 100, 1020);
    expect(state.smoothedAgitation).toBeCloseTo(0, 2);

    // 2. 좌우 왕복 빠른 흔들림 (100 -> 140 -> 90 -> 150)
    const ag1 = updateSprayAgitation(state, 140, 100, 1040); // speed 2.0 px/ms
    const ag2 = updateSprayAgitation(state, 90, 100, 1060); // speed 2.5 px/ms + 방향 반전
    const ag3 = updateSprayAgitation(state, 150, 100, 1080); // speed 3.0 px/ms + 방향 반전

    expect(ag2).toBeGreaterThan(ag1);
    expect(ag3).toBeGreaterThan(ag2);
    expect(ag3).toBeGreaterThan(0.3); // 점차 스무스하게 커짐

    // 3. 정지/감속 (움직임 멈춤)
    const agDecay1 = updateSprayAgitation(state, 150, 100, 1100);
    const agDecay2 = updateSprayAgitation(state, 150, 100, 1120);
    expect(agDecay1).toBeLessThan(ag3);
    expect(agDecay2).toBeLessThan(agDecay1); // 점차 스무스하게 감소
  });
});


