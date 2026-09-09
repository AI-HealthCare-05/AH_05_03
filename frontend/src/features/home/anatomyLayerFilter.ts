import * as THREE from "three";
import { resolveAnatomyDisplayInfo } from "./anatomyKoreanDictionary";

export type AnatomySystemCategory = "all" | "skeletal" | "muscular" | "visceral" | "dental";

export interface SystemFilterConfig {
  id: AnatomySystemCategory;
  label: string;
  icon: string;
  description: string;
}

export const ANATOMY_SYSTEM_CONFIGS: SystemFilterConfig[] = [
  { id: "all", label: "전체", icon: "👤", description: "모든 인체 계통 가시화" },
  { id: "skeletal", label: "골격계", icon: "🦴", description: "뼈, 연골, 관절 구조" },
  { id: "muscular", label: "근육계", icon: "💪", description: "주요 골격근 및 힘줄" },
  { id: "visceral", label: "내장계", icon: "🫀", description: "심장, 폐, 소화기 등 주요 장기" },
  { id: "dental", label: "치아", icon: "🦷", description: "상악/하악 영구치 및 구강" },
];

const SKELETAL_KEYWORDS = [
  "bone", "rib", "cartilage", "skull", "cranium", "mandible", "maxilla",
  "vertebra", "spine", "sacrum", "coccyx", "clavicle", "scapula", "sternum",
  "humerus", "radius", "ulna", "femur", "patella", "tibia", "fibula",
  "pelvis", "ilium", "ischium", "pubis", "carpal", "metacarpal", "phalang",
  "tarsal", "metatarsal", "calcaneus", "talus", "ethmoid", "sphenoid",
  "parietal", "frontal", "occipital", "temporal", "zygomatic", "nasal",
  "lacrimal", "hyoid", "incus", "malleus", "stapes", "ossicle", "skeleton",
  "skeletal", "joint", "articular", "meniscus", "ligament", "capsule",
  "뼈", "골격", "관절", "연골", "두개골", "척추", "갈비", "골반", "늑골",
  "경추", "흉추", "요추", "천골", "미골", "쇄골", "견갑골", "상완골", "요골",
  "척골", "대퇴골", "슬개골", "경골", "비골", "종골", "거골", "하악골", "상악골"
];

/**
 * 주어진 메쉬나 식별자가 골격계(뼈, 관절, 연골)에 해당하는지 판정합니다.
 */
export function isSkeletonStructure(target: THREE.Mesh | string): boolean {
  if (typeof target !== "string") {
    const role = String(target.userData?.visualRole ?? "").toLowerCase();
    const sys = String(target.userData?.structureSystem ?? "").toLowerCase();
    const tissue = String(target.userData?.tissueType ?? "").toLowerCase();

    // 1. 단일 진실 원천 메타데이터: 골격계 확정
    if (role === "skeleton") return true;
    if (sys === "skeletal" || sys === "joints") return true;
    if (tissue === "costal-cartilage") return true;

    // 2. 단일 진실 원천 메타데이터: 비골격 계통(근육, 외피, 장기, 혈관, 신경 등) 확정 배제
    if (
      role === "shell" ||
      role === "organ" ||
      sys === "muscular" ||
      sys === "integumentary" ||
      sys === "cardiovascular" ||
      sys === "nervous" ||
      sys === "visceral" ||
      sys === "digestive" ||
      sys === "respiratory" ||
      sys === "lymphatic" ||
      sys === "endocrine" ||
      sys === "urinary" ||
      sys === "reproductive"
    ) {
      return false;
    }
  }

  const name = typeof target === "string" ? target : target.name || "";
  const anatomyId = typeof target !== "string" ? String(target.userData?.anatomyId ?? "") : "";
  const label = typeof target !== "string" ? String(target.userData?.structureLabel ?? "") : "";

  const combined = `${name} ${anatomyId} ${label}`.toLowerCase();

  // 비골격/근육/연부조직 명칭 지표가 있는 경우 무조건 배제
  const NON_SKELETON_INDICATORS = [
    "muscle", "musculus", "fascia", "tendon", "aponeurosis",
    "artery", "vein", "nerve", "ganglion", "gland", "organ",
    "brain", "eye", "lens", "retina", "cornea", "sclera",
    "body-shell", "epicranial", "platysma", "masseter", "buccinator",
    "temporalis", "frontalis", "occipitalis", "infraspinatus", "supraspinatus",
    "subscapularis", "rhomboideus", "trapezius", "deltoid", "pectoralis",
    "latissimus", "splenius", "scalene", "sternocleidomastoid", "femoris",
    "quadriceps", "biceps", "triceps", "gluteus", "gastrocnemius", "soleus",
    "근육", "근막", "건", "동맥", "정맥", "신경", "장기", "피부", "외피", "안구"
  ];
  if (NON_SKELETON_INDICATORS.some((indicator) => combined.includes(indicator))) {
    return false;
  }

  return SKELETAL_KEYWORDS.some((kw) => combined.includes(kw));
}

