import { describe, expect, it } from "vitest";

import {
  adaptAnatomyMesh,
  lazyLayersForFocus,
  validateAnatomyAtlasManifest,
} from "./anatomyAtlas";
import type { AnatomyAtlasManifest } from "./anatomyAtlas";

function manifest(
  overrides: Partial<AnatomyAtlasManifest> = {},
): AnatomyAtlasManifest {
  return {
    id: "tripo-triangle2m-v49-internals-preview",
    version: "3.5.0-enlarged-organs-v28",
    label: "Tripo v28",
    shortLabel: "Tripo v28",
    referenceSex: "female",
    adapter: "shell",
    coordinatePolicy: "presentation-fitted",
    referenceFrameId: "tripo-single-front-triangle2m-extremities-scaled-v01-with-v49-internals",
    experimental: true,
    description: "test",
    loadingLabel: "test",
    loadingSizeLabel: "test",
    layerLabels: [],
    attributionLabel: "test",
    attributionUrl: "/vendor/vanatome/ATTRIBUTION.txt",
    assets: [{ url: "/female-shell.glb", visualRole: "shell" }],
    ...overrides,
  };
}

describe("final anatomy atlas adapters", () => {
  it("남성 Vanatome 구조의 anatomyId와 계통을 유지한다", () => {
    const male = manifest({
      id: "vanatome-male-reference",
      version: "1.4.0",
      referenceSex: "male",
      adapter: "vanatome",
      coordinatePolicy: undefined,
      referenceFrameId: undefined,
    });

    expect(adaptAnatomyMesh(
      {
        name: "heart-left-atrium__Left_atrium",
        userData: {
          anatomyId: "heart-left-atrium",
          anatomySystem: "cardiovascular",
        },
      },
      { url: "/male.glb", visualRole: "atlas" },
      male,
      new Map(),
    )).toMatchObject({
      anatomyId: "heart-left-atrium",
      sourceKey: "vanatome:vanatome-male-reference:1.4.0:heart-left-atrium",
      system: "cardiovascular",
      visualRole: "organ",
      selectable: true,
    });
  });

  it("Tripo v28 외피를 선택 불가능한 시각 외피로 변환한다", () => {
    expect(adaptAnatomyMesh(
      { name: "tripo_body", userData: {} },
      { url: "/female-shell.glb", visualRole: "shell" },
      manifest(),
      new Map(),
    )).toMatchObject({
      anatomyId: "body-shell:tripo-body",
      sourceKey: "shell:tripo-triangle2m-v49-internals-preview:3.5.0-enlarged-organs-v28:tripo_body",
      system: "integumentary",
      visualRole: "shell",
      selectable: false,
    });
  });

  it("남성 body-shell은 regional-anatomy 메타데이터와 무관하게 외피계로 정규화한다", () => {
    const male = manifest({
      id: "vanatome-male-reference",
      version: "1.4.0",
      referenceSex: "male",
      adapter: "vanatome",
    });
    expect(adaptAnatomyMesh(
      {
        name: "body-shell__body-shell",
        userData: { anatomyId: "body-shell", anatomySystem: "regional-anatomy" },
      },
      { url: "/male.glb", visualRole: "atlas" },
      male,
      new Map([["body-shell", { id: "body-shell", name: "body-shell", system: "regional-anatomy" }]]),
    )).toMatchObject({
      anatomyId: "body-shell",
      system: "integumentary",
      visualRole: "shell",
      selectable: false,
    });
  });

  it("남성 하반신 지연 레이어의 생식계 구조를 유지한다", () => {
    const male = manifest({
      id: "vanatome-male-reference",
      version: "1.4.0",
      referenceSex: "male",
      adapter: "vanatome",
    });
    expect(adaptAnatomyMesh(
      {
        name: "prostate",
        userData: { anatomyId: "prostate", anatomySystem: "reproductive" },
      },
      { url: "/lower.glb", visualRole: "organ" },
      male,
      new Map(),
    )).toMatchObject({ system: "reproductive", visualRole: "organ", selectable: true });
  });

  it("Tripo v28의 Vanatome 장기 자산을 선택 가능한 장기로 유지한다", () => {
    expect(adaptAnatomyMesh(
      {
        name: "liver__Liver",
        userData: { anatomyId: "liver", anatomySystem: "digestive" },
      },
      { url: "/organs.glb", visualRole: "organ", adapter: "vanatome" },
      manifest(),
      new Map(),
    )).toMatchObject({
      anatomyId: "liver",
      system: "digestive",
      visualRole: "organ",
      selectable: true,
    });
  });

  it("요청한 모델과 다른 manifest ID를 거부한다", () => {
    expect(() => validateAnatomyAtlasManifest(
      manifest(),
      "vanatome-male-reference",
    )).toThrow("아틀라스 ID가 요청과 다릅니다");
  });

  it("초점과 자산이 지정된 지연 계층을 허용한다", () => {
    const male = manifest({
      id: "vanatome-male-reference",
      referenceSex: "male",
      adapter: "vanatome",
      lazyLayers: [{
        id: "brain",
        label: "뇌 구조",
        triggerFocus: ["head"],
        assets: [{ url: "/brain.glb", visualRole: "organ", system: "nervous" }],
      }],
    });

    expect(() => validateAnatomyAtlasManifest(male)).not.toThrow();
  });

  it("기본 자산과 지연 자산의 URL 중복을 거부한다", () => {
    const male = manifest({
      id: "vanatome-male-reference",
      referenceSex: "male",
      adapter: "vanatome",
      assets: [{ url: "/brain.glb", visualRole: "atlas" }],
      lazyLayers: [{
        id: "brain",
        label: "뇌 구조",
        triggerFocus: ["head"],
        assets: [{ url: "/brain.glb", visualRole: "organ", system: "nervous" }],
      }],
    });

    expect(() => validateAnatomyAtlasManifest(male)).toThrow("중복 자산");
  });

  it("현재 확대 초점에 해당하는 계층만 선택한다", () => {
    const male = manifest({
      id: "vanatome-male-reference",
      referenceSex: "male",
      adapter: "vanatome",
      lazyLayers: [
        {
          id: "complete-head",
          label: "머리 전체 해부 구조",
          triggerFocus: ["head"],
          assets: [{ url: "/complete-head.glb", visualRole: "organ" }],
        },
        {
          id: "complete-upper",
          label: "상반신 전체 해부 구조",
          triggerFocus: ["upper"],
          assets: [{ url: "/upper.glb", visualRole: "organ" }],
        },
        {
          id: "complete-lower",
          label: "하반신 전체 해부 구조",
          triggerFocus: ["lower", "knee", "foot"],
          assets: [{ url: "/lower.glb", visualRole: "organ" }],
        },
        {
          id: "complete-hand",
          label: "손 전체 해부 구조",
          triggerFocus: ["hand"],
          assets: [{ url: "/hand.glb", visualRole: "organ" }],
        },
      ],
    });

    expect(lazyLayersForFocus(male, "head").map((layer) => layer.id)).toEqual([
      "complete-head",
    ]);
    expect(lazyLayersForFocus(male, "upper").map((layer) => layer.id)).toEqual([
      "complete-upper",
    ]);
    expect(lazyLayersForFocus(male, "lower").map((layer) => layer.id)).toEqual([
      "complete-lower",
    ]);
    expect(lazyLayersForFocus(male, "knee").map((layer) => layer.id)).toEqual([
      "complete-lower",
    ]);
    expect(lazyLayersForFocus(male, "foot").map((layer) => layer.id)).toEqual([
      "complete-lower",
    ]);
    expect(lazyLayersForFocus(male, "hand").map((layer) => layer.id)).toEqual([
      "complete-hand",
    ]);
    expect(lazyLayersForFocus(male, "full")).toEqual([]);
  });
});
