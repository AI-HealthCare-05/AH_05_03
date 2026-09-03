import { useEffect, useMemo, useState } from "react";
import { HealthRecordService } from "../local-domain/health-record-service";
import { DocumentService } from "../local-domain/document-service";
import { PainTimeline } from "./PainTimeline";
import type { HealthPayload, HealthRecordView } from "../local-domain/types";

interface ProfileOption { id: string; name: string; relationship: string }
interface Props { profiles: ProfileOption[]; onCreate: () => void }

const labels: Record<string, string> = { blood_pressure: "혈압", blood_glucose: "혈당", body_measurement: "체성분", lab_result: "검사 수치", vaccination: "예방접종", health_screening: "건강검진", pain: "통증", walking: "걷기", exercise: "운동", medication: "복약", note: "기타 기록" };

function summary(payload: HealthPayload): string {
  switch (payload.type) {
    case "blood_pressure": return `${payload.systolicMmHg} / ${payload.diastolicMmHg} mmHg${payload.pulseBpm ? ` · 맥박 ${payload.pulseBpm}` : ""}`;
    case "blood_glucose": return `${payload.valueMgDl} mg/dL`;
    case "body_measurement": return [`키 ${payload.heightCm ?? "-"}cm`, `체중 ${payload.weightKg ?? "-"}kg`, `체지방 ${payload.bodyFatPercent ?? "-"}%`].join(" · ");
    case "lab_result": return `${payload.testName} ${payload.value}${payload.unit ? ` ${payload.unit}` : ""}`;
    case "vaccination": return `${payload.vaccineName}${payload.doseNumber ? ` ${payload.doseNumber}차` : ""}`;
    case "health_screening": return payload.screeningName;
    case "pain": return `${payload.bodyArea} · 강도 ${payload.intensity}/10${payload.sensation ? ` · ${payload.sensation}` : ""}`;
    case "walking": return [`${payload.steps ?? "-"}걸음`, `${payload.distanceKm ?? "-"}km`, `${payload.durationMinutes ?? "-"}분`].join(" · ");
    case "exercise": return `${payload.exerciseName}${payload.distanceKm ? ` · ${payload.distanceKm}km` : ""}${payload.durationMinutes ? ` · ${payload.durationMinutes}분` : ""}${payload.weightKg ? ` · ${payload.weightKg}kg` : ""}${payload.reps ? ` · ${payload.reps}회` : ""}${payload.sets ? ` · ${payload.sets}세트` : ""}`;
    case "medication": return `${payload.medicationName}${payload.dosage ? ` · ${payload.dosage}` : ""}${payload.takenAt ? ` · ${payload.takenAt}` : ""}`;
    case "note": return payload.title || payload.text.slice(0, 60);
  }
}

function PayloadDetail({ record }: { record: HealthRecordView }) {
  const payload = record.payload;
  if (payload.type === "health_screening") return <div className="record-longtext">{payload.summary || "상세 내용이 없습니다."}</div>;
  if (payload.type === "note") return <div className="record-longtext">{payload.text}</div>;
  if (payload.type === "pain") return <PainTimeline record={record} />;
  return <pre>{JSON.stringify(payload, null, 2)}</pre>;
}

