import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";

import {
  adaptAnatomyMesh,
  anatomyLayerSystem,
  inheritAnatomyMetadata,
  initiallyHiddenSystems,
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
  applyCostalCartilageStyle,
  createAdaptiveFlowGuideMaterial,
  createFocusPresets,
  createHolographicMaterials,
  createMatteScalpMaterials,
  INTERNALS_READABILITY_STYLE,
  createRegionalBoundaryMaterial,
  createSelectedMaterials,
  materialsOf,
  shouldReturnToFullBody,
} from "./holographicAnatomyStyle";
import { ProceduralBodyMap } from "./ProceduralBodyMap";
import { fetchCachedAnatomyResource } from "./anatomyResourceCache";
import type { RegionRisk } from "./bodyRisk";

type SelectedStructure = { name: string; system?: string };
type BodyFocus = AnatomyFocus | "leftHand" | "rightHand";
type HandPose = "Open Hand" | "Fist" | "Spread" | "Point";

const CORE_ASSET_TIMEOUT_MS = 45_000;
const LAZY_ASSET_TIMEOUT_MS = 45_000;

const HAND_POSES: Array<{ id: HandPose; label: string }> = [
  { id: "Open Hand", label: "손 펴기" },
  { id: "Fist", label: "주먹" },
  { id: "Spread", label: "손가락 벌리기" },
  { id: "Point", label: "가리키기" },
];

const ANATOMY_SYSTEM_LAYERS = [
  { id: "integumentary", label: "외피계" },
  { id: "skeletal", label: "골격계" },
  { id: "joints", label: "관절·인대·막" },
  { id: "muscular", label: "근육계" },
  { id: "cardiovascular", label: "심혈관계" },
  { id: "nervous", label: "신경계" },
  { id: "lymphatic", label: "림프계" },
  { id: "digestive", label: "소화기계" },
  { id: "respiratory", label: "호흡기계" },
  { id: "endocrine", label: "내분비계" },
  { id: "urinary", label: "비뇨기계" },
  { id: "reproductive", label: "생식계" },
] as const;

const SUPPORTED_SYSTEMS_BY_ATLAS: Record<AnatomyAtlasId, ReadonlySet<string>> = {
  "vanatome-male-reference": new Set(ANATOMY_SYSTEM_LAYERS.map((layer) => layer.id)),
  "female-skeleton-controller-test": new Set(["skeletal"]),
  "tripo-triangle2m-v49-internals-preview": new Set([
    "integumentary", "skeletal", "joints", "muscular", "cardiovascular",
    "nervous", "lymphatic", "digestive", "respiratory", "endocrine",
    "urinary", "reproductive",
  ]),
};

const ATLAS_OPTIONS: Array<{ id: AnatomyAtlasId; label: string }> = [
  { id: "vanatome-male-reference", label: "남성" },
  { id: "tripo-triangle2m-v49-internals-preview", label: "여성" },
];

const DEFAULT_ANATOMY_ATLAS: AnatomyAtlasId = "vanatome-male-reference";

