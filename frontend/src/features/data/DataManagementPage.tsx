import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useLocalDomain } from "../../app/localDomainContext";
import { detectLocalCapabilities } from "../../shared/local/capabilities";
import type { BackupPreview } from "../../shared/local/localBackupService";
import type { LocalDocument } from "../../shared/local/domainContracts";
import { BrowserOcrAdapter } from "../../shared/local/browserOcrAdapter";

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
  const [deletingDocument, setDeletingDocument] = useState<LocalDocument>();

  const effectiveProfileId = selectedProfileId || profiles[0]?.id || "";

  const refreshDocuments = useCallback(async () => {
    if (!runtime?.documents) return;
    const result = await runtime.documents.list();
    if (!result.ok) throw new Error(result.error.message);
    setDocuments(result.value);
  }, [runtime]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refreshDocuments().catch((caught: unknown) => setError(errorMessage(caught, "문서 목록을 불러오지 못했습니다.")));
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
      setMessage("원본 문서를 암호화해 OPFS에 저장했습니다.");
    } catch (caught) {
      setError(errorMessage(caught, "문서를 저장하지 못했습니다."));
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
    try {
      const source = await runtime.documents.read(document);
      if (!source.ok) throw new Error(source.error.message);
      const adapter = new BrowserOcrAdapter();
      const text = await adapter.recognize(source.value, (progress) => {
        setOcrProgress(`${progress.status} ${Math.round(progress.progress * 100)}%`);
      });
      setOcrText(text);
      setOcrProgress(undefined);
    } catch (caught) {
      setError(errorMessage(caught, "로컬 OCR을 실행하지 못했습니다."));
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
      setMessage("검토한 OCR 결과를 구성원의 로컬 건강기록으로 저장했습니다.");
      setOcrDocument(undefined);
      setOcrText("");
    } catch (caught) {
      setError(errorMessage(caught, "OCR 결과를 저장하지 못했습니다."));
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
      setMessage("원본 문서를 이 브라우저에서 삭제했습니다.");
    } catch (caught) {
      setError(errorMessage(caught, "문서를 삭제하지 못했습니다."));
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
          <div><dt>브라우저 로컬</dt><dd>프로필·건강기록·가족력·OCR</dd></div>
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
              <span>원본 문서 {preview.totalFiles}개 포함</span>
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
          <div><p className="section-kicker">원본 문서·로컬 OCR</p><h2>건강서류를 이 브라우저에서 처리하세요</h2></div>
        </div>
        {!runtime?.documents ? (
          <div className="alert error-alert">이 브라우저에서는 OPFS 문서 저장을 사용할 수 없습니다.</div>
        ) : (
          <>
            <div className="document-upload-row">
              <label>구성원<select value={effectiveProfileId} onChange={(event) => setSelectedProfileId(event.currentTarget.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.displayName}</option>)}</select></label>
              <label>건강서류<input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => setDocumentFile(event.currentTarget.files?.[0])} /></label>
              <button className="primary-button" type="button" disabled={!documentFile || !effectiveProfileId || working} onClick={() => void saveDocument()}>암호화 저장</button>
            </div>
            <div className="document-list">
              {documents.map((document) => (
                <article key={document.id}>
                  <div><strong>{document.fileName}</strong><small>{profiles.find((profile) => profile.id === document.profileId)?.displayName ?? "알 수 없는 구성원"} · {(document.byteSize / 1024).toFixed(1)}KB</small></div>
                  <div className="record-row-actions"><button type="button" onClick={() => void downloadDocument(document)}>내려받기</button><button type="button" disabled={!(document.mimeType.startsWith("image/") || document.mimeType === "application/pdf") || working} onClick={() => void runOcr(document)}>로컬 OCR</button><button type="button" onClick={() => setDeletingDocument(document)}>삭제</button></div>
                </article>
              ))}
              {documents.length === 0 ? <div className="compact-empty"><strong>저장된 원본 문서가 없습니다.</strong></div> : null}
            </div>
          </>
        )}
      </section>

      {ocrDocument ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel ocr-review-modal" role="dialog" aria-modal="true" aria-labelledby="ocr-review-title">
            <div className="modal-heading"><div><p className="section-kicker">서버 전송 없음</p><h2 id="ocr-review-title">OCR 결과 검토</h2></div><button className="modal-close" type="button" aria-label="닫기" onClick={() => setOcrDocument(undefined)}>×</button></div>
            {ocrProgress ? <p className="form-notice">{ocrProgress}</p> : null}
            <label className="ocr-review-field">추출 결과<textarea rows={14} value={ocrText} onChange={(event) => setOcrText(event.currentTarget.value)} placeholder="OCR 처리 결과가 여기에 표시됩니다." /></label>
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setOcrDocument(undefined)}>취소</button><button className="primary-button" type="button" disabled={working || !ocrText.trim()} onClick={() => void saveOcrResult()}>검토 결과 저장</button></div>
          </section>
        </div>
      ) : null}

      {deletingDocument ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel" role="dialog" aria-modal="true" aria-labelledby="delete-document-title">
            <div className="modal-heading"><div><p className="section-kicker">원본 문서 삭제</p><h2 id="delete-document-title">{deletingDocument.fileName}</h2></div><button className="modal-close" type="button" aria-label="닫기" onClick={() => setDeletingDocument(undefined)}>×</button></div>
            <div className="profile-confirmation"><p>OPFS에 저장된 암호화 원본을 삭제합니다. 이미 생성한 건강기록은 자동으로 삭제하지 않습니다.</p><div className="form-actions"><button className="secondary-button" type="button" onClick={() => setDeletingDocument(undefined)}>취소</button><button className="danger-button" type="button" disabled={working} onClick={() => void confirmDeleteDocument()}>원본 삭제</button></div></div>
          </section>
        </div>
      ) : null}
    </div>
  );
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
