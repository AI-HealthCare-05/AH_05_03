import { useEffect, useMemo, useRef, useState } from "react";
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
  createSelectedTransparentMaterials,
  materialsOf,
  shouldReturnToFullBody,
  calculateAdaptiveSprayMetrics,
  createSprayAgitationState,
  updateSprayAgitation,
  type SprayAgitationState,
} from "./holographicAnatomyStyle";
import {
  resolveAnatomyDisplayInfo,
  type AnatomyDisplayInfo,
} from "./anatomyKoreanDictionary";
import { ProceduralBodyMap } from "./ProceduralBodyMap";
import { fetchCachedAnatomyResource } from "./anatomyResourceCache";
import type { RegionRisk } from "./bodyRisk";
import { DentalPickerModal } from "./DentalPickerModal";
import { AnatomySearchDrawer } from "./AnatomySearchDrawer";
import { collectDepthHitCandidates, type DepthHitCandidate, type DepthLevel } from "./depthPicker";
import {
  applyXRayShading,
  restoreXRayShading,
  createGhostMaterial,
  matchesSystemCategory,
  isSkeletonStructure,
  isFasciaStructure,
  isPeritoneumStructure,
} from "./anatomyLayerFilter";
import {
  calculateFocusBounds,
  calculateTargetCameraPosition,
  applyIsolateShading,
  restoreIsolateShading,
  cloneToIsolateGhost,
} from "./cameraFocusManager";

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

function getSystemBadgeColor(system?: string): string {
  switch (system) {
    case "skeletal":
      return "#38bdf8";
    case "joints":
      return "#2dd4bf";
    case "muscular":
      return "#fb7185";
    case "nervous":
      return "#facc15";
    case "cardiovascular":
      return "#f87171";
    case "respiratory":
      return "#60a5fa";
    case "digestive":
      return "#fb923c";
    case "urinary":
      return "#c084fc";
    case "integumentary":
      return "#a78bfa";
    default:
      return "#94a3b8";
  }
}

const DEFAULT_ANATOMY_ATLAS: AnatomyAtlasId = "vanatome-male-reference";

