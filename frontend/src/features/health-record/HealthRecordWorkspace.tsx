import { type FormEvent, useState } from "react";
import { useNavigate } from "react-router-dom";

import { PRIMARY_HOUSEHOLD_ID } from "../../app/localDomainContext";
import type { FamilyProfile, HealthRecord, HealthRecordType } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { DevServerOcrAdapter } from "../../ocr/ocr-adapter";
import { normalizeOcrResult } from "../../ocr/ocr-normalizer";
import "./healthRecordWorkspace.css";

const LABELS: Record<HealthRecordType, string> = {
  blood_pressure: "혈압",
  blood_glucose: "혈당",
  body_measurement: "신체 측정",
  lab_result: "검사 결과",
  vaccination: "예방접종",
  health_screening: "건강검진",
  pain: "통증 기록",
  walking: "걷기",
  exercise: "운동",
  medication: "복약",
  sleep: "수면",
  daily_condition: "컨디션",
  note: "건강 메모",
};

type RecordKind = "pain" | "measurement" | "screening" | "note";

export function HealthRecordComposer({
  profile,
  runtime,
  onClose,
  onSaved,
  onOpenPainChat,
}: {
  profile: FamilyProfile;
  runtime?: LocalDomainRuntime;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onOpenPainChat: () => void;
}) {
  const [kind, setKind] = useState<RecordKind>("pain");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtime) return setError("로컬 저장소를 준비하는 중입니다.");
    const form = new FormData(event.currentTarget);
    const at = String(form.get("recordedAt") ?? "");
    const note = text(form, "note");
    const base = { householdId: PRIMARY_HOUSEHOLD_ID, profileId: profile.id, recordedAt: new Date(at).toISOString(), source: "manual" as const };
    const input: {
      householdId: string;
      profileId: string;
      recordedAt: string;
      source: "manual";
      recordType: HealthRecordType;
      payload: Record<string, unknown>;
    } = kind === "pain"
      ? { ...base, recordType: "pain" as const, payload: { bodyArea: text(form, "bodyArea"), intensity: Number(form.get("intensity")), sensation: optional(form, "sensation"), onsetAt: optional(form, "onsetAt"), note } }
      : kind === "measurement"
        ? measurementInput(base, form, note)
        : kind === "screening"
          ? { ...base, recordType: "health_screening" as const, payload: { screeningName: text(form, "screeningName"), institution: optional(form, "institution"), note } }
          : { ...base, recordType: "note" as const, payload: { title: optional(form, "title"), note } };
    setSaving(true);
    setError(undefined);
    try {
      const result = await runtime.healthRecords.create(input);
      if (!result.ok) throw new Error(result.error.message);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "건강기록을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <form className="health-record-composer" onSubmit={(event) => void submit(event)}>
      <p className="form-notice">입력한 내용은 현재 브라우저에 암호화해 저장합니다. 자동 진단은 하지 않습니다.</p>
      <div className="record-kind-tabs" role="tablist" aria-label="기록 종류">
        {([["pain", "통증"], ["measurement", "수치"], ["screening", "검진"], ["note", "메모"]] as const).map(([value, label]) => (
          <button type="button" key={value} className={kind === value ? "is-selected" : ""} onClick={() => setKind(value)}>{label}</button>
        ))}
      </div>
      <label>기록 일시<input name="recordedAt" type="datetime-local" required defaultValue={localDateTimeNow()} /></label>
      {kind === "pain" ? <PainFields /> : null}
      {kind === "measurement" ? <MeasurementFields /> : null}
      {kind === "screening" ? <><label>검진명<input name="screeningName" required placeholder="예: 국가건강검진" /></label><label>검사기관 <span className="optional-label">선택</span><input name="institution" placeholder="예: 이어봄의원" /></label></> : null}
      {kind === "note" ? <label>제목 <span className="optional-label">선택</span><input name="title" placeholder="예: 감기 증상 관찰" /></label> : null}
      <label>{kind === "pain" ? "추가 메모" : "기록 내용"}<textarea name="note" rows={4} required placeholder="사용자가 직접 확인한 사실만 적어주세요." /></label>
      {kind === "pain" ? <button className="text-button pain-chat-inline" type="button" onClick={onOpenPainChat}>대화로 통증 기록하기</button> : null}
      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}
      <div className="form-actions"><button className="secondary-button" type="button" onClick={onClose}>취소</button><button className="primary-button" type="submit" disabled={saving}>{saving ? "암호화 저장 중…" : "기록 저장"}</button></div>
    </form>
  );
}

