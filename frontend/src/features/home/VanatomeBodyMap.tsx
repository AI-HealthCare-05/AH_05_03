import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { ProceduralBodyMap } from "./ProceduralBodyMap";

const MODEL_URL = "/vendor/vanatome/models/z-anatomy-1.4.0-regional-anatomy.glb";
const ATTRIBUTION_URL = "/vendor/vanatome/ATTRIBUTION.txt";
const SELECTED_COLOR = new THREE.Color(0x2563eb);

export function VanatomeBodyMap({ profileName }: { profileName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clearSelectionRef = useRef<() => void>(() => undefined);
  const [selectedStructure, setSelectedStructure] = useState<string>();
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [webGlUnavailable, setWebGlUnavailable] = useState(false);
  const isTestEnvironment = navigator.userAgent.includes("jsdom");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isTestEnvironment) return;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      queueMicrotask(() => setWebGlUnavailable(true));
      return;
    }

    let disposed = false;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xf1f6ff);

    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, 6.4);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 11;
    controls.target.set(0, 0.15, 0);

    scene.add(new THREE.HemisphereLight(0xffffff, 0xaebed8, 2.3));
    const keyLight = new THREE.DirectionalLight(0xffffff, 2.8);
    keyLight.position.set(3, 5, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(0xb7d2ff, 1.4);
    fillLight.position.set(-4, 1, 3);
    scene.add(fillLight);

    const selectableMeshes: THREE.Mesh[] = [];
    const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
    let selectedMesh: THREE.Mesh | undefined;

    const renderScene = () => renderer.render(scene, camera);
    const resize = () => {
      const width = Math.max(canvas.clientWidth, 1);
      const height = Math.max(canvas.clientHeight, 1);
      renderer.setSize(width, height, false);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderScene();
    };

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);
    controls.addEventListener("change", renderScene);
    resize();

    const clearSelectedMaterial = () => {
      if (!selectedMesh) return;
      disposeMaterials(selectedMesh.material);
      const original = originalMaterials.get(selectedMesh);
      if (original) selectedMesh.material = original;
      selectedMesh = undefined;
      renderScene();
    };
    clearSelectionRef.current = () => {
      clearSelectedMaterial();
      setSelectedStructure(undefined);
    };

    const loadTimeout = window.setTimeout(() => {
      if (!disposed) setLoadError("해부학 인체 모델 로딩 시간이 초과되었습니다.");
    }, 20_000);

    new GLTFLoader().load(
      MODEL_URL,
      (gltf) => {
        if (disposed) return;
        window.clearTimeout(loadTimeout);
        const model = gltf.scene;
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          materialsOf(object.material).forEach((material) => {
            if (material instanceof THREE.MeshStandardMaterial) {
              material.transparent = false;
              material.opacity = 1;
              material.roughness = 0.68;
              material.metalness = 0;
            }
          });
          originalMaterials.set(object, object.material);
          object.userData.structureLabel = structureLabel(object.name);
          selectableMeshes.push(object);
        });

        const bounds = new THREE.Box3().setFromObject(model);
        const size = bounds.getSize(new THREE.Vector3());
        const center = bounds.getCenter(new THREE.Vector3());
        const scale = size.y > 0 ? 4.7 / size.y : 1;
        model.scale.setScalar(scale);
        model.position.set(-center.x * scale, -center.y * scale, -center.z * scale);
        model.updateMatrixWorld(true);
        scene.add(model);
        setLoadProgress(100);
        setLoadError(undefined);
        renderScene();
      },
      (event) => {
        if (disposed || !event.total) return;
        setLoadProgress(Math.min(99, Math.round((event.loaded / event.total) * 100)));
      },
      () => {
        window.clearTimeout(loadTimeout);
        if (!disposed) setLoadError("해부학 인체 모델을 불러오지 못했습니다.");
      },
    );

    const raycaster = new THREE.Raycaster();
    const pointer = new THREE.Vector2();
    let pointerStart: { x: number; y: number } | undefined;

    const handlePointerDown = (event: PointerEvent) => {
      pointerStart = { x: event.clientX, y: event.clientY };
    };
    const handlePointerUp = (event: PointerEvent) => {
      if (!pointerStart || Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) > 6) {
        pointerStart = undefined;
        return;
      }
      pointerStart = undefined;
      const bounds = canvas.getBoundingClientRect();
      pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
      pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
      raycaster.setFromCamera(pointer, camera);
      const hit = raycaster.intersectObjects(selectableMeshes, false)[0];
      if (!(hit?.object instanceof THREE.Mesh)) return;

      clearSelectedMaterial();
      const mesh = hit.object;
      const highlighted = materialsOf(mesh.material).map((material) => {
        const clone = material.clone();
        if (clone instanceof THREE.MeshStandardMaterial) {
          clone.color.copy(SELECTED_COLOR);
          clone.emissive.setHex(0x123d91);
          clone.emissiveIntensity = 0.42;
        }
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? highlighted : highlighted[0];
      selectedMesh = mesh;
      setSelectedStructure(String(mesh.userData.structureLabel ?? "선택한 해부 구조"));
      renderScene();
    };

    canvas.addEventListener("pointerdown", handlePointerDown);
    canvas.addEventListener("pointerup", handlePointerUp);

    return () => {
      disposed = true;
      window.clearTimeout(loadTimeout);
      canvas.removeEventListener("pointerdown", handlePointerDown);
      canvas.removeEventListener("pointerup", handlePointerUp);
      controls.removeEventListener("change", renderScene);
      controls.dispose();
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        object.geometry.dispose();
      });
      if (selectedMesh) disposeMaterials(selectedMesh.material);
      originalMaterials.forEach(disposeMaterials);
      renderer.dispose();
      clearSelectionRef.current = () => undefined;
    };
  }, [isTestEnvironment]);

  if (isTestEnvironment || loadError || webGlUnavailable) {
    return (
      <div>
        {loadError || webGlUnavailable ? (
          <p className="body-map-load-notice" role="status">
            {loadError ?? "이 브라우저에서는 3D를 표시할 수 없습니다."} 기본 인체 미리보기를 표시합니다.
          </p>
        ) : null}
        <ProceduralBodyMap profileName={profileName} />
      </div>
    );
  }

  return (
    <section className="body-map-card vanatome-card" aria-labelledby="body-map-title">
      <div className="body-map-copy">
        <p className="section-kicker">해부 구조 미리보기</p>
        <h3 id="body-map-title">{profileName}님의 3D 인체</h3>
        <p>인체를 돌려보거나 구조를 선택해 보세요. 건강기록과 자동으로 연결되지는 않습니다.</p>
        <div className="body-map-selection" aria-live="polite">
          <span>선택한 구조</span>
          <strong>{selectedStructure ?? "인체에서 구조를 선택하세요"}</strong>
          <small>{selectedStructure ? "현재 선택은 미리보기 상태이며 저장되지 않습니다." : "드래그는 회전, 클릭은 구조 선택입니다."}</small>
        </div>
        <div className="vanatome-actions">
          <button type="button" disabled={!selectedStructure} onClick={() => clearSelectionRef.current()}>선택 해제</button>
        </div>
        <p className="vanatome-attribution">
          모델: Z-Anatomy 기반 Vanatome ·{" "}
          <a href={ATTRIBUTION_URL} target="_blank" rel="noreferrer">CC BY-SA 4.0 출처</a>
        </p>
      </div>
      <div className="body-map-viewer vanatome-viewer">
        {loadProgress < 100 ? <BodyMapLoading progress={loadProgress} /> : null}
        <canvas ref={canvasRef} aria-label={`${profileName}님의 회전 가능한 해부학 3D 인체 미리보기`} />
        <span className="body-map-hint">드래그하여 회전 · 클릭하여 선택</span>
      </div>
    </section>
  );
}

function BodyMapLoading({ progress }: { progress: number }) {
  return (
    <div className="vanatome-loading" role="status">
      <span>해부학 인체 모델을 준비하는 중…</span>
      <small>{progress > 0 ? `${progress}%` : "약 6 MB · 이 서버에서 직접 불러옵니다"}</small>
    </div>
  );
}

function materialsOf(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

function disposeMaterials(material: THREE.Material | THREE.Material[]) {
  materialsOf(material).forEach((item) => item.dispose());
}

function structureLabel(meshName: string) {
  return meshName
    .replace(/^body-shell__/, "")
    .replace(/([lr])$/, (_, side: string) => side === "l" ? " (왼쪽)" : " (오른쪽)")
    .replaceAll("_", " ");
}
