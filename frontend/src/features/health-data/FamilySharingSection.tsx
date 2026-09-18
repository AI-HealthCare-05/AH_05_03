import { useMemo, useState } from "react";

import { Modal } from "../../shared/ui/Modal";
import {
  INITIAL_SHARE_AUDIT_LOGS,
  INITIAL_SHARE_CATEGORIES,
  SHARE_MEMBERS,
  applySharePreset,
  toggleShareCategory,
  type ShareAuditLog,
  type ShareCategory,
  type ShareIcon,
  type ShareMember,
  type SharePreset,
} from "./familySharingPreview";

/** Lucide 24px 아웃라인. VitalPulse 원본과 같은 패스다. */
function ShareGlyph({ name }: { name: ShareIcon }) {
  const paths: Record<ShareIcon, React.ReactNode> = {
    heart: <path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5" fill="currentColor" fillOpacity="0.2" />,
    droplet: <path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z" fill="currentColor" fillOpacity="0.2" />,
    pill: (
      <>
        <path d="m10.5 20.5 10-10a4.95 4.95 0 1 0-7-7l-10 10a4.95 4.95 0 1 0 7 7Z" />
        <path d="m8.5 8.5 7 7" />
      </>
    ),
    body: (
      <>
        <path d="M19 21v-2a4 4 0 0 0-4-4H9a4 4 0 0 0-4 4v2" />
        <circle cx="12" cy="7" r="4" />
      </>
    ),
    file: (
      <>
        <path d="M15 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7Z" />
        <path d="M14 2v4a2 2 0 0 0 2 2h4" />
        <path d="M10 9H8" />
        <path d="M16 13H8" />
        <path d="M16 17H8" />
      </>
    ),
    moon: <path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" fill="currentColor" fillOpacity="0.2" />,
  };
  return (
    <svg className="hd3-share-glyph" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {paths[name]}
    </svg>
  );
}

function memberById(id: string): ShareMember | undefined {
  return SHARE_MEMBERS.find((member) => member.id === id);
}

function enabledCount(categories: ShareCategory[]) {
  return categories.filter((category) => category.isEnabled).length;
}