/**
 * 메쉬가 주어진 계통 카테고리에 부합하는지 판정합니다.
 */
export function matchesSystemCategory(
  target: THREE.Mesh | string,
  category: AnatomySystemCategory,
): boolean {
  if (category === "all") return true;

  if (category === "skeletal") {
    return isSkeletonStructure(target);
  }

  const meshName = typeof target === "string" ? target : target.name || "";
  const lowerName = meshName.toLowerCase();
  const sys = (
    typeof target !== "string" && target.userData?.structureSystem
      ? String(target.userData.structureSystem)
      : resolveAnatomyDisplayInfo(meshName).system
  ).toLowerCase();

  switch (category) {
    case "muscular":
      // 뼈/관절 구조는 근육에서 절대 배제
      if (isSkeletonStructure(target)) return false;
      return (
        sys === "muscular" ||
        sys.includes("musc") ||
        lowerName.includes("muscle") ||
        lowerName.includes("pectoralis") ||
        lowerName.includes("gluteus") ||
        lowerName.includes("deltoid") ||
        lowerName.includes("trapezius") ||
        lowerName.includes("biceps") ||
        lowerName.includes("triceps") ||
        lowerName.includes("rectus") ||
        lowerName.includes("fascia")
      );
    case "visceral":
      if (isSkeletonStructure(target)) return false;
      return (
        sys === "visceral" ||
        sys.includes("visc") ||
        sys.includes("organ") ||
        sys === "cardiovascular" ||
        sys === "respiratory" ||
        sys === "digestive" ||
        sys === "urinary" ||
        sys === "endocrine" ||
        lowerName.includes("heart") ||
        lowerName.includes("lung") ||
        lowerName.includes("liver") ||
        lowerName.includes("stomach") ||
        lowerName.includes("kidney") ||
        lowerName.includes("spleen")
      );
    case "dental":
      return (
        sys.includes("dental") ||
        lowerName.includes("tooth") ||
        lowerName.includes("teeth") ||
        lowerName.includes("dental") ||
        lowerName.includes("incisor") ||
        lowerName.includes("canine") ||
        lowerName.includes("premolar") ||
        lowerName.includes("molar")
      );
    default:
      return true;
  }
}

export interface XRayState {
  enabled: boolean;
  ghostOpacity: number;
}

/**
 * X-ray 투시 효과를 적용합니다:
 * 피부(외피계)와 근육, 결합조직 등 연부조직을 반투명 고스트(opacity 0.15)로 전환하고,
 * 인체의 모든 뼈(골격계, 관절계)를 또렷하게 드러내어 완전한 방사선 엑스레이 필름 뷰를 구현합니다.
 */
