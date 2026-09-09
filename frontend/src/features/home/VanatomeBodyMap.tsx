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
import { createAnatomyEvent, type AnatomyEvent } from "./anatomyEventContracts";
import {
  applyCostalCartilageStyle,
  createAdaptiveFlowGuideMaterial,
  createFocusPresets,
  createHolographicMaterials,
  createHoverMaterials,
  createMatteScalpMaterials,
  INTERNALS_READABILITY_STYLE,
  createRegionalBoundaryMaterial,
  createSelectedMaterials,
  materialsOf,
  shouldReturnToFullBody,
} from "./holographicAnatomyStyle";
import {
  resolveAnatomyDisplayInfo,
  type AnatomyDisplayInfo,
} from "./anatomyKoreanDictionary";
import { ProceduralBodyMap } from "./ProceduralBodyMap";
import { fetchCachedAnatomyResource } from "./anatomyResourceCache";
import type { RegionRisk } from "./bodyRisk";

export type SelectedStructure = {
  name: string;
  system?: string;
  anatomyEvent?: AnatomyEvent;
};

export interface StagingItem {
  id: string;
  mesh: THREE.Mesh;
  info: AnatomyDisplayInfo;
  excluded: boolean;
}
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

const DEFAULT_ANATOMY_ATLAS: AnatomyAtlasId = "vanatome-male-reference";

