import { createHash } from "node:crypto";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicRoot = path.join(projectRoot, "public");
const manifestPaths = [
  "vendor/vanatome/releases/1.4.0/ieobom-hologram.manifest.json",
  "vendor/vanatome/composites/tripo-shell-z-anatomy-core-v1/ieobom-triangle2m-shell-v49-internals.manifest.json",
];

let totalBytes = 0;
let totalAssets = 0;

for (const manifestPath of manifestPaths) {
  const manifestFile = path.join(publicRoot, manifestPath);
  const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
  if (!manifest.id || !Array.isArray(manifest.assets) || manifest.assets.length === 0) {
    throw new Error(`manifest 계약이 올바르지 않습니다: ${manifestPath}`);
  }

  await assertPublicFile(manifest.attributionUrl, `${manifest.id} attribution`);
  if (manifest.metadataUrl) await assertPublicFile(manifest.metadataUrl, `${manifest.id} metadata`);

  for (const asset of manifest.assets) {
    if (!asset.url?.startsWith("/")) {
      throw new Error(`${manifest.id} 자산은 같은 origin의 절대 경로여야 합니다: ${asset.url}`);
    }
    const assetFile = await assertPublicFile(asset.url, `${manifest.id} asset`);
    const assetStat = await stat(assetFile);
    totalAssets += 1;
    totalBytes += assetStat.size;

    if (asset.sha256) {
      const digest = createHash("sha256").update(await readFile(assetFile)).digest("hex");
      if (digest !== asset.sha256) {
        throw new Error(`${asset.url} SHA-256 불일치: ${digest}`);
      }
    }
  }

  console.log(`✓ ${manifest.id}: ${manifest.assets.length}개 자산과 출처 파일 확인`);
}

console.log(`✓ 총 ${totalAssets}개, ${(totalBytes / 1024 / 1024).toFixed(1)} MiB 검증 완료`);

async function assertPublicFile(publicUrl, label) {
  if (!publicUrl?.startsWith("/")) throw new Error(`${label} 경로가 올바르지 않습니다: ${publicUrl}`);
  const file = path.join(publicRoot, publicUrl.slice(1));
  const relative = path.relative(publicRoot, file);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`${label} 경로가 public 밖을 가리킵니다: ${publicUrl}`);
  }
  const fileStat = await stat(file);
  if (!fileStat.isFile()) throw new Error(`${label}이 파일이 아닙니다: ${publicUrl}`);
  return file;
}
