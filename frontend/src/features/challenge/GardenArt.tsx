/**
 * 나무와 동물을 코드로 그린다. 이미지 파일이 하나도 없다.
 *
 * 3주 안에 넣기 위한 선택이다. 나무는 파라미터로 여섯 단계를 만들고 동물은 단색
 * 실루엣으로 둔다. 실루엣은 여러 사람이 손대도 스타일이 안 튀고, 나중에 정밀한
 * 일러스트로 갈아 끼울 때 이 파일만 바꾸면 된다 — 화면 쪽은 `treeKey` 와 `animalId`
 * 만 알고 있으므로 계약이 안 깨진다.
 *
 * 색은 `styles.css` 의 `--garden-*` 토큰에서 받는다. DESIGN.md §2 가 상태 색 3종을
 * 위험도 표기 전용으로 묶어 뒀으므로 나무에 `--safe` 초록을 쓸 수 없다 — 그러면 나무가
 * 저위험 뱃지로 읽히고, 나무는 건강 상태가 아니라 행동 점수로 자란다는 원칙을 색이
 * 배신한다. 근거는 `.omd/preferences.md` 의 `garden-illustration-palette-intentional`.
 */

import type { AnimalId, TreeKey } from "./contracts";

const LEAF = "var(--garden-leaf)";
const LEAF_DEEP = "var(--garden-leaf-deep)";
const TRUNK = "var(--garden-trunk)";
const SOIL = "var(--garden-soil)";
const FRUIT = "var(--garden-fruit)";

interface TreeShape {
  /** 줄기 높이(0~1). 화폭 기준 비율이다. */
  trunk: number;
  /** 잎 덩어리 반지름. 0이면 아직 잎이 없다. */
  canopy: number;
  /** 잎을 몇 겹으로 겹칠지. 겹수가 늘면 눈에 띄게 무성해진다. */
  layers: number;
  fruits: number;
}

// 앞 단계를 촘촘히, 뒤를 크게 벌렸다. 4주 시연에서 눈에 띄게 자라야 한다.
const SHAPES: Record<TreeKey, TreeShape> = {
  seed: { trunk: 0, canopy: 0, layers: 0, fruits: 0 },
  sprout: { trunk: 0.14, canopy: 8, layers: 1, fruits: 0 },
  sapling: { trunk: 0.28, canopy: 15, layers: 1, fruits: 0 },
  young: { trunk: 0.42, canopy: 24, layers: 2, fruits: 0 },
  tree: { trunk: 0.54, canopy: 34, layers: 3, fruits: 0 },
  fruiting: { trunk: 0.6, canopy: 40, layers: 3, fruits: 5 },
};

const ANIMAL_PATHS: Record<AnimalId, string> = {
  // 전부 24×24 좌표계 안의 단색 실루엣이다. 둥근 형태만 잡으면 실루엣도 귀엽다.
  butterfly:
    "M12 6c-1 0-1.6.9-1.6 2v8c0 1.1.6 2 1.6 2s1.6-.9 1.6-2V8c0-1.1-.6-2-1.6-2Zm-2.6 2C7.2 6.6 3 6.9 3 10.4c0 2.9 3.4 4 6.4 3.1Zm5.2 0c2.2-1.4 6.4-1.1 6.4 2.4 0 2.9-3.4 4-6.4 3.1Z",
  bee: "M12 4a3 3 0 0 1 3 3v1H9V7a3 3 0 0 1 3-3Zm-3 5h6v2H9Zm0 3h6v2H9Zm.6 3h4.8c-.5 1.9-1.4 3-2.4 3s-1.9-1.1-2.4-3ZM6 6.5C4.4 5.6 2.6 6 2 7.4c1 1.2 2.8 1.5 4.4.8Zm12 0c1.6-.9 3.4-.5 4 .9-1 1.2-2.8 1.5-4.4.8Z",
  bird: "M4 13c0-3.3 2.7-6 6-6h3l3-3v3.2c2 .9 3.4 2.9 3.4 5.2 0 3.1-2.5 5.6-5.6 5.6H9.4A5.4 5.4 0 0 1 4 12.6Zm11-4.4a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z",
  squirrel:
    "M9 5c2.8 0 5 2.2 5 5v1.5h1.6c1.4 0 2.4 1 2.4 2.4V19H8.5A4.5 4.5 0 0 1 4 14.5V13c0-1.3.7-2.2 1.8-2.6C5.3 9.6 5 8.6 5 7.6 5 6.1 6 5 7.4 5Zm10 3.6c1.7 1 2.6 3 2.2 5-.3 1.6-1.5 2.8-3 3.2v-4c0-1.6-.6-3-1.6-4Z",
  cat: "M6 8 4.6 4.4 8 6.2h8l3.4-1.8L18 8c1.3 1.2 2 2.9 2 4.7 0 3.5-3.6 6.3-8 6.3S4 16.2 4 12.7C4 10.9 4.7 9.2 6 8Zm3 4a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm6 0a1 1 0 1 0 0-2 1 1 0 0 0 0 2Zm-3 2.4-1.4 1h2.8Z",
  deer: "M12 8c2.8 0 5 2.2 5 5 0 2.8-2.2 5-5 5s-5-2.2-5-5c0-2.8 2.2-5 5-5Zm-4.6-.8L5 3.4l2.6.8L8.4 2l1 3.6c.4.5.6 1 .6 1.6Zm9.2 0c0-.6.2-1.1.6-1.6L18 2l.8 2.2 2.6-.8-2.4 3.8ZM10.5 12a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Zm3 0a.9.9 0 1 0 0-1.8.9.9 0 0 0 0 1.8Z",
  owl: "M12 4c4.4 0 8 3.4 8 7.6C20 16 16.4 19 12 19s-8-3-8-7.4C4 7.4 7.6 4 12 4Zm-3 5a2.4 2.4 0 1 0 0 4.8A2.4 2.4 0 0 0 9 9Zm6 0a2.4 2.4 0 1 0 0 4.8A2.4 2.4 0 0 0 15 9Zm-3 4.8-1.2 1.8h2.4Z",
};