export function VanatomeBodyMap({
  profileName,
  gender,
  onStructureSelect,
  onStagingChange,
}: {
  profileName: string;
  gender?: "male" | "female" | null;
  risks?: RegionRisk[];
  risksAt?: string;
  onStructureSelect?: (structure: SelectedStructure | undefined) => void;
  onStagingChange?: (items: StagingItem[]) => void;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const onStructureSelectRef = useRef(onStructureSelect);
  useEffect(() => {
    onStructureSelectRef.current = onStructureSelect;
  }, [onStructureSelect]);
  const onStagingChangeRef = useRef(onStagingChange);
  useEffect(() => {
    onStagingChangeRef.current = onStagingChange;
  }, [onStagingChange]);
  const clearSelectionRef = useRef<() => void>(() => undefined);
  const focusCameraRef = useRef<(focus: BodyFocus) => void>(() => undefined);
  const pelvicOrganFocusRef = useRef<(active: boolean) => void>(() => undefined);
  const setHiddenSystemsRef = useRef<(systems: ReadonlySet<string>) => void>(() => undefined);
  const playHandPoseRef = useRef<(pose: HandPose) => void>(() => undefined);
  const atlasId: AnatomyAtlasId = gender === "female"
    ? "tripo-triangle2m-v49-internals-preview"
    : DEFAULT_ANATOMY_ATLAS;
  const [manifest, setManifest] = useState<AnatomyAtlasManifest>();
  const [selectedStructure, setSelectedStructure] = useState<SelectedStructure>();
  const [stagedItems, setStagedItems] = useState<StagingItem[]>([]);
  const [hoveredInfo, setHoveredInfo] = useState<AnatomyDisplayInfo | null>(null);
  const toggleExcludeStagedRef = useRef<(id: string) => void>(() => undefined);
  const [interactionMode, setInteractionMode] = useState<"inspect" | "paint">("inspect");
  const setInteractionModeRef = useRef<(mode: "inspect" | "paint") => void>(() => undefined);
  const undoPaintRef = useRef<() => void>(() => undefined);
  const clearPaintRef = useRef<() => void>(() => undefined);
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
          onSelectedStructure: (structure) => {
            setSelectedStructure(structure);
            onStructureSelectRef.current?.(structure);
          },
          onFocusChange: setActiveFocus,
          onSystemsReady: setReadySystems,
          initialHiddenSystems,
          clearSelectionRef,
          focusCameraRef,
          pelvicOrganFocusRef,
          setHiddenSystemsRef,
          playHandPoseRef,
          setInteractionModeRef,
          undoPaintRef,
          clearPaintRef,
          onStagingChange: (items) => {
            setStagedItems(items);
            onStagingChangeRef.current?.(items);
          },
          onHoverStructure: setHoveredInfo,
          toggleExcludeRef: toggleExcludeStagedRef,
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
      setInteractionModeRef.current = () => undefined;
      undoPaintRef.current = () => undefined;
      clearPaintRef.current = () => undefined;
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
          <span style={{ color: !selectedStructure && hoveredInfo ? "#d97706" : undefined, fontWeight: !selectedStructure && hoveredInfo ? 600 : undefined }}>
            {selectedStructure
              ? "선택한 구조"
              : hoveredInfo
              ? "마우스 오버 부위 (클릭하여 선택)"
              : "선택한 구조"}
          </span>
          <strong style={{ color: !selectedStructure && hoveredInfo ? "#b45309" : undefined }}>
            {selectedStructure
              ? selectedStructure.name
              : hoveredInfo
              ? `${hoveredInfo.koreanName} (${hoveredInfo.canonicalName})`
              : "인체에서 구조를 선택하세요"}
          </strong>
          <small>
            {selectedStructure
              ? `${selectedStructure.system ? `${selectedStructure.system} · ` : ""}선택 완료 버튼을 눌러 기록에 반영할 수 있습니다.`
              : hoveredInfo
              ? `${hoveredInfo.systemKorean} 계통 · ${hoveredInfo.description || "클릭하면 이 부위가 선택됩니다."}`
              : "모델 드래그는 회전, 검은 배경 드래그는 상하 카메라 이동, 클릭은 구조 선택입니다."}
          </small>
        </div>
        <div className="vanatome-mode-actions" style={{ display: "flex", gap: "6px", margin: "12px 0 8px" }}>
          <button
            type="button"
            className="secondary-button"
            style={{
              flex: 1,
              padding: "6px 8px",
              fontSize: "0.82rem",
              background: interactionMode === "inspect" ? "rgba(37, 99, 235, 0.12)" : undefined,
              borderColor: interactionMode === "inspect" ? "#2563eb" : undefined,
              color: interactionMode === "inspect" ? "#1d4ed8" : undefined,
              fontWeight: interactionMode === "inspect" ? "600" : undefined,
            }}
            onClick={() => {
              setInteractionMode("inspect");
              setInteractionModeRef.current("inspect");
            }}
          >
            부위 탐색/선택
          </button>
          <button
            type="button"
            className="secondary-button"
            style={{
              flex: 1,
              padding: "6px 8px",
              fontSize: "0.82rem",
              background: interactionMode === "paint" ? "rgba(244, 63, 94, 0.12)" : undefined,
              borderColor: interactionMode === "paint" ? "#f43f5e" : undefined,
              color: interactionMode === "paint" ? "#be123c" : undefined,
              fontWeight: interactionMode === "paint" ? "600" : undefined,
            }}
            onClick={() => {
              setInteractionMode("paint");
              setInteractionModeRef.current("paint");
            }}
          >
            통증 범위 칠하기
          </button>
        </div>
        <div className="vanatome-actions" style={{ display: "flex", gap: "6px" }}>
          {interactionMode === "paint" ? (
            <>
              <button
                type="button"
                style={{ flex: 1, padding: "5px 8px", fontSize: "0.8rem" }}
                onClick={() => undoPaintRef.current()}
              >
                되돌리기(Undo)
              </button>
              <button
                type="button"
                style={{ flex: 1, padding: "5px 8px", fontSize: "0.8rem" }}
                onClick={() => clearPaintRef.current()}
              >
                칠한 부위 지우기
              </button>
            </>
          ) : (
            <button type="button" disabled={!selectedStructure} onClick={() => clearSelectionRef.current()}>
              선택 해제
            </button>
          )}
        </div>
        {stagedItems.length > 0 ? (
          <div
            className="vanatome-staging-panel"
            style={{
              margin: "12px 0",
              padding: "10px",
              background: "rgba(248, 250, 252, 0.8)",
              borderRadius: "10px",
              border: "1px solid #e2e8f0",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
              <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b" }}>
                📋 선택된 부위 ({stagedItems.filter((i) => !i.excluded).length}/{stagedItems.length}개 활성)
              </span>
              <small style={{ fontSize: "0.72rem", color: "#64748b" }}>제외/포함 번복 가능</small>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "6px", maxHeight: "180px", overflowY: "auto" }}>
              {stagedItems.map((item) => (
                <div
                  key={item.id}
                  style={{
                    padding: "6px 8px",
                    borderRadius: "6px",
                    background: item.excluded ? "#f1f5f9" : "#ffffff",
                    border: item.excluded ? "1px dashed #cbd5e1" : "1px solid #fecdd3",
                    opacity: item.excluded ? 0.6 : 1,
                    display: "flex",
                    justifyContent: "space-between",
                    alignItems: "center",
                    gap: "6px",
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: "0.8rem", fontWeight: 600, color: item.excluded ? "#64748b" : "#9f1239", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      {item.info.koreanName}
                      <span style={{ fontWeight: 400, fontSize: "0.74rem", color: "#64748b", marginLeft: "4px" }}>
                        ({item.info.canonicalName})
                      </span>
                    </div>
                    <div style={{ fontSize: "0.7rem", color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                      <span style={{ color: "#be123c", fontWeight: 500 }}>[{item.info.systemKorean}]</span> {item.info.description}
                    </div>
                  </div>
                  <button
                    type="button"
                    style={{
                      padding: "2px 7px",
                      fontSize: "0.72rem",
                      borderRadius: "4px",
                      border: "1px solid",
                      borderColor: item.excluded ? "#3b82f6" : "#f43f5e",
                      color: item.excluded ? "#1d4ed8" : "#be123c",
                      background: item.excluded ? "#eff6ff" : "#fff1f2",
                      cursor: "pointer",
                      whiteSpace: "nowrap",
                    }}
                    onClick={() => toggleExcludeStagedRef.current(item.id)}
                  >
                    {item.excluded ? "다시 포함 ⟲" : "제외 ✕"}
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : null}
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
        <span className="body-map-hint">
          {interactionMode === "paint"
            ? "인체 위 드래그로 스프레이 분사 · 외곽선 드래그로 회전 · 배경 드래그로 상하 이동"
            : "인체 클릭으로 부위 선택 · 외곽선 드래그로 회전 · 배경 드래그로 상하 이동"}
        </span>
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
  setInteractionModeRef: React.MutableRefObject<(mode: "inspect" | "paint") => void>;
  undoPaintRef: React.MutableRefObject<() => void>;
  clearPaintRef: React.MutableRefObject<() => void>;
  onStagingChange: (items: StagingItem[]) => void;
  onHoverStructure: (info: AnatomyDisplayInfo | null) => void;
  toggleExcludeRef: React.MutableRefObject<(id: string) => void>;
};

async function createAnatomyScene(options: CreateAnatomySceneOptions) {
  const {
    canvas, manifest, signal, isDisposed, onProgress, onReady, onWebGlUnavailable,
    onSelectedStructure, onFocusChange, onSystemsReady, initialHiddenSystems,
    clearSelectionRef, focusCameraRef,
    pelvicOrganFocusRef, setHiddenSystemsRef,
    playHandPoseRef,
    setInteractionModeRef, undoPaintRef, clearPaintRef,
    onStagingChange, onHoverStructure, toggleExcludeRef,
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
  const originalRenderOrders = new Map<THREE.Mesh, number>();
  const progressByUrl = new Map<string, { loaded: number; total: number }>();
  const selectedMeshes = new Set<THREE.Mesh>();
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
    if (selectedMeshes.size === 0) return;
    selectedMeshes.forEach((mesh) => {
      materialsOf(mesh.material).forEach((material) => {
        if (!ownedMaterials.has(material)) material.dispose();
      });
      const original = originalMaterials.get(mesh);
      if (original) mesh.material = original;
    });
    selectedMeshes.clear();
    renderScene();
  };

  // 3D 에어로졸 스프레이(Aerosol Spray) 및 임시 검토(Staging) 상태 관리
  let interactionMode: "inspect" | "paint" = "inspect";
  const paintMarkersGroup = new THREE.Group();
  paintMarkersGroup.renderOrder = 20;
  scene.add(paintMarkersGroup);
  const sprayParticleGeo = new THREE.SphereGeometry(1, 4, 4);
  const sprayParticleMat = new THREE.MeshBasicMaterial({
    color: 0xf43f5e,
    transparent: true,
    opacity: 0.72,
    depthWrite: false,
  });

  type PaintSample = {
    point: THREE.Vector3;
    normal?: THREE.Vector3;
    mesh: THREE.Mesh;
    markers: THREE.Object3D[];
  };
  type PaintStroke = {
    samples: PaintSample[];
    touchedMeshes: THREE.Mesh[];
  };
  const paintHistory: PaintStroke[] = [];
  let currentStroke: PaintStroke | null = null;
  let isPainting = false;
  let lastSampleTime = 0;

  const stagedItemsMap = new Map<string, StagingItem>();

  const isMeshSelected = (mesh: THREE.Mesh): boolean => {
    const item = stagedItemsMap.get(mesh.name);
    return Boolean((item && !item.excluded) || selectedMeshes.has(mesh));
  };

  const ensureStagedItem = (mesh: THREE.Mesh): StagingItem => {
    const id = mesh.name;
    let item = stagedItemsMap.get(id);
    if (!item) {
      const info = resolveAnatomyDisplayInfo(mesh.name, String(mesh.userData.structureSystem ?? ""));
      item = {
        id,
        mesh,
        info,
        excluded: false,
      };
      stagedItemsMap.set(id, item);
    }
    return item;
  };

  const recordPaintSample = (hit: THREE.Intersection) => {
    if (!(hit.object instanceof THREE.Mesh) || !currentStroke) return;
    const mesh = hit.object;

    const normal = hit.normal ?? new THREE.Vector3(0, 0, 1);
    const up = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangent1 = new THREE.Vector3().crossVectors(normal, up).normalize();
    const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1).normalize();

    const SPRAY_RADIUS = 0.085;
    const PARTICLE_COUNT = 15;
    const markers: THREE.Object3D[] = [];

    // 가우시안 흩뿌림으로 에어로졸 스프레이 입자 분사
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      const u = Math.random();
      const r = SPRAY_RADIUS * Math.pow(u, 0.65);
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const particlePos = hit.point.clone()
        .addScaledVector(tangent1, x)
        .addScaledVector(tangent2, y)
        .addScaledVector(normal, 0.002 + Math.random() * 0.003);

      const marker = new THREE.Mesh(sprayParticleGeo, sprayParticleMat);
      const particleScale = 0.004 + Math.random() * 0.004;
      marker.scale.setScalar(particleScale);
      marker.position.copy(particlePos);
      marker.renderOrder = 20;
      paintMarkersGroup.add(marker);
      markers.push(marker);
    }

    currentStroke.samples.push({
      point: hit.point.clone(),
      normal: hit.normal?.clone(),
      mesh,
      markers,
    });

    ensureStagedItem(mesh);

    // 스프레이 반경 내 인접 가시 메쉬도 스테이징에 감지 (메쉬 전체 색상 덮어쓰기는 비활성화)
    for (const other of selectableMeshes) {
      if (other !== mesh && other.visible) {
        const box = new THREE.Box3().setFromObject(other);
        if (box.distanceToPoint(hit.point) < SPRAY_RADIUS * 0.75) {
          ensureStagedItem(other);
          if (!currentStroke.touchedMeshes.includes(other)) {
            currentStroke.touchedMeshes.push(other);
          }
        }
      }
    }

    if (!currentStroke.touchedMeshes.includes(mesh)) {
      currentStroke.touchedMeshes.push(mesh);
    }
    renderScene();
  };

  const emitStagedSummary = () => {
    const allItems = Array.from(stagedItemsMap.values());
    onStagingChange(allItems);

    const activeItems = allItems.filter((i) => !i.excluded);
    if (activeItems.length === 0) {
      onSelectedStructure(undefined);
      return;
    }

    const allActiveSamples = paintHistory
      .flatMap((s) => s.samples)
      .filter((s) => !stagedItemsMap.get(s.mesh.name)?.excluded);

    const centroid = new THREE.Vector3();
    if (allActiveSamples.length > 0) {
      for (const s of allActiveSamples) centroid.add(s.point);
      centroid.divideScalar(allActiveSamples.length);
    } else if (selectedMeshes.size > 0) {
      for (const m of selectedMeshes) {
        const p = new THREE.Vector3();
        m.getWorldPosition(p);
        centroid.add(p);
      }
      centroid.divideScalar(selectedMeshes.size);
    }

    let maxDist = 0;
    for (const s of allActiveSamples) {
      const d = centroid.distanceTo(s.point);
      if (d > maxDist) maxDist = d;
    }
    const radius = Number(maxDist.toFixed(4));

    const primary = activeItems[0];
    const primarySystem = primary.info.systemKorean;
    const rawSystem = primary.info.system;

    const combinedLabel = activeItems
      .map((i) => i.info.fullBilingualLabel)
      .join(", ") + (paintHistory.length > 0 ? " (3D 스프레이)" : "");

    let anatomyEvent: AnatomyEvent | undefined;
    try {
      anatomyEvent = createAnatomyEvent({
        atlas: {
          id: manifest.id,
          version: manifest.version,
          referenceSex: manifest.referenceSex,
        },
        concept: {
          canonicalConceptId: primary.mesh.name,
          sourceKey: String(primary.mesh.userData.sourceKey ?? `vanatome:${manifest.id}:${manifest.version}:${primary.mesh.name}`),
          sourceMeshId: primary.mesh.name,
          label: combinedLabel,
          system: rawSystem,
          mappingStatus: "canonical",
        },
        geometry: {
          coordinateSpace: "world",
          point: [Number(centroid.x.toFixed(4)), Number(centroid.y.toFixed(4)), Number(centroid.z.toFixed(4))],
          distance: radius || undefined,
        },
        inputSource: paintHistory.length > 0 ? "brush" : "tap",
        state: "confirmed",
        coverage: paintHistory.length > 0 ? {
          radius,
          sampleCount: allActiveSamples.length,
          hitRatio: Number(Math.min(1.0, allActiveSamples.length / 20).toFixed(2)),
        } : undefined,
      });
    } catch {
      // safe fallback
    }

    onSelectedStructure({
      name: combinedLabel,
      system: primarySystem,
      anatomyEvent,
    });
  };

  toggleExcludeRef.current = (id: string) => {
    const item = stagedItemsMap.get(id);
    if (!item) return;
    item.excluded = !item.excluded;

    if (item.excluded) {
      const orig = originalMaterials.get(item.mesh);
      if (orig) item.mesh.material = orig;
      selectedMeshes.delete(item.mesh);
      for (const stroke of paintHistory) {
        for (const s of stroke.samples) {
          if (s.mesh === item.mesh) {
            for (const m of s.markers) m.visible = false;
          }
        }
      }
    } else {
      item.mesh.material = createSelectedMaterials(item.mesh.material);
      selectedMeshes.add(item.mesh);
      for (const stroke of paintHistory) {
        for (const s of stroke.samples) {
          if (s.mesh === item.mesh) {
            for (const m of s.markers) m.visible = true;
          }
        }
      }
    }
    renderScene();
    emitStagedSummary();
  };

  const clearPaint = () => {
    while (paintMarkersGroup.children.length > 0) {
      paintMarkersGroup.remove(paintMarkersGroup.children[0]);
    }
    for (const stroke of paintHistory) {
      for (const mesh of stroke.touchedMeshes) {
        const orig = originalMaterials.get(mesh);
        if (orig) mesh.material = orig;
      }
    }
    paintHistory.length = 0;
    currentStroke = null;
    stagedItemsMap.clear();
    if (selectedMeshes.size > 0) clearSelectedMaterial();
    renderScene();
    emitStagedSummary();
  };

  const undoPaint = () => {
    const last = paintHistory.pop();
    if (!last) return;
    for (const s of last.samples) {
      for (const m of s.markers) {
        paintMarkersGroup.remove(m);
      }
    }
    const remainingMeshes = new Set(paintHistory.flatMap((s) => s.touchedMeshes));
    for (const mesh of last.touchedMeshes) {
      if (!remainingMeshes.has(mesh) && !selectedMeshes.has(mesh)) {
        const orig = originalMaterials.get(mesh);
        if (orig) mesh.material = orig;
        stagedItemsMap.delete(mesh.name);
      }
    }
    renderScene();
    emitStagedSummary();
  };

  setInteractionModeRef.current = (mode) => {
    interactionMode = mode;
    if (mode === "paint") {
      if (hoveredMesh && !isMeshSelected(hoveredMesh)) {
        const orig = originalMaterials.get(hoveredMesh);
        if (orig) hoveredMesh.material = orig;
        const origOrder = originalRenderOrders.get(hoveredMesh);
        if (origOrder !== undefined) hoveredMesh.renderOrder = origOrder;
        hoveredMesh = undefined;
      }
      onHoverStructure(null);
      renderScene();
    }
    canvas.style.cursor = mode === "paint" ? "crosshair" : "";
  };
  undoPaintRef.current = undoPaint;
  clearPaintRef.current = clearPaint;

  clearSelectionRef.current = () => {
    clearSelectedMaterial();
    clearPaint();
    stagedItemsMap.clear();
    emitStagedSummary();
  };

  setHiddenSystemsRef.current = (systems) => {
    hiddenSystems = new Set(systems);
    selectedMeshes.forEach((mesh) => {
      if (hiddenSystems.has(String(mesh.userData.structureSystem ?? ""))) {
        const orig = originalMaterials.get(mesh);
        if (orig) mesh.material = orig;
        selectedMeshes.delete(mesh);
      }
    });
    if (selectedMeshes.size === 0 && stagedItemsMap.size === 0) {
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
    mode: "rotate" | "vertical-pan" | "paint";
    startX: number;
    startY: number;
    lastY: number;
  } | undefined;
  let verticalPanLimits = { min: -2.35, max: 2.35 };

  // 3D 회전 제어를 위한 OS 내장 커서 (외곽선 마우스 오버 시 grab, 드래그 회전 시 grabbing)
  const ROTATE_CURSOR = "grab";

  const setPointerFromEvent = (event: PointerEvent) => {
    const bounds = canvas.getBoundingClientRect();
    pointer.x = ((event.clientX - bounds.left) / bounds.width) * 2 - 1;
    pointer.y = -((event.clientY - bounds.top) / bounds.height) * 2 + 1;
  };

  const checkPointerZone = (event: PointerEvent): {
    zone: "model" | "outline" | "background";
    hitMesh?: THREE.Mesh;
    hit?: THREE.Intersection;
  } => {
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);

    // 1. 인체 모델 직접 적중 검사 (칠할 수 있는 가시적 메쉬)
    const selectableHits = raycaster.intersectObjects(
      selectableMeshes.filter((m) => m.visible),
      false,
    );
    const hit = selectableHits[0];
    if (hit?.object instanceof THREE.Mesh) {
      return { zone: "model", hitMesh: hit.object, hit };
    }

    const anyModelHits = raycaster.intersectObjects(
      anatomyMeshes.filter((m) => m.visible),
      false,
    );
    if (anyModelHits.length > 0) {
      const first = anyModelHits[0];
      return {
        zone: "model",
        hitMesh: first.object instanceof THREE.Mesh ? first.object : undefined,
        hit: first,
      };
    }

    // 2. 인체와 검정 배경 사이의 외곽선 마진 (약 8px로 좁혀 작은 신체 선택 방해 최소화)
    const bounds = canvas.getBoundingClientRect();
    const marginPx = 8;
    const dx = (marginPx / Math.max(bounds.width, 1)) * 2;
    const dy = (marginPx / Math.max(bounds.height, 1)) * 2;

    const offsets = [
      [-dx, 0], [dx, 0], [0, -dy], [0, dy],
      [-dx * 0.707, -dy * 0.707], [dx * 0.707, -dy * 0.707],
      [-dx * 0.707, dy * 0.707], [dx * 0.707, dy * 0.707],
    ];

    const tempPointer = new THREE.Vector2();
    for (const [ox, oy] of offsets) {
      tempPointer.set(pointer.x + ox, pointer.y + oy);
      raycaster.setFromCamera(tempPointer, camera);
      const marginHits = raycaster.intersectObjects(
        anatomyMeshes.filter((m) => m.visible),
        false,
      );
      if (marginHits.length > 0) {
        return { zone: "outline" };
      }
    }

    // 3. 완전한 검정 배경
    return { zone: "background" };
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (!event.isPrimary || event.button !== 0) return;

    const { zone, hit } = checkPointerZone(event);

    if (interactionMode === "paint") {
      // Zone 1: 인체 위 -> 스프레이 분사 시작
      if (zone === "model" && hit?.object instanceof THREE.Mesh) {
        event.preventDefault();
        event.stopImmediatePropagation();
        canvas.setPointerCapture(event.pointerId);
        isPainting = true;
        controls.enabled = false;
        currentStroke = { samples: [], touchedMeshes: [] };
        recordPaintSample(hit);
        pointerGesture = {
          pointerId: event.pointerId,
          mode: "paint" as const,
          startX: event.clientX,
          startY: event.clientY,
          lastY: event.clientY,
        };
        canvas.style.cursor = "crosshair";
        return;
      }

      // Zone 2: 인체 외곽선 -> 회전 제스처
      if (zone === "outline") {
        controls.enabled = true;
        pointerGesture = {
          pointerId: event.pointerId,
          mode: "rotate" as const,
          startX: event.clientX,
          startY: event.clientY,
          lastY: event.clientY,
        };
        canvas.style.cursor = "grabbing";
        return;
      }

      // Zone 3: 배경 -> 상하 카메라 이동
      event.preventDefault();
      event.stopImmediatePropagation();
      canvas.setPointerCapture(event.pointerId);
      canvas.style.cursor = "ns-resize";
      if (focusAnimationFrame !== undefined) {
        window.cancelAnimationFrame(focusAnimationFrame);
        focusAnimationFrame = undefined;
      }
      pointerGesture = {
        pointerId: event.pointerId,
        mode: "vertical-pan" as const,
        startX: event.clientX,
        startY: event.clientY,
        lastY: event.clientY,
      };
      return;
    }

    // inspect 모드일 때:
    if (zone === "model" || zone === "outline") {
      controls.enabled = true;
      pointerGesture = {
        pointerId: event.pointerId,
        mode: "rotate" as const,
        startX: event.clientX,
        startY: event.clientY,
        lastY: event.clientY,
      };
      if (zone === "outline") {
        canvas.style.cursor = "grabbing";
      }
      return;
    }

    // inspect 모드 배경: 상하 카메라 이동
    event.preventDefault();
    event.stopImmediatePropagation();
    canvas.setPointerCapture(event.pointerId);
    canvas.style.cursor = "ns-resize";
    if (focusAnimationFrame !== undefined) {
      window.cancelAnimationFrame(focusAnimationFrame);
      focusAnimationFrame = undefined;
    }
    pointerGesture = {
      pointerId: event.pointerId,
      mode: "vertical-pan" as const,
      startX: event.clientX,
      startY: event.clientY,
      lastY: event.clientY,
    };
  };

  let hoveredMesh: THREE.Mesh | undefined;

  const handleHover = (event: PointerEvent) => {
    const { zone, hitMesh } = checkPointerZone(event);

    if (interactionMode === "paint") {
      if (hoveredMesh && !isMeshSelected(hoveredMesh)) {
        const orig = originalMaterials.get(hoveredMesh);
        if (orig) hoveredMesh.material = orig;
        const origOrder = originalRenderOrders.get(hoveredMesh);
        if (origOrder !== undefined) hoveredMesh.renderOrder = origOrder;
        hoveredMesh = undefined;
        renderScene();
      }

      if (zone === "model") {
        canvas.style.cursor = "crosshair";
      } else if (zone === "outline") {
        canvas.style.cursor = ROTATE_CURSOR;
      } else {
        canvas.style.cursor = "ns-resize";
      }
      return;
    }

    // inspect 모드:
    if (zone === "model") {
      const mesh = hitMesh;
      if (mesh !== hoveredMesh) {
        if (hoveredMesh && !isMeshSelected(hoveredMesh)) {
          const orig = originalMaterials.get(hoveredMesh);
          if (orig) hoveredMesh.material = orig;
          const origOrder = originalRenderOrders.get(hoveredMesh);
          if (origOrder !== undefined) hoveredMesh.renderOrder = origOrder;
        }

        hoveredMesh = mesh;

        if (mesh) {
          const info = resolveAnatomyDisplayInfo(mesh.name, String(mesh.userData.structureSystem ?? ""));
          onHoverStructure(info);
          if (!isMeshSelected(mesh)) {
            if (!originalRenderOrders.has(mesh)) {
              originalRenderOrders.set(mesh, mesh.renderOrder);
            }
            mesh.renderOrder = 10;
            const orig = originalMaterials.get(mesh) ?? mesh.material;
            mesh.material = createHoverMaterials(orig);
          }
        }
        renderScene();
      }
      canvas.style.cursor = "pointer";
    } else {
      if (hoveredMesh && !isMeshSelected(hoveredMesh)) {
        const orig = originalMaterials.get(hoveredMesh);
        if (orig) hoveredMesh.material = orig;
        const origOrder = originalRenderOrders.get(hoveredMesh);
        if (origOrder !== undefined) hoveredMesh.renderOrder = origOrder;
        hoveredMesh = undefined;
        renderScene();
      }
      onHoverStructure(null);

      if (zone === "outline") {
        canvas.style.cursor = ROTATE_CURSOR;
      } else {
        canvas.style.cursor = "ns-resize";
      }
    }
  };

  const handlePointerLeave = () => {
    if (hoveredMesh && !isMeshSelected(hoveredMesh)) {
      const orig = originalMaterials.get(hoveredMesh);
      if (orig) hoveredMesh.material = orig;
      const origOrder = originalRenderOrders.get(hoveredMesh);
      if (origOrder !== undefined) hoveredMesh.renderOrder = origOrder;
      renderScene();
    }
    hoveredMesh = undefined;
    onHoverStructure(null);
    canvas.style.cursor = "";
  };
  canvas.addEventListener("pointerleave", handlePointerLeave);

  const handlePointerMove = (event: PointerEvent) => {
    if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) {
      if (!pointerGesture && !isPainting) {
        handleHover(event);
      }
      return;
    }

    if (isPainting && currentStroke && pointerGesture.mode === "paint") {
      event.preventDefault();
      event.stopImmediatePropagation();
      const now = performance.now();
      if (now - lastSampleTime > 25) {
        lastSampleTime = now;
        setPointerFromEvent(event);
        raycaster.setFromCamera(pointer, camera);
        const hit = raycaster.intersectObjects(
          selectableMeshes.filter((m) => m.visible),
          false,
        )[0];
        if (hit?.object instanceof THREE.Mesh) {
          recordPaintSample(hit);
        }
      }
      return;
    }

    if (pointerGesture.mode !== "vertical-pan") return;
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

    if (isPainting) {
      isPainting = false;
      controls.enabled = true;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (currentStroke && currentStroke.samples.length > 0) {
        paintHistory.push(currentStroke);
        currentStroke = null;
        emitStagedSummary();
      }
      renderScene();
      handleHover(event);
      return;
    }

    if (gesture.mode === "vertical-pan") {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
      handleHover(event);
      return;
    }

    if (gesture.mode === "rotate") {
      handleHover(event);
      if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 6) {
        camera.updateMatrixWorld(true);
        renderScene();
        return;
      }
    }

    if (interactionMode === "paint") {
      handleHover(event);
      return;
    }

    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 6) {
      camera.updateMatrixWorld(true);
      renderScene();
      return;
    }
    setPointerFromEvent(event);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(
      selectableMeshes.filter((m) => m.visible),
      false,
    )[0];
    if (!(hit?.object instanceof THREE.Mesh)) return;

    const mesh = hit.object;
    const existing = stagedItemsMap.get(mesh.name);
    if (existing) {
      if (existing.excluded) {
        existing.excluded = false;
        mesh.material = createSelectedMaterials(mesh.material);
        selectedMeshes.add(mesh);
      }
    } else {
      ensureStagedItem(mesh);
      mesh.material = createSelectedMaterials(mesh.material);
      selectedMeshes.add(mesh);
    }

    emitStagedSummary();
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
    // canvas 는 canvasRef 의 같은 DOM 노드라 이펙트가 다시 돌아도 살아남는다. 이걸
    // 빼먹으면 핸들러가 쌓이고, 낡은 핸들러가 이미 dispose 한 씬의 renderScene 과
    // 재질 맵을 계속 붙잡는다.
    canvas.removeEventListener("pointerleave", handlePointerLeave);
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
      selectedMeshes.forEach((mesh) => {
        if (mesh.userData.lazyLayerId && !targetIds.has(mesh.userData.lazyLayerId)) {
          const orig = originalMaterials.get(mesh);
          if (orig) mesh.material = orig;
          selectedMeshes.delete(mesh);
        }
      });
      if (selectedMeshes.size === 0 && stagedItemsMap.size === 0) {
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
