/**
 * 통합 건강 시계열 데이터 훅 (useHealthTimeSeries)
 *
 * 일반 건강기록(healthRecords)과 질환 판정 스냅샷(assessment)을
 * 한 번에 쿼리하여 중복을 제거한 표준 시계열 데이터셋을 생성하고 실시간 제공합니다.
 */

import { useCallback, useEffect, useMemo, useState } from "react";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import type { FamilyProfile, HealthRecord, AssessmentSnapshotPayload } from "../../shared/local/domainContracts";
import {
  type ObservationPoint,
  extractObservationsFromRecord,
  extractObservationsFromSnapshot,
  mergeObservations,
  observationsToTrendSeries,
  observationsToFamilyData,
} from "./timeSeriesObservation";
import type { TrendSeries } from "../assessment/snapshots";

export interface UseHealthTimeSeriesOptions {
  runtime?: LocalDomainRuntime;
  profiles: FamilyProfile[];
  activeProfileId?: string;
  fromDate?: string;
  refreshTrigger?: number | string;
}

export function useHealthTimeSeries({
  runtime,
  profiles,
  activeProfileId,
  fromDate,
  refreshTrigger,
}: UseHealthTimeSeriesOptions) {
  const [loading, setLoading] = useState(false);
  const [allObservations, setAllObservations] = useState<ObservationPoint[]>([]);

  const fetchTimeSeries = useCallback(async () => {
    if (!runtime || profiles.length === 0) return;
    setLoading(true);

    try {
      const allPoints: ObservationPoint[] = [];

      // 전 가족 구성원의 일반 건강기록 + 판정 스냅샷 병렬 수집
      await Promise.all(
        profiles.map(async (profile) => {
          // 1. 일반 건강기록 (바이탈, 체중, 혈압, 혈당, 검진표)
          const recordsResult = await runtime.healthRecords.query({
            profileId: profile.id,
            includeDeleted: false,
          });

          if (recordsResult.ok) {
            for (const rec of recordsResult.value) {
              if (rec.recordType === "assessment") {
                const snapshotPoints = extractObservationsFromSnapshot(
                  rec as unknown as HealthRecord<AssessmentSnapshotPayload>,
                );
                allPoints.push(...snapshotPoints);
              } else {
                const vitalPoints = extractObservationsFromRecord(rec);
                allPoints.push(...vitalPoints);
              }
            }
          }

        }),
      );

      // 3. 지능형 중복 제거 및 시간순 정렬
      const merged = mergeObservations(allPoints);
      setAllObservations(merged);
    } catch (err) {
      console.warn("[useHealthTimeSeries] Failed to aggregate time series:", err);
    } finally {
      setLoading(false);
    }
  }, [runtime, profiles]);

  useEffect(() => {
    void fetchTimeSeries();
  }, [fetchTimeSeries, refreshTrigger]);

  // 활성 프로필의 10대 지표 시계열 (TrendChart 및 SingleMetricCard용)
  const visibleObservations = useMemo(
    () => (fromDate ? allObservations.filter((point) => point.measuredAt >= fromDate) : allObservations),
    [allObservations, fromDate],
  );

  const activeTrendSeries = useMemo<TrendSeries[]>(() => {
    if (!activeProfileId) return [];
    return observationsToTrendSeries(visibleObservations, activeProfileId);
  }, [visibleObservations, activeProfileId]);

  // 가족 전체 비교 맵 (FamilyComparisonChart용)
  const familyComparisonData = useMemo(() => {
    return observationsToFamilyData(visibleObservations, profiles);
  }, [visibleObservations, profiles]);

  return {
    loading,
    allObservations,
    visibleObservations,
    activeTrendSeries,
    familyComparisonData,
    refresh: fetchTimeSeries,
  };
}
