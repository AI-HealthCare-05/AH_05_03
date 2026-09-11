import { Suspense, useContext, useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { LocalDomainContext } from "../../app/localDomainContext";
import type { FamilyProfile } from "../../shared/local/domainContracts";
import { ChatLoadingSkeleton } from "../../shared/ui/Skeleton";
import { HealthAssistantDrawer } from "./HealthAssistantDrawer";
import "./globalHealthAssistant.css";

const ASSISTANT_STORAGE_KEY = "ieobom:global-assistant-open";
const PROFILE_STORAGE_KEY = "ieobom:selected-profile-id";

export function GlobalHealthAssistant() {
  const localDomain = useContext(LocalDomainContext);
  const profiles = useMemo(() => localDomain?.profiles ?? [], [localDomain?.profiles]);
  const runtime = localDomain?.runtime;
  const location = useLocation();
  const navigate = useNavigate();

  // 열림/닫힘 상태를 localStorage에 보존하여 페이지를 이동해도 대화창이 닫히지 않고 유지된다.
  const [isOpen, setIsOpen] = useState<boolean>(() => {
    try {
      return localStorage.getItem(ASSISTANT_STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  const [hasUnread, setHasUnread] = useState(true);
  const [showTooltip, setShowTooltip] = useState(true);

  // 현재 선택된 프로필 (가족 홈이나 다른 화면과 동기화)
  const [selectedProfileId, setSelectedProfileId] = useState<string | null>(() => {
    try {
      return localStorage.getItem(PROFILE_STORAGE_KEY);
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const handleProfileChange = (e: Event) => {
      const customEvent = e as CustomEvent<{ profileId: string }>;
      if (customEvent.detail?.profileId) {
        setSelectedProfileId(customEvent.detail.profileId);
      }
    };
    const handleOpenAssistant = () => {
      setIsOpen(true);
      setHasUnread(false);
      setShowTooltip(false);
    };
    window.addEventListener("ieobom:profile-changed", handleProfileChange);
    window.addEventListener("ieobom:open-assistant", handleOpenAssistant);
    return () => {
      window.removeEventListener("ieobom:profile-changed", handleProfileChange);
      window.removeEventListener("ieobom:open-assistant", handleOpenAssistant);
    };
  }, []);

  const activeProfile: FamilyProfile | undefined = useMemo(() => {
    if (profiles.length === 0) return undefined;
    if (selectedProfileId) {
      const found = profiles.find((p) => p.id === selectedProfileId);
      if (found) return found;
    }
    return profiles[0];
  }, [profiles, selectedProfileId]);

  const handleToggle = () => {
    setIsOpen((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(ASSISTANT_STORAGE_KEY, String(next));
      } catch {
        // ignore
      }
      if (next) {
        setHasUnread(false);
        setShowTooltip(false);
      }
      return next;
    });
  };

  const handleClose = () => {
    setIsOpen(false);
    try {
      localStorage.setItem(ASSISTANT_STORAGE_KEY, "false");
    } catch {
      // ignore
    }
  };

  // 툴팁은 8초 후 자연스럽게 숨김
  useEffect(() => {
    if (!isOpen && showTooltip) {
      const timer = setTimeout(() => {
        setShowTooltip(false);
      }, 8000);
      return () => clearTimeout(timer);
    }
  }, [isOpen, showTooltip]);

  // 현재 페이지 맥락 태그
  const contextLabel = useMemo(() => {
    const p = location.pathname;
    if (p === "/") return "가족 홈";
    if (p.startsWith("/pain-diary")) return "통증 다이어리";
    if (p.startsWith("/assessment")) return "위험 판정";
    if (p.startsWith("/health-data")) return "건강 데이터";
    if (p.startsWith("/account")) return "계정 관리";
    return undefined;
  }, [location.pathname]);

  if (!runtime || !activeProfile) {
    return null;
  }

  return (
    <>
      {/* 1. 채널톡 스타일 우측 하단 상시 플로팅 런처 버튼 */}
      <div className="channel-talk-launcher">
        {showTooltip && !isOpen && (
          <div className="channel-talk-tooltip" role="status">
            <span>봄이에게 무엇이든 물어보세요!</span>
          </div>
        )}
        <button
          type="button"
          className={`channel-talk-launcher-btn ${isOpen ? "is-open" : ""}`}
          onClick={handleToggle}
          aria-label={isOpen ? "건강 비서 닫기" : "건강 비서 봄이와 대화하기"}
          title={isOpen ? "닫기" : "봄이 · 건강 비서"}
        >
          {/* 봄이 챗 버블 아이콘 */}
          <svg
            className="icon-chat"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 0 1-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            <circle cx="8.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="12" cy="12" r="1.1" fill="currentColor" stroke="none" />
            <circle cx="15.5" cy="12" r="1.1" fill="currentColor" stroke="none" />
          </svg>

          {/* 닫기 X 아이콘 */}
          <svg
            className="icon-close"
            width="28"
            height="28"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>

          {/* 알림 레드 닷 뱃지 (닫혀 있고 읽지 않은 상태일 때) */}
          {!isOpen && hasUnread && <span className="channel-talk-badge" aria-hidden="true" />}
        </button>
      </div>

      {/* 2. 채널톡 스타일 플로팅 메신저 팝오버 창 */}
      {isOpen && (
        <aside
          className="channel-talk-popover"
          role="dialog"
          aria-label="봄이 건강 비서"
          aria-modal="false"
        >
          {/* 컨텍스트 바 */}
          <div className="channel-talk-context-bar">
            <span>
              <strong>{activeProfile.displayName}</strong>님 대화 중
            </span>
            {contextLabel && (
              <span className="channel-talk-context-tag">
                <span style={{ fontSize: "0.7rem" }}>●</span> {contextLabel} 연동
              </span>
            )}
          </div>

          {/* 챗봇 메신저 본체 */}
          <Suspense fallback={<ChatLoadingSkeleton />}>
            <HealthAssistantDrawer
              key={activeProfile.id}
              profile={activeProfile}
              runtime={runtime}
              isOpen={isOpen}
              variant="popover"
              contextLabel={contextLabel}
              onClose={handleClose}
              onMinimize={handleClose}
              onRecordSaved={() => {
                // 저장 시 필요하면 데이터 갱신 이벤트 발생
                window.dispatchEvent(new CustomEvent("ieobom:record-saved", { detail: { profileId: activeProfile.id } }));
              }}
              onNavigateToRecords={() => navigate("/health-data")}
              onNavigateToDiary={(dateKey) => navigate(`/pain-diary?date=${dateKey}`)}
            />
          </Suspense>
        </aside>
      )}
    </>
  );
}
