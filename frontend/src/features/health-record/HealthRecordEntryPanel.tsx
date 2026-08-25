import { type FormEvent, useEffect, useState } from "react";
import { PRIMARY_HOUSEHOLD_ID } from "../../app/localDomainContext";
import type { FamilyProfile, HealthRecordType } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { DevServerOcrAdapter } from "../../ocr/ocr-adapter";
import { normalizeOcrResult } from "../../ocr/ocr-normalizer";
import { HEALTH_ASSISTANT_CONFIG } from "./healthRecordEntryConfig";
import "./healthRecordEntryPanel.css";

export type EntryPanelMode = "menu" | "ocr" | "manual" | "pain";

interface Props {
  profile: FamilyProfile;
  runtime?: LocalDomainRuntime;
  initialMode?: EntryPanelMode;
  onClose: () => void;
  onSaved: () => Promise<void>;
  onNavigateToDataManagement?: () => void;
}

export function HealthRecordEntryPanel({
  profile,
  runtime,
  initialMode = "menu",
  onClose,
  onSaved,
  onNavigateToDataManagement,
}: Props) {
  const [mode, setMode] = useState<EntryPanelMode>(initialMode);
  const [initialPainText, setInitialPainText] = useState<string>("");
  const [menuInput, setMenuInput] = useState<string>("");
  const [saveSuccessMessage, setSaveSuccessMessage] = useState<string | null>(null);

  // Escape 키로 패널 닫기 지원
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  function handleMenuSubmit(e: FormEvent) {
    e.preventDefault();
    const text = menuInput.trim();
    if (!text) return;
    setInitialPainText(text);
    setMenuInput("");
    setMode("pain");
  }

  async function handleRecordSaved(msg: string) {
    setSaveSuccessMessage(msg);
    await onSaved();
    setTimeout(() => {
      setSaveSuccessMessage(null);
    }, 4000);
  }

  return (
    <div className="entry-panel-backdrop" role="presentation" onClick={onClose}>
      <aside
        className="entry-panel-drawer"
        role="dialog"
        aria-modal="true"
        aria-labelledby="entry-panel-title"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 패널 헤더 */}
        <div className="entry-panel-header">
          <div className="entry-header-left">
            <span className="assistant-avatar" aria-hidden="true">🌱</span>
            <div>
              <p className="entry-kicker">통합 건강기록 도우미</p>
              <h2 id="entry-panel-title">{profile.displayName}님의 건강기록 추가</h2>
            </div>
          </div>
          <button
            type="button"
            className="entry-panel-close-btn"
            onClick={onClose}
            aria-label="패널 닫기 (ESC)"
            title="닫기 (ESC)"
          >
            ×
          </button>
        </div>

        {/* 저장 성공 알림 */}
        {saveSuccessMessage && (
          <div className="entry-panel-toast" role="status">
            ✅ {saveSuccessMessage}
          </div>
        )}

        {/* 모드별 컨텐츠 */}
        <div className="entry-panel-body">
          {mode === "menu" && (
            <div className="entry-menu-view">
              {/* 챗봇 인사말 버블 */}
              <div className="assistant-greeting-bubble">
                <div className="bubble-header">
                  <strong className="assistant-name">{HEALTH_ASSISTANT_CONFIG.name}</strong>
                  <span className="assistant-role">{HEALTH_ASSISTANT_CONFIG.role}</span>
                </div>
                <p className="bubble-text">
                  {HEALTH_ASSISTANT_CONFIG.greeting(HEALTH_ASSISTANT_CONFIG.name)}
                </p>
              </div>

              {/* 3가지 메인 기능 액션 카드 */}
              <div className="entry-action-cards" role="group" aria-label="기록 방법 선택">
                {HEALTH_ASSISTANT_CONFIG.actions.map((act) => (
                  <button
                    key={act.key}
                    type="button"
                    className="entry-action-card"
                    onClick={() => {
                      setSaveSuccessMessage(null);
                      setMode(act.key);
                    }}
                  >
                    <span className="action-card-icon" aria-hidden="true">{act.icon}</span>
                    <div className="action-card-text">
                      <div className="action-card-title-row">
                        <strong className="action-card-title">{act.title}</strong>
                        <span className="action-card-badge">{act.badge}</span>
                      </div>
                      <p className="action-card-desc">{act.description}</p>
                    </div>
                    <span className="action-card-arrow" aria-hidden="true">➔</span>
                  </button>
                ))}
              </div>

              {/* 안내 문구 */}
              <p className="entry-privacy-note">
                {HEALTH_ASSISTANT_CONFIG.disclaimer}
              </p>

              {/* 하단 통증 직접 입력창 (첫 버전에서는 통증 기록 입력으로 안내) */}
              <form className="entry-quick-input-form" onSubmit={handleMenuSubmit}>
                <label htmlFor="entry-quick-input" className="sr-only">통증 내용 입력</label>
                <input
                  id="entry-quick-input"
                  type="text"
                  value={menuInput}
                  onChange={(e) => setMenuInput(e.target.value)}
                  placeholder={HEALTH_ASSISTANT_CONFIG.inputPlaceholder}
                />
                <button type="submit" className="primary-button" disabled={!menuInput.trim()}>
                  작성
                </button>
              </form>
            </div>
          )}

          {mode === "ocr" && (
            <PanelOcrView
              profile={profile}
              runtime={runtime}
              onBack={() => setMode("menu")}
              onSaved={async () => {
                await handleRecordSaved("검진 서류 기록이 로컬에 저장되었습니다.");
                onClose();
              }}
              onNavigateToDataManagement={onNavigateToDataManagement}
            />
          )}

          {mode === "manual" && (
            <PanelManualView
              profile={profile}
              runtime={runtime}
              onBack={() => setMode("menu")}
              onSaved={async () => {
                await handleRecordSaved("건강 수치 기록이 로컬에 저장되었습니다.");
                onClose();
              }}
            />
          )}

          {mode === "pain" && (
            <PanelPainChatView
              profile={profile}
              runtime={runtime}
              initialText={initialPainText}
              onBack={() => {
                setInitialPainText("");
                setMode("menu");
              }}
              onSaved={async () => {
                await handleRecordSaved("통증 기록이 로컬에 저장되었습니다.");
                setInitialPainText("");
                onClose();
              }}
            />
          )}
        </div>
      </aside>
    </div>
  );
}

