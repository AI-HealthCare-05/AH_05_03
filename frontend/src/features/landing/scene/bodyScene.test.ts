/**
 * 3D 장면의 계산을 브라우저 없이 고정한다.
 *
 * 카메라와 표식은 눈으로만 확인하면 다음 사람이 숫자를 옮길 때 무엇이 깨지는지
 * 알 수 없다. 여기서 지키는 것 셋:
 *   1. 장면 데이터와 카메라 키프레임의 **개수가 같다**
 *   2. 표식은 한 번 드러나면 **다시 사라지지 않는다**
 *   3. 표식 좌표가 모델 안(키 2, 원점 중심)에 있다
 */

import { describe, expect, it } from "vitest";

import { BODY_SCENES, type BodyMarkerId } from "../landingStory";
import {
  BODY_CAMERA_KEYFRAMES,
  BODY_MARKER_ANCHORS,
  MODEL_HEIGHT,
  cameraAt,
  firstSceneOfMarker,
  idleSpin,
  markerReveal,
  smoothstep,
} from "./bodyScene";

describe("3D 인체 장면 계산", () => {
  it("장면 수와 카메라 키프레임 수가 같다", () => {
    // 하나가 늘면 마지막 장면이 카메라 없이 남는다.
    expect(BODY_CAMERA_KEYFRAMES).toHaveLength(BODY_SCENES.length);
  });

  it("진행도 양 끝에서는 첫·끝 키프레임에 그대로 머문다", () => {
    expect(cameraAt(0)).toEqual(BODY_CAMERA_KEYFRAMES[0]);
    expect(cameraAt(1)).toEqual(BODY_CAMERA_KEYFRAMES[BODY_CAMERA_KEYFRAMES.length - 1]);
    // 범위를 벗어난 값이 들어와도 튀지 않는다(스크롤을 튕기면 실제로 들어온다).
    expect(cameraAt(-3)).toEqual(BODY_CAMERA_KEYFRAMES[0]);
    expect(cameraAt(9)).toEqual(BODY_CAMERA_KEYFRAMES[BODY_CAMERA_KEYFRAMES.length - 1]);
  });

  it("장면 한가운데에서는 그 장면의 키프레임에 자리 잡는다", () => {
    const count = BODY_CAMERA_KEYFRAMES.length;
    for (let index = 0; index < count; index += 1) {
      const view = cameraAt((index + 0.5) / count);
      expect(view.position[0]).toBeCloseTo(BODY_CAMERA_KEYFRAMES[index].position[0], 5);
      expect(view.position[2]).toBeCloseTo(BODY_CAMERA_KEYFRAMES[index].position[2], 5);
    }
  });

  it("카메라는 되돌아가지 않고 앞 장면에서 다음 장면으로만 간다", () => {
    // 1 → 2 장면 사이에서 z 가 단조롭게 움직이는지(덜컥임 없음).
    const count = BODY_CAMERA_KEYFRAMES.length;
    const from = 0.5 / count;
    const to = 1.5 / count;
    let previous = cameraAt(from).position[1];
    for (let step = 1; step <= 20; step += 1) {
      const current = cameraAt(from + ((to - from) * step) / 20).position[1];
      expect(current).toBeLessThanOrEqual(previous + 1e-9);
      previous = current;
    }
  });

  it("표식은 한 번 드러나면 끝까지 남는다", () => {
    const sceneCount = BODY_SCENES.length;
    const appearScene = firstSceneOfMarker(BODY_SCENES, "rightKnee");
    expect(appearScene).toBe(1);

    let previous = 0;
    for (let step = 0; step <= 50; step += 1) {
      const reveal = markerReveal(step / 50, appearScene as number, sceneCount);
      expect(reveal).toBeGreaterThanOrEqual(previous - 1e-9);
      previous = reveal;
    }
    expect(markerReveal(1, appearScene as number, sceneCount)).toBe(1);
    expect(markerReveal(0, appearScene as number, sceneCount)).toBe(0);
  });

  it("장면 데이터에 있는 표식은 모두 좌표를 가진다", () => {
    const used = new Set<BodyMarkerId>(BODY_SCENES.flatMap((scene) => scene.markers));
    for (const marker of used) {
      expect(BODY_MARKER_ANCHORS[marker]).toBeDefined();
    }
  });

  it("표식 좌표는 모델 바깥으로 나가지 않는다", () => {
    const half = MODEL_HEIGHT / 2;
    for (const [marker, anchor] of Object.entries(BODY_MARKER_ANCHORS)) {
      const [x, y, z] = anchor;
      expect(Math.abs(y), `${marker} 높이`).toBeLessThan(half);
      // 사람 몸의 가로·앞뒤는 키의 절반을 넘지 않는다.
      expect(Math.abs(x), `${marker} 좌우`).toBeLessThan(half / 2);
      expect(Math.abs(z), `${marker} 앞뒤`).toBeLessThan(half / 2);
    }
  });

  it("오른쪽 무릎은 왼쪽 어깨의 반대편 · 아래에 있다", () => {
    // 부호가 뒤집히면 "오른쪽 무릎" 표식이 왼쪽 다리에 붙는다. 눈으로만 보면
    // 거울상이라 알아채기 어렵다.
    expect(BODY_MARKER_ANCHORS.rightKnee[0]).toBeLessThan(0);
    expect(BODY_MARKER_ANCHORS.leftShoulder[0]).toBeGreaterThan(0);
    expect(BODY_MARKER_ANCHORS.rightKnee[1]).toBeLessThan(BODY_MARKER_ANCHORS.leftShoulder[1]);
  });

  it("자동 회전은 첫 장면에서만 돌고 표식이 붙기 시작하면 멈춘다", () => {
    expect(Math.abs(idleSpin(10, 0))).toBeGreaterThan(0);
    expect(idleSpin(10, 0.4)).toBe(0);
  });

  it("smoothstep 은 0~1 로 묶인다", () => {
    expect(smoothstep(-1)).toBe(0);
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(0.5)).toBeCloseTo(0.5, 5);
    expect(smoothstep(1)).toBe(1);
    expect(smoothstep(4)).toBe(1);
  });
});
