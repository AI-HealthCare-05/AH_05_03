export type SystemId =
  | "skeletal"
  | "muscular"
  | "arterial"
  | "venous"
  | "nervous"
  | "digestive"
  | "respiratory"
  | "urinary"
  | "reproductive"
  | "lymphatic"
  | "endocrine"
  | "integumentary"
  | "connective"
  | "sensory"
  | "cardiac";

export interface SystemDefinition {
  id: SystemId;
  name: string;
  nameKo: string;
  color: string;
  description: string;
}

export const SYSTEMS: SystemDefinition[] = [
  { id: "skeletal", name: "Skeleton", nameKo: "골격계", color: "#e2d9ba", description: "신체를 지지하고 내부 장기를 보호하는 뼈대 구조" },
  { id: "muscular", name: "Muscles", nameKo: "근육계", color: "#a85b50", description: "수축과 이완을 통해 관절을 움직이고 자세를 유지하는 근육" },
  { id: "cardiac", name: "Heart", nameKo: "심장", color: "#b96760", description: "온몸과 폐로 혈액을 순환시키는 펌프 기관" },
  { id: "sensory", name: "Sensory organs", nameKo: "감각기계(귀·눈)", color: "#b0c8ce", description: "시각, 청각, 평형감각을 담당하는 기관 (외이·안구 등)" },
  { id: "arterial", name: "Arteries", nameKo: "동맥계", color: "#c05245", description: "심장에서 신체 각 조직으로 산소혈을 전달하는 동맥" },
  { id: "venous", name: "Veins", nameKo: "정맥계", color: "#527c9f", description: "신체 말단에서 심장으로 정맥혈을 회수하는 혈관망" },
  { id: "nervous", name: "Nervous system", nameKo: "신경계", color: "#d8b565", description: "뇌, 척수, 말초신경 등 신호 전달 및 감각 처리" },
  { id: "respiratory", name: "Respiratory", nameKo: "호흡기계", color: "#b98991", description: "기도와 폐를 통해 산소와 이산화탄소를 교환하는 호흡기관" },
  { id: "digestive", name: "Digestive", nameKo: "소화기계", color: "#b8916b", description: "음식물을 소화, 흡수하고 노폐물을 배출하는 위장관 및 장기" },
  { id: "urinary", name: "Urinary", nameKo: "비뇨기계", color: "#b47961", description: "신장, 요관, 방광을 통해 노폐물을 여과하고 배설하는 계통" },
  { id: "reproductive", name: "Reproductive", nameKo: "생식계", color: "#c78d75", description: "생식 및 호르몬 분비를 담당하는 기관" },
  { id: "lymphatic", name: "Lymphatic", nameKo: "림프계", color: "#87af87", description: "림프액 순환 및 체내 면역 방어를 담당하는 림프관·절" },
  { id: "endocrine", name: "Endocrine", nameKo: "내분비계", color: "#d1a374", description: "호르몬을 혈관으로 분비하여 대사와 생리를 조절하는 선" },
  { id: "integumentary", name: "Integumentary", nameKo: "외피계(피부)", color: "#dfb89f", description: "피부, 모발 등 신체 가장 바깥을 덮는 보호 외피" },
  { id: "connective", name: "Connective", nameKo: "결합조직(인대/막)", color: "#aec3bb", description: "장기와 뼈를 서로 지지하고 연결하는 결합조직 및 막" },
];

export interface Part {
  id: string;
  name: string;
  system: SystemId;
  chunk: number;
  positions: number;
  normals: number;
  indices: number;
  vertexCount: number;
  indexCount: number;
  bounds: [[number, number, number], [number, number, number]];
  conceptId?: string;
}

export interface Chunk {
  url: string;
  gzip?: string;
  bytes: number;
}

export interface Concept {
  id: string;
  name: string;
  elements: string[];
}

export interface Atlas {
  parts: Part[];
  chunks: Chunk[];
  concepts: Concept[];
  version?: string;
}

export type HumanAtlasView = "three-quarter" | "front" | "side" | "back";

export interface HumanAtlasSceneState {
  view: HumanAtlasView;
  explode: number; // 0.0 ~ 1.0
  isolate: boolean;
  visible: SystemId[];
  selected: string[];
  rotate: boolean;
  reset: number;
  inspectorOpen?: boolean;
}

export const DEFAULT_VISIBLE_SYSTEMS: SystemId[] = [
  "skeletal",
  "muscular",
  "cardiac",
  "sensory",
  "arterial",
  "venous",
  "nervous",
  "respiratory",
  "digestive",
  "urinary",
  "reproductive",
  "lymphatic",
  "endocrine",
  "connective",
];