function PainFields() {
  return <div className="record-field-grid"><label>통증 부위<input name="bodyArea" required placeholder="예: 오른쪽 무릎" /></label><label>통증 정도 (0~10)<input name="intensity" type="number" min="0" max="10" required defaultValue="5" /></label><label>통증 양상 <span className="optional-label">선택</span><input name="sensation" placeholder="예: 욱신거림" /></label><label>시작 시점 <span className="optional-label">선택</span><input name="onsetAt" type="date" /></label></div>;
}

function MeasurementFields() {
  const [type, setType] = useState<"blood_pressure" | "blood_glucose" | "body_measurement" | "lab_result">("blood_pressure");
  return <><label>수치 종류<select value={type} onChange={(event) => setType(event.target.value as typeof type)}><option value="blood_pressure">혈압</option><option value="blood_glucose">혈당</option><option value="body_measurement">체중·신체 측정</option><option value="lab_result">검사 수치</option></select></label><input name="measurementType" type="hidden" value={type} />{type === "blood_pressure" ? <div className="record-field-grid"><label>수축기<input name="systolic" type="number" required placeholder="120" /></label><label>이완기<input name="diastolic" type="number" required placeholder="80" /></label></div> : null}{type === "blood_glucose" ? <div className="record-field-grid"><label>혈당<input name="glucose" type="number" required placeholder="100" /></label><label>측정 시점<select name="timing"><option value="fasting">공복</option><option value="before_meal">식전</option><option value="after_meal">식후</option><option value="random">무작위</option></select></label></div> : null}{type === "body_measurement" ? <div className="record-field-grid"><label>체중(kg)<input name="weight" type="number" step="0.1" required /></label><label>키(cm) <span className="optional-label">선택</span><input name="height" type="number" step="0.1" /></label></div> : null}{type === "lab_result" ? <div className="record-field-grid"><label>검사항목<input name="testName" required placeholder="예: AST(GOT)" /></label><label>결과값<input name="value" required /></label><label>단위 <span className="optional-label">선택</span><input name="unit" placeholder="U/L" /></label></div> : null}</>;
}

function measurementInput(base: { householdId: string; profileId: string; recordedAt: string; source: "manual" }, form: FormData, note: string): {
  householdId: string;
  profileId: string;
  recordedAt: string;
  source: "manual";
  recordType: HealthRecordType;
  payload: Record<string, unknown>;
} {
  const type = text(form, "measurementType");
  if (type === "blood_glucose") return { ...base, recordType: "blood_glucose" as const, payload: { value: Number(form.get("glucose")), timing: text(form, "timing"), note } };
  if (type === "body_measurement") return { ...base, recordType: "body_measurement" as const, payload: { weightKg: Number(form.get("weight")), heightCm: optionalNumber(form, "height"), note } };
  if (type === "lab_result") return { ...base, recordType: "lab_result" as const, payload: { testName: text(form, "testName"), value: text(form, "value"), unit: optional(form, "unit"), note } };
  return { ...base, recordType: "blood_pressure" as const, payload: { systolic: Number(form.get("systolic")), diastolic: Number(form.get("diastolic")), note } };
}

export function HealthRecordHistoryDialog({
  records,
  onEdit,
  onDelete,
}: {
  records: HealthRecord[];
  onEdit: (record: HealthRecord) => void;
  onDelete: (record: HealthRecord) => void;
}) {
  return <div className="health-record-history-dialog">{records.length === 0 ? <p className="compact-empty">저장된 건강기록이 없습니다.</p> : <ul>{records.map((record) => <li key={record.id}><div><strong>{LABELS[record.recordType]}</strong><small>{new Date(record.recordedAt).toLocaleString("ko-KR")} · {recordSummary(record)}</small></div><div className="record-row-actions"><button type="button" onClick={() => onEdit(record)}>수정</button><button type="button" onClick={() => onDelete(record)}>삭제</button></div></li>)}</ul>}</div>;
}

