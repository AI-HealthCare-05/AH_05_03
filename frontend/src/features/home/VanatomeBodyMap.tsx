import { useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { RoomEnvironment } from "three/addons/environments/RoomEnvironment.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import {
  computeBoundsTree,
  disposeBoundsTree,
  acceleratedRaycast,
} from "three-mesh-bvh";

// three-mesh-bvh 가속 구조 전역 바인딩: O(n) 전수조사 -> O(log n) 이진 탐색 트리로 레이캐스팅 가속
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast as unknown as typeof THREE.Mesh.prototype.raycast;

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
import { createAnatomyEvent, parseBodySide, type AnatomyEvent } from "./anatomyEventContracts";
import {
  applyCostalCartilageStyle,
  createAdaptiveFlowGuideMaterial,
  createFocusPresets,
  createHolographicMaterials,
  createHoverMaterials,
  createMatteScalpMaterials,
  isOcularStructure,
  isOccludingEyeStructure,
  createOcularMaterials,
  isDentalStructure,
  createDentalMaterials,
  INTERNALS_READABILITY_STYLE,
  createRegionalBoundaryMaterial,
  createSelectedMaterials,
  createSelectedTransparentMaterials,
  createDangerOrganHighlightMaterials,
  createDangerOrganHoverMaterials,
  getPainColorProfile,
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
import { VanatomeQuickSearch } from "./VanatomeQuickSearch";
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
import { loadHumanAtlasMeshes } from "./human-atlas/atlasLoader";

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
  { id: "joints", label: "관절·인대" },
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
  highlightOrganKey,
  highlightPainIntensity,
  highlightOrganIntensities,
  isDentalOpen,
  onDentalOpenChange,
  onToothSelectRef,
}: {
  profileName: string;
  gender?: "male" | "female" | null;
  risks?: RegionRisk[];
  risksAt?: string;
  highlightOrganKey?: string;
  highlightPainIntensity?: number;
  highlightOrganIntensities?: Record<string, number>;
  onStructureSelect?: (structure: SelectedStructure | undefined) => void;
  onStagingChange?: (items: StagingItem[]) => void;
  isDentalOpen?: boolean;
  onDentalOpenChange?: (open: boolean) => void;
  onToothSelectRef?: React.MutableRefObject<((toothCode: number, toothName: string, shouldSelect?: boolean) => void) | undefined>;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const selectDangerOrganRef = useRef<(
    organKey: string,
    options?: {
      animateCamera?: boolean;
      painIntensity?: number;
      organIntensities?: Record<string, number>;
    },
  ) => boolean>(() => false);
  const onStructureSelectRef = useRef(onStructureSelect);
  useEffect(() => {
    onStructureSelectRef.current = onStructureSelect;
  }, [onStructureSelect]);
  const onStagingChangeRef = useRef(onStagingChange);
  useEffect(() => {
    onStagingChangeRef.current = onStagingChange;
  }, [onStagingChange]);
  const highlightOrganKeyRef = useRef<string | undefined>(highlightOrganKey);
  const highlightPainIntensityRef = useRef<number | undefined>(highlightPainIntensity);
  const highlightOrganIntensitiesRef = useRef<Record<string, number> | undefined>(highlightOrganIntensities);
  useEffect(() => {
    highlightOrganKeyRef.current = highlightOrganKey;
    highlightPainIntensityRef.current = highlightPainIntensity;
    highlightOrganIntensitiesRef.current = highlightOrganIntensities;
  }, [highlightOrganKey, highlightPainIntensity, highlightOrganIntensities]);
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

  // 중요 진단 장기(간암, 폐 전이 등)가 지정되면 뼈 없이 피부만 보여주고 해당 장기 붉은색 투시 하이라이트 실행
  useEffect(() => {
    if (!highlightOrganKey) {
      clearSelectionRef.current();
      return;
    }

    let attempts = 0;
    const maxAttempts = 15;
    let timer: number | undefined;

    const tryHighlight = () => {
      attempts++;
      // 모니터링 투시 모드: 뼈(skeletal) 없이 신체 피부(integumentary)만 보여주기
      setHiddenSystems((prev) => {
        let changed = false;
        const next = new Set(prev);
        ANATOMY_SYSTEM_LAYERS.forEach((layer) => {
          if (layer.id !== "integumentary") {
            if (!next.has(layer.id)) {
              next.add(layer.id);
              changed = true;
            }
          }
        });
        if (next.has("integumentary")) {
          next.delete("integumentary");
          changed = true;
        }
        if (changed) {
          setHiddenSystemsRef.current(next);
          return next;
        }
        return prev;
      });
      const success = selectDangerOrganRef.current(highlightOrganKey, {
        painIntensity: highlightPainIntensityRef.current,
        organIntensities: highlightOrganIntensitiesRef.current,
      });
      if (!success && attempts < maxAttempts) {
        timer = window.setTimeout(tryHighlight, 300);
      }
    };

    timer = window.setTimeout(tryHighlight, 150);
    return () => {
      if (timer !== undefined) window.clearTimeout(timer);
    };
  }, [highlightOrganKey, highlightPainIntensity, highlightOrganIntensities]);

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
  const searchInputRef = useRef<HTMLInputElement>(null);
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

  const [isCyanGridShellActive, setIsCyanGridShellActive] = useState(false);
  const [isOliveIrisActive, setIsOliveIrisActive] = useState(false);
  const toggleCyanGridShellRef = useRef<(active: boolean) => void>(() => undefined);
  const toggleOliveIrisRef = useRef<(active: boolean) => void>(() => undefined);

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
    const baseInitialHiddenSystems = initiallyHiddenSystems(
      atlasId,
      ANATOMY_SYSTEM_LAYERS.map((layer) => layer.id),
    );
    const initialHiddenSystems = new Set(baseInitialHiddenSystems);
    if (highlightOrganKey) {
      ANATOMY_SYSTEM_LAYERS.forEach((layer) => {
        if (layer.id !== "integumentary") {
          initialHiddenSystems.add(layer.id);
        }
      });
      initialHiddenSystems.delete("integumentary");
    }
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
          toggleCyanGridShellRef,
          toggleOliveIrisRef,
          focusSelectedMeshRef,
          selectCandidateMeshRef,
          selectByAnatomyIdRef,
          selectDangerOrganRef,
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
          getHighlightOrganKey: () => highlightOrganKeyRef.current,
          getHighlightPainIntensity: () => highlightPainIntensityRef.current,
          getHighlightOrganIntensities: () => highlightOrganIntensitiesRef.current,
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
      toggleCyanGridShellRef.current = () => undefined;
      toggleOliveIrisRef.current = () => undefined;
      focusSelectedMeshRef.current = () => undefined;
      selectCandidateMeshRef.current = () => undefined;
      selectByAnatomyIdRef.current = () => false;
      selectDangerOrganRef.current = () => false;
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

  const activeEditingMeshCount = new Set([
    ...stagedItems.map((item) => item.id),
    ...draftPaintedItems.map((item) => item.id),
  ]).size;

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
                      ? "유령 필터에서는 외피계를 선택할 수 없습니다"
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
            깊이 방향 선택
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
        <div className="vanatome-precision-toolbar" role="toolbar" aria-label="정밀 해부학 도구">
          <button
            type="button"
            className="toolbar-btn"
            disabled={loadProgress < 100}
            onClick={() => searchInputRef.current?.focus()}
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
            X-ray 필터
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
            유령 필터
          </button>
        </div>
        <div
          className="vanatome-test-options"
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "6px",
            background: "rgba(241, 245, 249, 0.7)",
            border: "1px dashed #cbd5e1",
            borderRadius: "8px",
            padding: "8px 10px",
            marginTop: "6px",
          }}
          role="group"
          aria-label="테스트 스타일 옵션"
        >
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <span style={{ fontSize: "0.74rem", fontWeight: 600, color: "#475569" }}>
              테스트 스타일 옵션
            </span>
            <span style={{ fontSize: "0.68rem", color: "#94a3b8" }}>실시간 전환</span>
          </div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              className={`toolbar-btn ${isCyanGridShellActive ? "is-active" : ""}`}
              style={{
                flex: 1,
                fontSize: "0.75rem",
                padding: "5px 6px",
                borderColor: isCyanGridShellActive ? "#06b6d4" : "#cbd5e1",
                color: isCyanGridShellActive ? "#0891b2" : "#475569",
                background: isCyanGridShellActive ? "rgba(6, 182, 212, 0.12)" : "#ffffff",
                fontWeight: isCyanGridShellActive ? 600 : 500,
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              disabled={loadProgress < 100}
              aria-pressed={isCyanGridShellActive}
              title="이전 물빛청색 그리드 와이어프레임 외피 스타일 적용"
              onClick={() => {
                const next = !isCyanGridShellActive;
                setIsCyanGridShellActive(next);
                toggleCyanGridShellRef.current(next);
              }}
            >
              물빛청색 그리드 외피
            </button>
            <button
              type="button"
              className={`toolbar-btn ${isOliveIrisActive ? "is-active" : ""}`}
              style={{
                flex: 1,
                fontSize: "0.75rem",
                padding: "5px 6px",
                borderColor: isOliveIrisActive ? "#65a30d" : "#cbd5e1",
                color: isOliveIrisActive ? "#4d7c0f" : "#475569",
                background: isOliveIrisActive ? "rgba(101, 163, 13, 0.12)" : "#ffffff",
                fontWeight: isOliveIrisActive ? 600 : 500,
                borderRadius: "6px",
                cursor: "pointer",
                transition: "all 0.15s ease",
              }}
              disabled={loadProgress < 100}
              aria-pressed={isOliveIrisActive}
              title="Human Atlas (BodyParts3D) 머리 모델 고유 소프트 아이보리 흰자위와 올리브색 눈동자 적용"
              onClick={() => {
                const next = !isOliveIrisActive;
                setIsOliveIrisActive(next);
                toggleOliveIrisRef.current(next);
              }}
            >
              올리브색 눈동자
            </button>
          </div>
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
              <p style={{ margin: 0, color: "var(--muted)", lineHeight: 1.4, maxWidth: "220px" }}>
                인체 모델에서 부위를 클릭하거나 스프레이로 칠한 뒤 확정할 수 있습니다.
              </p>
            </div>
          )}
        </div>
      </div>

      <div className="vanatome-stage-column">
        <div className="body-map-viewer vanatome-viewer is-hologram">
          <canvas ref={canvasRef} aria-label="회전 가능한 해부학 인체 모니터" />
          <VanatomeQuickSearch
            inputRef={searchInputRef}
            disabled={loadProgress < 100}
            onSelectAnatomy={(anatomyId) => {
              selectByAnatomyIdRef.current(anatomyId);
            }}
            onSelectTooth={(toothFdi, koreanName) => {
              selectToothRef.current(toothFdi, koreanName, true);
            }}
          />
          {highlightOrganKey ? (
            activeEditingMeshCount === 0 ? (
              <div
                className="vanatome-monitoring-glow-pill"
                onClick={() => {
                  selectDangerOrganRef.current(highlightOrganKey, { animateCamera: true });
                }}
                title="건강 기록 연동 3D 자동 관찰 모드 (클릭하여 전신 모니터링 뷰 복귀)"
                role="status"
                aria-label="3D 자동 관찰 모드 활성화됨"
              >
                <span className="vanatome-monitoring-glow-dot" />
                <span className="vanatome-monitoring-glow-title">자동 관찰 모드</span>
                <span className="vanatome-monitoring-glow-sub">모니터링 뷰</span>
              </div>
            ) : (
              <div className="vanatome-monitoring-glow-pill is-recording" role="status" aria-label="부위 선택 모드">
                <span className="vanatome-recording-dot" />
                <span className="vanatome-monitoring-glow-title">
                  부위 선택 모드 ({activeEditingMeshCount}개 선택)
                </span>
                <button
                  type="button"
                  className="vanatome-return-monitoring-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    clearAllStagedItemsRef.current();
                  }}
                  title="선택된 부위를 비우고 건강 기록 모니터링 관찰 모드로 복귀"
                >
                  관찰 모드 복귀 ↺
                </button>
              </div>
            )
          ) : null}
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
  modelSource?: "vanatome" | "humanAtlas";
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
  toggleCyanGridShellRef: React.MutableRefObject<(active: boolean) => void>;
  toggleOliveIrisRef: React.MutableRefObject<(active: boolean) => void>;
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
  selectDangerOrganRef: React.MutableRefObject<(
    organKey: string,
    options?: {
      animateCamera?: boolean;
      painIntensity?: number;
      organIntensities?: Record<string, number>;
    },
  ) => boolean>;
  setSelectedDepthCandidateIds: React.Dispatch<React.SetStateAction<Set<string>>>;
  onRecentlyAddedStaged?: (id: string | null) => void;
  onHistoryChange?: (state: { canUndo: boolean; canRedo: boolean }) => void;
  getHighlightOrganKey?: () => string | undefined;
  getHighlightPainIntensity?: () => number | undefined;
  getHighlightOrganIntensities?: () => Record<string, number> | undefined;
};