export function applyXRayShading(
  meshes: THREE.Mesh[],
  options: {
    ghostOpacity?: number;
    activeCategory?: AnatomySystemCategory;
    originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    ghostMaterialsMap: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
    selectedMeshes?: Set<THREE.Mesh>;
    createSelectedTransparentMaterial?: (orig: THREE.Material | THREE.Material[]) => THREE.Material | THREE.Material[];
    createSelectedMaterial?: (orig: THREE.Material | THREE.Material[]) => THREE.Material | THREE.Material[];
  },
): void {
  const ghostOpacity = options.ghostOpacity ?? 0.15;
  const category = options.activeCategory ?? "all";
  const selected = options.selectedMeshes;

  for (const mesh of meshes) {
    if (!mesh.visible) continue;

    // 원본 재질 보존 확인
    if (!options.originalMaterials.has(mesh)) {
      options.originalMaterials.set(mesh, mesh.material);
    }

    // X-ray 모드의 기본(all 또는 skeletal) 타깃은 전신 골격(뼈, 관절) 구조
    const isTarget =
      category === "all" || category === "skeletal"
        ? isSkeletonStructure(mesh)
        : matchesSystemCategory(mesh, category);

    // 사용자가 명시적으로 선택한 메쉬:
    // 골격은 또렷한 강조, 비골격(근육·장기 등)은 뒤쪽 골격을 가리지 않도록 반투명 셰이딩 적용
    if (selected && selected.has(mesh)) {
      const orig = options.originalMaterials.get(mesh) ?? mesh.material;
      if (isTarget) {
        mesh.material = options.createSelectedMaterial
          ? options.createSelectedMaterial(orig)
          : mesh.material;
        mesh.renderOrder = 20;
      } else {
        mesh.material = options.createSelectedTransparentMaterial
          ? options.createSelectedTransparentMaterial(orig)
          : mesh.material;
        mesh.renderOrder = 15;
      }
      continue;
    }

    if (isTarget) {
      // 심부 골격 타깃: 원본 고유 재질 유지 및 최상위 렌더오더로 연부조직을 뚫고 가시화
      const orig = options.originalMaterials.get(mesh);
      if (orig) mesh.material = orig;
      mesh.renderOrder = 10;
    } else {
      // 표층 연부조직(피부, 근육, 기타 비골격): 고스트 반투명 재질 적용
      let ghostMat = options.ghostMaterialsMap.get(mesh);
      if (!ghostMat) {
        const sourceMat = options.originalMaterials.get(mesh) ?? mesh.material;
        ghostMat = createGhostMaterial(sourceMat, ghostOpacity);
        options.ghostMaterialsMap.set(mesh, ghostMat);
      }
      mesh.material = ghostMat;
      mesh.renderOrder = 1;
    }
  }
}

/**
 * X-ray 모드 해제 시 원본 재질 및 renderOrder를 복원합니다.
 */
export function restoreXRayShading(
  meshes: THREE.Mesh[],
  originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>,
  selectedMeshes?: Set<THREE.Mesh>,
  createSelectedMaterial?: (orig: THREE.Material | THREE.Material[]) => THREE.Material | THREE.Material[],
): void {
  for (const mesh of meshes) {
    if (selectedMeshes && selectedMeshes.has(mesh) && createSelectedMaterial) {
      const orig = originalMaterials.get(mesh) ?? mesh.material;
      mesh.material = createSelectedMaterial(orig);
      mesh.renderOrder = 20;
    } else {
      const orig = originalMaterials.get(mesh);
      if (orig) {
        mesh.material = orig;
        mesh.renderOrder = 0;
      }
    }
  }
}

export function createGhostMaterial(
  source: THREE.Material | THREE.Material[],
  opacity: number,
): THREE.Material | THREE.Material[] {
  if (Array.isArray(source)) {
    return source.map((m) => cloneToGhost(m, opacity));
  }
  return cloneToGhost(source, opacity);
}

function cloneToGhost(mat: THREE.Material, opacity: number): THREE.Material {
  const cloned = mat.clone();
  cloned.transparent = true;
  cloned.opacity = opacity;
  cloned.depthWrite = false;
  cloned.needsUpdate = true;
  return cloned;
}

