import { Fragment, lazy, Suspense, type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { useLocalDomain } from "../../../app/localDomainContext";
import { BirthDateInput } from "../../../shared/ui/BirthDateInput";
import { Modal } from "../../../shared/ui/Modal";
import { ListRowsSkeleton, MemberListSkeleton } from "../../../shared/ui/Skeleton";
import { RecordSummary } from "../../home/RecordSummary";
import { RecordCard } from "../../home/RecordCard";
import { recordTypeLabel, recordSummary } from "../../../shared/local/recordSummary";
import type {
  DashboardSummary,
  FamilyProfile,
  Gender,
  HealthRecord,
  HealthRecordType,
} from "../../../shared/local/domainContracts";
import { LEVEL_LABEL, type RiskLevel } from "../../assessment/contracts";
import {
  type LatestSummary,
  listLatestByProfile,
  listSnapshots,
  buildSeries,
  buildLevelTracks,
  TREND_WINDOW,
  type Snapshot,
  TREND_SERIES,
} from "../../assessment/snapshots";
import { TrendChart } from "../../assessment/TrendChart";
import { SingleMetricCard } from "../../assessment/SingleMetricCard";
import { FamilyComparisonChart } from "../../assessment/FamilyComparisonChart";
import { useHealthTimeSeries } from "../../data/useHealthTimeSeries";
import { regionRisks, type RegionRisk } from "../../home/bodyRisk";
import { FamilyHistoryManager } from "../../home/FamilyHistoryManager";
import { FamilyIntegratedMonitoring } from "../../home/FamilyIntegratedMonitoring";
import { serverApiClient } from "../../../shared/api/serverApiClient";
import { useHouseholdEventStream } from "../../sync/useHouseholdEventStream";
import { VariantBar } from "../components/VariantBar";
import { IndependentTileCanvas, type IndependentTile } from "../components/IndependentTileCanvas";
import "../styles/shadcn-preview.css";
import "../styles/shadcn-preview-variants.css";
import "../styles/ui-preview7.css";
import "../styles/ui-preview3-free-grid.css";

const RecordDetail = lazy(() => import("../../home/RecordDetail").then((m) => ({ default: m.RecordDetail })));
const VanatomeBodyMap = lazy(() => import("../../home/VanatomeBodyMap").then((m) => ({ default: m.VanatomeBodyMap })));

const RECORD_TYPES: HealthRecordType[] = [
  "blood_pressure",
  "blood_glucose",
  "body_measurement",
  "lab_result",
  "health_screening",
  "pain",
  "medication",
  "sleep",
  "daily_condition",
  "vaccination",
  "note",
  "walking",
  "exercise",
];

const RELATIONSHIPS = ["본인", "배우자", "자녀", "부모", "형제·자매", "기타"];

export type TileType =
  | "members"
  | "singleMetric"
  | "familyComparison"
  | "monitoring"
  | "bodymap"
  | "trends"
  | "records"
  | "activeRecord";

export type TileId = string;

export type TileColSpan = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9 | 10 | 11 | 12;
export type TileDensity = "dense" | "compact" | "spacious";
export type TileSpec = "xs" | "sm" | "md" | "lg" | "xl" | "custom";

export interface TileConfig {
  id: string;
  type?: TileType;
  title: string;
  colSpan: TileColSpan;
  density: TileDensity;
  specPreset?: TileSpec;
  breakRow?: boolean; // 해당 타일부터 다음 행(줄)으로 강제 시작하여 상단 빈자리로 올라가지 않도록 함
  metricKey?: string;
  height?: number; // 세로 높이 (px 단위)
}

export const getTileType = (tile: { id: string; type?: TileType }): TileType => {
  if (tile.type) return tile.type;
  if (tile.id.startsWith("singleMetric") || tile.id.startsWith("tile_metric_")) return "singleMetric";
  if (tile.id.startsWith("familyComparison")) return "familyComparison";
  if (tile.id.startsWith("monitoring")) return "monitoring";
  if (tile.id.startsWith("bodymap")) return "bodymap";
  if (tile.id.startsWith("trends")) return "trends";
  if (tile.id.startsWith("records")) return "records";
  if (tile.id.startsWith("activeRecord")) return "activeRecord";
  if (tile.id.startsWith("members")) return "members";
  return "singleMetric";
};

export const inferMetricFromTitle = (title?: string): string | undefined => {
  if (!title) return undefined;
  if (title.includes("수축기")) return "sbp";
  if (title.includes("이완기")) return "dbp";
  if (title.includes("당화혈색소")) return "hba1c";
  if (title.includes("공복") || title.includes("혈당")) return "fbs";
  if (title.includes("LDL") || title.includes("저밀도")) return "ldl";
  if (title.includes("HDL") || title.includes("고밀도")) return "hdl";
  if (title.includes("중성지방")) return "tg";
  if (title.includes("총콜레스테롤") || title.includes("콜레스테롤")) return "tc";
  if (title.includes("체중") || title.includes("몸무게")) return "weight_kg";
  if (title.includes("허리둘레")) return "waist_cm";
  return undefined;
};

export const TILE_MIN_COLS: Record<TileType, TileColSpan> = {
  monitoring: 4,
  activeRecord: 3,
  records: 3,
  bodymap: 4,
  members: 3,
  trends: 4,
  singleMetric: 3,
  familyComparison: 4,
};

export const DEFAULT_TILES: TileConfig[] = [
  { id: "members", type: "members", title: "가족 구성원 선택", colSpan: 12, density: "compact", specPreset: "xl" },
  { id: "singleMetric", type: "singleMetric", title: "나의 건강 지표 추이 (단일 지표)", colSpan: 5, density: "compact", specPreset: "md", breakRow: true, metricKey: "weight_kg" },
  { id: "familyComparison", type: "familyComparison", title: "가족 건강 수치 비교 (혈압/체중)", colSpan: 7, density: "compact", specPreset: "lg", breakRow: false, metricKey: "sbp" },
  { id: "monitoring", type: "monitoring", title: "가족 건강 통합 모니터링", colSpan: 7, density: "compact", specPreset: "lg", breakRow: true },
  { id: "bodymap", type: "bodymap", title: "3D 인체 해부도 / 부위 판정", colSpan: 5, density: "compact", specPreset: "md" },
  { id: "trends", type: "trends", title: "건강 수치 추적 대시보드 (10대 지표)", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
  { id: "records", type: "records", title: "최근 건강기록", colSpan: 7, density: "compact", specPreset: "lg", breakRow: true },
  { id: "activeRecord", type: "activeRecord", title: "연동 판정 및 위험 장기 근거", colSpan: 5, density: "compact", specPreset: "md" },
];

export const TILES_3D_FOCUS: TileConfig[] = [
  { id: "members", type: "members", title: "가족 구성원 선택", colSpan: 12, density: "compact", specPreset: "xl" },
  { id: "bodymap", type: "bodymap", title: "3D 인체 해부도 및 실시간 장기 반응 뷰", colSpan: 7, density: "spacious", specPreset: "lg", breakRow: true, height: 600 },
  { id: "singleMetric", type: "singleMetric", title: "실시간 연동 건강 지표 추이", colSpan: 5, density: "spacious", specPreset: "md", breakRow: false, height: 600, metricKey: "sbp" },
  { id: "monitoring", type: "monitoring", title: "가족 건강 통합 모니터링", colSpan: 7, density: "compact", specPreset: "lg", breakRow: true },
  { id: "activeRecord", type: "activeRecord", title: "연동 판정 및 위험 장기 근거", colSpan: 5, density: "compact", specPreset: "md" },
  { id: "trends", type: "trends", title: "건강 수치 추적 대시보드 (10대 지표)", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
  { id: "records", type: "records", title: "최근 건강기록", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
];

export function UiPreview7Page({
  canvasVariant = "flow",
}: {
  canvasVariant?: "flow" | "independent" | "push" | "3d-focus";
} = {}) {
  const is3DFocus = canvasVariant === "3d-focus";
  const independentCanvas = canvasVariant === "independent" || canvasVariant === "push" || is3DFocus;
  const isPushCanvas = canvasVariant === "push" || is3DFocus;
  const navigate = useNavigate();
  const location = useLocation();
  const { profileId: routeProfileId, recordId: routeRecordId } = useParams();
  const {
    runtime,
    householdId,
    profiles,
    hiddenProfiles,
    loading,
    error,
    createProfile,
    updateProfile,
    hideProfile,
    restoreProfile,
    deleteEmptyProfile,
    createHealthRecord,
    updateHealthRecord,
    deleteHealthRecord,
    restoreHealthRecord,
    purgeHealthRecord,
  } = useLocalDomain();

  const [isLocked, setIsLocked] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem("ieobom:v7-locked");
      return saved !== null ? saved === "true" : false; // v7은 편집 모드 체험을 위해 초기 해제 권장
    } catch {
      return false;
    }
  });

  const storageTilesKey = is3DFocus ? "ieobom:v11-tiles" : isPushCanvas ? "ieobom:v10-tiles" : independentCanvas ? "ieobom:v3-tiles" : "ieobom:v7-tiles";
  const defaultTileset = is3DFocus ? TILES_3D_FOCUS : DEFAULT_TILES;

  const [tiles, setTiles] = useState<TileConfig[]>(() => {
    try {
      const saved = localStorage.getItem(storageTilesKey);
      if (saved) {
        const parsed = JSON.parse(saved) as TileConfig[];
        if (Array.isArray(parsed) && parsed.some((t) => getTileType(t) === "members")) {
          const seenIds = new Set<string>();
          let normalized: TileConfig[] = parsed.map((t, idx) => {
            const tileType = getTileType(t);
            let uniqueId = t.id || `tile_${idx}`;
            if (seenIds.has(uniqueId)) {
              uniqueId = `${uniqueId}_${idx}`;
            }
            seenIds.add(uniqueId);

            let metricKey = t.metricKey;
            if (!metricKey) {
              if (tileType === "singleMetric") {
                metricKey = inferMetricFromTitle(t.title) ?? "weight_kg";
              } else if (tileType === "familyComparison") {
                metricKey = inferMetricFromTitle(t.title) ?? "sbp";
              }
            }

            return {
              ...t,
              id: uniqueId,
              type: tileType,
              metricKey,
              breakRow: t.breakRow !== undefined ? t.breakRow : (tileType === "singleMetric" || tileType === "monitoring" || tileType === "records" || tileType === "trends"),
            };
          });

          // singleMetric 및 familyComparison 타일이 누락된 경우 members 바로 뒤에 자동 삽입
          if (!normalized.some((t) => t.type === "singleMetric")) {
            normalized = [
              normalized[0],
              { id: "singleMetric", type: "singleMetric", title: "나의 건강 지표 추이 (단일 지표)", colSpan: 5, density: "compact", specPreset: "md", breakRow: true, metricKey: "weight_kg" },
              { id: "familyComparison", type: "familyComparison", title: "가족 건강 수치 비교 (혈압/체중)", colSpan: 7, density: "compact", specPreset: "lg", breakRow: false, metricKey: "sbp" },
              ...normalized.slice(1),
            ];
          }
          // trends 타일이 누락된 경우 자동 보충
          if (!normalized.some((t) => t.type === "trends")) {
            normalized.push({ id: "trends", type: "trends", title: "건강 수치 추적 대시보드 (10대 지표)", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true });
          }
          return normalized;
        }
      }
    } catch {
      // ignore
    }
    return defaultTileset;
  });

  const [draggedTileId, setDraggedTileId] = useState<TileId | null>(null);
  const [dragOverTileId, setDragOverTileId] = useState<TileId | null>(null);
  const [dragDropMode, setDragDropMode] = useState<"swap" | "before" | "after" | null>(null);

  const draggedTile = useMemo(() => {
    return tiles.find((t) => t.id === draggedTileId) ?? null;
  }, [tiles, draggedTileId]);

  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [summary, setSummary] = useState<DashboardSummary>();
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [deletedRecords, setDeletedRecords] = useState<HealthRecord[]>([]);
  const [familyRecords, setFamilyRecords] = useState<HealthRecord[]>([]);
  const [dashboardLoading, setDashboardLoading] = useState(false);
  const [loadedProfileId, setLoadedProfileId] = useState<string>();
  const [recordChoiceOpen, setRecordChoiceOpen] = useState(false);
  const [verdicts, setVerdicts] = useState<Record<string, LatestSummary>>({});
  const [openRecord, setOpenRecord] = useState<HealthRecord>();
  const [bodyRecord, setBodyRecord] = useState<HealthRecord>();
  const [highlightOrganKey, setHighlightOrganKey] = useState<string>();
  const [highlightPainIntensity, setHighlightPainIntensity] = useState<number>();
  const [highlightOrganIntensities, setHighlightOrganIntensities] = useState<Record<string, number>>();
  const [purgingRecord, setPurgingRecord] = useState<HealthRecord>();
  const [profileDialogOpen, setProfileDialogOpen] = useState(false);
  const [profileEditDialogOpen, setProfileEditDialogOpen] = useState(false);
  const [profileLifecycleAction, setProfileLifecycleAction] = useState<"hide" | "delete">();
  const [hiddenProfilesDialogOpen, setHiddenProfilesDialogOpen] = useState(false);
  const [recordDialogOpen, setRecordDialogOpen] = useState(false);
  const [editingRecord, setEditingRecord] = useState<HealthRecord>();
  const [deletingRecord, setDeletingRecord] = useState<HealthRecord>();
  const [deletedRecordsDialogOpen, setDeletedRecordsDialogOpen] = useState(false);
  const [familyHistoryDialogOpen, setFamilyHistoryDialogOpen] = useState(false);
  const [actionError, setActionError] = useState<string>();
  const [saving, setSaving] = useState(false);
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [snapshotsLoading, setSnapshotsLoading] = useState(false);

  const localStorageReady = Boolean(runtime);

  // 마우스 가로/세로/코너 드래그 리사이징 상태
  const [resizingTileId, setResizingTileId] = useState<TileId | null>(null);
  const [resizingDirection, setResizingDirection] = useState<"horizontal" | "vertical" | "both" | null>(null);
  const [resizingStartX, setResizingStartX] = useState<number>(0);
  const [resizingStartY, setResizingStartY] = useState<number>(0);
  const [resizingStartCols, setResizingStartCols] = useState<TileColSpan>(6);
  const [resizingStartHeight, setResizingStartHeight] = useState<number>(360);
  const [gridWidth, setGridWidth] = useState<number>(1800);

  const toggleLock = () => {
    setIsLocked((prev) => {
      const next = !prev;
      try {
        localStorage.setItem("ieobom:v7-locked", String(next));
      } catch {
        // ignore
      }
      return next;
    });
  };

  const applyPreset = (preset: "default" | "bodymap-left" | "stacked" | "compact-dense" | "members-sidebar") => {
    let next: TileConfig[];
    if (preset === "bodymap-left") {
      next = [
        { id: "members", type: "members", title: "가족 구성원 선택", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
        { id: "singleMetric", type: "singleMetric", title: "나의 건강 지표 추이 (단일 지표)", colSpan: 5, density: "compact", specPreset: "md", breakRow: true, metricKey: "weight_kg" },
        { id: "familyComparison", type: "familyComparison", title: "가족 건강 수치 비교 (혈압/체중)", colSpan: 7, density: "compact", specPreset: "lg", breakRow: false, metricKey: "sbp" },
        { id: "bodymap", type: "bodymap", title: "3D 인체 해부도 / 부위 판정", colSpan: 5, density: "compact", specPreset: "md", breakRow: true },
        { id: "monitoring", type: "monitoring", title: "가족 건강 통합 모니터링", colSpan: 7, density: "compact", specPreset: "lg", breakRow: false },
        { id: "trends", type: "trends", title: "건강 수치 추적 대시보드 (10대 지표)", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
        { id: "activeRecord", type: "activeRecord", title: "연동 판정 및 위험 장기 근거", colSpan: 5, density: "compact", specPreset: "md", breakRow: true },
        { id: "records", type: "records", title: "최근 건강기록", colSpan: 7, density: "compact", specPreset: "lg", breakRow: false },
      ];
    } else if (preset === "stacked") {
      next = [
        { id: "members", type: "members", title: "가족 구성원 선택", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
        { id: "singleMetric", type: "singleMetric", title: "나의 건강 지표 추이 (단일 지표)", colSpan: 6, density: "compact", specPreset: "md", breakRow: true, metricKey: "weight_kg" },
        { id: "familyComparison", type: "familyComparison", title: "가족 건강 수치 비교 (혈압/체중)", colSpan: 6, density: "compact", specPreset: "md", breakRow: false, metricKey: "sbp" },
        { id: "monitoring", type: "monitoring", title: "가족 건강 통합 모니터링", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
        { id: "bodymap", type: "bodymap", title: "3D 인체 해부도 / 부위 판정", colSpan: 6, density: "compact", specPreset: "md", breakRow: true },
        { id: "records", type: "records", title: "최근 건강기록", colSpan: 6, density: "compact", specPreset: "md", breakRow: false },
        { id: "trends", type: "trends", title: "건강 수치 추적 대시보드 (10대 지표)", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
        { id: "activeRecord", type: "activeRecord", title: "연동 판정 및 위험 장기 근거", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
      ];
    } else if (preset === "compact-dense") {
      next = [
        { id: "members", type: "members", title: "가족 구성원 선택", colSpan: 12, density: "dense", specPreset: "xl", breakRow: true },
        { id: "singleMetric", type: "singleMetric", title: "나의 건강 지표 추이 (단일 지표)", colSpan: 6, density: "dense", specPreset: "md", breakRow: true, metricKey: "weight_kg" },
        { id: "familyComparison", type: "familyComparison", title: "가족 건강 수치 비교 (혈압/체중)", colSpan: 6, density: "dense", specPreset: "md", breakRow: false, metricKey: "sbp" },
        { id: "monitoring", type: "monitoring", title: "가족 건강 통합 모니터링", colSpan: 6, density: "dense", specPreset: "md", breakRow: true },
        { id: "bodymap", type: "bodymap", title: "3D 인체 해부도 / 부위 판정", colSpan: 6, density: "dense", specPreset: "md", breakRow: false },
        { id: "trends", type: "trends", title: "건강 수치 추적 대시보드 (10대 지표)", colSpan: 12, density: "dense", specPreset: "xl", breakRow: true },
        { id: "records", type: "records", title: "최근 건강기록", colSpan: 6, density: "dense", specPreset: "md", breakRow: true },
        { id: "activeRecord", type: "activeRecord", title: "연동 판정 및 위험 장기 근거", colSpan: 6, density: "dense", specPreset: "md", breakRow: false },
      ];
    } else if (preset === "members-sidebar") {
      next = [
        { id: "members", type: "members", title: "가족 구성원 선택", colSpan: 3, density: "dense", specPreset: "xs", breakRow: true },
        { id: "monitoring", type: "monitoring", title: "가족 건강 통합 모니터링", colSpan: 9, density: "compact", specPreset: "lg", breakRow: false },
        { id: "singleMetric", type: "singleMetric", title: "나의 건강 지표 추이 (단일 지표)", colSpan: 5, density: "compact", specPreset: "md", breakRow: true, metricKey: "weight_kg" },
        { id: "familyComparison", type: "familyComparison", title: "가족 건강 수치 비교 (혈압/체중)", colSpan: 7, density: "compact", specPreset: "lg", breakRow: false, metricKey: "sbp" },
        { id: "bodymap", type: "bodymap", title: "3D 인체 해부도 / 부위 판정", colSpan: 5, density: "compact", specPreset: "md", breakRow: true },
        { id: "records", type: "records", title: "최근 건강기록", colSpan: 7, density: "compact", specPreset: "lg", breakRow: false },
        { id: "trends", type: "trends", title: "건강 수치 추적 대시보드 (10대 지표)", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
        { id: "activeRecord", type: "activeRecord", title: "연동 판정 및 위험 장기 근거", colSpan: 12, density: "compact", specPreset: "xl", breakRow: true },
      ];
    } else {
      next = DEFAULT_TILES;
    }
    setTiles(next);
    try {
      localStorage.setItem(storageTilesKey, JSON.stringify(next));
    } catch {
      // ignore
    }
  };

  const swapTiles = (index1: number, index2: number) => {
    if (index1 < 0 || index1 >= tiles.length || index2 < 0 || index2 >= tiles.length || index1 === index2) return;
    setTiles((prev) => {
      const updated = [...prev];
      const temp = updated[index1];
      updated[index1] = updated[index2];
      updated[index2] = temp;
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const insertTileBefore = (fromIdx: number, targetIdx: number) => {
    if (fromIdx < 0 || fromIdx >= tiles.length || targetIdx < 0 || targetIdx >= tiles.length || fromIdx === targetIdx) return;
    setTiles((prev) => {
      const updated = [...prev];
      const [item] = updated.splice(fromIdx, 1);
      const dest = fromIdx < targetIdx ? targetIdx - 1 : targetIdx;
      updated.splice(dest, 0, item);
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const insertTileAfter = (fromIdx: number, targetIdx: number) => {
    if (fromIdx < 0 || fromIdx >= tiles.length || targetIdx < 0 || targetIdx >= tiles.length || fromIdx === targetIdx) return;
    setTiles((prev) => {
      const updated = [...prev];
      const [item] = updated.splice(fromIdx, 1);
      const dest = fromIdx <= targetIdx ? targetIdx : targetIdx + 1;
      updated.splice(dest, 0, item);
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const appendTile = (fromIdx: number) => {
    if (fromIdx < 0 || fromIdx >= tiles.length) return;
    setTiles((prev) => {
      const updated = [...prev];
      const [item] = updated.splice(fromIdx, 1);
      updated.push(item);
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const setTileHeight = (tileId: string, height: number | undefined) => {
    setTiles((prev) => {
      const updated = prev.map((t) => (t.id === tileId ? { ...t, height } : t));
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const setTileSpec = (tileId: string, spec: TileSpec) => {
    setTiles((prev) => {
      const target = prev.find((t) => t.id === tileId);
      const tileType = target ? getTileType(target) : "singleMetric";
      const minCols = TILE_MIN_COLS[tileType] ?? 3;
      let colSpan: TileColSpan = 6;
      let density: TileDensity = "compact";
      switch (spec) {
        case "xs":
          colSpan = Math.max(minCols, 3) as TileColSpan;
          density = "dense";
          break;
        case "sm":
          colSpan = Math.max(minCols, 4) as TileColSpan;
          density = "compact";
          break;
        case "md":
          colSpan = 6;
          density = "compact";
          break;
        case "lg":
          colSpan = 8;
          density = "spacious";
          break;
        case "xl":
          colSpan = 12;
          density = "spacious";
          break;
      }
      const updated = prev.map((t) => (t.id === tileId ? { ...t, colSpan, density, specPreset: spec } : t));
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const setTileCols = (tileId: string, newCols: TileColSpan) => {
    setTiles((prev) => {
      const target = prev.find((t) => t.id === tileId);
      const tileType = target ? getTileType(target) : "singleMetric";
      const minCols = TILE_MIN_COLS[tileType] ?? 3;
      const clamped = Math.max(minCols, Math.min(12, newCols)) as TileColSpan;
      const updated = prev.map((t) => (t.id === tileId ? { ...t, colSpan: clamped, specPreset: "custom" as TileSpec } : t));
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };


  const setTileDensity = (tileId: string, density: TileDensity) => {
    setTiles((prev) => {
      const updated = prev.map((t) => (t.id === tileId ? { ...t, density } : t));
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const toggleTileBreakRow = (tileId: string) => {
    setTiles((prev) => {
      const updated = prev.map((t) => (t.id === tileId ? { ...t, breakRow: !t.breakRow } : t));
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  const updateTileMetric = (tileId: string, metricKey: string) => {
    setTiles((prev) => {
      const metricSpec = TREND_SERIES.find((s) => s.key === metricKey);
      const metricLabel = metricSpec?.label ?? "건강 지표";
      const updated = prev.map((t) => {
        if (t.id === tileId) {
          const newTitle = selectedProfile
            ? `${selectedProfile.displayName}님의 ${metricLabel} 추이`
            : `${metricLabel} 추이`;
          return {
            ...t,
            metricKey,
            title: newTitle,
          };
        }
        return t;
      });
      try {
        localStorage.setItem(storageTilesKey, JSON.stringify(updated));
      } catch {
        // ignore
      }
      return updated;
    });
  };

  // 마우스 가장자리/코너 드래그 리사이즈 이벤트
  const startResizing = (
    e: React.MouseEvent,
    tile: TileConfig,
    direction: "horizontal" | "vertical" | "both" = "horizontal",
  ) => {
    e.preventDefault();
    e.stopPropagation();
    if (isLocked) return;

    setResizingTileId(tile.id);
    setResizingDirection(direction);
    setResizingStartX(e.clientX);
    setResizingStartY(e.clientY);
    setResizingStartCols(tile.colSpan);
    setResizingStartHeight(tile.height ?? 360);

    const gridEl = document.getElementById("sp-v7-grid");
    if (gridEl) {
      setGridWidth(gridEl.getBoundingClientRect().width);
    }
  };

  useEffect(() => {
    if (!resizingTileId || !resizingDirection) return;

    const handleMouseMove = (e: MouseEvent) => {
      const deltaX = e.clientX - resizingStartX;
      const deltaY = e.clientY - resizingStartY;

      // 12열 기준 1열의 픽셀 폭
      const colWidth = (gridWidth || 1800) / 12;

      setTiles((prev) => {
        const target = prev.find((t) => t.id === resizingTileId);
        if (!target) return prev;
        const tileType = getTileType(target);
        const minCols = TILE_MIN_COLS[tileType] ?? 3;

        let newColSpan = target.colSpan;
        if (resizingDirection === "horizontal" || resizingDirection === "both") {
          const colDelta = Math.round(deltaX / colWidth);
          newColSpan = Math.max(minCols, Math.min(12, resizingStartCols + colDelta)) as TileColSpan;
        }

        let newHeight = target.height;
        if (resizingDirection === "vertical" || resizingDirection === "both") {
          newHeight = Math.max(160, Math.min(1000, resizingStartHeight + deltaY));
        }

        return prev.map((t) =>
          t.id === resizingTileId
            ? { ...t, colSpan: newColSpan, height: newHeight, specPreset: "custom" as TileSpec }
            : t,
        );
      });
    };

    const handleMouseUp = () => {
      setResizingTileId(null);
      setResizingDirection(null);
      try {
        setTiles((latest) => {
          localStorage.setItem(storageTilesKey, JSON.stringify(latest));
          return latest;
        });
      } catch {
        // ignore
      }
    };

    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
    return () => {
      window.removeEventListener("mousemove", handleMouseMove);
      window.removeEventListener("mouseup", handleMouseUp);
    };
  }, [resizingTileId, resizingDirection, resizingStartX, resizingStartY, resizingStartCols, resizingStartHeight, gridWidth, storageTilesKey]);

  const handleDragStart = (e: React.DragEvent, id: TileId) => {
    if (isLocked || resizingTileId) return;
    setDraggedTileId(id);
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  };

  const handleTileDragOver = (e: React.DragEvent, targetId: TileId) => {
    if (isLocked || draggedTileId === targetId) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";

    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const mode: "swap" | "before" | "after" =
      ratio < 0.28 ? "before" : ratio > 0.72 ? "after" : "swap";

    setDragOverTileId(targetId);
    setDragDropMode(mode);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    if (!e.currentTarget.contains(e.relatedTarget as Node)) {
      setDragOverTileId(null);
      setDragDropMode(null);
    }
  };

  const handleTileDrop = (e: React.DragEvent, targetIndex: number) => {
    if (isLocked || !draggedTileId) return;
    e.preventDefault();
    e.stopPropagation();

    const fromIdx = tiles.findIndex((t) => t.id === draggedTileId);
    if (fromIdx === -1 || (fromIdx === targetIndex && dragDropMode === "swap")) {
      setDraggedTileId(null);
      setDragOverTileId(null);
      setDragDropMode(null);
      return;
    }

    if (dragDropMode === "swap") {
      swapTiles(fromIdx, targetIndex);
    } else if (dragDropMode === "before") {
      insertTileBefore(fromIdx, targetIndex);
    } else if (dragDropMode === "after") {
      insertTileAfter(fromIdx, targetIndex);
    }

    setDraggedTileId(null);
    setDragOverTileId(null);
    setDragDropMode(null);
  };

  const handleAppendDrop = (e: React.DragEvent) => {
    if (isLocked || !draggedTileId) return;
    e.preventDefault();
    e.stopPropagation();
    const fromIdx = tiles.findIndex((t) => t.id === draggedTileId);
    if (fromIdx !== -1) {
      appendTile(fromIdx);
    }
    setDraggedTileId(null);
    setDragOverTileId(null);
    setDragDropMode(null);
  };

  const handleDragEnd = () => {
    setDraggedTileId(null);
    setDragOverTileId(null);
    setDragDropMode(null);
  };



  const listedRecords = useMemo(() => {
    const docLinked = new Set(
      records.filter((record) => record.recordType !== "assessment" && record.sourceDocumentId).map((r) => r.sourceDocumentId),
    );
    return records.filter((record) => {
      if (record.recordType !== "assessment") return true;
      const payload = record.payload as { sourceRecordId?: string };
      if (payload.sourceRecordId && records.some((item) => item.id === payload.sourceRecordId)) return false;
      if (record.sourceDocumentId && docLinked.has(record.sourceDocumentId)) return false;
      return true;
    });
  }, [records]);

  const refreshDashboard = useCallback(
    async (profileId: string) => {
      if (!runtime) return;
      setDashboardLoading(true);
      try {
        const [summaryResult, recordsResult] = await Promise.all([
          runtime.dashboard.summarize(profileId),
          runtime.healthRecords.query({ profileId, includeDeleted: true }),
        ]);
        if (!summaryResult.ok) throw new Error(summaryResult.error.message);
        if (!recordsResult.ok) throw new Error(recordsResult.error.message);
        setSummary(summaryResult.value);
        setRecords(recordsResult.value.filter((record) => !record.deletedAt));
        setDeletedRecords(recordsResult.value.filter((record) => Boolean(record.deletedAt)));
        setLoadedProfileId(profileId);
        setActionError(undefined);
      } catch (caught) {
        setActionError(messageFrom(caught, "건강 대시보드를 불러오지 못했습니다."));
      } finally {
        setDashboardLoading(false);
      }

      void listLatestByProfile(runtime, [profileId])
        .then((latest) => setVerdicts((prev) => ({ ...prev, ...latest })))
        .catch(() => {});

      if (profiles.length > 0) {
        void Promise.all(
          profiles.map((p) => runtime.healthRecords.query({ profileId: p.id, includeDeleted: false })),
        )
          .then((results) => {
            const combined = results.flatMap((res) => (res.ok ? res.value : []));
            setFamilyRecords(combined);
          })
          .catch((err) => {
            console.warn("[UiPreview6Page] Failed to sync family records:", err);
          });
      }
    },
    [runtime, profiles],
  );

  const refreshFamilyRecords = useCallback(
    async (familyProfiles: FamilyProfile[]) => {
      if (!runtime || familyProfiles.length === 0) return;
      try {
        const results = await Promise.all(
          familyProfiles.map((p) =>
            runtime.healthRecords.query({ profileId: p.id, includeDeleted: false }),
          ),
        );
        const combined = results.flatMap((res) => (res.ok ? res.value : []));
        setFamilyRecords(combined);
      } catch (err) {
        console.warn("[UiPreview6Page] Failed to load family records for monitoring:", err);
      }
    },
    [runtime],
  );

  const activeBodyRecord = useMemo(
    () => bodyRecord ?? records.find((record) => record.recordType === "assessment"),
    [bodyRecord, records],
  );

  const bodyRisks: RegionRisk[] | undefined = useMemo(() => {
    if (!activeBodyRecord || activeBodyRecord.recordType !== "assessment") return undefined;
    const payload = activeBodyRecord.payload as unknown as {
      verdicts?: { key: string; name?: string; risk_level: string }[];
      levels?: Record<string, string>;
    };
    const riskVerdicts =
      payload.verdicts ??
      Object.entries(payload.levels ?? {}).map(([key, risk_level]) => ({ key, risk_level }));
    const risks = regionRisks(riskVerdicts);
    return risks.length > 0 ? risks : undefined;
  }, [activeBodyRecord]);

  const selectedProfile =
    profiles.find((profile) => profile.id === (routeProfileId ?? selectedProfileId)) ?? profiles[0];

  useEffect(() => {
    setHighlightOrganKey(undefined);
    setBodyRecord(undefined);
  }, [selectedProfile?.id]);

  useEffect(() => {
    if (!runtime || !routeRecordId) return;
    void runtime.healthRecords.get(routeRecordId).then((result) => {
      if (result.ok && !result.value.deletedAt) setEditingRecord(result.value);
    });
  }, [routeRecordId, runtime]);

  const familyHistoryDialogVisible = familyHistoryDialogOpen
    || Boolean(routeProfileId && location.pathname.endsWith("/family-history"));

  const activeProfileId = selectedProfile?.id;
  useEffect(() => {
    if (!activeProfileId) return;
    const timeout = window.setTimeout(() => void refreshDashboard(activeProfileId), 0);
    return () => {
      window.clearTimeout(timeout);
    };
  }, [refreshDashboard, activeProfileId]);

  useEffect(() => {
    if (!runtime || !activeProfileId) return;
    let cancelled = false;
    setSnapshotsLoading(true);
    void listSnapshots(runtime, activeProfileId)
      .then((data) => {
        if (!cancelled) setSnapshots(data);
      })
      .catch((err) => {
        console.warn("[UiPreview7Page] Failed to load snapshots:", err);
      })
      .finally(() => {
        if (!cancelled) setSnapshotsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfileId]);

  // Phase 2: 통합 건강 시계열 데이터 파이프라인 (일반 건강기록 + 판정 스냅샷 결합)
  const {
    activeTrendSeries,
    familyComparisonData,
    refresh: refreshTimeSeries,
  } = useHealthTimeSeries({
    runtime,
    profiles,
    activeProfileId,
    refreshTrigger: summary?.totalRecords,
  });

  const recentSnapshots = useMemo(() => snapshots.slice(-TREND_WINDOW), [snapshots]);
  const fallbackTrendSeries = useMemo(() => buildSeries(recentSnapshots), [recentSnapshots]);
  const trendSeries = useMemo(
    () => (activeTrendSeries.length > 0 ? activeTrendSeries : fallbackTrendSeries),
    [activeTrendSeries, fallbackTrendSeries],
  );
  const trendTracks = useMemo(() => buildLevelTracks(recentSnapshots), [recentSnapshots]);
  const trendDiseaseNames: Record<string, string> = useMemo(
    () => ({
      diabetes: "당뇨병",
      kidney: "신 기능 확인 필요",
      dyslipidemia: "이상지질혈증",
      hypertension: "고혈압",
      metabolic: "대사증후군",
      liver: "간기능",
      anemia: "빈혈",
    }),
    [],
  );

  useEffect(() => {
    if (profiles.length > 0) {
      void refreshFamilyRecords(profiles);
    }
  }, [profiles, refreshFamilyRecords]);

  useHouseholdEventStream({
    serverClient: serverApiClient,
    householdId,
    onRecordEvent: () => {
      const targetId = selectedProfile?.id;
      if (targetId) void refreshDashboard(targetId);
      if (profiles.length > 0) void refreshFamilyRecords(profiles);
      void refreshTimeSeries();
    },
  });

  const profileIds = useMemo(() => profiles.map((profile) => profile.id).join(","), [profiles]);
  useEffect(() => {
    if (!runtime || !profileIds) return;
    let cancelled = false;
    void listLatestByProfile(runtime, profileIds.split(","))
      .then((found) => {
        if (!cancelled) setVerdicts(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setActionError(messageFrom(caught, "구성원별 최근 판정을 불러오지 못했습니다."));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, profileIds]);

  const handleSelectOrgan = useCallback(
    (
      key?: string,
      _label?: string,
      intensity?: number,
      organIntensities?: Record<string, number>,
    ) => {
      const nextKey = key || undefined;
      setHighlightOrganKey((prev) => (prev !== nextKey ? nextKey : prev));
      setHighlightPainIntensity((prev) => (prev !== intensity ? intensity : prev));
      setHighlightOrganIntensities((prev) => {
        if (!prev && !organIntensities) return prev;
        if (prev && organIntensities && Object.keys(prev).length === Object.keys(organIntensities).length) {
          let same = true;
          for (const [k, v] of Object.entries(organIntensities)) {
            if (prev[k] !== v) {
              same = false;
              break;
            }
          }
          if (same) return prev;
        }
        return organIntensities;
      });
    },
    [],
  );

  async function submitProfile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setActionError(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      const profile = await createProfile({
        displayName: String(form.get("displayName") ?? ""),
        relationship: String(form.get("relationship") ?? ""),
        birthDate: optionalDate(form.get("birthDate")),
        gender: optionalGender(form.get("gender")),
      });
      setSelectedProfileId(profile.id);
      setProfileDialogOpen(false);
      formElement.reset();
    } catch (caught) {
      setActionError(messageFrom(caught, "구성원을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function submitHealthRecord(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    try {
      await createHealthRecord({
        profileId: selectedProfile.id,
        recordType: String(form.get("recordType")) as HealthRecordType,
        recordedAt: new Date(String(form.get("recordedAt"))).toISOString(),
        note: String(form.get("note") ?? ""),
      });
      await refreshDashboard(selectedProfile.id);
      setRecordDialogOpen(false);
      formElement.reset();
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 저장하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function submitProfileUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await updateProfile(selectedProfile.id, {
        displayName: String(form.get("displayName") ?? ""),
        relationship: String(form.get("relationship") ?? ""),
        birthDate: optionalDate(form.get("birthDate")),
        gender: optionalGender(form.get("gender")),
        accountEmail: selectedProfile.accountEmail,
        expectedVersion: selectedProfile.version,
      });
      setProfileEditDialogOpen(false);
    } catch (caught) {
      setActionError(messageFrom(caught, "프로필을 수정하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function submitHealthRecordUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editingRecord || !selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    const form = new FormData(event.currentTarget);
    try {
      await updateHealthRecord(editingRecord.id, {
        recordType: String(form.get("recordType")) as HealthRecordType,
        recordedAt: new Date(String(form.get("recordedAt"))).toISOString(),
        note: String(form.get("note") ?? ""),
        expectedVersion: editingRecord.version,
      });
      await refreshDashboard(selectedProfile.id);
      setEditingRecord(undefined);
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 수정하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmHealthRecordDelete() {
    if (!deletingRecord || !selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    try {
      await deleteHealthRecord(deletingRecord.id, deletingRecord.version);
      await refreshDashboard(selectedProfile.id);
      setDeletingRecord(undefined);
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 삭제하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function purgeDeletedHealthRecord(record: HealthRecord) {
    setActionError(undefined);
    setSaving(true);
    try {
      await purgeHealthRecord(record.id, record.version);
      setPurgingRecord(undefined);
      await refreshDashboard(record.profileId);
      if (deletedRecords.length === 1) setDeletedRecordsDialogOpen(false);
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 영구 삭제하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function restoreDeletedHealthRecord(record: HealthRecord) {
    if (!selectedProfile) return;
    setSaving(true);
    setActionError(undefined);
    try {
      await restoreHealthRecord(record.id, record.version);
      await refreshDashboard(selectedProfile.id);
      if (deletedRecords.length === 1) setDeletedRecordsDialogOpen(false);
    } catch (caught) {
      setActionError(messageFrom(caught, "건강기록을 복원하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function confirmProfileLifecycle() {
    if (!selectedProfile || !profileLifecycleAction) return;
    setSaving(true);
    setActionError(undefined);
    try {
      if (profileLifecycleAction === "hide") {
        await hideProfile(selectedProfile.id, selectedProfile.version);
      } else {
        await deleteEmptyProfile(selectedProfile.id);
      }
      setSelectedProfileId(undefined);
      setProfileLifecycleAction(undefined);
    } catch (caught) {
      setActionError(messageFrom(caught, "프로필 상태를 변경하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  async function restoreHiddenProfile(profile: FamilyProfile) {
    setSaving(true);
    setActionError(undefined);
    try {
      const restored = await restoreProfile(profile.id, profile.version);
      setSelectedProfileId(restored.id);
      if (hiddenProfiles.length === 1) setHiddenProfilesDialogOpen(false);
    } catch (caught) {
      setActionError(messageFrom(caught, "숨긴 프로필을 복원하지 못했습니다."));
    } finally {
      setSaving(false);
    }
  }

  const renderTileContent = (tile: TileConfig) => {
    const tileType = getTileType(tile);
    switch (tileType) {
      case "members":
        return (
          <div className="sp-v6-members-tile-body" style={{ padding: "20px 24px" }}>
            <div className="sp-v5-member-strip-header" style={{ marginBottom: "14px" }}>
              <h3 style={{ fontSize: "17px", fontWeight: 800, color: "#1e293b", margin: 0 }}>
                가족 구성원 선택
              </h3>
              <span style={{ fontSize: "13px", color: "#64748b" }}>
                구성원을 클릭하면 실시간 건강기록 및 3D 인체가 동기화됩니다.
              </span>
            </div>

            {loading ? <MemberListSkeleton /> : null}
            {!loading && profiles.length === 0 ? (
              <EmptyHousehold
                disabled={!localStorageReady}
                onCreate={() => setProfileDialogOpen(true)}
              />
            ) : null}
            {profiles.length > 0 ? (
              <div className="sp-v5-member-grid" role="list">
                {profiles.map((profile, index) => (
                  <button
                    className={profile.id === selectedProfile?.id ? "member-card is-selected" : "member-card"}
                    key={profile.id}
                    type="button"
                    role="listitem"
                    aria-pressed={profile.id === selectedProfile?.id}
                    onClick={() => {
                      setSelectedProfileId(profile.id);
                      setHighlightOrganKey(undefined);
                      setHighlightPainIntensity(undefined);
                      setHighlightOrganIntensities(undefined);
                      setBodyRecord(undefined);
                    }}
                  >
                    <span className={`member-avatar avatar-tone-${index % 4}`} aria-hidden="true">
                      {profile.displayName.slice(0, 1)}
                    </span>
                    <span className="member-card-copy">
                      <strong>{profile.displayName}</strong>
                      <small>{formatProfileDescription(profile)}</small>
                    </span>
                    <MemberVerdict summary={verdicts[profile.id]} />
                  </button>
                ))}
                <button
                  className="member-card add-member-card"
                  type="button"
                  disabled={!localStorageReady}
                  onClick={() => setProfileDialogOpen(true)}
                >
                  <span className="add-member-mark" aria-hidden="true">+</span>
                  <span className="member-card-copy">
                    <strong>구성원 추가</strong>
                    <small>새 프로필 등록</small>
                  </span>
                </button>
              </div>
            ) : null}
          </div>
        );

      case "monitoring":
        return (
          <FamilyIntegratedMonitoring
            profiles={profiles}
            selectedProfileId={selectedProfile?.id}
            onSelectProfile={(id) => {
              setSelectedProfileId(id);
              setHighlightOrganKey(undefined);
              setHighlightPainIntensity(undefined);
              setHighlightOrganIntensities(undefined);
              setBodyRecord(undefined);
            }}
            records={familyRecords.length > 0 ? familyRecords : records}
            onSelectOrgan={handleSelectOrgan}
          />
        );

      case "bodymap":
        return (
          <div style={{ padding: "16px" }}>
            {/* 실시간 3D 장기 ↔ 지표 상호작용 바 */}
            <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "6px", marginBottom: "12px", padding: "8px 12px", background: "#f8fafc", borderRadius: "12px", border: "1px solid #e2e8f0" }}>
              <span style={{ fontSize: "11px", fontWeight: 700, color: "#1d4fb8", marginRight: "4px" }}>
                ⚡ 3D 장기-지표 실시간 반응:
              </span>
              <button
                type="button"
                onClick={() => {
                  handleSelectOrgan("heart", "심장 (혈압 수치 연동)", 8);
                  setTiles((prev) => prev.map((t) => (t.type === "singleMetric" ? { ...t, metricKey: "sbp" } : t)));
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "1px solid",
                  borderColor: highlightOrganKey === "heart" ? "#1d4fb8" : "#cbd5e1",
                  background: highlightOrganKey === "heart" ? "#1d4fb8" : "#ffffff",
                  color: highlightOrganKey === "heart" ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                ❤️ 심장 (혈압 128/84)
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectOrgan("pancreas", "췌장 (공복혈당 연동)", 7);
                  setTiles((prev) => prev.map((t) => (t.type === "singleMetric" ? { ...t, metricKey: "fbs" } : t)));
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "1px solid",
                  borderColor: highlightOrganKey === "pancreas" ? "#1d4fb8" : "#cbd5e1",
                  background: highlightOrganKey === "pancreas" ? "#1d4fb8" : "#ffffff",
                  color: highlightOrganKey === "pancreas" ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                🩺 췌장 (혈당 118)
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectOrgan("liver", "간 (대사·간수치 연동)", 6);
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "1px solid",
                  borderColor: highlightOrganKey === "liver" ? "#1d4fb8" : "#cbd5e1",
                  background: highlightOrganKey === "liver" ? "#1d4fb8" : "#ffffff",
                  color: highlightOrganKey === "liver" ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                🧪 간 (간기능 AST/ALT)
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectOrgan("lumbar", "요추 (통증 다이어리 연동)", 7);
                }}
                style={{
                  padding: "4px 10px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "1px solid",
                  borderColor: highlightOrganKey === "lumbar" ? "#1d4fb8" : "#cbd5e1",
                  background: highlightOrganKey === "lumbar" ? "#1d4fb8" : "#ffffff",
                  color: highlightOrganKey === "lumbar" ? "#ffffff" : "#334155",
                  cursor: "pointer",
                  transition: "all 0.15s ease",
                }}
              >
                🦴 요추 (통증 다이어리)
              </button>
              <button
                type="button"
                onClick={() => {
                  handleSelectOrgan(undefined, undefined, undefined);
                }}
                style={{
                  padding: "4px 8px",
                  fontSize: "11px",
                  fontWeight: 600,
                  borderRadius: "8px",
                  border: "1px solid #e2e8f0",
                  background: "#f1f5f9",
                  color: "#64748b",
                  cursor: "pointer",
                }}
              >
                초기화
              </button>
            </div>

            <Suspense fallback={<div className="body-map-loading">3D 인체 미리보기를 준비하는 중…</div>}>
              {selectedProfile ? (
                <VanatomeBodyMap
                  key={`${selectedProfile.id}-${selectedProfile.gender}`}
                  profileName={selectedProfile.displayName}
                  gender={selectedProfile.gender}
                  risks={bodyRisks}
                  risksAt={activeBodyRecord ? formatDateTime(activeBodyRecord.recordedAt) : undefined}
                  highlightOrganKey={highlightOrganKey}
                  highlightPainIntensity={highlightPainIntensity}
                  highlightOrganIntensities={highlightOrganIntensities}
                />
              ) : null}
            </Suspense>
          </div>
        );

      case "singleMetric": {
        const metricKey = tile.metricKey ?? "weight_kg";
        const metricSpec = TREND_SERIES.find((s) => s.key === metricKey);
        const metricLabel = metricSpec?.label ?? "건강 지표";
        return (
          <div className="sp-v7-single-metric-tile-body" style={{ padding: "18px 22px" }}>
            <SingleMetricCard
              seriesList={trendSeries}
              defaultKey={metricKey}
              metricKey={tile.metricKey}
              onMetricChange={(newKey) => {
                updateTileMetric(tile.id, newKey);
                // 3D 장기 자동 하이라이트 동기화
                if (newKey === "sbp" || newKey === "dbp") {
                  handleSelectOrgan("heart", "심장 (혈압 수치 연동)", 8);
                } else if (newKey === "fbs" || newKey === "hba1c") {
                  handleSelectOrgan("pancreas", "췌장 (공복혈당 연동)", 7);
                } else if (newKey === "tg" || newKey === "tc" || newKey === "ldl" || newKey === "hdl") {
                  handleSelectOrgan("heart", "심혈관계 (지질 수치 연동)", 6);
                }
              }}
              title={selectedProfile ? `${selectedProfile.displayName}님의 ${metricLabel} 추이` : `${metricLabel} 추이`}
            />
          </div>
        );
      }

      case "familyComparison":
        return (
          <div className="sp-v7-family-comparison-tile-body" style={{ padding: "18px 22px" }}>
            <FamilyComparisonChart
              familyData={familyComparisonData}
              defaultMetricKey="sbp"
              metricKey={tile.metricKey}
              onMetricChange={(newKey) => updateTileMetric(tile.id, newKey)}
              title="가족 건강 지표 실측 비교 (동일 시계열)"
            />
          </div>
        );

      case "trends":
        return (
          <div className="sp-v7-trends-tile-body" style={{ padding: "20px 24px" }}>
            <div
              style={{
                display: "flex",
                alignItems: "baseline",
                justifyContent: "space-between",
                marginBottom: "14px",
                flexWrap: "wrap",
                gap: "8px",
              }}
            >
              <div>
                <h3 style={{ fontSize: "17px", fontWeight: 800, color: "#1e293b", margin: "0 0 4px" }}>
                  건강 수치 추적 대시보드
                  <span style={{ fontSize: "13px", fontWeight: 500, color: "#64748b", marginLeft: "8px" }}>
                    {selectedProfile ? `${selectedProfile.displayName}님의 실측 바이탈 추세 (10대 지표)` : "10대 핵심 바이탈 추세"}
                  </span>
                </h3>
                <p style={{ fontSize: "12px", color: "#64748b", margin: 0 }}>
                  질환 예측란에 기록된 시점별 혈압·혈당·지질·계측 실측값과 등급 변동을 실시간 SVG 스파크라인으로 추적합니다.
                </p>
              </div>
              {snapshots.length > 0 ? (
                <span
                  style={{
                    fontSize: "12px",
                    fontWeight: 700,
                    color: "#2563eb",
                    background: "#eff6ff",
                    padding: "4px 10px",
                    border: "1px solid #bfdbfe",
                    borderRadius: "6px",
                  }}
                >
                  {snapshots.length}개 시점 기록됨
                </span>
              ) : null}
            </div>

            {snapshotsLoading ? (
              <p className="assess-muted" style={{ padding: "20px 0" }}>추적 스냅샷을 불러오는 중…</p>
            ) : (
              <TrendChart
                series={trendSeries}
                tracks={trendTracks}
                names={trendDiseaseNames}
                dates={recentSnapshots.map((s) => s.recordedAt)}
                total={snapshots.length}
              />
            )}
          </div>
        );

      case "records":
        return (
          <div className="records-panel" style={{ padding: "20px 24px" }}>
            <div className="panel-heading">
              <div>
                <h3>최근 건강기록</h3>
                <p>저장된 실측 기록을 최신순으로 표시합니다.</p>
              </div>
              <div className="panel-heading-actions">
                {deletedRecords.length > 0 ? (
                  <button
                    className="text-button"
                    type="button"
                    onClick={() => {
                      setActionError(undefined);
                      setDeletedRecordsDialogOpen(true);
                    }}
                  >
                    삭제된 기록 {deletedRecords.length}건
                  </button>
                ) : null}
                {dashboardLoading ? <span className="subtle-status">불러오는 중…</span> : null}
              </div>
            </div>

            {loadedProfileId !== selectedProfile?.id && records.length === 0 ? (
              <ListRowsSkeleton rows={3} label="최근 건강기록을 불러오는 중" />
            ) : records.length === 0 ? (
              <div className="compact-empty">
                <strong>아직 건강기록이 없습니다.</strong>
                <p>검진 결과, 통증 변화나 건강 메모부터 남겨보세요.</p>
                <button className="text-button" type="button" onClick={() => setRecordChoiceOpen(true)}>
                  첫 기록 작성하기
                </button>
              </div>
            ) : (
              <ul className="record-list">
                {listedRecords.slice(0, 6).map((record) => (
                  <RecordCard
                    key={record.id}
                    record={record}
                    pressed={activeBodyRecord?.id === record.id}
                    summary={record.recordType === "assessment" ? <RecordSummary record={record} /> : undefined}
                    onOpen={() => {
                      setActionError(undefined);
                      if (record.recordType === "assessment") setBodyRecord(record);
                      setOpenRecord(record);
                    }}
                  />
                ))}
              </ul>
            )}
          </div>
        );

      case "activeRecord":
        return (
          <div style={{ padding: "20px 24px" }}>
            <h3 style={{ fontSize: "16px", fontWeight: 750, color: "#1e293b", margin: "0 0 10px" }}>
              연동 판정 근거 및 위험 장기
            </h3>
            {activeBodyRecord ? (
              <>
                <div style={{ display: "flex", gap: "10px", fontSize: "13px", color: "#64748b", marginBottom: "8px" }}>
                  <span>기준 일시: {formatDateTime(activeBodyRecord.recordedAt)}</span>
                  <span>•</span>
                  <span>{activeBodyRecord.sourceDocumentId ? "검진표 OCR 연동" : "수기/직접 작성"}</span>
                </div>
                {bodyRisks && bodyRisks.length > 0 ? (
                  <div style={{ display: "flex", gap: "8px", flexWrap: "wrap", marginTop: "12px" }}>
                    {bodyRisks.map((r) => (
                      <span
                        key={r.region}
                        style={{
                          background: r.level === "VERY_HIGH" || r.level === "HIGH" ? "#fee2e2" : "#fef3c7",
                          color: r.level === "VERY_HIGH" || r.level === "HIGH" ? "#b91c1c" : "#b45309",
                          padding: "5px 12px",
                          borderRadius: "6px",
                          fontSize: "12px",
                          fontWeight: 700,
                        }}
                      >
                        {r.label}: {LEVEL_LABEL[r.level as RiskLevel] ?? r.level}
                      </span>
                    ))}
                  </div>
                ) : (
                  <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#64748b" }}>
                    현재 표시 중인 판정에 특이 위험 장기가 감지되지 않았습니다.
                  </p>
                )}
              </>
            ) : (
              <p style={{ margin: "6px 0 0", fontSize: "13px", color: "#64748b" }}>
                아직 선택된 판정 기록이 없습니다.
              </p>
            )}
          </div>
        );
    }
  };

  return (
    <div className="shadcn-preview-root sp-v6-container">
      {/* 4K 시안 전환 바 */}
      <VariantBar current={isPushCanvas ? "v10" : independentCanvas ? "v3" : "v7"} />

      {/* 헤더 GNB */}
      <header className="sp-header">
        <div className="sp-header-inner">
          <div className="sp-brand">
            <div className="sp-brand-logo">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 28C16 28 4 20 4 11.5C4 7.5 7.5 4 11.5 4C13.8 4 15.3 5.2 16 6.2C16.7 5.2 18.2 4 20.5 4C24.5 4 28 7.5 28 11.5C28 20 16 28 16 28Z" stroke="#1d4fb8" strokeWidth="2.5" />
                <circle cx="11.5" cy="12.5" r="1.8" fill="#1d4fb8" />
                <circle cx="20.5" cy="12.5" r="1.8" fill="#1d4fb8" />
                <path d="M13.5 16.5C14.2 17.3 15.1 17.8 16 17.8C16.9 17.8 17.8 17.3 18.5 16.5" stroke="#1d4fb8" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <span className="sp-brand-title">이어봄</span>
              <span className="sp-brand-slogan">
                {isPushCanvas
                  ? "시안 10: 길이 조절 시 타일 밀어내기 (Push on Resize) + 독립 블록 배치"
                  : independentCanvas
                    ? "시안 3: 시안 7 전체 기능 + 독립 블록 배치"
                    : "시안 7: 마우스 리사이즈 (1블럭 드래그 스냅 & 규격 프리셋)"}
              </span>
            </div>
          </div>

          <nav className="sp-nav">
            <button type="button" className="sp-nav-item active">가족 홈</button>
            <button type="button" className="sp-nav-item" onClick={() => void navigate("/assessment")}>질환 예측</button>
            <button type="button" className="sp-nav-item" onClick={() => void navigate("/pain-diary")}>통증 다이어리</button>
            <button type="button" className="sp-nav-item" onClick={() => void navigate("/health-data")}>건강 데이터</button>
          </nav>
        </div>
      </header>

      <div className="sp-v6-content">
        {/* 핵심 기능: 타일 잠금 / 잠금 해제 제어 바 */}
        {!independentCanvas ? <aside className={`sp-v6-control-bar ${isLocked ? "" : "is-unlocked"}`} aria-label="대시보드 타일 잠금 제어">
          <div className="sp-v6-status-info">
            <span className={`sp-v6-status-badge ${isLocked ? "locked" : "unlocked"}`}>
              {isLocked ? "🔒 레이아웃 고정됨" : "🔓 리사이즈 & 배치 편집 모드"}
            </span>
            <span className="sp-v6-status-desc">
              {isLocked
                ? "잠금 상태에서는 타일식 구조나 리사이즈 흔적이 전혀 보이지 않는 일체형 뷰로 작동합니다."
                : "타일 우측 모서리를 잡고 드래그하여 1블럭씩 늘리거나 줄여보세요. 규격(XS~XL) 및 여백 밀도도 선택할 수 있습니다."}
            </span>
          </div>

          <div className="sp-v6-control-actions">
            {!isLocked ? (
              <>
                <button
                  type="button"
                  className="sp-v6-preset-btn"
                  onClick={() => applyPreset("default")}
                >
                  기본 (가족 풀와이드)
                </button>
                <button
                  type="button"
                  className="sp-v6-preset-btn"
                  onClick={() => applyPreset("compact-dense")}
                >
                  여백 최소화 (컴팩트 6:6)
                </button>
                <button
                  type="button"
                  className="sp-v6-preset-btn"
                  onClick={() => applyPreset("members-sidebar")}
                >
                  가족 좌측 (3:9 분할)
                </button>
                <button
                  type="button"
                  className="sp-v6-preset-btn"
                  onClick={() => applyPreset("bodymap-left")}
                >
                  3D 중심 (3D 좌)
                </button>
                <button
                  type="button"
                  className="sp-v6-preset-btn"
                  onClick={() => applyPreset("stacked")}
                >
                  상하 풀스택
                </button>

                <div className="sp-v7-theme-switch-group" style={{ display: "inline-flex", gap: "6px", alignItems: "center", borderLeft: "1px solid #cbd5e1", paddingLeft: "12px", marginLeft: "4px" }}>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#64748b" }}>바둑판 캔버스:</span>
                  <span style={{ fontSize: "11px", fontWeight: 700, color: "#0284c7", background: "#e0f2fe", padding: "3px 8px", borderRadius: "4px", border: "1px solid #7dd3fc" }}>
                    화이트 & 스카이블루 바둑판
                  </span>
                </div>
              </>
            ) : null}

            <button
              type="button"
              className={`sp-v6-lock-toggle-btn ${isLocked ? "btn-unlock" : "btn-lock"}`}
              onClick={toggleLock}
            >
              {isLocked ? "🔓 리사이즈 및 편집하기" : "🔒 편집 완료 및 잠금"}
            </button>
          </div>
        </aside> : null}

        {/* 상단 통합 배너 */}
        <header className="sp-v5-top-banner">
          <div className="sp-v5-title-zone">
            <p className="page-kicker">가족 홈 · 43인치 마우스 드래그 리사이즈 그리드</p>
            <h1>우리 가족의 건강기록</h1>
            <p>
              {(!loading && profiles.length === 0
                ? "가족 구성원을 등록하면 그 사람의 기록과 판정이 여기에 쌓입니다."
                : "구성원을 고르면 그 사람의 기록과 판정이 이어집니다.") +
                " (타일 우측 모서리 마우스 드래그로 1블럭 단위 조절 + 잠금 시 일체형 고정)"}
            </p>
          </div>

          <div className="sp-v5-top-actions">
            {hiddenProfiles.length > 0 ? (
              <button
                className="secondary-button compact-button"
                type="button"
                onClick={() => {
                  setActionError(undefined);
                  setHiddenProfilesDialogOpen(true);
                }}
              >
                숨긴 프로필 {hiddenProfiles.length}명
              </button>
            ) : null}
            {selectedProfile ? (
              <>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setActionError(undefined);
                    setProfileEditDialogOpen(true);
                  }}
                >
                  프로필 관리
                </button>
                <button
                  className="secondary-button"
                  type="button"
                  onClick={() => {
                    setActionError(undefined);
                    setFamilyHistoryDialogOpen(true);
                  }}
                >
                  가족력 관리
                </button>
                <button
                  className="primary-button"
                  type="button"
                  onClick={() => setRecordChoiceOpen(true)}
                >
                  + 새 기록 작성
                </button>
              </>
            ) : null}
          </div>
        </header>

        {error ? <div className="alert error-alert" role="alert">{error}</div> : null}
        {actionError && !profileLifecycleAction && !hiddenProfilesDialogOpen ? (
          <div className="alert error-alert" role="alert">{actionError}</div>
        ) : null}

        {/* 선택된 구성원 정보 & 핵심 지표 인라인 바 */}
        {selectedProfile ? (
          <div className="sp-v5-selected-bar">
            <div>
              <h2>{selectedProfile.displayName}님의 건강 현황</h2>
            </div>
            <div className="sp-v5-metric-bar">
              <MetricCard label="저장된 기록" value={`${summary?.totalRecords ?? 0}건`} />
              <MetricCard
                label="최근 기록"
                value={summary?.latestRecordedAt ? formatDate(summary.latestRecordedAt) : "아직 없음"}
              />
              <MetricCard label="프로필 상태" value="안전" tone="safe" />
            </div>
          </div>
        ) : null}

        {/* 12-컬럼 심리스 벤토 타일 그리드:
            Lock 상태: 편집 바/핸들/리사이저 100% 제거, 완벽한 일체형 디자인
            Unlock 상태: 마우스 우측 리사이저, 1블럭 증감 스텝퍼, 규격(XS~XL), 여백 밀도 선택 활성화 */}
        {selectedProfile ? (
          independentCanvas ? (
            <IndependentTileCanvas
              storageKey={isPushCanvas ? "ieobom:v10-independent-layout:v1" : "ieobom:v3-independent-layout:v2"}
              pushOnResize={isPushCanvas}
              title={isPushCanvas ? "블록 독립 배치 & 리사이즈 밀어내기 (시안 10)" : "블록 독립 배치 (시안 3)"}
              slogan={
                isPushCanvas
                  ? "12열 × 32px 행 · 길이 조절 시 조절 방향으로 타일 밀어내기(Push on Resize) · 배율 및 리사이즈 지원"
                  : "12열 × 32px 행 · 겹침 금지 · 좌우 크기 및 0.25배 / 0.5배 / 1배 배율 조절 지원"
              }
              tiles={tiles.map((tile, index) => toIndependentTile(tile, index, renderTileContent(tile)))}
            />
          ) : (
          <div
            className={`sp-v7-canvas-container ${isLocked ? "is-locked" : "is-unlocked"} ${draggedTileId ? "is-dragging-active" : ""}`}
            onDragOver={(e) => {
              if (!isLocked && draggedTileId) {
                e.preventDefault();
              }
            }}
          >
            {/* 12-컬럼 그리드 가이드 룰러 (드래그 시 노출) */}
            {!isLocked && draggedTileId ? (
              <div className="sp-v7-grid-ruler" aria-hidden="true">
                {Array.from({ length: 12 }, (_, i) => (
                  <div key={i} className="sp-v7-ruler-col">
                    {i + 1}열
                  </div>
                ))}
              </div>
            ) : null}

            <main id="sp-v7-grid" className="sp-v6-bento-grid">
              {tiles.map((tile, index) => {
                const isDragging = draggedTileId === tile.id;
                const isDragOver = dragOverTileId === tile.id;
                const isResizing = resizingTileId === tile.id;

                return (
                  <Fragment key={tile.id}>
                    <section
                      data-tile-id={tile.id}
                      className={`sp-v6-tile sp-v7-tile col-span-${tile.colSpan} density-${tile.density} ${tile.breakRow ? "break-row" : ""} ${isLocked ? "is-locked" : "is-unlocked"} ${isDragging ? "is-dragging is-being-dragged" : ""} ${!isDragging && isDragOver && dragDropMode === "swap" ? "drop-target-swap" : ""} ${!isDragging && isDragOver && dragDropMode === "before" ? "drop-target-before" : ""} ${!isDragging && isDragOver && dragDropMode === "after" ? "drop-target-after" : ""} ${isResizing ? "is-resizing" : ""}`}
                      draggable={!isLocked && !isResizing}
                      onDragStart={(e) => handleDragStart(e, tile.id)}
                      onDragOver={(e) => handleTileDragOver(e, tile.id)}
                      onDragLeave={handleDragLeave}
                      onDragEnd={handleDragEnd}
                      onDrop={(e) => handleTileDrop(e, index)}
                      aria-label={tile.title}
                      style={{
                        position: "relative",
                        ...(tile.breakRow ? { gridColumn: `1 / span ${tile.colSpan}` } : {}),
                        ...(tile.height ? { height: `${tile.height}px`, minHeight: `${tile.height}px` } : {}),
                      }}
                    >
                      {/* 드롭 타깃 오버레이 (교체 / 앞 / 뒤) - DOM 위치 이동 없이 마우스 반응 표시 */}
                      {!isDragging && isDragOver && dragDropMode === "swap" ? (
                        <div className="sp-v7-swap-overlay">
                          <div className="sp-v7-swap-badge">
                            <span>⇄</span>
                            <span>타일간 위치 맞바꾸기</span>
                          </div>
                          <span className="sp-v7-swap-desc">
                            {tile.title} ↔ {draggedTile?.title}
                          </span>
                        </div>
                      ) : null}

                      {!isDragging && isDragOver && dragDropMode === "before" ? (
                        <div className="sp-v7-before-badge">
                          <span>◀</span>
                          <span>{tile.title} 앞에 놓기</span>
                        </div>
                      ) : null}

                      {!isDragging && isDragOver && dragDropMode === "after" ? (
                        <div className="sp-v7-after-badge">
                          <span>{tile.title} 뒤에 놓기</span>
                          <span>▶</span>
                        </div>
                      ) : null}

                      {/* 잠금 해제 시에만 노출되는 타일 제어 헤더 */}
                      {!isLocked ? (
                        <header className="sp-v6-tile-edit-bar">
                          <span className="sp-v6-tile-drag-handle">
                            <span>⋮⋮</span>
                            <strong>{tile.title}</strong>
                          </span>

                          <div className="sp-v6-tile-actions">
                            {/* 1) 규격 프리셋 선택 (XS ~ XL) */}
                            <select
                              aria-label={`${tile.title} 규격 프리셋`}
                              className="sp-v6-spec-select"
                              value={tile.specPreset}
                              onChange={(e) => setTileSpec(tile.id, e.target.value as TileSpec)}
                            >
                              <option value="xs">규격: XS (3열·25%)</option>
                              <option value="sm">규격: SM (4열·33%)</option>
                              <option value="md">규격: MD (6열·50%)</option>
                              <option value="lg">규격: LG (8열·67%)</option>
                              <option value="xl">규격: XL (12열·100%)</option>
                              <option value="custom">사용자 지정 ({tile.colSpan}열)</option>
                            </select>

                            {/* 2) 1블럭씩 가로 너비 미세 증감 제어 스텝퍼 */}
                            <div className="sp-v7-col-stepper" title="1블럭 단위로 가로 너비 미세 조절 (- / +)">
                              <button
                                type="button"
                                disabled={tile.colSpan <= (TILE_MIN_COLS[getTileType(tile)] ?? 3)}
                                onClick={() => setTileCols(tile.id, (tile.colSpan - 1) as TileColSpan)}
                                title="가로 너비 줄이기 (-1블럭)"
                              >
                                -
                              </button>
                              <span className="sp-v7-col-value">{tile.colSpan}/12 블럭</span>
                              <button
                                type="button"
                                disabled={tile.colSpan >= 12}
                                onClick={() => setTileCols(tile.id, (tile.colSpan + 1) as TileColSpan)}
                                title="가로 너비 늘리기 (+1블럭)"
                              >
                                +
                              </button>
                            </div>

                            {/* 3) 세로 높이 조절 스텝퍼 (세로로 줄이기 / 늘리기 / 자동 복원) */}
                            <div className="sp-v7-height-stepper" title="세로 높이 조절 (-40px / +40px / 자동)">
                              <button
                                type="button"
                                disabled={Boolean(tile.height && tile.height <= 180)}
                                onClick={() => setTileHeight(tile.id, Math.max(160, (tile.height ?? 360) - 40))}
                                title="세로 높이 줄이기 (-40px)"
                              >
                                -
                              </button>
                              <span className="sp-v7-height-value">
                                {tile.height ? `${tile.height}px` : "높이 자동"}
                              </span>
                              <button
                                type="button"
                                disabled={Boolean(tile.height && tile.height >= 900)}
                                onClick={() => setTileHeight(tile.id, Math.min(1000, (tile.height ?? 360) + 40))}
                                title="세로 높이 늘리기 (+40px)"
                              >
                                +
                              </button>
                              {tile.height ? (
                                <button
                                  type="button"
                                  style={{ borderLeft: "1px solid #cbd5e1", fontSize: "11px", padding: "0 6px" }}
                                  onClick={() => setTileHeight(tile.id, undefined)}
                                  title="자동 높이로 복원"
                                >
                                  자동
                                </button>
                              ) : null}
                            </div>

                            {/* 4) 줄바꿈 고정 버튼 */}
                            <button
                              type="button"
                              className={`sp-v6-tile-btn ${tile.breakRow ? "sp-v7-btn-active" : ""}`}
                              style={
                                tile.breakRow
                                  ? { background: "#0284c7", color: "#ffffff", borderColor: "#0369a1", fontWeight: 700 }
                                  : { color: "#64748b" }
                              }
                              title={tile.breakRow ? "새 줄 1열부터 시작(위로 당겨지지 않음)" : "상단 빈자리가 있으면 이전 줄에 이어붙기"}
                              onClick={() => toggleTileBreakRow(tile.id)}
                            >
                              {tile.breakRow ? "줄바꿈: 고정 ↵" : "줄바꿈: 꺼짐"}
                            </button>

                            {/* 5) 여백 밀도 조절 */}
                            <button
                              type="button"
                              className="sp-v6-tile-btn"
                              title="여백 밀도 토글 (촘촘하게 ↔ 보통 ↔ 여유있게)"
                              onClick={() => {
                                const nextDensity: TileDensity =
                                  tile.density === "dense" ? "compact" : tile.density === "compact" ? "spacious" : "dense";
                                setTileDensity(tile.id, nextDensity);
                              }}
                            >
                              {tile.density === "dense" ? "여백: 최소" : tile.density === "compact" ? "여백: 보통" : "여백: 여유"}
                            </button>

                            {/* 6) 앞/뒤 직접 맞바꾸기 버튼 */}
                            <button
                              type="button"
                              className="sp-v6-tile-btn"
                              disabled={index === 0}
                              onClick={() => swapTiles(index, index - 1)}
                              title="이전 타일과 위치 맞바꾸기"
                            >
                              ◀ 맞바꿈
                            </button>
                            <button
                              type="button"
                              className="sp-v6-tile-btn"
                              disabled={index === tiles.length - 1}
                              onClick={() => swapTiles(index, index + 1)}
                              title="다음 타일과 위치 맞바꾸기"
                            >
                              맞바꿈 ▶
                            </button>
                          </div>
                        </header>
                      ) : null}

                      {/* 리사이즈 핸들: 가로(우측) + 세로(하단) + 코너(우하단) */}
                      {!isLocked ? (
                        <>
                          <div
                            className={`sp-v7-resize-handle-right ${isResizing && resizingDirection === "horizontal" ? "is-active" : ""}`}
                            onMouseDown={(e) => startResizing(e, tile, "horizontal")}
                            title="마우스로 잡고 좌우로 드래그하여 가로 너비 조절"
                          />
                          <div
                            className={`sp-v7-resize-handle-bottom ${isResizing && resizingDirection === "vertical" ? "is-active" : ""}`}
                            onMouseDown={(e) => startResizing(e, tile, "vertical")}
                            title="마우스로 잡고 상하로 드래그하여 세로 높이 조절"
                          />
                          <div
                            className={`sp-v7-resize-handle-corner ${isResizing && resizingDirection === "both" ? "is-active" : ""}`}
                            onMouseDown={(e) => startResizing(e, tile, "both")}
                            title="마우스로 잡고 대각선으로 드래그하여 가로·세로 동시 조절"
                          />
                        </>
                      ) : null}

                      {/* 타일 실제 컴포넌트 본체 (세로 높이 제한 시 내부 스크롤 허용) */}
                      <div
                        className="sp-v6-tile-body no-padding"
                        style={{
                          overflowY: tile.height ? "auto" : "visible",
                          maxHeight: tile.height ? `calc(${tile.height}px - 44px)` : "none",
                        }}
                      >
                        {renderTileContent(tile)}
                      </div>
                    </section>
                  </Fragment>
                );
              })}

              {/* 맨 끝 추가/배치 슬롯 (드래그 중일 때 노출) */}
              {!isLocked && draggedTileId ? (
                <div
                  className="sp-v7-append-slot"
                  onDragOver={(e) => {
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                  }}
                  onDrop={handleAppendDrop}
                >
                  <div className="sp-v7-append-box">
                    <span className="sp-v7-append-icon">+</span>
                    <span>대시보드 맨 끝에 배치 (여기에 놓으면 맨 뒤로 이동합니다)</span>
                  </div>
                </div>
              ) : null}
            </main>
          </div>
          )
        ) : null}
      </div>

      {/* 모든 실제 모달 다이얼로그 (생성, 수정, 삭제, 복원 등) */}
      {profileDialogOpen ? (
        <Modal kicker="이 기기에 저장" title="가족 구성원 로컬 프로필 만들기" onClose={() => setProfileDialogOpen(false)}>
          <form className="product-form" onSubmit={submitProfile}>
            <p className="form-notice">입력한 정보는 이 브라우저에 암호화해 저장하며 서버로 보내지 않습니다.</p>
            <label>
              이름 또는 호칭
              <input name="displayName" maxLength={100} required placeholder="예: 나, 엄마, 민준" autoFocus />
            </label>
            <label>
              관계
              <select name="relationship" required defaultValue="">
                <option value="" disabled>관계를 선택하세요</option>
                {RELATIONSHIPS.map((relationship) => <option key={relationship}>{relationship}</option>)}
              </select>
            </label>
            <label>
              성별
              <select name="gender" defaultValue="">
                <option value="" disabled>남성 또는 여성</option>
                <option value="male">남성</option>
                <option value="female">여성</option>
              </select>
            </label>
            <BirthDateInput />
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setProfileDialogOpen(false)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "프로필 저장"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {openRecord ? (
        <Suspense fallback={null}>
          <RecordDetail
            record={openRecord}
            onClose={() => setOpenRecord(undefined)}
            linkedAssessment={
              openRecord.recordType === "assessment"
                ? undefined
                : records.find(
                    (item) =>
                      item.recordType === "assessment" &&
                      ((item.payload as { sourceRecordId?: string }).sourceRecordId === openRecord.id ||
                        (Boolean(openRecord.sourceDocumentId) &&
                          item.sourceDocumentId === openRecord.sourceDocumentId)),
                  )
            }
            onViewPrediction={(assessment) => setOpenRecord(assessment)}
            onEdit={
              openRecord.recordType === "assessment"
                ? undefined
                : () => {
                    const target = openRecord;
                    setOpenRecord(undefined);
                    setActionError(undefined);
                    setEditingRecord(target);
                  }
            }
            onDelete={() => {
              const target = openRecord;
              setOpenRecord(undefined);
              setActionError(undefined);
              setDeletingRecord(target);
            }}
          />
        </Suspense>
      ) : null}

      {recordChoiceOpen && selectedProfile ? (
        <Modal kicker="이 기기에 저장" title={`${selectedProfile.displayName}님의 기록을 어떻게 남길까요?`} onClose={() => setRecordChoiceOpen(false)}>
          <div className="record-choice">
            <button
              className="record-choice-card"
              type="button"
              onClick={() => {
                setRecordChoiceOpen(false);
                setRecordDialogOpen(true);
              }}
            >
              <strong>직접 작성</strong>
              <small>혈압을 재거나 통증이 있었던 날처럼, 짧게 적어 두는 기록이에요.</small>
              <span className="record-choice-meta">종류 · 시각 · 내용</span>
            </button>

            <button
              className="record-choice-card is-primary"
              type="button"
              onClick={() => {
                setRecordChoiceOpen(false);
                void navigate("/assessment", {
                  state: { withDocument: true, profileId: selectedProfile.id },
                });
              }}
            >
              <strong>검진표 올려서 판정</strong>
              <small>
                건강검진 결과지를 올리면 표에서 수치를 읽어 판정 폼을 채워요.
              </small>
              <span className="record-choice-meta">이미지 · PDF · 7~20초</span>
            </button>

            <button
              className="record-choice-card"
              type="button"
              onClick={() => {
                setRecordChoiceOpen(false);
                try {
                  localStorage.setItem("ieobom:global-assistant-open", "true");
                } catch {
                  // ignore
                }
                window.dispatchEvent(new CustomEvent("ieobom:open-assistant"));
              }}
            >
              <strong>봄이와 대화로</strong>
              <small>
                “어제 30분 걸었어”, “아침 혈압 130에 85” 처럼 말하면 비서가 기록으로 남겨요.
              </small>
              <span className="record-choice-meta">운동 · 혈압 · 혈당 · 복약 · 통증</span>
            </button>
          </div>
          <p className="form-notice">
            검진표 원본은 암호화해 보관됩니다. AI 문서 분석 결과를 원본과 대조한 뒤 확정할 수 있습니다.
          </p>
        </Modal>
      ) : null}

      {recordDialogOpen && selectedProfile ? (
        <Modal kicker="내 계정에 저장" title={`${selectedProfile.displayName}님의 건강기록 작성`} onClose={() => setRecordDialogOpen(false)}>
          <form className="product-form" onSubmit={submitHealthRecord}>
            <p className="form-notice">기록은 내 계정에 저장되고, 같은 가정 구성원만 볼 수 있습니다.</p>
            <label>
              기록 종류
              <select name="recordType" defaultValue="note" required>
                {RECORD_TYPES.map((value) => <option key={value} value={value}>{recordTypeLabel(value)}</option>)}
              </select>
            </label>
            <label>
              기록 시각
              <input name="recordedAt" type="datetime-local" required defaultValue={currentLocalDateTime()} />
            </label>
            <label>
              기록 내용
              <textarea name="note" rows={5} required placeholder="변화, 수치 또는 확인할 내용을 적어주세요." />
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setRecordDialogOpen(false)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "암호화 중…" : "기록 저장"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {editingRecord ? (
        <Modal kicker="이 기기에 저장" title="건강기록 수정" onClose={() => setEditingRecord(undefined)}>
          <form className="product-form" onSubmit={submitHealthRecordUpdate}>
            <label>
              기록 종류
              <select name="recordType" defaultValue={editingRecord.recordType} required>
                {RECORD_TYPES.map((value) => <option key={value} value={value}>{recordTypeLabel(value)}</option>)}
              </select>
            </label>
            <label>
              기록 시각
              <input name="recordedAt" type="datetime-local" required defaultValue={toLocalDateTime(editingRecord.recordedAt)} />
            </label>
            <label>
              기록 내용
              <textarea name="note" rows={5} required defaultValue={recordNote(editingRecord)} />
            </label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setEditingRecord(undefined)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "변경사항 저장"}</button>
            </div>
          </form>
        </Modal>
      ) : null}

      {deletingRecord ? (
        <Modal kicker="이 기기에 저장" title="건강기록을 삭제할까요?" onClose={() => setDeletingRecord(undefined)}>
          <div className="profile-confirmation">
            <p>기록은 즉시 영구 삭제되지 않고 삭제 목록으로 이동합니다. 필요하면 다시 복원할 수 있습니다.</p>
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setDeletingRecord(undefined)}>취소</button>
              <button className="danger-button" type="button" disabled={saving} onClick={() => void confirmHealthRecordDelete()}>
                {saving ? "처리 중…" : "삭제 목록으로 이동"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {deletedRecordsDialogOpen ? (
        <Modal kicker="이 기기에 저장" title="삭제된 건강기록" onClose={() => setDeletedRecordsDialogOpen(false)}>
          <div className="hidden-profiles-content">
            <p className="form-notice">삭제한 기록은 대시보드 집계에서 제외되며 이 브라우저에서 복원할 수 있습니다.</p>
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="hidden-profile-list">
              {deletedRecords.map((record) => (
                <article className="hidden-profile-row" key={record.id}>
                  <div><strong>{recordTypeLabel(record.recordType)}</strong><small>{formatDateTime(record.recordedAt)} · {recordNote(record)}</small></div>
                  {purgingRecord?.id === record.id ? (
                    <div className="record-purge-confirm">
                      <span>되돌릴 수 없어요.</span>
                      <button className="danger-button" type="button" disabled={saving} onClick={() => void purgeDeletedHealthRecord(record)}>
                        영구 삭제
                      </button>
                      <button className="text-button" type="button" disabled={saving} onClick={() => setPurgingRecord(undefined)}>
                        취소
                      </button>
                    </div>
                  ) : (
                    <div className="record-row-actions">
                      <button className="secondary-button" type="button" disabled={saving} onClick={() => void restoreDeletedHealthRecord(record)}>복원</button>
                      <button className="text-button" type="button" disabled={saving} onClick={() => setPurgingRecord(record)}>영구 삭제</button>
                    </div>
                  )}
                </article>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}

      {profileEditDialogOpen && selectedProfile ? (
        <Modal kicker="이 기기에 저장" title={`${selectedProfile.displayName} 프로필 관리`} onClose={() => setProfileEditDialogOpen(false)}>
          <form className="product-form" onSubmit={submitProfileUpdate}>
            <p className="form-notice">프로필 정보와 건강기록은 계속 이 브라우저에만 저장됩니다.</p>
            <label>
              이름 또는 호칭
              <input
                name="displayName"
                maxLength={100}
                required
                defaultValue={selectedProfile.displayName}
                autoFocus
              />
            </label>
            <label>
              관계
              <select name="relationship" required defaultValue={selectedProfile.relationship}>
                {RELATIONSHIPS.map((relationship) => <option key={relationship}>{relationship}</option>)}
              </select>
            </label>
            <label>
              성별
              <select name="gender" defaultValue={selectedProfile.gender ?? ""}>
                <option value="" disabled>남성 또는 여성</option>
                <option value="male">남성</option>
                <option value="female">여성</option>
              </select>
            </label>
            <BirthDateInput defaultValue={selectedProfile.birthDate ?? ""} />
            {selectedProfile.accountEmail ? (
              <label>
                연동 계정 (Google)
                <input
                  type="text"
                  readOnly
                  disabled
                  defaultValue={selectedProfile.accountEmail}
                  style={{ opacity: 0.85, cursor: "not-allowed" }}
                />
              </label>
            ) : null}
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setProfileEditDialogOpen(false)}>취소</button>
              <button className="primary-button" type="submit" disabled={saving}>{saving ? "저장 중…" : "변경사항 저장"}</button>
            </div>
          </form>

          <section className="profile-lifecycle-zone" aria-labelledby="v6-profile-lifecycle-heading">
            <h3 id="v6-profile-lifecycle-heading">프로필 정리</h3>
            <p>기록을 보존하려면 숨기기를 사용하세요. 영구 삭제는 연결된 기록이 없는 프로필에만 허용됩니다.</p>
            <div className="profile-lifecycle-actions">
              <button className="secondary-button" type="button" onClick={() => {
                setActionError(undefined);
                setProfileEditDialogOpen(false);
                setProfileLifecycleAction("hide");
              }}>
                목록에서 숨기기
              </button>
              <button className="danger-button" type="button" onClick={() => {
                setActionError(undefined);
                setProfileEditDialogOpen(false);
                setProfileLifecycleAction("delete");
              }}>
                빈 프로필 영구 삭제
              </button>
            </div>
          </section>
        </Modal>
      ) : null}

      {profileLifecycleAction && selectedProfile ? (
        <Modal
          title={profileLifecycleAction === "hide" ? "프로필을 목록에서 숨길까요?" : "빈 프로필을 영구 삭제할까요?"}
          onClose={() => setProfileLifecycleAction(undefined)}
        >
          <div className="profile-confirmation">
            {profileLifecycleAction === "hide" ? (
              <p><strong>{selectedProfile.displayName}</strong> 프로필과 연결 기록은 보존됩니다. 현재 가족 목록에서만 보이지 않게 됩니다.</p>
            ) : (
              <p><strong>{selectedProfile.displayName}</strong> 프로필을 이 브라우저에서 삭제합니다. 연결된 기록이 하나라도 있으면 삭제하지 않고 안내합니다.</p>
            )}
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setProfileLifecycleAction(undefined)}>취소</button>
              <button
                className={profileLifecycleAction === "delete" ? "danger-button" : "primary-button"}
                type="button"
                disabled={saving}
                onClick={() => void confirmProfileLifecycle()}
              >
                {saving ? "처리 중…" : profileLifecycleAction === "hide" ? "프로필 숨기기" : "영구 삭제"}
              </button>
            </div>
          </div>
        </Modal>
      ) : null}

      {hiddenProfilesDialogOpen ? (
        <Modal kicker="이 기기에 저장" title="숨긴 프로필 관리" onClose={() => setHiddenProfilesDialogOpen(false)}>
          <div className="hidden-profiles-content">
            <p className="form-notice">숨긴 프로필과 연결된 건강기록은 삭제되지 않았습니다. 복원하면 가족 목록에서 다시 확인할 수 있습니다.</p>
            {actionError ? <div className="alert error-alert" role="alert">{actionError}</div> : null}
            <div className="hidden-profile-list">
              {hiddenProfiles.map((profile) => (
                <article key={profile.id} className="hidden-profile-row">
                  <div>
                    <strong>{profile.displayName}</strong>
                    <small>{formatProfileDescription(profile)}</small>
                  </div>
                  <button
                    className="secondary-button"
                    type="button"
                    disabled={saving}
                    aria-label={`${profile.displayName} 프로필 복원`}
                    onClick={() => void restoreHiddenProfile(profile)}
                  >
                    {saving ? "처리 중…" : "복원"}
                  </button>
                </article>
              ))}
            </div>
          </div>
        </Modal>
      ) : null}

      {familyHistoryDialogVisible && runtime && selectedProfile ? (
        <FamilyHistoryManager
          runtime={runtime}
          profile={selectedProfile}
          onClose={() => setFamilyHistoryDialogOpen(false)}
        />
      ) : null}
    </div>
  );
}

const LEVEL_TONE: Record<string, string> = {
  VERY_HIGH: "tone-very-high",
  HIGH: "tone-high",
  CAUTION: "tone-caution",
  NORMAL: "tone-normal",
  INSUFFICIENT_DATA: "tone-unknown",
};

const INDEPENDENT_DEFAULTS: Record<TileType, { x: number; y: number; w: number; h: number }> = {
  members: { x: 0, y: 0, w: 12, h: 5 },
  singleMetric: { x: 0, y: 5, w: 5, h: 9 },
  familyComparison: { x: 5, y: 5, w: 7, h: 9 },
  monitoring: { x: 0, y: 14, w: 7, h: 14 },
  bodymap: { x: 7, y: 14, w: 5, h: 16 },
  trends: { x: 0, y: 30, w: 12, h: 12 },
  records: { x: 0, y: 42, w: 7, h: 10 },
  activeRecord: { x: 7, y: 42, w: 5, h: 10 },
};

function toIndependentTile(tile: TileConfig, index: number, content: ReactNode): IndependentTile {
  const type = getTileType(tile);
  const fallback = INDEPENDENT_DEFAULTS[type] ?? { x: 0, y: 52 + index * 9, w: tile.colSpan, h: 8 };
  return {
    id: tile.id,
    title: tile.title,
    ...fallback,
    minW: 3,
    minH: type === "bodymap" ? 8 : 4,
    content,
  };
}

function MemberVerdict({ summary }: { summary?: LatestSummary }) {
  if (!summary) {
    return <span className="member-verdict is-empty">판정 기록 없음</span>;
  }
  const level = summary.highestLevel as RiskLevel;
  return (
    <span className={`member-verdict ${LEVEL_TONE[summary.highestLevel] ?? "tone-unknown"}`}>
      <strong>{LEVEL_LABEL[level] ?? summary.highestLevel}</strong>
      {summary.needsAttention > 0 ? <span>주의 {summary.needsAttention}개</span> : <span>주의 없음</span>}
      <small>{formatDate(summary.recordedAt)}</small>
    </span>
  );
}

function EmptyHousehold({ disabled, onCreate }: { disabled: boolean; onCreate: () => void }) {
  return (
    <div className="empty-household">
      <div className="empty-household-copy">
        <span className="empty-step">첫 단계</span>
        <h3>가족 구성원 프로필을 만들어 시작하세요.</h3>
        <p>별도 로그인 없이 건강기록의 대상을 구분하는 로컬 프로필입니다.</p>
        <button className="primary-button" type="button" disabled={disabled} onClick={onCreate}>
          첫 구성원 등록
        </button>
      </div>
      <ol className="onboarding-steps">
        <li><span>1</span><div><strong>프로필 만들기</strong><small>이름·관계·생년 정보</small></div></li>
        <li><span>2</span><div><strong>건강기록 남기기</strong><small>검진·통증·건강 메모</small></div></li>
        <li><span>3</span><div><strong>백업 파일 보관</strong><small>암호화해 직접 내보내기</small></div></li>
      </ol>
    </div>
  );
}

function MetricCard({ label, value, helper, tone }: { label: string; value: string; helper?: string; tone?: "safe" }) {
  return (
    <article className={tone === "safe" ? "metric-card is-safe" : "metric-card"}>
      <span>{label}</span>
      <strong>{value}</strong>
      {helper ? <small>{helper}</small> : null}
    </article>
  );
}

function optionalDate(value: FormDataEntryValue | null): `${number}-${number}-${number}` | undefined {
  const date = String(value ?? "");
  return date ? (date as `${number}-${number}-${number}`) : undefined;
}

function optionalGender(value: FormDataEntryValue | null): Gender | null {
  const str = String(value ?? "");
  return str === "male" || str === "female" ? str : null;
}

function formatProfileDescription(profile: FamilyProfile): string {
  const genderLabel = profile.gender === "male" ? "남성" : profile.gender === "female" ? "여성" : "";
  const birthYear = profile.birthDate ? `${profile.birthDate.slice(0, 4)}년생` : "";
  return [profile.relationship, genderLabel, birthYear].filter(Boolean).join(" · ");
}

function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric" }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function currentLocalDateTime(): string {
  const now = new Date();
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function toLocalDateTime(value: string): string {
  const date = new Date(value);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

function recordNote(record: HealthRecord): string {
  return recordSummary(record);
}
