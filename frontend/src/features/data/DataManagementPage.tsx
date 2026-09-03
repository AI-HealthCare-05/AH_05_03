import { type ChangeEvent, useCallback, useEffect, useMemo, useState } from "react";

import { useLocalDomain } from "../../app/localDomainContext";
import { detectLocalCapabilities } from "../../shared/local/capabilities";
import type { BackupPreview } from "../../shared/local/localBackupService";
import type { LocalDocument } from "../../shared/local/domainContracts";
import type { OcrExamItem } from "../../local-domain/types";
import { DevServerOcrAdapter } from "../../ocr/ocr-adapter";
import { normalizeOcrResult } from "../../ocr/ocr-normalizer";

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
  const [ocrItems, setOcrItems] = useState<OcrExamItem[]>([]);
  const [ocrExamDate, setOcrExamDate] = useState(todayValue);
  const [ocrScreeningName, setOcrScreeningName] = useState("건강검진");
  const [ocrInstitution, setOcrInstitution] = useState("");
  const [ocrProgress, setOcrProgress] = useState<string>();
  const [deletingDocument, setDeletingDocument] = useState<LocalDocument>();

  const effectiveProfileId = selectedProfileId || profiles[0]?.id || "";
  const filteredDocuments = useMemo(
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

  async function viewDocument(document: LocalDocument) {
    if (!runtime?.documents) return;
    const result = await runtime.documents.read(document);
    if (!result.ok) return setError(result.error.message);
    const url = URL.createObjectURL(result.value);
    window.open(url, "_blank");
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
    setOcrItems([]);
    setOcrExamDate(todayValue());
    setOcrScreeningName("건강검진");
    setOcrInstitution("");
    setOcrProgress("서류 내용을 읽고 항목별로 정리하고 있습니다…");
    try {
      const source = await runtime.documents.read(document);
      if (!source.ok) throw new Error(source.error.message);
      const file = new File([source.value], document.fileName, { type: document.mimeType });
      const normalized = normalizeOcrResult(await new DevServerOcrAdapter().recognize(file));
      if (!normalized.text.trim() && !normalized.examItems?.length) {
        throw new Error("서류에서 확인할 수 있는 내용을 찾지 못했습니다. 더 선명한 파일로 다시 시도해 주세요.");
      }
      setOcrText(normalized.text);
      setOcrItems(normalized.examItems ?? []);
      setOcrExamDate(extractExamDate(normalized.text) ?? todayValue());
      setOcrProgress(undefined);
    } catch (caught) {
      setError(errorMessage(caught, "서류 내용을 읽지 못했습니다."));
      setOcrProgress(undefined);
      setOcrDocument(undefined);
    } finally {
      setWorking(false);
    }
  }

  async function saveOcrResult() {
    if (!runtime || !ocrDocument || (!ocrText.trim() && ocrItems.length === 0)) return;
    setWorking(true);
    resetFeedback();
    try {
      const result = await runtime.healthRecords.create({
        householdId: ocrDocument.householdId,
        profileId: ocrDocument.profileId,
        recordType: "health_screening",
        recordedAt: new Date(`${ocrExamDate}T12:00:00`).toISOString(),
        source: "ocr",
        sourceDocumentId: ocrDocument.id,
        payload: {
          screeningName: ocrScreeningName.trim() || "건강검진",
          institution: ocrInstitution.trim() || undefined,
          summary: ocrText.trim(),
          items: ocrItems.filter((item) => item.testName.trim() && item.value.trim()),
        },
      });
      if (!result.ok) throw new Error(result.error.message);
      setMessage("검토한 내용을 구성원의 로컬 건강기록으로 저장했습니다.");
      setOcrDocument(undefined);
      setOcrText("");
      setOcrItems([]);
    } catch (caught) {
      setError(errorMessage(caught, "분석 결과를 저장하지 못했습니다."));
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
          <p className="page-kicker">건강 파일</p>
          <h1>검진 서류와 건강 데이터를 한곳에서 관리하세요</h1>
          <p>원본 서류를 안전하게 보관하고 전체 건강 데이터를 암호화해 백업·복원합니다.</p>
        </div>
        <span className="local-status-badge">등록 프로필 {profiles.length}명</span>
      </section>

      <nav className="health-files-tabs" aria-label="건강 파일 바로가기">
        <a href="#health-documents">건강 서류</a>
        <a href="#health-backup">보관·백업</a>
      </nav>

      <section className="data-boundary-card">
        <div>
          <p className="section-kicker">저장 경계</p>
          <h2>브라우저 데이터는 자동으로 클라우드에 복사되지 않습니다.</h2>
          <p>브라우저 데이터 삭제나 기기 분실에 대비해 암호화 백업 파일을 정기적으로 내려받으세요.</p>
        </div>
        <dl>
          <div><dt>브라우저 로컬</dt><dd>프로필·건강기록·가족력·건강 서류</dd></div>
          <div><dt>이어봄 서버</dt><dd>계정·구독·초대·연결 상태</dd></div>
        </dl>
      </section>

      {message ? <div className="alert success-alert" role="status">{message}</div> : null}
      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

      <div className="data-action-grid" id="health-backup">
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

      <section className="document-panel" id="health-documents">
        <div className="section-title-row">
          <div><p className="section-kicker">건강 서류</p><h2>검진 서류를 안전하게 보관하고 내용을 확인하세요</h2></div>
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
              {filteredDocuments.map((document) => (
                <article key={document.id}>
                  <div><strong>{document.fileName}</strong><small>{profiles.find((profile) => profile.id === document.profileId)?.displayName ?? "알 수 없는 구성원"} · {(document.byteSize / 1024).toFixed(1)}KB</small></div>
                  <div className="record-row-actions">
                    <button type="button" onClick={() => void viewDocument(document)}>보기</button>
                    <button type="button" onClick={() => void downloadDocument(document)}>내려받기</button>
                    <button type="button" disabled={!(document.mimeType.startsWith("image/") || document.mimeType === "application/pdf") || working} onClick={() => void runOcr(document)}>서류 내용 읽기</button>
                    <button type="button" onClick={() => setDeletingDocument(document)}>삭제</button>
                  </div>
                </article>
              ))}
              {filteredDocuments.length === 0 ? <div className="compact-empty"><strong>선택한 구성원에게 저장된 건강 서류가 없습니다.</strong></div> : null}
            </div>
          </>
        )}
      </section>

      {ocrDocument ? (
        <div className="modal-backdrop" role="presentation">
          <section className="modal-panel ocr-review-modal" role="dialog" aria-modal="true" aria-labelledby="ocr-review-title">
            <div className="modal-heading"><div><p className="section-kicker">저장 전 검토</p><h2 id="ocr-review-title">서류 분석 결과 확인</h2></div><button className="modal-close" type="button" aria-label="닫기" onClick={() => setOcrDocument(undefined)}>×</button></div>
            {ocrProgress ? <p className="form-notice">{ocrProgress}</p> : null}
            <div className="ocr-review-meta-grid">
              <label>실제 검사일<input type="date" value={ocrExamDate} onChange={(event) => setOcrExamDate(event.currentTarget.value)} /></label>
              <label>검진·서류명<input value={ocrScreeningName} onChange={(event) => setOcrScreeningName(event.currentTarget.value)} /></label>
              <label>검진 기관<input value={ocrInstitution} onChange={(event) => setOcrInstitution(event.currentTarget.value)} placeholder="선택 입력" /></label>
            </div>
            {ocrItems.length > 0 ? (
              <div className="ocr-review-items" aria-label="검사 항목 확인">
                <div className="ocr-review-item ocr-review-item-heading"><strong>검사항목</strong><strong>결과값</strong><strong>단위</strong><strong>판정</strong></div>
                {ocrItems.map((item, index) => (
                  <div className="ocr-review-item" key={`${item.testName}-${index}`}>
                    <input aria-label={`${index + 1}번째 검사항목`} value={item.testName} onChange={(event) => setOcrItems(updateExamItem(ocrItems, index, "testName", event.currentTarget.value))} />
                    <input aria-label={`${item.testName || index + 1} 결과값`} value={item.value} onChange={(event) => setOcrItems(updateExamItem(ocrItems, index, "value", event.currentTarget.value))} />
                    <input aria-label={`${item.testName || index + 1} 단위`} value={item.unit} onChange={(event) => setOcrItems(updateExamItem(ocrItems, index, "unit", event.currentTarget.value))} />
                    <input aria-label={`${item.testName || index + 1} 판정`} value={item.judgment} onChange={(event) => setOcrItems(updateExamItem(ocrItems, index, "judgment", event.currentTarget.value))} />
                  </div>
                ))}
              </div>
            ) : null}
            <label className="ocr-review-field">서류에서 확인한 내용<textarea rows={14} value={ocrText} onChange={(event) => setOcrText(event.currentTarget.value)} placeholder="서류에서 읽은 내용이 여기에 표시됩니다." /></label>
            <p className="field-help">서류 분석을 위해 선택한 파일이 AI 분석 서버로 전송됩니다. 저장 버튼을 누르기 전 원본과 결과를 꼭 확인해 주세요.</p>
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setOcrDocument(undefined)}>취소</button><button className="primary-button" type="button" disabled={working || !ocrExamDate || (!ocrText.trim() && ocrItems.length === 0)} onClick={() => void saveOcrResult()}>건강검진 기록으로 저장</button></div>
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

function todayValue(): string {
  return new Date().toISOString().slice(0, 10);
}

function updateExamItem(items: OcrExamItem[], index: number, key: keyof OcrExamItem, value: string): OcrExamItem[] {
  return items.map((item, itemIndex) => itemIndex === index ? { ...item, [key]: value } : item);
}

function extractExamDate(text: string): string | undefined {
  const match = text.match(/(?:검사일|검진일|판정일|수검일)[^0-9]{0,12}(20\d{2})[.\-/년\s]+(\d{1,2})[.\-/월\s]+(\d{1,2})/);
  if (!match) return undefined;
  const [, year, month, day] = match;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}
