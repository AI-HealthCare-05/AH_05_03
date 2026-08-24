import { useEffect, useMemo, useState } from "react";
import type { FamilyProfile, HealthRecord } from "../../shared/local/domainContracts";
import { analyzeExamTrends } from "../health-record/examTrendAnalyzer";

interface ConditionRisk {
  target: string;
  name: string;
  description: string;
  tier: string;
  label_definition: string;
  threshold_source: string;
  probability: number;
  medical: {
    level: "낮음" | "보통" | "높음" | string;
    rate: number;
    threshold: number;
  };
  top_risk_factors?: Array<{
    name: string;
    importance: number;
    direction: "up" | "down" | string;
    note?: string;
  }>;
  peer_comparison?: {
    peer_rate: number;
    peer_ratio: number;
    group_label: string;
  };
  rule_anchor?: {
    fired: boolean;
    rule_level?: string;
    message?: string;
  };
}

interface PredictionResponse {
  data: {
    bmi: number;
    conditions: ConditionRisk[];
    disclaimers: string[];
    missing_inputs?: string[];
  };
}

interface Props {
  records: HealthRecord[];
  profile: FamilyProfile;
}

function calculateAge(birthDate: string | null): number {
  if (!birthDate) return 45;
  const birth = new Date(birthDate);
  const now = new Date();
  let age = now.getFullYear() - birth.getFullYear();
  const m = now.getMonth() - birth.getMonth();
  if (m < 0 || (m === 0 && now.getDate() < birth.getDate())) {
    age--;
  }
  return Math.min(100, Math.max(19, age));
}

function inferSex(relationship: string): "M" | "F" {
  const rel = relationship.trim().toLowerCase();
  if (rel === "어머니" || rel === "엄마" || rel === "아내" || rel === "딸" || rel === "여동생" || rel === "누나") {
    return "F";
  }
  if (rel === "아버지" || rel === "아빠" || rel === "남편" || rel === "아들" || rel === "남동생" || rel === "형" || rel === "오빠") {
    return "M";
  }
  return "M";
}