export function VanatomeBodyMap({
  profileName,
  gender,
}: {
  profileName: string;
  gender?: "male" | "female" | null;
  risks?: RegionRisk[];
  risksAt?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const clearSelectionRef = useRef<() => void>(() => undefined);
  const focusCameraRef = useRef<(focus: BodyFocus) => void>(() => undefined);
  const pelvicOrganFocusRef = useRef<(active: boolean) => void>(() => undefined);
  const setHiddenSystemsRef = useRef<(systems: ReadonlySet<string>) => void>(() => undefined);
  const playHandPoseRef = useRef<(pose: HandPose) => void>(() => undefined);
  const [atlasId, setAtlasId] = useState<AnatomyAtlasId>(() =>
    gender === "female" ? "tripo-triangle2m-v49-internals-preview" : DEFAULT_ANATOMY_ATLAS,
  );

  useEffect(() => {
    if (gender === "female") {
      setAtlasId("tripo-triangle2m-v49-internals-preview");
    } else if (gender === "male") {
      setAtlasId("vanatome-male-reference");
    }
  }, [gender]);
  const [manifest, setManifest] = useState<AnatomyAtlasManifest>();
  const [selectedStructure, setSelectedStructure] = useState<SelectedStructure>();
  const [activeFocus, setActiveFocus] = useState<BodyFocus>("full");
  const [pelvicOrganFocus, setPelvicOrganFocus] = useState(false);
  const [loadProgress, setLoadProgress] = useState(0);
  const [loadError, setLoadError] = useState<string>();
  const [hiddenSystems, setHiddenSystems] = useState<ReadonlySet<string>>(() => new Set());
  const [readySystems, setReadySystems] = useState<ReadonlySet<string>>(() => new Set());
  const [activeHandPose, setActiveHandPose] = useState<HandPose>("Open Hand");
  const [webGlUnavailable, setWebGlUnavailable] = useState(false);
  const [sceneAttempt, setSceneAttempt] = useState(0);
  const isTestEnvironment = navigator.userAgent.includes("jsdom");
  const systemLayers = ANATOMY_SYSTEM_LAYERS.filter(
    (layer) => SUPPORTED_SYSTEMS_BY_ATLAS[atlasId].has(layer.id),
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || isTestEnvironment) return;

    setLoadProgress(0);
    setLoadError(undefined);
    setSelectedStructure(undefined);
    setActiveFocus("full");
    setPelvicOrganFocus(false);
    setManifest(undefined);
    setReadySystems(new Set());
    const initialHiddenSystems = initiallyHiddenSystems(
      atlasId,
      ANATOMY_SYSTEM_LAYERS.map((layer) => layer.id),
    );
    setHiddenSystems(initialHiddenSystems);
    setActiveHandPose("Open Hand");

    let disposed = false;
    const sceneController = new AbortController();
    let cleanupScene: () => void = () => undefined;

    const start = async () => {
      try {
        const nextManifest = await loadAnatomyAtlasManifest(atlasId);
        if (disposed) return;
        setManifest(nextManifest);
        const nextCleanupScene = await createAnatomyScene({
          canvas,
          manifest: nextManifest,
          signal: sceneController.signal,
          isDisposed: () => disposed,
          onProgress: setLoadProgress,
          onReady: () => {
            setLoadProgress(100);
            setLoadError(undefined);
          },
          onWebGlUnavailable: () => setWebGlUnavailable(true),
          onSelectedStructure: setSelectedStructure,
          onFocusChange: setActiveFocus,
          onSystemsReady: setReadySystems,
          initialHiddenSystems,
          clearSelectionRef,
          focusCameraRef,
          pelvicOrganFocusRef,
          setHiddenSystemsRef,
          playHandPoseRef,
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
      sceneController.abort();
      cleanupScene();
      clearSelectionRef.current = () => undefined;
      focusCameraRef.current = () => undefined;
      pelvicOrganFocusRef.current = () => undefined;
      setHiddenSystemsRef.current = () => undefined;
      playHandPoseRef.current = () => undefined;
    };
  }, [atlasId, isTestEnvironment, sceneAttempt]);

  if (isTestEnvironment || loadError || webGlUnavailable) {
    return (
      <div>
        {loadError || webGlUnavailable ? (
          <div className="body-map-load-notice" role="status">
            <p>{loadError ?? "WebGL 연결이 끊어졌습니다."} 기본 인체 미리보기를 표시합니다.</p>
            <button
              className="secondary-button"
              type="button"
              onClick={() => {
                setLoadError(undefined);
                setWebGlUnavailable(false);
                setSceneAttempt((attempt) => attempt + 1);
              }}
            >
              3D 다시 시도
            </button>
          </div>
        ) : null}
        <ProceduralBodyMap profileName={profileName} />
      </div>
    );
  }

  return (
    <section className="body-map-card vanatome-card" aria-label="인체 모니터">
      <div className="body-map-copy">
        <p className="section-kicker">인체 모니터</p>
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
                const next = new Set(systemLayers.map((layer) => layer.id));
                setHiddenSystems(next);
                setHiddenSystemsRef.current(next);
              }}
            >
              전체 끄기
            </button>
          </div>
          <div className="vanatome-system-layer-buttons">
            {systemLayers.map((layer) => {
              const active = !hiddenSystems.has(layer.id);
              return (
                <button
                  key={layer.id}
                  type="button"
                  disabled={loadProgress < 100 || !readySystems.has(layer.id)}
                  aria-pressed={active}
                  onClick={() => {
                    setHiddenSystems((current) => {
                      const next = new Set(current);
                      if (next.has(layer.id)) next.delete(layer.id);
                      else next.add(layer.id);
                      setHiddenSystemsRef.current(next);
                      return next;
                    });
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
            {(["full", "head", "upper", "lower", "leftHand", "rightHand", "knee", "foot"] as const).map((focus) => (
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
                  full: "전체",
                  head: "머리",
                  upper: "상반신",
                  lower: "하반신",
                  knee: "무릎",
                  foot: "발",
                  leftHand: "왼손",
                  rightHand: "오른손",
                }[focus]}
              </button>
            ))}
          </div>
          {manifest?.referenceSex === "female"
          && manifest.assets.some((asset) => asset.visualRole === "organ") ? (
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
        {manifest?.assets.some((asset) => asset.animationClips?.length) ? (
          <fieldset className="vanatome-hand-poses">
            <legend>손 포즈</legend>
            <div>
              {HAND_POSES.filter((pose) => (
                manifest.assets.some((asset) => asset.animationClips?.includes(pose.id))
              )).map((pose) => (
                <button
                  key={pose.id}
                  type="button"
                  disabled={loadProgress < 100}
                  aria-pressed={activeHandPose === pose.id}
                  onClick={() => {
                    setActiveHandPose(pose.id);
                    playHandPoseRef.current(pose.id);
                  }}
                >
                  {pose.label}
                </button>
              ))}
            </div>
            <small>양손에 함께 적용됩니다.</small>
          </fieldset>
        ) : null}
        <div className="body-map-selection" aria-live="polite">
          <span>선택한 구조</span>
          <strong>{selectedStructure?.name ?? "인체에서 구조를 선택하세요"}</strong>
          <small>
            {selectedStructure
              ? `${selectedStructure.system ? `${selectedStructure.system} · ` : ""}현재 선택은 저장되지 않습니다.`
              : "모델 드래그는 회전, 검은 배경 드래그는 상하 카메라 이동, 클릭은 구조 선택입니다."}
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
        <canvas ref={canvasRef} aria-label="회전 가능한 해부학 인체 모니터" />
        <span className="body-map-hint">모델 드래그 회전 · 배경 드래그 상하 이동 · 클릭 선택</span>
      </div>
    </section>
  );
}

type CreateAnatomySceneOptions = {
  canvas: HTMLCanvasElement;
  manifest: AnatomyAtlasManifest;
  signal: AbortSignal;
  isDisposed: () => boolean;
  onProgress: (progress: number) => void;
  onReady: () => void;
  onWebGlUnavailable: () => void;
  onSelectedStructure: (structure: SelectedStructure | undefined) => void;
  onFocusChange: (focus: BodyFocus) => void;
  onSystemsReady: (systems: ReadonlySet<string>) => void;
  initialHiddenSystems: ReadonlySet<string>;
  clearSelectionRef: React.MutableRefObject<() => void>;
  focusCameraRef: React.MutableRefObject<(focus: BodyFocus) => void>;
  pelvicOrganFocusRef: React.MutableRefObject<(active: boolean) => void>;
  setHiddenSystemsRef: React.MutableRefObject<(systems: ReadonlySet<string>) => void>;
  playHandPoseRef: React.MutableRefObject<(pose: HandPose) => void>;
};

async function createAnatomyScene(options: CreateAnatomySceneOptions) {
  const {
    canvas, manifest, signal, isDisposed, onProgress, onReady, onWebGlUnavailable,
    onSelectedStructure, onFocusChange, onSystemsReady, initialHiddenSystems,
    clearSelectionRef, focusCameraRef,
    pelvicOrganFocusRef, setHiddenSystemsRef,
    playHandPoseRef,
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
  let poseAnimationFrame: number | undefined;
  let poseAnimationLastTime = 0;
  let poseAnimationEndTime = 0;
  let lazyLoadTimer: number | undefined;
  let autoFullReturnAnimating = false;
  let cleanedUp = false;
  let hiddenSystems = new Set(initialHiddenSystems);
  const readySystems = new Set<string>();
  let activeBodyFocus: BodyFocus = "full";
  let handleControlsStart: (() => void) | undefined;
  let handleControlsEnd: (() => void) | undefined;
  const lazyLayerGroups = new Map<string, THREE.Group>();
  const lazyLayerControllers = new Map<string, AbortController>();
  const digestiveMaterialStates = new Map<THREE.Material, {
    opacity: number;
    transparent: boolean;
    depthWrite: boolean;
  }>();
  const animationMixers: THREE.AnimationMixer[] = [];
  const handPoseActions = new Map<HandPose, THREE.AnimationAction>();
  let activeHandPoseAction: THREE.AnimationAction | undefined;

  const handleContextLost = (event: Event) => {
    event.preventDefault();
    if (!cleanedUp) queueMicrotask(onWebGlUnavailable);
  };
  canvas.addEventListener("webglcontextlost", handleContextLost);

  const setCostalCartilageFocus = (upperBodyFocused: boolean) => {
    for (const mesh of anatomyMeshes) {
      if (mesh.userData.tissueType !== "costal-cartilage") continue;
      applyCostalCartilageStyle(
        originalMaterials.get(mesh) ?? mesh.material,
        upperBodyFocused,
      );
    }
  };

  const renderScene = () => renderer.render(scene, camera);
  const updatePoseAnimation = (now: number) => {
    const deltaSeconds = Math.min((now - poseAnimationLastTime) / 1000, 0.05);
    poseAnimationLastTime = now;
    animationMixers.forEach((mixer) => mixer.update(deltaSeconds));
    renderScene();
    if (now < poseAnimationEndTime) {
      poseAnimationFrame = window.requestAnimationFrame(updatePoseAnimation);
    } else {
      poseAnimationFrame = undefined;
    }
  };
  const startPoseAnimationLoop = () => {
    if (poseAnimationFrame !== undefined) window.cancelAnimationFrame(poseAnimationFrame);
    poseAnimationLastTime = performance.now();
    poseAnimationEndTime = poseAnimationLastTime + 700;
    poseAnimationFrame = window.requestAnimationFrame(updatePoseAnimation);
  };
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
    setCostalCartilageFocus(
      activeBodyFocus === "upper" && !hiddenSystems.has("muscular"),
    );
    renderScene();
  };

  pelvicOrganFocusRef.current = (active) => {
    clearSelectedMaterial();
    onSelectedStructure(undefined);
    for (const mesh of anatomyMeshes) {
      if (mesh.userData.structureSystem === "reproductive") {
        // The full-body atlas starts with every anatomy layer visible.
        // Pelvic focus only changes nearby-organ readability; it must not
        // hide the reproductive layer again when the focus is released.
        mesh.userData.contextVisible = true;
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

  const metadataPromise = loadAnatomyMetadata(manifest).catch(() => new Map());
  const dracoLoader = new DRACOLoader();
  dracoLoader.setDecoderPath("/vendor/three/draco/gltf/");
  const loader = new GLTFLoader();
  loader.setDRACOLoader(dracoLoader);
  const loadAsset = async (asset: AnatomyAtlasAsset) => {
    const controller = new AbortController();
    let timedOut = false;
    const abort = () => controller.abort();
    signal.addEventListener("abort", abort, { once: true });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, CORE_ASSET_TIMEOUT_MS);
    try {
      const response = await fetchCachedAnatomyResource(asset.url, {
        signal: controller.signal,
        revision: asset.sha256,
      });
      if (!response.ok) throw new Error(`핵심 해부 자산 요청 실패: ${asset.url}`);
      const buffer = await response.arrayBuffer();
      const total = Number(response.headers.get("content-length")) || buffer.byteLength;
      progressByUrl.set(asset.url, { loaded: buffer.byteLength, total });
      const progressValues = [...progressByUrl.values()];
      const loadedBytes = progressValues.reduce((sum, value) => sum + value.loaded, 0);
      const totalBytes = progressValues.reduce((sum, value) => sum + value.total, 0);
      if (!isDisposed() && totalBytes > 0) {
        onProgress(Math.min(99, Math.round((loadedBytes / totalBytes) * 100)));
      }
      if (signal.aborted || isDisposed()) throw new DOMException("Aborted", "AbortError");
      const gltf = await loader.parseAsync(buffer, "");
      return { model: gltf.scene, animations: gltf.animations };
    } catch (error) {
      if (timedOut) {
        throw new Error(`핵심 해부 자산 요청 시간 초과: ${asset.url}`, { cause: error });
      }
      throw error;
    } finally {
      window.clearTimeout(timeout);
      signal.removeEventListener("abort", abort);
    }
  };

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  let pointerGesture: {
    pointerId: number;
    mode: "rotate" | "vertical-pan";
    startX: number;
    startY: number;
    lastY: number;
  } | undefined;
  let verticalPanLimits = { min: -2.35, max: 2.35 };

  const setPointerFromEvent = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  };
  const pointerHitsVisibleModel = (event: PointerEvent) => {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    return raycaster.intersectObjects(
      anatomyMeshes.filter((mesh) => mesh.visible),
      false,
    ).length > 0;
  };
  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;
    const mode = pointerHitsVisibleModel(event) ? "rotate" : "vertical-pan";
    pointerGesture = {
      pointerId: event.pointerId,
      mode,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
    };
    if (mode === "rotate") return;

    // Capture before OrbitControls receives a background event. Model events
    // continue to the existing orbit handler unchanged.
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "ns-resize";
    if (focusAnimationFrame !== undefined) {
      window.cancelAnimationFrame(focusAnimationFrame);
      focusAnimationFrame = undefined;
    }
  };
  const handlePointerMove = (event: PointerEvent) => {
    if (pointerGesture?.pointerId !== event.pointerId
      || pointerGesture.mode !== "vertical-pan") return;
    event.preventDefault();
    event.stopImmediatePropagation();

    // Treat the background like a grabbed canvas: dragging downward pulls the
    // rendered body downward, so the camera itself trucks upward.
    const pixelDelta = event.clientY - pointerGesture.lastY;
    pointerGesture.lastY = event.clientY;
    const distance = camera.position.distanceTo(controls.target);
    const visibleWorldHeight = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * distance;
    const requestedDelta = pixelDelta * visibleWorldHeight
      / Math.max(canvas.getBoundingClientRect().height, 1);
    const nextTargetY = THREE.MathUtils.clamp(
      controls.target.y + requestedDelta,
      verticalPanLimits.min,
      verticalPanLimits.max,
    );
    const appliedDelta = nextTargetY - controls.target.y;
    camera.position.y += appliedDelta;
    controls.target.y = nextTargetY;
    controls.update();
    renderScene();
  };
  const handlePointerUp = (event: PointerEvent) => {
    const gesture = pointerGesture;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    pointerGesture = undefined;
    if (gesture.mode === "vertical-pan") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      canvas.style.cursor = "";
      return;
    }
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 6) {
      camera.updateMatrixWorld(true);
      renderScene();
      return;
    }
    setPointerFromEvent(event);
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
  const handlePointerCancel = (event: PointerEvent) => {
    if (pointerGesture?.pointerId !== event.pointerId) return;
    pointerGesture = undefined;
    if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
    canvas.style.cursor = "";
  };
  const handleCanvasWheel = (event: WheelEvent) => {
    event.preventDefault();
  };
  canvas.addEventListener("wheel", handleCanvasWheel, { capture: true, passive: false });
  canvas.addEventListener("pointerdown", handlePointerDown, true);
  canvas.addEventListener("pointermove", handlePointerMove, true);
  canvas.addEventListener("pointerup", handlePointerUp);
  canvas.addEventListener("pointercancel", handlePointerCancel);

  function cleanup() {
    if (cleanedUp) return;
    cleanedUp = true;
    if (lazyLoadTimer !== undefined) window.clearTimeout(lazyLoadTimer);
    lazyLayerControllers.forEach((controller) => controller.abort());
    lazyLayerControllers.clear();
    canvas.removeEventListener("wheel", handleCanvasWheel, true);
    canvas.removeEventListener("pointerdown", handlePointerDown, true);
    canvas.removeEventListener("pointermove", handlePointerMove, true);
    canvas.removeEventListener("pointerup", handlePointerUp);
    canvas.removeEventListener("pointercancel", handlePointerCancel);
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    canvas.style.cursor = "";
    controls.removeEventListener("change", renderScene);
    if (handleControlsStart) controls.removeEventListener("start", handleControlsStart);
    if (handleControlsEnd) controls.removeEventListener("end", handleControlsEnd);
    if (focusAnimationFrame !== undefined) window.cancelAnimationFrame(focusAnimationFrame);
    if (poseAnimationFrame !== undefined) window.cancelAnimationFrame(poseAnimationFrame);
    clearSelectedMaterial();
    pelvicOrganFocusRef.current = () => undefined;
    setHiddenSystemsRef.current = () => undefined;
    playHandPoseRef.current = () => undefined;
    animationMixers.forEach((mixer) => mixer.stopAllAction());
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
      Promise.all(manifest.assets.map(async (asset) => ({ asset, ...await loadAsset(asset) }))),
    ]);
    if (isDisposed()) return cleanup;

    const atlasGroup = new THREE.Group();
    const isStandaloneSkeletonAtlas = manifest.assets.every(
      (asset) => asset.visualRole === "skeleton",
    );
    const dimsShellForReadableInternals = manifest.id
      === "tripo-triangle2m-v49-internals-preview"
      && manifest.assets.some((asset) => (
        asset.visualRole === "skeleton" || asset.visualRole === "organ"
      ));
    for (const { asset, model, animations } of loadedAssets) {
      model.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return;
        materialsOf(object.material).forEach((material) => sourceMaterials.add(material));
        inheritAnatomyMetadata(object);
        const adapted = adaptAnatomyMesh(object, asset, manifest, metadata);
        object.visible = Boolean(adapted);
        if (!adapted) return;

        const layerSystem = anatomyLayerSystem(adapted.system);

        object.userData.anatomyId = adapted.anatomyId;
        object.userData.anatomySourceKey = adapted.sourceKey;
        object.userData.structureLabel = adapted.label;
        object.userData.structureSystem = layerSystem;
        object.userData.visualRole = adapted.visualRole;
        object.userData.contextVisible = Boolean(adapted);
        anatomyMeshes.push(object);
        readySystems.add(layerSystem);
        const isFemaleComposite = manifest.id === "tripo-triangle2m-v49-internals-preview";
        const isAdaptiveSurfaceFlowGuide = isFemaleComposite
          && asset.system === "adaptive-surface-flow-guide";
        const isRegionalBoundaryGuide = isFemaleComposite
          && asset.system === "regional-boundary-guide";
        const isFemaleScalpAponeurosis = isFemaleComposite
          && adapted.system === "muscular"
          && adapted.anatomyId.includes("epicranial-aponeurosis");
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
          : isFemaleScalpAponeurosis
            ? createMatteScalpMaterials(object.material, ownedMaterials)
          : isFemaleComposite && adapted.visualRole === "shell"
            ? createHolographicMaterials(
              object.material,
              adapted.visualRole,
              adapted.system,
              ownedMaterials,
            )
          : createHolographicMaterials(
            object.material,
            adapted.visualRole,
            adapted.system,
            ownedMaterials,
            dimsShellForReadableInternals
              ? INTERNALS_READABILITY_STYLE.skeletonOpacity
              : isStandaloneSkeletonAtlas ? 1 : undefined,
          );
        if (object.userData.tissueType === "costal-cartilage") {
          applyCostalCartilageStyle(object.material, false);
        }
        originalMaterials.set(object, object.material);
        // 초기 남성 화면은 외피·골격만 보인다. 다른 계통도 파싱해 scene에는 두되
        // 사용자가 버튼으로 켜기 전까지 렌더링하지 않는다.
        applyMeshVisibility(object);
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
      const declaredClips = new Set(asset.animationClips ?? []);
      if (declaredClips.size > 0 && animations.length > 0) {
        const mixer = new THREE.AnimationMixer(model);
        animationMixers.push(mixer);
        for (const clip of animations) {
          if (!declaredClips.has(clip.name)) continue;
          const action = mixer.clipAction(clip);
          action.setLoop(THREE.LoopOnce, 1);
          action.clampWhenFinished = true;
          handPoseActions.set(clip.name as HandPose, action);
        }
      }
      atlasGroup.add(model);
    }
    onSystemsReady(new Set(readySystems));

    playHandPoseRef.current = (pose) => {
      const nextAction = handPoseActions.get(pose);
      if (!nextAction || nextAction === activeHandPoseAction) return;
      nextAction.reset();
      nextAction.enabled = true;
      nextAction.setEffectiveTimeScale(1);
      nextAction.setEffectiveWeight(1);
      nextAction.play();
      if (activeHandPoseAction) {
        nextAction.crossFadeFrom(activeHandPoseAction, 0.24, false);
      } else {
        nextAction.fadeIn(0.24);
      }
      activeHandPoseAction = nextAction;
      startPoseAnimationLoop();
    };

    // 모든 골격(두개골 포함), 근육과 장기를 전신 초기 화면에 표시한다.
    // 이 호출은 골반 확대용 소화기 감광 상태만 초기화한다.
    pelvicOrganFocusRef.current(false);

    const sourceBounds = new THREE.Box3().setFromObject(atlasGroup);
    const sourceSize = sourceBounds.getSize(new THREE.Vector3());
    const sourceCenter = sourceBounds.getCenter(new THREE.Vector3());
    const scale = sourceSize.y > 0 ? 4.7 / sourceSize.y : 1;
    atlasGroup.scale.setScalar(scale);
    atlasGroup.position.set(-sourceCenter.x * scale, -sourceCenter.y * scale, -sourceCenter.z * scale);
    atlasGroup.updateMatrixWorld(true);
    scene.add(atlasGroup);

    let activeLazyFocus: AnatomyFocus = "full";
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
    const isFemaleComposite = manifest.id === "tripo-triangle2m-v49-internals-preview";
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
        inheritAnatomyMetadata(object);
        const adapted = adaptAnatomyMesh(object, asset, manifest, metadata);
        object.visible = Boolean(adapted) && layer.triggerFocus.includes(activeLazyFocus);
        if (!adapted) return;

        const layerSystem = anatomyLayerSystem(adapted.system);

        object.userData.anatomyId = adapted.anatomyId;
        object.userData.anatomySourceKey = adapted.sourceKey;
        object.userData.structureLabel = adapted.label;
        object.userData.structureSystem = layerSystem;
        object.userData.visualRole = adapted.visualRole;
        object.userData.lazyLayerId = layer.id;
        object.userData.contextVisible = layer.triggerFocus.includes(activeLazyFocus);
        anatomyMeshes.push(object);
        readySystems.add(layerSystem);
        selectableMeshes.push(object);
        object.material = isFemaleComposite
          && adapted.system === "muscular"
          && adapted.anatomyId.includes("epicranial-aponeurosis")
          ? createMatteScalpMaterials(object.material, ownedMaterials)
          : createHolographicMaterials(
            object.material,
            adapted.visualRole,
            adapted.system,
            ownedMaterials,
          );
        if (object.userData.tissueType === "costal-cartilage") {
          applyCostalCartilageStyle(object.material, activeLazyFocus === "upper");
        }
        originalMaterials.set(object, object.material);
        applyMeshVisibility(object);
      });
      layerGroup.add(model);
      atlasGroup.updateMatrixWorld(true);
      onSystemsReady(new Set(readySystems));
    };
    const fetchLazyAsset = async (asset: AnatomyAtlasAsset, signal: AbortSignal) => {
      const controller = new AbortController();
      let timedOut = false;
      const abort = () => controller.abort();
      signal.addEventListener("abort", abort, { once: true });
      const timeout = window.setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, LAZY_ASSET_TIMEOUT_MS);
      try {
        const response = await fetchCachedAnatomyResource(asset.url, {
          signal: controller.signal,
          revision: asset.sha256,
        });
        if (!response.ok) throw new Error(`지연 자산 요청 실패: ${asset.url}`);
        const buffer = await response.arrayBuffer();
        const gltf = await loader.parseAsync(buffer, "");
        return gltf.scene;
      } catch (error) {
        if (timedOut) {
          throw new Error(`지연 자산 요청 시간 초과: ${asset.url}`, { cause: error });
        }
        throw error;
      } finally {
        window.clearTimeout(timeout);
        signal.removeEventListener("abort", abort);
      }
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
    const preloadEveryLayer = manifest.id === "vanatome-male-reference"
      || manifest.id === "tripo-triangle2m-v49-internals-preview";
    const scheduleLazyLayers = (focus: AnatomyFocus) => {
      activeLazyFocus = focus;
      if (lazyLoadTimer !== undefined) window.clearTimeout(lazyLoadTimer);

      const targets = lazyLayersForFocus(manifest, focus);
      const targetIds = new Set(targets.map((layer) => layer.id));
      lazyLayerGroups.forEach((_, layerId) => setLazyLayerVisible(layerId, targetIds.has(layerId)));
      // 남성 모델은 한 번 시작한 보강 레이어 다운로드를 확대 전환 때문에 취소하지
      // 않는다. 모두 준비돼 있어야 계통 버튼이 네트워크 요청 없이 즉시 반응한다.
      if (!preloadEveryLayer) {
        lazyLayerControllers.forEach((controller, layerId) => {
          if (!targetIds.has(layerId)) controller.abort();
        });
      }
      if (selectedMesh?.userData.lazyLayerId && !targetIds.has(selectedMesh.userData.lazyLayerId)) {
        clearSelectedMaterial();
        onSelectedStructure(undefined);
      }
      renderScene();

      const loadTargets = preloadEveryLayer ? (manifest.lazyLayers ?? []) : targets;
      const pending = loadTargets.filter((layer) => (
        !lazyLayerGroups.has(layer.id) && !lazyLayerControllers.has(layer.id)
      ));
      if (pending.length === 0) return;
      lazyLoadTimer = window.setTimeout(() => {
        void Promise.all(pending.map(loadLazyLayer))
          .then(() => {
            if (activeLazyFocus !== focus || isDisposed()) return;
            renderScene();
          })
          .catch((error: unknown) => {
            if (error instanceof DOMException && error.name === "AbortError") return;
          });
      }, preloadEveryLayer ? 0 : 400);
    };

    const normalizedBounds = new THREE.Box3().setFromObject(atlasGroup);
    verticalPanLimits = {
      min: normalizedBounds.min.y,
      max: normalizedBounds.max.y,
    };
    const presets = createFocusPresets(normalizedBounds);
    camera.position.copy(presets.full.position);
    controls.target.copy(presets.full.target);
    controls.update();

    const transitionToFocus = (
      focus: BodyFocus,
      options: { duration?: number; lockControls?: boolean } = {},
    ) => {
      const duration = options.duration ?? 620;
      const lockControls = options.lockControls ?? false;
      if (autoFullReturnAnimating) {
        autoFullReturnAnimating = false;
        controls.enabled = true;
      }
      if (lockControls) {
        autoFullReturnAnimating = true;
        controls.enabled = false;
      }
      activeBodyFocus = focus;
      onFocusChange(focus);
      // 빠른 확대는 카메라만 이동한다. 현재 표시 중인 계통과 부위별 보강
      // 레이어의 가시성은 사용자가 구조 레이어 버튼으로 바꿀 때까지 유지한다.
      const preset = presets[focus];
      const startPosition = camera.position.clone();
      const startTarget = controls.target.clone();
      const startedAt = performance.now();
      if (focusAnimationFrame !== undefined) window.cancelAnimationFrame(focusAnimationFrame);

      const animateFocus = (now: number) => {
        const elapsed = Math.min(1, (now - startedAt) / duration);
        const eased = elapsed * elapsed * elapsed * (elapsed * (elapsed * 6 - 15) + 10);
        camera.position.lerpVectors(startPosition, preset.position, eased);
        controls.target.lerpVectors(startTarget, preset.target, eased);
        controls.update();
        renderScene();
        if (elapsed < 1) {
          focusAnimationFrame = window.requestAnimationFrame(animateFocus);
        } else {
          focusAnimationFrame = undefined;
          if (lockControls) {
            autoFullReturnAnimating = false;
            controls.enabled = true;
          }
        }
      };
      focusAnimationFrame = window.requestAnimationFrame(animateFocus);
    };
    focusCameraRef.current = transitionToFocus;

    const fullBodyDistance = presets.full.position.distanceTo(presets.full.target);
    handleControlsStart = () => {
      if (autoFullReturnAnimating) return;
      if (focusAnimationFrame === undefined) return;
      window.cancelAnimationFrame(focusAnimationFrame);
      focusAnimationFrame = undefined;
    };
    handleControlsEnd = () => {
      const cameraDistance = camera.position.distanceTo(controls.target);
      if (shouldReturnToFullBody(activeBodyFocus, cameraDistance, fullBodyDistance)) {
        transitionToFocus("full", { duration: 900, lockControls: true });
      }
    };
    controls.addEventListener("start", handleControlsStart);
    controls.addEventListener("end", handleControlsEnd);

    // 핵심 모델이 준비되면 외피·골격 첫 프레임을 즉시 내보낸다. 남성 보강 레이어는
    // 곧바로 전부 병렬 로드하되 숨김 상태로 붙인다. 그래서 첫 화면은 가볍고, 로드가
    // 끝난 뒤 계통 버튼은 추가 네트워크 요청 없이 가시성만 바꾼다.
    onReady();
    renderScene();
    scheduleLazyLayers("full");
  } catch {
    cleanup();
    throw new Error(`아틀라스 자산을 불러오지 못했습니다: ${manifest.id}`);
  }

  return cleanup;
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
    joints: "관절·인대·막",
    urinary: "비뇨기계",
    "regional-anatomy": "외부 해부 구조",
  };
  return labels[system] ?? system;
}