export function isFasciaStructure(target: THREE.Mesh | string): boolean {
  const name = typeof target === "string" ? target.toLowerCase() : (target.name || "").toLowerCase();
  const label = typeof target === "string" ? "" : String(target.userData?.structureLabel ?? "").toLowerCase();
  const anatomyId = typeof target === "string" ? "" : String(target.userData?.anatomyId ?? "").toLowerCase();
  const tissueType = typeof target === "string" ? "" : String(target.userData?.tissueType ?? "").toLowerCase();

  const combined = `${name} ${label} ${anatomyId}`;

  // 대퇴근막장근(Tensor fasciae latae)은 골격근이므로 근막 숨김 대상에서 제외
  if (
    combined.includes("tensor fasciae latae") ||
    combined.includes("tensor fascia lata") ||
    combined.includes("대퇴근막장근")
  ) {
    return false;
  }

  // 명시적 tissueType 메타데이터
  if (tissueType === "fascia" || tissueType === "aponeurosis" || tissueType === "retinaculum") {
    return true;
  }

  // 키워드 매칭 (근막, 건막, 지지대, 장경인대, 복직근초 등)
  if (
    combined.includes("fascia") ||
    combined.includes("fascial") ||
    combined.includes("근막") ||
    combined.includes("aponeurosis") ||
    combined.includes("aponeurot") ||
    combined.includes("건막") ||
    combined.includes("iliotibial") ||
    combined.includes("tractus iliotibialis") ||
    combined.includes("장경인대") ||
    combined.includes("it band") ||
    combined.includes("retinaculum") ||
    combined.includes("retinacul") ||
    combined.includes("지지대") ||
    combined.includes("rectus sheath") ||
    combined.includes("복직근초")
  ) {
    return true;
  }

  return false;
}

export function isPeritoneumStructure(target: THREE.Mesh | string): boolean {
  const name = typeof target === "string" ? target.toLowerCase() : (target.name || "").toLowerCase();
  const label = typeof target === "string" ? "" : String(target.userData?.structureLabel ?? "").toLowerCase();
  const anatomyId = typeof target === "string" ? "" : String(target.userData?.anatomyId ?? "").toLowerCase();
  const tissueType = typeof target === "string" ? "" : String(target.userData?.tissueType ?? "").toLowerCase();

  const combined = `${name} ${label} ${anatomyId}`;

  // 혈관, 신경, 림프절 등 비막성 구조는 배제 (예: Left gastro-omental vein, Right gastro-omental nodes)
  if (
    combined.includes("vein") ||
    combined.includes("artery") ||
    combined.includes("nerve") ||
    combined.includes("node") ||
    combined.includes("lymph") ||
    combined.includes("정맥") ||
    combined.includes("동맥") ||
    combined.includes("신경") ||
    combined.includes("림프")
  ) {
    return false;
  }

  // 명시적 tissueType 메타데이터
  if (tissueType === "peritoneum" || tissueType === "omentum" || tissueType === "mesentery") {
    return true;
  }

  // 키워드 매칭 (대망, 소망, 결장간막, 충수간막, 복막, 장간막 등)
  if (
    combined.includes("omentum") ||
    combined.includes("omental") ||
    combined.includes("peritoneum") ||
    combined.includes("peritoneal") ||
    combined.includes("mesocolon") ||
    combined.includes("mesocolic") ||
    combined.includes("meso-appendix") ||
    combined.includes("mesoappendix") ||
    combined.includes("mesentery") ||
    combined.includes("mesenteric") ||
    combined.includes("falciform ligament") ||
    combined.includes("대망") ||
    combined.includes("소망") ||
    combined.includes("복막") ||
    combined.includes("결장간막") ||
    combined.includes("충수간막") ||
    combined.includes("장간막") ||
    combined.includes("그물막") ||
    combined.includes("간낫인대")
  ) {
    return true;
  }

  return false;
}
