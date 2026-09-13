import { Suspense, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { LocalDomainContext } from "../../app/localDomainContext";
import type { FamilyProfile } from "../../shared/local/domainContracts";
import { ChatLoadingSkeleton } from "../../shared/ui/Skeleton";
import { HealthAssistantDrawer } from "./HealthAssistantDrawer";
import bomiChickIcon from "./assets/bomi-chick.png";
import "./globalHealthAssistant.css";

const ASSISTANT_STORAGE_KEY = "ieobom:global-assistant-open";
const PROFILE_STORAGE_KEY = "ieobom:selected-profile-id";

// 말풍선 툴팁은 처음 뜬 뒤 이 주기(3분)마다 다른 말을 걸며 다시 나타난다.
const TOOLTIP_REPEAT_MS = 3 * 60 * 1000;
const TOOLTIP_VISIBLE_MS = 8000;

const TOOLTIP_MESSAGES = [
  "봄이에게 무엇이든 물어보세요!",
  "오늘 혈압 재셨다면 숫자만 알려주세요.",
  "복약하셨다면 편하게 말씀해 주세요, 기록해 둘게요.",
  "운동한 종류랑 횟수만 툭 던져주셔도 돼요.",
  "검진표나 서류 사진 있으면 올려보세요.",
  "궁금한 증상이 있으면 언제든 물어보세요.",
];

// 페이지 맥락별로, 그 화면에서 실제로 할 수 있는 일을 짧게 안내하는 말.
// 각 화면의 실제 버튼·기능(구성원 추가, 검진표 인식, 3D 모델 통증 표시 등)에 맞춰 둔다.
const CONTEXT_TOOLTIP_MESSAGES: Record<string, string[]> = {
  "가족 홈": [
    "새 가족 구성원을 추가하거나 프로필을 눌러 전환해보세요.",
    "건강기록 작성으로 직접 입력하거나 검진표를 올려보세요.",
  ],
  "통증 다이어리": [
    "오늘 통증 부위와 강도를 기록해보세요.",
    "3D 모델에서 부위를 짚어 표시할 수도 있어요.",
  ],
  "질환 예측": [
    "검진표 사진을 올리면 수치를 자동으로 읽어 채워드려요.",
    "판정하기를 누르면 질환별 예측 결과를 볼 수 있어요.",
  ],
  "건강 데이터": [
    "기간을 골라 체중·혈압·혈당 변화 그래프를 확인해보세요.",
    "지난 검진 이력에서 원본을 보거나 수치를 고쳐 다시 판정할 수 있어요.",
  ],
  "계정 관리": [
    "가족을 이메일로 초대하거나 구독 플랜을 확인해보세요.",
    "건강기록 백업 파일을 내려받을 수 있어요.",
  ],
};

// 3분 주기의 심심풀이 말걸기: 페이지 맥락 + 일반 안내를 섞어 다양하게 고른다.
function pickTooltipMessage(prevMessage: string, contextLabel: string | undefined): string {
  const pool = contextLabel && CONTEXT_TOOLTIP_MESSAGES[contextLabel]
    ? [...TOOLTIP_MESSAGES, ...CONTEXT_TOOLTIP_MESSAGES[contextLabel]]
    : TOOLTIP_MESSAGES;
  const candidates = pool.filter((message) => message !== prevMessage);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
}

// 페이지 도착 직후 말걸기: "여기서 뭘 할 수 있는지" 를 우선 알려준다 — 이 화면
// 전용 안내가 있으면 그 안에서만 고르고, 없는 화면(예: 개발용 라우트)에서는
// 일반 안내로 대신한다.
function pickContextArrivalMessage(prevMessage: string, contextLabel: string | undefined): string {
  const contextPool = contextLabel ? CONTEXT_TOOLTIP_MESSAGES[contextLabel] : undefined;
  const pool = contextPool && contextPool.length > 0 ? contextPool : TOOLTIP_MESSAGES;
  const candidates = pool.filter((message) => message !== prevMessage);
  return candidates[Math.floor(Math.random() * candidates.length)] ?? pool[0];
}

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
  const [tooltipMessage, setTooltipMessage] = useState(TOOLTIP_MESSAGES[0]);

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
      }, TOOLTIP_VISIBLE_MS);
      return () => clearTimeout(timer);
    }
  }, [isOpen, showTooltip]);

  // 현재 페이지 맥락 태그
  const contextLabel = useMemo(() => {
    const p = location.pathname;
    if (p === "/") return "가족 홈";
    if (p.startsWith("/pain-diary")) return "통증 다이어리";
    if (p.startsWith("/assessment")) return "질환 예측";
    if (p.startsWith("/health-data")) return "건강 데이터";
    if (p.startsWith("/account")) return "계정 관리";
    return undefined;
  }, [location.pathname]);

  // 대화창이 닫혀 있는 동안 3분마다 다른 말을 걸며 다시 말풍선을 띄운다.
  const isOpenRef = useRef(isOpen);
  useEffect(() => {
    isOpenRef.current = isOpen;
  }, [isOpen]);

  const contextLabelRef = useRef(contextLabel);
  useEffect(() => {
    contextLabelRef.current = contextLabel;
  }, [contextLabel]);

  // 페이지(맥락)가 바뀔 때마다 이 화면에서 할 수 있는 일을 짧게 알려준다.
  // 주 메뉴·챗봇이 직접 부르는 `navigate()` 모두 `contextLabel` 을 바꾸므로, 이동
  // 방식(SPA 전환이든 첫 진입이든)과 무관하게 같은 효과 하나로 안내된다.
  useEffect(() => {
    if (isOpenRef.current) return;
    setTooltipMessage((prev) => pickContextArrivalMessage(prev, contextLabel));
    setShowTooltip(true);
  }, [contextLabel]);

  useEffect(() => {
    const interval = setInterval(() => {
      if (isOpenRef.current) return;
      setTooltipMessage((prev) => pickTooltipMessage(prev, contextLabelRef.current));
      setShowTooltip(true);
    }, TOOLTIP_REPEAT_MS);
    return () => clearInterval(interval);
  }, []);

  if (!runtime || !activeProfile) {
    return null;
  }

  return (
    <>
      {/* 1. 채널톡 스타일 우측 하단 상시 플로팅 런처 버튼 */}
      <div className="channel-talk-launcher">
        {showTooltip && !isOpen && (
          <div className="channel-talk-tooltip" role="status">
            <span>{tooltipMessage}</span>
          </div>
        )}
        <button
          type="button"
          className={`channel-talk-launcher-btn ${isOpen ? "is-open" : ""}`}
          onClick={handleToggle}
          aria-label={isOpen ? "건강 비서 닫기" : "건강 비서 봄이와 대화하기"}
          title={isOpen ? "닫기" : "봄이 · 건강 비서"}
        >
          {/* 봄이 마스코트 아이콘 */}
          <img src={bomiChickIcon} alt="" className="icon-chat icon-chat-mascot" aria-hidden="true" />

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
                // 동일 탭 및 다른 탭 간 실시간 데이터 갱신 이벤트 발생
                window.dispatchEvent(new CustomEvent("ieobom:record-saved", { detail: { profileId: activeProfile.id } }));
                try {
                  const channel = new BroadcastChannel("ieobom-sync");
                  channel.postMessage({ type: "record-saved", profileId: activeProfile.id });
                  channel.close();
                } catch {
                  // BroadcastChannel 미지원 환경 무시
                }
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
