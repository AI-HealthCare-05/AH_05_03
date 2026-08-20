import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import { ProceduralBodyMap } from "./ProceduralBodyMap";

type ViewMode = "surface" | "internal";
type AnatomyMetadata = { id: string; name: string; system: string };
type MetadataBundle = { structures: AnatomyMetadata[] };
type SelectedStructure = { name: string; system?: string };

const MODEL_URLS: Record<ViewMode, string> = {
  surface: "/vendor/vanatome/models/z-anatomy-1.4.0-regional-anatomy.glb",
  internal: "/vendor/vanatome/models/z-anatomy-1.4.0-full-body.glb",
};
const FULL_BODY_METADATA_URL = "/vendor/vanatome/releases/1.4.0/full-body.metadata.json";
const ATTRIBUTION_URL = "/vendor/vanatome/ATTRIBUTION.txt";
const SELECTED_COLOR = new THREE.Color(0x38bdf8);
const INTERNAL_SYSTEMS = new Set([
  "cardiovascular", "digestive", "endocrine", "respiratory", "skeletal", "urinary",
]);

export function VanatomeBodyMap({ profileName }: { profileName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clearSelectionRef = useRef<() => void>(() => undefined);
  const [viewMode, setViewMode] = useState<ViewMode>("surface");
  const [selectedStructure, setSelectedStructure] = useState<SelectedStructure>();
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [webGlUnavailable, setWebGlUnavailable] = useState(false);
  const isTestEnvironment = navigator.userAgent.includes("jsdom");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isTestEnvironment) return;

    setLoadProgress(0);
    setLoadError(undefined);
    setSelectedStructure(undefined);

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    } catch {
      queueMicrotask(() => setWebGlUnavailable(true));
      return;
    }

    let disposed = false;
    const isInternal = viewMode === "internal";
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(isInternal ? 0x06131d : 0xf1f6ff);
    const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
    camera.position.set(0, 0.1, isInternal ? 6.8 : 6.4);

    const controls = new OrbitControls(camera, canvas);
    controls.enableDamping = false;
    controls.enablePan = false;
    controls.minDistance = 3.2;
    controls.maxDistance = 11;
    controls.target.set(0, 0.15, 0);

    scene.add(new THREE.HemisphereLight(isInternal ? 0xb9f6ff : 0xffffff, 0x18344b, isInternal ? 1.8 : 2.3));
    const keyLight = new THREE.DirectionalLight(isInternal ? 0xbff8ff : 0xffffff, isInternal ? 2.2 : 2.8);
    keyLight.position.set(3, 5, 5);
    scene.add(keyLight);
    const fillLight = new THREE.DirectionalLight(isInternal ? 0x38bdf8 : 0xb7d2ff, 1.4);
    fillLight.position.set(-4, 1, 3);
    scene.add(fillLight);

    const selectableMeshes: THREE.Mesh[] = [];
    const ownedMaterials = new Set<THREE.Material>();
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
      materialsOf(selectedMesh.material).forEach((material) => {
        if (!ownedMaterials.has(material)) material.dispose();
      });
      const original = originalMaterials.get(selectedMesh);
      if (original) selectedMesh.material = original;
      selectedMesh = undefined;
      renderScene();
    };
    clearSelectionRef.current = () => {
      clearSelectedMaterial();
      setSelectedStructure(undefined);
    };

    const metadataPromise = isInternal
      ? fetch(FULL_BODY_METADATA_URL)
          .then((response) => response.ok ? response.json() as Promise<MetadataBundle> : Promise.reject())
          .then((metadata) => new Map(metadata.structures.map((structure) => [structure.id, structure])))
          .catch(() => new Map<string, AnatomyMetadata>())
      : Promise.resolve(new Map<string, AnatomyMetadata>());
    const loadTimeout = window.setTimeout(() => {
      if (!disposed) setLoadError("해부학 인체 모델 로딩 시간이 초과되었습니다.");
    }, isInternal ? 60_000 : 20_000);

    new GLTFLoader().load(
      MODEL_URLS[viewMode],
      async (gltf) => {
        if (disposed) return;
        window.clearTimeout(loadTimeout);
        const metadata = await metadataPromise;
        if (disposed) return;
        const model = gltf.scene;
        model.traverse((object) => {
          if (!(object instanceof THREE.Mesh)) return;
          const anatomyId = String(object.userData.anatomyId ?? "");
          const anatomySystem = String(object.userData.anatomySystem ?? "regional-anatomy");
          const bodyShell = anatomyId === "body-shell";
          if (isInternal) {
            object.visible = bodyShell || INTERNAL_SYSTEMS.has(anatomySystem);
            if (!object.visible) return;
          }

          const styledMaterials = materialsOf(object.material).map((material) => {
            const styled = material.clone();
            ownedMaterials.add(styled);
            if (!(styled instanceof THREE.MeshStandardMaterial)) return styled;
            styled.metalness = 0;
            styled.roughness = isInternal ? 0.48 : 0.68;
            if (isInternal && bodyShell) {
              styled.color.setHex(0x4de4ff);
              styled.emissive.setHex(0x0b7895);
              styled.emissiveIntensity = 0.75;
              styled.transparent = true;
              styled.opacity = 0.17;
              styled.depthWrite = false;
              styled.wireframe = true;
              object.renderOrder = 4;
            } else if (isInternal && anatomySystem === "skeletal") {
              styled.color.lerp(new THREE.Color(0xd9f7ff), 0.72);
              styled.emissive.setHex(0x17475a);
              styled.emissiveIntensity = 0.18;
              styled.transparent = true;
              styled.opacity = 0.72;
            } else if (isInternal) {
              styled.emissive.copy(styled.color).multiplyScalar(0.12);
              styled.emissiveIntensity = 0.25;
              styled.transparent = false;
              styled.opacity = 1;
            } else {
              styled.transparent = false;
              styled.opacity = 1;
            }
            return styled;
          });
          object.material = Array.isArray(object.material) ? styledMaterials : styledMaterials[0];
          originalMaterials.set(object, object.material);
          const structure = metadata.get(anatomyId);
          object.userData.structureLabel = structure?.name ?? structureLabel(object.name);
          object.userData.structureSystem = structure?.system ?? anatomySystem;
          if (!bodyShell) selectableMeshes.push(object);
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
          clone.emissive.setHex(0x0e7490);
          clone.emissiveIntensity = 0.85;
          clone.opacity = 1;
          clone.transparent = false;
        }
        return clone;
      });
      mesh.material = Array.isArray(mesh.material) ? highlighted : highlighted[0];
      selectedMesh = mesh;
      setSelectedStructure({
        name: String(mesh.userData.structureLabel ?? "선택한 해부 구조"),
        system: systemLabel(String(mesh.userData.structureSystem ?? "")),
      });
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
        if (object instanceof THREE.Mesh) object.geometry.dispose();
      });
      ownedMaterials.forEach((material) => material.dispose());
      renderer.dispose();
      clearSelectionRef.current = () => undefined;
    };
  }, [isTestEnvironment, viewMode]);

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

  const isInternal = viewMode === "internal";
  return (
    <section className="body-map-card vanatome-card" aria-labelledby="body-map-title">
      <div className="body-map-copy">
        <p className="section-kicker">해부 구조 미리보기</p>
        <h3 id="body-map-title">{profileName}님의 3D 인체</h3>
        <p>인체를 돌려보거나 구조를 선택해 보세요. 건강기록과 자동으로 연결되지는 않습니다.</p>
        <div className="vanatome-mode-switch" aria-label="인체 보기 방식">
          <button type="button" aria-pressed={!isInternal} onClick={() => setViewMode("surface")}>외형 보기</button>
          <button type="button" aria-pressed={isInternal} onClick={() => setViewMode("internal")}>내부 구조 보기</button>
        </div>
        {isInternal ? (
          <p className="vanatome-layer-summary"><span>반투명 외피</span><span>골격</span><span>주요 장기</span></p>
        ) : null}
        <div className="body-map-selection" aria-live="polite">
          <span>선택한 구조</span>
          <strong>{selectedStructure?.name ?? "인체에서 구조를 선택하세요"}</strong>
          <small>
            {selectedStructure
              ? `${selectedStructure.system ? `${selectedStructure.system} · ` : ""}현재 선택은 저장되지 않습니다.`
              : "드래그는 회전, 클릭은 구조 선택입니다."}
          </small>
        </div>
        <div className="vanatome-actions">
          <button type="button" disabled={!selectedStructure} onClick={() => clearSelectionRef.current()}>선택 해제</button>
        </div>
        <p className="vanatome-attribution">
          모델: Z-Anatomy 기반 Vanatome ·{" "}
          <a href={ATTRIBUTION_URL} target="_blank" rel="noreferrer">CC BY-SA 4.0 출처</a>
        </p>
      </div>
      <div className={`body-map-viewer vanatome-viewer${isInternal ? " is-hologram" : ""}`}>
        {loadProgress < 100 ? <BodyMapLoading progress={loadProgress} mode={viewMode} /> : null}
        <canvas ref={canvasRef} aria-label={`${profileName}님의 회전 가능한 해부학 3D 인체 미리보기`} />
        <span className="body-map-hint">드래그하여 회전 · 클릭하여 선택</span>
      </div>
    </section>
  );
}

function BodyMapLoading({ progress, mode }: { progress: number; mode: ViewMode }) {
  return (
    <div className="vanatome-loading" role="status">
      <span>{mode === "internal" ? "외피·골격·주요 장기를 구성하는 중…" : "해부학 인체 모델을 준비하는 중…"}</span>
      <small>{progress > 0 ? `${progress}%` : `${mode === "internal" ? "약 30 MB" : "약 6 MB"} · 이 서버에서 직접 불러옵니다`}</small>
    </div>
  );
}

function materialsOf(material: THREE.Material | THREE.Material[]) {
  return Array.isArray(material) ? material : [material];
}

function structureLabel(meshName: string) {
  return meshName
    .replace(/^body-shell__/, "")
    .replace(/([lr])$/, (_, side: string) => side === "l" ? " (왼쪽)" : " (오른쪽)")
    .replaceAll("_", " ");
}

function systemLabel(system: string) {
  const labels: Record<string, string> = {
    cardiovascular: "심혈관계", digestive: "소화기계", endocrine: "내분비계",
    respiratory: "호흡기계", skeletal: "골격계", urinary: "비뇨기계",
    "regional-anatomy": "외부 해부 구조",
  };
  return labels[system];
}