/* ==========================================================================
   1. 검진 서류 올리기 (OCR) 서브 뷰
   ========================================================================== */
function PanelOcrView({
  profile,
  runtime,
  onBack,
  onSaved,
  onNavigateToDataManagement,
}: {
  profile: FamilyProfile;
  runtime?: LocalDomainRuntime;
  onBack: () => void;
  onSaved: () => Promise<void>;
  onNavigateToDataManagement?: () => void;
}) {
  const [files, setFiles] = useState<File[]>([]);
  const [text, setText] = useState("");
  const [rows, setRows] = useState<Array<{ testName: string; value: string; unit: string; judgment: string }>>([]);
  const [recordedDate, setRecordedDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [recognizedDate, setRecognizedDate] = useState<string | null>(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  async function recognize() {
    if (files.length === 0) return setError("JPEG, PNG, WEBP 이미지 또는 PDF 문서를 하나 이상 선택해 주세요.");
    setWorking(true);
    setError(undefined);
    try {
      const result = normalizeOcrResult(await new DevServerOcrAdapter().recognize(files));
      setText(result.text);
      setRows(result.examItems?.map((item) => ({ ...item })) ?? []);
      if (result.examDate) {
        setRecordedDate(result.examDate);
        setRecognizedDate(result.examDate);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "OCR 인식에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  }

  async function confirm() {
    if (!runtime || files.length === 0 || !text.trim()) return;
    setWorking(true);
    try {
      let primaryDocumentId: string | undefined;
      if (runtime.documents) {
        for (const file of files) {
          const saved = await runtime.documents.save({
            householdId: PRIMARY_HOUSEHOLD_ID,
            profileId: profile.id,
            file,
            fileName: file.name,
          });
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
        recordedAt: new Date(`${recordedDate}T12:00:00`).toISOString(),
        source: "ocr",
        sourceDocumentId: primaryDocumentId,
        payload: { note: finalNote },
      });
      if (!result.ok) throw new Error(result.error.message);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "건강기록 저장에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="panel-subview panel-ocr-view">
      <div className="subview-nav">
        <button type="button" className="text-button back-btn" onClick={onBack}>
          ← 다른 기록 방식 선택
        </button>
        <span className="subview-title">📄 검진 서류 올리기</span>
      </div>

      <p className="form-notice">
        ※ 개발·검증용 외부 AI(Google Gemini)로 전송됩니다. 실제 개인정보가 없는 <strong>합성·비식별 문서</strong>로만 테스트해 주세요. 의료 판단을 하지 않으며, 직접 수정·확정해야만 브라우저 로컬에 저장됩니다.
      </p>

      {!text ? (
        <>
          <label className="file-upload-label">
            <span>건강서류 (PDF 또는 이미지 복수 선택 가능)</span>
            <input
              type="file"
              accept="image/jpeg,image/png,image/webp,application/pdf"
              multiple
              onChange={(event) => {
                const chosen = event.currentTarget.files;
                setFiles(chosen ? Array.from(chosen) : []);
              }}
            />
          </label>

          {files.length > 0 && (
            <div className="ocr-file-badge-list">
              {files.map((f, i) => (
                <span key={i} className="ocr-file-badge">
                  {f.name} ({(f.size / 1024 / 1024).toFixed(1)}MB)
                </span>
              ))}
            </div>
          )}

          <div className="panel-form-actions">
            {onNavigateToDataManagement && (
              <button type="button" className="secondary-button" onClick={onNavigateToDataManagement}>
                전체 서류 관리
              </button>
            )}
            <button
              className="primary-button"
              type="button"
              disabled={files.length === 0 || working}
              onClick={() => void recognize()}
            >
              {working ? "글자를 읽는 중…" : files.length > 1 ? `동의하고 ${files.length}장 일괄 OCR 읽기` : "동의하고 OCR 읽기"}
            </button>
          </div>
        </>
      ) : (
        <>
          <div className="ocr-date-selector">
            <label>
              <strong>검사 일자</strong>{" "}
              {recognizedDate ? <span className="optional-label">(문서 자동 인식: {recognizedDate})</span> : null}
              <input type="date" value={recordedDate} required onChange={(event) => setRecordedDate(event.target.value)} />
            </label>
          </div>

          <label>
            <span>추출 텍스트</span>
            <textarea rows={6} value={text} onChange={(event) => setText(event.target.value)} />
          </label>

          {rows.length > 0 && (
            <div className="ocr-review-table">
              <strong>검사 항목 확인 및 수정</strong>
              {rows.map((row, index) => (
                <div key={index} className="ocr-row-inputs">
                  <input
                    value={row.testName}
                    aria-label="검사항목"
                    onChange={(event) =>
                      setRows(rows.map((val, curr) => (curr === index ? { ...val, testName: event.target.value } : val)))
                    }
                  />
                  <input
                    value={row.value}
                    aria-label="결과값"
                    onChange={(event) =>
                      setRows(rows.map((val, curr) => (curr === index ? { ...val, value: event.target.value } : val)))
                    }
                  />
                  <input
                    value={row.unit}
                    aria-label="단위"
                    onChange={(event) =>
                      setRows(rows.map((val, curr) => (curr === index ? { ...val, unit: event.target.value } : val)))
                    }
                  />
                  <input
                    value={row.judgment}
                    aria-label="판정"
                    onChange={(event) =>
                      setRows(rows.map((val, curr) => (curr === index ? { ...val, judgment: event.target.value } : val)))
                    }
                  />
                </div>
              ))}
            </div>
          )}

          <div className="panel-form-actions">
            <button
              type="button"
              className="secondary-button"
              onClick={() => {
                setText("");
                setRows([]);
              }}
            >
              다시 올리기
            </button>
            <button className="primary-button" type="button" disabled={working} onClick={() => void confirm()}>
              {working ? "저장 중…" : "수정 내용 확정 · 건강기록 저장"}
            </button>
          </div>
        </>
      )}

      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}
    </div>
  );
}

/* ==========================================================================
   2. 간편 기록 (수기) 서브 뷰
   ========================================================================== */
type ManualKind = "measurement" | "screening" | "note";

function PanelManualView({
  profile,
  runtime,
  onBack,
  onSaved,
}: {
  profile: FamilyProfile;
  runtime?: LocalDomainRuntime;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const [kind, setKind] = useState<ManualKind>("measurement");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtime) return setError("로컬 저장소를 준비하는 중입니다.");
    const form = new FormData(event.currentTarget);
    const at = String(form.get("recordedAt") ?? "");
    const note = String(form.get("note") ?? "").trim();
    const base = {
      householdId: PRIMARY_HOUSEHOLD_ID,
      profileId: profile.id,
      recordedAt: new Date(at).toISOString(),
      source: "manual" as const,
    };

    let input: {
      householdId: string;
      profileId: string;
      recordedAt: string;
      source: "manual";
      recordType: HealthRecordType;
      payload: Record<string, unknown>;
    };

    if (kind === "measurement") {
      const type = String(form.get("measurementType") ?? "blood_pressure");
      if (type === "blood_glucose") {
        input = {
          ...base,
          recordType: "blood_glucose" as const,
          payload: { value: Number(form.get("glucose")), timing: String(form.get("timing") ?? ""), note },
        };
      } else if (type === "body_measurement") {
        input = {
          ...base,
          recordType: "body_measurement" as const,
          payload: {
            weightKg: Number(form.get("weight")),
            heightCm: form.get("height") ? Number(form.get("height")) : undefined,
            note,
          },
        };
      } else if (type === "lab_result") {
        input = {
          ...base,
          recordType: "lab_result" as const,
          payload: {
            testName: String(form.get("testName") ?? ""),
            value: String(form.get("value") ?? ""),
            unit: String(form.get("unit") ?? "") || undefined,
            note,
          },
        };
      } else {
        input = {
          ...base,
          recordType: "blood_pressure" as const,
          payload: { systolic: Number(form.get("systolic")), diastolic: Number(form.get("diastolic")), note },
        };
      }
    } else if (kind === "screening") {
      input = {
        ...base,
        recordType: "health_screening" as const,
        payload: {
          screeningName: String(form.get("screeningName") ?? ""),
          institution: String(form.get("institution") ?? "") || undefined,
          note,
        },
      };
    } else {
      input = {
        ...base,
        recordType: "note" as const,
        payload: { title: String(form.get("title") ?? "") || undefined, note },
      };
    }

    setSaving(true);
    setError(undefined);
    try {
      const result = await runtime.healthRecords.create(input);
      if (!result.ok) throw new Error(result.error.message);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "건강기록을 저장하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="panel-subview panel-manual-view">
      <div className="subview-nav">
        <button type="button" className="text-button back-btn" onClick={onBack}>
          ← 다른 기록 방식 선택
        </button>
        <span className="subview-title">✍️ 간편 직접 기록</span>
      </div>

      <form className="health-record-composer" onSubmit={(event) => void submit(event)}>
        <p className="form-notice">입력한 내용은 현재 브라우저에 암호화해 저장합니다. 자동 진단은 하지 않습니다.</p>

        <div className="record-kind-tabs" role="tablist" aria-label="기록 종류">
          {(
            [
              ["measurement", "수치 (혈압·혈당·체중)"],
              ["screening", "검진"],
              ["note", "메모"],
            ] as const
          ).map(([value, label]) => (
            <button
              type="button"
              key={value}
              className={kind === value ? "is-selected" : ""}
              onClick={() => setKind(value)}
            >
              {label}
            </button>
          ))}
        </div>

        <label>
          <span>기록 일시</span>
          <input name="recordedAt" type="datetime-local" required defaultValue={localDateTimeNow()} />
        </label>

        {kind === "measurement" && <PanelMeasurementFields />}
        {kind === "screening" && (
          <>
            <label>
              <span>검진명</span>
              <input name="screeningName" required placeholder="예: 국가건강검진" />
            </label>
            <label>
              <span>검사기관 <span className="optional-label">선택</span></span>
              <input name="institution" placeholder="예: 이어봄의원" />
            </label>
          </>
        )}
        {kind === "note" && (
          <label>
            <span>제목 <span className="optional-label">선택</span></span>
            <input name="title" placeholder="예: 감기 증상 관찰" />
          </label>
        )}

        <label>
          <span>상세 내용</span>
          <textarea name="note" rows={3} placeholder="확인한 사실만 간략히 적어주세요." />
        </label>

        {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

        <div className="panel-form-actions">
          <button className="secondary-button" type="button" onClick={onBack}>
            취소
          </button>
          <button className="primary-button" type="submit" disabled={saving}>
            {saving ? "암호화 저장 중…" : "기록 저장"}
          </button>
        </div>
      </form>
    </div>
  );
}

function PanelMeasurementFields() {
  const [type, setType] = useState<"blood_pressure" | "blood_glucose" | "body_measurement" | "lab_result">("blood_pressure");
  return (
    <>
      <label>
        <span>수치 종류</span>
        <select value={type} onChange={(event) => setType(event.target.value as typeof type)}>
          <option value="blood_pressure">혈압</option>
          <option value="blood_glucose">혈당</option>
          <option value="body_measurement">체중·신체 측정</option>
          <option value="lab_result">검사 수치</option>
        </select>
      </label>
      <input name="measurementType" type="hidden" value={type} />
      {type === "blood_pressure" && (
        <div className="record-field-grid">
          <label>
            <span>수축기</span>
            <input name="systolic" type="number" required placeholder="120" />
          </label>
          <label>
            <span>이완기</span>
            <input name="diastolic" type="number" required placeholder="80" />
          </label>
        </div>
      )}
      {type === "blood_glucose" && (
        <div className="record-field-grid">
          <label>
            <span>혈당</span>
            <input name="glucose" type="number" required placeholder="100" />
          </label>
          <label>
            <span>측정 시점</span>
            <select name="timing">
              <option value="fasting">공복</option>
              <option value="before_meal">식전</option>
              <option value="after_meal">식후</option>
              <option value="random">무작위</option>
            </select>
          </label>
        </div>
      )}
      {type === "body_measurement" && (
        <div className="record-field-grid">
          <label>
            <span>체중(kg)</span>
            <input name="weight" type="number" step="0.1" required />
          </label>
          <label>
            <span>키(cm) <span className="optional-label">선택</span></span>
            <input name="height" type="number" step="0.1" />
          </label>
        </div>
      )}
      {type === "lab_result" && (
        <div className="record-field-grid">
          <label>
            <span>검사항목</span>
            <input name="testName" required placeholder="예: AST(GOT)" />
          </label>
          <label>
            <span>결과값</span>
            <input name="value" required />
          </label>
          <label>
            <span>단위 <span className="optional-label">선택</span></span>
            <input name="unit" placeholder="U/L" />
          </label>
        </div>
      )}
    </>
  );
}

/* ==========================================================================
   3. 통증 기록 대화 (Pain Chat) 서브 뷰
   ========================================================================== */
function PanelPainChatView({
  profile,
  runtime,
  initialText,
  onBack,
  onSaved,
}: {
  profile: FamilyProfile;
  runtime?: LocalDomainRuntime;
  initialText?: string;
  onBack: () => void;
  onSaved: () => Promise<void>;
}) {
  const [messages, setMessages] = useState<Array<{ role: "assistant" | "user"; content: string }>>([
    { role: "assistant", content: "어디가 어떻게 아픈지 편하게 말씀해 주세요. 진단이 아니라 기록 작성을 도와드려요." },
  ]);
  const [input, setInput] = useState("");
  const [draft, setDraft] = useState<Record<string, unknown>>({});
  const [missing, setMissing] = useState<string[]>(["body_area", "intensity"]);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  // 초기 텍스트가 전달된 경우 자동 1회 전송
  useEffect(() => {
    if (initialText && initialText.trim()) {
      void sendChat(initialText.trim());
    }
  }, [initialText]);

  async function sendChat(content: string) {
    if (!content || working) return;
    const next = [...messages, { role: "user" as const, content }];
    setMessages(next);
    setInput("");
    setWorking(true);
    setError(undefined);
    try {
      const controller = new AbortController();
      const timeout = window.setTimeout(() => controller.abort(), 30000);
      const response = await fetch("/api/v1/pain-chat/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
        signal: controller.signal,
      });
      window.clearTimeout(timeout);
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "대화 처리에 실패했습니다.");
      setMessages((current) => [...current, { role: "assistant", content: body.data.assistant_message }]);
      setDraft(body.data.draft ?? {});
      setMissing(body.data.missing_fields ?? []);
    } catch (caught) {
      setError(
        caught instanceof DOMException && caught.name === "AbortError"
          ? "응답 시간이 초과되었습니다. 통증 부위와 정도를 직접 입력해 주세요."
          : caught instanceof Error
          ? caught.message
          : "대화에 실패했습니다.",
      );
    } finally {
      setWorking(false);
    }
  }

  async function save() {
    if (!runtime || !draft.body_area || typeof draft.intensity !== "number") return;
    setWorking(true);
    try {
      const userMsgs = messages.filter((m) => m.role === "user").map((m) => m.content).join(" ");
      const onsetStr = (draft.onset_formatted as string) || (draft.onset_date ? `${draft.onset_date}${draft.onset_description ? ` (${draft.onset_description})` : ""}` : (draft.onset_description as string));
      const onsetDate = (draft.onset_date as string) || undefined;

      const lines: string[] = [];
      lines.push(`부위: ${draft.body_area}`);
      lines.push(`통증강도: ${draft.intensity}/10`);
      if (draft.sensation) lines.push(`양상: ${draft.sensation}`);
      if (onsetStr) lines.push(`시작시각: ${onsetStr}`);
      if (draft.note) lines.push(`내용: ${draft.note}`);
      else if (userMsgs) lines.push(`내용: ${userMsgs}`);

      const finalNote = lines.join("\n");

      const result = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "pain",
        recordedAt: onsetDate ? new Date(`${onsetDate}T12:00:00`).toISOString() : new Date().toISOString(),
        source: "local_ai",
        payload: {
          bodyArea: draft.body_area,
          intensity: draft.intensity,
          sensation: draft.sensation,
          onsetDate,
          onsetDescription: draft.onset_description,
          onsetFormatted: onsetStr,
          note: finalNote,
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      await onSaved();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "통증 기록 저장에 실패했습니다.");
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="panel-subview panel-pain-view">
      <div className="subview-nav">
        <button type="button" className="text-button back-btn" onClick={onBack}>
          ← 다른 기록 방식 선택
        </button>
        <span className="subview-title">🩺 대화로 통증 기록</span>
      </div>

      <p className="form-notice">
        입력 내용은 기록 초안 생성을 위해 외부 AI로 전송됩니다. 저장 전 직접 확인하고 수정할 수 있습니다.
      </p>

      {/* 대화 메시지 영역 */}
      <div className="health-chat-messages">
        {messages.map((message, index) => (
          <p key={index} className={message.role}>
            {message.content}
          </p>
        ))}
      </div>

      {/* 입력창 */}
      <form
        className="health-chat-form"
        onSubmit={(event) => {
          event.preventDefault();
          void sendChat(input.trim());
        }}
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="예: 저번주 수요일부터 오른쪽 발목이 찌릿찌릿해요"
          disabled={working}
        />
        <button className="primary-button" disabled={working || !input.trim()}>
          {working ? "정리 중…" : "보내기"}
        </button>
      </form>

      {/* 구조화된 기록 초안 검토 영역 */}
      {Object.keys(draft).length > 0 ? (
        <div className="chat-draft">
          <h3>저장 전 확인 및 수정</h3>
          <label>
            <span>통증 부위 (좌·우 구분 포함)</span>
            <input
              value={String(draft.body_area ?? "")}
              placeholder="예: 오른쪽 발목"
              onChange={(event) => setDraft({ ...draft, body_area: event.target.value })}
            />
          </label>
          <label>
            <span>통증 정도 (0~10)</span>
            <input
              type="number"
              min="0"
              max="10"
              value={typeof draft.intensity === "number" ? draft.intensity : ""}
              onChange={(event) => setDraft({ ...draft, intensity: Number(event.target.value) })}
            />
          </label>
          <label>
            <span>통증 양상</span>
            <input
              value={String(draft.sensation ?? "")}
              placeholder="예: 찌릿찌릿함, 욱신거림"
              onChange={(event) => setDraft({ ...draft, sensation: event.target.value })}
            />
          </label>
          <label>
            <span>통증 시작 시점</span>
            <input
              value={String(draft.onset_formatted ?? draft.onset_date ?? draft.onset_description ?? "")}
              placeholder="예: 8월 19일 (저번주 수요일)"
              onChange={(event) => setDraft({ ...draft, onset_formatted: event.target.value })}
            />
          </label>
          <label>
            <span>상세 내용</span>
            <textarea
              rows={2}
              value={String(draft.note ?? "")}
              placeholder="상세한 통증 설명"
              onChange={(event) => setDraft({ ...draft, note: event.target.value })}
            />
          </label>

          {missing.length > 0 ? (
            <p className="missing-fields-note">추가 확인 필요: {missing.join(", ")}</p>
          ) : (
            <div className="panel-form-actions">
              <button className="primary-button" type="button" disabled={working} onClick={() => void save()}>
                {working ? "저장 중…" : "통증 기록으로 저장"}
              </button>
            </div>
          )}
        </div>
      ) : null}

      {error ? <div className="alert error-alert">{error}</div> : null}
    </div>
  );
}

function localDateTimeNow() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 16);
}
