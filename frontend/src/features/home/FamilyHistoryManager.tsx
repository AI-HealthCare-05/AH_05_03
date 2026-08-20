import { type FormEvent, useCallback, useEffect, useState } from "react";

import type { FamilyHistory, FamilyProfile } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";

export function FamilyHistoryManager({
  runtime,
  profile,
  onClose,
}: {
  runtime: LocalDomainRuntime;
  profile: FamilyProfile;
  onClose: () => void;
}) {
  const [items, setItems] = useState<FamilyHistory[]>([]);
  const [editing, setEditing] = useState<FamilyHistory | "new">();
  const [deleting, setDeleting] = useState<FamilyHistory>();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState<string>();

  const refresh = useCallback(async () => {
    const result = await runtime.familyHistories.list(profile.id);
    if (!result.ok) throw new Error(result.error.message);
    setItems(result.value);
  }, [profile.id, runtime]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void refresh().catch((caught: unknown) => setError(messageFrom(caught, "가족력을 불러오지 못했습니다.")));
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refresh]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input = {
      relativeRelationship: String(form.get("relativeRelationship") ?? ""),
      conditionName: String(form.get("conditionName") ?? ""),
      onsetAge: optionalNumber(form.get("onsetAge")),
      note: optionalText(form.get("note")),
    };
    setWorking(true);
    setError(undefined);
    try {
      const result = editing === "new"
        ? await runtime.familyHistories.create({
            householdId: profile.householdId,
            profileId: profile.id,
            ...input,
          })
        : await runtime.familyHistories.update(editing!.id, {
            ...input,
            expectedVersion: editing!.version,
          });
      if (!result.ok) throw new Error(result.error.message);
      await refresh();
      setEditing(undefined);
    } catch (caught) {
      setError(messageFrom(caught, "가족력을 저장하지 못했습니다."));
    } finally {
      setWorking(false);
    }
  }

  async function confirmDelete() {
    if (!deleting) return;
    setWorking(true);
    setError(undefined);
    try {
      const result = await runtime.familyHistories.delete(deleting.id);
      if (!result.ok) throw new Error(result.error.message);
      await refresh();
      setDeleting(undefined);
    } catch (caught) {
      setError(messageFrom(caught, "가족력을 삭제하지 못했습니다."));
    } finally {
      setWorking(false);
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modal-panel family-history-modal" role="dialog" aria-modal="true" aria-labelledby="family-history-title">
        <div className="modal-heading">
          <div><p className="section-kicker">구성원별 로컬 정보</p><h2 id="family-history-title">{profile.displayName}님의 가족력</h2></div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">×</button>
        </div>

        <p className="form-notice family-history-notice">가족력과 유전 관련 메모는 이 브라우저에만 암호화해 저장됩니다.</p>
        {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

        {editing ? (
          <form className="product-form" onSubmit={submit}>
            <label>친족 관계<input name="relativeRelationship" required defaultValue={editing === "new" ? "" : editing.relativeRelationship} placeholder="예: 외할머니" autoFocus /></label>
            <label>질환명<input name="conditionName" required defaultValue={editing === "new" ? "" : editing.conditionName} placeholder="예: 고혈압" /></label>
            <label>발병 연령 <span className="optional-label">선택</span><input name="onsetAge" type="number" min={0} max={130} defaultValue={editing === "new" ? "" : editing.onsetAge ?? ""} /></label>
            <label>메모 <span className="optional-label">선택</span><textarea name="note" rows={4} defaultValue={editing === "new" ? "" : editing.note ?? ""} /></label>
            <div className="form-actions">
              <button className="secondary-button" type="button" onClick={() => setEditing(undefined)}>취소</button>
              <button className="primary-button" type="submit" disabled={working}>{working ? "저장 중…" : editing === "new" ? "가족력 추가" : "변경사항 저장"}</button>
            </div>
          </form>
        ) : (
          <>
            <div className="family-history-toolbar">
              <span>{items.length}개 기록</span>
              <button className="primary-button" type="button" onClick={() => setEditing("new")}>가족력 추가</button>
            </div>
            {items.length === 0 ? (
              <div className="compact-empty"><strong>등록된 가족력이 없습니다.</strong><p>필요한 경우에만 구성원별로 기록하세요.</p></div>
            ) : (
              <div className="family-history-list">
                {items.map((item) => (
                  <article key={item.id}>
                    <div><strong>{item.conditionName}</strong><p>{item.relativeRelationship}{item.onsetAge !== null ? ` · ${item.onsetAge}세 발병` : ""}</p>{item.note ? <small>{item.note}</small> : null}</div>
                    <div className="record-row-actions">
                      <button type="button" onClick={() => setEditing(item)}>수정</button>
                      <button type="button" onClick={() => setDeleting(item)}>삭제</button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </>
        )}

        {deleting ? (
          <div className="inline-confirmation" role="alertdialog" aria-label="가족력 삭제 확인">
            <p><strong>{deleting.conditionName}</strong> 가족력 기록을 삭제할까요?</p>
            <div className="form-actions"><button className="secondary-button" type="button" onClick={() => setDeleting(undefined)}>취소</button><button className="danger-button" type="button" disabled={working} onClick={() => void confirmDelete()}>삭제</button></div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function optionalNumber(value: FormDataEntryValue | null): number | undefined {
  const text = String(value ?? "");
  return text ? Number(text) : undefined;
}

function optionalText(value: FormDataEntryValue | null): string | undefined {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
