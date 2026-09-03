import { useEffect, useMemo, useState } from "react";
import { HealthRecordService } from "../local-domain/health-record-service";
import type { HealthRecordView } from "../local-domain/types";

interface Profile { id: string; name: string; relationship: string }
interface Props { profiles: Profile[] }

function points(values: Array<{ value: number }>) {
  if (!values.length) return "";
  const min = Math.min(...values.map((item) => item.value)); const max = Math.max(...values.map((item) => item.value)); const range = max - min || 1;
  return values.map((item, index) => `${values.length === 1 ? 50 : index / (values.length - 1) * 100},${88 - (item.value - min) / range * 70}`).join(" ");
}

function Trend({ title, unit, values, color = "#4679af" }: { title: string; unit: string; values: Array<{ date: string; value: number }>; color?: string }) {
  const latest = values.at(-1);
  return <article className="trend-card"><header><div><p>{title}</p><strong>{latest ? `${latest.value}${unit}` : "기록 없음"}</strong></div><small>{latest ? new Date(latest.date).toLocaleDateString("ko-KR") : ""}</small></header>{values.length > 0 ? <svg viewBox="0 0 100 100" preserveAspectRatio="none" aria-label={`${title} 변화 그래프`}><polyline points={points(values)} fill="none" stroke={color} strokeWidth="3" vectorEffect="non-scaling-stroke" /><circle cx={points(values).split(" ").at(-1)?.split(",")[0]} cy={points(values).split(" ").at(-1)?.split(",")[1]} r="3" fill={color} vectorEffect="non-scaling-stroke" /></svg> : <div className="trend-empty">기록을 추가하면 변화가 표시돼요.</div>}<footer>{values.length}건의 기록</footer></article>;
}

export function HealthChangeDashboard({ profiles }: Props) {
  const service = useMemo(() => new HealthRecordService(), []);
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "");
  const [allRecords, setAllRecords] = useState<Record<string, HealthRecordView[]>>({});
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => { let active = true; void Promise.all(profiles.map(async (profile) => [profile.id, await service.query(profile.id)] as const)).then((results) => { if (!active) return; const next: Record<string, HealthRecordView[]> = {}; for (const [id, result] of results) { if (result.ok) next[id] = result.value; else setError(result.error.message); } setAllRecords(next); setLoading(false); }); return () => { active = false; }; }, [profiles, service]);
  const records = [...(allRecords[selectedId] ?? [])].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
  const bp = records.filter((record) => record.payload.type === "blood_pressure").map((record) => ({ date: record.recordedAt, value: (record.payload as Extract<HealthRecordView["payload"], { type: "blood_pressure" }>).systolicMmHg }));
  const glucose = records.filter((record) => record.payload.type === "blood_glucose").map((record) => ({ date: record.recordedAt, value: (record.payload as Extract<HealthRecordView["payload"], { type: "blood_glucose" }>).valueMgDl }));
  const weight = records.filter((record) => record.payload.type === "body_measurement" && record.payload.weightKg !== undefined).map((record) => ({ date: record.recordedAt, value: (record.payload as Extract<HealthRecordView["payload"], { type: "body_measurement" }>).weightKg! }));
  const latestScreening = [...records].reverse().find((record) => record.payload.type === "health_screening");
  const activePain = [...records].reverse().find((record) => record.payload.type === "pain");
  return <main className="page-shell change-page"><header className="change-header"><div><p className="eyebrow">가족 건강 변화</p><h1>건강 변화</h1><p>직접 입력하고 확인한 기록만 시간순으로 보여드려요. 의료적 판정은 하지 않습니다.</p></div></header><section className="family-health-grid">{profiles.map((profile) => { const profileRecords = allRecords[profile.id] ?? []; const recent = profileRecords[0]; return <button key={profile.id} className={selectedId === profile.id ? "family-health active" : "family-health"} onClick={() => setSelectedId(profile.id)}><span className="avatar">{profile.name.slice(-1)}</span><span><strong>{profile.name}</strong><small>{profile.relationship} · 기록 {profileRecords.length}건</small>{recent && <em>최근 {new Date(recent.recordedAt).toLocaleDateString("ko-KR")}</em>}</span></button>; })}</section>{loading && <section className="history-empty">건강 변화를 불러오는 중…</section>}{error && <div className="form-error">{error}</div>}{!loading && <><section className="change-summary"><article><small>최근 건강검진</small><strong>{latestScreening?.payload.type === "health_screening" ? latestScreening.payload.screeningName : "등록된 검진 없음"}</strong><span>{latestScreening ? new Date(latestScreening.recordedAt).toLocaleDateString("ko-KR") : "원본 서류 분석 결과도 연결할 수 있어요."}</span></article><article><small>최근 통증 기록</small><strong>{activePain?.payload.type === "pain" ? `${activePain.payload.bodyArea} · ${activePain.payload.intensity}/10` : "등록된 통증 없음"}</strong><span>{activePain ? "건강 이력에서 경과를 추가할 수 있어요." : "대화 또는 직접 입력으로 추가해 보세요."}</span></article><article><small>기록 현황</small><strong>{records.length}건</strong><span>선택한 구성원의 암호화된 로컬 기록</span></article></section><section className="trend-grid"><Trend title="수축기 혈압" unit=" mmHg" values={bp} /><Trend title="혈당" unit=" mg/dL" values={glucose} color="#8c6daa" /><Trend title="체중" unit=" kg" values={weight} color="#5d8e80" /></section><section className="change-note"><strong>해석 전 확인</strong><p>그래프는 등록한 수치의 변화만 보여줘요. 정상·위험 여부를 자동으로 판단하지 않으며, 이상 증상이 있거나 수치가 걱정되면 의료기관에 상담해 주세요.</p></section></>}</main>;
}
