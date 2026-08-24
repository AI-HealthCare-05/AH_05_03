import { useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useLocalDomain } from "../../app/localDomainContext";
import type { HealthRecord } from "../../shared/local/domainContracts";
import { FloatingHealthTools } from "../health-record/HealthRecordWorkspace";
import { ExamTrendSection } from "../health-record/ExamTrendSection";
import { ChronicDiseaseRiskSection } from "./ChronicDiseaseRiskSection";
import "./healthAnalysisPage.css";

export function HealthAnalysisPage() {
  const { profileId: routeProfileId } = useParams();
  const navigate = useNavigate();
  const { runtime, profiles, loading, error } = useLocalDomain();

  const [selectedProfileId, setSelectedProfileId] = useState<string>();
  const [records, setRecords] = useState<HealthRecord[]>([]);
  const [loadingRecords, setLoadingRecords] = useState(false);

  const selectedProfile = useMemo(() => {
    return profiles.find((p) => p.id === (selectedProfileId || routeProfileId)) || profiles[0];
  }, [profiles, selectedProfileId, routeProfileId]);

  useEffect(() => {
    if (selectedProfile && selectedProfile.id !== selectedProfileId) {
      setSelectedProfileId(selectedProfile.id);
    }
  }, [selectedProfile, selectedProfileId]);

  const loadRecords = useCallback(async () => {
    if (!runtime || !selectedProfile) return;
    setLoadingRecords(true);
    try {
      const listResult = await runtime.healthRecords.query({ profileId: selectedProfile.id, includeDeleted: false });
      if (listResult.ok) {
        setRecords(listResult.value);
      }
    } catch {
      // 무시
    } finally {
      setLoadingRecords(false);
    }
  }, [runtime, selectedProfile]);

  useEffect(() => {
    void loadRecords();
  }, [loadRecords]);

  if (loading) {
    return (
      <div className="product-page analysis-page">
        <div className="empty-card">
          <p>로컬 건강 분석 데이터를 불러오는 중입니다…</p>
        </div>
      </div>
    );
  }

  if (!selectedProfile) {
    return (
      <div className="product-page analysis-page">
        <div className="empty-card">
          <h3>등록된 구성원 프로필이 없습니다.</h3>
          <p>가족 홈에서 먼저 구성원을 추가해 주세요.</p>
          <button className="primary-button" type="button" onClick={() => navigate("/")}>
            가족 홈으로 이동
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="product-page analysis-page">
      <section className="dashboard-heading">
        <div>
          <p className="page-kicker">건강 심층 분석 및 예측</p>
          <h1>{selectedProfile.displayName}님의 건강 데이터 분석</h1>
          <p>과거 검사 수치 변화 추이(트렌드)와 머신러닝 만성질환 위험도 예측을 한곳에서 확인합니다.</p>
        </div>
      </section>

      {/* 프로필 선택 탭 */}
      {profiles.length > 1 && (
        <div className="analysis-profile-tabs" role="tablist" aria-label="가족 구성원 선택">
          {profiles.map((p) => (
            <button
              key={p.id}
              type="button"
              className={selectedProfile.id === p.id ? "profile-tab is-active" : "profile-tab"}
              onClick={() => {
                setSelectedProfileId(p.id);
                navigate(`/members/${p.id}/analysis`);
              }}
            >
              <span className="profile-tab-name">{p.displayName}</span>
              <span className="profile-tab-rel">{p.relationship}</span>
            </button>
          ))}
        </div>
      )}

      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

      <div className="analysis-content-layout">
        {/* 📈 1. [상단] 검사 수치 변화 추이 (시계열 데이터 비교 및 전체 비교표 모달) */}
        <div className="analysis-card trend-container-card">
          <ExamTrendSection
            records={records}
            profileName={selectedProfile.displayName}
            runtime={runtime}
          />
        </div>

        {/* 🤖 2. [하단] 만성질환 위험도 예측 (ML 예측 모델 & 학회 지침 엔진) */}
        <div className="analysis-card ml-container-card">
          <ChronicDiseaseRiskSection
            records={records}
            profile={selectedProfile}
          />
        </div>
      </div>

      <FloatingHealthTools
        profile={selectedProfile}
        runtime={runtime}
        onSaved={loadRecords}
      />
    </div>
  );
}
