import { useEffect, useMemo, useState, type FormEvent } from "react";
import { PainProgressService } from "../local-domain/pain-progress-service";
import type { HealthRecordView, PainProgressStatus, PainProgressView } from "../local-domain/types";

const statusLabel: Record<PainProgressStatus, string> = { improved: "호전", same: "동일", worse: "악화", resolved: "종료" };
const today = new Date().toISOString().slice(0, 10);

export function PainTimeline({ record }: { record: HealthRecordView }) {
  const service = useMemo(() => new PainProgressService(), []);
  const [items, setItems] = useState<PainProgressView[]>([]);
  const [error, setError] = useState(""); const [saving, setSaving] = useState(false);
  const pain = record.payload.type === "pain" ? record.payload : null;
  const load = async () => { const result = await service.list(record.id); if (result.ok) { setItems(result.value); setError(""); } else setError(result.error.message); };
  useEffect(() => { void load(); }, [record.id]);
  if (!pain) return null;
  const resolved = items.at(-1)?.payload.status === "resolved";
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSaving(true); setError(""); const form = event.currentTarget; const data = new FormData(form); const close = data.get("resolved") === "on";
    const result = await service.create({ painRecordId: record.id, profileId: record.profileId, recordedAt: new Date(`${data.get("date")}T12:00:00`).toISOString(), payload: { intensity: Number(data.get("intensity")), status: close ? "resolved" : data.get("status") as PainProgressStatus, medication: String(data.get("medication") ?? "").trim() || undefined, medicalVisit: data.get("medicalVisit") === "on", note: String(data.get("note") ?? "").trim() || undefined } });
    setSaving(false); if (!result.ok) return setError(result.error.message); form.reset(); await load();
  };
  return <div className="pain-timeline-block"><div className="pain-episode-status"><strong>{resolved ? "종료된 통증" : "관찰 중인 통증"}</strong><span>최초 강도 {pain.intensity}/10</span></div><ol className="pain-timeline"><li><i /><div><time>{new Date(record.recordedAt).toLocaleDateString("ko-KR")}</time><strong>최초 기록 · 강도 {pain.intensity}/10</strong><p>{[pain.bodyArea, pain.sensation, pain.note].filter(Boolean).join(" · ")}</p></div></li>{items.map((item) => <li key={item.id}><i /><div><time>{new Date(item.recordedAt).toLocaleDateString("ko-KR")}</time><strong>{statusLabel[item.payload.status]} · 강도 {item.payload.intensity}/10</strong><p>{[item.payload.medication && `복용약: ${item.payload.medication}`, item.payload.medicalVisit && "병원 방문", item.payload.note].filter(Boolean).join(" · ") || "추가 메모 없음"}</p></div></li>)}</ol>{!resolved && <form className="pain-progress-form" onSubmit={(event) => void submit(event)}><h3>경과 추가</h3><div><label>날짜<input name="date" type="date" defaultValue={today} required /></label><label>현재 강도<input name="intensity" type="number" min="0" max="10" defaultValue={pain.intensity} required /></label><label>변화<select name="status" defaultValue="same"><option value="improved">호전</option><option value="same">동일</option><option value="worse">악화</option></select></label><label>복용약<input name="medication" placeholder="선택 입력" /></label></div><label className="check"><input name="medicalVisit" type="checkbox" /> 병원에 방문했어요</label><label>경과 메모<textarea name="note" rows={3} /></label><label className="check resolved-check"><input name="resolved" type="checkbox" /> 이 기록으로 통증을 종료할게요</label>{error && <p className="form-error">{error}</p>}<button className="primary" disabled={saving}>{saving ? "저장 중…" : "경과 저장"}</button></form>}{resolved && <p className="pain-resolved-note">종료된 통증입니다. 새로운 증상은 새 통증 기록으로 등록해 주세요.</p>}</div>;
}
