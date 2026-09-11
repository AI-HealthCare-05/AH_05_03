/**
 * "이어봄이 하는 일" 세 줄. **관문·가입·첫 실행이 같은 것을 쓴다.**
 *
 * 왜 한곳에 두나
 * --------------
 * 세 화면이 각자 문장을 들고 있으면 하나만 고쳐지고 나머지는 남는다. 이 저장소에
 * 그 자국이 실제로 있다 — ADR-011 로 건강정보 정본이 서버로 옮겨간 뒤 관문의 안내
 * 문구는 고쳤는데 첫 실행 화면은 "이 브라우저에만 저장한다" 고 계속 말했다.
 *
 * 질환 개수를 세는 이유
 * ---------------------
 * `DISEASE_NAMES` 에서 센다. 손으로 "14" 를 적으면 서버가 질환을 더해도 카피가
 * 안 따라온다. 이 표는 서버 `app/services/assessment.py` 의 `SPECS` 손 사본이고
 * "순서·표기를 맞춘다" 고 스스로 적어 뒀다.
 *
 * 아이콘 규격
 * -----------
 * 인라인 SVG 다. 이모지를 쓰지 않는다. `AuthCard` 의 눈 아이콘과 같은 규격으로
 * 맞춘다 — 24 뷰박스, 채움 없음, `currentColor` 선, 두께 2, 둥근 캡. 색은 부모가
 * 정한다(`.auth-point-icon` 의 `color`).
 */

import type { ReactNode } from "react";

import { DISEASE_NAMES } from "../assessment/contracts";

const DISEASE_COUNT = Object.keys(DISEASE_NAMES).length;

function iconProps() {
  return {
    width: 22,
    height: 22,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
  } as const;
}

/** 검진표를 사진으로 — 접힌 모서리 문서 + 렌즈. */
function ScanIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
      <polyline points="14 3 14 8 19 8" />
      <circle cx="12" cy="14" r="2.5" />
    </svg>
  );
}

/** 수치로 판정 — 축과 막대 셋. */
function ChartIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M4 4v16h16" />
      <line x1="8.5" y1="20" x2="8.5" y2="13" />
      <line x1="13" y1="20" x2="13" y2="8" />
      <line x1="17.5" y1="20" x2="17.5" y2="11" />
    </svg>
  );
}

/** 가족 구성원 — 사람 둘. */
function FamilyIcon() {
  return (
    <svg {...iconProps()}>
      <path d="M15 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
      <circle cx="8.5" cy="7" r="3.5" />
      <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
      <path d="M16 3.13a4 4 0 0 1 0 7.75" />
    </svg>
  );
}

export interface ServicePoint {
  id: string;
  icon: ReactNode;
  text: string;
}

export const SERVICE_POINTS: ServicePoint[] = [
  { id: "scan", icon: <ScanIcon />, text: "검진표를 사진으로 올리면 수치를 읽어 옵니다." },
  { id: "assess", icon: <ChartIcon />, text: `검진 수치 한 벌로 만성질환 ${DISEASE_COUNT}가지를 한 번에 판정합니다.` },
  { id: "family", icon: <FamilyIcon />, text: "가족 구성원마다 따로 기록하고 함께 봅니다." },
];

/**
 * 소개 세 줄 목록.
 *
 * 아이콘은 `aria-hidden` 이라 화면 낭독기에는 문장만 읽힌다. 목록으로 두는 것은
 * "셋이다" 가 들리게 하려는 것이다.
 */
export function ServicePoints({ className }: { className?: string } = {}) {
  return (
    <ul className={className ? `auth-points ${className}` : "auth-points"}>
      {SERVICE_POINTS.map((point) => (
        <li key={point.id}>
          <span className="auth-point-icon" aria-hidden="true">
            {point.icon}
          </span>
          <span>{point.text}</span>
        </li>
      ))}
    </ul>
  );
}