export function ChronicDiseaseRiskSection({ records, profile }: Props) {
  const trendData = useMemo(() => analyzeExamTrends(records), [records]);

  // 기본 환자 정보 및 최근 검사값 추출
  const latestValues = useMemo(() => {
    const map = new Map<string, number>();
    for (const m of trendData.metrics) {
      if (m.latest.numericValue !== undefined) {
        map.set(m.canonicalName, m.latest.numericValue);
      }
    }
    return map;
  }, [trendData]);

  // 폼 입력 상태 (프로필 생년월일 및 최근 검사지 키/체중을 기본값으로 자동 반영)
  const [age, setAge] = useState<number>(() => calculateAge(profile.birthDate));
  const [sex, setSex] = useState<"M" | "F">(() => inferSex(profile.relationship));
  const [heightCm, setHeightCm] = useState<number>(() => latestValues.get("키 (신장)") || 170);
  const [weightKg, setWeightKg] = useState<number>(() => latestValues.get("체중 (몸무게)") || 70);
  const [selfRatedHealth, setSelfRatedHealth] = useState<1 | 2 | 3 | 4 | 5>(3);
  const [waistCm, setWaistCm] = useState<string>(() => latestValues.get("허리둘레") ? String(latestValues.get("허리둘레")) : "");
  const [sbp, setSbp] = useState<string>("");
  const [dbp, setDbp] = useState<string>("");
  const [fbg, setFbg] = useState<string>("");
  const [hba1c, setHba1c] = useState<string>("");
  const [totChol, setTotChol] = useState<string>("");
  const [hdl, setHdl] = useState<string>("");
  const [ldl, setLdl] = useState<string>("");
  const [tg, setTg] = useState<string>("");
  const [ast, setAst] = useState<string>("");
  const [alt, setAlt] = useState<string>("");
  const [ggt, setGgt] = useState<string>("");

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [predictionData, setPredictionData] = useState<PredictionResponse["data"] | null>(null);
  const [isParamEditorOpen, setIsParamEditorOpen] = useState(false);

  // 로컬 건강기록의 최신 측정값 및 프로필 변경 시 자동 동기화
  useEffect(() => {
    setAge(calculateAge(profile.birthDate));
    setSex(inferSex(profile.relationship));
    if (latestValues.has("키 (신장)")) setHeightCm(latestValues.get("키 (신장)")!);
    if (latestValues.has("체중 (몸무게)")) setWeightKg(latestValues.get("체중 (몸무게)")!);
    if (latestValues.has("허리둘레")) setWaistCm(String(latestValues.get("허리둘레")));
    if (latestValues.has("수축기 혈압")) setSbp(String(latestValues.get("수축기 혈압")));
    if (latestValues.has("이완기 혈압")) setDbp(String(latestValues.get("이완기 혈압")));
    if (latestValues.has("공복혈당")) setFbg(String(latestValues.get("공복혈당")));
    if (latestValues.has("당화혈색소 (HbA1c)")) setHba1c(String(latestValues.get("당화혈색소 (HbA1c)")));
    if (latestValues.has("총콜레스테롤")) setTotChol(String(latestValues.get("총콜레스테롤")));
    if (latestValues.has("HDL 콜레스테롤")) setHdl(String(latestValues.get("HDL 콜레스테롤")));
    if (latestValues.has("LDL 콜레스테롤")) setLdl(String(latestValues.get("LDL 콜레스테롤")));
    if (latestValues.has("중성지방 (TG)")) setTg(String(latestValues.get("중성지방 (TG)")));
    if (latestValues.has("AST (SGOT)")) setAst(String(latestValues.get("AST (SGOT)")));
    if (latestValues.has("ALT (SGPT)")) setAlt(String(latestValues.get("ALT (SGPT)")));
    if (latestValues.has("γ-GTP (감마지티피)")) setGgt(String(latestValues.get("γ-GTP (감마지티피)")));
  }, [profile, latestValues]);

  // 위험도 예측 실행 함수
  async function runRiskPrediction() {
    setLoading(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        age: Number(age),
        sex,
        height_cm: Number(heightCm),
        weight_kg: Number(weightKg),
        self_rated_health: Number(selfRatedHealth),
      };

      if (waistCm) payload.waist_cm = parseFloat(waistCm);
      if (sbp) payload.sbp = parseFloat(sbp);
      if (dbp) payload.dbp = parseFloat(dbp);
      if (fbg) payload.fasting_glucose = parseFloat(fbg);
      if (hba1c) payload.hba1c = parseFloat(hba1c);
      if (totChol) payload.total_chol = parseFloat(totChol);
      if (hdl) payload.hdl = parseFloat(hdl);
      if (ldl) payload.ldl = parseFloat(ldl);
      if (tg) payload.triglyceride = parseFloat(tg);
      if (ast) payload.ast = parseFloat(ast);
      if (alt) payload.alt = parseFloat(alt);
      if (ggt) payload.ggt = parseFloat(ggt);

      const res = await fetch("/api/v1/predictions/risk", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      if (!res.ok) {
        const errorJson = await res.json().catch(() => ({}));
        throw new Error(errorJson.message || `예측 서버 응답 에러 (${res.status})`);
      }

      const json = (await res.json()) as PredictionResponse;
      setPredictionData(json.data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "위험도 예측을 완료하지 못했습니다.");
    } finally {
      setLoading(false);
    }
  }

  // 컴포넌트 마운트 및 프로필 변경 시 1회 자동 실행
  useEffect(() => {
    void runRiskPrediction();
  }, [profile.id]);

  const computedBmi = (weightKg / ((heightCm / 100) ** 2)).toFixed(1);

  return (
    <section className="chronic-disease-risk-section" aria-labelledby="ml-prediction-heading">
      <div className="section-title-row">
        <div>
          <p className="section-kicker">인공지능 통계 모델 분석</p>
          <h3 id="ml-prediction-heading">🤖 {profile.displayName}님의 만성질환 위험도 예측</h3>
          <p className="section-subtext">
            등록된 생년월일과 최근 건강검진 결과지(신장, 체중, 혈압, 혈당 등)를 바탕으로 10대 만성질환 선별 위험도를 통계적으로 평가합니다.
          </p>
        </div>
        <div className="risk-header-actions">
          <button
            type="button"
            className="secondary-button"
            onClick={() => setIsParamEditorOpen(!isParamEditorOpen)}
          >
            {isParamEditorOpen ? "▲ 입력 수치 닫기" : "⚙️ 입력 수치 직접 조정"}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={loading}
            onClick={() => void runRiskPrediction()}
          >
            {loading ? "계산 중…" : "🔄 다시 계산하기"}
          </button>
        </div>
      </div>

      {/* 내 정보 자동 연동 요약 배너 */}
      <div className="risk-source-banner">
        <div className="source-info-main">
          <span className="source-badge">📌 프로필 및 최근 검진 수치 자동 연동</span>
          <div className="source-meta-row">
            <span><strong>나이:</strong> 만 {age}세 {profile.birthDate ? `(${profile.birthDate}생)` : ""}</span>
            <span><strong>성별:</strong> {sex === "M" ? "남성" : "여성"}</span>
            <span><strong>신장:</strong> {heightCm}cm {latestValues.has("키 (신장)") ? "(최근 검사지)" : ""}</span>
            <span><strong>체중:</strong> {weightKg}kg {latestValues.has("체중 (몸무게)") ? "(최근 검사지)" : ""}</span>
            <span><strong>BMI:</strong> {computedBmi} kg/m²</span>
          </div>
        </div>
      </div>

      {/* 파라미터 조정 패널 (접이식) */}
      {isParamEditorOpen && (
        <div className="param-editor-panel">
          <h5>📊 분석에 반영되는 기본 정보 및 최근 검사값</h5>
          <div className="param-grid">
            <div className="param-field">
              <label htmlFor="risk-age">나이 (만)</label>
              <input id="risk-age" type="number" value={age} onChange={(e) => setAge(Number(e.target.value))} min={19} max={100} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-sex">성별</label>
              <select id="risk-sex" value={sex} onChange={(e) => setSex(e.target.value as "M" | "F")}>
                <option value="M">남성 (M)</option>
                <option value="F">여성 (F)</option>
              </select>
            </div>
            <div className="param-field">
              <label htmlFor="risk-height">키 (cm)</label>
              <input id="risk-height" type="number" value={heightCm} onChange={(e) => setHeightCm(Number(e.target.value))} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-weight">체중 (kg)</label>
              <input id="risk-weight" type="number" value={weightKg} onChange={(e) => setWeightKg(Number(e.target.value))} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-waist">허리둘레 (cm)</label>
              <input id="risk-waist" type="number" placeholder="예: 82" value={waistCm} onChange={(e) => setWaistCm(e.target.value)} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-srh">주관적 건강상태</label>
              <select id="risk-srh" value={selfRatedHealth} onChange={(e) => setSelfRatedHealth(Number(e.target.value) as 1 | 2 | 3 | 4 | 5)}>
                <option value={1}>1: 매우 좋음</option>
                <option value={2}>2: 좋음</option>
                <option value={3}>3: 보통</option>
                <option value={4}>4: 나쁨</option>
                <option value={5}>5: 매우 나쁨</option>
              </select>
            </div>
            <div className="param-field">
              <label htmlFor="risk-sbp">수축기 혈압 (mmHg)</label>
              <input id="risk-sbp" type="number" placeholder="예: 120" value={sbp} onChange={(e) => setSbp(e.target.value)} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-dbp">이완기 혈압 (mmHg)</label>
              <input id="risk-dbp" type="number" placeholder="예: 80" value={dbp} onChange={(e) => setDbp(e.target.value)} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-fbg">공복혈당 (mg/dL)</label>
              <input id="risk-fbg" type="number" placeholder="예: 100" value={fbg} onChange={(e) => setFbg(e.target.value)} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-hba1c">당화혈색소 (%)</label>
              <input id="risk-hba1c" type="number" step="0.1" placeholder="예: 5.6" value={hba1c} onChange={(e) => setHba1c(e.target.value)} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-tot-chol">총콜레스테롤 (mg/dL)</label>
              <input id="risk-tot-chol" type="number" placeholder="예: 190" value={totChol} onChange={(e) => setTotChol(e.target.value)} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-hdl">HDL 콜레스테롤 (mg/dL)</label>
              <input id="risk-hdl" type="number" placeholder="예: 55" value={hdl} onChange={(e) => setHdl(e.target.value)} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-ldl">LDL 콜레스테롤 (mg/dL)</label>
              <input id="risk-ldl" type="number" placeholder="예: 110" value={ldl} onChange={(e) => setLdl(e.target.value)} />
            </div>
            <div className="param-field">
              <label htmlFor="risk-tg">중성지방 (mg/dL)</label>
              <input id="risk-tg" type="number" placeholder="예: 130" value={tg} onChange={(e) => setTg(e.target.value)} />
            </div>
          </div>
          <div className="param-actions">
            <button className="primary-button" type="button" onClick={() => void runRiskPrediction()}>
              수정된 수치로 다시 계산
            </button>
          </div>
        </div>
      )}

      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

      {/* 질환별 예측 결과 카드 그리드 */}
      {predictionData && (
        <div className="risk-card-grid">
          {predictionData.conditions.map((cond) => {
            const probPercent = Math.round(cond.probability * 1000) / 10;
            const levelClass =
              cond.medical.level === "높음"
                ? "level-high"
                : cond.medical.level === "보통"
                ? "level-medium"
                : "level-low";

            return (
              <div key={cond.target} className={`condition-risk-card ${levelClass}`}>
                <div className="card-top">
                  <span className="condition-name">{cond.name}</span>
                  <span className={`risk-level-badge ${levelClass}`}>
                    {cond.medical.level} 위험 ({probPercent}%)
                  </span>
                </div>

                <div className="probability-bar-track">
                  <div
                    className={`probability-bar-fill ${levelClass}`}
                    style={{ width: `${Math.min(100, Math.max(5, probPercent))}%` }}
                  />
                </div>

                <p className="condition-desc">{cond.description}</p>

                {cond.top_risk_factors && cond.top_risk_factors.length > 0 ? (
                  <div className="risk-factors-block">
                    <span className="factor-title">주요 영향 요인</span>
                    <ul className="factor-list">
                      {cond.top_risk_factors.slice(0, 3).map((f, i) => (
                        <li key={i}>
                          <span className="factor-name">{f.name}</span>
                          <span className={`factor-dir dir-${f.direction}`}>
                            {f.direction === "up" ? "▲ 위험 증가" : "▼ 위험 감소"}
                          </span>
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}

                <div className="card-bottom-criteria">
                  <small className="criteria-label">임상 기준:</small>
                  <small className="criteria-text">{cond.label_definition}</small>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <div className="risk-disclaimer-box">
        <strong>⚠️ 안내 및 주의사항</strong>
        <p>
          본 예측은 미국 공개 의학 데이터셋(NHANES·BRFSS·Framingham)을 바탕으로 학습된 인공지능 통계 모델 분석이며, 
          <strong>의학적 진단이나 처방이 아닙니다.</strong> 수치가 높게 나타나는 경우 가까운 의료기관을 방문하여 전문의 상담을 받으시길 권장합니다.
        </p>
      </div>
    </section>
  );
}
