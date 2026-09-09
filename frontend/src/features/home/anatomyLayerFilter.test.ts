import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  matchesSystemCategory,
  isSkeletonStructure,
  isFasciaStructure,
  isPeritoneumStructure,
  applyXRayShading,
  restoreXRayShading,
  ANATOMY_SYSTEM_CONFIGS,
} from "./anatomyLayerFilter";

describe("anatomyLayerFilter", () => {
  it("골격계 구조 판정(isSkeletonStructure)이 두개골, 척추, 사지뼈 등을 정확히 검출한다", () => {
    // 1. 이름 기반 판정
    expect(isSkeletonStructure("Frontal bone.001")).toBe(true);
    expect(isSkeletonStructure("official-head-ethmoid-bone")).toBe(true);
    expect(isSkeletonStructure("Mandible.001")).toBe(true);
    expect(isSkeletonStructure("Cervical vertebra 3")).toBe(true);
    expect(isSkeletonStructure("rib_5_r")).toBe(true);
    expect(isSkeletonStructure("Femur.l")).toBe(true);

    // 근육/외피는 골격 아님 (뼈 명칭이 포함된 근육도 완벽하게 근육으로 판정)
    expect(isSkeletonStructure("biceps_brachii_r")).toBe(false);
    expect(isSkeletonStructure("body-shell__Hairs_of_head")).toBe(false);
    expect(isSkeletonStructure("heart")).toBe(false);

    // 사용자가 지적한 주요 근육군 (이름에 골격 단어가 포함된 경우)
    expect(isSkeletonStructure("Infraspinatus muscle.l.001")).toBe(false);
    expect(isSkeletonStructure("Supraspinatus muscle.r.001")).toBe(false);
    expect(isSkeletonStructure("Subscapularis muscle.l.001")).toBe(false);
    expect(isSkeletonStructure("Levator scapulae muscle.r.001")).toBe(false);
    expect(isSkeletonStructure("Temporalis muscle.l.001")).toBe(false);
    expect(isSkeletonStructure("Occipitalis muscle.r.001")).toBe(false);
    expect(isSkeletonStructure("Rectus femoris muscle.l.001")).toBe(false);
    expect(isSkeletonStructure("Clavicular part of deltoid muscle.l.001")).toBe(false);
    expect(isSkeletonStructure("Zygomaticus major muscle.r.001")).toBe(false);
    expect(isSkeletonStructure("Semispinalis capitis muscle.l.001")).toBe(false);

    // 2. Mesh userData 기반 판정
    const boneMesh = new THREE.Mesh();
    boneMesh.userData = { structureSystem: "skeletal", visualRole: "skeleton" };
    expect(isSkeletonStructure(boneMesh)).toBe(true);

    const jointMesh = new THREE.Mesh();
    jointMesh.userData = { structureSystem: "joints" };
    expect(isSkeletonStructure(jointMesh)).toBe(true);

    const muscleMesh = new THREE.Mesh();
    muscleMesh.userData = { structureSystem: "muscular" };
    expect(isSkeletonStructure(muscleMesh)).toBe(false);

    // userData.structureSystem === 'muscular' 인 경우 이름에 뼈 단어가 있어도 절대 골격이 아님
    const scapularMuscleMesh = new THREE.Mesh();
    scapularMuscleMesh.name = "Infraspinatus.l.001";
    scapularMuscleMesh.userData = { structureSystem: "muscular" };
    expect(isSkeletonStructure(scapularMuscleMesh)).toBe(false);

    const temporalMuscleMesh = new THREE.Mesh();
    temporalMuscleMesh.name = "Temporalis.r.001";
    temporalMuscleMesh.userData = { structureSystem: "muscular" };
    expect(isSkeletonStructure(temporalMuscleMesh)).toBe(false);
  });

  it("계통 카테고리 매칭을 정확히 판정한다", () => {
    expect(matchesSystemCategory("rib_5_r", "skeletal")).toBe(true);
    expect(matchesSystemCategory("Frontal bone.001", "skeletal")).toBe(true);
    expect(matchesSystemCategory("pectoralis_major_r", "muscular")).toBe(true);
    expect(matchesSystemCategory("heart", "visceral")).toBe(true);
    expect(matchesSystemCategory("tooth_11", "dental")).toBe(true);
    expect(matchesSystemCategory("any_mesh", "all")).toBe(true);

    // 두개골 뼈는 muscular에 속하지 않아야 함
    expect(matchesSystemCategory("Frontal bone.001", "muscular")).toBe(false);
    expect(matchesSystemCategory("official-head-ethmoid-bone", "muscular")).toBe(false);
  });

  it("ANATOMY_SYSTEM_CONFIGS에 5개 기본 프리셋이 정의되어 있다", () => {
    expect(ANATOMY_SYSTEM_CONFIGS).toHaveLength(5);
    expect(ANATOMY_SYSTEM_CONFIGS.map((c) => c.id)).toEqual([
      "all",
      "skeletal",
      "muscular",
      "visceral",
      "dental",
    ]);
  });

  it("applyXRayShading 적용 시 기본(all) 모드에서도 두개골을 포함한 전신 뼈가 투시 타깃으로 온전히 보호된다", () => {
    const origMaterialMuscle = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 1.0 });
    const meshMuscle = new THREE.Mesh(new THREE.BufferGeometry(), origMaterialMuscle);
    meshMuscle.name = "biceps_r";
    meshMuscle.userData = { structureSystem: "muscular" };

    const origMaterialSkull = new THREE.MeshBasicMaterial({ color: 0xd9f7ff, opacity: 1.0 });
    const meshSkull = new THREE.Mesh(new THREE.BufferGeometry(), origMaterialSkull);
    meshSkull.name = "Frontal bone.001";
    meshSkull.userData = { structureSystem: "skeletal", visualRole: "skeleton" };

    const origMaterialRib = new THREE.MeshBasicMaterial({ color: 0xd9f7ff, opacity: 1.0 });
    const meshRib = new THREE.Mesh(new THREE.BufferGeometry(), origMaterialRib);
    meshRib.name = "rib_7_l";
    meshRib.userData = { structureSystem: "skeletal", visualRole: "skeleton" };

    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const ghostMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

    // 기본 'all' 카테고리로 X-ray 모드 적용
    applyXRayShading([meshMuscle, meshSkull, meshRib], {
      activeCategory: "all",
      ghostOpacity: 0.15,
      originalMaterials,
      ghostMaterialsMap,
    });

    // 근육은 고스트화 (opacity 0.15, depthWrite false, renderOrder 1)
    const muscleMat = meshMuscle.material as THREE.MeshBasicMaterial;
    expect(muscleMat.transparent).toBe(true);
    expect(muscleMat.opacity).toBe(0.15);
    expect(muscleMat.depthWrite).toBe(false);
    expect(meshMuscle.renderOrder).toBe(1);

    // 두개골 뼈와 늑골 모두 타깃이므로 원본 불투명도 유지 및 상위 renderOrder 10
    const skullMat = meshSkull.material as THREE.MeshBasicMaterial;
    expect(skullMat.opacity).toBe(1.0);
    expect(meshSkull.renderOrder).toBe(10);

    const ribMat = meshRib.material as THREE.MeshBasicMaterial;
    expect(ribMat.opacity).toBe(1.0);
    expect(meshRib.renderOrder).toBe(10);

    // 복원 테스트
    restoreXRayShading([meshMuscle, meshSkull, meshRib], originalMaterials);
    expect(meshMuscle.material).toBe(origMaterialMuscle);
    expect(meshMuscle.renderOrder).toBe(0);
    expect(meshSkull.material).toBe(origMaterialSkull);
    expect(meshSkull.renderOrder).toBe(0);
    expect(meshRib.material).toBe(origMaterialRib);
    expect(meshRib.renderOrder).toBe(0);
  });

  it("applyXRayShading 적용 시 선택된 장기(예: 심장)는 고스트화되지 않고 반투명 셰이딩(renderOrder 15)으로 골격을 가리지 않게 처리된다", () => {
    const selectedMatHeart = new THREE.MeshBasicMaterial({ color: 0xff6600, opacity: 1.0 });
    const meshHeart = new THREE.Mesh(new THREE.BufferGeometry(), selectedMatHeart);
    meshHeart.name = "heart-right-atrium";
    meshHeart.userData = { structureSystem: "cardiovascular", visualRole: "organ" };

    const origMaterialMuscle = new THREE.MeshBasicMaterial({ color: 0xff0000, opacity: 1.0 });
    const meshMuscle = new THREE.Mesh(new THREE.BufferGeometry(), origMaterialMuscle);
    meshMuscle.name = "pectoralis_major";
    meshMuscle.userData = { structureSystem: "muscular" };

    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const ghostMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const selectedMeshes = new Set<THREE.Mesh>([meshHeart]);

    applyXRayShading([meshHeart, meshMuscle], {
      originalMaterials,
      ghostMaterialsMap,
      selectedMeshes,
    });

    // 선택된 비골격(심장) 메쉬는 고스트화되지 않고 강조 재질 유지 및 뒤쪽 골격을 배려한 renderOrder 15
    expect(meshHeart.material).toBe(selectedMatHeart);
    expect(meshHeart.renderOrder).toBe(15);

    // 선택되지 않은 근육은 정상적으로 고스트화
    const muscleMat = meshMuscle.material as THREE.MeshBasicMaterial;
    expect(muscleMat.transparent).toBe(true);
    expect(muscleMat.opacity).toBe(0.15);
    expect(meshMuscle.renderOrder).toBe(1);
  });

  it("근막 구조 판정(isFasciaStructure)이 근막, 건막, 장경인대, 지지대를 판별하고 기능성 근육은 제외한다", () => {
    // 1. 근막류 판별
    expect(isFasciaStructure("Fascia lata.l")).toBe(true);
    expect(isFasciaStructure("Investing Abdominal Fascial001")).toBe(true);
    expect(isFasciaStructure("Thoracic and vertebral superficial fascia coverage")).toBe(true);
    expect(isFasciaStructure("Galea aponeurotica")).toBe(true);
    expect(isFasciaStructure("Plantar aponeurosis")).toBe(true);
    expect(isFasciaStructure("Iliotibial tract.r")).toBe(true);
    expect(isFasciaStructure("Tractus iliotibialis")).toBe(true);
    expect(isFasciaStructure("Flexor retinaculum of hand.l")).toBe(true);
    expect(isFasciaStructure("Rectus sheath")).toBe(true);
    expect(isFasciaStructure("흉요근막")).toBe(true);
    expect(isFasciaStructure("장경인대")).toBe(true);
    expect(isFasciaStructure("모상건막")).toBe(true);

    // 2. 대퇴근막장근(Tensor fasciae latae)은 근육이므로 제외
    expect(isFasciaStructure("Tensor fasciae latae muscle.l")).toBe(false);
    expect(isFasciaStructure("Tensor fascia lata.r")).toBe(false);
    expect(isFasciaStructure("대퇴근막장근")).toBe(false);

    // 3. 일반 골격근은 제외
    expect(isFasciaStructure("Pectoralis major.l")).toBe(false);
    expect(isFasciaStructure("Biceps brachii.r")).toBe(false);
    expect(isFasciaStructure("Trapezius.l")).toBe(false);
    expect(isFasciaStructure("Rectus femoris.r")).toBe(false);

    // 4. Three.js Mesh userData 기반 판정
    const fasciaMesh = new THREE.Mesh();
    fasciaMesh.userData = { tissueType: "fascia" };
    expect(isFasciaStructure(fasciaMesh)).toBe(true);

    const tflMesh = new THREE.Mesh();
    tflMesh.name = "Tensor fasciae latae";
    tflMesh.userData = { structureLabel: "대퇴근막장근" };
    expect(isFasciaStructure(tflMesh)).toBe(false);
  });

  it("복막 구조 판정(isPeritoneumStructure)이 대망, 소망, 결장간막 등을 정확히 판별하고 혈관/림프/장기는 배제한다", () => {
    // 1. 복막 및 그물막 구조 판정
    expect(isPeritoneumStructure("Greater omentum.001")).toBe(true);
    expect(isPeritoneumStructure("Lesser omentum.001")).toBe(true);
    expect(isPeritoneumStructure("Mesocolon.001")).toBe(true);
    expect(isPeritoneumStructure("Meso-appendix.001")).toBe(true);
    expect(isPeritoneumStructure("Mesocolic taenia.001")).toBe(true);
    expect(isPeritoneumStructure("Omental taenia.001")).toBe(true);
    expect(isPeritoneumStructure("Peritoneum")).toBe(true);
    expect(isPeritoneumStructure("Peritoneal sac")).toBe(true);
    expect(isPeritoneumStructure("Falciform ligament of liver")).toBe(true);
    expect(isPeritoneumStructure("대망")).toBe(true);
    expect(isPeritoneumStructure("소망")).toBe(true);
    expect(isPeritoneumStructure("결장간막")).toBe(true);
    expect(isPeritoneumStructure("충수간막")).toBe(true);
    expect(isPeritoneumStructure("복막")).toBe(true);

    // 2. 혈관, 신경, 림프절 등은 배제
    expect(isPeritoneumStructure("Left gastro-omental vein.001")).toBe(false);
    expect(isPeritoneumStructure("Right gastro-omental vein.001")).toBe(false);
    expect(isPeritoneumStructure("Right gastro-omental nodes.001")).toBe(false);
    expect(isPeritoneumStructure("Superior mesenteric artery")).toBe(false);
    expect(isPeritoneumStructure("Inferior mesenteric vein")).toBe(false);

    // 3. 내부 주요 소화기 장기는 배제
    expect(isPeritoneumStructure("Stomach")).toBe(false);
    expect(isPeritoneumStructure("Liver")).toBe(false);
    expect(isPeritoneumStructure("Transverse colon")).toBe(false);
    expect(isPeritoneumStructure("Ascending colon")).toBe(false);
    expect(isPeritoneumStructure("Ileum")).toBe(false);

    // 4. Mesh 기반 판정
    const omentumMesh = new THREE.Mesh();
    omentumMesh.name = "Greater omentum.001";
    expect(isPeritoneumStructure(omentumMesh)).toBe(true);

    const veinMesh = new THREE.Mesh();
    veinMesh.name = "Left gastro-omental vein.001";
    expect(isPeritoneumStructure(veinMesh)).toBe(false);

    const customMesh = new THREE.Mesh();
    customMesh.userData = { tissueType: "peritoneum" };
    expect(isPeritoneumStructure(customMesh)).toBe(true);
  });
});

