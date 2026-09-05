import type * as THREE from "three";

import { fetchCachedAnatomyResource } from "./anatomyResourceCache";

export type AnatomyAtlasId =
  | "vanatome-male-reference"
  | "female-skeleton-controller-test"
  | "tripo-triangle2m-v49-internals-preview";
export type AnatomyAdapterId = "vanatome" | "shell";
export type AnatomyVisualRole = "atlas" | "shell" | "skeleton" | "organ";
export type AnatomyCoordinatePolicy = "presentation-fitted";
export type AnatomyFocus = "full" | "head" | "upper" | "lower" | "knee" | "foot" | "hand";

export type AnatomyAtlasAsset = {
  url: string;
  visualRole: AnatomyVisualRole;
  adapter?: AnatomyAdapterId;
  system?: string;
  animationClips?: string[];
  sourceUrl?: string;
  sha256?: string;
};

export type AnatomyLazyLayer = {
  id: string;
  label: string;
  triggerFocus: AnatomyFocus[];
  assets: AnatomyAtlasAsset[];
};

export type AnatomyAtlasManifest = {
  id: AnatomyAtlasId;
  version: string;
  label: string;
  shortLabel: string;
  referenceSex: "male" | "female";
  adapter: AnatomyAdapterId;
  coordinatePolicy?: AnatomyCoordinatePolicy;
  referenceFrameId?: string;
  experimental: boolean;
  description: string;
  loadingLabel: string;
  loadingSizeLabel: string;
  layerLabels: string[];
  attributionLabel: string;
  attributionUrl: string;
  metadataUrl?: string;
  assets: AnatomyAtlasAsset[];
  lazyLayers?: AnatomyLazyLayer[];
};

export type AnatomyMetadata = { id: string; name: string; system: string };
export type AnatomyMetadataBundle = { structures: AnatomyMetadata[] };

export type AdaptedAnatomyMesh = {
  anatomyId: string;
  sourceKey: string;
  label: string;
  system: string;
  visualRole: Exclude<AnatomyVisualRole, "atlas">;
  selectable: boolean;
};

type AnatomyMetadataObject = {
  userData: Record<string, unknown>;
  parent?: AnatomyMetadataObject | null;
};

const INHERITED_ANATOMY_METADATA_KEYS = [
  "anatomyId",
  "anatomyParentId",
  "anatomySystem",
  "sourceName",
  "label",
  "tissueType",
] as const;

const ANATOMY_REQUEST_TIMEOUT_MS = 20_000;

async function fetchAnatomyJson(url: string, failureMessage: string, revision?: string) {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), ANATOMY_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchCachedAnatomyResource(url, {
      signal: controller.signal,
      revision,
    });
    if (!response.ok) throw new Error(failureMessage);
    return await response.json() as unknown;
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`${failureMessage} (요청 시간 초과)`, { cause: error });
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * GLTFLoader represents a multi-material glTF mesh as a metadata-bearing Group
 * with one child THREE.Mesh per primitive. Copy the nearest available anatomy
 * metadata down before adapting those primitive meshes.
 */
export function inheritAnatomyMetadata(object: AnatomyMetadataObject) {
  let ancestor = object.parent;
  while (ancestor) {
    for (const key of INHERITED_ANATOMY_METADATA_KEYS) {
      if (object.userData[key] == null && ancestor.userData[key] != null) {
        object.userData[key] = ancestor.userData[key];
      }
    }
    ancestor = ancestor.parent;
  }
  return object.userData;
}

const MANIFEST_URLS: Record<AnatomyAtlasId, string> = {
  // Manifests are served with a long immutable cache lifetime. Bump this
  // revision whenever their loading contract changes so existing browsers do
  // not keep an older lazy-layer trigger map.
  "vanatome-male-reference": "/vendor/vanatome/releases/1.4.0/ieobom-hologram.manifest.json?rev=male-shell-skeleton-first-v3",
  "female-skeleton-controller-test": "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-female-skeleton-controller-test-v38.manifest.json",
  "tripo-triangle2m-v49-internals-preview": "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-triangle2m-shell-v49-internals.manifest.json?rev=female-anatomy-fit-v67",
};

export async function loadAnatomyAtlasManifest(atlasId: AnatomyAtlasId) {
  const manifest = await fetchAnatomyJson(
    MANIFEST_URLS[atlasId],
    `아틀라스 manifest를 불러오지 못했습니다: ${atlasId}`,
  ) as AnatomyAtlasManifest;
  validateAnatomyAtlasManifest(manifest, atlasId);
  return manifest;
}