export function VanatomeBodyMap({
  profileName,
  gender,
  onStructureSelect,
  onStagingChange,
  isDentalOpen,
  onDentalOpenChange,
  onToothSelectRef,
}: {
  profileName: string;
  gender?: "male" | "female" | null;
  risks?: RegionRisk[];
  risksAt?: string;
  onStructureSelect?: (structure: SelectedStructure | undefined) => void;
  onStagingChange?: (items: StagingItem[]) => void;
  isDentalOpen?: boolean;
  onDentalOpenChange?: (open: boolean) => void;
  onToothSelectRef?: React.MutableRefObject<((toothCode: number, toothName: string, shouldSelect?: boolean) => void) | undefined>;
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
  useEffect(() => {
    if (onToothSelectRef) {
      onToothSelectRef.current = (code, name, shouldSelect) => {
        selectToothRef.current(code, name, shouldSelect);
      };
    }
  }, [onToothSelectRef]);

  // 치아선택기를 켜면 빠른 확대의 '머리' 버튼 선택 (머리 뷰로 카메라 워크)
  useEffect(() => {
    if (isDentalOpen) {
      setActiveFocus("head");
      focusCameraRef.current("head");
    }
  }, [isDentalOpen]);

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
  const selectedDentalFdis = useMemo(() => {
    const set = new Set<number>();
    for (const item of stagedItems) {
      if (item.id.startsWith("dental-fdi-")) {
        const num = Number(item.id.replace("dental-fdi-", ""));
        if (!isNaN(num)) set.add(num);
      }
    }
    return set;
  }, [stagedItems]);
  const [isStagedPanelDismissed, setIsStagedPanelDismissed] = useState(false);
  const [hoveredInfo, setHoveredInfo] = useState<AnatomyDisplayInfo | null>(null);
  const toggleExcludeStagedRef = useRef<(id: string) => void>(() => undefined);
  const [draftPaintedItems, setDraftPaintedItems] = useState<StagingItem[]>([]);
  const confirmDraftPaintedRef = useRef<() => void>(() => undefined);
  const toggleExcludeDraftPaintedRef = useRef<(id: string) => void>(() => undefined);
  const setAllDraftExcludedRef = useRef<(excluded: boolean) => void>(() => undefined);
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

  // 정밀 해부학 UX 상태 (48번 지침)
  const [isDentalModalOpen, setIsDentalModalOpen] = useState(false);
  const [isSearchDrawerOpen, setIsSearchDrawerOpen] = useState(false);
  const [isXRayActive, setIsXRayActive] = useState(false);
  const [isIsolateActive, setIsIsolateActive] = useState(false);
  const [depthCandidates, setDepthCandidates] = useState<DepthHitCandidate[]>([]);
  const [isFasciaHidden, setIsFasciaHidden] = useState(false);
  const [isPeritoneumHidden, setIsPeritoneumHidden] = useState(false);
  const setFasciaHiddenRef = useRef<(hidden: boolean) => void>(() => undefined);
  const setPeritoneumHiddenRef = useRef<(hidden: boolean) => void>(() => undefined);

  const toggleFasciaHidden = () => {
    setIsFasciaHidden((prev) => {
      const next = !prev;
      setFasciaHiddenRef.current(next);
      return next;
    });
  };

  const togglePeritoneumHidden = () => {
    setIsPeritoneumHidden((prev) => {
      const next = !prev;
      setPeritoneumHiddenRef.current(next);
      return next;
    });
  };

  const toggleXRayRef = useRef<(active: boolean) => void>(() => undefined);
  const toggleIsolateRef = useRef<(active: boolean) => void>(() => undefined);
  const focusSelectedMeshRef = useRef<() => void>(() => undefined);
  const selectCandidateMeshRef = useRef<(candidate: DepthHitCandidate) => void>(() => undefined);
  const selectByAnatomyIdRef = useRef<(anatomyId: string) => boolean>(() => false);
  const selectToothRef = useRef<(toothCode: number, toothName: string, shouldSelect?: boolean) => void>(() => undefined);
  const removeStagedItemRef = useRef<(id: string) => void>(() => undefined);
  const clearAllStagedItemsRef = useRef<() => void>(() => undefined);
  const undoDeleteRef = useRef<() => void>(() => undefined);
  const redoDeleteRef = useRef<() => void>(() => undefined);
  const toggleMultipleDraftExcludedRef = useRef<(ids: string[]) => void>(() => undefined);
  const toggleMultipleCandidateDepthRef = useRef<(meshNames: string[]) => void>(() => undefined);
  const [selectedDepthCandidateIds, setSelectedDepthCandidateIds] = useState<Set<string>>(() => new Set());
  const toggleCandidateDepthRef = useRef<(meshName: string) => void>(() => undefined);
  const setAllDepthCandidatesSelectedRef = useRef<(selected: boolean) => void>(() => undefined);
  const confirmDepthCandidatesRef = useRef<() => void>(() => undefined);
  const clearDepthCandidatesRef = useRef<() => void>(() => undefined);
  const eraseDepthSelectionRef = useRef<() => void>(() => undefined);
  const hoverMeshByNameRef = useRef<(target: THREE.Mesh | string | null) => void>(() => undefined);
  const [recentlyAddedStagedId, setRecentlyAddedStagedId] = useState<string | null>(null);
  const stagingListRef = useRef<HTMLDivElement>(null);
  const [canUndoDelete, setCanUndoDelete] = useState(false);
  const [canRedoDelete, setCanRedoDelete] = useState(false);

  // 마우스 드래그 마키(범위성 멀티플 선택) 상태
  const [marqueeBox, setMarqueeBox] = useState<{
    startX: number;
    startY: number;
    currentX: number;
    currentY: number;
  } | null>(null);
  const [marqueeSelectedIds, setMarqueeSelectedIds] = useState<ReadonlySet<string>>(() => new Set());
  const draftListContainerRef = useRef<HTMLDivElement>(null);
  const isMarqueeDraggingRef = useRef(false);
  const wasMarqueeDraggingRef = useRef(false);
  const marqueeStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const currentHitIdsRef = useRef<Set<string>>(new Set());

  const depthListContainerRef = useRef<HTMLDivElement>(null);
  const isDepthMarqueeDraggingRef = useRef(false);
  const wasDepthMarqueeDraggingRef = useRef(false);
  const depthMarqueeStartPosRef = useRef<{ x: number; y: number } | null>(null);
  const currentDepthHitIdsRef = useRef<Set<string>>(new Set());

  const handleDraftListPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    marqueeStartPosRef.current = { x: e.clientX, y: e.clientY };
    isMarqueeDraggingRef.current = false;
    wasMarqueeDraggingRef.current = false;
    currentHitIdsRef.current.clear();

    const handlePointerMove = (ev: PointerEvent) => {
      if (!marqueeStartPosRef.current) return;
      const dx = Math.abs(ev.clientX - marqueeStartPosRef.current.x);
      const dy = Math.abs(ev.clientY - marqueeStartPosRef.current.y);
      if (!isMarqueeDraggingRef.current && (dx > 4 || dy > 4)) {
        isMarqueeDraggingRef.current = true;
        wasMarqueeDraggingRef.current = true;
      }
      if (isMarqueeDraggingRef.current) {
        setMarqueeBox({
          startX: marqueeStartPosRef.current.x,
          startY: marqueeStartPosRef.current.y,
          currentX: ev.clientX,
          currentY: ev.clientY,
        });
        const boxLeft = Math.min(marqueeStartPosRef.current.x, ev.clientX);
        const boxTop = Math.min(marqueeStartPosRef.current.y, ev.clientY);
        const boxRight = Math.max(marqueeStartPosRef.current.x, ev.clientX);
        const boxBottom = Math.max(marqueeStartPosRef.current.y, ev.clientY);

        const rows = draftListContainerRef.current?.querySelectorAll<HTMLElement>(".paint-candidate-row");
        const hitIds = new Set<string>();
        rows?.forEach((row) => {
          const rect = row.getBoundingClientRect();
          const intersects = !(rect.right < boxLeft || rect.left > boxRight || rect.bottom < boxTop || rect.top > boxBottom);
          const id = row.getAttribute("data-item-id");
          if (intersects && id) {
            hitIds.add(id);
          }
        });
        currentHitIdsRef.current = hitIds;
        setMarqueeSelectedIds(new Set(hitIds));
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (isMarqueeDraggingRef.current) {
        const hitIdsList = Array.from(currentHitIdsRef.current);
        if (hitIdsList.length > 0) {
          toggleMultipleDraftExcludedRef.current(hitIdsList);
        }
        setTimeout(() => {
          wasMarqueeDraggingRef.current = false;
        }, 80);
      }
      isMarqueeDraggingRef.current = false;
      setMarqueeBox(null);
      setMarqueeSelectedIds(new Set());
      currentHitIdsRef.current.clear();
      marqueeStartPosRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  const handleDepthListPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button")) return;
    depthMarqueeStartPosRef.current = { x: e.clientX, y: e.clientY };
    isDepthMarqueeDraggingRef.current = false;
    wasDepthMarqueeDraggingRef.current = false;
    currentDepthHitIdsRef.current.clear();

    const handlePointerMove = (ev: PointerEvent) => {
      if (!depthMarqueeStartPosRef.current) return;
      const dx = Math.abs(ev.clientX - depthMarqueeStartPosRef.current.x);
      const dy = Math.abs(ev.clientY - depthMarqueeStartPosRef.current.y);
      if (!isDepthMarqueeDraggingRef.current && (dx > 4 || dy > 4)) {
        isDepthMarqueeDraggingRef.current = true;
        wasDepthMarqueeDraggingRef.current = true;
      }
      if (isDepthMarqueeDraggingRef.current) {
        setMarqueeBox({
          startX: depthMarqueeStartPosRef.current.x,
          startY: depthMarqueeStartPosRef.current.y,
          currentX: ev.clientX,
          currentY: ev.clientY,
        });
        const boxLeft = Math.min(depthMarqueeStartPosRef.current.x, ev.clientX);
        const boxTop = Math.min(depthMarqueeStartPosRef.current.y, ev.clientY);
        const boxRight = Math.max(depthMarqueeStartPosRef.current.x, ev.clientX);
        const boxBottom = Math.max(depthMarqueeStartPosRef.current.y, ev.clientY);

        const rows = depthListContainerRef.current?.querySelectorAll<HTMLElement>(".depth-candidate-row");
        const hitIds = new Set<string>();
        rows?.forEach((row) => {
          const rect = row.getBoundingClientRect();
          const intersects = !(rect.right < boxLeft || rect.left > boxRight || rect.bottom < boxTop || rect.top > boxBottom);
          const id = row.getAttribute("data-item-id");
          if (intersects && id) {
            hitIds.add(id);
          }
        });
        currentDepthHitIdsRef.current = hitIds;
        setMarqueeSelectedIds(new Set(hitIds));
      }
    };

    const handlePointerUp = () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
      if (isDepthMarqueeDraggingRef.current) {
        const hitIdsList = Array.from(currentDepthHitIdsRef.current);
        if (hitIdsList.length > 0) {
          toggleMultipleCandidateDepthRef.current(hitIdsList);
        }
        setTimeout(() => {
          wasDepthMarqueeDraggingRef.current = false;
        }, 80);
      }
      isDepthMarqueeDraggingRef.current = false;
      setMarqueeBox(null);
      setMarqueeSelectedIds(new Set());
      currentDepthHitIdsRef.current.clear();
      depthMarqueeStartPosRef.current = null;
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
  };

  useEffect(() => {
    if (!recentlyAddedStagedId || !stagingListRef.current) return;
    const el = stagingListRef.current.querySelector<HTMLElement>(`[data-staged-id="${recentlyAddedStagedId}"]`);
    if (el) {
      el.scrollIntoView({ block: "nearest", behavior: "smooth" });
    }
  }, [recentlyAddedStagedId, stagedItems]);

  useEffect(() => {
    if (interactionMode === "paint" || depthCandidates.length === 0) {
      setRecentlyAddedStagedId(null);
    }
  }, [interactionMode, depthCandidates.length]);

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
    setDepthCandidates([]);
    setIsXRayActive(false);
    setIsIsolateActive(false);
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
          onHiddenSystemsChange: setHiddenSystems,
          clearSelectionRef,
          focusCameraRef,
          pelvicOrganFocusRef,
          setHiddenSystemsRef,
          setFasciaHiddenRef,
          setPeritoneumHiddenRef,
          playHandPoseRef,
          setInteractionModeRef,
          undoPaintRef,
          clearPaintRef,
          onStagingChange: (items) => {
            setStagedItems(items);
            onStagingChangeRef.current?.(items);
            if (items.length > 0) {
              setIsStagedPanelDismissed(false);
            }
          },
          onDraftPaintedChange: (items) => {
            setDraftPaintedItems(items);
            if (items.length > 0) {
              setIsStagedPanelDismissed(false);
            }
          },
          confirmDraftPaintedRef,
          toggleExcludeDraftRef: toggleExcludeDraftPaintedRef,
          setAllDraftExcludedRef,
          onHoverStructure: setHoveredInfo,
          toggleExcludeRef: toggleExcludeStagedRef,
          onDepthCandidatesChange: setDepthCandidates,
          toggleXRayRef,
          toggleIsolateRef,
          focusSelectedMeshRef,
          selectCandidateMeshRef,
          selectByAnatomyIdRef,
          selectToothRef,
          removeStagedItemRef,
          clearAllStagedItemsRef,
          undoDeleteRef,
          redoDeleteRef,
          toggleMultipleDraftExcludedRef,
          toggleMultipleCandidateDepthRef,
          toggleCandidateDepthRef,
          setAllDepthCandidatesSelectedRef,
          confirmDepthCandidatesRef,
          clearDepthCandidatesRef,
          eraseDepthSelectionRef,
          hoverMeshByNameRef,
          setSelectedDepthCandidateIds,
          onRecentlyAddedStaged: (id) => {
            setRecentlyAddedStagedId(id);
          },
          onHistoryChange: ({ canUndo, canRedo }) => {
            setCanUndoDelete(canUndo);
            setCanRedoDelete(canRedo);
          },
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
      setFasciaHiddenRef.current = () => undefined;
      playHandPoseRef.current = () => undefined;
      removeStagedItemRef.current = () => undefined;
      clearAllStagedItemsRef.current = () => undefined;
      undoDeleteRef.current = () => undefined;
      redoDeleteRef.current = () => undefined;
      toggleMultipleDraftExcludedRef.current = () => undefined;
      toggleMultipleCandidateDepthRef.current = () => undefined;
      toggleCandidateDepthRef.current = () => undefined;
      setAllDepthCandidatesSelectedRef.current = () => undefined;
      confirmDepthCandidatesRef.current = () => undefined;
      clearDepthCandidatesRef.current = () => undefined;
      eraseDepthSelectionRef.current = () => undefined;
      setInteractionModeRef.current = () => undefined;
      undoPaintRef.current = () => undefined;
      clearPaintRef.current = () => undefined;
      toggleXRayRef.current = () => undefined;
      toggleIsolateRef.current = () => undefined;
      focusSelectedMeshRef.current = () => undefined;
      selectCandidateMeshRef.current = () => undefined;
      selectByAnatomyIdRef.current = () => false;
      selectToothRef.current = () => undefined;
      if (onToothSelectRef) onToothSelectRef.current = undefined;
    };
  }, [atlasId, isTestEnvironment, onToothSelectRef, sceneAttempt]);

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
                const next = isIsolateActive
                  ? new Set(["integumentary"])
                  : new Set<string>();
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
              const isDisabled =
                loadProgress < 100 ||
                !readySystems.has(layer.id) ||
                (isIsolateActive && layer.id === "integumentary");
              return (
                <button
                  key={layer.id}
                  type="button"
                  disabled={isDisabled}
                  aria-pressed={active}
                  title={
                    isIsolateActive && layer.id === "integumentary"
                      ? "투시모드에서는 외피계를 선택할 수 없습니다"
                      : undefined
                  }
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
              setIsStagedPanelDismissed(false);
              setRecentlyAddedStagedId(null);
            }}
          >
            통증 범위 칠하기
          </button>
        </div>
        <div className="vanatome-precision-toolbar" role="toolbar" aria-label="정밀 해부학 도구" style={{ display: "flex", flexWrap: "wrap", gap: "6px", margin: "0 0 10px" }}>
          <button
            type="button"
            className="toolbar-btn"
            disabled={loadProgress < 100}
            onClick={() => setIsSearchDrawerOpen(true)}
          >
            부위 검색
          </button>
          <button
            type="button"
            className="toolbar-btn"
            disabled={loadProgress < 100 || !selectedStructure}
            onClick={() => focusSelectedMeshRef.current()}
          >
            부위 줌인
          </button>
          <button
            type="button"
            className={`toolbar-btn ${isXRayActive ? "is-active" : ""}`}
            disabled={loadProgress < 100}
            aria-pressed={isXRayActive}
            onClick={() => {
              const next = !isXRayActive;
              setIsXRayActive(next);
              if (next && isIsolateActive) {
                setIsIsolateActive(false);
              }
              toggleXRayRef.current(next);
            }}
          >
            X-ray 모드
          </button>
          <button
            type="button"
            className={`toolbar-btn ${isIsolateActive ? "is-active" : ""}`}
            disabled={loadProgress < 100}
            aria-pressed={isIsolateActive}
            onClick={() => {
              const next = !isIsolateActive;
              setIsIsolateActive(next);
              if (next && isXRayActive) {
                setIsXRayActive(false);
              }
              if (next) {
                setHiddenSystems((current) => {
                  const updated = new Set(current);
                  updated.add("integumentary");
                  updated.delete("skeletal");
                  updated.delete("muscular");
                  setHiddenSystemsRef.current(updated);
                  return updated;
                });
              }
              toggleIsolateRef.current(next);
            }}
          >
            투시모드
          </button>
        </div>
        <div className="vanatome-actions" style={{ display: "flex", gap: "6px" }}>
          <button
            type="button"
            style={{ flex: 1, padding: "5px 8px", fontSize: "0.8rem" }}
            disabled={!canUndoDelete}
            onClick={() => undoDeleteRef.current()}
            title="작업 되돌리기 (확정/삭제 Undo)"
          >
            되돌리기(Undo)
          </button>
          <button
            type="button"
            style={{ flex: 1, padding: "5px 8px", fontSize: "0.8rem" }}
            disabled={!canRedoDelete}
            onClick={() => redoDeleteRef.current()}
            title="작업 다시 진행 (확정/삭제 Redo)"
          >
            다시진행(Redo)
          </button>
        </div>
        <div
          className="vanatome-staging-panel"
          style={{
            margin: "12px 0 0 0",
            padding: "12px",
            background: "rgba(248, 250, 252, 0.95)",
            borderRadius: "12px",
            border: "1px solid #e2e8f0",
            height: "340px",
            maxHeight: "340px",
            boxSizing: "border-box",
            display: "flex",
            flexDirection: "column",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px", flexShrink: 0 }}>
            <span style={{ fontSize: "0.82rem", fontWeight: 700, color: "#1e293b" }}>
              확정 부위 ({stagedItems.length}개)
            </span>
            {stagedItems.length > 0 && (
              <button
                type="button"
                className="vanatome-stage-clear-btn"
                style={{
                  padding: "2px 8px",
                  fontSize: "0.72rem",
                  borderRadius: "4px",
                  border: "1px solid #f43f5e",
                  color: "#be123c",
                  background: "#fff1f2",
                  cursor: "pointer",
                  whiteSpace: "nowrap",
                  fontWeight: 600,
                  transition: "background-color 0.15s ease, border-color 0.15s ease",
                }}
                onClick={() => clearAllStagedItemsRef.current()}
                title="확정 부위 전체 일괄 삭제"
                aria-label="확정 부위 일괄 삭제"
              >
                일괄 삭제
              </button>
            )}
          </div>
          {stagedItems.length > 0 ? (
            <div
              ref={stagingListRef}
              style={{ display: "flex", flexDirection: "column", gap: "6px", flex: 1, minHeight: 0, overflowY: "auto" }}
            >
              {stagedItems.map((item) => {
                const isRecentlyAdded = recentlyAddedStagedId === item.id;
                return (
                  <div
                    key={item.id}
                    data-staged-id={item.id}
                    className={`staged-item-row ${isRecentlyAdded ? "is-recently-added" : ""}`}
                    onMouseEnter={() => hoverMeshByNameRef.current(item.mesh || item.id)}
                    onMouseLeave={() => hoverMeshByNameRef.current(null)}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "6px",
                      background: isRecentlyAdded ? "#fff1f2" : "#ffffff",
                      border: isRecentlyAdded ? "1.5px solid #f43f5e" : "1px solid var(--line, #e2e8f0)",
                      boxShadow: isRecentlyAdded ? "0 0 0 2px rgba(244, 63, 94, 0.28)" : undefined,
                      display: "flex",
                      justifyContent: "space-between",
                      alignItems: "center",
                      gap: "6px",
                      flexShrink: 0,
                      transition: "all 0.2s ease",
                    }}
                  >
                    <div style={{ flex: 1, minWidth: 0 }}>

                      <div
                        style={{
                          fontSize: "0.8rem",
                          fontWeight: 600,
                          color: isRecentlyAdded ? "#9f1239" : "var(--ink, #0f172a)",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                        title={`${item.info.koreanName} (${item.info.canonicalName})`}
                      >
                        {item.info.koreanName}
                        <span style={{ fontWeight: 400, fontSize: "0.74rem", color: "#64748b", marginLeft: "4px" }}>
                          ({item.info.canonicalName})
                        </span>
                      </div>
                      <div
                        style={{ fontSize: "0.7rem", color: "#64748b", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}
                        title={item.info.description}
                      >
                        <span style={{ color: isRecentlyAdded ? "#be123c" : "#64748b", fontWeight: 500 }}>[{item.info.systemKorean}]</span> {item.info.description}
                      </div>
                    </div>
                    <button
                      type="button"
                      className="vanatome-stage-remove-btn"
                      style={{
                        padding: "2px 7px",
                        fontSize: "0.72rem",
                        borderRadius: "4px",
                        border: isRecentlyAdded ? "1px solid #f43f5e" : "1px solid var(--line, #cbd5e1)",
                        color: isRecentlyAdded ? "#be123c" : "#64748b",
                        background: isRecentlyAdded ? "#fff1f2" : "#f8fafc",
                        cursor: "pointer",
                        whiteSpace: "nowrap",
                        flexShrink: 0,
                      }}
                      onClick={() => removeStagedItemRef.current(item.id)}
                      title={`${item.info.koreanName} 삭제`}
                      aria-label={`${item.info.koreanName} 삭제`}
                    >
                      삭제
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div
              style={{
                flex: 1,
                display: "flex",
                flexDirection: "column",
                alignItems: "center",
                justifyContent: "center",
                color: "#64748b",
                fontSize: "0.76rem",
                textAlign: "center",
                padding: "16px 12px",
                background: "#f8fafc",
                borderRadius: "8px",
                border: "1px dashed #cbd5e1",
                boxSizing: "border-box",
                gap: "6px",
              }}
            >
              <span style={{ fontWeight: 600, color: "#475569", fontSize: "0.82rem" }}>
                확정된 부위가 없습니다
              </span>
              <p style={{ margin: 0, color: "#94a3b8", lineHeight: 1.4, maxWidth: "220px" }}>
                인체 모델에서 부위를 클릭하거나 스프레이로 칠한 뒤 확정할 수 있습니다.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="vanatome-stage-column">
        <div className="body-map-viewer vanatome-viewer is-hologram">
          <canvas ref={canvasRef} aria-label="회전 가능한 해부학 인체 모니터" />
          {(!hiddenSystems.has("muscular") || !hiddenSystems.has("digestive")) ? (
            <span
              role="toolbar"
              aria-label="계통별 세부 구조 표시 제어"
              className={`body-map-hint is-actionable ${isFasciaHidden || isPeritoneumHidden ? "is-active" : ""}`}
              onClick={() => {
                const hasMuscular = !hiddenSystems.has("muscular");
                const hasDigestive = !hiddenSystems.has("digestive");
                if (hasMuscular && !hasDigestive) {
                  toggleFasciaHidden();
                } else if (!hasMuscular && hasDigestive) {
                  togglePeritoneumHidden();
                }
              }}
            >
              {!hiddenSystems.has("muscular") ? (
                <button
                  type="button"
                  className={`body-map-hint-action-badge ${isFasciaHidden ? "is-active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleFasciaHidden();
                  }}
                  aria-pressed={isFasciaHidden}
                  title={
                    isFasciaHidden
                      ? "근막을 다시 표시합니다 (클릭하여 전환)"
                      : "표면의 근막을 숨겨 내부 인체 구조를 쉽게 선택합니다 (클릭하여 전환)"
                  }
                >
                  {isFasciaHidden ? "근막 보이기" : "근막 안보이기"}
                </button>
              ) : null}
              {!hiddenSystems.has("digestive") ? (
                <button
                  type="button"
                  className={`body-map-hint-action-badge is-peritoneum-badge ${isPeritoneumHidden ? "is-active" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    togglePeritoneumHidden();
                  }}
                  aria-pressed={isPeritoneumHidden}
                  title={
                    isPeritoneumHidden
                      ? "복막(대망·소망 등)을 다시 표시합니다 (클릭하여 전환)"
                      : "복막(대망·소망 등)을 숨겨 내부 소화기(위·장)를 쉽게 선택합니다 (클릭하여 전환)"
                  }
                >
                  {isPeritoneumHidden ? "복막 보이기" : "복막 안보이기"}
                </button>
              ) : null}
              <span className="body-map-hint-text">
                {isPeritoneumHidden && isFasciaHidden
                  ? "근막·복막 숨김 모드 · 심부 장기 및 근육 선택 가능 · 외곽선 회전"
                  : isPeritoneumHidden
                    ? "복막 숨김 모드 · 내부 소화기(위·장) 선택 가능 · 외곽선 회전"
                    : isFasciaHidden
                      ? "근막 숨김 모드 · 심부 부위 선택 가능 · 외곽선 드래그 회전"
                      : (interactionMode === "paint"
                          ? "인체 위 드래그로 스프레이 분사 · 외곽선 회전 · 배경 이동"
                          : "인체 클릭으로 부위 선택 · 외곽선 드래그로 회전 · 배경 드래그로 상하 이동")}
              </span>
            </span>
          ) : (
            <span className="body-map-hint">
              {interactionMode === "paint"
                ? "인체 위 드래그로 스프레이 분사 · 외곽선 드래그로 회전 · 배경 드래그로 상하 이동"
                : "인체 클릭으로 부위 선택 · 외곽선 드래그로 회전 · 배경 드래그로 상하 이동"}
            </span>
          )}

          {isDentalModalOpen && !onDentalOpenChange ? (
            <DentalPickerModal
              isOpen={isDentalModalOpen}
              selectedFdis={selectedDentalFdis}
              onClose={() => setIsDentalModalOpen(false)}
              onSelectTooth={(tooth, shouldSelect) => {
                selectToothRef.current(tooth.fdiNumber, tooth.koreanName, shouldSelect);
              }}
            />
          ) : null}

          {isSearchDrawerOpen ? (
            <AnatomySearchDrawer
              isOpen={isSearchDrawerOpen}
              onClose={() => setIsSearchDrawerOpen(false)}
              onSelectAnatomy={(item) => {
                selectByAnatomyIdRef.current(item.id);
                setIsSearchDrawerOpen(false);
              }}
            />
          ) : null}
        </div>

        <div className="vanatome-bottom-panel" role="region" aria-label="해부학 구조 세부 정보">
          {interactionMode === "inspect" ? (
            depthCandidates.length > 0 ? (
              <div className="bottom-panel-content is-depth">
                <div className="depth-panel-header">
                  <div className="depth-panel-title">
                    <strong>
                      관통된 깊이별 구조 ({selectedDepthCandidateIds.size}/{depthCandidates.length}개 선택)
                    </strong>
                    <span className="depth-panel-desc">
                      담을 부위를 선택하고 &lt; 버튼을 눌러 확정 부위로 넘기세요.
                    </span>
                  </div>
                  <div className="bottom-panel-actions">
                    <button
                      type="button"
                      className="panel-action-btn is-shortcut is-confirm"
                      onClick={() => confirmDepthCandidatesRef.current()}
                      title="확정 부위로 담기 (<)"
                      aria-label="확정 부위로 담기"
                      disabled={selectedDepthCandidateIds.size === 0}
                    >
                      &lt;
                    </button>
                    <button
                      type="button"
                      className="panel-action-btn is-shortcut"
                      onClick={() => setAllDepthCandidatesSelectedRef.current(true)}
                      title="전체 선택 (All)"
                      aria-label="전체 선택"
                    >
                      A
                    </button>
                    <button
                      type="button"
                      className="panel-action-btn is-shortcut is-danger"
                      onClick={() => setAllDepthCandidatesSelectedRef.current(false)}
                      title="전체 해제 (None)"
                      aria-label="전체 해제"
                    >
                      N
                    </button>
                    <button
                      type="button"
                      className="panel-action-btn is-shortcut is-clear"
                      onClick={() => eraseDepthSelectionRef.current()}
                      title="선택 부위 및 후보 지우기 (Erase)"
                      aria-label="선택 부위 및 후보 지우기"
                    >
                      E
                    </button>
                    <button
                      type="button"
                      className="panel-action-btn is-shortcut"
                      onClick={() => clearDepthCandidatesRef.current()}
                      title="닫기 (Close)"
                      aria-label="깊이 패널 닫기"
                    >
                      X
                    </button>
                  </div>
                </div>
                <div
                  ref={depthListContainerRef}
                  className="depth-candidates-list"
                  onPointerDown={handleDepthListPointerDown}
                  style={{ position: "relative", userSelect: "none" }}
                >
                  {depthCandidates.map((candidate) => {
                    const depthBadgeClass =
                      candidate.depthLevel === "surface"
                        ? "is-surface"
                        : candidate.depthLevel === "shallow"
                        ? "is-shallow"
                        : candidate.depthLevel === "mid"
                        ? "is-mid"
                        : "is-deep";
                    const depthLabel =
                      candidate.depthLevel === "surface"
                        ? "표층"
                        : candidate.depthLevel === "shallow"
                        ? "천층"
                        : candidate.depthLevel === "mid"
                        ? "중층"
                        : "심층";
                    const isCandidateSelected = selectedDepthCandidateIds.has(candidate.meshName);
                    const isHovered = marqueeSelectedIds.has(candidate.meshName);
                    return (
                      <div
                        key={candidate.mesh.id}
                        data-item-id={candidate.meshName}
                        className={`depth-candidate-row ${isCandidateSelected ? "is-selected" : "is-unselected"} ${
                          isHovered ? "is-marquee-hovered" : ""
                        }`}
                        onMouseEnter={() => hoverMeshByNameRef.current(candidate.mesh || candidate.meshName)}
                        onMouseLeave={() => hoverMeshByNameRef.current(null)}
                        onClick={() => {
                          if (wasDepthMarqueeDraggingRef.current) return;
                          toggleCandidateDepthRef.current(candidate.meshName);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <div className="candidate-left">
                          <span className={`depth-badge ${depthBadgeClass}`}>{depthLabel}</span>
                          <span className="candidate-name">{candidate.label}</span>
                          <span className="candidate-system">[{candidate.systemKorean}]</span>
                        </div>
                        <div className="candidate-right" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                          <small style={{ color: "#94a3b8" }}>
                            {(candidate.distance * 100).toFixed(1)}cm
                          </small>
                          <button
                            type="button"
                            className={`toggle-exclude-btn ${isCandidateSelected ? "is-exclude" : "is-include"}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              toggleCandidateDepthRef.current(candidate.meshName);
                            }}
                          >
                            {isCandidateSelected ? "제외" : "선택"}
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {marqueeBox ? (
                  <div
                    className="marquee-selection-box"
                    style={{
                      left: Math.min(marqueeBox.startX, marqueeBox.currentX),
                      top: Math.min(marqueeBox.startY, marqueeBox.currentY),
                      width: Math.abs(marqueeBox.currentX - marqueeBox.startX),
                      height: Math.abs(marqueeBox.currentY - marqueeBox.startY),
                    }}
                  />
                ) : null}
              </div>
            ) : (
              <div className="bottom-panel-placeholder">
                <div className="placeholder-text">
                  <strong>인체 모델에서 관심 있는 부위를 선택하세요</strong>
                  <p>
                    인체를 클릭하면 관통하는 표층·천층·중층·심층 해부학 구조가 여기에 나열되며,
                    원하는 부위를 선택 후 [&lt;] 버튼을 눌러 확정할 수 있습니다.
                  </p>
                </div>
                <div className="placeholder-tags">
                  <span className="placeholder-tag">다층 구조 관통</span>
                  <span className="placeholder-tag">선택 후 확정 담기</span>
                  <span className="placeholder-tag">단축 제어 (&lt; · A · N · E · X)</span>
                </div>
              </div>
            )
          ) : !isStagedPanelDismissed && draftPaintedItems.length > 0 ? (
            <div className="bottom-panel-content is-paint">
              <div className="depth-panel-header">
                <div className="depth-panel-title">
                  <strong style={{ color: "#fb7185" }}>
                    칠해진 통증 부위 구조 ({draftPaintedItems.filter((i) => !i.excluded).length}/{draftPaintedItems.length}개 활성)
                  </strong>
                </div>
                <div className="bottom-panel-actions">
                  <button
                    type="button"
                    className="panel-action-btn is-shortcut is-confirm"
                    onClick={() => confirmDraftPaintedRef.current()}
                    title="확정 부위로 담기 (<)"
                    aria-label="확정 부위로 담기"
                  >
                    &lt;
                  </button>
                  <button
                    type="button"
                    className="panel-action-btn is-shortcut"
                    onClick={() => setAllDraftExcludedRef.current(false)}
                    title="전체 포함 (All)"
                    aria-label="전체 포함"
                  >
                    A
                  </button>
                  <button
                    type="button"
                    className="panel-action-btn is-shortcut is-danger"
                    onClick={() => setAllDraftExcludedRef.current(true)}
                    title="전체 제외 (None)"
                    aria-label="전체 제외"
                  >
                    N
                  </button>
                  <button
                    type="button"
                    className="panel-action-btn is-shortcut is-clear"
                    onClick={() => clearPaintRef.current()}
                    title="칠하기 지우기 (Erase)"
                    aria-label="칠하기 지우기"
                  >
                    E
                  </button>
                  <button
                    type="button"
                    className="panel-action-btn is-shortcut"
                    onClick={() => setIsStagedPanelDismissed(true)}
                    title="닫기 (Close)"
                    aria-label="구조 목록 닫기"
                  >
                    X
                  </button>
                </div>
              </div>
              <div
                ref={draftListContainerRef}
                className="paint-candidates-list"
                onPointerDown={handleDraftListPointerDown}
                style={{ position: "relative", userSelect: "none" }}
              >
                {draftPaintedItems.map((item) => {
                  const badgeColor = getSystemBadgeColor(item.info.system);
                  const isHovered = marqueeSelectedIds.has(item.id);
                  return (
                    <div
                      key={item.id}
                      data-item-id={item.id}
                      className={`paint-candidate-row ${item.excluded ? "is-excluded" : "is-active"} ${
                        isHovered ? "is-marquee-hovered" : ""
                      }`}
                      onMouseEnter={() => hoverMeshByNameRef.current(item.mesh || item.id)}
                      onMouseLeave={() => hoverMeshByNameRef.current(null)}
                      onClick={() => {
                        if (wasMarqueeDraggingRef.current) return;
                        toggleExcludeDraftPaintedRef.current(item.id);
                      }}
                      style={{ cursor: "pointer" }}
                    >
                      <div className="candidate-left">
                        <span
                          className="system-badge"
                          style={{ borderColor: badgeColor, color: badgeColor }}
                        >
                          {item.info.systemKorean || "기타"}
                        </span>
                        <div
                          className="candidate-text"
                          title={`${item.info.koreanName || item.info.canonicalName || item.id} (${item.info.canonicalName || item.id})`}
                        >
                          <span
                            className="candidate-name"
                            title={item.info.koreanName || item.info.canonicalName || item.id}
                          >
                            {item.info.koreanName || item.info.canonicalName || item.id}
                          </span>
                          <span
                            className="candidate-en-name"
                            title={item.info.canonicalName || item.id}
                          >
                            {item.info.canonicalName || item.id}
                          </span>
                        </div>

                      </div>
                      <button
                        type="button"
                        className={`toggle-exclude-btn ${item.excluded ? "is-include" : "is-exclude"}`}
                        onClick={(e) => {
                          e.stopPropagation();
                          toggleExcludeDraftPaintedRef.current(item.id);
                        }}
                      >
                        {item.excluded ? "다시 포함" : "제외"}
                      </button>
                    </div>
                  );
                })}
              </div>
              {marqueeBox ? (
                <div
                  className="marquee-selection-box"
                  style={{
                    left: Math.min(marqueeBox.startX, marqueeBox.currentX),
                    top: Math.min(marqueeBox.startY, marqueeBox.currentY),
                    width: Math.abs(marqueeBox.currentX - marqueeBox.startX),
                    height: Math.abs(marqueeBox.currentY - marqueeBox.startY),
                  }}
                />
              ) : null}
            </div>
          ) : (
            <div className="bottom-panel-placeholder">
              {isStagedPanelDismissed && draftPaintedItems.length > 0 ? (
                <>
                  <div className="placeholder-text">
                    <strong>구조 목록이 닫혀 있습니다</strong>
                    <p>
                      현재 감지된 해부학 부위 {draftPaintedItems.length}개가 있습니다.
                      새 부위를 지정하거나 아래 버튼을 눌러 목록을 다시 확인하세요.
                    </p>
                  </div>
                  <button
                    type="button"
                    className="panel-action-btn"
                    onClick={() => setIsStagedPanelDismissed(false)}
                    style={{ padding: "5px 14px", fontSize: "0.78rem" }}
                  >
                    구조 목록 다시 열기
                  </button>
                </>
              ) : (
                <>
                  <div className="placeholder-text">
                    <strong>통증 범위를 인체 모델에 드래그하여 칠하세요</strong>
                    <p>
                      스프레이로 지정된 부위가 여기에 임시로 나열되며, [&lt;]를 누르면 왼쪽에 담깁니다.
                    </p>
                  </div>
                  <div className="placeholder-tags">
                    <span className="placeholder-tag">임시 감지 및 확정</span>
                    <span className="placeholder-tag">다층 구조 분리</span>
                    <span className="placeholder-tag">단축 제어 (A · N · E · X)</span>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
      {manifest ? (
        <footer className="vanatome-attribution">
          모델: {manifest.shortLabel} ·{" "}
          <a href={manifest.attributionUrl} target="_blank" rel="noreferrer">
            {manifest.attributionLabel}
          </a>
        </footer>
      ) : null}
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
  onHiddenSystemsChange: (systems: ReadonlySet<string>) => void;
  clearSelectionRef: React.MutableRefObject<() => void>;
  focusCameraRef: React.MutableRefObject<(focus: BodyFocus) => void>;
  pelvicOrganFocusRef: React.MutableRefObject<(active: boolean) => void>;
  setHiddenSystemsRef: React.MutableRefObject<(systems: ReadonlySet<string>) => void>;
  setFasciaHiddenRef: React.MutableRefObject<(hidden: boolean) => void>;
  setPeritoneumHiddenRef: React.MutableRefObject<(hidden: boolean) => void>;
  playHandPoseRef: React.MutableRefObject<(pose: HandPose) => void>;
  setInteractionModeRef: React.MutableRefObject<(mode: "inspect" | "paint") => void>;
  undoPaintRef: React.MutableRefObject<() => void>;
  clearPaintRef: React.MutableRefObject<() => void>;
  onStagingChange: (items: StagingItem[]) => void;
  onDraftPaintedChange: (items: StagingItem[]) => void;
  confirmDraftPaintedRef: React.MutableRefObject<() => void>;
  toggleExcludeDraftRef: React.MutableRefObject<(id: string) => void>;
  setAllDraftExcludedRef: React.MutableRefObject<(excluded: boolean) => void>;
  onHoverStructure: (info: AnatomyDisplayInfo | null) => void;
  toggleExcludeRef: React.MutableRefObject<(id: string) => void>;
  onDepthCandidatesChange: (candidates: DepthHitCandidate[]) => void;
  toggleXRayRef: React.MutableRefObject<(active: boolean) => void>;
  toggleIsolateRef: React.MutableRefObject<(active: boolean) => void>;
  focusSelectedMeshRef: React.MutableRefObject<() => void>;
  selectCandidateMeshRef: React.MutableRefObject<(candidate: DepthHitCandidate) => void>;
  selectByAnatomyIdRef: React.MutableRefObject<(anatomyId: string) => boolean>;
  selectToothRef: React.MutableRefObject<(toothCode: number, toothName: string) => void>;
  removeStagedItemRef: React.MutableRefObject<(id: string) => void>;
  clearAllStagedItemsRef: React.MutableRefObject<() => void>;
  undoDeleteRef: React.MutableRefObject<() => void>;
  redoDeleteRef: React.MutableRefObject<() => void>;
  toggleMultipleDraftExcludedRef: React.MutableRefObject<(ids: string[]) => void>;
  toggleMultipleCandidateDepthRef: React.MutableRefObject<(meshNames: string[]) => void>;
  toggleCandidateDepthRef: React.MutableRefObject<(meshName: string) => void>;
  setAllDepthCandidatesSelectedRef: React.MutableRefObject<(selected: boolean) => void>;
  confirmDepthCandidatesRef: React.MutableRefObject<() => void>;
  clearDepthCandidatesRef: React.MutableRefObject<() => void>;
  eraseDepthSelectionRef: React.MutableRefObject<() => void>;
  hoverMeshByNameRef: React.MutableRefObject<(target: THREE.Mesh | string | null) => void>;
  setSelectedDepthCandidateIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onRecentlyAddedStaged?: (id: string | null) => void;
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
};

async function createAnatomyScene(options: CreateAnatomySceneOptions) {
  const {
    canvas, manifest, signal, isDisposed, onProgress, onReady, onWebGlUnavailable,
    onSelectedStructure, onFocusChange, onSystemsReady, initialHiddenSystems,
    onHiddenSystemsChange,
    clearSelectionRef, focusCameraRef,
    pelvicOrganFocusRef, setHiddenSystemsRef, setFasciaHiddenRef, setPeritoneumHiddenRef,
    playHandPoseRef,
    setInteractionModeRef, undoPaintRef, clearPaintRef,
    onStagingChange, onDraftPaintedChange, confirmDraftPaintedRef, toggleExcludeDraftRef, setAllDraftExcludedRef,
    onHoverStructure, toggleExcludeRef, removeStagedItemRef, clearAllStagedItemsRef,
    undoDeleteRef, redoDeleteRef, toggleMultipleDraftExcludedRef, onHistoryChange,
    onDepthCandidatesChange, toggleXRayRef, toggleIsolateRef,
    focusSelectedMeshRef, selectCandidateMeshRef, selectByAnatomyIdRef, selectToothRef,
    toggleMultipleCandidateDepthRef,
    toggleCandidateDepthRef, setAllDepthCandidatesSelectedRef, confirmDepthCandidatesRef, clearDepthCandidatesRef,
    eraseDepthSelectionRef, hoverMeshByNameRef,
    setSelectedDepthCandidateIds, onRecentlyAddedStaged,
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
  const ghostMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  let activeBodyFocus: BodyFocus = "full";
  let fullBodyReferenceDistance = 5.0;
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
  let isFasciaHidden = false;
  let isPeritoneumHidden = false;
  const applyMeshVisibility = (mesh: THREE.Mesh) => {
    const contextVisible = mesh.userData.contextVisible !== false;
    const sys = String(mesh.userData.structureSystem ?? "");
    const systemVisible = !hiddenSystems.has(sys);

    if (!contextVisible || !systemVisible) {
      mesh.visible = false;
      return;
    }

    if (isFasciaHidden && isFasciaStructure(mesh)) {
      mesh.visible = false;
      return;
    }

    if (isPeritoneumHidden && isPeritoneumStructure(mesh)) {
      mesh.visible = false;
      return;
    }

    mesh.visible = true;
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
      if (typeof restoreMeshMaterial === "function") {
        restoreMeshMaterial(mesh);
      } else {
        const original = originalMaterials.get(mesh);
        if (original) mesh.material = original;
      }
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
  let sprayAgitationState: SprayAgitationState | null = null;

  const stagedItemsMap = new Map<string, StagingItem>();
  const draftPaintedMap = new Map<string, StagingItem>();

  const emitDraftPaintedSummary = () => {
    const items = Array.from(draftPaintedMap.values());
    onDraftPaintedChange(items);
  };

  const ensureDraftPaintedItem = (mesh: THREE.Mesh): StagingItem => {
    const id = mesh.name;
    let item = draftPaintedMap.get(id);
    if (!item) {
      const info = resolveAnatomyDisplayInfo(mesh.name, String(mesh.userData.structureSystem ?? ""));
      item = {
        id,
        mesh,
        info,
        excluded: false,
      };
      draftPaintedMap.set(id, item);
    }
    return item;
  };

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

  const recordPaintSample = (hit: THREE.Intersection, agitation = 0) => {
    if (!(hit.object instanceof THREE.Mesh) || !currentStroke) return;
    const mesh = hit.object;
    if (isFasciaHidden && isFasciaStructure(mesh)) {
      return;
    }
    if (isPeritoneumHidden && isPeritoneumStructure(mesh)) {
      return;
    }

    // 카메라 시선 벡터 및 메쉬의 월드 좌표계 실제 표면 법선(Normal) 산출
    const viewDir = camera.position.clone().sub(hit.point).normalize();
    const normal = hit.face
      ? hit.face.normal.clone().transformDirection(mesh.matrixWorld).normalize()
      : (hit.normal ? hit.normal.clone().normalize() : viewDir.clone());

    // 카메라를 등진 뒷면(Back-facing) 삼각형에 닿은 경우(신체 틈새를 뚫고 반대편 내벽에 닿은 경우) 분사 차단
    if (normal.dot(viewDir) < -0.05) {
      return;
    }

    const up = Math.abs(normal.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const tangent1 = new THREE.Vector3().crossVectors(normal, up).normalize();
    const tangent2 = new THREE.Vector3().crossVectors(normal, tangent1).normalize();

    // 카메라 거리/줌 배율 및 커서 흔들림 강도(agitation)에 적응적인 분사 반경 및 입자 크기 산출:
    // - 머리/얼굴 등 확대 시에는 섬세한 분사를 위해 반경과 알갱이 크기가 줌 비율에 반비례 이상으로 축소
    // - 커서를 흔들며 칠하는 정도에 따라 흩뿌려짐 반경과 알갱이가 점차 스무스하게 확대 (균형잡힌 황금 밸런스 배율 적용)
    const cameraDistance = camera.position.distanceTo(hit.point);
    const {
      sprayRadius,
      particleMinScale,
      particleMaxScale,
      particleCount,
    } = calculateAdaptiveSprayMetrics({
      cameraDistance,
      referenceDistance: fullBodyReferenceDistance,
      agitation,
    });

    const markers: THREE.Object3D[] = [];

    // 가우시안 흩뿌림으로 에어로졸 스프레이 입자 분사
    for (let i = 0; i < particleCount; i++) {
      const u = Math.random();
      const r = sprayRadius * Math.pow(u, 0.65);
      const angle = Math.random() * Math.PI * 2;
      const x = Math.cos(angle) * r;
      const y = Math.sin(angle) * r;
      const particlePos = hit.point.clone()
        .addScaledVector(tangent1, x)
        .addScaledVector(tangent2, y)
        .addScaledVector(normal, 0.002 + Math.random() * 0.003);

      const marker = new THREE.Mesh(sprayParticleGeo, sprayParticleMat);
      const particleScale = particleMinScale + Math.random() * (particleMaxScale - particleMinScale);
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

    // 칠했을 때는 임시 맵(draftPaintedMap)에만 담고, 확정 전까지는 stagedItemsMap에 담지 않음
    ensureDraftPaintedItem(mesh);

    // 스프레이 반경 내 인접 가시 메쉬도 임시 감지
    const hitCameraDist = camera.position.distanceTo(hit.point);
    for (const other of selectableMeshes) {
      if (
        other !== mesh &&
        other.visible &&
        (!isFasciaHidden || !isFasciaStructure(other)) &&
        (!isPeritoneumHidden || !isPeritoneumStructure(other))
      ) {
        const box = new THREE.Box3().setFromObject(other);
        if (box.distanceToPoint(hit.point) < sprayRadius * 0.75) {
          // 신체 반대편 깊이 관통 오선택 방지: hit point보다 8cm 이상 떨어져 있으면 차단
          const otherCenter = box.getCenter(new THREE.Vector3());
          const depthDiff = Math.abs(camera.position.distanceTo(otherCenter) - hitCameraDist);
          if (depthDiff > 0.08) continue;

          ensureDraftPaintedItem(other);
          if (!currentStroke.touchedMeshes.includes(other)) {
            currentStroke.touchedMeshes.push(other);
          }
        }
      }
    }

    if (!currentStroke.touchedMeshes.includes(mesh)) {
      currentStroke.touchedMeshes.push(mesh);
    }
    emitDraftPaintedSummary();
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

  setInteractionModeRef.current = (mode) => {
    interactionMode = mode;
    if (mode === "paint") {
      if (currentDepthCandidates.length > 0) {
        clearCandidatePreviewMaterials();
        currentDepthCandidates = [];
        selectedDepthCandidateNames.clear();
        currentDepthAnchorMeshName = null;
        setSelectedDepthCandidateIds(new Set());
        onDepthCandidatesChange([]);
      }
      onRecentlyAddedStaged?.(null);
      if (hoveredMesh && !isMeshSelected(hoveredMesh)) {
        restoreMeshMaterial(hoveredMesh);
        hoveredMesh = undefined;
      }
      onHoverStructure(null);
      renderScene();
    }
    canvas.style.cursor = mode === "paint" ? "crosshair" : "";
  };

  type HistoryAction =
    | {
        type: "confirm_transfer";
        transferredItems: StagingItem[];
        draftSnapshot: StagingItem[];
      }
    | {
        type: "delete_item";
        item: StagingItem;
      }
    | {
        type: "clear_all_staged";
        items: StagingItem[];
      }
    | {
        type: "confirm_depth";
        transferredItems: StagingItem[];
        candidatesSnapshot: DepthHitCandidate[];
        selectedIdsSnapshot: Set<string>;
      };

  const undoHistory: HistoryAction[] = [];
  const redoHistory: HistoryAction[] = [];

  const updateHistoryState = () => {
    onHistoryChange?.({
      canUndo: undoHistory.length > 0,
      canRedo: redoHistory.length > 0,
    });
  };

  confirmDraftPaintedRef.current = () => {
    const draftSnapshot: StagingItem[] = [];
    const transferredItems: StagingItem[] = [];

    draftPaintedMap.forEach((draft) => {
      draftSnapshot.push({ ...draft });
      if (!draft.excluded) {
        const itemCopy = { ...draft };
        stagedItemsMap.set(draft.id, itemCopy);
        selectedMeshes.add(draft.mesh);
        transferredItems.push(itemCopy);
      }
    });

    if (draftSnapshot.length > 0) {
      undoHistory.push({
        type: "confirm_transfer",
        transferredItems,
        draftSnapshot,
      });
      redoHistory.length = 0;
      updateHistoryState();
    }

    draftPaintedMap.clear();
    emitDraftPaintedSummary();
    if (transferredItems.length > 0) {
      if (isIsolateMode) {
        applyIsolateShading(anatomyMeshes, selectedMeshes, {
          originalMaterials,
          ghostMaterialsMap,
          isSurfaceMesh: isSurfaceStructure,
          createSelectedTransparentMaterial: createSelectedTransparentMaterials,
          createSelectedMaterial: createSelectedMaterials,
        });
      } else if (isXRayMode) {
        applyXRayShading(anatomyMeshes, {
          originalMaterials,
          ghostMaterialsMap,
          selectedMeshes,
          createSelectedTransparentMaterial: createSelectedTransparentMaterials,
          createSelectedMaterial: createSelectedMaterials,
        });
      }
      emitStagedSummary();
    }
    renderScene();
  };

  toggleExcludeDraftRef.current = (id: string) => {
    const item = draftPaintedMap.get(id);
    if (item) {
      item.excluded = !item.excluded;
      emitDraftPaintedSummary();
    }
  };

  toggleMultipleDraftExcludedRef.current = (ids: string[]) => {
    let changed = false;
    for (const id of ids) {
      const item = draftPaintedMap.get(id);
      if (item) {
        item.excluded = !item.excluded;
        changed = true;
      }
    }
    if (changed) {
      emitDraftPaintedSummary();
    }
  };

  setAllDraftExcludedRef.current = (excluded: boolean) => {
    draftPaintedMap.forEach((item) => {
      item.excluded = excluded;
    });
    emitDraftPaintedSummary();
  };

  const meshDepthLevels = new Map<string, DepthLevel>();

  const isSurfaceStructure = (mesh: THREE.Mesh): boolean => {
    const depthLevel =
      meshDepthLevels.get(mesh.name) ??
      (mesh.userData?.depthLevel as DepthLevel | undefined);
    if (depthLevel === "surface" || depthLevel === "shallow") {
      if (!isSkeletonStructure(mesh)) return true;
    }

    const name = (mesh.name || "").toLowerCase();
    const label = (mesh.userData?.structureLabel || "").toLowerCase();
    const target = `${name} ${label}`;

    // 장경인대(Iliotibial tract/band), 근막(Fascia), 건막(Aponeurosis), 지지대(Retinaculum)
    if (
      target.includes("iliotibial") ||
      target.includes("it band") ||
      target.includes("tractus iliotibialis") ||
      target.includes("장경인대")
    )
      return true;
    if (target.includes("fascia") || target.includes("fascial") || target.includes("근막"))
      return true;
    if (target.includes("aponeurosis") || target.includes("건막")) return true;
    if (target.includes("retinaculum") || target.includes("지지대")) return true;
    if (
      target.includes("skin") ||
      target.includes("dermis") ||
      target.includes("integumentary") ||
      target.includes("외피")
    )
      return true;

    // 신체 최외각을 덮는 대표적 표층 근육군
    if (target.includes("external") && (target.includes("oblique") || target.includes("복사근")))
      return true;
    if (target.includes("platysma") || target.includes("광경근")) return true;
    if (target.includes("pectoralis major") || target.includes("대흉근")) return true;
    if (target.includes("latissimus dorsi") || target.includes("광배근")) return true;
    if (target.includes("trapezius") || target.includes("승모근")) return true;
    if (target.includes("orbicularis") || target.includes("둘레근")) return true;
    if (target.includes("tensor fasciae latae") || target.includes("대퇴근막장근")) return true;
    if (target.includes("sartorius") || target.includes("봉공근")) return true;
    if (target.includes("gracilis") || target.includes("박근")) return true;
    if (target.includes("rectus femoris") || target.includes("대퇴직근")) return true;
    if (target.includes("vastus lateralis") || target.includes("외측광근")) return true;
    if (target.includes("gastrocnemius") || target.includes("비복근")) return true;
    if (target.includes("tibialis anterior") || target.includes("전경골근")) return true;
    if (target.includes("gluteus maximus") || target.includes("대둔근")) return true;
    if (target.includes("deltoid") || target.includes("삼각근")) return true;
    if (target.includes("sternocleidomastoid") || target.includes("흉쇄유돌근")) return true;
    if (target.includes("rectus abdominis") || target.includes("복직근")) return true;

    return false;
  };

  const selectSingleMesh = (mesh: THREE.Mesh) => {
    if (isFasciaHidden && isFasciaStructure(mesh)) {
      return;
    }
    if (isPeritoneumHidden && isPeritoneumStructure(mesh)) {
      return;
    }
    if (isIsolateMode && mesh.userData.structureSystem === "integumentary") {
      return;
    }
    const existing = stagedItemsMap.get(mesh.name);
    if (existing && !existing.excluded) {
      // 이미 선택되어 있는 경우 -> 토글 해제
      selectedMeshes.delete(mesh);
      stagedItemsMap.delete(mesh.name);
      restoreMeshMaterial(mesh);
    } else if (existing && existing.excluded) {
      existing.excluded = false;
      const orig = originalMaterials.get(mesh) ?? mesh.material;
      const isSurface = isSurfaceStructure(mesh);
      if (isXRayMode && !isSkeletonStructure(mesh)) {
        mesh.material = createSelectedTransparentMaterials(orig, 0.35);
        mesh.renderOrder = 15;
      } else if (isIsolateMode && isSurface) {
        mesh.material = createSelectedTransparentMaterials(orig, 0.35);
        mesh.renderOrder = 15;
      } else {
        mesh.material = createSelectedMaterials(orig);
        mesh.renderOrder = 20;
      }
      selectedMeshes.add(mesh);
    } else {
      ensureStagedItem(mesh);
      const orig = originalMaterials.get(mesh) ?? mesh.material;
      const isSurface = isSurfaceStructure(mesh);
      if (isXRayMode && !isSkeletonStructure(mesh)) {
        mesh.material = createSelectedTransparentMaterials(orig, 0.35);
        mesh.renderOrder = 15;
      } else if (isIsolateMode && isSurface) {
        mesh.material = createSelectedTransparentMaterials(orig, 0.35);
        mesh.renderOrder = 15;
      } else {
        mesh.material = createSelectedMaterials(orig);
        mesh.renderOrder = 20;
      }
      selectedMeshes.add(mesh);
    }

    // 선택된 부위의 계통이 감춰진 상태라면 자동으로 해당 구조 레이어를 켜서 화면에 즉시 보이도록 활성화
    const sys = String(mesh.userData.structureSystem ?? "");
    if (sys && hiddenSystems.has(sys)) {
      hiddenSystems.delete(sys);
      onHiddenSystemsChange(new Set(hiddenSystems));
      anatomyMeshes.forEach(applyMeshVisibility);
    }

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    emitStagedSummary();
    renderScene();
  };

  let isXRayMode = false;
  let isIsolateMode = false;
  let currentDepthCandidates: DepthHitCandidate[] = [];
  let selectedDepthCandidateNames = new Set<string>();

  const createCandidatePreviewMaterials = (source: THREE.Material | THREE.Material[]) => {
    const highlighted = materialsOf(source).map((material) => {
      const clone = material.clone();
      if (
        clone instanceof THREE.MeshStandardMaterial ||
        clone instanceof THREE.MeshLambertMaterial ||
        clone instanceof THREE.MeshBasicMaterial
      ) {
        if ("vertexColors" in clone) clone.vertexColors = false;
        clone.color.setHex(0x38bdf8);
        if ("emissive" in clone) {
          clone.emissive.setHex(0x0284c7);
          clone.emissiveIntensity = 0.75;
        }
        clone.opacity = 0.9;
        clone.transparent = false;
        clone.depthWrite = true;
        clone.wireframe = false;
      }
      return clone;
    });
    return Array.isArray(source) ? highlighted : highlighted[0];
  };

  const restoreMeshMaterial = (mesh: THREE.Mesh) => {
    if (isMeshSelected(mesh)) {
      const orig = originalMaterials.get(mesh) ?? mesh.material;
      const isSurface = isSurfaceStructure(mesh);
      if (isXRayMode && !isSkeletonStructure(mesh)) {
        mesh.material = createSelectedTransparentMaterials(orig, 0.35);
        mesh.renderOrder = 15;
      } else if (isIsolateMode && isSurface) {
        mesh.material = createSelectedTransparentMaterials(orig, 0.35);
        mesh.renderOrder = 15;
      } else {
        mesh.material = createSelectedMaterials(orig);
        mesh.renderOrder = 20;
      }
      return;
    }

    if (isXRayMode) {
      const isTarget = isSkeletonStructure(mesh);
      if (isTarget) {
        const orig = originalMaterials.get(mesh) ?? mesh.material;
        mesh.material = orig;
        mesh.renderOrder = 10;
        return;
      } else {
        let ghost = ghostMaterialsMap.get(mesh);
        if (!ghost) {
          const sourceMat = originalMaterials.get(mesh) ?? mesh.material;
          ghost = createGhostMaterial(sourceMat, 0.15);
          ghostMaterialsMap.set(mesh, ghost);
        }
        mesh.material = ghost;
        mesh.renderOrder = 1;
        return;
      }
    } else if (isIsolateMode) {
      if (selectedMeshes.has(mesh)) {
        const orig = originalMaterials.get(mesh) ?? mesh.material;
        const isSurface = isSurfaceStructure(mesh);
        mesh.material = isSurface ? createSelectedTransparentMaterials(orig) : createSelectedMaterials(orig);
        mesh.renderOrder = isSurface ? 15 : 20;
        return;
      } else {
        let ghost = ghostMaterialsMap.get(mesh);
        if (!ghost) {
          const sourceMat = originalMaterials.get(mesh) ?? mesh.material;
          ghost = cloneToIsolateGhost(sourceMat, 0.08);
          ghostMaterialsMap.set(mesh, ghost);
        }
        mesh.material = ghost;
        mesh.renderOrder = 1;
        return;
      }
    }

    if (selectedDepthCandidateNames.has(mesh.name) && !selectedMeshes.has(mesh)) {
      const orig = originalMaterials.get(mesh) ?? mesh.material;
      mesh.material = createCandidatePreviewMaterials(orig);
      mesh.renderOrder = 18;
      return;
    }

    const orig = originalMaterials.get(mesh);
    if (orig) mesh.material = orig;
    const origOrder = originalRenderOrders.get(mesh);
    if (origOrder !== undefined) mesh.renderOrder = origOrder;
  };

  const clearPaint = () => {
    while (paintMarkersGroup.children.length > 0) {
      paintMarkersGroup.remove(paintMarkersGroup.children[0]);
    }
    for (const stroke of paintHistory) {
      for (const mesh of stroke.touchedMeshes) {
        restoreMeshMaterial(mesh);
      }
    }
    draftPaintedMap.forEach((item) => {
      if (item.mesh) {
        restoreMeshMaterial(item.mesh);
      }
    });
    paintHistory.length = 0;
    currentStroke = null;
    draftPaintedMap.clear();
    emitDraftPaintedSummary();

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
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
    draftPaintedMap.clear();
    for (const mesh of remainingMeshes) {
      ensureDraftPaintedItem(mesh);
    }
    for (const mesh of last.touchedMeshes) {
      if (!remainingMeshes.has(mesh)) {
        restoreMeshMaterial(mesh);
      }
    }
    emitDraftPaintedSummary();

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
  };

  undoPaintRef.current = undoPaint;
  clearPaintRef.current = clearPaint;

  const createAdaptiveHoverMaterials = (mesh: THREE.Mesh, orig: THREE.Material | THREE.Material[]) => {
    if (isXRayMode && !isSkeletonStructure(mesh)) {
      const highlighted = materialsOf(orig).map((material) => {
        const clone = material.clone();
        clone.transparent = true;
        clone.opacity = 0.35;
        clone.depthWrite = false;
        if ("color" in clone) (clone as THREE.MeshStandardMaterial).color.setHex(0x38bdf8);
        return clone;
      });
      return Array.isArray(orig) ? highlighted : highlighted[0];
    }
    if (isIsolateMode && !selectedMeshes.has(mesh)) {
      const highlighted = materialsOf(orig).map((material) => {
        const clone = material.clone();
        clone.transparent = true;
        clone.opacity = 0.25;
        clone.depthWrite = false;
        if ("color" in clone) (clone as THREE.MeshStandardMaterial).color.setHex(0x38bdf8);
        return clone;
      });
      return Array.isArray(orig) ? highlighted : highlighted[0];
    }
    return createHoverMaterials(orig);
  };

  const applyCandidatePreviewMaterials = () => {
    for (const candidate of currentDepthCandidates) {
      const mesh = candidate.mesh;
      if (selectedMeshes.has(mesh)) continue;
      if (selectedDepthCandidateNames.has(candidate.meshName)) {
        const orig = originalMaterials.get(mesh) ?? mesh.material;
        mesh.material = createCandidatePreviewMaterials(orig);
        mesh.renderOrder = 18;
      } else {
        restoreMeshMaterial(mesh);
      }
    }
    renderScene();
  };

  const clearCandidatePreviewMaterials = () => {
    for (const candidate of currentDepthCandidates) {
      const mesh = candidate.mesh;
      if (!selectedMeshes.has(mesh)) {
        restoreMeshMaterial(mesh);
      }
    }
    renderScene();
  };

  toggleCandidateDepthRef.current = (meshName: string) => {
    if (selectedDepthCandidateNames.has(meshName)) {
      selectedDepthCandidateNames.delete(meshName);
    } else {
      selectedDepthCandidateNames.add(meshName);
    }
    setSelectedDepthCandidateIds(new Set(selectedDepthCandidateNames));
    applyCandidatePreviewMaterials();
  };

  toggleMultipleCandidateDepthRef.current = (meshNames: string[]) => {
    let changed = false;
    for (const meshName of meshNames) {
      if (selectedDepthCandidateNames.has(meshName)) {
        selectedDepthCandidateNames.delete(meshName);
      } else {
        selectedDepthCandidateNames.add(meshName);
      }
      changed = true;
    }
    if (changed) {
      setSelectedDepthCandidateIds(new Set(selectedDepthCandidateNames));
      applyCandidatePreviewMaterials();
    }
  };

  setAllDepthCandidatesSelectedRef.current = (selected: boolean) => {
    if (selected) {
      selectedDepthCandidateNames = new Set(currentDepthCandidates.map((c) => c.meshName));
    } else {
      selectedDepthCandidateNames.clear();
    }
    setSelectedDepthCandidateIds(new Set(selectedDepthCandidateNames));
    applyCandidatePreviewMaterials();
  };

  let currentDepthAnchorMeshName: string | null = null;

  clearDepthCandidatesRef.current = () => {
    clearCandidatePreviewMaterials();
    currentDepthCandidates = [];
    selectedDepthCandidateNames.clear();
    currentDepthAnchorMeshName = null;
    setSelectedDepthCandidateIds(new Set());
    onDepthCandidatesChange([]);
    onRecentlyAddedStaged?.(null);
  };

  eraseDepthSelectionRef.current = () => {
    clearCandidatePreviewMaterials();
    currentDepthCandidates = [];
    selectedDepthCandidateNames.clear();
    setSelectedDepthCandidateIds(new Set());
    onDepthCandidatesChange([]);

    if (currentDepthAnchorMeshName) {
      const anchorId = currentDepthAnchorMeshName;
      currentDepthAnchorMeshName = null;
      if (stagedItemsMap.has(anchorId)) {
        removeStagedItemRef.current(anchorId);
      }
    }
    onRecentlyAddedStaged?.(null);
  };

  confirmDepthCandidatesRef.current = () => {
    if (currentDepthCandidates.length === 0) return;
    const transferredItems: StagingItem[] = [];
    const candidatesSnapshot = [...currentDepthCandidates];
    const selectedIdsSnapshot = new Set(selectedDepthCandidateNames);

    for (const candidate of currentDepthCandidates) {
      if (selectedDepthCandidateNames.has(candidate.meshName)) {
        const mesh = candidate.mesh;
        ensureStagedItem(mesh);
        const item = stagedItemsMap.get(mesh.name);
        if (item) {
          item.excluded = false;
          transferredItems.push({ ...item });
        }
        selectedMeshes.add(mesh);
        const orig = originalMaterials.get(mesh) ?? mesh.material;
        const isSurface = isSurfaceStructure(mesh);
        if (isXRayMode && !isSkeletonStructure(mesh)) {
          mesh.material = createSelectedTransparentMaterials(orig, 0.35);
          mesh.renderOrder = 15;
        } else if (isIsolateMode && isSurface) {
          mesh.material = createSelectedTransparentMaterials(orig, 0.35);
          mesh.renderOrder = 15;
        } else {
          mesh.material = createSelectedMaterials(orig);
          mesh.renderOrder = 20;
        }
      } else {
        restoreMeshMaterial(candidate.mesh);
      }
    }

    if (transferredItems.length > 0) {
      undoHistory.push({
        type: "confirm_depth",
        transferredItems,
        candidatesSnapshot,
        selectedIdsSnapshot,
      });
      redoHistory.length = 0;
      updateHistoryState();
      onRecentlyAddedStaged?.(null);
    }

    currentDepthCandidates = [];
    selectedDepthCandidateNames.clear();
    currentDepthAnchorMeshName = null;
    setSelectedDepthCandidateIds(new Set());
    onDepthCandidatesChange([]);

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    emitStagedSummary();
    renderScene();
  };

  selectCandidateMeshRef.current = (candidate) => {
    toggleCandidateDepthRef.current(candidate.meshName);
  };

  toggleExcludeRef.current = (id: string) => {
    const item = stagedItemsMap.get(id);
    if (!item) return;
    item.excluded = !item.excluded;

    if (item.excluded) {
      selectedMeshes.delete(item.mesh);
      restoreMeshMaterial(item.mesh);
      for (const stroke of paintHistory) {
        for (const s of stroke.samples) {
          if (s.mesh === item.mesh) {
            for (const m of s.markers) m.visible = false;
          }
        }
      }
    } else {
      selectedMeshes.add(item.mesh);
      restoreMeshMaterial(item.mesh);
      for (const stroke of paintHistory) {
        for (const s of stroke.samples) {
          if (s.mesh === item.mesh) {
            for (const m of s.markers) m.visible = true;
          }
        }
      }
    }

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
    emitStagedSummary();
  };

  removeStagedItemRef.current = (id: string) => {
    const item = stagedItemsMap.get(id);
    if (!item) return;
    undoHistory.push({ type: "delete_item", item: { ...item } });
    redoHistory.length = 0;

    stagedItemsMap.delete(id);
    selectedMeshes.delete(item.mesh);
    restoreMeshMaterial(item.mesh);
    for (const stroke of paintHistory) {
      for (const s of stroke.samples) {
        if (s.mesh === item.mesh) {
          for (const m of s.markers) m.visible = false;
        }
      }
    }

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
    emitStagedSummary();
    updateHistoryState();
  };

  clearAllStagedItemsRef.current = () => {
    if (stagedItemsMap.size === 0) return;
    const items: StagingItem[] = [];
    stagedItemsMap.forEach((item) => {
      items.push({ ...item });
      stagedItemsMap.delete(item.id);
      selectedMeshes.delete(item.mesh);
      restoreMeshMaterial(item.mesh);
      for (const stroke of paintHistory) {
        for (const s of stroke.samples) {
          if (s.mesh === item.mesh) {
            for (const m of s.markers) m.visible = false;
          }
        }
      }
    });

    undoHistory.push({ type: "clear_all_staged", items });
    redoHistory.length = 0;

    clearCandidatePreviewMaterials();
    currentDepthCandidates = [];
    selectedDepthCandidateNames.clear();
    setSelectedDepthCandidateIds(new Set());
    onDepthCandidatesChange([]);

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
    emitStagedSummary();
    updateHistoryState();
  };

  undoDeleteRef.current = () => {
    const action = undoHistory.pop();
    if (!action) return;
    redoHistory.push(action);

    if (action.type === "confirm_transfer") {
      for (const item of action.transferredItems) {
        stagedItemsMap.delete(item.id);
        selectedMeshes.delete(item.mesh);
        restoreMeshMaterial(item.mesh);
        for (const stroke of paintHistory) {
          for (const s of stroke.samples) {
            if (s.mesh === item.mesh) {
              for (const m of s.markers) m.visible = false;
            }
          }
        }
      }

      draftPaintedMap.clear();
      for (const draft of action.draftSnapshot) {
        draftPaintedMap.set(draft.id, { ...draft });
      }

      emitDraftPaintedSummary();
    } else if (action.type === "confirm_depth") {
      for (const item of action.transferredItems) {
        stagedItemsMap.delete(item.id);
        selectedMeshes.delete(item.mesh);
        restoreMeshMaterial(item.mesh);
      }
      currentDepthCandidates = [...action.candidatesSnapshot];
      selectedDepthCandidateNames = new Set(action.selectedIdsSnapshot);
      setSelectedDepthCandidateIds(new Set(selectedDepthCandidateNames));
      onDepthCandidatesChange(currentDepthCandidates);
      applyCandidatePreviewMaterials();
    } else if (action.type === "delete_item") {
      const { item } = action;
      stagedItemsMap.set(item.id, item);
      selectedMeshes.add(item.mesh);
      restoreMeshMaterial(item.mesh);
      for (const stroke of paintHistory) {
        for (const s of stroke.samples) {
          if (s.mesh === item.mesh) {
            for (const m of s.markers) m.visible = true;
          }
        }
      }
    } else if (action.type === "clear_all_staged") {
      for (const item of action.items) {
        stagedItemsMap.set(item.id, { ...item });
        if (!item.excluded) {
          selectedMeshes.add(item.mesh);
          const orig = originalMaterials.get(item.mesh) ?? item.mesh.material;
          const isSurface = isSurfaceStructure(item.mesh);
          if (isXRayMode && !isSkeletonStructure(item.mesh)) {
            item.mesh.material = createSelectedTransparentMaterials(orig, 0.35);
            item.mesh.renderOrder = 15;
          } else if (isIsolateMode && isSurface) {
            item.mesh.material = createSelectedTransparentMaterials(orig, 0.35);
            item.mesh.renderOrder = 15;
          } else {
            item.mesh.material = createSelectedMaterials(orig);
            item.mesh.renderOrder = 20;
          }
        }
        for (const stroke of paintHistory) {
          for (const s of stroke.samples) {
            if (s.mesh === item.mesh) {
              for (const m of s.markers) m.visible = true;
            }
          }
        }
      }
    }

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
    emitStagedSummary();
    updateHistoryState();
  };

  redoDeleteRef.current = () => {
    const action = redoHistory.pop();
    if (!action) return;
    undoHistory.push(action);

    if (action.type === "confirm_transfer") {
      draftPaintedMap.clear();
      for (const item of action.transferredItems) {
        stagedItemsMap.set(item.id, { ...item });
        selectedMeshes.add(item.mesh);
        restoreMeshMaterial(item.mesh);
        for (const stroke of paintHistory) {
          for (const s of stroke.samples) {
            if (s.mesh === item.mesh) {
              for (const m of s.markers) m.visible = true;
            }
          }
        }
      }
      emitDraftPaintedSummary();
    } else if (action.type === "confirm_depth") {
      clearCandidatePreviewMaterials();
      for (const item of action.transferredItems) {
        stagedItemsMap.set(item.id, { ...item });
        selectedMeshes.add(item.mesh);
        restoreMeshMaterial(item.mesh);
      }
      currentDepthCandidates = [];
      selectedDepthCandidateNames.clear();
      setSelectedDepthCandidateIds(new Set());
      onDepthCandidatesChange([]);
    } else if (action.type === "delete_item") {
      const { item } = action;
      stagedItemsMap.delete(item.id);
      selectedMeshes.delete(item.mesh);
      restoreMeshMaterial(item.mesh);
      for (const stroke of paintHistory) {
        for (const s of stroke.samples) {
          if (s.mesh === item.mesh) {
            for (const m of s.markers) m.visible = false;
          }
        }
      }
    } else if (action.type === "clear_all_staged") {
      for (const item of action.items) {
        stagedItemsMap.delete(item.id);
        selectedMeshes.delete(item.mesh);
        restoreMeshMaterial(item.mesh);
        for (const stroke of paintHistory) {
          for (const s of stroke.samples) {
            if (s.mesh === item.mesh) {
              for (const m of s.markers) m.visible = false;
            }
          }
        }
      }
    }

    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
    emitStagedSummary();
    updateHistoryState();
  };

  toggleXRayRef.current = (active) => {
    if (active && isIsolateMode) {
      isIsolateMode = false;
      restoreIsolateShading(anatomyMeshes, originalMaterials);
      ghostMaterialsMap.clear();
    }
    isXRayMode = active;
    if (active) {
      ghostMaterialsMap.clear();
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else {
      restoreXRayShading(anatomyMeshes, originalMaterials, selectedMeshes, createSelectedMaterials);
      ghostMaterialsMap.clear();
    }
    renderScene();
  };

  toggleIsolateRef.current = (active) => {
    if (active && isXRayMode) {
      isXRayMode = false;
      restoreXRayShading(anatomyMeshes, originalMaterials);
      ghostMaterialsMap.clear();
    }
    isIsolateMode = active;
    if (active) {
      // 투시모드 활성화 시:
      // 1. 외피계(integumentary)는 숨김(비활성화)
      // 2. 골격계(skeletal)와 근육계(muscular)는 기본으로 추가 켬
      // 3. 신경계, 림프계 등 다른 레이어의 속성은 그대로 유지
      let changed = false;
      if (!hiddenSystems.has("integumentary")) {
        hiddenSystems.add("integumentary");
        changed = true;
      }
      if (hiddenSystems.has("skeletal")) {
        hiddenSystems.delete("skeletal");
        changed = true;
      }
      if (hiddenSystems.has("muscular")) {
        hiddenSystems.delete("muscular");
        changed = true;
      }
      if (changed) {
        onHiddenSystemsChange(new Set(hiddenSystems));
        anatomyMeshes.forEach(applyMeshVisibility);
      }
      ghostMaterialsMap.clear();
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    } else {
      restoreIsolateShading(anatomyMeshes, originalMaterials, selectedMeshes, createSelectedMaterials);
      ghostMaterialsMap.clear();
    }
    renderScene();
  };

  focusSelectedMeshRef.current = () => {
    const targetMeshes = Array.from(selectedMeshes);
    if (targetMeshes.length === 0) return;
    const bounds = calculateFocusBounds(targetMeshes);
    const targetPos = calculateTargetCameraPosition(bounds, camera);
    const startPos = camera.position.clone();
    const startTarget = controls.target.clone();
    const boundsCenter = bounds.center.clone();
    const startTime = performance.now();
    const duration = 650;
    const animateZoom = (now: number) => {
      const elapsed = Math.min(1, (now - startTime) / duration);
      const eased = elapsed * elapsed * (3 - 2 * elapsed);
      camera.position.lerpVectors(startPos, targetPos, eased);
      controls.target.lerpVectors(startTarget, boundsCenter, eased);
      controls.update();
      renderScene();
      if (elapsed < 1) {
        requestAnimationFrame(animateZoom);
      }
    };
    requestAnimationFrame(animateZoom);
  };

  selectByAnatomyIdRef.current = (anatomyId: string) => {
    const cleanTarget = anatomyId.toLowerCase();
    const target = anatomyMeshes.find((m) => {
      const id = (m.userData.anatomyId ?? m.name).toLowerCase();
      return id === cleanTarget || id.includes(cleanTarget);
    });
    if (target) {
      if (isFasciaHidden && isFasciaStructure(target)) {
        return false;
      }
      if (isPeritoneumHidden && isPeritoneumStructure(target)) {
        return false;
      }
      target.visible = true;
      selectSingleMesh(target);
      const bounds = calculateFocusBounds([target]);
      const targetPos = calculateTargetCameraPosition(bounds, camera);
      camera.position.copy(targetPos);
      controls.target.copy(bounds.center);
      controls.update();
      renderScene();
      return true;
    }
    return false;
  };

  type DentalMeshRule = {
    jawKeywords: string[];
    typeKeywords: string[];
    sideKeywords: string[];
    fallbackName?: string;
  };

  const FDI_MESH_RULES: Record<number, DentalMeshRule> = {
    // 상악 우측 (10번대, 환자 우측 = .r)
    11: { jawKeywords: ["upper"], typeKeywords: ["medial", "incisor"], sideKeywords: [".r", "_r", "right"] },
    12: { jawKeywords: ["upper"], typeKeywords: ["lateral", "incisor"], sideKeywords: [".r", "_r", "right"] },
    13: { jawKeywords: ["upper"], typeKeywords: ["canine"], sideKeywords: [".r", "_r", "right"] },
    14: { jawKeywords: ["upper"], typeKeywords: ["first", "premolar"], sideKeywords: [".r", "_r", "right"] },
    15: { jawKeywords: ["upper"], typeKeywords: ["second", "premolar"], sideKeywords: [".r", "_r", "right"] },
    16: { jawKeywords: ["upper"], typeKeywords: ["first", "molar"], sideKeywords: [".r", "_r", "right"] },
    17: { jawKeywords: ["upper"], typeKeywords: ["second", "molar"], sideKeywords: [".r", "_r", "right"] },
    18: { jawKeywords: ["upper"], typeKeywords: ["second", "molar"], sideKeywords: [".r", "_r", "right"], fallbackName: "maxilla" },

    // 상악 좌측 (20번대, 환자 좌측 = .l)
    21: { jawKeywords: ["upper"], typeKeywords: ["medial", "incisor"], sideKeywords: [".l", "_l", "left"] },
    22: { jawKeywords: ["upper"], typeKeywords: ["lateral", "incisor"], sideKeywords: [".l", "_l", "left"] },
    23: { jawKeywords: ["upper"], typeKeywords: ["canine"], sideKeywords: [".l", "_l", "left"] },
    24: { jawKeywords: ["upper"], typeKeywords: ["first", "premolar"], sideKeywords: [".l", "_l", "left"] },
    25: { jawKeywords: ["upper"], typeKeywords: ["second", "premolar"], sideKeywords: [".l", "_l", "left"] },
    26: { jawKeywords: ["upper"], typeKeywords: ["first", "molar"], sideKeywords: [".l", "_l", "left"] },
    27: { jawKeywords: ["upper"], typeKeywords: ["second", "molar"], sideKeywords: [".l", "_l", "left"] },
    28: { jawKeywords: ["upper"], typeKeywords: ["second", "molar"], sideKeywords: [".l", "_l", "left"], fallbackName: "maxilla" },

    // 하악 좌측 (30번대, 환자 좌측 = .l)
    31: { jawKeywords: ["lower"], typeKeywords: ["medial", "incisor"], sideKeywords: [".l", "_l", "left"] },
    32: { jawKeywords: ["lower"], typeKeywords: ["lateral", "incisor"], sideKeywords: [".l", "_l", "left"] },
    33: { jawKeywords: ["lower"], typeKeywords: ["canine"], sideKeywords: [".l", "_l", "left"] },
    34: { jawKeywords: ["lower"], typeKeywords: ["first", "premolar"], sideKeywords: [".l", "_l", "left"] },
    35: { jawKeywords: ["lower"], typeKeywords: ["second", "premolar"], sideKeywords: [".l", "_l", "left"] },
    36: { jawKeywords: ["lower"], typeKeywords: ["first", "molar"], sideKeywords: [".l", "_l", "left"] },
    37: { jawKeywords: ["lower"], typeKeywords: ["second", "molar"], sideKeywords: [".l", "_l", "left"] },
    38: { jawKeywords: ["lower"], typeKeywords: ["second", "molar"], sideKeywords: [".l", "_l", "left"], fallbackName: "mandible" },

    // 하악 우측 (40번대, 환자 우측 = .r)
    41: { jawKeywords: ["lower"], typeKeywords: ["medial", "incisor"], sideKeywords: [".r", "_r", "right"] },
    42: { jawKeywords: ["lower"], typeKeywords: ["lateral", "incisor"], sideKeywords: [".r", "_r", "right"] },
    43: { jawKeywords: ["lower"], typeKeywords: ["canine"], sideKeywords: [".r", "_r", "right"] },
    44: { jawKeywords: ["lower"], typeKeywords: ["first", "premolar"], sideKeywords: [".r", "_r", "right"] },
    45: { jawKeywords: ["lower"], typeKeywords: ["second", "premolar"], sideKeywords: [".r", "_r", "right"] },
    46: { jawKeywords: ["lower"], typeKeywords: ["first", "molar"], sideKeywords: [".r", "_r", "right"] },
    47: { jawKeywords: ["lower"], typeKeywords: ["second", "molar"], sideKeywords: [".r", "_r", "right"] },
    48: { jawKeywords: ["lower"], typeKeywords: ["second", "molar"], sideKeywords: [".r", "_r", "right"], fallbackName: "mandible" },
  };

  function findToothMeshForFdi(toothCode: number, meshes: THREE.Mesh[]): THREE.Mesh | undefined {
    const rule = FDI_MESH_RULES[toothCode];
    if (!rule) return undefined;

    const isExcluded = (name: string) => {
      return (
        name.includes("submandibular") ||
        name.includes("artery") ||
        name.includes("vein") ||
        name.includes("nerve") ||
        name.includes("node") ||
        name.includes("ligament") ||
        name.includes("capsule") ||
        name.includes("triangle")
      );
    };

    const validMeshes = meshes.filter((m) => {
      const rawId = (m.userData.anatomyId ?? m.name).toLowerCase();
      return !isExcluded(rawId);
    });

    // 1. 정확한 개별 치아 메쉬 매칭 (jaw + type + side)
    const exactMatch = validMeshes.find((m) => {
      const name = (m.userData.anatomyId ?? m.name).toLowerCase();
      const matchesJaw = rule.jawKeywords.some((kw) => name.includes(kw));
      if (!matchesJaw) return false;

      const matchesType = rule.typeKeywords.every((kw) => name.includes(kw));
      if (!matchesType) return false;

      const matchesSide = rule.sideKeywords.some((kw) => name.includes(kw));
      return matchesSide;
    });
    if (exactMatch) return exactMatch;

    // 2. 사랑니 또는 fallback 턱뼈/치아 메쉬
    if (rule.fallbackName) {
      const fallback = validMeshes.find((m) => {
        const name = (m.userData.anatomyId ?? m.name).toLowerCase();
        return name.includes(rule.fallbackName!);
      });
      if (fallback) return fallback;
    }

    return undefined;
  }

  selectToothRef.current = (toothCode: number, toothName: string, shouldSelect?: boolean) => {
    const dentalId = `dental-fdi-${toothCode}`;
    const toothMesh = findToothMeshForFdi(toothCode, anatomyMeshes);

    const isCurrentlyStaged = stagedItemsMap.has(dentalId);
    const willSelect = shouldSelect !== undefined ? shouldSelect : !isCurrentlyStaged;

    if (willSelect) {
      const meshName = toothMesh ? toothMesh.name : `FDI #${toothCode}`;
      const dentalInfo = resolveAnatomyDisplayInfo(toothMesh?.name ?? dentalId, "skeletal");
      dentalInfo.koreanName = `${toothName} (#${toothCode})`;
      dentalInfo.canonicalName = meshName;
      dentalInfo.fullBilingualLabel = `${toothName} (#${toothCode}) (${meshName})`;
      dentalInfo.description = `${toothName} (FDI #${toothCode} · ${meshName}) 치아 구조`;

      if (toothMesh) {
        toothMesh.visible = true;
        selectedMeshes.add(toothMesh);
        if (!originalMaterials.has(toothMesh)) {
          originalMaterials.set(toothMesh, toothMesh.material);
        }
        const orig = originalMaterials.get(toothMesh)!;
        toothMesh.material = createSelectedMaterials(orig);
        toothMesh.renderOrder = 20;

        stagedItemsMap.set(dentalId, {
          id: dentalId,
          mesh: toothMesh,
          info: dentalInfo,
          excluded: false,
        });
      } else {
        stagedItemsMap.set(dentalId, {
          id: dentalId,
          mesh: undefined as unknown as THREE.Mesh,
          info: dentalInfo,
          excluded: false,
        });
      }
    } else {
      stagedItemsMap.delete(dentalId);
      if (toothMesh) {
        const isStillUsed = Array.from(stagedItemsMap.values()).some(
          (item) => !item.excluded && item.mesh === toothMesh,
        );
        if (!isStillUsed) {
          selectedMeshes.delete(toothMesh);
          const orig = originalMaterials.get(toothMesh);
          if (orig) toothMesh.material = orig;
        }
      }
    }

    renderScene();
    emitStagedSummary();
  };

  clearSelectionRef.current = () => {
    clearSelectedMaterial();
    clearCandidatePreviewMaterials();
    currentDepthCandidates = [];
    selectedDepthCandidateNames.clear();
    setSelectedDepthCandidateIds(new Set());
    clearPaint();
    stagedItemsMap.clear();
    onDepthCandidatesChange([]);
    emitStagedSummary();
    if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }
    renderScene();
  };

  setFasciaHiddenRef.current = (hidden: boolean) => {
    isFasciaHidden = hidden;

    // 1. 전체 메쉬 가시성 갱신
    anatomyMeshes.forEach(applyMeshVisibility);

    // 2. stagedItemsMap(확정 부위)의 데이터는 그대로 보존하되, 뷰어의 selectedMeshes 및 재질만 동기화
    stagedItemsMap.forEach((item) => {
      if (!item.mesh) return;
      const sys = String(item.mesh.userData.structureSystem ?? "");
      const isSysHidden = hiddenSystems.has(sys);
      const isFascia = isFasciaStructure(item.mesh);
      const isPeritoneum = isPeritoneumStructure(item.mesh);
      const shouldHideInViewer = isSysHidden || (hidden && isFascia) || (isPeritoneumHidden && isPeritoneum);

      if (!item.excluded && !shouldHideInViewer) {
        selectedMeshes.add(item.mesh);
        const orig = originalMaterials.get(item.mesh) ?? item.mesh.material;
        const isSurface = isSurfaceStructure(item.mesh);
        if (isIsolateMode && isSurface) {
          item.mesh.material = createSelectedTransparentMaterials(orig);
          item.mesh.renderOrder = 15;
        } else {
          item.mesh.material = createSelectedMaterials(orig);
          item.mesh.renderOrder = 20;
        }
      } else {
        selectedMeshes.delete(item.mesh);
        const orig = originalMaterials.get(item.mesh);
        if (orig) item.mesh.material = orig;
      }
    });

    // 3. draftPaintedMap(칠해진 부위)의 스프레이 마커 파티클 가시성 토글
    for (const stroke of paintHistory) {
      for (const sample of stroke.samples) {
        if (sample.mesh && isFasciaStructure(sample.mesh)) {
          for (const m of sample.markers) {
            m.visible = !hidden;
          }
        }
      }
    }
    if (currentStroke) {
      for (const sample of currentStroke.samples) {
        if (sample.mesh && isFasciaStructure(sample.mesh)) {
          for (const m of sample.markers) {
            m.visible = !hidden;
          }
        }
      }
    }

    // 4. 선택된 메쉬가 모두 숨겨진 경우 선택 요약 해제
    if (selectedMeshes.size === 0) {
      onSelectedStructure(undefined);
    }

    // 5. X-Ray / Isolate 모드 셰이딩 재적용
    if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
      });
    } else if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
  };

  setPeritoneumHiddenRef.current = (hidden: boolean) => {
    isPeritoneumHidden = hidden;

    // 1. 전체 메쉬 가시성 갱신
    anatomyMeshes.forEach(applyMeshVisibility);

    // 2. stagedItemsMap(확정 부위)의 데이터는 그대로 보존하되, 뷰어의 selectedMeshes 및 재질만 동기화
    stagedItemsMap.forEach((item) => {
      if (!item.mesh) return;
      const sys = String(item.mesh.userData.structureSystem ?? "");
      const isSysHidden = hiddenSystems.has(sys);
      const isFascia = isFasciaStructure(item.mesh);
      const isPeritoneum = isPeritoneumStructure(item.mesh);
      const shouldHideInViewer = isSysHidden || (isFasciaHidden && isFascia) || (hidden && isPeritoneum);

      if (!item.excluded && !shouldHideInViewer) {
        selectedMeshes.add(item.mesh);
        const orig = originalMaterials.get(item.mesh) ?? item.mesh.material;
        const isSurface = isSurfaceStructure(item.mesh);
        if (isIsolateMode && isSurface) {
          item.mesh.material = createSelectedTransparentMaterials(orig);
          item.mesh.renderOrder = 15;
        } else {
          item.mesh.material = createSelectedMaterials(orig);
          item.mesh.renderOrder = 20;
        }
      } else {
        selectedMeshes.delete(item.mesh);
        const orig = originalMaterials.get(item.mesh);
        if (orig) item.mesh.material = orig;
      }
    });

    // 3. draftPaintedMap(칠해진 부위)의 스프레이 마커 파티클 가시성 토글
    for (const stroke of paintHistory) {
      for (const sample of stroke.samples) {
        if (sample.mesh && isPeritoneumStructure(sample.mesh)) {
          for (const m of sample.markers) {
            m.visible = !hidden;
          }
        }
      }
    }
    if (currentStroke) {
      for (const sample of currentStroke.samples) {
        if (sample.mesh && isPeritoneumStructure(sample.mesh)) {
          for (const m of sample.markers) {
            m.visible = !hidden;
          }
        }
      }
    }

    // 4. 선택된 메쉬가 모두 숨겨진 경우 선택 요약 해제
    if (selectedMeshes.size === 0) {
      onSelectedStructure(undefined);
    }

    // 5. X-Ray / Isolate 모드 셰이딩 재적용
    if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
      });
    } else if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }

    renderScene();
  };

  let externalHoveredMesh: THREE.Mesh | undefined;
  let externalHoveredMeshPrevVisible = true;

  const restoreExternalHoveredMesh = () => {
    if (!externalHoveredMesh) return;
    const m = externalHoveredMesh;
    const orig = originalMaterials.get(m) ?? m.material;

    // 가시성 복원 (숨겨진 계통이었다면 다시 숨김)
    if (!externalHoveredMeshPrevVisible) {
      applyMeshVisibility(m);
    }

    // 상태별 재질 및 renderOrder 복원
    const stagedItem =
      stagedItemsMap.get(m.name) ||
      Array.from(stagedItemsMap.values()).find((it) => it.mesh === m);
    if (stagedItem && !stagedItem.excluded && selectedMeshes.has(m)) {
      const isSurface = isSurfaceStructure(m);
      if (isIsolateMode && isSurface) {
        m.material = createSelectedTransparentMaterials(orig);
        m.renderOrder = 15;
      } else {
        m.material = createSelectedMaterials(orig);
        m.renderOrder = 20;
      }
    } else if (selectedDepthCandidateNames.has(m.name)) {
      m.material = createCandidatePreviewMaterials(orig);
      m.renderOrder = 18;
    } else {
      restoreMeshMaterial(m);
    }

    externalHoveredMesh = undefined;
  };

  hoverMeshByNameRef.current = (target: THREE.Mesh | string | null) => {
    if (!target) {
      if (externalHoveredMesh) {
        restoreExternalHoveredMesh();
        onHoverStructure(null);
        renderScene();
      }
      return;
    }

    let targetMesh: THREE.Mesh | undefined;
    if (target instanceof THREE.Mesh) {
      targetMesh = target;
    } else {
      const cleanName = target.toLowerCase();
      // 1. stagedItemsMap, depthCandidates, draftPaintedMap, anatomyMeshes에서 탐색
      const staged =
        stagedItemsMap.get(target) ||
        Array.from(stagedItemsMap.values()).find((it) => it.id === target || it.mesh?.name === target);
      if (staged?.mesh) targetMesh = staged.mesh;

      if (!targetMesh) {
        const candidate = currentDepthCandidates.find(
          (c) => c.meshName === target || c.mesh.name === target,
        );
        if (candidate?.mesh) targetMesh = candidate.mesh;
      }

      if (!targetMesh) {
        const draft =
          draftPaintedMap.get(target) ||
          Array.from(draftPaintedMap.values()).find((it) => it.id === target || it.mesh?.name === target);
        if (draft?.mesh) targetMesh = draft.mesh;
      }

      if (!targetMesh) {
        targetMesh = anatomyMeshes.find(
          (m) =>
            m.name.toLowerCase() === cleanName ||
            String(m.userData.anatomyId ?? "").toLowerCase() === cleanName ||
            String(m.userData.structureLabel ?? "").toLowerCase() === cleanName,
        );
      }
    }

    if (!targetMesh) {
      if (externalHoveredMesh) {
        restoreExternalHoveredMesh();
        onHoverStructure(null);
        renderScene();
      }
      return;
    }

    if (externalHoveredMesh === targetMesh) {
      return;
    }

    if (externalHoveredMesh) {
      restoreExternalHoveredMesh();
    }

    externalHoveredMesh = targetMesh;
    externalHoveredMeshPrevVisible = targetMesh.visible;

    // 해당 부위가 숨겨져 있더라도 호버 시 인체 어디인지 볼 수 있도록 일시 가시화
    targetMesh.visible = true;

    if (!originalRenderOrders.has(targetMesh)) {
      originalRenderOrders.set(targetMesh, targetMesh.renderOrder);
    }
    targetMesh.renderOrder = 30;
    const orig = originalMaterials.get(targetMesh) ?? targetMesh.material;
    targetMesh.material = createAdaptiveHoverMaterials(targetMesh, orig);

    const info = resolveAnatomyDisplayInfo(
      targetMesh.name,
      String(targetMesh.userData.structureSystem ?? ""),
    );
    onHoverStructure(info);

    renderScene();
  };

  setHiddenSystemsRef.current = (systems) => {
    hiddenSystems = new Set(systems);

    // 1. 전체 메쉬 가시성 갱신
    anatomyMeshes.forEach(applyMeshVisibility);

    // 2. stagedItemsMap에 보존된 활성 선택 아이템과 selectedMeshes 동기화
    stagedItemsMap.forEach((item) => {
      if (!item.mesh) return;
      const sys = String(item.mesh.userData.structureSystem ?? "");
      const isHidden = hiddenSystems.has(sys);
      const isFascia = isFasciaStructure(item.mesh);
      const isPeritoneum = isPeritoneumStructure(item.mesh);
      const shouldHideInViewer = isHidden || (isFasciaHidden && isFascia) || (isPeritoneumHidden && isPeritoneum);
      if (!item.excluded && !shouldHideInViewer) {
        selectedMeshes.add(item.mesh);
        const orig = originalMaterials.get(item.mesh) ?? item.mesh.material;
        const isSurface = isSurfaceStructure(item.mesh);
        if (isIsolateMode && isSurface) {
          item.mesh.material = createSelectedTransparentMaterials(orig);
          item.mesh.renderOrder = 15;
        } else {
          item.mesh.material = createSelectedMaterials(orig);
          item.mesh.renderOrder = 20;
        }
      } else {
        selectedMeshes.delete(item.mesh);
        const orig = originalMaterials.get(item.mesh);
        if (orig) item.mesh.material = orig;
      }
    });

    if (selectedMeshes.size === 0 && stagedItemsMap.size === 0) {
      onSelectedStructure(undefined);
    }

    // 3. X-Ray / Isolate 모드 셰이딩 재적용 (선택된 메쉬 보호)
    if (isXRayMode) {
      applyXRayShading(anatomyMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        selectedMeshes,
      });
    } else if (isIsolateMode) {
      applyIsolateShading(anatomyMeshes, selectedMeshes, {
        originalMaterials,
        ghostMaterialsMap,
        isSurfaceMesh: isSurfaceStructure,
        createSelectedTransparentMaterial: createSelectedTransparentMaterials,
        createSelectedMaterial: createSelectedMaterials,
      });
    }
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
      selectableMeshes.filter(
        (m) =>
          m.visible &&
          (!isFasciaHidden || !isFasciaStructure(m)) &&
          (!isPeritoneumHidden || !isPeritoneumStructure(m)),
      ),
      false,
    );
    let hit = selectableHits[0];
    if (isXRayMode && selectableHits.length > 1) {
      const targetHit = selectableHits.find(
        (h) => h.object instanceof THREE.Mesh && !matchesSystemCategory(h.object.name, "muscular"),
      );
      if (targetHit) hit = targetHit;
    }
    if (hit?.object instanceof THREE.Mesh) {
      return { zone: "model", hitMesh: hit.object, hit };
    }

    const anyModelHits = raycaster.intersectObjects(
      anatomyMeshes.filter(
        (m) =>
          m.visible &&
          (!isFasciaHidden || !isFasciaStructure(m)) &&
          (!isPeritoneumHidden || !isPeritoneumStructure(m)),
      ),
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
        // 카메라 시선 기준 반대편 반구(Opposite hemisphere) 관통 차단
        // (등에서 바라볼 때 늑골 사이 틈을 지나 앞가슴 늑골에 닿는 첫 클릭 원천 차단)
        const center = controls.target;
        const viewVec = camera.position.clone().sub(center);
        const hitRel = hit.point.clone().sub(center);
        const hemisphereDot = hitRel.x * viewVec.x + hitRel.z * viewVec.z;
        if (hemisphereDot < -0.03 * viewVec.length()) {
          return;
        }

        event.preventDefault();
        event.stopImmediatePropagation();
        canvas.setPointerCapture(event.pointerId);
        isPainting = true;
        controls.enabled = false;
        currentStroke = { samples: [], touchedMeshes: [] };
        sprayAgitationState = createSprayAgitationState(event.clientX, event.clientY, performance.now());
        recordPaintSample(hit, 0);
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
        restoreMeshMaterial(hoveredMesh);
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
      if (externalHoveredMesh) {
        restoreExternalHoveredMesh();
      }
      const mesh = hitMesh;
      if (mesh !== hoveredMesh) {
        if (hoveredMesh && !isMeshSelected(hoveredMesh)) {
          restoreMeshMaterial(hoveredMesh);
        }

        hoveredMesh = mesh;

        if (mesh) {
          const info = resolveAnatomyDisplayInfo(mesh.name, String(mesh.userData.structureSystem ?? ""));
          onHoverStructure(info);
          if (!isMeshSelected(mesh)) {
            if (!originalRenderOrders.has(mesh)) {
              originalRenderOrders.set(mesh, mesh.renderOrder);
            }
            mesh.renderOrder = 15;
            const orig = originalMaterials.get(mesh) ?? mesh.material;
            mesh.material = createAdaptiveHoverMaterials(mesh, orig);
          }
        }
        renderScene();
      }
      canvas.style.cursor = "pointer";
    } else {
      if (hoveredMesh && !isMeshSelected(hoveredMesh)) {
        restoreMeshMaterial(hoveredMesh);
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
      restoreMeshMaterial(hoveredMesh);
      renderScene();
    }
    hoveredMesh = undefined;
    if (externalHoveredMesh) {
      restoreExternalHoveredMesh();
      renderScene();
    }
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
      const agitation = sprayAgitationState
        ? updateSprayAgitation(sprayAgitationState, event.clientX, event.clientY, now)
        : 0;
      if (now - lastSampleTime > 25) {
        lastSampleTime = now;
        setPointerFromEvent(event);
        raycaster.setFromCamera(pointer, camera);
        const hits = raycaster.intersectObjects(
          selectableMeshes.filter((m) => m.visible),
          false,
        );
        if (hits.length > 0) {
          const hit = hits[0];
          // 1. 카메라 시선 기준 반대편 반구(Opposite hemisphere) 관통 차단
          // (등에서 바라볼 때 늑골 사이 틈을 지나 앞가슴 늑골에 닿는 현상 원천 차단)
          const center = controls.target;
          const viewVec = camera.position.clone().sub(center);
          const hitRel = hit.point.clone().sub(center);
          const hemisphereDot = hitRel.x * viewVec.x + hitRel.z * viewVec.z;
          if (hemisphereDot < -0.03 * viewVec.length()) {
            return;
          }

          // 2. 틈새 관통 방지(스트로크 진행 중 직전 샘플 표면과의 카메라 거리차가 9cm를 초과하면 건너뜀)
          if (currentStroke.samples.length > 0) {
            const lastSample = currentStroke.samples[currentStroke.samples.length - 1];
            const lastDist = camera.position.distanceTo(lastSample.point);
            const currentDist = camera.position.distanceTo(hit.point);
            if (Math.abs(currentDist - lastDist) > 0.09) {
              return;
            }
          }
          if (hit.object instanceof THREE.Mesh) {
            recordPaintSample(hit, agitation);
          }
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
      sprayAgitationState = null;
      controls.enabled = true;
      if (canvas.hasPointerCapture(event.pointerId)) {
        canvas.releasePointerCapture(event.pointerId);
      }
      if (currentStroke && currentStroke.samples.length > 0) {
        paintHistory.push(currentStroke);
        currentStroke = null;
        emitDraftPaintedSummary();
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
    const visibleSelectables = selectableMeshes.filter(
      (m) =>
        m.visible &&
        (!isFasciaHidden || !isFasciaStructure(m)) &&
        (!isPeritoneumHidden || !isPeritoneumStructure(m)),
    );
    const hits = raycaster.intersectObjects(visibleSelectables, false);
    if (hits.length === 0) {
      clearCandidatePreviewMaterials();
      currentDepthCandidates = [];
      selectedDepthCandidateNames.clear();
      currentDepthAnchorMeshName = null;
      setSelectedDepthCandidateIds(new Set());
      onDepthCandidatesChange([]);
      onRecentlyAddedStaged?.(null);
      return;
    }

    const candidates = collectDepthHitCandidates(hits);
    candidates.forEach((c) => {
      meshDepthLevels.set(c.mesh.name, c.depthLevel);
      c.mesh.userData.depthLevel = c.depthLevel;
    });

    let hit = hits[0];
    if (isXRayMode && hits.length > 1) {
      const targetHit = hits.find(
        (h) => h.object instanceof THREE.Mesh && isSkeletonStructure(h.object),
      );
      if (targetHit) hit = targetHit;
    }
    const primaryMesh = hit?.object instanceof THREE.Mesh ? hit.object : null;

    if (primaryMesh) {
      const isAlreadyStaged = stagedItemsMap.has(primaryMesh.name) && !stagedItemsMap.get(primaryMesh.name)?.excluded;
      if (isAlreadyStaged) {
        // 이미 확정된 상태에서 다시 클릭 시 토글 해제
        selectSingleMesh(primaryMesh);
        clearCandidatePreviewMaterials();
        currentDepthCandidates = [];
        selectedDepthCandidateNames.clear();
        currentDepthAnchorMeshName = null;
        setSelectedDepthCandidateIds(new Set());
        onDepthCandidatesChange([]);
        onRecentlyAddedStaged?.(null);
        return;
      }

      // 1. 선택한 부위는 확정 부위로 즉시 담고 하이라이팅
      selectSingleMesh(primaryMesh);
      currentDepthAnchorMeshName = primaryMesh.name;
      onRecentlyAddedStaged?.(primaryMesh.name);

      // 2. 다른 관통형으로 걸린 후보들만 리스트에 표시 (선택한 부위 및 이미 확정된 부위 제외)
      const otherCandidates = candidates.filter(
        (c) => c.mesh !== primaryMesh && c.meshName !== primaryMesh.name && !stagedItemsMap.has(c.meshName),
      );

      if (otherCandidates.length > 0) {
        clearCandidatePreviewMaterials();
        currentDepthCandidates = otherCandidates;
        selectedDepthCandidateNames = new Set(otherCandidates.map((c) => c.meshName));
        setSelectedDepthCandidateIds(new Set(selectedDepthCandidateNames));
        onDepthCandidatesChange(otherCandidates);
        applyCandidatePreviewMaterials();
      } else {
        clearCandidatePreviewMaterials();
        currentDepthCandidates = [];
        selectedDepthCandidateNames.clear();
        currentDepthAnchorMeshName = null;
        setSelectedDepthCandidateIds(new Set());
        onDepthCandidatesChange([]);
        onRecentlyAddedStaged?.(null);
      }
    }
  };
  const handlePointerCancel = (event: PointerEvent) => {
    if (pointerGesture?.pointerId !== event.pointerId) return;
    pointerGesture = undefined;
    if (isPainting) {
      isPainting = false;
      sprayAgitationState = null;
      controls.enabled = true;
    }
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
    setFasciaHiddenRef.current = () => undefined;
    playHandPoseRef.current = () => undefined;
    clearAllStagedItemsRef.current = () => undefined;
    toggleMultipleCandidateDepthRef.current = () => undefined;
    toggleCandidateDepthRef.current = () => undefined;
    setAllDepthCandidatesSelectedRef.current = () => undefined;
    confirmDepthCandidatesRef.current = () => undefined;
    clearDepthCandidatesRef.current = () => undefined;
    eraseDepthSelectionRef.current = () => undefined;
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
        if (isXRayMode) {
          applyXRayShading([object], {
            originalMaterials,
            ghostMaterialsMap,
            selectedMeshes,
          });
        } else if (isIsolateMode) {
          applyIsolateShading([object], selectedMeshes, {
            originalMaterials,
            ghostMaterialsMap,
            isSurfaceMesh: isSurfaceStructure,
            createSelectedTransparentMaterial: createSelectedTransparentMaterials,
            createSelectedMaterial: createSelectedMaterials,
          });
        }
      });
      layerGroup.add(model);
      atlasGroup.updateMatrixWorld(true);
      onSystemsReady(new Set(readySystems));

      // 지연 레이어(머리/두개골/치아) 로드 완료 시, 이미 선택된 치아 항목들의 3D 메쉬를 재동기화
      let dentalMeshUpdated = false;
      stagedItemsMap.forEach((item, id) => {
        if (id.startsWith("dental-fdi-")) {
          const fdi = Number(id.replace("dental-fdi-", ""));
          if (!isNaN(fdi)) {
            const mesh = findToothMeshForFdi(fdi, anatomyMeshes);
            if (mesh && item.mesh !== mesh) {
              if (item.mesh && !Array.from(stagedItemsMap.values()).some((it) => it !== item && it.mesh === item.mesh)) {
                selectedMeshes.delete(item.mesh);
                const orig = originalMaterials.get(item.mesh);
                if (orig) item.mesh.material = orig;
              }
              item.mesh = mesh;
              item.info.canonicalName = mesh.name;
              item.info.description = `${item.info.koreanName} (FDI #${fdi} · ${mesh.name}) 치아 구조`;
              dentalMeshUpdated = true;
            }
            if (mesh && !item.excluded) {
              mesh.visible = true;
              selectedMeshes.add(mesh);
              if (!originalMaterials.has(mesh)) {
                originalMaterials.set(mesh, mesh.material);
              }
              const orig = originalMaterials.get(mesh)!;
              mesh.material = createSelectedMaterials(orig);
              mesh.renderOrder = 20;
              dentalMeshUpdated = true;
            }
          }
        }
      });
      if (dentalMeshUpdated) {
        renderScene();
        emitStagedSummary();
      }
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
    fullBodyReferenceDistance = presets.full.position.distanceTo(presets.full.target);
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

    const fullBodyDistance = fullBodyReferenceDistance;
    handleControlsStart = () => {
      if (autoFullReturnAnimating) return;
      if (focusAnimationFrame === undefined) return;
      window.cancelAnimationFrame(focusAnimationFrame);
      focusAnimationFrame = undefined;
    };
    handleControlsEnd = () => {
      const cameraDistance = camera.position.distanceTo(controls.target);
      if (
        shouldReturnToFullBody(activeBodyFocus, cameraDistance, fullBodyDistance, {
          frontThreshold: 0.85,
          backThreshold: 0.95,
          cameraPosition: camera.position,
          targetPosition: controls.target,
        })
      ) {
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
