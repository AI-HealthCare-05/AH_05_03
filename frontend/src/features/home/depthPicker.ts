import * as THREE from "three";
import { resolveAnatomyDisplayInfo } from "./anatomyKoreanDictionary";

export type DepthLevel = "surface" | "shallow" | "mid" | "deep";

export interface DepthHitCandidate {
  mesh: THREE.Mesh;
  meshName: string;
  sourceKey?: string;
  system: string;
  systemKorean: string;
  label: string;
  distance: number;
  relativeDepth: number; // 0.0 (surface) ~ 1.0 (deepest)
  depthLevel: DepthLevel;
  point: [number, number, number];
}

export interface CollectDepthHitsOptions {
  /** 최대 허용 관통 깊이 (모델 단위 거리). 기본값 0.35 (신체 반대편 과도한 관통 방지) */
  maxPenetrationDistance?: number;
  /** 계통 매핑 리졸버 (메쉬 이름으로부터 계통 문자열 판별) */
  resolveSystem?: (mesh: THREE.Mesh) => { system: string; systemKorean: string };
  /** 제외할 메쉬 이름 집합 */
  ignoredMeshNames?: Set<string>;
}

/**
 * 해부학적으로 신체 외곽을 감싸는 표재성 구조(장경인대, 근막, 건막, 지지대, 외피 등)인지 판정합니다.
 */
export function isSuperficialAnatomy(nameOrLabel: string): boolean {
  const s = nameOrLabel.toLowerCase();
  if (
    s.includes("iliotibial") ||
    s.includes("tractus iliotibialis") ||
    s.includes("장경인대") ||
    s.includes("it band")
  )
    return true;
  if (s.includes("fascia") || s.includes("fascial") || s.includes("근막")) return true;
  if (s.includes("aponeurosis") || s.includes("건막")) return true;
  if (s.includes("retinaculum") || s.includes("지지대")) return true;
  if (
    s.includes("skin") ||
    s.includes("dermis") ||
    s.includes("integumentary") ||
    s.includes("외피")
  )
    return true;
  if (s.includes("platysma") || s.includes("광경근")) return true;
  if (s.includes("external") && (s.includes("oblique") || s.includes("복사근"))) return true;
  return false;
}

/**
 * Three.js raycast의 전체 교차점(allHits)에서 입/출구 중복을 제거하고
 * 카메라로부터의 거리 및 상대적 침투 깊이에 따라 DepthHitCandidate 목록을 구성합니다.
 */
