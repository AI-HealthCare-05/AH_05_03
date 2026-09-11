/**
 * 공용 모달.
 *
 * 왜 뽑았나
 * ---------
 * 같은 마크업이 세 군데에 복붙돼 있었다 — 가족 홈의 기록·프로필 대화상자, 데이터
 * 관리의 인식 확인과 삭제 확인. **셋 다 조금씩 달랐다.** 하나는 배경을 눌러 닫히고
 * 하나는 안 닫혔다. 셋 다 Escape 를 안 받았고, 열었다 닫으면 포커스가 문서 맨 위로
 * 튀었다.
 *
 * 키보드와 포커스
 * ---------------
 * **Escape 로 닫는다.** 모달을 열어 놓고 마우스를 못 쓰는 상황이 실제로 있다 —
 * 화면 낭독기 사용자가 그렇고, 좁은 화면에서 닫기 버튼이 스크롤 밖에 있을 때도 그렇다.
 *
 * **연 자리로 포커스를 돌려준다.** 안 돌려주면 닫는 순간 포커스가 `<body>` 로 가서,
 * 키보드 사용자는 방금 누른 버튼을 찾으려고 탭을 처음부터 다시 밟아야 한다.
 *
 * 뒤 배경은 스크롤을 잠근다. 안 잠그면 모달 안에서 휠을 굴렸을 때 뒤 페이지가 같이
 * 움직여서, 닫고 나면 엉뚱한 자리에 서 있다.
 */

import { type ReactNode, useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

/**
 * 열려 있는 모달 스택. **Escape 는 맨 위 하나만 닫아야 한다.**
 *
 * 모달 위에 모달이 뜨는 자리가 실제로 있다 — 기록 모달에서 질환 카드의 "판정 근거"
 * 를 누르면 근거 모달이 그 위에 겹친다. 둘 다 `document` 에 `keydown` 을 걸어 두면
 * Escape 한 번에 **둘 다 닫힌다.** 사용자는 근거만 닫고 기록으로 돌아가려던 것이다.
 */
const openModals: symbol[] = [];

export function Modal({
  title,
  kicker,
  onClose,
  className,
  children,
}: {
  title: string;
  /** 제목 위 작은 라벨. 없으면 안 그린다. */
  kicker?: string;
  onClose: () => void;
  /** `.modal-panel` 에 덧붙일 클래스. 폭이 다른 모달이 있다. */
  className?: string;
  children?: ReactNode;
}) {
  const titleId = useId();
  const panel = useRef<HTMLElement>(null);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    const { overflow } = document.body.style;
    document.body.style.overflow = "hidden";
    // 패널 자체에 포커스를 준다. 안쪽 첫 요소를 잡으면 입력창이 있는 모달에서
    // 화면 낭독기가 제목을 건너뛰고 입력창부터 읽는다.
    panel.current?.focus();

    const token = Symbol("modal");
    openModals.push(token);

    const onKey = (event: KeyboardEvent) => {
      // 맨 위 모달만 반응한다. 아래 깔린 것까지 같이 닫히면 안 된다.
      if (event.key === "Escape" && openModals.at(-1) === token) onClose();
    };
    document.addEventListener("keydown", onKey);

    return () => {
      document.removeEventListener("keydown", onKey);
      const at = openModals.indexOf(token);
      if (at >= 0) openModals.splice(at, 1);
      // 겹쳐 있었으면 바깥 모달이 걸어 둔 `hidden` 으로 돌아간다. 무조건 비우면
      // 위엣것을 닫는 순간 아래 모달 뒤 페이지가 다시 스크롤된다.
      document.body.style.overflow = overflow;
      opener?.focus?.();
    };
  }, [onClose]);

  /**
   * **`document.body` 로 내보낸다(포털).**
   *
   * 2026-09-11 버그. 판정 카드의 "판정 근거 자세히" 를 누르면 모달이 **세로로
   * 길쭉한** 모양(실측 239px)으로 떴다가, 마우스를 브라우저 밖으로 빼면 제 폭
   * (880px)으로 돌아왔다.
   *
   * 원인은 모달도 CSS 폭도 아니었다. 이 컴포넌트가 **호출한 자리에 그대로** 그려져
   * 왔고, 판정 카드에는 이런 규칙이 있다.
   *
   *     .assess-card:hover { transform: translateY(-1px); }
   *
   * `transform` 이 걸린 요소는 **`position: fixed` 자손의 컨테이닝 블록**이 된다.
   * 그래서 마우스가 카드 위에 있는 동안 `.modal-backdrop { position: fixed; inset: 0 }`
   * 의 기준이 뷰포트가 아니라 **카드**가 됐다 — 카드 폭이 268px 남짓이라 모달이
   * 그 안에 갇혀 좁고 길어진 것이다. 마우스를 빼면 `:hover` 가 풀리고 `transform`
   * 이 사라지니 기준이 뷰포트로 돌아온다. "마우스를 밖으로 옮겨야 고쳐진다" 가
   * 그 뜻이었다.
   *
   * 카드의 `transform` 을 지우는 것으로도 이 한 자리는 막히지만, 같은 함정이
   * `filter`·`perspective`·`contain`·`will-change` 로도 생긴다. 모달을 몸통으로
   * 내보내면 조상이 무엇을 하든 상관이 없어진다 — 이 컴포넌트를 쓰는 모든 화면이
   * 한 번에 안전해진다.
   */
  return createPortal(
    // `mousedown` 으로 잡는다. `click` 이면 패널 안에서 누르고 배경에서 뗀 드래그가
    // 닫기로 읽힌다 — 글자를 끌어 선택할 때 실제로 그렇게 된다.
    <div
      className="modal-backdrop"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <section
        ref={panel}
        className={className ? `modal-panel ${className}` : "modal-panel"}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="modal-heading">
          <div>
            {kicker ? <p className="section-kicker">{kicker}</p> : null}
            <h2 id={titleId}>{title}</h2>
          </div>
          <button type="button" className="modal-close" onClick={onClose} aria-label="닫기">
            ×
          </button>
        </div>
        {children}
      </section>
    </div>,
    document.body,
  );
}
