import * as THREE from "three";

import { decodeModelResponse } from "./modelDownload";
import type { Atlas } from "./types";
import {
  createDentalMaterials,
  createHolographicMaterials,
  createOcularMaterials,
  isDentalStructure,
  isOccludingEyeStructure,
  isOcularStructure,
} from "../holographicAnatomyStyle";

const ATLAS_BASE_URL = "https://human-atlas-seven.vercel.app";

export function resolveAtlasUrl(path: string): string {
  const clean = path.startsWith("/") ? path : `/${path}`;
  return `${ATLAS_BASE_URL}${clean}`;
}

export async function fetchAtlasManifest(signal?: AbortSignal): Promise<Atlas> {
  const res = await fetch(resolveAtlasUrl("models/atlas.json"), { signal });
  if (!res.ok) throw new Error(`Atlas manifest HTTP ${res.status}`);
  return (await res.json()) as Atlas;
}

export interface LoadedHumanAtlas {
  manifest: Atlas;
  meshes: THREE.Mesh[];
  bounds: THREE.Box3;
}

export async function loadHumanAtlasMeshes(options: {
  signal?: AbortSignal;
  onProgress?: (percent: number) => void;
  ownedMaterials: Set<THREE.Material>;
}): Promise<LoadedHumanAtlas> {
  const { signal, onProgress, ownedMaterials } = options;
  const manifest = await fetchAtlasManifest(signal);
  const totalChunks = manifest.chunks.length;
  let loadedChunks = 0;

  const chunkBuffers: (ArrayBuffer | null)[] = new Array(totalChunks).fill(null);

  // 3개 병렬 워커로 15개 청크 다운로드 및 디코딩
  let cursor = 0;
  await Promise.all(
    Array.from({ length: 3 }, async () => {
      while (cursor < totalChunks) {
        if (signal?.aborted) return;
        const ci = cursor++;
        const chunk = manifest.chunks[ci];
        const compressed = !!chunk.gzip && typeof DecompressionStream !== "undefined";
        const chunkPath = compressed && chunk.gzip ? chunk.gzip : chunk.url;
        const targetUrl = resolveAtlasUrl(chunkPath);

        const response = await fetch(targetUrl, { signal });
        const buffer = await decodeModelResponse(response, chunk.bytes, compressed);
        chunkBuffers[ci] = buffer;
        loadedChunks++;
        if (onProgress) {
          onProgress(Math.round((loadedChunks / totalChunks) * 98));
        }
      }
    }),
  );

  if (signal?.aborted) {
    throw new DOMException("Aborted", "AbortError");
  }

  const meshes: THREE.Mesh[] = [];
  const fullBounds = new THREE.Box3();
  const baseStandard = new THREE.MeshStandardMaterial();

  const seenParts = new Map<string, { bounds: [number[], number[]] }[]>();

  for (let i = 0; i < manifest.parts.length; i++) {
    const p = manifest.parts[i];
    const buffer = chunkBuffers[p.chunk];
    if (!buffer) continue;

    // BodyParts3D 원본 데이터에 중복 수록된 동일 좌표/명칭 메쉬(Z-fighting 원인) 필터링
    const seenList = seenParts.get(p.name);
    if (seenList) {
      const isDuplicate = seenList.some((s) => {
        const d0 = Math.abs(s.bounds[0][0] - p.bounds[0][0])
                 + Math.abs(s.bounds[0][1] - p.bounds[0][1])
                 + Math.abs(s.bounds[0][2] - p.bounds[0][2]);
        const d1 = Math.abs(s.bounds[1][0] - p.bounds[1][0])
                 + Math.abs(s.bounds[1][1] - p.bounds[1][1])
                 + Math.abs(s.bounds[1][2] - p.bounds[1][2]);
        return (d0 + d1) < 0.005;
      });
      if (isDuplicate) continue;
      seenList.push({ bounds: p.bounds });
    } else {
      seenParts.set(p.name, [{ bounds: p.bounds }]);
    }

    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.BufferAttribute(new Float32Array(buffer, p.positions, p.vertexCount * 3), 3),
    );
    g.setAttribute(
      "normal",
      new THREE.BufferAttribute(new Int16Array(buffer, p.normals, p.vertexCount * 3), 3, true),
    );
    g.setIndex(new THREE.BufferAttribute(new Uint32Array(buffer, p.indices, p.indexCount), 1));

    const partBox = new THREE.Box3(
      new THREE.Vector3().fromArray(p.bounds[0]),
      new THREE.Vector3().fromArray(p.bounds[1]),
    );
    g.boundingBox = partBox;
    fullBounds.union(partBox);

    const isSkin = p.system === "integumentary";
    const visualRole = isSkin ? "shell" : p.system === "skeletal" ? "skeleton" : "organ";

    let material: THREE.Material | THREE.Material[];
    if (isDentalStructure(p.name)) {
      material = createDentalMaterials(baseStandard, ownedMaterials);
    } else if (isOcularStructure(p.name)) {
      material = createOcularMaterials(baseStandard, p.name, ownedMaterials);
    } else {
      material = createHolographicMaterials(
        baseStandard,
        visualRole,
        p.system,
        ownedMaterials,
        undefined,
        p.name,
      );
    }

    const mesh = new THREE.Mesh(g, material);
    mesh.name = p.name;
    mesh.userData.anatomyId = p.id;
    mesh.userData.structureSystem = p.system;
    mesh.userData.structureLabel = p.name;
    mesh.userData.visualRole = visualRole;
    mesh.userData.contextVisible = true;
    mesh.matrixAutoUpdate = false;
    mesh.updateMatrix();

    if (isOcularStructure(p.name)) {
      if (isOccludingEyeStructure(p.name)) {
        mesh.visible = false;
        mesh.userData.contextVisible = false;
      } else if (/iris|pupil/i.test(p.name)) {
        mesh.renderOrder = 2;
      } else if (/cornea/i.test(p.name)) {
        mesh.renderOrder = 3;
      } else {
        mesh.renderOrder = 1;
      }
    }

    meshes.push(mesh);
  }

  baseStandard.dispose();
  return { manifest, meshes, bounds: fullBounds };
}