export function HealthRecordHistory({ profiles, onCreate }: Props) {
  const service = useMemo(() => new HealthRecordService(), []);
  const documentService = useMemo(() => new DocumentService(), []);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [records, setRecords] = useState<HealthRecordView[]>([]);
  const [selected, setSelected] = useState<HealthRecordView | null>(null);
  const [filter, setFilter] = useState("all");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [sourcePreview, setSourcePreview] = useState<{ url: string; name: string } | null>(null);

  const openSourceDocument = async (documentId: string) => {
    const result = await documentService.open(documentId);
    if (!result.ok) return setError(result.error.message);
    if (sourcePreview) URL.revokeObjectURL(sourcePreview.url);
    setSourcePreview({ url: URL.createObjectURL(result.value), name: result.value.name });
  };

  useEffect(() => {
    let active = true;
    setLoading(true); setSelected(null);
    void service.query(profileId).then((result) => {
      if (!active) return;
      if (result.ok) { setRecords(result.value); setError(""); } else setError(result.error.message);
      setLoading(false);
    });
    return () => { active = false; };
  }, [profileId, service]);

  useEffect(() => () => { if (sourcePreview) URL.revokeObjectURL(sourcePreview.url); }, [sourcePreview]);

  const visible = filter === "all" ? records : records.filter((record) => record.recordType === filter);
  return <main className="page-shell history-page">
    <header className="history-header"><div><p className="eyebrow">로컬 건강 기록</p><h1>건강 이력</h1><p>가족별로 저장한 기록을 시간순으로 확인하세요.</p></div><button className="primary" onClick={onCreate}>+ 건강기록 작성</button></header>
    <section className="history-toolbar"><div className="profile-list">{profiles.map((profile) => <button key={profile.id} className={profileId === profile.id ? "profile active" : "profile"} onClick={() => setProfileId(profile.id)}><span className="avatar">{profile.name.slice(-1)}</span><span><strong>{profile.name}</strong><small>{profile.relationship}</small></span></button>)}</div><select aria-label="기록 유형 필터" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">전체 기록</option><option value="blood_pressure">혈압</option><option value="blood_glucose">혈당</option><option value="body_measurement">체성분</option><option value="lab_result">검사 수치</option><option value="vaccination">예방접종</option><option value="health_screening">건강검진</option><option value="pain">통증</option><option value="walking">걷기</option><option value="note">기타</option></select></section>
    {loading && <section className="history-empty">기록을 불러오는 중…</section>}
    {error && <div className="form-error">{error}</div>}
    {!loading && !error && visible.length === 0 && <section className="history-empty"><strong>아직 저장된 기록이 없어요.</strong><p>첫 건강기록을 직접 등록해 보세요.</p><button className="primary" onClick={onCreate}>기록 작성하기</button></section>}
    {!loading && visible.length > 0 && <div className="history-layout"><section className="history-list">{visible.map((record) => <button key={record.id} className={selected?.id === record.id ? "history-item active" : "history-item"} onClick={() => setSelected(record)}><span className={`record-icon ${record.recordType}`}>●</span><span><strong>{labels[record.recordType]}</strong><small>{summary(record.payload)}</small></span><time>{new Date(record.recordedAt).toLocaleString("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time></button>)}</section><section className="record-detail">{selected ? <><p className="eyebrow">기록 상세</p><h2>{labels[selected.recordType]}</h2><dl><div><dt>기록일</dt><dd>{new Date(selected.recordedAt).toLocaleString("ko-KR")}</dd></div><div><dt>기록 내용</dt><dd>{summary(selected.payload)}</dd></div><div><dt>입력 방식</dt><dd>{selected.source === "ocr" ? "서류 확인 후 등록" : "직접 입력"}</dd></div><div><dt>저장 위치</dt><dd>이 브라우저의 암호화 저장소</dd></div></dl>{selected.sourceDocumentId && <button className="source-document-button" onClick={() => void openSourceDocument(selected.sourceDocumentId!)}>연결된 원본 서류 열기</button>}<PayloadDetail record={selected} /></> : <div className="detail-placeholder">기록을 선택하면 상세 내용을 확인할 수 있어요.</div>}</section></div>}
    {sourcePreview && <div className="modal-backdrop source-preview-backdrop"><section className="source-preview-modal" role="dialog" aria-modal="true" aria-label="연결된 원본 서류"><header><strong>{sourcePreview.name}</strong><button aria-label="닫기" onClick={() => setSourcePreview(null)}>×</button></header><img src={sourcePreview.url} alt="건강기록에 연결된 원본 서류" /></section></div>}
  </main>;
}
