import { describe, expect, it } from "vitest";
import * as THREE from "three";
import {
  calculateFocusBounds,
  calculateTargetCameraPosition,
  applyIsolateShading,
  restoreIsolateShading,
} from "./cameraFocusManager";

describe("cameraFocusManager", () => {
  it("메쉬들의 바운딩 박스와 중심점을 정확히 계산한다", () => {
    const geom1 = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mesh1 = new THREE.Mesh(geom1);
    mesh1.position.set(0, 1.0, 0);

    const geom2 = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    const mesh2 = new THREE.Mesh(geom2);
    mesh2.position.set(0.2, 1.2, 0);

    mesh1.updateMatrixWorld();
    mesh2.updateMatrixWorld();

    const bounds = calculateFocusBounds([mesh1, mesh2]);

    expect(bounds.center.y).toBeCloseTo(1.1, 1);
    expect(bounds.radius).toBeGreaterThan(0.1);
  });

  it("카메라 시야각(FOV)을 고려해 적정 줌 거리를 계산한다", () => {
    const camera = new THREE.PerspectiveCamera(45, 1.0, 0.1, 100);
    camera.position.set(0, 1.0, 2.0);

    const bounds = {
      center: new THREE.Vector3(0, 1.0, 0),
      size: new THREE.Vector3(0.4, 0.4, 0.4),
      radius: 0.2,
    };

    const targetPos = calculateTargetCameraPosition(bounds, camera, { viewAngle: "front" });

    expect(targetPos.x).toBeCloseTo(0, 2);
    expect(targetPos.y).toBeCloseTo(1.0, 2);
    expect(targetPos.z).toBeGreaterThan(0.5);
  });

  it("applyIsolateShading 적용 시 선택 외 메쉬는 0.08 고스트화된다", () => {
    const origMaterial1 = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh1 = new THREE.Mesh(new THREE.BufferGeometry(), origMaterial1);

    const origMaterial2 = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh2 = new THREE.Mesh(new THREE.BufferGeometry(), origMaterial2);

    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const ghostMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

    // mesh1만 선택
    applyIsolateShading([mesh1, mesh2], new Set([mesh1]), {
      originalMaterials,
      ghostMaterialsMap,
    });

    expect(mesh1.renderOrder).toBe(20);

    const mat2 = mesh2.material as THREE.MeshBasicMaterial;
    expect(mat2.transparent).toBe(true);
    expect(mat2.opacity).toBe(0.08);
    expect(mesh2.renderOrder).toBe(1);

    // 복원
    restoreIsolateShading([mesh1, mesh2], originalMaterials);
    expect(mesh2.material).toBe(origMaterial2);
    expect(mesh2.renderOrder).toBe(0);
  });

  it("applyIsolateShading 적용 시 아무것도 선택되지 않았을 때(empty set) 모든 메쉬가 고스트화된다", () => {
    const origMaterial1 = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const mesh1 = new THREE.Mesh(new THREE.BufferGeometry(), origMaterial1);

    const origMaterial2 = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const mesh2 = new THREE.Mesh(new THREE.BufferGeometry(), origMaterial2);

    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const ghostMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

    // 아무것도 선택하지 않음
    applyIsolateShading([mesh1, mesh2], new Set(), {
      originalMaterials,
      ghostMaterialsMap,
    });

    const mat1 = mesh1.material as THREE.MeshBasicMaterial;
    expect(mat1.transparent).toBe(true);
    expect(mat1.opacity).toBe(0.08);
    expect(mesh1.renderOrder).toBe(1);

    const mat2 = mesh2.material as THREE.MeshBasicMaterial;
    expect(mat2.transparent).toBe(true);
    expect(mat2.opacity).toBe(0.08);
    expect(mesh2.renderOrder).toBe(1);
  });

  it("applyIsolateShading 적용 시 표층(surface) 선택 메쉬는 반투명 셰이딩이 적용된다", () => {
    const origMaterial1 = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const surfaceMesh = new THREE.Mesh(new THREE.BufferGeometry(), origMaterial1);
    surfaceMesh.name = "Investing Abdominal Fascial001";

    const origMaterial2 = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const deepMesh = new THREE.Mesh(new THREE.BufferGeometry(), origMaterial2);
    deepMesh.name = "Internal Organ";

    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const ghostMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

    const transparentMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.35 });

    applyIsolateShading([surfaceMesh, deepMesh], new Set([surfaceMesh]), {
      originalMaterials,
      ghostMaterialsMap,
      isSurfaceMesh: (m) => m.name.includes("Fascial"),
      createSelectedTransparentMaterial: () => transparentMat,
    });

    expect(surfaceMesh.material).toBe(transparentMat);
    expect(surfaceMesh.renderOrder).toBe(15);
  });

  it("선택 세트가 비워져도(스프레이 취소/지우기 등) 투시모드에서는 메쉬가 불투명으로 돌아가지 않고 고스트 반투명을 유지한다", () => {
    const origMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, opacity: 1.0, transparent: false });
    const mesh = new THREE.Mesh(new THREE.BufferGeometry(), origMaterial);
    mesh.name = "Gluteus Maximus";

    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    const ghostMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();

    // 선택이 없는 상태에서 applyIsolateShading 호출 (스프레이 E버튼 클리어 후 복원 시뮬레이션)
    applyIsolateShading([mesh], new Set(), {
      originalMaterials,
      ghostMaterialsMap,
    });

    const currentMat = mesh.material as THREE.MeshStandardMaterial;
    expect(currentMat.transparent).toBe(true);
    expect(currentMat.opacity).toBeLessThan(0.2);
    expect(currentMat.opacity).toBeCloseTo(0.08);
    expect(mesh.renderOrder).toBe(1);
    expect(currentMat).not.toBe(origMaterial);
  });
});

