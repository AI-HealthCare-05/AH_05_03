import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ADULT_TEETH,
  DentalQuadrant,
  ToothDefinition,
  getTeethByQuadrant,
} from "./dentalPickerLogic";

export interface DentalPickerModalProps {
  isOpen: boolean;
  selectedFdi?: number;
  selectedFdis?: ReadonlySet<number> | number[];
  onClose: () => void;
  onSelectTooth: (tooth: ToothDefinition, shouldSelect?: boolean) => void;
  mode?: "floating" | "embedded";
  onMinimize?: () => void;
  onPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerMove?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerUp?: (e: React.PointerEvent<HTMLDivElement>) => void;
  onPointerCancel?: (e: React.PointerEvent<HTMLDivElement>) => void;
}

export function DentalPickerModal({
  isOpen,
  selectedFdi,
  selectedFdis,
  onClose,
  onSelectTooth,
  mode = "floating",
  onMinimize,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
}: DentalPickerModalProps) {
  // 다중 선택 상태 (Set)
  const [internalSelectedFdis, setInternalSelectedFdis] = useState<Set<number>>(() => {
    const init = new Set<number>();
    if (selectedFdi) init.add(selectedFdi);
    if (selectedFdis) {
      for (const f of selectedFdis) init.add(f);
    }
    return init;
  });

  // 최근 상호작용한 치아 (상세 정보 카드용)
  const [lastInteractedTooth, setLastInteractedTooth] = useState<ToothDefinition | undefined>(() => {
    if (selectedFdi) return ADULT_TEETH.find((t) => t.fdiNumber === selectedFdi);
    if (selectedFdis) {
      const arr = Array.from(selectedFdis);
      if (arr.length > 0) return ADULT_TEETH.find((t) => t.fdiNumber === arr[arr.length - 1]);
    }
    return undefined;
  });

  const [position, setPosition] = useState<{ x: number; y: number }>({ x: 40, y: 90 });
  const [isDraggingHeader, setIsDraggingHeader] = useState(false);
  const dragHeaderRef = useRef<{ startX: number; startY: number; posX: number; posY: number } | null>(null);

  // 드래그 연속 다중 선택 (드르륵 선택) 제어
  const isDragSelectingRef = useRef(false);
  const dragTargetModeRef = useRef<boolean>(true); // true: 선택 모드, false: 해제 모드
  const lastProcessedFdiRef = useRef<number | null>(null);

  // 외부 props 동기화
  useEffect(() => {
    if (selectedFdis) {
      setInternalSelectedFdis(new Set(selectedFdis));
    } else if (selectedFdi !== undefined) {
      setInternalSelectedFdis(new Set([selectedFdi]));
    }
  }, [selectedFdi, selectedFdis]);

  // 전역 포인터 해제 리스너 (드래그 종료)
  useEffect(() => {
    const handleGlobalPointerUp = () => {
      isDragSelectingRef.current = false;
      lastProcessedFdiRef.current = null;
    };
    window.addEventListener("pointerup", handleGlobalPointerUp);
    window.addEventListener("pointercancel", handleGlobalPointerUp);
    return () => {
      window.removeEventListener("pointerup", handleGlobalPointerUp);
      window.removeEventListener("pointercancel", handleGlobalPointerUp);
    };
  }, []);

  useEffect(() => {
    if (typeof window !== "undefined" && isOpen && mode === "floating") {
      const initialX = Math.max(16, Math.min(window.innerWidth - 650, Math.round(window.innerWidth * 0.16)));
      const initialY = Math.max(60, Math.round(window.innerHeight * 0.10));
      setPosition({ x: initialX, y: initialY });
    }
  }, [isOpen, mode]);

  if (!isOpen) return null;

  // 치아 토글 및 실시간 동기화
  const handleToggleTooth = (tooth: ToothDefinition, forceState?: boolean) => {
    setLastInteractedTooth(tooth);
    setInternalSelectedFdis((prev) => {
      const next = new Set(prev);
      const willSelect = forceState !== undefined ? forceState : !next.has(tooth.fdiNumber);
      if (willSelect) {
        next.add(tooth.fdiNumber);
      } else {
        next.delete(tooth.fdiNumber);
      }
      onSelectTooth(tooth, willSelect);
      return next;
    });
  };

  const startDragSelect = (tooth: ToothDefinition) => {
    isDragSelectingRef.current = true;
    lastProcessedFdiRef.current = tooth.fdiNumber;
    const currentState = internalSelectedFdis.has(tooth.fdiNumber);
    const targetState = !currentState;
    dragTargetModeRef.current = targetState;
    handleToggleTooth(tooth, targetState);
  };

  const continueDragSelect = (tooth: ToothDefinition) => {
    if (!isDragSelectingRef.current) return;
    if (lastProcessedFdiRef.current === tooth.fdiNumber) return;
    lastProcessedFdiRef.current = tooth.fdiNumber;
    handleToggleTooth(tooth, dragTargetModeRef.current);
  };

  // 터치/마우스 이동 중 지나가는 치아 요소 감지 (연속 드래그 선택)
  const handleArchPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragSelectingRef.current) return;
    const el = document.elementFromPoint(e.clientX, e.clientY);
    const toothBtn = el?.closest<HTMLButtonElement>("[data-tooth-fdi]");
    if (toothBtn) {
      const fdi = Number(toothBtn.dataset.toothFdi);
      const tooth = ADULT_TEETH.find((t) => t.fdiNumber === fdi);
      if (tooth) {
        continueDragSelect(tooth);
      }
    }
  };

  const handleHeaderPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
    dragHeaderRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      posX: position.x,
      posY: position.y,
    };
    setIsDraggingHeader(true);
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };

  const handleHeaderPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragHeaderRef.current || !isDraggingHeader) return;
    const dx = e.clientX - dragHeaderRef.current.startX;
    const dy = e.clientY - dragHeaderRef.current.startY;
    const newX = Math.max(10, Math.min(window.innerWidth - 320, dragHeaderRef.current.posX + dx));
    const newY = Math.max(10, Math.min(window.innerHeight - 80, dragHeaderRef.current.posY + dy));
    setPosition({ x: newX, y: newY });
  };

  const handleHeaderPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDraggingHeader) {
      setIsDraggingHeader(false);
      dragHeaderRef.current = null;
      try {
        (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
    }
  };

  const renderQuadrantRow = (quadrant: DentalQuadrant, reverse = false) => {
    const teeth = getTeethByQuadrant(quadrant);
    const ordered = reverse ? [...teeth].reverse() : teeth;

    return (
      <div className={`dental-quadrant-row ${mode === "embedded" ? "is-embedded" : ""}`}>
        {ordered.map((tooth) => {
          const isSelected = internalSelectedFdis.has(tooth.fdiNumber);
          const isWisdom = tooth.type === "wisdom";
          return (
            <button
              key={tooth.fdiNumber}
              type="button"
              data-tooth-fdi={tooth.fdiNumber}
              className={`dental-tooth-button ${isSelected ? "is-selected" : ""} ${isWisdom ? "is-wisdom" : ""} ${mode === "embedded" ? "is-embedded" : ""}`}
              onPointerDown={(e) => {
                if (e.button !== 0) return;
                e.preventDefault();
                startDragSelect(tooth);
              }}
              onPointerEnter={() => {
                continueDragSelect(tooth);
              }}
              onClick={(e) => {
                if (e.detail === 0) {
                  handleToggleTooth(tooth);
                }
              }}
              title={`${tooth.shortCode} - ${tooth.koreanName} (${tooth.commonName}) · 클릭 또는 드래그하여 선택/해제`}
            >
              <span className="tooth-code">{tooth.shortCode}</span>
              <span className="tooth-icon">
                {tooth.type === "molar" || tooth.type === "wisdom"
                  ? "🦷"
                  : tooth.type === "canine"
                    ? "🔺"
                    : "◻️"}
              </span>
            </button>
          );
        })}
      </div>
    );
  };

  const totalSelectedCount = internalSelectedFdis.size;

  if (mode === "embedded") {
    return (
      <div className="dental-picker-panel" onClick={(e) => e.stopPropagation()}>
        <div
          className="dental-embedded-header-row"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerCancel}
          title="드래그하여 위치 변경"
        >
          <div className="dental-header-title-wrap">
            <span
              className="sidebar-card-drag-grip"
              aria-hidden="true"
              title="드래그하여 위치 변경"
            >
              ⠿
            </span>
            <div>
              <p className="section-kicker">치아 전용 선택기</p>
              <h2>FDI 32개 영구치 치열도</h2>
            </div>
          </div>
          <div className="dental-header-actions">
            {onMinimize ? (
              <button
                type="button"
                className="dental-minimize-btn"
                onClick={onMinimize}
                aria-label="치아 선택기 최소화"
                title="치아 선택기 최소화"
              >
                −
              </button>
            ) : null}
            <button
              type="button"
              className="dental-close-btn"
              onClick={onClose}
              aria-label="치아 선택기 닫기"
              title="치아 선택기 닫기"
            >
              ✕
            </button>
          </div>
        </div>

        <div
          className="dental-arch-container is-embedded"
          onPointerMove={handleArchPointerMove}
        >
          {/* 상악 (위턱) */}
          <div className="dental-arch-section">
            <div className="dental-arch-label">
              <span>상악 (위턱)</span>
              <small>우측(10번대) ↔ 좌측(20번대)</small>
            </div>
            <div className="dental-arch-grid is-embedded">
              {renderQuadrantRow("upper-right", false)}
              <div className="dental-midline-divider" title="정중선 (Midline)" />
              {renderQuadrantRow("upper-left", false)}
            </div>
          </div>

          <div className="dental-occlusal-plane" />

          {/* 하악 (아래턱) */}
          <div className="dental-arch-section">
            <div className="dental-arch-label">
              <span>하악 (아래턱)</span>
              <small>우측(40번대) ↔ 좌측(30번대)</small>
            </div>
            <div className="dental-arch-grid is-embedded">
              {renderQuadrantRow("lower-right", false)}
              <div className="dental-midline-divider" title="정중선 (Midline)" />
              {renderQuadrantRow("lower-left", false)}
            </div>
          </div>
        </div>

        {/* 선택된 치아 실시간 상태 정보 */}
        {lastInteractedTooth ? (
          <div className="dental-selected-detail is-embedded">
            <div className="dental-detail-badge">
              <strong>{lastInteractedTooth.shortCode}</strong> {lastInteractedTooth.koreanName}
              {totalSelectedCount > 1 ? ` (총 ${totalSelectedCount}개 선택)` : ""}
            </div>
            <p className="dental-detail-desc">
              일상 표기: <strong>{lastInteractedTooth.commonName}</strong> ({lastInteractedTooth.quadrant === "upper-right" || lastInteractedTooth.quadrant === "lower-right" ? "오른쪽" : "왼쪽"}) · 클릭 또는 드래그하여 즉시 토글
            </p>
          </div>
        ) : (
          <div className="dental-selected-empty is-embedded">
            <p>치열도에서 치아를 클릭하거나 드래그하여 선택하세요 (화면에 즉시 반영됩니다).</p>
          </div>
        )}

        <div className="dental-embedded-footer">
          <span className="dental-status-summary">
            {totalSelectedCount > 0
              ? `선택된 치아: ${totalSelectedCount}개 (화면 및 확정 부위 실시간 동기화)`
              : "치아를 클릭하거나 드래그하여 선택하세요"}
          </span>
        </div>
      </div>
    );
  }

  const content = (
    <div
      className="dental-floating-container"
      role="dialog"
      aria-modal="false"
      aria-label="치열도 치아 선택기"
    >
      <div
        className={`dental-modal-card is-floating ${isDraggingHeader ? "is-dragging" : ""}`}
        style={{
          transform: `translate3d(${position.x}px, ${position.y}px, 0)`,
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div
          className="dental-modal-header is-draggable"
          onPointerDown={handleHeaderPointerDown}
          onPointerMove={handleHeaderPointerMove}
          onPointerUp={handleHeaderPointerUp}
          onPointerCancel={handleHeaderPointerUp}
          title="드래그하여 원하는 위치로 이동"
        >
          <div>
            <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
              <h3>🦷 치아 전용 선택기 (FDI 32개 영구치)</h3>
              <span className="dental-drag-badge">드래그 이동 가능</span>
            </div>
            <p>치아를 클릭하거나 드래그하면 화면과 확정 부위에 즉시 동기화됩니다.</p>
          </div>
          <button type="button" className="dental-modal-close" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        <div
          className="dental-arch-container"
          onPointerMove={handleArchPointerMove}
        >
          {/* 상악 (위턱) */}
          <div className="dental-arch-section">
            <div className="dental-arch-label">
              <span>상악 (위턱)</span>
              <small>환자 기준 우측(10번대) ↔ 좌측(20번대)</small>
            </div>
            <div className="dental-arch-grid">
              {renderQuadrantRow("upper-right", false)}
              <div className="dental-midline-divider" title="정중선 (Midline)" />
              {renderQuadrantRow("upper-left", false)}
            </div>
          </div>

          <div className="dental-occlusal-plane" />

          {/* 하악 (아래턱) */}
          <div className="dental-arch-section">
            <div className="dental-arch-label">
              <span>하악 (아래턱)</span>
              <small>환자 기준 우측(40번대) ↔ 좌측(30번대)</small>
            </div>
            <div className="dental-arch-grid">
              {renderQuadrantRow("lower-right", false)}
              <div className="dental-midline-divider" title="정중선 (Midline)" />
              {renderQuadrantRow("lower-left", false)}
            </div>
          </div>
        </div>

        {/* 선택된 치아 상세 정보 */}
        {lastInteractedTooth ? (
          <div className="dental-selected-detail">
            <div className="dental-detail-badge">
              <strong>{lastInteractedTooth.shortCode}</strong> {lastInteractedTooth.koreanName}
              {totalSelectedCount > 1 ? ` (총 ${totalSelectedCount}개 선택됨)` : ""}
            </div>
            <p className="dental-detail-desc">
              일상 표기: <strong>{lastInteractedTooth.commonName}</strong> ({lastInteractedTooth.quadrant === "upper-right" || lastInteractedTooth.quadrant === "lower-right" ? "오른쪽" : "왼쪽"}) · 클릭하거나 드래그하여 즉시 추가/제외
            </p>
          </div>
        ) : (
          <div className="dental-selected-empty">
            <p>치열도에서 치아를 클릭하거나 드래그하여 선택해 주세요.</p>
          </div>
        )}

        <div className="dental-modal-footer">
          <span className="dental-status-summary">
            {totalSelectedCount > 0
              ? `선택된 치아: ${totalSelectedCount}개 (화면과 실시간 동기화됨)`
              : "치아 클릭 또는 드래그하여 다중 선택"}
          </span>
          <button type="button" className="primary-button" onClick={onClose}>
            완료
          </button>
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
