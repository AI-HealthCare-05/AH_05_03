/**
 * 이어봄 마크 — v2 색으로 다시 그린 것.
 *
 * ## 왜 `/ieobom-icon.svg` 를 그대로 걸지 않나
 *
 * 그 파일은 **인디고→블루→틸 그라데이션 라운드 사각형**이다. 이 페이지는 단색
 * 바이올렛 세계라 그 사각형 하나가 유일한 청록색으로 남는다. CSS `filter` 로
 * 돌려 봤더니 그라데이션이 뭉개져 검은 덩어리가 됐다(실측).
 *
 * 그래서 **모티프는 그대로 두고 색만** 옮겼다 — 세 점을 잇는 아치(가족 건강
 * 타임라인)는 원본 SVG 의 좌표를 그대로 쓴다. 브랜드는 아치이고, 색은 이 화면의
 * 디자인 시스템이다. 원본 파일은 한 줄도 고치지 않는다(앱과 v1 이 쓴다).
 */

interface BrandMarkV2Props {
  size?: number;
  /**
   * 어디에 얹히는가. 오버진 평면 위에서는 오버진 원이 배경에 녹아 사라져
   * 아치만 공중에 뜬다(푸터 실측) — 그때는 원을 옅은 라벤더로 바꾼다.
   */
  tone?: "light" | "onDark";
}

export function BrandMarkV2({ size = 30, tone = "light" }: BrandMarkV2Props) {
  return (
    <svg
      className="lnv2-mark"
      width={size}
      height={size}
      viewBox="0 0 1254 1254"
      aria-hidden="true"
      focusable="false"
    >
      <circle
        cx="627"
        cy="627"
        r="627"
        fill={tone === "onDark" ? "rgb(226 223 254 / 0.14)" : "var(--v2-aubergine)"}
      />
      {/* 아래 좌표는 `public/ieobom-icon.svg` 의 것과 같다. */}
      <g fill="none" stroke="var(--v2-lavender)" strokeWidth="54" strokeLinecap="round" strokeLinejoin="round">
        <path d="M 372 852 C 427 797, 474 548, 625 418 C 776 548, 823 797, 878 852" />
      </g>
      <g fill="var(--v2-lavender)">
        <circle cx="372" cy="852" r="41" />
        <circle cx="625" cy="418" r="51" />
        <circle cx="878" cy="852" r="41" />
      </g>
    </svg>
  );
}