// 동물이 나무 위 어디에 앉는지. 겹치지 않게 자리를 미리 나눠 뒀다.
const PERCH: Record<AnimalId, { x: number; y: number; scale: number }> = {
  butterfly: { x: 22, y: 34, scale: 0.8 },
  bee: { x: 76, y: 30, scale: 0.7 },
  bird: { x: 63, y: 46, scale: 0.9 },
  squirrel: { x: 34, y: 58, scale: 0.9 },
  cat: { x: 50, y: 88, scale: 1 },
  deer: { x: 78, y: 82, scale: 1 },
  owl: { x: 42, y: 40, scale: 1 },
};

export interface TreeProps {
  stage: TreeKey;
  /** 나무에 앉힐 동물. 받은 것만 넘긴다. */
  animals?: AnimalId[];
  size?: number;
  /** 물을 준 직후의 흔들림. `prefers-reduced-motion` 은 CSS 가 끈다. */
  justWatered?: boolean;
  label?: string;
}

export function Tree({ stage, animals = [], size = 200, justWatered = false, label }: TreeProps) {
  const shape = SHAPES[stage];
  const groundY = 92;
  const topY = groundY - shape.trunk * 70;

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label={label ?? `나무 단계 ${stage}`}
      className={justWatered ? "garden-tree garden-tree--watered" : "garden-tree"}
    >
      <ellipse cx="50" cy={groundY + 3} rx="30" ry="4" fill={SOIL} opacity="0.35" />

      {stage === "seed" ? (
        <ellipse cx="50" cy={groundY - 2} rx="5" ry="6.5" fill={TRUNK} />
      ) : (
        <path
          d={`M50 ${groundY} L50 ${topY}`}
          stroke={TRUNK}
          strokeWidth={2 + shape.layers * 1.4}
          strokeLinecap="round"
          fill="none"
        />
      )}

      {Array.from({ length: shape.layers }).map((_, index) => {
        const spread = shape.canopy * (1 - index * 0.22);
        const cy = topY + index * shape.canopy * 0.42;
        return (
          <circle
            key={index}
            cx={50}
            cy={cy}
            r={spread}
            fill={index % 2 === 0 ? LEAF : LEAF_DEEP}
            opacity={0.92}
          />
        );
      })}

      {Array.from({ length: shape.fruits }).map((_, index) => {
        const angle = (index / shape.fruits) * Math.PI * 2;
        return (
          <circle
            key={`fruit-${index}`}
            cx={50 + Math.cos(angle) * shape.canopy * 0.75}
            cy={topY + Math.sin(angle) * shape.canopy * 0.6}
            r={3.2}
            fill={FRUIT}
          />
        );
      })}

      {animals.map((animal) => {
        const perch = PERCH[animal];
        if (!perch) return null;
        return (
          <g
            key={animal}
            transform={`translate(${perch.x - 6} ${perch.y - 6}) scale(${(perch.scale * 12) / 24})`}
          >
            <path d={ANIMAL_PATHS[animal]} fill={LEAF_DEEP} />
          </g>
        );
      })}
    </svg>
  );
}

export function AnimalBadge({
  animal,
  earned,
  size = 28,
}: {
  animal: AnimalId;
  earned: boolean;
  size?: number;
}) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} role="presentation" aria-hidden="true">
      <path d={ANIMAL_PATHS[animal]} fill={earned ? LEAF_DEEP : "currentColor"} opacity={earned ? 1 : 0.22} />
    </svg>
  );
}
