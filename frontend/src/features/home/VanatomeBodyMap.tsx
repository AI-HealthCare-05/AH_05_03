import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  adaptAnatomyMesh,
  lazyLayersForFocus,
  loadAnatomyAtlasManifest,
  loadAnatomyMetadata,
  type AnatomyAtlasAsset,
  type AnatomyFocus,
  type AnatomyAtlasId,
  type AnatomyAtlasManifest,
  type AnatomyLazyLayer,
} from "./anatomyAtlas";
import {
  createAdaptiveFlowGuideMaterial,
  createFocusPresets,
  createHolographicMaterials,
  INTERNALS_READABILITY_STYLE,
  createRegionalBoundaryMaterial,
  createSelectedMaterials,
  createStructuredFlowShellFillMaterials,
  materialsOf,
} from "./holographicAnatomyStyle";
import { ProceduralBodyMap } from "./ProceduralBodyMap";

type SelectedStructure = { name: string; system?: string };
type BodyFocus = AnatomyFocus;
type LazyLayerStatus = { state: "loading" | "loaded" | "error"; label: string };

const ANATOMY_SYSTEM_LAYERS = [
  { id: "integumentary", label: "외피계" },
  { id: "skeletal", label: "골격계" },
  { id: "muscular", label: "근육계" },
  { id: "cardiovascular", label: "심혈관계" },
  { id: "nervous", label: "신경계" },
  { id: "lymphatic", label: "림프계" },
  { id: "digestive", label: "소화기계" },
  { id: "respiratory", label: "호흡기계" },
  { id: "endocrine", label: "내분비계" },
  { id: "urinary", label: "비뇨기계" },
  { id: "reproductive", label: "생식계" },
  { id: "mammary", label: "유방·유선" },
] as const;

const ATLAS_OPTIONS: Array<{ id: AnatomyAtlasId; label: string }> = [
  { id: "vanatome-male-reference", label: "남성 기준 · Vanatome" },
  {
    id: "tripo-triangle2m-v49-internals-preview",
    label: "Tripo 단일 정면 · Triangle 2M 외피 + Z-Anatomy 내부 v49 · 흉곽·복부 장기 확대 v28",
  },
];

