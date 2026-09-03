import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { useLocalDomain } from "../../app/localDomainContext";
import { Modal } from "../../shared/ui/Modal";
import { detectLocalCapabilities } from "../../shared/local/capabilities";
import type { BackupPreview } from "../../shared/local/localBackupService";
import type { LocalDocument } from "../../shared/local/domainContracts";
import { GeminiOcrAdapter, type OcrMeasurements } from "../../shared/api/geminiOcrAdapter";
import { FIELD_META } from "../assessment/fields";

/**
 * 선택한 구성원의 서류만 남긴다.
 *
 * 예전에는 가구 전체 서류를 한 목록에 쏟았다. 구성원을 골라 놓고 아버지 검진표와
 * 내 검진표가 나란히 뜨면, 어느 것을 눌러야 지금 고른 사람의 기록이 되는지 화면이
 * 말해 주지 않는다. 고르지 않았으면 아무것도 보이지 않는 편이 낫다.
 */
export function filterDocumentsByProfile(documents: LocalDocument[], profileId: string): LocalDocument[] {
  if (!profileId) return [];
  return documents.filter((document) => document.profileId === profileId);
}

export function DataManagementPage() {
  const { runtime, profiles, refreshProfiles } = useLocalDomain();
  const capabilities = useMemo(() => detectLocalCapabilities(), []);
  const [passphrase, setPassphrase] = useState("");
  const [backupFile, setBackupFile] = useState<File>();
  const [preview, setPreview] = useState<BackupPreview>();
  const [replaceExisting, setReplaceExisting] = useState(false);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [documentFile, setDocumentFile] = useState<File>();
  const [documents, setDocuments] = useState<LocalDocument[]>([]);
  const [ocrDocument, setOcrDocument] = useState<LocalDocument>();
  const [ocrText, setOcrText] = useState("");
  const [ocrProgress, setOcrProgress] = useState<string>();
  // 표에서 옮겨 낸 수치. 예전에는 `tables` 를 받아 놓고 아무도 읽지 않아서,
  // 검진표를 올린 사용자가 판정 화면에서 같은 숫자를 손으로 다시 쳤다.
  const [ocrMeasurements, setOcrMeasurements] = useState<OcrMeasurements>();
  const [deletingDocument, setDeletingDocument] = useState<LocalDocument>();
  const navigate = useNavigate();

  const effectiveProfileId = selectedProfileId || profiles[0]?.id || "";
  const visibleDocuments = useMemo(
    () => filterDocumentsByProfile(documents, effectiveProfileId),
    [documents, effectiveProfileId],
  );


  const refreshDocuments = useCallback(async () => {
    if (!runtime?.documents) return;
    const result = await runtime.documents.list();
    if (!result.ok) throw new Error(result.error.message);
    setDocuments(result.value);
  }, [runtime]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshDocuments().catch((caught: unknown) => setError(errorMessage(caught, "건강자료 목록을 불러오지 못했어요.")));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshDocuments]);

  async function exportBackup() {
    if (!runtime) return;
    setWorking(true);
    resetFeedback();
    try {
      const blob = await runtime.backup.exportAll(passphrase);
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `ieobom-backup-${new Date().toISOString().slice(0, 10)}.ieobom`;
      anchor.click();
      URL.revokeObjectURL(url);
      setMessage("암호화 백업 파일을 내보냈습니다. 비밀번호와 파일을 서로 다른 곳에 보관하세요.");
    } catch (caught) {
      setError(errorMessage(caught, "백업 파일을 만들지 못했습니다."));
    } finally {
      setWorking(false);
    }
  }

  async function inspectBackup() {
    if (!runtime || !backupFile) return;
    setWorking(true);
    resetFeedback();
    try {
      setPreview(await runtime.backup.inspect(backupFile, passphrase));
      setMessage("파일의 암호화와 무결성을 확인했습니다. 아직 현재 데이터는 변경하지 않았습니다.");
    } catch (caught) {
      setError(errorMessage(caught, "백업 파일을 확인하지 못했습니다."));
    } finally {
      setWorking(false);
    }
  }

  async function importBackup() {
    if (!runtime || !backupFile || !preview) return;
    setWorking(true);
    resetFeedback();
    try {
      const result = await runtime.backup.importAll(
        backupFile,
        passphrase,
        replaceExisting ? "replace" : "reject-if-not-empty",
      );
      await refreshProfiles();
      setMessage(`${result.totalRecords}개 로컬 데이터를 안전하게 가져왔습니다.`);
      setPreview(undefined);
      setBackupFile(undefined);
      setReplaceExisting(false);
    } catch (caught) {
      setError(errorMessage(caught, "백업 파일을 가져오지 못했습니다."));
    } finally {
      setWorking(false);
    }
  }

  function selectFile(event: ChangeEvent<HTMLInputElement>) {
    setBackupFile(event.currentTarget.files?.[0]);
    setPreview(undefined);
    resetFeedback();
  }

  function resetFeedback() {
    setMessage(undefined);
    setError(undefined);
  }

  async function saveDocument() {
    if (!runtime?.documents || !documentFile || !effectiveProfileId) return;
    const profile = profiles.find((item) => item.id === effectiveProfileId);
    if (!profile) return;
    setWorking(true);
    resetFeedback();
    try {
      const result = await runtime.documents.save({
        householdId: profile.householdId,
        profileId: profile.id,
        file: documentFile,
        fileName: documentFile.name,
      });
      if (!result.ok) throw new Error(result.error.message);
      await refreshDocuments();
      setDocumentFile(undefined);
      setMessage("건강자료를 이 브라우저에 암호화해 저장했어요.");
    } catch (caught) {
      setError(errorMessage(caught, "건강자료를 저장하지 못했어요."));
    } finally {
      setWorking(false);
    }
  }

  async function downloadDocument(document: LocalDocument) {
    if (!runtime?.documents) return;
    const result = await runtime.documents.read(document);
    if (!result.ok) return setError(result.error.message);
    const url = URL.createObjectURL(result.value);
    const anchor = window.document.createElement("a");
    anchor.href = url;
    anchor.download = document.fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  async function runOcr(document: LocalDocument) {
    if (!runtime?.documents) return;
    setWorking(true);
    resetFeedback();
    setOcrDocument(document);
    setOcrText("");
    setOcrMeasurements(undefined);
    try {
      const source = await runtime.documents.read(document);
      if (!source.ok) throw new Error(source.error.message);
      setOcrProgress("건강자료 내용을 불러오는 중이에요…");
      // 인식되는 대로 아래 편집창에 흘려 넣는다. 예전에는 20초 넘게 빈 화면을 보다가
      // 결과가 한 번에 나타났다 — 사용자는 그동안 멈춘 것인지 알 수 없었다.
      const result = await new GeminiOcrAdapter().recognize(source.value, document.fileName, {
        onProgress: ({ text }) => {
          setOcrText(text);
          setOcrProgress(text ? "건강자료 내용을 읽고 있어요…" : "건강자료 내용을 불러오는 중이에요…");
        },
      });
      // 스트리밍이 보여 준 것은 `text` 뿐이다. 표까지 담긴 완성본으로 덮어써야
      // 저장되는 내용이 폴링 경로와 같아진다.
      setOcrText(result.text);
      // 서버가 표를 읽어 수치로 옮겨 준 결과. 관문을 통과한 것만 `values` 에 있다.
      setOcrMeasurements(result.measurements ?? undefined);
      setOcrProgress(undefined);
    } catch (caught) {
      setError(errorMessage(caught, "건강자료 내용을 불러오지 못했어요."));
    } finally {
      setWorking(false);
    }
  }

  async function saveOcrResult() {
    if (!runtime || !ocrDocument || !ocrText.trim()) return;
    setWorking(true);
    resetFeedback();
    try {
      const result = await runtime.healthRecords.create({
        householdId: ocrDocument.householdId,
        profileId: ocrDocument.profileId,
        recordType: "lab_result",
        recordedAt: new Date().toISOString(),
        source: "ocr",
        sourceDocumentId: ocrDocument.id,
        payload: { note: ocrText.trim() },
      });
      if (!result.ok) throw new Error(result.error.message);
      setMessage("확인한 내용을 구성원의 건강기록으로 저장했어요.");
      setOcrDocument(undefined);
      setOcrText("");
      setOcrMeasurements(undefined);
    } catch (caught) {
      setError(errorMessage(caught, "확인한 내용을 건강기록으로 저장하지 못했어요."));
    } finally {
      setWorking(false);
    }
  }

  async function confirmDeleteDocument() {
    if (!runtime?.documents || !deletingDocument) return;
    setWorking(true);
    resetFeedback();
    try {
      const result = await runtime.documents.delete(deletingDocument.id);
      if (!result.ok) throw new Error(result.error.message);
      await refreshDocuments();
      setDeletingDocument(undefined);
      setMessage("건강자료를 이 브라우저에서 삭제했어요.");
    } catch (caught) {
      setError(errorMessage(caught, "건강자료를 삭제하지 못했어요."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="product-page data-page">
      <section className="dashboard-heading">
        <div>
          <p className="page-kicker">데이터 관리</p>
          <h1>건강정보를 직접 보관하고 옮기세요</h1>
          <p>이어봄 서버가 아닌 사용자 파일을 통해 백업하고 복구합니다.</p>
        </div>
        <span className="local-status-badge">등록 프로필 {profiles.length}명</span>
      </section>

      <section className="data-boundary-card">
        <div>
          <p className="section-kicker">저장 경계</p>
          <h2>브라우저 데이터는 자동으로 클라우드에 복사되지 않습니다.</h2>
          <p>브라우저 데이터 삭제나 기기 분실에 대비해 암호화 백업 파일을 정기적으로 내려받으세요.</p>
        </div>
        <dl>
          <div><dt>브라우저 로컬</dt><dd>프로필·건강기록·가족력·건강자료</dd></div>
          <div><dt>이어봄 서버</dt><dd>계정·구독·초대·연결 상태</dd></div>
        </dl>
      </section>

      {message ? <div className="alert success-alert" role="status">{message}</div> : null}
      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

      <div className="data-action-grid">
        <section className="data-action-card">
          <span className="data-card-number">01</span>
          <p className="section-kicker">내보내기</p>
          <h2>암호화 백업 파일 만들기</h2>
          <p>현재 브라우저의 로컬 프로필과 건강기록을 하나의 암호화 파일로 저장합니다.</p>
          <label>
            백업 비밀번호
            <input
              type="password"
              minLength={12}
              value={passphrase}
              onChange={(event) => setPassphrase(event.currentTarget.value)}
              placeholder="12자 이상 입력"
              autoComplete="new-password"
            />
          </label>
          <small className="field-help">이 비밀번호는 서버에 저장되지 않으며 분실하면 복구할 수 없습니다.</small>
          <button className="primary-button" type="button" disabled={!runtime || working || passphrase.length < 12} onClick={exportBackup}>
            {working ? "처리 중…" : "백업 파일 다운로드"}
          </button>
        </section>

        <section className="data-action-card">
          <span className="data-card-number">02</span>
          <p className="section-kicker">가져오기</p>
          <h2>백업 파일 확인·복구</h2>
          <p>파일을 먼저 검증하고 포함된 항목을 확인한 뒤 현재 브라우저에 가져옵니다.</p>
          <label>
            이어봄 백업 파일
            <input type="file" accept=".ieobom,application/vnd.ieobom.backup+json,application/json" onChange={selectFile} />
          </label>
          <button className="secondary-button" type="button" disabled={!runtime || !backupFile || working || passphrase.length < 12} onClick={inspectBackup}>
            파일 내용 확인
          </button>
          {preview ? (
            <div className="backup-preview">
              <strong>{preview.totalRecords}개 데이터가 들어 있습니다.</strong>
              <span>건강자료 파일 {preview.totalFiles}개 포함</span>
              <span>생성 시각 {new Date(preview.createdAt).toLocaleString("ko-KR")}</span>
              {profiles.length > 0 ? (
                <label className="danger-checkbox">
                  <input type="checkbox" checked={replaceExisting} onChange={(event) => setReplaceExisting(event.currentTarget.checked)} />
                  현재 로컬 데이터를 백업 내용으로 교체합니다.
                </label>
              ) : null}
              <button className="primary-button" type="button" disabled={working || (profiles.length > 0 && !replaceExisting)} onClick={importBackup}>
                검증한 파일 가져오기
              </button>
            </div>
          ) : null}
        </section>
      </div>

      <section className="capability-panel">
        <div className="section-title-row">
          <div><p className="section-kicker">브라우저 상태</p><h2>이 기기의 로컬 기능</h2></div>
        </div>
        <div className="capability-list">
          {capabilities.map((capability) => (
            <div key={capability.id}>
              <span className={capability.supported ? "status-dot is-ready" : "status-dot"} aria-hidden="true" />
              <strong>{capability.label}</strong>
              <small>{capability.supported ? "사용 가능" : "지원되지 않음"}</small>
            </div>
          ))}
        </div>
      </section>

      <section className="document-panel">
        <div className="section-title-row">
          <div><p className="section-kicker">건강자료 관리</p><h2>건강자료를 올리고 기록으로 연결하세요</h2></div>
        </div>
        {!runtime?.documents ? (
          <div className="alert error-alert">이 브라우저에서는 건강자료 파일을 저장할 수 없습니다.</div>
        ) : (
          <>
            <div className="document-upload-row">
              <label>구성원<select value={effectiveProfileId} onChange={(event) => setSelectedProfileId(event.currentTarget.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label>
              <label>건강자료<input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => setDocumentFile(event.currentTarget.files?.[0])} /></label>
              <button className="primary-button" type="button" disabled={!documentFile || !effectiveProfileId || working} onClick={() => void saveDocument()}>암호화 저장</button>
            </div>
            <div className="document-list">
              {visibleDocuments.map((document) => (
                <article key={document.id}>
                  <div><strong>{document.fileName}</strong><small>{profiles.find((profile) => profile.id === document.profileId)?.displayName ?? "알 수 없는 구성원"} · {(document.byteSize / 1024).toFixed(1)}KB</small></div>
                  <div className="record-row-actions"><button type="button" onClick={() => void downloadDocument(document)}>내려받기</button><button type="button" disabled={!(document.mimeType.startsWith("image/") || document.mimeType === "application/pdf") || working} onClick={() => void runOcr(document)}>건강자료 불러오기</button><button type="button" onClick={() => setDeletingDocument(document)}>삭제</button></div>
                </article>
              ))}
              {visibleDocuments.length === 0 ? <div className="compact-empty"><strong>선택한 구성원에게 저장된 건강자료가 없습니다.</strong></div> : null}
            </div>
          </>
        )}
      </section>

      {ocrDocument ? (
        <Modal
          kicker="사용자 확인 단계"
          title="불러온 내용 확인"
          className="ocr-review-modal"
          onClose={() => setOcrDocument(undefined)}
        >
            {ocrProgress ? <p className="form-notice">{ocrProgress}</p> : null}
            <label className="ocr-review-field">불러온 내용<textarea rows={14} value={ocrText} onChange={(event) => setOcrText(event.currentTarget.value)} placeholder="건강자료에서 불러온 내용이 여기에 표시됩니다." /></label>
            <MeasurementPanel
              measurements={ocrMeasurements}
              onUse={(values) => {
                setOcrDocument(undefined);
                setOcrMeasurements(undefined);
                void navigate("/assessment", { state: { prefill: values } });
              }}
            />
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => { setOcrDocument(undefined); setOcrMeasurements(undefined); }}>취소</button><button className="primary-button" type="button" disabled={working || !ocrText.trim()} onClick={() => void saveOcrResult()}>확인하고 건강기록에 저장</button></div>
        </Modal>
      ) : null}

      {deletingDocument ? (
        <Modal kicker="건강자료 삭제" title={deletingDocument.fileName} onClose={() => setDeletingDocument(undefined)}>
            <div className="profile-confirmation"><p>이 브라우저에 암호화해 저장한 파일을 삭제합니다. 이미 생성한 건강기록은 자동으로 삭제하지 않습니다.</p><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setDeletingDocument(undefined)}>취소</button><button className="danger-button" type="button" disabled={working} onClick={() => void confirmDeleteDocument()}>파일 삭제</button></div></div>
        </Modal>
      ) : null}
    </div>
  );
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}

/**
 * 표에서 읽어 낸 수치를 보여 주고, 확실한 것만 판정 폼으로 넘긴다.
 *
 * **`values` 와 `review` 를 섞어 보여 주지 않는다.** 섞으면 사용자가 "인식됐다" 로
 * 한 덩어리로 읽고 그대로 넘긴다. 걸러 낸 이유(단위·참고치·중복)를 옆에 붙여야
 * 확인할 마음이 생긴다 — 검사명 오독은 숫자만 보면 멀쩡해 보인다.
 */
function MeasurementPanel({
  measurements,
  onUse,
}: {
  measurements?: OcrMeasurements;
  onUse: (values: Record<string, number>) => void;
}) {
  if (!measurements) return null;

  const accepted = Object.entries(measurements.values);
  const review = measurements.review;
  if (accepted.length === 0 && review.length === 0) {
    return <p className="form-notice">표에서 판정에 쓸 수치를 찾지 못했어요. 위 내용은 그대로 기록에 저장할 수 있어요.</p>;
  }

  return (
    <div className="ocr-measurements">
      {accepted.length > 0 ? (
        <>
          <h3>바로 쓸 수 있는 수치 {accepted.length}개</h3>
          <ul className="ocr-measurement-list">
            {accepted.map(([name, value]) => (
              <li key={name}>
                <span className="ocr-measurement-label">{FIELD_META[name]?.label ?? name}</span>
                <span className="ocr-measurement-value">
                  {value}
                  {FIELD_META[name]?.unit ? ` ${FIELD_META[name].unit}` : ""}
                </span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {review.length > 0 ? (
        <>
          <h3>확인이 필요한 항목 {review.length}개</h3>
          <p className="form-notice">
            아래는 판정에 넣지 않았어요. 검사명을 잘못 읽었을 수 있어서, 원본과 맞는지 확인한 뒤 판정 화면에서 직접
            입력해 주세요.
          </p>
          <ul className="ocr-measurement-list ocr-measurement-review">
            {review.map((row, index) => (
              <li key={`${row.field}-${index}`}>
                <span className="ocr-measurement-label">{row.label}</span>
                <span className="ocr-measurement-value">
                  {Number.isFinite(row.value) ? row.value : "—"} {row.unit}
                </span>
                <span className="ocr-measurement-reason">{row.reason}</span>
              </li>
            ))}
          </ul>
        </>
      ) : null}

      {accepted.length > 0 ? (
        <div className="form-actions">
          <button className="secondary-button" type="button" onClick={() => onUse(measurements.values)}>
            이 수치로 판정하러 가기
          </button>
        </div>
      ) : null}
    </div>
  );
}