export function FloatingHealthTools({
  profile,
  runtime,
  onSaved,
}: {
  profile?: FamilyProfile;
  runtime?: LocalDomainRuntime;
  onSaved: () => Promise<void>;
  onOpenAssistant?: () => void;
}) {
  const [ocrOpen, setOcrOpen] = useState(false);
  const navigate = useNavigate();
  if (!profile) return null;
  return (
    <>
      <div className="floating-health-tools">
        <button type="button" onClick={() => setOcrOpen(true)}>서류 관리 · OCR</button>
      </div>
      {ocrOpen ? (
        <DocumentOcrDialog
          profile={profile}
          runtime={runtime}
          onClose={() => setOcrOpen(false)}
          onSaved={onSaved}
          onManage={() => {
            setOcrOpen(false);
            void navigate("/data");
          }}
        />
      ) : null}
    </>
  );
}

function DocumentOcrDialog({ profile, runtime, onClose, onSaved, onManage }: { profile: FamilyProfile; runtime?: LocalDomainRuntime; onClose: () => void; onSaved: () => Promise<void>; onManage: () => void }) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [examDate, setExamDate] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const [rows, setRows] = useState<Array<{ testName: string; value: string; unit: string; judgment: string }>>([]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  async function recognize() {
    if (files.length === 0) return setError("JPEG, PNG, WEBP 이미지 또는 PDF 문서를 하나 이상 선택해 주세요.");
    setWorking(true); setError(undefined);
    try {
      const result = normalizeOcrResult(await new DevServerOcrAdapter().recognize(files));
      setText(result.text);
      setRows(result.examItems?.map((item) => ({ ...item })) ?? []);
      // 텍스트 내 검사일자 자동 파싱 (예: 2025-08-28)
      const dateMatch = result.text.match(/\b(20\d{2})[-.년/\s]+(0?[1-9]|1[0-2])[-.월/\s]+(0?[1-9]|[12]\d|3[01])/);
      if (dateMatch) {
        setExamDate(`${dateMatch[1]}-${dateMatch[2].padStart(2, "0")}-${dateMatch[3].padStart(2, "0")}`);
      }
    } catch (caught) { setError(caught instanceof Error ? caught.message : "OCR을 실행하지 못했습니다."); } finally { setWorking(false); }
  }

  async function confirm() {
    if (!runtime || files.length === 0 || !text.trim()) return;
    setWorking(true);
    try {
      let primaryDocumentId: string | undefined;
      if (runtime.documents) {
        for (const file of files) {
          const saved = await runtime.documents.save({ householdId: PRIMARY_HOUSEHOLD_ID, profileId: profile.id, file, fileName: file.name });
          if (!saved.ok) throw new Error(saved.error.message);
          if (!primaryDocumentId) primaryDocumentId = saved.value.id;
        }
      }
      const tableText = rows
        .map((item) => [item.testName, item.value, item.unit, item.judgment].filter(Boolean).join(" | "))
        .join("\n");
      const finalNote = tableText.trim() ? `[검사 결과 요약]\n${tableText}` : text.trim();
      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "lab_result",
        recordedAt: examDate ? new Date(examDate).toISOString() : new Date().toISOString(),
        source: "ocr",
        sourceDocumentId: primaryDocumentId,
        payload: { note: finalNote },
      });
      if (!result.ok) throw new Error(result.error.message);
      await onSaved();
      onClose();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "건강기록 저장에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  }

  return <div className="modal-backdrop" role="presentation"><section className="modal-panel ocr-quick-dialog" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="section-kicker">사용자 확인 단계</p><h2>{profile.displayName}님의 서류 OCR</h2></div><button className="modal-close" type="button" onClick={onClose}>×</button></div><p className="form-notice">※ 개발·검증용 외부 AI(Google Gemini)로 전송됩니다. 실제 개인정보가 없는 <strong>합성·비식별 문서</strong>로만 테스트해 주세요. 의료 판단을 하지 않으며, 직접 수정·확정해야만 브라우저 로컬에 저장됩니다.</p>{!text ? <><label>건강서류 (PDF 또는 이미지 복수 선택 가능)<input type="file" accept="image/jpeg,image/png,image/webp,application/pdf" multiple onChange={(event) => { const chosen = event.currentTarget.files; setFiles(chosen ? Array.from(chosen) : []); }} /></label>{files.length > 0 ? <div className="ocr-file-badge-list">{files.map((f, i) => <span key={i} className="ocr-file-badge">{f.name} ({(f.size / 1024 / 1024).toFixed(1)}MB)</span>)}</div> : null}<div className="form-actions"><button className="secondary-button" type="button" onClick={onManage}>전체 서류 관리</button><button className="primary-button" type="button" disabled={files.length === 0 || working} onClick={() => void recognize()}>{working ? "글자를 읽는 중…" : files.length > 1 ? `동의하고 ${files.length}장 일괄 OCR 읽기` : "동의하고 OCR 읽기"}</button></div></> : <><div className="input-row"><label>실제 검사 일자<input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} /></label></div><label>추출 텍스트<textarea rows={8} value={text} onChange={(event) => setText(event.target.value)} /></label>{rows.length > 0 ? <div className="ocr-review-table"><strong>검사 항목 확인</strong>{rows.map((row, index) => <div key={index}><input value={row.testName} aria-label="검사항목" onChange={(event) => setRows(rows.map((value, current) => current === index ? { ...value, testName: event.target.value } : value))} /><input value={row.value} aria-label="결과값" onChange={(event) => setRows(rows.map((value, current) => current === index ? { ...value, value: event.target.value } : value))} /><input value={row.unit} aria-label="단위" onChange={(event) => setRows(rows.map((value, current) => current === index ? { ...value, unit: event.target.value } : value))} /><input value={row.judgment} aria-label="판정" onChange={(event) => setRows(rows.map((value, current) => current === index ? { ...value, judgment: event.target.value } : value))} /></div>)}</div> : null}<div className="form-actions"><button className="secondary-button" type="button" onClick={onClose}>취소</button><button className="primary-button" type="button" disabled={working} onClick={() => void confirm()}>{working ? "저장 중…" : "수정 내용 확정 · 건강기록 저장"}</button></div></>}{error ? <div className="alert error-alert">{error}</div> : null}</section></div>;
}

