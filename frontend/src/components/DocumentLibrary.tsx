import { useEffect, useMemo, useState, type FormEvent } from "react";
import { DocumentService } from "../local-domain/document-service";
import type { HealthDocumentView } from "../local-domain/types";

interface ProfileOption { id: string; name: string; relationship: string }
interface Props { householdId: string; profiles: ProfileOption[] }

export function DocumentLibrary({ householdId, profiles }: Props) {
  const service = useMemo(() => new DocumentService(), []);
  const [profileId, setProfileId] = useState(profiles[0]?.id ?? "");
  const [documents, setDocuments] = useState<HealthDocumentView[]>([]);
  const [preview, setPreview] = useState<{ id: string; url: string } | null>(null);
  const [error, setError] = useState(""); const [busy, setBusy] = useState(false);
  const load = async () => { const result = await service.list(profileId); if (result.ok) { setDocuments(result.value); setError(""); } else setError(result.error.message); };
  useEffect(() => { void load(); return () => { if (preview) URL.revokeObjectURL(preview.url); }; }, [profileId]);

  const register = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); const form = event.currentTarget; const data = new FormData(form); const file = data.get("file"); if (!(file instanceof File) || !file.size) return;
    setBusy(true); const result = await service.save({ householdId, profileId, file, capturedAt: data.get("capturedAt") ? new Date(`${data.get("capturedAt")}T12:00:00`).toISOString() : undefined }); setBusy(false);
    if (result.ok) { form.reset(); setError(""); await load(); } else setError(result.error.message);
  };
  const open = async (document: HealthDocumentView, forOcr = false) => { const result = await service.open(document.id); if (!result.ok) return setError(result.error.message); if (forOcr) { window.dispatchEvent(new CustomEvent("ieobom:ocr-file", { detail: { file: result.value, documentId: document.id, profileId, householdId } })); return; } if (preview) URL.revokeObjectURL(preview.url); setPreview({ id: document.id, url: URL.createObjectURL(result.value) }); };
  const remove = async (document: HealthDocumentView) => { if (!window.confirm(`'${document.originalName}' 서류를 삭제할까요?`)) return; const result = await service.remove(document.id); if (result.ok) { if (preview?.id === document.id) { URL.revokeObjectURL(preview.url); setPreview(null); } await load(); } else setError(result.error.message); };
  return <main className="page-shell document-page"><header className="history-header"><div><p className="eyebrow">로컬 원본 보관</p><h1>원본 건강 서류</h1><p>JPEG·PNG 서류를 이 브라우저에 암호화해 보관합니다.</p></div></header><section className="document-register"><form onSubmit={(event) => void register(event)}><label>기록 대상<select value={profileId} onChange={(event) => setProfileId(event.target.value)}>{profiles.map((profile) => <option key={profile.id} value={profile.id}>{profile.name} · {profile.relationship}</option>)}</select></label><label>검사·촬영일<input name="capturedAt" type="date" /></label><label className="full">원본 이미지<input name="file" type="file" accept="image/jpeg,image/png" required /></label><button className="primary" disabled={busy}>{busy ? "암호화 저장 중…" : "원본 서류 등록"}</button></form><div className="notice"><span>ⓘ</span><p><strong>서버로 저장하지 않아요.</strong>파일은 암호화되어 브라우저 OPFS에 보관되고, 파일명과 메타데이터도 IndexedDB에 암호화됩니다.</p></div></section>{error && <div className="form-error">{error}</div>}<div className="document-layout"><section className="document-list">{documents.length === 0 ? <div className="history-empty"><strong>등록된 원본 서류가 없어요.</strong></div> : documents.map((document) => <article key={document.id}><span className="document-thumb">▧</span><div><strong>{document.originalName}</strong><small>{(document.plaintextSize / 1024 / 1024).toFixed(1)}MB · {new Date(document.capturedAt || document.createdAt).toLocaleDateString("ko-KR")}</small></div><button onClick={() => void open(document)}>열람</button><button onClick={() => void open(document, true)}>서류 내용 읽기</button><button className="delete-link" onClick={() => void remove(document)}>삭제</button></article>)}</section><section className="document-preview">{preview ? <img src={preview.url} alt="선택한 건강 서류 미리보기" /> : <div className="detail-placeholder">서류를 열면 원본을 확인할 수 있어요.</div>}</section></div></main>;
}
