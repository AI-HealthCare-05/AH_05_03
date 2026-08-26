import type * as THREE from "three";

export type AnatomyAtlasId =
  | "vanatome-male-reference"
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

const MANIFEST_URLS: Record<AnatomyAtlasId, string> = {
  "vanatome-male-reference": "/vendor/vanatome/releases/1.4.0/ieobom-hologram.manifest.json",
  "tripo-triangle2m-v49-internals-preview": "/vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-triangle2m-shell-v49-internals.manifest.json",
};

export async function loadAnatomyAtlasManifest(atlasId: AnatomyAtlasId) {
  const response = await fetch(MANIFEST_URLS[atlasId]);
  if (!response.ok) throw new Error(`아틀라스 manifest를 불러오지 못했습니다: ${atlasId}`);
  const manifest = await response.json() as AnatomyAtlasManifest;
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
  const response = await fetch(manifest.metadataUrl);
  if (!response.ok) throw new Error(`해부 메타데이터를 불러오지 못했습니다: ${manifest.id}`);
  const metadata = await response.json() as AnatomyMetadataBundle;
  return new Map(metadata.structures.map((structure) => [structure.id, structure]));
}

export function lazyLayersForFocus(
  manifest: AnatomyAtlasManifest,
  focus: AnatomyFocus,
) {
  return (manifest.lazyLayers ?? []).filter((layer) => layer.triggerFocus.includes(focus));
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
    "respiratory", "skeletal", "urinary",
  ]);
  if (!shell && !visibleSystems.has(system)) return undefined;

  const structure = metadata.get(anatomyId);
  return {
    anatomyId: anatomyId || slugify(mesh.name),
    sourceKey: `vanatome:${manifest.id}:${manifest.version}:${anatomyId || mesh.name}`,
    label: structure?.name ?? String(mesh.userData.label ?? readableStructureName(mesh.name)),
    system: structure?.system ?? system,
    visualRole: shell ? "shell" : system === "skeletal" ? "skeleton" : "organ",
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