export function PainChatDialog({ profile, runtime, onClose, onSaved }: { profile: FamilyProfile; runtime?: LocalDomainRuntime; onClose: () => void; onSaved: () => Promise<void> }) {
  const [messages, setMessages] = useState([{ role: "assistant", content: "어디가 어떻게 아픈지 편하게 말씀해 주세요. 진단이 아니라 기록 작성을 도와드려요." }]);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [missing, setMissing] = useState<string[]>(["body_area", "intensity"]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const content = input.trim();
    if (!content || working) return;
    const next = [...messages, { role: "user", content }];
    setMessages(next);
    setInput("");
    setWorking(true);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30000);
      const response = await fetch("http://127.0.0.1:8000/api/v1/pain-chat/messages", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ messages: next }), signal: controller.signal });
      window.clearTimeout(timeout);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "대화에 실패했습니다.");
      setMessages((current) => [...current, { role: "assistant", content: body.data.assistant_message }]);
      setDraft(body.data.draft ?? {});
      setMissing(body.data.missing_fields ?? []);
      setError(undefined);
    } catch (caught) { setError(caught instanceof DOMException && caught.name === "AbortError" ? "응답 시간이 초과되었습니다. 통증 부위와 정도를 직접 입력해 주세요." : caught instanceof Error ? caught.message : "대화에 실패했습니다."); } finally { setWorking(false); }
  }

  async function save() {
    if (!runtime || !draft.body_area || typeof draft.intensity !== "number") return;
    setWorking(true);
    const result = await runtime.healthRecords.create({ householdId: PRIMARY_HOUSEHOLD_ID, profileId: profile.id, recordType: "pain", recordedAt: new Date().toISOString(), source: "local_ai", payload: { bodyArea: draft.body_area, intensity: draft.intensity, sensation: draft.sensation, note: draft.note } });
    setWorking(false);
    if (!result.ok) return setError(result.error.message);
    await onSaved();
    onClose();
  }

  return <div className="modal-backdrop" role="presentation"><section className="modal-panel health-pain-chat" role="dialog" aria-modal="true"><div className="modal-heading"><div><p className="section-kicker">대화형 입력</p><h2>{profile.displayName}님의 통증 기록</h2></div><button className="modal-close" type="button" onClick={onClose}>×</button></div><p className="form-notice">입력 내용은 기록 초안 생성을 위해 AI로 전송됩니다. 저장 전 직접 확인하세요.</p><div className="health-chat-messages">{messages.map((message, index) => <p key={index} className={message.role}>{message.content}</p>)}</div><form className="health-chat-form" onSubmit={(event) => void send(event)}><input value={input} onChange={(event) => setInput(event.target.value)} placeholder="예: 어제부터 오른쪽 무릎이 욱신거려요" /><button className="primary-button" disabled={working}>{working ? "정리 중…" : "보내기"}</button></form>{Object.keys(draft).length > 0 ? <div className="chat-draft"><h3>저장 전 확인</h3><label>통증 부위<input value={String(draft.body_area ?? "")} onChange={(event) => setDraft({ ...draft, body_area: event.target.value })} /></label><label>통증 정도<input type="number" min="0" max="10" value={typeof draft.intensity === "number" ? draft.intensity : ""} onChange={(event) => setDraft({ ...draft, intensity: Number(event.target.value) })} /></label>{missing.length > 0 ? <p>추가 확인: {missing.join(", ")}</p> : <button className="primary-button" type="button" disabled={working} onClick={() => void save()}>통증 기록으로 저장</button>}</div> : null}{error ? <div className="alert error-alert">{error}</div> : null}</section></div>;
}

