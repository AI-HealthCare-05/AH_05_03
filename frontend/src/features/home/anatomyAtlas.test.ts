import { describe, expect, it } from "vitest";

import { adaptAnatomyMesh, validateAnatomyAtlasManifest } from "./anatomyAtlas";
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
});
