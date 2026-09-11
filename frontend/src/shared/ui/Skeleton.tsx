import type { CSSProperties, HTMLAttributes } from "react";

interface SkeletonProps extends HTMLAttributes<HTMLDivElement> {
  variant?: "text" | "avatar" | "card" | "bubble" | "rect";
  width?: string | number;
  height?: string | number;
}

export function Skeleton({
  variant = "rect",
  width,
  height,
  className = "",
  style,
  ...props
}: SkeletonProps) {
  const variantClass =
    variant === "text"
      ? "skeleton skeleton-text"
      : variant === "avatar"
        ? "skeleton skeleton-avatar"
        : variant === "card"
          ? "skeleton skeleton-card"
          : variant === "bubble"
            ? "skeleton skeleton-bubble"
            : "skeleton";

  const customStyle: CSSProperties = {
    ...style,
    ...(width !== undefined ? { width: typeof width === "number" ? `${width}px` : width } : {}),
    ...(height !== undefined ? { height: typeof height === "number" ? `${height}px` : height } : {}),
  };

  return <div className={`${variantClass} ${className}`.trim()} style={customStyle} {...props} />;
}

/**
 * 가족 구성원 카드 자리를 **실제 카드와 같은 격자·높이로** 채운다.
 *
 * 예전 `dashboard-skeleton` 은 3칸짜리 막대였는데 실제 `.member-list` 는 4칸이라,
 * 기록이 도착하는 순간 칸 수가 3→4 로 바뀌며 화면이 한 번 튀었다. 같은 클래스를
 * 그대로 쓰고 안쪽만 스켈레톤으로 채우면 폭·높이·간격이 이미 맞아 튐이 없다 —
 * 자리가 미리 잡혀 있으면 "다 온 화면" 으로 읽힌다.
 */
export function MemberListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <div className="member-list" role="status" aria-label="가족 구성원을 불러오는 중">
      {Array.from({ length: count }, (_, index) => (
        <div className="member-card is-skeleton" key={index} aria-hidden="true">
          <Skeleton variant="avatar" width={48} height={48} style={{ borderRadius: "16px" }} />
          <span className="member-card-copy">
            <Skeleton variant="text" width="58%" height={15} />
            <Skeleton variant="text" width="80%" height={12} style={{ marginTop: "6px" }} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** 패널 안 목록(최근 건강기록·검진 이력)의 줄 자리. */
export function ListRowsSkeleton({ rows = 3, label = "목록을 불러오는 중" }: { rows?: number; label?: string }) {
  return (
    <div className="skeleton-rows" role="status" aria-label={label}>
      {Array.from({ length: rows }, (_, index) => (
        <div className="skeleton-row" key={index} aria-hidden="true">
          <div className="skeleton-row-copy">
            <Skeleton variant="text" width="42%" height={14} />
            <Skeleton variant="text" width="68%" height={12} style={{ marginTop: "6px" }} />
          </div>
          <Skeleton variant="text" width={72} height={28} style={{ borderRadius: "999px", marginBottom: 0 }} />
        </div>
      ))}
    </div>
  );
}

/**
 * 라우트 청크를 받는 동안 본문 자리를 채우는 페이지 골격.
 *
 * 그 화면에 처음 갈 때 청크를 받는 동안 보인다(미리 받아 뒀다면 지나친다 —
 * `app/prefetchRoutes`). 예전에는 "불러오는 중…" 글자 한 줄이었는데, 문서 부트
 * 골격(`index.html`) → 글자 한 줄 → 진짜 화면으로 모양이 두 번 바뀌어 오히려 더
 * 오래 걸리는 것처럼 보였다. 부트 골격과 같은 형태로 이어 붙여 한 번만 바뀌게 한다.
 */
export function PageSkeleton() {
  return (
    <div className="product-page" role="status" aria-label="화면을 불러오는 중">
      <div className="skeleton-page-heading" aria-hidden="true">
        <Skeleton variant="text" width={128} height={13} />
        <Skeleton variant="text" width="min(560px, 72%)" height={42} style={{ marginTop: "14px" }} />
      </div>
      <div className="skeleton-section-title" aria-hidden="true">
        <div>
          <Skeleton variant="text" width={96} height={12} />
          <Skeleton variant="text" width={232} height={26} style={{ marginTop: "10px" }} />
        </div>
      </div>
      <MemberListSkeleton />
    </div>
  );
}

/**
 * 챗봇 패널 로딩 시 표시되는 통일된 스켈레톤 UI 프리셋.
 * 아바타, 헤더 바, 대화 말풍선 형태의 부드러운 쉬머 효과를 제공한다.
 */
export function ChatLoadingSkeleton() {
  return (
    <div
      className="chat-loading-skeleton"
      style={{
        display: "flex",
        flexDirection: "column",
        gap: "18px",
        padding: "20px",
        height: "100%",
        boxSizing: "border-box",
        background: "var(--surface, #ffffff)",
      }}
      aria-label="봄이 대화를 준비하는 중"
      role="status"
    >
      {/* 챗봇 헤더 스켈레톤 */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px", paddingBottom: "12px", borderBottom: "1px solid var(--line-soft, #e8edf5)" }}>
        <Skeleton variant="avatar" width={38} height={38} />
        <div style={{ flex: 1 }}>
          <Skeleton variant="text" width="40%" height={16} />
          <Skeleton variant="text" width="60%" height={12} style={{ marginTop: "4px" }} />
        </div>
      </div>

      {/* 어시스턴트 첫인사 말풍선 스켈레톤 */}
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <Skeleton variant="avatar" width={32} height={32} />
        <div style={{ flex: 1, maxWidth: "75%" }}>
          <Skeleton variant="bubble" width="100%" height={72} style={{ background: "var(--line-soft, #e8edf5)" }} />
        </div>
      </div>

      {/* 사용자 질문 말풍선 스켈레톤 */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <div style={{ width: "60%" }}>
          <Skeleton variant="bubble" width="100%" height={48} style={{ background: "var(--blue-100, #eaf1ff)" }} />
        </div>
      </div>

      {/* 어시스턴트 답변 로딩 말풍선 스켈레톤 */}
      <div style={{ display: "flex", gap: "10px", alignItems: "flex-start" }}>
        <Skeleton variant="avatar" width={32} height={32} />
        <div style={{ flex: 1, maxWidth: "80%" }}>
          <Skeleton variant="bubble" width="100%" height={96} style={{ background: "var(--line-soft, #e8edf5)" }} />
        </div>
      </div>
    </div>
  );
}