export function VanatomeBodyMap({ profileName }: { profileName: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clearSelectionRef = useRef<() => void>(() => undefined);
  const focusCameraRef = useRef<(focus: BodyFocus) => void>(() => undefined);
  const pelvicOrganFocusRef = useRef<(active: boolean) => void>(() => undefined);
  const setHiddenSystemsRef = useRef<(systems: ReadonlySet<string>) => void>(() => undefined);
  const [atlasId, setAtlasId] = useState<AnatomyAtlasId>("vanatome-male-reference");
  const [manifest, setManifest] = useState<AnatomyAtlasManifest>();
  const [selectedStructure, setSelectedStructure] = useState<SelectedStructure>();
  const [activeFocus, setActiveFocus] = useState<BodyFocus>("full");
  const [pelvicOrganFocus, setPelvicOrganFocus] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [lazyLayerStatus, setLazyLayerStatus] = useState<LazyLayerStatus>();
  const [hiddenSystems, setHiddenSystems] = useState<ReadonlySet<string>>(() => new Set());
  const [webGlUnavailable, setWebGlUnavailable] = useState(false);
  const isTestEnvironment = navigator.userAgent.includes("jsdom");

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isTestEnvironment) return;

    setLoadProgress(0);
    setLoadError(undefined);
    setSelectedStructure(undefined);
    setActiveFocus("full");
    setPelvicOrganFocus(false);
    setManifest(undefined);
    setLazyLayerStatus(undefined);
    setHiddenSystems(new Set());

    let disposed = false;
    let cleanupScene: () => void = () => undefined;

    const start = async () => {
      try {
        const nextManifest = await loadAnatomyAtlasManifest(atlasId);
        if (disposed) return;
        setManifest(nextManifest);
        const nextCleanupScene = await createAnatomyScene({
          canvas,
          manifest: nextManifest,
          isDisposed: () => disposed,
          onProgress: setLoadProgress,
          onReady: () => {
            setLoadProgress(100);
            setLoadError(undefined);
          },
          onWebGlUnavailable: () => setWebGlUnavailable(true),
          onSelectedStructure: setSelectedStructure,
          onLazyLayerStatus: setLazyLayerStatus,
          clearSelectionRef,
          focusCameraRef,
          pelvicOrganFocusRef,
          setHiddenSystemsRef,
        });
        cleanupScene = nextCleanupScene;
        if (disposed) cleanupScene();
      } catch {
        if (!disposed) setLoadError("해부학 참조 아틀라스를 불러오지 못했습니다.");
      }
    };
    void start();

    return () => {
      disposed = true;
      cleanupScene();
      clearSelectionRef.current = () => undefined;
      focusCameraRef.current = () => undefined;
      pelvicOrganFocusRef.current = () => undefined;
      setHiddenSystemsRef.current = () => undefined;
    };
  }, [atlasId, isTestEnvironment]);

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
        <fieldset className="anatomy-atlas-switch">
          <legend>참조 아틀라스</legend>
          {ATLAS_OPTIONS.map((option) => (
            <button
              key={option.id}
              type="button"
              aria-pressed={atlasId === option.id}
              onClick={() => setAtlasId(option.id)}
            >
              {option.label}
            </button>
          ))}
        </fieldset>
        {manifest ? (
          <p className={`anatomy-atlas-note${manifest.experimental ? " is-experimental" : ""}`}>
            <strong>{manifest.label}</strong>
            <span>{manifest.description}</span>
          </p>
        ) : null}
        {atlasId !== "tripo-triangle2m-v49-internals-preview" ? (
          <p className="vanatome-layer-summary">
            {(manifest?.layerLabels ?? ["반투명 외피", "골격", "주요 장기"]).map((label) => (
              <span key={label}>{label}</span>
            ))}
          </p>
        ) : null}
        <fieldset className="vanatome-system-layers">
          <legend>구조 레이어</legend>
          <div className="vanatome-system-layer-actions">
            <button
              type="button"
              disabled={loadProgress < 100}
              onClick={() => {
                const next = new Set<string>();
                setHiddenSystems(next);
                setHiddenSystemsRef.current(next);
              }}
            >
              전체 켜기
            </button>
            <button
              type="button"
              disabled={loadProgress < 100}
              onClick={() => {
                const next = new Set(ANATOMY_SYSTEM_LAYERS.map((layer) => layer.id));
                setHiddenSystems(next);
                setHiddenSystemsRef.current(next);
              }}
            >
              전체 끄기
            </button>
          </div>
          <div className="vanatome-system-layer-buttons">
            {ANATOMY_SYSTEM_LAYERS.map((layer) => {
              const active = !hiddenSystems.has(layer.id);
              return (
                <button
                  key={layer.id}
                  type="button"
                  disabled={loadProgress < 100}
                  aria-pressed={active}
                  onClick={() => {
                    const next = new Set(hiddenSystems);
                    if (active) next.add(layer.id);
                    else next.delete(layer.id);
                    setHiddenSystems(next);
                    setHiddenSystemsRef.current(next);
                  }}
                >
                  {layer.label}
                </button>
              );
            })}
          </div>
        </fieldset>
        <div className="vanatome-focus-control">
          <span>빠른 확대</span>
          <div className="vanatome-focus-buttons" aria-label="인체 부위 빠른 확대">
            {(["head", "upper", "lower", "knee", "foot", "hand"] as const).map((focus) => (
              <button
                key={focus}
                type="button"
                disabled={loadProgress < 100}
                aria-pressed={activeFocus === focus}
                onClick={() => {
                  if (pelvicOrganFocus) {
                    setPelvicOrganFocus(false);
                    pelvicOrganFocusRef.current(false);
                  }
                  setActiveFocus(focus);
                  focusCameraRef.current(focus);
                }}
              >
                {{
                  head: "머리",
                  upper: "상반신",
                  lower: "하반신",
                  knee: "무릎",
                  foot: "발",
                  hand: "손",
                }[focus]}
              </button>
            ))}
          </div>
          {activeFocus !== "full" ? (
            <button
              className="vanatome-reset-focus"
              type="button"
              onClick={() => {
                if (pelvicOrganFocus) {
                  setPelvicOrganFocus(false);
                  pelvicOrganFocusRef.current(false);
                }
                setActiveFocus("full");
                focusCameraRef.current("full");
              }}
            >
              전체 보기
            </button>
          ) : null}
          {manifest?.referenceSex === "female" ? (
            <button
              className="vanatome-pelvic-focus"
              type="button"
              disabled={loadProgress < 100}
              aria-pressed={pelvicOrganFocus}
              onClick={() => {
                const next = !pelvicOrganFocus;
                setPelvicOrganFocus(next);
                pelvicOrganFocusRef.current(next);
                if (next) {
                  setActiveFocus("lower");
                  focusCameraRef.current("lower");
                }
              }}
            >
              {pelvicOrganFocus ? "골반 장기 보기 해제" : "골반 장기 보기"}
            </button>
          ) : null}
        </div>
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
          <button type="button" disabled={!selectedStructure} onClick={() => clearSelectionRef.current()}>
            선택 해제
          </button>
        </div>
        {manifest ? (
          <p className="vanatome-attribution">
            모델: {manifest.shortLabel} ·{" "}
            <a href={manifest.attributionUrl} target="_blank" rel="noreferrer">
              {manifest.attributionLabel}
            </a>
          </p>
        ) : null}
      </div>
      <div className="body-map-viewer vanatome-viewer is-hologram">
        {loadProgress < 100 ? <BodyMapLoading progress={loadProgress} manifest={manifest} /> : null}
        {lazyLayerStatus ? (
          <span
            className={`vanatome-lazy-status is-${lazyLayerStatus.state}`}
            role="status"
          >
            {lazyLayerStatus.state === "loading"
              ? `${lazyLayerStatus.label} 불러오는 중…`
              : lazyLayerStatus.state === "loaded"
                ? `${lazyLayerStatus.label} 준비 완료`
                : `${lazyLayerStatus.label}을 불러오지 못했습니다`}
          </span>
        ) : null}
        <canvas ref={canvasRef} aria-label={`${profileName}님의 회전 가능한 해부학 3D 인체 미리보기`} />
        <span className="body-map-hint">드래그하여 회전 · 클릭하여 선택</span>
      </div>
    </section>
  );
}