export function FamilySharingSection() {
  const [categories, setCategories] = useState<ShareCategory[]>(INITIAL_SHARE_CATEGORIES);
  const [auditLogs] = useState<ShareAuditLog[]>(INITIAL_SHARE_AUDIT_LOGS);
  const [scopeCategoryId, setScopeCategoryId] = useState<string>();
  const [scopeDraft, setScopeDraft] = useState<string[]>([]);
  const [auditOpen, setAuditOpen] = useState(false);
  const [revokeOpen, setRevokeOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState("");

  const sharedCount = enabledCount(categories);
  const privateCount = categories.length - sharedCount;
  const scopeCategory = categories.find((category) => category.id === scopeCategoryId);

  const previewLogs = useMemo(() => auditLogs.slice(0, 3), [auditLogs]);

  function openScope(category: ShareCategory) {
    setScopeCategoryId(category.id);
    setScopeDraft(category.allowedMemberIds);
  }

  function saveScope() {
    if (!scopeCategoryId) return;
    setCategories((prev) =>
      prev.map((category) => (category.id === scopeCategoryId ? { ...category, allowedMemberIds: scopeDraft } : category)),
    );
    setScopeCategoryId(undefined);
    setStatusMessage("열람 대상을 저장했습니다.");
  }

  function applyPreset(preset: SharePreset) {
    setCategories((prev) => applySharePreset(prev, preset));
    const labels = { senior: "시니어 안심 집중 모드를 적용했습니다.", transparent: "투명 가족 모드를 적용했습니다.", privacy: "프라이버시 강화 모드를 적용했습니다." };
    setStatusMessage(labels[preset]);
  }

  function revokeAll() {
    setCategories((prev) => applySharePreset(prev, "privacy"));
    setRevokeOpen(false);
    setStatusMessage("모든 건강 항목 공유를 중단했습니다.");
  }

  return (
    <section className="hd3-share" aria-labelledby="hd3-share-title">
      <header className="hd3-share-head">
        <div>
          <p className="hd3-kicker">FAMILY SHARING SCOPE</p>
          <h1 id="hd3-share-title">관리 중인 건강 항목 (총 {categories.length}개)</h1>
          <p className="hd3-title-desc">
            {sharedCount}개 공유 중 · {privateCount}개 비공개. 항목별로 열람 가족과 알림 규칙을 따로 둡니다.
          </p>
        </div>
        <p className="hd3-share-status" role="status">
          {statusMessage || "항목별 설정 · 가족 멤버별 보기 · 공유 승인 상태"}
        </p>
      </header>

      <div className="hd3-share-layout">
        <div className="hd3-share-list">
          {categories.map((category) => {
            const members = category.allowedMemberIds.map(memberById).filter((member): member is ShareMember => Boolean(member));
            return (
              <article key={category.id} className={`hd3-share-card${category.isEnabled ? "" : " is-private"}`}>
                <div className="hd3-share-card-top">
                  <span className={`hd3-share-icon hd3-share-icon-${category.iconName}`} aria-hidden="true">
                    <ShareGlyph name={category.iconName} />
                  </span>
                  <div className="hd3-share-card-copy">
                    <div className="hd3-share-card-title-row">
                      <h2>{category.title}</h2>
                      <span className={`hd3-share-badge hd3-share-badge-${category.badgeType}`}>{category.badgeText}</span>
                    </div>
                    <p>{category.description}</p>
                  </div>
                  <button
                    type="button"
                    className={`hd3-share-switch${category.isEnabled ? " is-on" : ""}`}
                    role="switch"
                    aria-checked={category.isEnabled}
                    aria-label={`${category.title} 공유`}
                    onClick={() => setCategories((prev) => toggleShareCategory(prev, category.id))}
                  >
                    <span />
                  </button>
                </div>

                <div className="hd3-share-card-foot">
                  {category.isEnabled ? (
                    <div className="hd3-share-members">
                      <span>열람 허용 가족:</span>
                      {members.length === 0 ? <em>대상을 지정하세요</em> : null}
                      {members.map((member) => (
                        <span key={member.id} className={`hd3-share-chip hd3-share-chip-${member.id}`}>
                          {member.relationship} {member.name}
                        </span>
                      ))}
                      <button type="button" className="hd3-share-text-btn" onClick={() => openScope(category)}>
                        {members.length ? "+ 대상 변경" : "+ 대상 지정"}
                      </button>
                    </div>
                  ) : (
                    <div className="hd3-share-members is-locked">
                      <span>나만 보기(비공개 암호화 보관)</span>
                    </div>
                  )}
                  <p className="hd3-share-rule">{category.ruleDescription}</p>
                </div>
              </article>
            );
          })}
        </div>

        <aside className="hd3-share-rail" aria-label="공유 프리셋과 감사 이력">
          <section className="hd3-share-panel">
            <div className="hd3-share-panel-head">
              <h2>공유 프리셋 퀵 적용</h2>
            </div>
            <button type="button" className="hd3-share-preset" aria-label="시니어 안심 집중 모드" onClick={() => applyPreset("senior")}>
              <strong>시니어 안심 집중 모드</strong>
              <span>부모님 케어에 필수적인 혈압, 복약, 긴급 혈당 항목만 가족에게 자동 개방</span>
            </button>
            <button type="button" className="hd3-share-preset" aria-label="투명 가족 모드" onClick={() => applyPreset("transparent")}>
              <strong>투명 가족 모드</strong>
              <span>통증/심리 다이어리를 제외한 모든 검진 및 바이탈을 등록 가족과 상호 열람</span>
            </button>
            <button type="button" className="hd3-share-preset" aria-label="프라이버시 강화 모드" onClick={() => applyPreset("privacy")}>
              <strong>프라이버시 강화 모드</strong>
              <span>응급 SOS 및 치명적 위기 알림을 제외한 모든 항목을 100% 비공개 격리</span>
            </button>
          </section>

          <section className="hd3-share-panel">
            <div className="hd3-share-panel-head">
              <h2>최근 보안 감사 이력</h2>
              <span className="hd3-share-live" aria-hidden="true" />
            </div>
            <ul className="hd3-share-audit">
              {previewLogs.map((log) => (
                <li key={log.id} className={`hd3-share-audit-item hd3-share-audit-${log.actionType}`}>
                  <span className="hd3-share-audit-mark">{log.initial ?? "보"}</span>
                  <div>
                    <strong>{log.title}</strong>
                    <p>{log.detail}</p>
                  </div>
                  <time>{log.timeLabel}</time>
                </li>
              ))}
            </ul>
            <button type="button" className="hd3-share-audit-all" onClick={() => setAuditOpen(true)}>
              전체 감사 로그 {auditLogs.length}건 확인하기
            </button>
          </section>

          <section className="hd3-share-panel hd3-share-revoke">
            <h2>공유 권한 즉시 철회</h2>
            <p>가족 불화, 스마트폰 분실 또는 개인적인 사유 발생 시 클릭 한 번으로 모든 가족 대상 공유를 중단하고 비공개로 즉시 전환할 수 있습니다.</p>
            <button type="button" className="hd3-share-revoke-btn" onClick={() => setRevokeOpen(true)}>
              모든 건강 항목 공유 즉시 일괄 중단
            </button>
          </section>
        </aside>
      </div>

      {scopeCategory ? (
        <Modal kicker="항목별 열람 대상" title={scopeCategory.title} onClose={() => setScopeCategoryId(undefined)}>
          <p className="hd3-share-modal-lead">이 항목을 열람할 가족을 선택합니다. 공유 스위치가 켜져 있어도 대상이 없으면 가족에게 보이지 않습니다.</p>
          <ul className="hd3-share-scope-list">
            {SHARE_MEMBERS.map((member) => {
              const checked = scopeDraft.includes(member.id);
              return (
                <li key={member.id}>
                  <label className="hd3-share-scope-row">
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() =>
                        setScopeDraft((prev) => (checked ? prev.filter((id) => id !== member.id) : [...prev, member.id]))
                      }
                    />
                    <span className={`hd3-share-chip hd3-share-chip-${member.id}`}>
                      {member.relationship} {member.name}
                    </span>
                  </label>
                </li>
              );
            })}
          </ul>
          <div className="hd3-share-modal-actions">
            <button type="button" className="hd3-share-text-btn" onClick={() => setScopeCategoryId(undefined)}>
              취소
            </button>
            <button type="button" className="hd3-refresh-btn" onClick={saveScope}>
              대상 저장
            </button>
          </div>
        </Modal>
      ) : null}

      {auditOpen ? (
        <Modal kicker="보안 감사" title="전체 감사 로그" onClose={() => setAuditOpen(false)}>
          <ul className="hd3-share-audit hd3-share-audit-full">
            {auditLogs.map((log) => (
              <li key={log.id} className={`hd3-share-audit-item hd3-share-audit-${log.actionType}`}>
                <span className="hd3-share-audit-mark">{log.initial ?? "보"}</span>
                <div>
                  <strong>{log.title}</strong>
                  <p>{log.detail}</p>
                </div>
                <time>{log.timeLabel}</time>
              </li>
            ))}
          </ul>
        </Modal>
      ) : null}

      {revokeOpen ? (
        <Modal kicker="즉시 철회" title="모든 공유를 중단할까요?" onClose={() => setRevokeOpen(false)}>
          <p className="hd3-share-modal-lead">모든 건강 항목이 비공개로 바뀌고 열람 대상이 비워집니다. 프리셋으로 다시 열 수 있습니다.</p>
          <div className="hd3-share-modal-actions">
            <button type="button" className="hd3-share-text-btn" onClick={() => setRevokeOpen(false)}>
              유지
            </button>
            <button type="button" className="hd3-share-revoke-btn" onClick={revokeAll}>
              공유 중단
            </button>
          </div>
        </Modal>
      ) : null}
    </section>
  );
}
