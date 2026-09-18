import type { Ref } from "react";
import { NavLink } from "react-router-dom";

import { StitchAccountChip } from "./StitchAccountChip";
import { StitchCapsuleNav } from "./StitchCapsuleNav";

function HeaderIcon({ name }: { name: "search" | "bell" }) {
  const paths = {
    search: (
      <>
        <circle cx="11" cy="11" r="8" />
        <line x1="21" y1="21" x2="16.65" y2="16.65" />
      </>
    ),
    bell: (
      <>
        <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
        <path d="M13.73 21a2 2 0 0 1-3.46 0" />
      </>
    ),
  } as const;

  return (
    <svg
      className="up15-icon"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {paths[name]}
    </svg>
  );
}

interface StitchAppHeaderProps {
  displayName?: string;
  navRef?: Ref<HTMLElement>;
}

/** 가족 홈과 같은 상단 바. 스티치 셸 화면이 이 마크업을 그대로 쓴다. */
export function StitchAppHeader({ displayName, navRef }: StitchAppHeaderProps) {
  return (
    <div className="up15-header-wrapper stitch-app-header">
      <header className="up15-header">
        <div className="up15-brand">
          <NavLink className="up15-brand-home" to="/" aria-label="이어봄 가족 홈">
            <div className="up15-logo-icon">
              <img src="/ieobom-icon.png" alt="" aria-hidden="true" width={36} height={36} />
            </div>
            <div className="up15-brand-text">
              <div className="up15-brand-text-row">
                <strong>이어봄</strong>
                <span className="up15-brand-dot" />
              </div>
              <span>우리 가족 웰니스 케어</span>
            </div>
          </NavLink>
          <StitchCapsuleNav id="primary-navigation" navRef={navRef} />
        </div>

        <div className="up15-actions">
          <button type="button" className="up15-icon-btn" aria-label="기록 검색">
            <HeaderIcon name="search" />
          </button>
          <button type="button" className="up15-icon-btn" aria-label="알림">
            <HeaderIcon name="bell" />
            <span className="up15-bell-dot" />
          </button>
          <StitchAccountChip displayName={displayName} />
        </div>
      </header>
    </div>
  );
}