function recordSummary(record: HealthRecord): string {
  const p = record.payload as Record<string, unknown>;
  if (typeof p.note === "string" && p.note.trim()) {
    return p.note.trim();
  }
  if (record.recordType === "exercise" || p.exerciseName) {
    const parts = [
      p.exerciseName,
      p.weightKg ? `${p.weightKg}kg` : "",
      p.reps ? `${p.reps}회` : "",
      p.sets ? `${p.sets}세트` : "",
    ].filter(Boolean);
    return parts.join(" ") || "운동 기록";
  }
  if (record.recordType === "blood_pressure" || p.systolic || p.systolicMmHg) {
    const sys = p.systolic ?? p.systolicMmHg;
    const dia = p.diastolic ?? p.diastolicMmHg;
    const pulse = p.pulse ?? p.pulseBpm;
    return `혈압 ${sys}/${dia} mmHg${pulse ? ` (맥박 ${pulse})` : ""}`;
  }
  if (record.recordType === "blood_glucose" || p.glucose || p.valueMgDl || p.value) {
    const val = p.glucose ?? p.valueMgDl ?? p.value;
    const timing = p.timing ? ` (${p.timing})` : "";
    return `혈당 ${val} mg/dL${timing}`;
  }
  if (record.recordType === "medication" || p.medicationName) {
    const name = p.medicationName;
    const dosage = p.dosage ? ` ${p.dosage}` : "";
    const taken = p.takenAt ? ` (${p.takenAt})` : "";
    return `복약: ${name}${dosage}${taken}`;
  }
  if (record.recordType === "pain" || p.bodyArea) {
    const area = p.bodyArea || "통증";
    const intensity = p.intensity !== undefined ? ` (강도 ${p.intensity})` : "";
    const sensation = p.sensation ? ` - ${p.sensation}` : "";
    return `${area}${intensity}${sensation}`;
  }
  if (record.recordType === "health_screening" || record.recordType === "lab_result") {
    const name = p.screeningName || p.testName || "건강검진";
    const summary = p.summary || p.itemsSummary || "";
    return `${name}${summary ? `: ${summary}` : ""}`.slice(0, 120);
  }
  return "세부 내용 없음";
}
function text(form: FormData, key: string) { return String(form.get(key) ?? "").trim(); }
function optional(form: FormData, key: string) { const value = text(form, key); return value || undefined; }
function optionalNumber(form: FormData, key: string) { const value = text(form, key); return value ? Number(value) : undefined; }
function localDateTimeNow() { const date = new Date(); date.setMinutes(date.getMinutes() - date.getTimezoneOffset()); return date.toISOString().slice(0, 16); }