type CreateAnatomySceneOptions = {
  canvas: HTMLCanvasElement;
  manifest: AnatomyAtlasManifest;
  isDisposed: () => boolean;
  onProgress: (progress: number) => void;
  onReady: () => void;
  onWebGlUnavailable: () => void;
  onSelectedStructure: (structure: SelectedStructure | undefined) => void;
  onLazyLayerStatus: (status: LazyLayerStatus | undefined) => void;
  clearSelectionRef: React.MutableRefObject<() => void>;
  focusCameraRef: React.MutableRefObject<(focus: BodyFocus) => void>;
  pelvicOrganFocusRef: React.MutableRefObject<(active: boolean) => void>;
  setHiddenSystemsRef: React.MutableRefObject<(systems: ReadonlySet<string>) => void>;
};

async function createAnatomyScene(options: CreateAnatomySceneOptions) {
  const {
    canvas, manifest, isDisposed, onProgress, onReady, onWebGlUnavailable,
    onSelectedStructure, onLazyLayerStatus, clearSelectionRef, focusCameraRef,
    pelvicOrganFocusRef, setHiddenSystemsRef,
  } = options;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    queueMicrotask(onWebGlUnavailable);
    return () => undefined;
  }

  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x06131d);
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.1, 6.8);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 0.8;
  controls.maxDistance = 11;
  controls.target.set(0, 0.15, 0);

  scene.add(new THREE.HemisphereLight(0xb9f6ff, 0x18344b, 1.8));
  const keyLight = new THREE.DirectionalLight(0xbff8ff, 2.2);
  keyLight.position.set(3, 5, 5);
  scene.add(keyLight);
  const fillLight = new THREE.DirectionalLight(0x38bdf8, 1.4);
  fillLight.position.set(-4, 1, 3);
  scene.add(fillLight);

  const anatomyMeshes: THREE.Mesh[] = [];
  const selectableMeshes: THREE.Mesh[] = [];
  const ownedMaterials = new Set<THREE.Material>();
  const sourceMaterials = new Set<THREE.Material>();
  const originalMaterials = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const progressByUrl = new Map<string, { loaded: number; total: number }>();
  let selectedMesh: THREE.Mesh | undefined;
  let focusAnimationFrame: number | undefined;
  let lazyLoadTimer: number | undefined;
  let lazyStatusClearTimer: number | undefined;
  let cleanedUp = false;
  let hiddenSystems = new Set<string>();
  const lazyLayerGroups = new Map<string, THREE.Group>();
  const lazyLayerControllers = new Map<string, AbortController>();
  const digestiveMaterialStates = new Map<THREE.Material, {
    opacity: number;
    transparent: boolean;
    depthWrite: boolean;
  }>();

  const renderScene = () => renderer.render(scene, camera);
  const applyMeshVisibility = (mesh: THREE.Mesh) => {
    const contextVisible = mesh.userData.contextVisible !== false;
    mesh.visible = contextVisible && !hiddenSystems.has(String(mesh.userData.structureSystem ?? ""));
  };
  const viewport = canvas.parentElement;
  let viewportWidth = 0;
  let viewportHeight = 0;
  const resize = () => {
    const width = Math.max(viewport?.clientWidth ?? canvas.clientWidth, 1);
    const height = Math.max(viewport?.clientHeight ?? canvas.clientHeight, 1);
    if (width === viewportWidth && height === viewportHeight) return;
    viewportWidth = width;
    viewportHeight = height;
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderScene();
  };
  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(viewport ?? canvas);
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
    onSelectedStructure(undefined);
  };

  setHiddenSystemsRef.current = (systems) => {
    hiddenSystems = new Set(systems);
    if (selectedMesh && hiddenSystems.has(String(selectedMesh.userData.structureSystem ?? ""))) {
      clearSelectedMaterial();
      onSelectedStructure(undefined);
    }
    anatomyMeshes.forEach(applyMeshVisibility);
    renderScene();
  };

  pelvicOrganFocusRef.current = (active) => {
    clearSelectedMaterial();
    onSelectedStructure(undefined);
    for (const mesh of anatomyMeshes) {
      if (mesh.userData.structureSystem === "reproductive") {
        mesh.userData.contextVisible = active;
        applyMeshVisibility(mesh);
        continue;
      }
      if (mesh.userData.structureSystem !== "digestive") continue;
      const original = originalMaterials.get(mesh) ?? mesh.material;
      for (const material of materialsOf(original)) {
        if (!digestiveMaterialStates.has(material)) {
          digestiveMaterialStates.set(material, {
            opacity: material.opacity,
            transparent: material.transparent,
            depthWrite: material.depthWrite,
          });
        }
        const baseline = digestiveMaterialStates.get(material);
        if (!baseline) continue;
        material.opacity = active ? 0.1 : baseline.opacity;
        material.transparent = active ? true : baseline.transparent;
        material.depthWrite = active ? false : baseline.depthWrite;
        material.needsUpdate = true;
      }
    }
    renderScene();
  };

  const loadTimeout = window.setTimeout(() => {
    if (!isDisposed()) onProgress(0);
  }, 30_000);

  const metadataPromise = loadAnatomyMetadata(manifest).catch(() => new Map());
  const dracoLoader = new DRACOLoader();
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  const loadAsset = (asset: AnatomyAtlasAsset) => new Promise<THREE.Group>((resolve, reject) => {
    loader.load(
      asset.url,
      (gltf) => resolve(gltf.scene),
      (event) => {
        progressByUrl.set(asset.url, { loaded: event.loaded, total: event.total });
        const progressValues = [...progressByUrl.values()];
        const loaded = progressValues.reduce((sum, value) => sum + value.loaded, 0);
        const total = progressValues.reduce((sum, value) => sum + value.total, 0);
        if (!isDisposed() && total > 0) onProgress(Math.min(99, Math.round((loaded / total) * 100)));
      },
      reject,
    );
  });

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
    mesh.material = createSelectedMaterials(mesh.material);
    selectedMesh = mesh;
    onSelectedStructure({
      name: String(mesh.userData.structureLabel ?? "선택한 해부 구조"),
      system: systemLabel(String(mesh.userData.structureSystem ?? "")),
    });
    renderScene();
  };
  canvas.addEventListener("pointerdown", handlePointerDown);
  canvas.addEventListener("pointerup", handlePointerUp);

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    window.clearTimeout(loadTimeout);
    if (lazyLoadTimer !== undefined) window.clearTimeout(lazyLoadTimer);
    if (lazyStatusClearTimer !== undefined) window.clearTimeout(lazyStatusClearTimer);
    lazyLayerControllers.forEach((controller) => controller.abort());
    lazyLayerControllers.clear();
    onLazyLayerStatus(undefined);
    canvas.removeEventListener("pointerdown", handlePointerDown);
    canvas.removeEventListener("pointerup", handlePointerUp);
    controls.removeEventListener("change", renderScene);
    if (focusAnimationFrame !== undefined) window.cancelAnimationFrame(focusAnimationFrame);
    clearSelectedMaterial();
    pelvicOrganFocusRef.current = () => undefined;
    setHiddenSystemsRef.current = () => undefined;
    controls.dispose();
    dracoLoader.dispose();
    resizeObserver.disconnect();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
      }
    });
    sourceMaterials.forEach((material) => material.dispose());
    ownedMaterials.forEach((material) => material.dispose());
    renderer.dispose();
  }

  try {
    const [metadata, loadedAssets] = await Promise.all([
      metadataPromise,
      Promise.all(manifest.assets.map(async (asset) => ({ asset, model: await loadAsset(asset) }))),
    ]);
    if (isDisposed()) return cleanup;

    const atlasGroup = new THREE.Group();
    const dimsShellForReadableInternals = manifest.id
      === "tripo-triangle2m-v49-internals-preview"
      && manifest.assets.some((asset) => (
        asset.visualRole === "skeleton" || asset.visualRole === "organ"
      ));
    for (const { asset, model } of loadedAssets) {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        materialsOf(object.material).forEach((material) => sourceMaterials.add(material));
        const adapted = adaptAnatomyMesh(object, asset, manifest, metadata);
        object.visible = Boolean(adapted);
        if (!adapted) return;

        object.userData.anatomyId = adapted.anatomyId;
        object.userData.anatomySourceKey = adapted.sourceKey;
        object.userData.structureLabel = adapted.label;
        object.userData.structureSystem = adapted.system;
        object.userData.visualRole = adapted.visualRole;
        object.userData.contextVisible = Boolean(adapted);
        anatomyMeshes.push(object);
        const isFemaleComposite = manifest.id === "tripo-triangle2m-v49-internals-preview";
        const isAdaptiveSurfaceFlowGuide = isFemaleComposite
          && asset.system === "adaptive-surface-flow-guide";
        const isRegionalBoundaryGuide = isFemaleComposite
          && asset.system === "regional-boundary-guide";
        object.material = isRegionalBoundaryGuide
          ? createRegionalBoundaryMaterial(
            ownedMaterials,
            dimsShellForReadableInternals
              ? INTERNALS_READABILITY_STYLE.regionalBoundaryOpacity
              : undefined,
          )
          : isAdaptiveSurfaceFlowGuide
          ? createAdaptiveFlowGuideMaterial(
            ownedMaterials,
            /Detail/i.test(object.name),
            dimsShellForReadableInternals
              ? (/Detail/i.test(object.name)
                ? INTERNALS_READABILITY_STYLE.detailGuideOpacity
                : INTERNALS_READABILITY_STYLE.bodyGuideOpacity)
              : undefined,
          )
          : isFemaleComposite && adapted.visualRole === "shell"
            ? createStructuredFlowShellFillMaterials(
              object.material,
              ownedMaterials,
              dimsShellForReadableInternals
                ? INTERNALS_READABILITY_STYLE.shellFillOpacity
                : undefined,
            )
          : createHolographicMaterials(
            object.material,
            adapted.visualRole,
            adapted.system,
            ownedMaterials,
            dimsShellForReadableInternals
              ? INTERNALS_READABILITY_STYLE.skeletonOpacity
              : undefined,
          );
        originalMaterials.set(object, object.material);
        if (adapted.visualRole === "shell") {
          object.renderOrder = isRegionalBoundaryGuide
            ? 7
            : isAdaptiveSurfaceFlowGuide ? 6 : 4;
          if (isRegionalBoundaryGuide || isAdaptiveSurfaceFlowGuide) {
            object.raycast = () => undefined;
          }
        }
        if (adapted.selectable) selectableMeshes.push(object);
      });
      atlasGroup.add(model);
    }

    // 자궁·난소 같은 골반 생식계 구조는 사용자가 명시적으로
    // "골반 장기 보기"를 켜기 전까지 노출하지 않는다.
    pelvicOrganFocusRef.current(false);

    const sourceBounds = new THREE.Box3().setFromObject(atlasGroup);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
    const scale = sourceSize.y > 0 ? 4.7 / sourceSize.y : 1;
    atlasGroup.scale.setScalar(scale);
    atlasGroup.position.set(-sourceCenter.x * scale, -sourceCenter.y * scale, -sourceCenter.z * scale);
    atlasGroup.updateMatrixWorld(true);
    scene.add(atlasGroup);

    let activeLazyFocus: BodyFocus = "full";
    const setLazyLayerVisible = (layerId: string, visible: boolean) => {
      const group = lazyLayerGroups.get(layerId);
      if (!group) return;
      group.traverse((object) => {
        if (object instanceof THREE.Mesh && object.userData.lazyLayerId === layerId) {
          object.userData.contextVisible = visible;
          applyMeshVisibility(object);
        }
      });
    };
    const attachLazyModel = (
      layer: AnatomyLazyLayer,
      asset: AnatomyAtlasAsset,
      model: THREE.Group,
    ) => {
      let layerGroup = lazyLayerGroups.get(layer.id);
      if (!layerGroup) {
        layerGroup = new THREE.Group();
        layerGroup.name = `lazy-layer:${layer.id}`;
        lazyLayerGroups.set(layer.id, layerGroup);
        atlasGroup.add(layerGroup);
      }
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        materialsOf(object.material).forEach((material) => sourceMaterials.add(material));
        const adapted = adaptAnatomyMesh(object, asset, manifest, metadata);
        object.visible = Boolean(adapted) && layer.triggerFocus.includes(activeLazyFocus);
        if (!adapted) return;

        object.userData.anatomyId = adapted.anatomyId;
        object.userData.anatomySourceKey = adapted.sourceKey;
        object.userData.structureLabel = adapted.label;
        object.userData.structureSystem = adapted.system;
        object.userData.visualRole = adapted.visualRole;
        object.userData.lazyLayerId = layer.id;
        object.userData.contextVisible = layer.triggerFocus.includes(activeLazyFocus);
        anatomyMeshes.push(object);
        selectableMeshes.push(object);
        object.material = createHolographicMaterials(
          object.material,
          adapted.visualRole,
          adapted.system,
          ownedMaterials,
        );
        originalMaterials.set(object, object.material);
        applyMeshVisibility(object);
      });
      layerGroup.add(model);
      atlasGroup.updateMatrixWorld(true);
    };
    const fetchLazyAsset = async (asset: AnatomyAtlasAsset, signal: AbortSignal) => {
      const response = await fetch(asset.url, { signal });
      if (!response.ok) throw new Error(`지연 자산 요청 실패: ${asset.url}`);
      const buffer = await response.arrayBuffer();
      const gltf = await loader.parseAsync(buffer, "");
      return gltf.scene;
    };
    const loadLazyLayer = async (layer: AnatomyLazyLayer) => {
      if (lazyLayerGroups.has(layer.id)) {
        setLazyLayerVisible(layer.id, layer.triggerFocus.includes(activeLazyFocus));
        return;
      }
      const controller = new AbortController();
      lazyLayerControllers.set(layer.id, controller);
      try {
        const models = await Promise.all(
          layer.assets.map((asset) => fetchLazyAsset(asset, controller.signal)),
        );
        if (controller.signal.aborted || isDisposed()) return;
        models.forEach((model, index) => attachLazyModel(layer, layer.assets[index], model));
      } finally {
        lazyLayerControllers.delete(layer.id);
      }
    };
    const scheduleLazyLayers = (focus: BodyFocus) => {
      activeLazyFocus = focus;
      if (lazyLoadTimer !== undefined) window.clearTimeout(lazyLoadTimer);
      if (lazyStatusClearTimer !== undefined) window.clearTimeout(lazyStatusClearTimer);
      onLazyLayerStatus(undefined);

      const targets = lazyLayersForFocus(manifest, focus);
      const targetIds = new Set(targets.map((layer) => layer.id));
      lazyLayerGroups.forEach((_, layerId) => setLazyLayerVisible(layerId, targetIds.has(layerId)));
      lazyLayerControllers.forEach((controller, layerId) => {
        if (!targetIds.has(layerId)) controller.abort();
      });
      if (selectedMesh?.userData.lazyLayerId && !targetIds.has(selectedMesh.userData.lazyLayerId)) {
        clearSelectedMaterial();
        onSelectedStructure(undefined);
      }
      renderScene();

      const pending = targets.filter((layer) => (
        !lazyLayerGroups.has(layer.id) && !lazyLayerControllers.has(layer.id)
      ));
      if (pending.length === 0) return;
      lazyLoadTimer = window.setTimeout(() => {
        const label = pending.map((layer) => layer.label).join(" · ");
        onLazyLayerStatus({ state: "loading", label });
        void Promise.all(pending.map(loadLazyLayer))
          .then(() => {
            if (activeLazyFocus !== focus || isDisposed()) return;
            onLazyLayerStatus({ state: "loaded", label });
            renderScene();
            lazyStatusClearTimer = window.setTimeout(() => onLazyLayerStatus(undefined), 1800);
          })
          .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
            if (activeLazyFocus !== focus || isDisposed()) return;
            onLazyLayerStatus({ state: "error", label });
            lazyStatusClearTimer = window.setTimeout(() => onLazyLayerStatus(undefined), 3000);
          });
      }, 400);
    };

    const normalizedBounds = new THREE.Box3().setFromObject(atlasGroup);
    const presets = createFocusPresets(normalizedBounds);
    camera.position.copy(presets.full.position);
    controls.target.copy(presets.full.target);
    controls.update();

    focusCameraRef.current = (focus) => {
      scheduleLazyLayers(focus);
      const preset = presets[focus];
      const startPosition = camera.position.clone();
      const startTarget = controls.target.clone();
      const startedAt = performance.now();
      if (focusAnimationFrame !== undefined) window.cancelAnimationFrame(focusAnimationFrame);

      const animateFocus = (now: number) => {
        const elapsed = Math.min(1, (now - startedAt) / 420);
        const eased = 1 - Math.pow(1 - elapsed, 3);
        camera.position.lerpVectors(startPosition, preset.position, eased);
        controls.target.lerpVectors(startTarget, preset.target, eased);
        controls.update();
        renderScene();
        if (elapsed < 1) focusAnimationFrame = window.requestAnimationFrame(animateFocus);
      };
      focusAnimationFrame = window.requestAnimationFrame(animateFocus);
    };

    window.clearTimeout(loadTimeout);
    onReady();
    renderScene();
  } catch {
    window.clearTimeout(loadTimeout);
    cleanup();
    throw new Error(`아틀라스 자산을 불러오지 못했습니다: ${manifest.id}`);
  }

  return cleanup;
}

function BodyMapLoading({
  progress,
  manifest,
}: {
  progress: number;
  manifest?: AnatomyAtlasManifest;
}) {
  return (
    <div className="vanatome-loading" role="status">
      <span>{manifest?.loadingLabel ?? "참조 아틀라스를 준비하는 중…"}</span>
      <small>{progress > 0 ? `${progress}%` : manifest?.loadingSizeLabel ?? "manifest를 확인하고 있습니다"}</small>
    </div>
  );
}

function systemLabel(system: string) {
  const labels: Record<string, string> = {
    cardiovascular: "심혈관계",
    digestive: "소화기계",
    endocrine: "내분비계",
    integumentary: "외피계",
    lymphatic: "림프계",
    reproductive: "생식계",
    mammary: "유방·유선",
    muscular: "근육계",
    nervous: "신경계",
    respiratory: "호흡기계",
    skeletal: "골격계",
    urinary: "비뇨기계",
    "regional-anatomy": "외부 해부 구조",
  };
  return labels[system] ?? system;
}
