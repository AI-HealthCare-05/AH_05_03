import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { collectDepthHitCandidates } from "./depthPicker";

describe("depthPicker", () => {
  it("빈 hit 배열이 주어지면 빈 배열을 반환한다", () => {
    expect(collectDepthHitCandidates([])).toEqual([]);
  });

  it("거리 오름차순으로 정렬하고 메쉬 중복(입/출구)을 제거한다", () => {
    const meshSkin = new THREE.Mesh();
    meshSkin.name = "skin_torso";

    const meshMuscle = new THREE.Mesh();
    meshMuscle.name = "pectoralis_major_r";

    const meshRib = new THREE.Mesh();
    meshRib.name = "rib_5_r";

    const rawHits: THREE.Intersection[] = [
      // 동일 메쉬의 출구 교차가 먼저 올 수 없지만 섞여 있을 때
      { distance: 1.15, point: new THREE.Vector3(0, 0, -1.15), object: meshMuscle },
      { distance: 1.0, point: new THREE.Vector3(0, 0, -1.0), object: meshSkin },
      { distance: 1.05, point: new THREE.Vector3(0, 0, -1.05), object: meshSkin }, // 중복
      { distance: 1.10, point: new THREE.Vector3(0, 0, -1.10), object: meshMuscle }, // 입구
      { distance: 1.25, point: new THREE.Vector3(0, 0, -1.25), object: meshRib },
    ];

    const candidates = collectDepthHitCandidates(rawHits);

    expect(candidates).toHaveLength(3);
    expect(candidates[0].meshName).toBe("skin_torso");
    expect(candidates[0].depthLevel).toBe("surface");
    expect(candidates[0].distance).toBe(1.0);

    expect(candidates[1].meshName).toBe("pectoralis_major_r");
    expect(candidates[1].distance).toBe(1.10);

    expect(candidates[2].meshName).toBe("rib_5_r");
    expect(candidates[2].distance).toBe(1.25);
    expect(candidates[2].system).toBe("skeletal");
  });

  it("최대 관통 거리를 초과한 반대편 신체 메쉬는 후보에서 차단한다", () => {
    const meshFrontSkin = new THREE.Mesh();
    meshFrontSkin.name = "skin_front";

    const meshHeart = new THREE.Mesh();
    meshHeart.name = "heart";

    const meshBackSkin = new THREE.Mesh();
    meshBackSkin.name = "skin_back";

    const rawHits: THREE.Intersection[] = [
      { distance: 1.0, point: new THREE.Vector3(0, 0, -1.0), object: meshFrontSkin },
      { distance: 1.15, point: new THREE.Vector3(0, 0, -1.15), object: meshHeart },
      { distance: 1.70, point: new THREE.Vector3(0, 0, -1.70), object: meshBackSkin }, // 0.70m 차이 -> 관통 초과
    ];

    const candidates = collectDepthHitCandidates(rawHits, { maxPenetrationDistance: 0.35 });

    expect(candidates).toHaveLength(2);
    expect(candidates.map((c) => c.meshName)).toEqual(["skin_front", "heart"]);
  });

  it("보이지 않는 메쉬 및 무시 목록에 포함된 메쉬는 제외한다", () => {
    const visibleMesh = new THREE.Mesh();
    visibleMesh.name = "deltoid_r";

    const hiddenMesh = new THREE.Mesh();
    hiddenMesh.name = "biceps_r";
    hiddenMesh.visible = false;

    const ignoredMesh = new THREE.Mesh();
    ignoredMesh.name = "helper_bounds";

    const rawHits: THREE.Intersection[] = [
      { distance: 1.0, point: new THREE.Vector3(0, 0, -1.0), object: hiddenMesh },
      { distance: 1.05, point: new THREE.Vector3(0, 0, -1.05), object: visibleMesh },
      { distance: 1.10, point: new THREE.Vector3(0, 0, -1.10), object: ignoredMesh },
    ];

    const candidates = collectDepthHitCandidates(rawHits, {
      ignoredMeshNames: new Set(["helper_bounds"]),
    });

    expect(candidates).toHaveLength(1);
    expect(candidates[0].meshName).toBe("deltoid_r");
  });

  it("장경인대(iliotibial tract) 등 표재성 구조는 관통 거리가 떨어져 있어도 심층으로 역전되지 않고 표층/천층으로 보정된다", () => {
    const meshSkin = new THREE.Mesh();
    meshSkin.name = "skin_leg";

    const meshVastusLat = new THREE.Mesh();
    meshVastusLat.name = "vastus_lateralis";

    const meshITBand = new THREE.Mesh();
    meshITBand.name = "iliotibial_tract";

    const rawHits: THREE.Intersection[] = [
      { distance: 1.0, point: new THREE.Vector3(0, 0, -1.0), object: meshSkin },
      { distance: 1.05, point: new THREE.Vector3(0, 0, -1.05), object: meshVastusLat },
      { distance: 1.12, point: new THREE.Vector3(0, 0, -1.12), object: meshITBand }, // delta: 0.12m
    ];

    const candidates = collectDepthHitCandidates(rawHits);
    const itCandidate = candidates.find((c) => c.meshName === "iliotibial_tract");

    expect(itCandidate).toBeDefined();
    // 장경인대는 12cm 떨어져 있어도 deep/mid 대신 shallow로 올바르게 보정됨
    expect(["surface", "shallow"]).toContain(itCandidate?.depthLevel);
  });
});