export function validateAnatomyAtlasManifest(
  manifest: AnatomyAtlasManifest,
  requestedAtlasId: AnatomyAtlasId = manifest.id,
) {
  if (manifest.id !== requestedAtlasId) {
    throw new Error(`아틀라스 ID가 요청과 다릅니다: ${manifest.id}`);
  }
  if (!Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error(`아틀라스 자산이 없습니다: ${manifest.id}`);
  }

  for (const asset of manifest.assets) {
    if (asset.visualRole !== "shell" && (asset.adapter ?? manifest.adapter) === "shell") {
      throw new Error(`비외피 자산이 shell 어댑터를 사용합니다: ${asset.url}`);
    }
    if (!asset.animationClips) continue;
    const uniqueClips = new Set(asset.animationClips);
    if (asset.animationClips.length === 0
      || uniqueClips.size !== asset.animationClips.length
      || asset.animationClips.some((clip) => !clip.trim())) {
      throw new Error(`애니메이션 클립 계약이 올바르지 않습니다: ${asset.url}`);
    }
  }

  for (const layer of manifest.lazyLayers ?? []) {
    if (!layer.id || !layer.label || layer.triggerFocus.length === 0 || layer.assets.length === 0) {
      throw new Error(`지연 계층 계약이 올바르지 않습니다: ${manifest.id}`);
    }
  }

  const duplicateUrls = [
    ...manifest.assets,
    ...(manifest.lazyLayers ?? []).flatMap((layer) => layer.assets),
  ]
    .map((asset) => asset.url)
    .filter((url, index, urls) => urls.indexOf(url) !== index);
  if (duplicateUrls.length > 0) {
    throw new Error(`아틀라스에 중복 자산이 있습니다: ${duplicateUrls[0]}`);
  }

}

export async function loadAnatomyMetadata(manifest: AnatomyAtlasManifest) {
  if (!manifest.metadataUrl) return new Map<string, AnatomyMetadata>();
  const metadata = await fetchAnatomyJson(
    manifest.metadataUrl,
    `해부 메타데이터를 불러오지 못했습니다: ${manifest.id}`,
    `${manifest.id}:${manifest.version}`,
  ) as AnatomyMetadataBundle;
  return new Map(metadata.structures.map((structure) => [structure.id, structure]));
}

export function lazyLayersForFocus(
  manifest: AnatomyAtlasManifest,
  focus: AnatomyFocus,
) {
  return (manifest.lazyLayers ?? []).filter((layer) => layer.triggerFocus.includes(focus));
}

/**
 * 첫 프레임에서 감출 계통.
 *
 * 전신 모델은 외피와 골격으로 윤곽을 먼저 설명하고, 나머지는 다운로드만
 * 백그라운드에서 끝낸다.
 */
export function initiallyHiddenSystems(
  atlasId: AnatomyAtlasId,
  availableSystems: readonly string[],
): Set<string> {
  if (atlasId === "female-skeleton-controller-test") return new Set();
  return new Set(availableSystems.filter((system) => (
    system !== "integumentary" && system !== "skeletal"
  )));
}

/**
 * 화면의 계통 버튼은 유방 구조를 외피계에 포함해 제어한다.
 * 원본 anatomySystem 값은 바꾸지 않으므로 차후 유방 표시 옵션을 다시
 * 분리하더라도 GLB나 메타데이터를 재가공할 필요가 없다.
 */
export function anatomyLayerSystem(system: string) {
  return system === "mammary" ? "integumentary" : system;
}

export function adaptAnatomyMesh(
  mesh: Pick<THREE.Mesh, "name" | "userData">,
  asset: AnatomyAtlasAsset,
  manifest: AnatomyAtlasManifest,
  metadata: Map<string, AnatomyMetadata>,
): AdaptedAnatomyMesh | undefined {
  const adapter = asset.adapter ?? manifest.adapter;
  if (adapter === "shell" || asset.visualRole === "shell") {
    return adaptShellMesh(mesh, manifest);
  }
  return adaptVanatomeMesh(mesh, manifest, metadata);
}

function adaptShellMesh(
  mesh: Pick<THREE.Mesh, "name" | "userData">,
  manifest: AnatomyAtlasManifest,
): AdaptedAnatomyMesh {
  const sourceName = mesh.name || "body-shell";
  return {
    anatomyId: `body-shell:${slugify(sourceName) || "tripo"}`,
    sourceKey: `shell:${manifest.id}:${manifest.version}:${sourceName}`,
    label: "여성형 시각 외피",
    system: "integumentary",
    visualRole: "shell",
    selectable: false,
  };
}

function adaptVanatomeMesh(
  mesh: Pick<THREE.Mesh, "name" | "userData">,
  manifest: AnatomyAtlasManifest,
  metadata: Map<string, AnatomyMetadata>,
): AdaptedAnatomyMesh | undefined {
  const anatomyId = String(mesh.userData.anatomyId ?? "");
  const system = String(mesh.userData.anatomySystem ?? "regional-anatomy");
  const shell = anatomyId === "body-shell";
  const visibleSystems = new Set([
    "cardiovascular", "digestive", "endocrine", "mammary", "muscular", "nervous",
    "joints", "lymphatic", "reproductive", "respiratory", "skeletal", "urinary",
  ]);
  if (!shell && !visibleSystems.has(system)) return undefined;

  const structure = metadata.get(anatomyId);
  return {
    anatomyId: anatomyId || slugify(mesh.name),
    sourceKey: `vanatome:${manifest.id}:${manifest.version}:${anatomyId || mesh.name}`,
    label: structure?.name ?? String(mesh.userData.label ?? readableStructureName(mesh.name)),
    system: shell ? "integumentary" : structure?.system ?? system,
    visualRole: shell ? "shell" : system === "skeletal" || system === "joints" ? "skeleton" : "organ",
    selectable: !shell,
  };
}

export function readableStructureName(meshName: string) {
  return meshName
    .replace(/^body-shell__/, "")
    .replace(/^VH_[FM]_/, "")
    .replace(/([lr])$/, (_, side: string) => side === "l" ? " (왼쪽)" : " (오른쪽)")
    .replaceAll("_", " ");
}

function slugify(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}