async function createAnatomyScene(options: CreateAnatomySceneOptions) {
  const {
    canvas, manifest, signal, isDisposed, onProgress, onReady, onWebGlUnavailable,
    modelSource = "vanatome",
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
    toggleCyanGridShellRef, toggleOliveIrisRef,
    focusSelectedMeshRef, selectCandidateMeshRef, selectByAnatomyIdRef, selectDangerOrganRef, selectToothRef,
    toggleMultipleCandidateDepthRef,
    toggleCandidateDepthRef, setAllDepthCandidatesSelectedRef, confirmDepthCandidatesRef, clearDepthCandidatesRef,
    eraseDepthSelectionRef, hoverMeshByNameRef,
    setSelectedDepthCandidateIds, onRecentlyAddedStaged, getHighlightOrganKey, getHighlightPainIntensity,
    getHighlightOrganIntensities,
  } = options;
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
  } catch {
    queueMicrotask(onWebGlUnavailable);
    return () => undefined;
  }

  const isTouchDevice =
    typeof window !== "undefined" &&
    ("ontouchstart" in window || navigator.maxTouchPoints > 0 || window.innerWidth < 768);
  const normalPixelRatio = isTouchDevice ? 1.0 : Math.min(window.devicePixelRatio, 1.25);
  const dynamicDragPixelRatio = 1.0;
  renderer.setPixelRatio(normalPixelRatio);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // human-atlas PBR 렌더러 표준: ACESFilmicToneMapping & exposure 1.12
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.12;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0xf2f3f3); // human-atlas 스튜디오 쿨그레이
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 0.1, 6.8);

  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = false;
  controls.enablePan = false;
  controls.minDistance = 0.8;
  controls.maxDistance = 11;
  controls.target.set(0, 0.15, 0);
  // 모바일 뷰포트 스크롤 트랩 방지: 1손가락 터치는 페이지 세로 스크롤 허용, 2손가락은 3D 회전/핀치 줌에 위임
  controls.touches = {
    ONE: -1 as unknown as THREE.TOUCH,
    TWO: THREE.TOUCH.DOLLY_ROTATE,
  };

  // human-atlas IBL: RoomEnvironment PMREM 생성
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = new RoomEnvironment();
  const env = pmrem.fromScene(room, 0.04);
  scene.environment = env.texture;
  room.dispose();
  pmrem.dispose();

  // human-atlas 3점 스튜디오 조명 (Hemisphere + Key + Rim)
  scene.add(new THREE.HemisphereLight(0xffffff, 0xa7acb2, 1.05));
  const keyLight = new THREE.DirectionalLight(0xfffaf4, 2.3);
  keyLight.position.set(-2, 4, 3);
  scene.add(keyLight);
  const rimLight = new THREE.DirectionalLight(0xe9f0ff, 1.8);
  rimLight.position.set(2, 2, -3);
  scene.add(rimLight);

  const anatomyMeshes: THREE.Mesh[] = [];
  (window as unknown as { __anatomyMeshes: THREE.Mesh[] }).__anatomyMeshes = anatomyMeshes;
  (window as unknown as { __anatomyScene: THREE.Scene }).__anatomyScene = scene;
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
  let currentFocusPresets: ReturnType<typeof createFocusPresets> | undefined;
  let currentBodyBounds: THREE.Box3 | undefined;
  // 외피 정점별 통증 강도 매핑 (mesh -> (vertexIndex -> intensity))
  const activeDangerShellVertices = new Map<THREE.Mesh, Map<number, number>>();
  const getActiveDangerShellVertexCount = () => {
    let total = 0;
    activeDangerShellVertices.forEach((vMap) => {
      vMap.forEach((int) => {
        if (int > 0) total++;
      });
    });
    return total;
  };
  let transitionToFocusFn: ((focus: BodyFocus, options?: { duration?: number; lockControls?: boolean }) => void) | undefined;
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

  let renderFrameId: number | undefined;
  const renderScene = () => {
    if (renderFrameId !== undefined) {
      window.cancelAnimationFrame(renderFrameId);
      renderFrameId = undefined;
    }
    renderer.render(scene, camera);
  };
  const requestRender = () => {
    if (renderFrameId !== undefined) return;
    renderFrameId = window.requestAnimationFrame(() => {
      renderFrameId = undefined;
      renderer.render(scene, camera);
    });
  };
  (window as unknown as { __anatomyRender?: () => void }).__anatomyRender = requestRender;
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

  // THREE-MESH-BVH 가속 트리 생성 헬퍼: 메쉬별 BVH를 1회 구축하여 O(log n) 초고속 레이캐스팅 보장
  const ensureMeshBvh = (mesh: THREE.Mesh) => {
    if (mesh.geometry && !mesh.geometry.boundsTree) {
      try {
        mesh.geometry.computeBoundsTree();
      } catch {
        // BVH 빌드 실패 시 기본 raycast로 자동 안전 폴백
      }
    }
  };

  const dangerOrganMeshes = new Set<THREE.Mesh>();
  const dangerPulsingMeshes = new Set<THREE.Mesh>();
  let savedHiddenSystemsBeforeDanger: Set<string> | null = null;
  let dangerPulseFrameId: number | undefined;
  let dangerPulseStartTime: number | undefined;
  let dangerPulseLastRenderTime = 0;
  let isDangerPulsePaused = false;
  // 24fps 시네마틱 펄스 주기: 120Hz/60Hz 대비 렌더링 부하 80% 삭감
  const DANGER_PULSE_FPS_INTERVAL = 1000 / 24;

  let currentDangerIntensity: number | undefined = undefined;

  const isShellOrSurface = (mesh: THREE.Mesh): boolean => {
    return (
      mesh.userData.visualRole === "shell" ||
      mesh.userData.structureSystem === "integumentary" ||
      (mesh.name || "").toLowerCase().includes("shell") ||
      (mesh.name || "").toLowerCase().includes("skin") ||
      isSurfaceStructure(mesh)
    );
  };

  const applyDangerHighlightToMesh = (mesh: THREE.Mesh, intensity?: number) => {
    mesh.visible = true;
    mesh.userData.painIntensity = intensity;
    if (typeof intensity === "number" && intensity <= 0) {
      // 0은 통증 없음 -> 원래 재질 그대로 복원 (위험 하이라이트 미적용)
      restoreMeshMaterial(mesh);
      return;
    }
    const orig = originalMaterials.get(mesh) ?? mesh.material;
    const isShell = isShellOrSurface(mesh);
    mesh.material = createDangerOrganHighlightMaterials(orig, {
      intensity,
      isShell,
    });
    mesh.renderOrder = isShell ? 20 : 25;
  };

  const updateDangerPulse = (now: number) => {
    if ((dangerPulsingMeshes.size === 0 && getActiveDangerShellVertexCount() === 0) || isDangerPulsePaused) {
      dangerPulseFrameId = undefined;
      return;
    }

    if (dangerPulseStartTime === undefined) {
      dangerPulseStartTime = now;
    }

    // 24fps 스로틀: 120Hz/60Hz 고주사율 불필요 렌더링 차단 (시네마틱 호흡 펄스)
    if (now - dangerPulseLastRenderTime < DANGER_PULSE_FPS_INTERVAL) {
      dangerPulseFrameId = window.requestAnimationFrame(updateDangerPulse);
      return;
    }
    dangerPulseLastRenderTime = now;

    // 약 2.4초 주기의 은은하고 안정적인 지속 호흡 펄스 (부하 95% 삭감으로 영구 지속 유지 가능)
    const t = now * 0.0026;
    const pulseFactor = (Math.sin(t) + 1) * 0.5;
    const intensity = 0.5 + pulseFactor * 0.95;
    const currentOpacity = 0.70 + pulseFactor * 0.18;

    dangerPulsingMeshes.forEach((mesh) => {
      const isShell = isShellOrSurface(mesh);
      const meshIntensity = mesh.userData.painIntensity ?? currentDangerIntensity;
      const profile = getPainColorProfile(meshIntensity);

      materialsOf(mesh.material).forEach((mat) => {
        if (mat instanceof THREE.MeshStandardMaterial) {
          if (isShell) {
            mat.emissive.copy(profile.color);
            mat.emissiveIntensity = 0.75 + pulseFactor * 0.75;
            mat.opacity = 0.75 + pulseFactor * 0.15;
            mat.wireframe = true; // 외피 그물망 필수 유지
          } else {
            mat.emissive.copy(profile.color);
            mat.emissiveIntensity = intensity;
            mat.opacity = currentOpacity;
          }
        }
      });
    });

    if (isCyanGridShellMode && activeDangerShellVertices.size > 0) {
      const blend = 0.35 + pulseFactor * 0.65;

      activeDangerShellVertices.forEach((vMap, mesh) => {
        const colAttr = mesh.geometry.attributes.color;
        if (colAttr && vMap.size > 0) {
          const arr = colAttr.array as Float32Array;
          vMap.forEach((intVal, idx) => {
            if (intVal <= 0) {
              // 정상 (0점): 평온한 기본 물빛청색 유지
              arr[idx * 3] = 0.302;
              arr[idx * 3 + 1] = 0.894;
              arr[idx * 3 + 2] = 1.000;
              return;
            }
            const profile = getPainColorProfile(intVal);
            const targetR = profile.color.r;
            const targetG = profile.color.g;
            const targetB = profile.color.b;

            arr[idx * 3] = THREE.MathUtils.lerp(0.302, targetR, blend);
            arr[idx * 3 + 1] = THREE.MathUtils.lerp(0.894, targetG, blend);
            arr[idx * 3 + 2] = THREE.MathUtils.lerp(1.000, targetB, blend);
          });
          colAttr.needsUpdate = true;
        }
      });
    }

    renderScene();
    dangerPulseFrameId = window.requestAnimationFrame(updateDangerPulse);
  };

  const startDangerPulse = (meshes: THREE.Mesh | THREE.Mesh[] = []) => {
    const list = Array.isArray(meshes) ? meshes : [meshes];
    list.forEach((m) => dangerPulsingMeshes.add(m));
    dangerPulseStartTime = performance.now();
    isDangerPulsePaused = false;
    if (dangerPulseFrameId === undefined && (dangerPulsingMeshes.size > 0 || getActiveDangerShellVertexCount() > 0)) {
      dangerPulseFrameId = window.requestAnimationFrame(updateDangerPulse);
    }
  };

  const pauseDangerPulse = () => {
    isDangerPulsePaused = true;
    if (dangerPulseFrameId !== undefined) {
      window.cancelAnimationFrame(dangerPulseFrameId);
      dangerPulseFrameId = undefined;
    }
  };

  const resumeDangerPulse = () => {
    if (dangerPulsingMeshes.size > 0 && isDangerPulsePaused) {
      isDangerPulsePaused = false;
      dangerPulseStartTime = performance.now();
      if (dangerPulseFrameId === undefined) {
        dangerPulseFrameId = window.requestAnimationFrame(updateDangerPulse);
      }
    }
  };

  const stopDangerPulse = () => {
    if (dangerPulseFrameId !== undefined) {
      window.cancelAnimationFrame(dangerPulseFrameId);
      dangerPulseFrameId = undefined;
    }
    dangerPulseStartTime = undefined;
    isDangerPulsePaused = false;
    dangerPulsingMeshes.clear();
  };

  const restoreDangerOrganHighlights = () => {
    dangerPulsingMeshes.forEach((mesh) => {
      applyDangerHighlightToMesh(mesh, currentDangerIntensity);
    });
  };

  let isFasciaHidden = false;
  let isPeritoneumHidden = false;
  const applyMeshVisibility = (mesh: THREE.Mesh) => {
    if (dangerPulsingMeshes.has(mesh)) {
      mesh.visible = true;
      return;
    }

    // 안구 구조(공막 흰자위, 올리브 홍채, 투명 각막 등)는 얼굴의 핵심 시각 기준점이므로
    // 신경계(nervous) 토글에 의해 꺼지지 않고 항상 자연스럽게 표시하되,
    // 홍채 시야를 가리는 전안부/후안부 구획 블록 및 내부 액체 챔버는 비표시 유지
    if (isOcularStructure(mesh.name)) {
      if (isOccludingEyeStructure(mesh.name)) {
        mesh.visible = false;
        return;
      }
      mesh.visible = true;
      return;
    }

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
  controls.addEventListener("change", requestRender);
  resize();

  let currentPixelRatio = normalPixelRatio;
  const setDynamicPixelRatio = (targetRatio: number) => {
    if (currentPixelRatio === targetRatio) return;
    currentPixelRatio = targetRatio;
    renderer.setPixelRatio(targetRatio);
    if (viewportWidth > 0 && viewportHeight > 0) {
      renderer.setSize(viewportWidth, viewportHeight, false);
    }
    renderScene();
  };

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
    stopDangerPulse();
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
      const primaryConcept = {
        canonicalConceptId: primary.info.canonicalName || primary.mesh.name,
        sourceKey: String(primary.mesh.userData.sourceKey ?? `vanatome:${manifest.id}:${manifest.version}:${primary.mesh.name}`),
        sourceMeshId: primary.mesh.name,
        label: primary.info.fullBilingualLabel,
        system: rawSystem,
        mappingStatus: (primary.info.isStandardMatched ? "canonical" : "source_fallback") as "canonical" | "source_fallback",
      };

      const relatedConcepts = activeItems.slice(1).map((item) => ({
        canonicalConceptId: item.info.canonicalName || item.mesh.name,
        sourceKey: String(item.mesh.userData.sourceKey ?? `vanatome:${manifest.id}:${manifest.version}:${item.mesh.name}`),
        sourceMeshId: item.mesh.name,
        label: item.info.fullBilingualLabel,
        system: item.info.system,
        side: item.info.side || parseBodySide(item.info.fullBilingualLabel, item.mesh.name),
        mappingStatus: (item.info.isStandardMatched ? "canonical" : "source_fallback") as "canonical" | "source_fallback",
      }));

      anatomyEvent = createAnatomyEvent({
        atlas: {
          id: manifest.id,
          version: manifest.version,
          referenceSex: manifest.referenceSex,
        },
        concept: primaryConcept,
        relatedConcepts: relatedConcepts.length > 0 ? relatedConcepts : undefined,
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
  const cyanGridMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const cyanGridHoverMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  const oliveIrisMaterialsMap = new Map<THREE.Mesh, THREE.Material | THREE.Material[]>();
  let isCyanGridShellMode = false;

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
      if (dangerPulsingMeshes.has(mesh)) {
        dangerPulsingMeshes.delete(mesh);
        if (dangerPulsingMeshes.size === 0) {
          stopDangerPulse();
        }
      }
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
      // 사용자가 새 부위를 직접 선택 -> 기존 위험 펄스 정지 및 원상 복원
      if (dangerOrganMeshes.size > 0 || dangerPulsingMeshes.size > 0) {
        stopDangerOrganHighlight();
      }

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

    // 아무것도 선택되지 않았을 때 -> 자동 투시 관찰 모드로 복귀
    checkAndRestoreAutoDangerMonitoring();

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

    restoreDangerOrganHighlights();

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

    // 모니터링 대상인 위험 장기는 X-ray 모드나 Isolate 모드에서도 고스트화되지 않고 항상 투시 발광 복원
    if (dangerPulsingMeshes.has(mesh)) {
      applyDangerHighlightToMesh(mesh, currentDangerIntensity);
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

    if (isCyanGridShellMode) {
      const sys = String(mesh.userData.structureSystem ?? "");
      const visualRole = String(mesh.userData.visualRole ?? "");
      const isSkin = visualRole === "shell" || sys === "integumentary" || /body-shell|skin/i.test(mesh.name);
      if (isSkin) {
        const gridMat = cyanGridMaterialsMap.get(mesh);
        if (gridMat) {
          mesh.material = gridMat;
          const origOrder = originalRenderOrders.get(mesh);
          if (origOrder !== undefined) mesh.renderOrder = origOrder;
          return;
        }
      }
    }

    const orig = originalMaterials.get(mesh);
    if (orig) mesh.material = orig;
    const origOrder = originalRenderOrders.get(mesh);
    if (origOrder !== undefined) mesh.renderOrder = origOrder;
  };

  const resetDangerShellColors = () => {
    if (activeDangerShellVertices.size > 0) {
      activeDangerShellVertices.forEach((vMap, mesh) => {
        const colAttr = mesh.geometry.attributes.color;
        if (colAttr && vMap.size > 0) {
          const arr = colAttr.array as Float32Array;
          vMap.forEach((_, idx) => {
            arr[idx * 3] = 0.302;
            arr[idx * 3 + 1] = 0.894;
            arr[idx * 3 + 2] = 1.000;
          });
          colAttr.needsUpdate = true;
        }
      });
      activeDangerShellVertices.clear();
    }
  };

  const stopDangerOrganHighlight = () => {
    stopDangerPulse();
    resetDangerShellColors();
    if (dangerOrganMeshes.size > 0) {
      const meshes = Array.from(dangerOrganMeshes);
      dangerOrganMeshes.clear();
      meshes.forEach((mesh) => {
        selectedMeshes.delete(mesh);
        restoreMeshMaterial(mesh);
      });
    }
    if (dangerPulsingMeshes.size > 0) {
      const meshes = Array.from(dangerPulsingMeshes);
      dangerPulsingMeshes.clear();
      meshes.forEach((mesh) => {
        selectedMeshes.delete(mesh);
        restoreMeshMaterial(mesh);
      });
    }

    if (savedHiddenSystemsBeforeDanger) {
      hiddenSystems.clear();
      savedHiddenSystemsBeforeDanger.forEach((sys) => hiddenSystems.add(sys));
      savedHiddenSystemsBeforeDanger = null;
      onHiddenSystemsChange(new Set(hiddenSystems));
      anatomyMeshes.forEach(applyMeshVisibility);
    } else if (hiddenSystems.has("integumentary")) {
      hiddenSystems.delete("integumentary");
      onHiddenSystemsChange(new Set(hiddenSystems));
      anatomyMeshes.forEach(applyMeshVisibility);
    }
    renderScene();
  };

  const checkAndRestoreAutoDangerMonitoring = (options: {
    animateCamera?: boolean;
    painIntensity?: number;
    organIntensities?: Record<string, number>;
  } = {}) => {
    const key = getHighlightOrganKey?.();
    if (
      stagedItemsMap.size === 0 &&
      selectedMeshes.size === 0 &&
      paintHistory.length === 0 &&
      draftPaintedMap.size === 0 &&
      key
    ) {
      const intensity = getHighlightPainIntensity?.() ?? currentDangerIntensity;
      const organIntensities = getHighlightOrganIntensities?.();
      selectDangerOrganRef.current(key, {
        painIntensity: intensity,
        organIntensities,
        ...options,
      });
    }
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

    checkAndRestoreAutoDangerMonitoring();
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

    if (paintHistory.length === 0 && draftPaintedMap.size === 0) {
      checkAndRestoreAutoDangerMonitoring();
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
  };

  undoPaintRef.current = undoPaint;
  clearPaintRef.current = clearPaint;

  const createAdaptiveHoverMaterials = (mesh: THREE.Mesh, orig: THREE.Material | THREE.Material[]) => {
    // 모니터링 투시 대상인 위험 장기는 일반 노란색으로 바뀌지 않고 강렬한 붉은빛 호버 피드백 유지
    if (dangerPulsingMeshes.has(mesh)) {
      return createDangerOrganHoverMaterials(orig);
    }
    if (isCyanGridShellMode) {
      const sys = String(mesh.userData.structureSystem ?? "");
      const visualRole = String(mesh.userData.visualRole ?? "");
      const isSkin = visualRole === "shell" || sys === "integumentary" || /body-shell|skin/i.test(mesh.name);
      if (isSkin) {
        const gridMat = cyanGridMaterialsMap.get(mesh);
        if (gridMat instanceof THREE.MeshStandardMaterial) {
          let hoverGrid = cyanGridHoverMaterialsMap.get(mesh);
          if (!hoverGrid) {
            hoverGrid = gridMat.clone();
            ownedMaterials.add(hoverGrid);
            (hoverGrid as THREE.MeshStandardMaterial).color.setHex(0xffffff);
            (hoverGrid as THREE.MeshStandardMaterial).emissive.setHex(0x06b6d4);
            (hoverGrid as THREE.MeshStandardMaterial).emissiveIntensity = 0.9;
            (hoverGrid as THREE.MeshStandardMaterial).wireframe = true;
            (hoverGrid as THREE.MeshStandardMaterial).vertexColors = true;
            (hoverGrid as THREE.MeshStandardMaterial).transparent = true;
            (hoverGrid as THREE.MeshStandardMaterial).opacity = 0.75;
            (hoverGrid as THREE.MeshStandardMaterial).depthWrite = false;
            (hoverGrid as THREE.MeshStandardMaterial).depthTest = true;
            (hoverGrid as THREE.MeshStandardMaterial).side = THREE.DoubleSide;
            cyanGridHoverMaterialsMap.set(mesh, hoverGrid);
          }
          return hoverGrid;
        }
      }
    }
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
    checkAndRestoreAutoDangerMonitoring();
    onRecentlyAddedStaged?.(null);
  };

  confirmDepthCandidatesRef.current = () => {
    if (currentDepthCandidates.length === 0) return;
    const transferredItems: StagingItem[] = [];
    const candidatesSnapshot = [...currentDepthCandidates];
    const selectedIdsSnapshot = new Set(selectedDepthCandidateNames);

    if (selectedDepthCandidateNames.size > 0) {
      stopDangerOrganHighlight();
    }

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

    restoreDangerOrganHighlights();

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

    restoreDangerOrganHighlights();

    checkAndRestoreAutoDangerMonitoring();
    renderScene();
    emitStagedSummary();
    updateHistoryState();
  };

  clearAllStagedItemsRef.current = () => {
    const key = getHighlightOrganKey?.();

    if (
      stagedItemsMap.size === 0 &&
      selectedMeshes.size === 0 &&
      currentDepthCandidates.length === 0 &&
      draftPaintedMap.size === 0 &&
      paintHistory.length === 0
    ) {
      if (key) {
        selectDangerOrganRef.current(key, { animateCamera: true });
      } else if (transitionToFocusFn) {
        transitionToFocusFn("full", { duration: 750 });
      }
      return;
    }

    clearPaint();

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

    selectedMeshes.forEach((mesh) => {
      restoreMeshMaterial(mesh);
    });
    selectedMeshes.clear();

    if (items.length > 0) {
      undoHistory.push({ type: "clear_all_staged", items });
      redoHistory.length = 0;
    }

    clearCandidatePreviewMaterials();
    currentDepthCandidates = [];
    selectedDepthCandidateNames.clear();
    currentDepthAnchorMeshName = null;
    setSelectedDepthCandidateIds(new Set());
    onDepthCandidatesChange([]);
    onRecentlyAddedStaged?.(null);

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

    // 빠른확대 '전체' 카메라워크 애니메이션을 수행하며 실제로 자동 관찰 모드로 복귀
    if (key) {
      selectDangerOrganRef.current(key, { animateCamera: true });
    } else if (transitionToFocusFn) {
      transitionToFocusFn("full", { duration: 750 });
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

    restoreDangerOrganHighlights();

    checkAndRestoreAutoDangerMonitoring();
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

    restoreDangerOrganHighlights();

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

    restoreDangerOrganHighlights();

    renderScene();
  };

  const ensureSkinMeshColorAttribute = (mesh: THREE.Mesh) => {
    const count = mesh.geometry.attributes.position.count;
    const colAttr = mesh.geometry.attributes.color;
    if (!colAttr || colAttr.count !== count) {
      const arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        arr[i * 3] = 0.302;
        arr[i * 3 + 1] = 0.894;
        arr[i * 3 + 2] = 1.000;
      }
      mesh.geometry.setAttribute("color", new THREE.BufferAttribute(arr, 3));
      mesh.userData.__cyanGridColorInitialized = true;
    } else if (mesh.userData.__cyanGridColorInitialized !== true) {
      // GLB에 이미 존재하는 COLOR_0(기본 흰색 1,1,1 손가락·발가락 등 12개 메시)을 물빛청색으로 명시 초기화
      const arr = colAttr.array as Float32Array;
      for (let i = 0; i < count; i++) {
        arr[i * 3] = 0.302;
        arr[i * 3 + 1] = 0.894;
        arr[i * 3 + 2] = 1.000;
      }
      colAttr.needsUpdate = true;
      mesh.userData.__cyanGridColorInitialized = true;
    }
  };

  toggleCyanGridShellRef.current = (active: boolean) => {
    isCyanGridShellMode = active;
    if (active) {
      if (hiddenSystems.has("integumentary")) {
        hiddenSystems.delete("integumentary");
        onHiddenSystemsChange(new Set(hiddenSystems));
      }
      anatomyMeshes.forEach((mesh) => {
        const sys = String(mesh.userData.structureSystem ?? "");
        const visualRole = String(mesh.userData.visualRole ?? "");
        const isSkin = visualRole === "shell" || sys === "integumentary" || /body-shell|skin/i.test(mesh.name);
        if (!isSkin) return;

        ensureSkinMeshColorAttribute(mesh);

        if (!cyanGridMaterialsMap.has(mesh)) {
          const gridMat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            emissive: new THREE.Color(0x0e7490),
            emissiveIntensity: 0.45,
            wireframe: true,
            vertexColors: true,
            transparent: true,
            opacity: 0.55,
            depthWrite: false,
            depthTest: true,
            side: THREE.DoubleSide,
          });
          ownedMaterials.add(gridMat);
          cyanGridMaterialsMap.set(mesh, gridMat);
        }
        mesh.material = cyanGridMaterialsMap.get(mesh)!;
        mesh.visible = true;
      });
    } else {
      resetDangerShellColors();
      anatomyMeshes.forEach((mesh) => {
        const sys = String(mesh.userData.structureSystem ?? "");
        const visualRole = String(mesh.userData.visualRole ?? "");
        const isSkin = visualRole === "shell" || sys === "integumentary" || /body-shell|skin/i.test(mesh.name);
        if (!isSkin) return;

        const orig = originalMaterials.get(mesh);
        if (orig) mesh.material = orig;
        applyMeshVisibility(mesh);
      });
    }
    const curKey = getHighlightOrganKey?.();
    if (curKey) {
      selectDangerOrganRef.current(curKey, {
        painIntensity: getHighlightPainIntensity?.(),
        organIntensities: getHighlightOrganIntensities?.(),
      });
    }
    renderScene();
  };

  toggleOliveIrisRef.current = (active: boolean) => {
    if (active) {
      let systemsChanged = false;
      if (hiddenSystems.has("sensory")) {
        hiddenSystems.delete("sensory");
        systemsChanged = true;
      }
      if (hiddenSystems.has("nervous")) {
        hiddenSystems.delete("nervous");
        systemsChanged = true;
      }
      if (systemsChanged) {
        onHiddenSystemsChange(new Set(hiddenSystems));
      }
      anatomyMeshes.forEach((mesh) => {
        if (!isOcularStructure(mesh.name)) return;
        if (isOccludingEyeStructure(mesh.name)) {
          mesh.visible = false;
          return;
        }

        if (!oliveIrisMaterialsMap.has(mesh)) {
          // Human Atlas (BodyParts3D) / bubblik525/head 표준: 소프트 아이보리 흰자위(sclera: 0xddd9ca), 올리브/세이지 그린 홍채(iris: 0x47685e), 투명 각막(cornea: 0xc0dce1)
          const baseMat = originalMaterials.get(mesh) ?? mesh.material;
          const ocularMat = createOcularMaterials(baseMat, mesh.name, ownedMaterials);
          const singleMat = Array.isArray(ocularMat) ? ocularMat[0] : ocularMat;
          oliveIrisMaterialsMap.set(mesh, singleMat);
        }
        mesh.material = oliveIrisMaterialsMap.get(mesh)!;
        if (/iris|pupil/i.test(mesh.name)) {
          mesh.renderOrder = 2;
        } else if (/cornea/i.test(mesh.name)) {
          mesh.renderOrder = 3;
        } else {
          mesh.renderOrder = 1;
        }
        mesh.visible = true;
      });
    } else {
      anatomyMeshes.forEach((mesh) => {
        if (oliveIrisMaterialsMap.has(mesh)) {
          const orig = originalMaterials.get(mesh);
          if (orig) mesh.material = orig;
          applyMeshVisibility(mesh);
        }
      });
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

  selectDangerOrganRef.current = (
    organKey: string,
    options: {
      animateCamera?: boolean;
      painIntensity?: number;
      organIntensities?: Record<string, number>;
    } = {},
  ) => {
    const rawKeys = organKey
      .split(/[,+&|]/)
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    if (rawKeys.length === 0) {
      stopDangerOrganHighlight();
      renderScene();
      return false;
    }

    // 좌/우 측면성(laterality) 판별
    const hasLeft = rawKeys.some((k) => k === "left" || k.startsWith("left_") || k.includes("왼쪽") || k.includes("좌측") || k.includes("(좌)"));
    const hasRight = rawKeys.some((k) => k === "right" || k.startsWith("right_") || k.includes("오른쪽") || k.includes("우측") || k.includes("(우)"));
    const targetSide: "left" | "right" | "both" = (hasLeft && !hasRight) ? "left" : (hasRight && !hasLeft) ? "right" : "both";

    // 접두사(left_/right_)가 제거된 순수 해부학 키 목록
    const normalizedKeys = rawKeys.map((k) => k.replace(/^(?:left|right)_/, ""));

    const getMeshSide = (name: string): "left" | "right" | "midline" | "unknown" => {
      const lower = name.toLowerCase();
      if (lower.includes("왼쪽") || lower.includes("(좌)") || lower.includes("좌측")) return "left";
      if (lower.includes("오른쪽") || lower.includes("(우)") || lower.includes("우측")) return "right";
      if (lower.includes("중앙") || lower.includes("정중") || lower.includes("척추") || lower.includes("spine") || lower.includes("vertebra")) return "midline";

      // Z-Anatomy 표준 작명 규칙: .l, _l, 접미 l (예: Deltoid_regionl, Posterior_region_of_arml)
      if (
        lower.endsWith(".l") ||
        lower.endsWith("_l") ||
        lower.includes(".l.") ||
        lower.includes("_l_") ||
        lower.includes("left") ||
        (lower.endsWith("l") && !lower.endsWith("oral") && !lower.endsWith("heel") && !lower.endsWith("skull") && !lower.endsWith("canal") && !lower.endsWith("vessel"))
      ) {
        return "left";
      }

      // Z-Anatomy 표준 작명 규칙: .r, _r, 접미 r (예: Deltoid_regionr, Posterior_region_of_armr)
      if (
        lower.endsWith(".r") ||
        lower.endsWith("_r") ||
        lower.includes(".r.") ||
        lower.includes("_r_") ||
        lower.includes("right") ||
        (lower.endsWith("r") && !lower.endsWith("posterior") && !lower.endsWith("anterior") && !lower.endsWith("superficial") && !lower.endsWith("intercondylar"))
      ) {
        return "right";
      }

      return "unknown";
    };

    const includesSkeletal = normalizedKeys.some(
      (k) =>
        k.includes("cervical") ||
        k.includes("spine") ||
        k.includes("skelet") ||
        k.includes("경추") ||
        k.includes("척추") ||
        k.includes("knee") ||
        k.includes("무릎") ||
        k.includes("shoulder") ||
        k.includes("어깨") ||
        k.includes("jaw") ||
        k.includes("턱") ||
        k.includes("scalp") ||
        k.includes("두피") ||
        k.includes("머리") ||
        k.includes("hand") ||
        k.includes("손") ||
        k.includes("foot") ||
        k.includes("발") ||
        k.includes("pelvis") ||
        k.includes("골반") ||
        k.includes("lumbar") ||
        k.includes("요추"),
    );
    const includesJoints = normalizedKeys.some(
      (k) =>
        k.includes("joint") ||
        k.includes("관절") ||
        k.includes("knee") ||
        k.includes("무릎") ||
        k.includes("shoulder") ||
        k.includes("어깨") ||
        k.includes("wrist") ||
        k.includes("손목") ||
        k.includes("ankle") ||
        k.includes("발목"),
    );
    const includesNervous = normalizedKeys.some(
      (k) =>
        k.includes("nerv") ||
        k.includes("신경") ||
        k.includes("brain") ||
        k.includes("뇌"),
    );

    if (!savedHiddenSystemsBeforeDanger) {
      savedHiddenSystemsBeforeDanger = new Set(hiddenSystems);
    }

    // 모니터링 투시 모드: 대상 시스템과 신체 피부(integumentary)를 활성화
    if (isCyanGridShellMode) {
      ANATOMY_SYSTEM_LAYERS.forEach((layer) => {
        if (layer.id !== "integumentary") {
          hiddenSystems.add(layer.id);
        }
      });
      hiddenSystems.delete("integumentary");
      onHiddenSystemsChange(new Set(hiddenSystems));
    } else {
      ANATOMY_SYSTEM_LAYERS.forEach((layer) => {
        if (layer.id === "integumentary") return;
        if (includesSkeletal && layer.id === "skeletal") return;
        if (includesJoints && layer.id === "joints") return;
        if (includesNervous && layer.id === "nervous") return;
        hiddenSystems.add(layer.id);
      });
      hiddenSystems.delete("integumentary");
      if (includesSkeletal) hiddenSystems.delete("skeletal");
      if (includesJoints) hiddenSystems.delete("joints");
      if (includesNervous) hiddenSystems.delete("nervous");
      onHiddenSystemsChange(new Set(hiddenSystems));
    }

    const isMeshMatched = (m: THREE.Mesh) => {
      const id = String(m.userData.anatomyId ?? m.name ?? "");
      const s = id.toLowerCase();
      const sys = String(m.userData.structureSystem ?? "").toLowerCase();

      // 측면성 불일치 내부 메시는 제외
      const meshSide = getMeshSide(m.name || id);
      if (targetSide === "left" && meshSide === "right") return false;
      if (targetSide === "right" && meshSide === "left") return false;

      // 비신경/비골격 구조물 필터링 플래그 (근육·혈관·근막 오탐 배제)
      const isMuscular = sys === "muscular" || s.includes("muscle") || s.includes("근육");
      const isVascular =
        sys === "cardiovascular" ||
        s.includes("artery") ||
        s.includes("vein") ||
        s.includes("동맥") ||
        s.includes("정맥");
      const isConnective =
        sys === "joints" ||
        s.includes("fascia") ||
        s.includes("bursa") ||
        s.includes("근막") ||
        s.includes("점액낭");

      // 그리드 외피 모드(모니터링)에서는 세밀한 근육/혈관/신경/결합조직/사지골격을 내부에서 솔리드 색상으로 덕지덕지 보여주지 않고,
      // 오직 실제 주요 장기(내장기관: 폐, 간, 심장, 위, 신장, 대장, 췌장, 담낭 등)만 내부에서 투시하고,
      // 팔/다리/손/목 등 사지 및 체표 통증/증상은 외피 그리드 와이어프레임 발광으로 단순화
      if (isCyanGridShellMode) {
        if (isMuscular || isVascular || isConnective) return false;
        if (sys === "nervous" || sys === "skeletal") return false;
      }

      return normalizedKeys.some((targetKey) => {
        if (targetKey === "liver" || targetKey === "간") {
          return s.includes("liver") || s.includes("vh_o_liver") || s.includes("간");
        }
        if (targetKey === "lung" || targetKey === "폐") {
          return s.includes("lung") || s.includes("vh_o_lung") || s.includes("폐");
        }
        if (targetKey === "stomach" || targetKey === "위") {
          return s.includes("stomach") || s.includes("vh_o_stomach") || s.includes("위");
        }
        if (targetKey === "heart" || targetKey === "심장") {
          return s.includes("heart") || s.includes("vh_o_heart") || s.includes("심장");
        }
        if (targetKey === "kidney" || targetKey === "신장" || targetKey === "콩팥") {
          return s.includes("kidney") || s.includes("vh_o_kidney") || s.includes("신장") || s.includes("콩팥");
        }
        if (targetKey === "colon" || targetKey === "대장" || targetKey === "결장" || targetKey === "직장") {
          return (
            s.includes("colon") ||
            s.includes("large_intestine") ||
            s.includes("large-intestine") ||
            s.includes("대장") ||
            s.includes("결장") ||
            s.includes("직장") ||
            s.includes("rectum")
          );
        }
        if (targetKey === "pancreas" || targetKey === "췌장") {
          return s.includes("pancreas") || s.includes("췌장");
        }
        if (targetKey === "gallbladder" || targetKey === "담낭" || targetKey === "쓸개") {
          return s.includes("gallbladder") || s.includes("담낭") || s.includes("쓸개");
        }
        if (targetKey === "brain" || targetKey === "뇌") {
          return s.includes("brain") || s.includes("cerebrum") || s.includes("뇌");
        }
        if (
          targetKey === "cervical_spine" ||
          targetKey === "cervical" ||
          targetKey === "경추" ||
          targetKey === "spine"
        ) {
          // 경추 골격/신경근: 혈관(동맥/정맥)이나 근육, 근막은 배제
          if (isVascular || isMuscular || isConnective) return false;
          return (
            s.includes("cervical") ||
            s.includes("경추") ||
            s.includes("atlas") ||
            s.includes("axis") ||
            (s.includes("vertebra") &&
              (s.includes("c1") ||
                s.includes("c2") ||
                s.includes("c3") ||
                s.includes("c4") ||
                s.includes("c5") ||
                s.includes("c6") ||
                s.includes("c7")))
          );
        }
        if (
          targetKey === "nervous" ||
          targetKey === "신경" ||
          targetKey === "신경근" ||
          targetKey === "nerve" ||
          targetKey === "spinal_cord"
        ) {
          // 신경 구조물: 근육, 혈관, 근막, 관절낭 등 비신경 조직 엄격 배제!
          if (isMuscular || isVascular || isConnective) return false;

          // 신경계 계통 메시 우선 (장기처럼 신경도 직접 발광)
          if (sys === "nervous") {
            return true;
          }

          // C8-척골신경, 상완신경총, 척수, 말초신경, 경추 신경근 등
          return (
            s.includes("ulnar_nerve") ||
            s.includes("ulnar nerve") ||
            s.includes("brachial plexus") ||
            s.includes("roots of brachial plexus") ||
            s.includes("spinal_cord") ||
            s.includes("신경") ||
            s.includes("척수") ||
            (s.includes("nerv") && !s.includes("innervat"))
          );
        }
        if (targetKey === "knee" || targetKey === "무릎" || targetKey === "슬관절") {
          return s.includes("patella") || s.includes("knee") || s.includes("무릎") || s.includes("femur") || s.includes("tibia") || s.includes("meniscus");
        }
        if (targetKey === "jaw" || targetKey === "턱" || targetKey === "하악" || targetKey === "악관절") {
          return s.includes("mandible") || s.includes("maxilla") || s.includes("턱") || s.includes("temporomandibular");
        }
        if (targetKey === "scalp" || targetKey === "두피" || targetKey === "두개골" || targetKey === "머리") {
          return s.includes("cranium") || s.includes("skull") || s.includes("scalp") || s.includes("두개골") || s.includes("두피") || s.includes("머리");
        }
        if (targetKey === "shoulder" || targetKey === "어깨") {
          return s.includes("clavicle") || s.includes("scapula") || s.includes("shoulder") || s.includes("어깨") || s.includes("humerus") || s.includes("deltoid");
        }
        if (targetKey === "hand" || targetKey === "손" || targetKey === "손가락" || targetKey === "손목") {
          if (isCyanGridShellMode) return false;
          return s.includes("carpal") || s.includes("metacarpal") || s.includes("phalanx") || s.includes("hand") || s.includes("손");
        }
        if (targetKey === "foot" || targetKey === "발" || targetKey === "발목" || targetKey === "발가락") {
          return s.includes("tarsal") || s.includes("metatarsal") || s.includes("foot") || s.includes("발") || s.includes("calcaneus");
        }
        if (targetKey === "spine" || targetKey === "척추" || targetKey === "허리" || targetKey === "요추") {
          return s.includes("vertebra") || s.includes("lumbar") || s.includes("척추") || s.includes("요추") || s.includes("spine");
        }
        if (targetKey === "pelvis" || targetKey === "골반" || targetKey === "고관절") {
          return s.includes("pelvis") || s.includes("ilium") || s.includes("ischium") || s.includes("pubis") || s.includes("골반") || s.includes("hip");
        }
        return s.includes(targetKey);
      });
    };

    const matchedMeshes: THREE.Mesh[] = anatomyMeshes.filter((m) => isMeshMatched(m));

    if (matchedMeshes.length === 0) {
      scene.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          if (isMeshMatched(obj) && !matchedMeshes.includes(obj)) {
            matchedMeshes.push(obj);
          }
        }
      });
    }

    if (matchedMeshes.length === 0 && (normalizedKeys.includes("all") || normalizedKeys.includes("general") || normalizedKeys.length > 0)) {
      // 일반 기록 모니터링: 뷰어 신체 표면을 매칭하여 자동 관찰 모드 유지
      anatomyMeshes.forEach((m) => {
        if (isShellOrSurface(m) && !matchedMeshes.includes(m)) {
          matchedMeshes.push(m);
        }
      });
    }

    const computeDangerShellVertices = (
      _keys: string[],
      organIntensities?: Record<string, number>,
      defaultIntensity?: number,
    ) => {
      resetDangerShellColors();
      const skinMeshes = anatomyMeshes.filter((m) => {
        const sys = String(m.userData.structureSystem ?? "");
        const visualRole = String(m.userData.visualRole ?? "");
        return visualRole === "shell" || sys === "integumentary" || /body-shell|skin/i.test(m.name);
      });
      if (skinMeshes.length === 0) return;

      const getRegionIntensity = (regionKeys: string[]): number => {
        if (organIntensities) {
          for (const k of regionKeys) {
            if (typeof organIntensities[k] === "number") return organIntensities[k];
            if (typeof organIntensities[`left_${k}`] === "number") return organIntensities[`left_${k}`];
            if (typeof organIntensities[`right_${k}`] === "number") return organIntensities[`right_${k}`];
          }
        }
        return typeof defaultIntensity === "number" ? defaultIntensity : 10;
      };

      const isShoulder = normalizedKeys.some((k) => k.includes("shoulder") || k.includes("어깨") || k.includes("deltoid") || k.includes("견갑"));
      const isArm = isShoulder || normalizedKeys.some((k) => k.includes("arm") || k.includes("팔") || k.includes("hand") || k.includes("손") || k.includes("wrist") || k.includes("손목"));
      const isHandOnly = normalizedKeys.some((k) => k.includes("hand") || k.includes("손") || k.includes("wrist") || k.includes("손목")) && !normalizedKeys.some((k) => k.includes("arm") || k.includes("팔") || k.includes("shoulder") || k.includes("어깨") || k.includes("deltoid"));
      const isNeckOnly = normalizedKeys.some((k) => k.includes("cervical") || k.includes("경추") || k.includes("neck") || k.includes("목")) && !normalizedKeys.some((k) => k.includes("arm") || k.includes("팔") || k.includes("shoulder") || k.includes("hand") || k.includes("손"));
      const isChest = normalizedKeys.some((k) => k.includes("lung") || k.includes("폐") || k.includes("chest") || k.includes("thorax") || k.includes("가슴") || k.includes("흉부") || k.includes("rib"));
      const isAbdomen = normalizedKeys.some((k) => k.includes("abdomen") || k.includes("복부") || k.includes("배") || k.includes("liver") || k.includes("간") || k.includes("stomach") || k.includes("위"));
      const isKnee = normalizedKeys.some((k) => k.includes("knee") || k.includes("무릎"));
      const isFoot = normalizedKeys.some((k) => k.includes("foot") || k.includes("발"));
      const isHead = normalizedKeys.some((k) => k.includes("head") || k.includes("머리") || k.includes("두통") || k.includes("scalp"));

      if (!isArm && !isHandOnly && !isNeckOnly && !isChest && !isAbdomen && !isKnee && !isFoot && !isHead) {
        return;
      }

      const bounds = currentBodyBounds || new THREE.Box3().setFromObject(skinMeshes[0]);
      const size = bounds.getSize(new THREE.Vector3());
      const center = bounds.getCenter(new THREE.Vector3());
      const tempV = new THREE.Vector3();

      skinMeshes.forEach((mesh) => {
        ensureSkinMeshColorAttribute(mesh);
        const posAttr = mesh.geometry.attributes.position;
        if (!posAttr) return;
        const vertexCount = posAttr.count;
        const nameLower = mesh.name.toLowerCase();

        const meshSide = getMeshSide(mesh.name);
        // 측면성 불일치 외피 메시는 즉시 제외 (예: targetSide가 left면 right 외피 메시 완전 배제)
        if (targetSide === "left" && meshSide === "right") return;
        if (targetSide === "right" && meshSide === "left") return;

        // 1) 개별 분할 외피 메시 이름 기준 직접 매칭
        const isHandMesh = (nameLower.includes("hand") || nameLower.includes("digit") || nameLower.includes("palm") || nameLower.includes("wrist") || ((nameLower.includes("nail") || nameLower.includes("perionyx")) && !nameLower.includes("foot"))) && !nameLower.includes("foot");
        const isShoulderMesh = nameLower.includes("shoulder") || nameLower.includes("deltoid") || nameLower.includes("clavic") || nameLower.includes("scapul");
        const isArmMesh = isHandMesh || isShoulderMesh || nameLower.includes("arm") || nameLower.includes("elbow") || nameLower.includes("forearm");
        const isNeckMesh = nameLower.includes("neck") || nameLower.includes("cervical");
        const isChestMesh = nameLower.includes("chest") || nameLower.includes("thorax") || nameLower.includes("pectoral") || nameLower.includes("rib");
        const isAbdomenMesh = nameLower.includes("abdomen") || nameLower.includes("belly") || nameLower.includes("epigastric");
        const isKneeMesh = nameLower.includes("knee") || nameLower.includes("patella");
        const isFootMesh = nameLower.includes("foot") || nameLower.includes("toe") || nameLower.includes("sole") || nameLower.includes("heel") || nameLower.includes("ankle") || ((nameLower.includes("nail") || nameLower.includes("perionyx")) && nameLower.includes("foot"));
        const isHeadMesh = nameLower.includes("head") || nameLower.includes("scalp") || nameLower.includes("face") || nameLower.includes("cranial") || nameLower.includes("skull") || nameLower.includes("oral") || nameLower.includes("auricle");

        const vMap = new Map<number, number>();
        let fullyMatched = false;
        let fullIntensity = 10;

        const canFullyMatch = targetSide === "both" || meshSide === targetSide;

        if (canFullyMatch) {
          if (isHandOnly && isHandMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["hand", "손", "wrist", "손목"]);
          } else if (isShoulder && isShoulderMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["shoulder", "어깨", "deltoid"]);
          } else if (isArm && isArmMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["arm", "팔", "shoulder", "어깨", "hand", "손"]);
          } else if (isNeckOnly && isNeckMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["cervical", "경추", "neck", "목"]);
          } else if (isChest && isChestMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["lung", "폐", "chest", "thorax", "가슴", "흉부"]);
          } else if (isAbdomen && isAbdomenMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["abdomen", "복부", "배", "liver", "간", "stomach", "위"]);
          } else if (isKnee && isKneeMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["knee", "무릎"]);
          } else if (isFoot && isFootMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["foot", "발"]);
          } else if (isHead && isHeadMesh) {
            fullyMatched = true;
            fullIntensity = getRegionIntensity(["head", "머리", "두통", "scalp"]);
          }
        }

        if (fullyMatched) {
          for (let i = 0; i < vertexCount; i++) {
            vMap.set(i, fullIntensity);
          }
        } else {
          // 2) 단일 통 외피(여성형 아틀라스 등) 또는 복합 정점 좌표 기반 공간 매칭
          mesh.updateMatrixWorld(true);
          const matrixWorld = mesh.matrixWorld;

          for (let i = 0; i < vertexCount; i++) {
            tempV.fromBufferAttribute(posAttr, i).applyMatrix4(matrixWorld);

            // 환자 기준 좌우 필터링 (Three.js anterior 뷰: 좌측 tempV.x > center.x, 우측 tempV.x < center.x)
            if (targetSide === "left" && tempV.x <= center.x) continue;
            if (targetSide === "right" && tempV.x >= center.x) continue;

            const dx = Math.abs(tempV.x - center.x);
            const dy = tempV.y;

            let matched = false;
            let matchedIntensity = 10;

            if (isHandOnly) {
              if (dx > size.x * 0.16 && dy <= center.y + size.y * 0.08 && dy >= center.y - size.y * 0.42) {
                matched = true;
                matchedIntensity = getRegionIntensity(["hand", "손", "wrist", "손목"]);
              }
            } else if (isArm) {
              if (dx > size.x * 0.12 && dy <= center.y + size.y * 0.33 && dy >= center.y - size.y * 0.42) {
                matched = true;
                matchedIntensity = getRegionIntensity(["arm", "팔", "shoulder", "어깨", "hand", "손"]);
              }
            } else if (isNeckOnly) {
              if (dx <= size.x * 0.16 && dy >= center.y + size.y * 0.26 && dy <= center.y + size.y * 0.38) {
                matched = true;
                matchedIntensity = getRegionIntensity(["cervical", "경추", "neck", "목"]);
              }
            }

            if (!matched && isChest) {
              if (dx <= size.x * 0.22 && dy >= center.y - size.y * 0.04 && dy <= center.y + size.y * 0.24 && tempV.z > center.z - size.z * 0.12) {
                matched = true;
                matchedIntensity = getRegionIntensity(["lung", "폐", "chest", "thorax", "가슴", "흉부"]);
              }
            }

            if (!matched && isAbdomen) {
              if (dx <= size.x * 0.20 && dy >= center.y - size.y * 0.20 && dy < center.y - size.y * 0.04 && tempV.z > center.z - size.z * 0.12) {
                matched = true;
                matchedIntensity = getRegionIntensity(["abdomen", "복부", "배", "liver", "간", "stomach", "위"]);
              }
            }

            if (!matched && isKnee && Math.abs(dy - (center.y - size.y * 0.31)) <= size.y * 0.09) {
              matched = true;
              matchedIntensity = getRegionIntensity(["knee", "무릎"]);
            }
            if (!matched && isFoot && dy <= bounds.min.y + size.y * 0.18) {
              matched = true;
              matchedIntensity = getRegionIntensity(["foot", "발"]);
            }
            if (!matched && isHead && dy >= center.y + size.y * 0.35) {
              matched = true;
              matchedIntensity = getRegionIntensity(["head", "머리", "두통", "scalp"]);
            }

            if (matched) {
              vMap.set(i, matchedIntensity);
            }
          }
        }

        if (vMap.size > 0) {
          activeDangerShellVertices.set(mesh, vMap);
        }
      });
    };

    stopDangerOrganHighlight();

    if (isCyanGridShellMode) {
      computeDangerShellVertices(rawKeys, options.organIntensities, options.painIntensity);
    }

    if (matchedMeshes.length > 0 || getActiveDangerShellVertexCount() > 0) {
      currentDangerIntensity = options.painIntensity;

      dangerOrganMeshes.clear();
      matchedMeshes.forEach((mesh) => {
        dangerOrganMeshes.add(mesh);
        let meshIntensity = options.painIntensity;
        if (options.organIntensities) {
          const mName = mesh.name.toLowerCase();
          const aId = String(mesh.userData.anatomyId ?? "").toLowerCase();
          for (const [k, int] of Object.entries(options.organIntensities)) {
            const kLower = k.toLowerCase().replace(/^(left_|right_)/, "");
            if (mName.includes(kLower) || aId.includes(kLower)) {
              meshIntensity = int;
              break;
            }
          }
        }
        applyDangerHighlightToMesh(mesh, meshIntensity);
      });

      if (typeof options.painIntensity !== "number" || options.painIntensity > 0 || getActiveDangerShellVertexCount() > 0) {
        startDangerPulse(matchedMeshes);
      }

      // 모니터링 대상 장기 및 피부 외 다른 계통(뼈 포함) 숨김 동기화
      anatomyMeshes.forEach(applyMeshVisibility);

      // 자동 관찰 모드: 특정 장기에 클로즈업하지 않고, '전체' 뷰 비율로 전신 안에서 투시 관찰
      if (options.animateCamera && transitionToFocusFn) {
        transitionToFocusFn("full", { duration: 750 });
      } else if (currentFocusPresets?.full) {
        camera.position.copy(currentFocusPresets.full.position);
        controls.target.copy(currentFocusPresets.full.target);
        controls.update();
      }
      activeBodyFocus = "full";
      onFocusChange("full");
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
      stopDangerOrganHighlight();
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
      checkAndRestoreAutoDangerMonitoring();
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

    restoreDangerOrganHighlights();

    checkAndRestoreAutoDangerMonitoring();
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

    restoreDangerOrganHighlights();

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

    restoreDangerOrganHighlights();

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

    restoreDangerOrganHighlights();

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
  const tempOutlinePointer = new THREE.Vector2();

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

    // 2. 인체와 검정 배경 사이의 실제 신체 외곽선 마진 (8방향 오프셋 레이캐스팅으로 정밀 실루엣 감지)
    const bounds = canvas.getBoundingClientRect();
    const marginPx = 20; // 신체 외곽선 드래그 회전 조작을 위한 자연스러운 여유 마진 (20px)
    const dx = (marginPx / Math.max(bounds.width, 1)) * 2;
    const dy = (marginPx / Math.max(bounds.height, 1)) * 2;

    const offsets = [
      [-dx, 0], [dx, 0], [0, -dy], [0, dy],
      [-dx * 0.707, -dy * 0.707], [dx * 0.707, -dy * 0.707],
      [-dx * 0.707, dy * 0.707], [dx * 0.707, dy * 0.707],
    ];

    const activeVisibleMeshes = anatomyMeshes.filter(
      (m) =>
        m.visible &&
        (!isFasciaHidden || !isFasciaStructure(m)) &&
        (!isPeritoneumHidden || !isPeritoneumStructure(m)),
    );

    if (activeVisibleMeshes.length > 0) {
      for (let i = 0; i < offsets.length; i++) {
        tempOutlinePointer.set(pointer.x + offsets[i][0], pointer.y + offsets[i][1]);
        raycaster.setFromCamera(tempOutlinePointer, camera);
        const marginHits = raycaster.intersectObjects(activeVisibleMeshes, false);
        if (marginHits.length > 0) {
          return { zone: "outline" };
        }
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
        stopDangerOrganHighlight();
        isPainting = true;
        controls.enabled = false;
        currentStroke = { samples: [], touchedMeshes: [] };
        sprayAgitationState = createSprayAgitationState(event.clientX, event.clientY, performance.now());
        pointerGesture = {
          pointerId: event.pointerId,
          mode: "paint" as const,
          startX: event.clientX,
          startY: event.clientY,
          lastY: event.clientY,
        };
        setDynamicPixelRatio(dynamicDragPixelRatio);
        recordPaintSample(hit, 0);
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
        setDynamicPixelRatio(dynamicDragPixelRatio);
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
      setDynamicPixelRatio(dynamicDragPixelRatio);
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
      setDynamicPixelRatio(dynamicDragPixelRatio);
      if (zone === "outline") {
        canvas.style.cursor = "grabbing";
      }
      return;
    }

    // inspect 모드 배경:
    // 터치 환경(모바일)에서는 두 손가락 핀치 줌(확대/축소)과 부드러운 회전을 위해 OrbitControls에 위임
    if (event.pointerType === "touch") {
      controls.enabled = true;
      return;
    }

    // 마우스 환경에서는 배경 드래그 시 상하 카메라 이동
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
    setDynamicPixelRatio(dynamicDragPixelRatio);
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
            mesh.renderOrder = dangerPulsingMeshes.has(mesh) ? 25 : 15;
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

  let hoverFrameId: number | undefined;
  let pendingHoverEvent: PointerEvent | null = null;
  let lastHoverClientX = -9999;
  let lastHoverClientY = -9999;

  const processHover = () => {
    hoverFrameId = undefined;
    if (!pendingHoverEvent) return;
    const event = pendingHoverEvent;
    pendingHoverEvent = null;
    handleHover(event);
  };

  const requestHover = (event: PointerEvent) => {
    // 마우스 미세 떨림(2px 미만) 필터링: 제자리 떨림 시 불필요한 레이캐스팅 연산 원천 차단
    const dx = event.clientX - lastHoverClientX;
    const dy = event.clientY - lastHoverClientY;
    if (dx * dx + dy * dy < 4) return;
    lastHoverClientX = event.clientX;
    lastHoverClientY = event.clientY;

    pendingHoverEvent = event;
    if (hoverFrameId !== undefined) return;
    hoverFrameId = window.requestAnimationFrame(processHover);
  };

  const handlePointerLeave = () => {
    if (hoverFrameId !== undefined) {
      window.cancelAnimationFrame(hoverFrameId);
      hoverFrameId = undefined;
    }
    pendingHoverEvent = null;
    lastHoverClientX = -9999;
    lastHoverClientY = -9999;
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

  // 스마트 절전 1: 브라우저 탭 전환(화상회의 탭 등) 시 펄스 렌더링 즉시 0% 정지, 복귀 시 부드럽게 재개
  const handleVisibilityChange = () => {
    if (document.hidden) {
      pauseDangerPulse();
    } else {
      resumeDangerPulse();
      requestRender();
    }
  };
  document.addEventListener("visibilitychange", handleVisibilityChange);

  // 스마트 절전 2: 화면 스크롤로 3D 뷰어가 화면 밖으로 벗어나면 펄스 루프 완전 정지(GPU 0%), 재진입 시 재개
  let bodyMapVisibilityObserver: IntersectionObserver | null = null;
  if (typeof IntersectionObserver !== "undefined") {
    bodyMapVisibilityObserver = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            resumeDangerPulse();
            requestRender();
          } else {
            pauseDangerPulse();
          }
        }
      },
      { threshold: 0.05 },
    );
    bodyMapVisibilityObserver.observe(viewport ?? canvas);
  }

  const handlePointerMove = (event: PointerEvent) => {
    if (!pointerGesture || pointerGesture.pointerId !== event.pointerId) {
      if (!pointerGesture && !isPainting) {
        requestHover(event);
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
    setDynamicPixelRatio(normalPixelRatio);
    requestRender();

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
    setDynamicPixelRatio(normalPixelRatio);
    requestRender();
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
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    canvas.removeEventListener("webglcontextlost", handleContextLost);
    canvas.style.cursor = "";
    controls.removeEventListener("change", requestRender);
    if (renderFrameId !== undefined) window.cancelAnimationFrame(renderFrameId);
    if (hoverFrameId !== undefined) window.cancelAnimationFrame(hoverFrameId);
    if (handleControlsStart) controls.removeEventListener("start", handleControlsStart);
    if (handleControlsEnd) controls.removeEventListener("end", handleControlsEnd);
    if (focusAnimationFrame !== undefined) window.cancelAnimationFrame(focusAnimationFrame);
    if (poseAnimationFrame !== undefined) window.cancelAnimationFrame(poseAnimationFrame);
    stopDangerPulse();
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
    bodyMapVisibilityObserver?.disconnect();
    scene.traverse((object) => {
      if (object instanceof THREE.Mesh || object instanceof THREE.LineSegments) {
        object.geometry.dispose();
      }
    });
    sourceMaterials.forEach((material) => material.dispose());
    ownedMaterials.forEach((material) => material.dispose());
    env.texture.dispose();
    renderer.dispose();
  }

  try {
    const atlasGroup = new THREE.Group();

    let metadata: Awaited<ReturnType<typeof loadAnatomyMetadata>> = new Map();

    if (modelSource === "humanAtlas") {
      onProgress(5);
      const atlasData = await loadHumanAtlasMeshes({
        signal,
        onProgress: (pct) => {
          if (!isDisposed()) onProgress(pct);
        },
        ownedMaterials,
      });
      if (signal.aborted || isDisposed()) return cleanup;

      atlasData.meshes.forEach((object) => {
        const rawSystem = object.userData.structureSystem as string;
        const layerSystem = anatomyLayerSystem(rawSystem);
        object.userData.structureSystem = layerSystem;
        object.userData.structureLabel = object.name;
        object.userData.anatomySourceKey = object.name;
        object.userData.anatomyId = object.userData.anatomyId || object.name;
        ensureMeshBvh(object);
        anatomyMeshes.push(object);
        readySystems.add(layerSystem);
        originalMaterials.set(object, object.material);
        applyMeshVisibility(object);
        if (object.userData.visualRole === "shell") {
          object.renderOrder = 5;
        } else if (isOcularStructure(object.name)) {
          if (isOccludingEyeStructure(object.name)) {
            object.visible = false;
            object.userData.contextVisible = false;
          } else if (/iris|pupil/i.test(object.name)) {
            object.renderOrder = 2;
          } else if (/cornea/i.test(object.name)) {
            object.renderOrder = 3;
          } else {
            object.renderOrder = 1;
          }
        }
        selectableMeshes.push(object);
        atlasGroup.add(object);
      });
    } else {
      const [loadedMetadata, loadedAssets] = await Promise.all([
        metadataPromise,
        Promise.all(manifest.assets.map(async (asset) => ({ asset, ...await loadAsset(asset) }))),
      ]);
      metadata = loadedMetadata;
      if (isDisposed()) return cleanup;

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
          ensureMeshBvh(object);
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
            : isOcularStructure(object.name)
              ? createOcularMaterials(object.material, object.name, ownedMaterials)
            : isDentalStructure(object.name)
              ? createDentalMaterials(object.material, ownedMaterials)
            : isFemaleScalpAponeurosis
              ? createMatteScalpMaterials(object.material, ownedMaterials)
            : isFemaleComposite && adapted.visualRole === "shell"
              ? createHolographicMaterials(
                object.material,
                adapted.visualRole,
                adapted.system,
                ownedMaterials,
                undefined,
                object.name,
              )
            : createHolographicMaterials(
              object.material,
              adapted.visualRole,
              adapted.system,
              ownedMaterials,
              dimsShellForReadableInternals
                ? INTERNALS_READABILITY_STYLE.skeletonOpacity
                : isStandaloneSkeletonAtlas ? 1 : undefined,
              object.name,
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
          const isEye = isOcularStructure(object.name);
          const isOccluded = isOccludingEyeStructure(object.name);
          object.userData.contextVisible = isEye ? !isOccluded : visible;
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
        const isEye = isOcularStructure(object.name);
        const isOccluded = isOccludingEyeStructure(object.name);
        const contextVisible = isEye ? !isOccluded : layer.triggerFocus.includes(activeLazyFocus);
        object.visible = Boolean(adapted) && contextVisible;
        if (!adapted) return;

        const layerSystem = anatomyLayerSystem(adapted.system);

        object.userData.anatomyId = adapted.anatomyId;
        object.userData.anatomySourceKey = adapted.sourceKey;
        object.userData.structureLabel = adapted.label;
        object.userData.structureSystem = layerSystem;
        object.userData.visualRole = adapted.visualRole;
        object.userData.lazyLayerId = layer.id;
        object.userData.contextVisible = contextVisible;
        ensureMeshBvh(object);
        anatomyMeshes.push(object);
        readySystems.add(layerSystem);
        selectableMeshes.push(object);
        object.material = isEye
          ? createOcularMaterials(object.material, object.name, ownedMaterials)
          : isDentalStructure(object.name)
          ? createDentalMaterials(object.material, ownedMaterials)
          : isFemaleComposite
          && adapted.system === "muscular"
          && adapted.anatomyId.includes("epicranial-aponeurosis")
          ? createMatteScalpMaterials(object.material, ownedMaterials)
          : createHolographicMaterials(
            object.material,
            adapted.visualRole,
            adapted.system,
            ownedMaterials,
            undefined,
            object.name,
          );
        if (isEye) {
          if (isOccluded) {
            object.visible = false;
            object.userData.contextVisible = false;
          } else if (/iris|pupil/i.test(object.name)) {
            object.renderOrder = 2;
          } else if (/cornea/i.test(object.name)) {
            object.renderOrder = 3;
          } else {
            object.renderOrder = 1;
          }
        }
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
    currentFocusPresets = presets;
    currentBodyBounds = normalizedBounds;
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
          setDynamicPixelRatio(normalPixelRatio);
          requestRender();
          if (lockControls) {
            autoFullReturnAnimating = false;
            controls.enabled = true;
          }
        }
      };
      setDynamicPixelRatio(dynamicDragPixelRatio);
      focusAnimationFrame = window.requestAnimationFrame(animateFocus);
    };
    focusCameraRef.current = transitionToFocus;
    transitionToFocusFn = transitionToFocus;

    const fullBodyDistance = fullBodyReferenceDistance;
    handleControlsStart = () => {
      setDynamicPixelRatio(dynamicDragPixelRatio);
      if (autoFullReturnAnimating) return;
      if (focusAnimationFrame === undefined) return;
      window.cancelAnimationFrame(focusAnimationFrame);
      focusAnimationFrame = undefined;
    };
    handleControlsEnd = () => {
      setDynamicPixelRatio(normalPixelRatio);
      requestRender();
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
