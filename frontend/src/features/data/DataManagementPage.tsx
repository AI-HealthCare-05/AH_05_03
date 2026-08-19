import { type ChangeEvent, useMemo, useState } from "react";

import { useLocalDomain } from "../../app/localDomainContext";
import { detectLocalCapabilities } from "../../shared/local/capabilities";
import type { BackupPreview } from "../../shared/local/localBackupService";

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
    </div>
  );
}

function errorMessage(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
