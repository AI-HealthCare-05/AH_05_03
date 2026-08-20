import { useEffect, useMemo, useState } from "react";
import { HealthRecordService } from "../local-domain/health-record-service";
import { OcrResultService } from "../local-domain/ocr-result-service";
import type { OcrContent, OcrExamItem } from "../local-domain/types";
import { DevServerOcrAdapter } from "../ocr/ocr-adapter";
import { normalizeOcrResult } from "../ocr/ocr-normalizer";

interface OcrSource { file: File; documentId?: string; profileId?: string; householdId?: string }
const today = () => new Date().toISOString().slice(0, 10);

export function OcrImportPanel() {
  const adapter = useMemo(() => new DevServerOcrAdapter(), []);
  const ocrService = useMemo(() => new OcrResultService(), []);
  const recordService = useMemo(() => new HealthRecordService(), []);
  const [open, setOpen] = useState(false);
  const [source, setSource] = useState<OcrSource | null>(null);
  const [draft, setDraft] = useState<OcrContent | null>(null);
  const [ocrResultId, setOcrResultId] = useState<string | null>(null);
  const [status, setStatus] = useState<"draft" | "confirmed" | null>(null);
  const [recordedDate, setRecordedDate] = useState(today());
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const receive = (event: Event) => {
      const detail = (event as CustomEvent<File | OcrSource>).detail;
      setSource(detail instanceof File ? { file: detail } : detail);
      setDraft(null); setOcrResultId(null); setStatus(null); setMessage(""); setError(""); setOpen(true);
    };
    window.addEventListener("ieobom:ocr-file", receive);
    return () => window.removeEventListener("ieobom:ocr-file", receive);
  }, []);

  const recognize = async () => {
    if (!source) return;
    setLoading(true); setError(""); setMessage(""); setDraft(null);
    try {
      const raw = await adapter.recognize(source.file);
      const content = normalizeOcrResult(raw);
      setDraft(content); setStatus("draft");
      if (source.documentId) {
        const saved = await ocrService.saveDraft(source.documentId, content);
        if (!saved.ok) throw new Error(saved.error.message);
        setOcrResultId(saved.value.id);
        setMessage("OCR 원본과 수정 초안을 암호화해 저장했습니다.");
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : "OCR 실행에 실패했습니다."); }
    finally { setLoading(false); }
  };

  const updateCell = (tableIndex: number, rowIndex: number, cellIndex: number, value: string) => {
    setDraft((current) => {
      if (!current) return current;
      const tables = current.tables.map((table, ti) => {
        if (ti !== tableIndex) return table;
        const rows = table.rows.map((row, ri) => ri !== rowIndex ? row : row.map((cell, ci) => ci === cellIndex ? value : cell));
        return { ...table, rows };
      });
      return { ...current, tables };
    });
    setStatus("draft"); setMessage("");
  };

  const updateExamItem = (index: number, field: keyof OcrExamItem, value: string) => {
    setDraft((current) => current ? { ...current, examItems: (current.examItems ?? []).map((item, itemIndex) => itemIndex === index ? { ...item, [field]: value } : item) } : current);
    setStatus("draft"); setMessage("");
  };

  const confirm = async () => {
    if (!draft || !ocrResultId) return;
    const result = await ocrService.confirm(ocrResultId, draft);
    if (!result.ok) return setError(result.error.message);
    setStatus("confirmed"); setError(""); setMessage("수정한 OCR 결과를 확정했습니다.");
  };

  const connectRecord = async () => {
    if (!draft || status !== "confirmed" || !source?.documentId || !source.profileId || !source.householdId) return;
    const examText = (draft.examItems ?? []).map((item) => [item.testName, item.value, item.unit, item.judgment].filter(Boolean).join(" | ")).join("\n");
    const summary = [draft.text.trim(), examText].filter(Boolean).join("\n\n");
    const result = await recordService.create({
      householdId: source.householdId, profileId: source.profileId,
      recordedAt: new Date(`${recordedDate}T12:00:00`).toISOString(), source: "ocr", sourceDocumentId: source.documentId,
      payload: { type: "health_screening", screeningName: source.file.name, summary: summary || "확정된 OCR 내용 없음" }, duplicatePolicy: "reject",
    });
    if (!result.ok) return setError(result.error.message);
    setError(""); setMessage("확정 결과를 건강 이력에 연결했습니다. 건강 이력에서 확인할 수 있어요.");
  };

  return <>
    <button className="ocr-launcher" onClick={() => setOpen(true)}>문서 OCR 테스트</button>
    {open && <div className="modal-backdrop ocr-backdrop"><section className="ocr-panel" role="dialog" aria-modal="true" aria-labelledby="ocr-title">
      <header><div><p className="eyebrow">사용자 확인 단계</p><h2 id="ocr-title">건강서류 OCR 확인</h2></div><button onClick={() => setOpen(false)} aria-label="닫기">×</button></header>
      <div className="ocr-warning"><strong>OCR은 의료 판단을 하지 않아요.</strong><span>인식된 글자와 표를 직접 고친 뒤 확정해야 건강기록으로 연결됩니다.</span></div>
      <label className="file-drop">JPEG 또는 PNG 선택<input type="file" accept="image/jpeg,image/png" onChange={(event) => { const file = event.target.files?.[0]; setSource(file ? { file } : null); setDraft(null); setStatus(null); setMessage(""); }} /><small>{source ? `${source.file.name} · ${(source.file.size / 1024 / 1024).toFixed(1)}MB` : "원본 서류 화면에서 OCR을 누르면 저장·연결까지 가능합니다."}</small></label>
      <button className="primary ocr-run" disabled={!source || loading} onClick={() => void recognize()}>{loading ? "글자를 읽는 중…" : "OCR 실행"}</button>
      {error && <div className="form-error" role="alert">{error}</div>}{message && <div className="form-success">{message}</div>}
      {draft && <div className="ocr-result"><div className="raw-badge">{status === "confirmed" ? "CONFIRMED · 사용자 확정" : "DRAFT · 수정 필요"}</div><h3>일반 텍스트</h3><textarea className="ocr-text-editor" value={draft.text} onChange={(event) => { setDraft({ ...draft, text: event.target.value }); setStatus("draft"); setMessage(""); }} /><h3>검사 항목 확인</h3>{(draft.examItems ?? []).length === 0 && <p className="ocr-inline-note">자동으로 나눌 수 있는 검사 항목이 없습니다. 아래 원본 표를 확인해 주세요.</p>}{(draft.examItems ?? []).length > 0 && <div className="ocr-table-wrap"><table><thead><tr><th>검사항목</th><th>결과값</th><th>단위</th><th>판정</th></tr></thead><tbody>{draft.examItems!.map((item, index) => <tr key={index}>{(["testName", "value", "unit", "judgment"] as Array<keyof OcrExamItem>).map((field) => <td key={field}><input value={item[field]} aria-label={`${index + 1}번째 ${field}`} onChange={(event) => updateExamItem(index, field, event.target.value)} /></td>)}</tr>)}</tbody></table></div>}<details><summary>OCR 원본 표 확인</summary>{draft.tables.length === 0 && <p>인식된 원본 표가 없습니다.</p>}{draft.tables.map((table, tableIndex) => <div className="ocr-table-wrap" key={table.table_index}><table><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex}><input value={cell} aria-label={`표 ${tableIndex + 1} 행 ${rowIndex + 1} 열 ${cellIndex + 1}`} onChange={(event) => updateCell(tableIndex, rowIndex, cellIndex, event.target.value)} /></td>)}</tr>)}</tbody></table></div>)}</details>
        {!source?.documentId && <p className="ocr-inline-note">직접 고른 파일은 테스트만 가능합니다. 원본 서류에 먼저 등록하면 확정본 저장과 건강기록 연결을 사용할 수 있어요.</p>}
        {source?.documentId && <div className="ocr-actions"><button className="secondary" disabled={!ocrResultId || status === "confirmed"} onClick={() => void confirm()}>수정 내용 확정</button><label>검사일<input type="date" value={recordedDate} onChange={(event) => setRecordedDate(event.target.value)} /></label><button className="primary" disabled={status !== "confirmed"} onClick={() => void connectRecord()}>건강기록으로 연결</button></div>}
      </div>}
    </section></div>}
  </>;
}