export function collectDepthHitCandidates(
  rawHits: THREE.Intersection[],
  options: CollectDepthHitsOptions = {},
): DepthHitCandidate[] {
  if (!rawHits || rawHits.length === 0) return [];

  const maxPenetration = options.maxPenetrationDistance ?? 0.35;
  const ignored = options.ignoredMeshNames;

  // 1. 유효한 Mesh 객체만 필터링
  const validHits = rawHits.filter((hit): hit is THREE.Intersection<THREE.Mesh> => {
    if (!(hit.object instanceof THREE.Mesh)) return false;
    if (!hit.object.visible) return false;
    if (ignored && ignored.has(hit.object.name)) return false;
    return true;
  });

  if (validHits.length === 0) return [];

  // 2. 거리 오름차순 정렬 (표면 -> 심부)
  validHits.sort((a, b) => a.distance - b.distance);

  const surfaceDistance = validHits[0].distance;

  // 3. 동일 메쉬 중복 제거 (첫 진입점만 유지) 및 최대 관통 거리 제한
  const seenMeshes = new Set<string>();
  const uniqueHits: THREE.Intersection<THREE.Mesh>[] = [];

  for (const hit of validHits) {
    const meshName = hit.object.name || `mesh_${hit.object.id}`;
    if (seenMeshes.has(meshName)) continue;

    // 표면 대비 침투 깊이가 최대치를 넘으면 반대편 신체로 간주하여 중단
    const penetration = hit.distance - surfaceDistance;
    if (penetration > maxPenetration) break;

    seenMeshes.add(meshName);
    uniqueHits.push(hit);
  }

  if (uniqueHits.length === 0) return [];

  // 4. 상대적 깊이 레벨 계산
  const maxDistanceDelta = Math.max(
    0.001,
    uniqueHits[uniqueHits.length - 1].distance - surfaceDistance,
  );

  return uniqueHits.map((hit, index) => {
    const mesh = hit.object;
    const meshName = mesh.name;
    const distanceDelta = hit.distance - surfaceDistance;
    const relativeDepth = Number((distanceDelta / maxDistanceDelta).toFixed(3));

    const rawSys = mesh.userData?.structureSystem ? String(mesh.userData.structureSystem) : undefined;
    const displayInfo = resolveAnatomyDisplayInfo(meshName, rawSys);
    const systemInfo = options.resolveSystem
      ? options.resolveSystem(mesh)
      : rawSys
      ? { system: rawSys, systemKorean: displayInfo.systemKorean }
      : (displayInfo.system ? { system: displayInfo.system, systemKorean: displayInfo.systemKorean } : defaultResolveSystem(mesh));

    // 깊이 레벨 라벨 판정: 기하학적 관통 거리와 해부학적 표재(근막, 장경인대 등) 특성 복합 반영
    let depthLevel: DepthLevel;
    const isSuperficial = isSuperficialAnatomy(`${meshName} ${displayInfo.fullBilingualLabel}`);

    if (index === 0 || distanceDelta < 0.015) {
      depthLevel = "surface";
    } else if (isSuperficial) {
      // 장경인대, 대퇴근막 등 신체 외곽을 감싸는 표재 구조는 광선이 측면/후면으로 비껴 닿아
      // 관통 거리가 길어지더라도 해부학적 특성에 맞춰 표층/천층으로 보정
      depthLevel = distanceDelta < 0.08 ? "surface" : "shallow";
    } else if (relativeDepth <= 0.33 || distanceDelta < 0.06) {
      depthLevel = "shallow";
    } else if (relativeDepth <= 0.75 || distanceDelta < 0.16) {
      depthLevel = "mid";
    } else {
      depthLevel = "deep";
    }

    return {
      mesh,
      meshName,
      sourceKey: mesh.userData?.sourceKey ? String(mesh.userData.sourceKey) : undefined,
      system: systemInfo.system,
      systemKorean: systemInfo.systemKorean,
      label: displayInfo.fullBilingualLabel,
      distance: Number(hit.distance.toFixed(4)),
      relativeDepth,
      depthLevel,
      point: [
        Number(hit.point.x.toFixed(4)),
        Number(hit.point.y.toFixed(4)),
        Number(hit.point.z.toFixed(4)),
      ],
    };
  });
}

function defaultResolveSystem(mesh: THREE.Mesh): { system: string; systemKorean: string } {
  const name = (mesh.name || "").toLowerCase();
  const sys = String(mesh.userData?.structureSystem ?? "").toLowerCase();

  if (sys === "skeletal" || name.includes("bone") || name.includes("skeleton") || name.includes("cartilage") || name.includes("rib")) {
    return { system: "skeletal", systemKorean: "골격계" };
  }
  if (sys === "joints" || name.includes("joint") || name.includes("ligament") || name.includes("capsule")) {
    return { system: "joints", systemKorean: "관절계" };
  }
  if (
    sys === "dental" ||
    name.includes("tooth") ||
    name.includes("teeth") ||
    name.includes("dental") ||
    name.includes("molar") ||
    name.includes("incisor") ||
    name.includes("canine") ||
    name.includes("premolar")
  ) {
    return { system: "dental", systemKorean: "치아/구강" };
  }
  if (sys === "cardiovascular" || name.includes("artery") || name.includes("vein")) {
    return { system: "cardiovascular", systemKorean: "순환기계" };
  }
  if (sys === "nervous" || name.includes("nerve")) {
    return { system: "nervous", systemKorean: "신경계" };
  }
  if (sys === "visceral" || name.includes("organ") || name.includes("viscera") || name.includes("heart") || name.includes("lung") || name.includes("liver")) {
    return { system: "visceral", systemKorean: "내장계" };
  }
  if (sys === "integumentary" || name.includes("skin") || name.includes("surface") || name.includes("shell")) {
    return { system: "integumentary", systemKorean: "외피계(피부)" };
  }
  return { system: "muscular", systemKorean: "근육계" };
}
