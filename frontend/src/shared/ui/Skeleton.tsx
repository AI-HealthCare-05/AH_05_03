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
