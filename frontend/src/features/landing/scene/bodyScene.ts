/**
 * 3D 인체 장면의 **계산만** 모아 둔 곳. three.js 를 import 하지 않는다.
 *
 * 카메라 위치와 표식 좌표를 컴포넌트 안에 두면 값을 바꿀 때마다 브라우저를 열어야
 * 확인할 수 있다. 여기 있는 것은 전부 순수 함수라 테스트로 고정된다
 * (`bodyScene.test.ts`).
 *
 * ## 좌표계
 *
 * 모델을 받아서 **바운딩 박스 중심을 원점에, 키를 2 로** 맞춘 뒤 쓴다. 그래서
 * 아래 숫자는 아틀라스의 원래 단위와 무관하다 — 발끝이 y = -1, 정수리가 y = +1.
 *
 * 앞(정면)은 +Z 다. 앱의 인체 뷰어가 카메라를 `(0, 0.1, 6.8)` 에 두고 정면을
 * 보여 주므로(`VanatomeBodyMap`) 같은 방향을 쓴다. 따라서 **사람의 오른쪽은 -X**
 * (정면으로 마주 본 사람의 오른손은 보는 사람 기준 왼쪽).
 */

import type { BodyMarkerId } from "../landingStory";

/** 모델을 맞추는 키. 카메라 거리 숫자가 전부 이 값을 전제한다. */
export const MODEL_HEIGHT = 2;

/**
 * 아틀라스 원본을 정면으로 돌려 세우는 각도(Y축, 라디안).
 *
 * Vanatome GLB 는 앞뒤가 이미 Z 축이다(2026-09-16 실측 바운딩 박스:
 * 좌우 0.68 · 앞뒤 0.29 · 키 1.74 — 팔을 내린 사람의 비율). 그래서 기본값은 0 이고,
 * 이 상수는 **아틀라스를 갈아 끼웠을 때 돌려 세울 자리**로 남겨 둔다.
 *
 * 표식 좌표(아래)가 "앞 = +Z" 를 전제하므로, 축이 다른 모델이 들어오면 카메라가
 * 아니라 **여기**를 고친다 — 카메라를 돌리면 표식이 통째로 어긋난다.
 */
export const MODEL_FACING_Y = 0;

export type Vec3 = readonly [number, number, number];

/**
 * 표식이 붙는 자리. 해부 구조 이름이 아니라 **비율**로 잡는다 — 아틀라스를
 * 남성/여성으로 바꿔도, 지연 계층이 더 붙어도 같은 자리에 선다.
 */
export const BODY_MARKER_ANCHORS: Record<BodyMarkerId, Vec3> = {
  // 키의 약 28% 높이, 몸 중심에서 사람의 오른쪽으로.
  rightKnee: [-0.1, -0.45, 0.07],
  // 키의 약 82% 높이, 사람의 왼쪽 어깨.
  leftShoulder: [0.21, 0.62, 0.04],
  // 배꼽 조금 위. 몸 한가운데라 z 를 가장 앞으로 둔다.
  abdomen: [0.0, 0.06, 0.13],
};

export interface CameraKeyframe {
  position: Vec3;
  target: Vec3;
}

/**
 * 장면마다 하나씩. `BODY_SCENES` 와 **길이가 같아야 한다**(테스트가 지킨다).
 *
 * 움직임은 크지 않다. 장면마다 카메라가 크게 날아다니면 게임 캐릭터 선택 화면이
 * 된다 — 가까이 갔다가 마지막에 한 발 물러서는 정도만 쓴다.
 */
export const BODY_CAMERA_KEYFRAMES: CameraKeyframe[] = [
  { position: [0, 0.05, 3.45], target: [0, 0, 0] },
  { position: [-0.7, -0.28, 2.4], target: [-0.1, -0.42, 0] },
  // 어깨 장면은 일부러 덜 당긴다 — "앞의 기록은 지워지지 않는다" 를 말하는 장면인데
  // 어깨만 꽉 채우면 무릎 표식이 화면 밖으로 나가서 말과 화면이 어긋난다.
  { position: [0.62, 0.34, 3.0], target: [0.1, 0.24, 0] },
  { position: [0.42, 0.12, 2.1], target: [0.0, 0.06, 0] },
  { position: [0, 0.05, 3.8], target: [0, 0, 0] },
];

function clamp01(value: number): number {
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 시작과 끝에서 속도가 0 이 되는 보간. 등속 이동은 기계처럼 보인다. */
export function smoothstep(value: number): number {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function lerpVec(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

/**
 * 진행도 → 카메라.
 *
 * 장면 i 는 그 구간의 **한가운데**에서 완전히 자리 잡는다. 구간 경계에서 딱 맞추면
 * 장면이 바뀌는 순간에 카메라가 가장 빨라서, 글자가 뜨는 동안 화면이 흔들린다.
 */
export function cameraAt(progress: number, keyframes: CameraKeyframe[] = BODY_CAMERA_KEYFRAMES): CameraKeyframe {
  const count = keyframes.length;
  if (count === 0) throw new Error("카메라 키프레임이 비어 있습니다");
  if (count === 1) return keyframes[0];

  const scaled = clamp01(progress) * count - 0.5;
  if (scaled <= 0) return keyframes[0];
  if (scaled >= count - 1) return keyframes[count - 1];

  const from = Math.floor(scaled);
  const t = smoothstep(scaled - from);
  return {
    position: lerpVec(keyframes[from].position, keyframes[from + 1].position, t),
    target: lerpVec(keyframes[from].target, keyframes[from + 1].target, t),
  };
}

/**
 * 표식 하나의 드러남 0~1.
 *
 * 장면 `appearScene` 이 시작할 때 0 에서 출발해 그 장면의 절반 지점에서 1 이 된다.
 * **한 번 1 이 된 표식은 다시 0 으로 돌아가지 않는다** — 기록이 쌓인다는 것이
 * 이 장면의 전부라서, 스크롤을 내리는 동안 앞의 표식이 흐려지면 말이 뒤집힌다.
 */
export function markerReveal(progress: number, appearScene: number, sceneCount: number): number {
  if (sceneCount <= 0) return 1;
  const start = appearScene / sceneCount;
  const span = 0.5 / sceneCount;
  return smoothstep((clamp01(progress) - start) / span);
}

/**
 * 표식이 처음 나타나는 장면 번호. `BODY_SCENES[i].markers` 에서 뽑는다.
 * 장면 데이터와 표식 좌표가 어긋나면(오타 등) 여기서 `undefined` 가 된다.
 */
export function firstSceneOfMarker(scenes: { markers: BodyMarkerId[] }[], marker: BodyMarkerId): number | undefined {
  const index = scenes.findIndex((scene) => scene.markers.includes(marker));
  return index < 0 ? undefined : index;
}

/**
 * 인체가 스스로 도는 각도(라디안).
 *
 * **한 방향으로 계속 도는 것이 아니라 아주 느리게 좌우로 흔들린다(±8°).**
 * 처음에는 각속도를 상수로 두고 시간을 곱했는데, 스크롤을 멈추고 30초쯤 읽는
 * 동안 몸이 50° 가까이 돌아가 정면이 아니게 됐다(2026-09-16 실측). 표식이 붙는
 * 장면에서는 완전히 멈춘다 — 표식을 보는데 몸이 돌면 읽을 수 없다.
 */
export function idleSpin(elapsedSeconds: number, progress: number): number {
  const fade = 1 - smoothstep(clamp01(progress) * 4);
  return Math.sin(elapsedSeconds * 0.28) * 0.14 * fade;
}
