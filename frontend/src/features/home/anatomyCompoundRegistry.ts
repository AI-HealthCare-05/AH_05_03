/**
 * anatomyCompoundRegistry.ts
 * 공식 Z-Anatomy / FMA 계층 기반의 63개 장기 복합 그룹 레지스트리
 * 단일 메쉬가 없는 장기(심장, 폐, 대장, 소장, 회전근개 등)를 공식 COMPOUND로 묶어
 * 다중 메쉬 일괄 선택 및 카메라 포커스를 지원합니다.
 */

export interface CompoundOrganItem {
  id: string;
  canonicalName: string;
  koreanName: string;
  system: string;
  systemKorean: string;
  description: string;
  aliases: string[];
  children: string[];
  isCompound: boolean;
  has3DMesh: boolean;
}

export const ANATOMY_COMPOUND_REGISTRY: Record<string, CompoundOrganItem> = {
  "heart": {
    "id": "heart",
    "canonicalName": "Heart",
    "koreanName": "심장 (염통)",
    "system": "cardiovascular",
    "systemKorean": "심혈관계",
    "description": "좌우 심방·심실로 구성되어 전신 혈액 순환을 담당하는 복합 순환 장기",
    "aliases": [
      "심장",
      "염통",
      "heart",
      "심방",
      "심실"
    ],
    "children": [
      "heart-left-atrium",
      "heart-left-ventricle",
      "heart-right-atrium",
      "heart-right-ventricle"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "lungs": {
    "id": "lungs",
    "canonicalName": "Lungs",
    "koreanName": "폐 (허파)",
    "system": "respiratory",
    "systemKorean": "호흡기계",
    "description": "좌우 폐엽(상엽·중엽·하엽)으로 구성되어 산소와 이산화탄소 가스 교환을 담당하는 호흡 장기",
    "aliases": [
      "폐",
      "허파",
      "lung",
      "lungs",
      "폐엽"
    ],
    "children": [
      "lungs-inferior-lobe-of-left-lung",
      "lungs-inferior-lobe-of-right-lung",
      "lungs-middle-lobe-of-right-lung",
      "lungs-superior-lobe-of-left-lung",
      "lungs-superior-lobe-of-right-lung"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "trachea": {
    "id": "trachea",
    "canonicalName": "trachea",
    "koreanName": "기관 (숨통)",
    "system": "respiratory",
    "systemKorean": "호흡기계",
    "description": "후두와 폐를 연결하여 공기를 유입시키는 연골성 기도",
    "aliases": [
      "기관",
      "숨통",
      "trachea"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "oesophagus": {
    "id": "oesophagus",
    "canonicalName": "oesophagus",
    "koreanName": "식도",
    "system": "digestive",
    "systemKorean": "소화기계",
    "description": "인두에서 위로 음식물을 연동 운동으로 이송하는 근육성 관",
    "aliases": [
      "식도",
      "esophagus",
      "oesophagus"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "liver": {
    "id": "liver",
    "canonicalName": "liver",
    "koreanName": "간 (간장)",
    "system": "digestive",
    "systemKorean": "소화기계",
    "description": "해독 작용, 글리코겐 저장, 담즙 생산 및 단백질 합성을 담당하는 체내 최대 장기",
    "aliases": [
      "간",
      "간장",
      "liver"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "gallbladder": {
    "id": "gallbladder",
    "canonicalName": "gallbladder",
    "koreanName": "담낭 (쓸개)",
    "system": "digestive",
    "systemKorean": "소화기계",
    "description": "간에서 분비된 담즙을 저장·농축하여 십이지장으로 배출하는 소화 부속 기관",
    "aliases": [
      "담낭",
      "쓸개",
      "gallbladder"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "stomach": {
    "id": "stomach",
    "canonicalName": "stomach",
    "koreanName": "위 (밥통)",
    "system": "digestive",
    "systemKorean": "소화기계",
    "description": "위산과 펩신으로 음식물을 화학적으로 분해하고 일시 저장하는 주머니형 소화 장기",
    "aliases": [
      "위",
      "위장",
      "밥통",
      "stomach"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "pancreas": {
    "id": "pancreas",
    "canonicalName": "pancreas",
    "koreanName": "췌장 (이자)",
    "system": "digestive",
    "systemKorean": "소화기계",
    "description": "소화 효소액과 인슐린·글루카곤 호르몬을 분비하는 외분비/내분비 겸용 장기",
    "aliases": [
      "췌장",
      "이자",
      "pancreas"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "spleen": {
    "id": "spleen",
    "canonicalName": "spleen",
    "koreanName": "비장 (지라)",
    "system": "lymphatic",
    "systemKorean": "림프계",
    "description": "노화된 적혈구를 파괴하고 면역 림프구를 생산·저장하는 림프 기관",
    "aliases": [
      "비장",
      "지라",
      "spleen"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "small-intestine": {
    "id": "small-intestine",
    "canonicalName": "Small Intestine",
    "koreanName": "소장 (작은창자)",
    "system": "digestive",
    "systemKorean": "소화기계",
    "description": "십이지장·공장·회장으로 구성되어 영양분을 최종 소화·흡수하는 긴 관",
    "aliases": [
      "소장",
      "작은창자",
      "십이지장",
      "공장",
      "회장",
      "small intestine"
    ],
    "children": [
      "small-intestine-duodenum",
      "small-intestine-jejunum"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "large-intestine": {
    "id": "large-intestine",
    "canonicalName": "Large Intestine",
    "koreanName": "대장 (큰창자)",
    "system": "digestive",
    "systemKorean": "소화기계",
    "description": "맹장·상행결장·횡행결장·하행결장·S자결장·직장으로 구성된 소화기 종단 장기",
    "aliases": [
      "대장",
      "큰창자",
      "결장",
      "상행결장",
      "하행결장",
      "직장",
      "colon",
      "large intestine"
    ],
    "children": [
      "large-intestine-ascending-colon",
      "large-intestine-descending-colon",
      "large-intestine-sigmoid-colon",
      "large-intestine-transverse-colon",
      "large-intestine-vermiform-appendix"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "kidneys": {
    "id": "kidneys",
    "canonicalName": "Kidneys",
    "koreanName": "신장 (콩팥)",
    "system": "urinary",
    "systemKorean": "비뇨기계",
    "description": "좌우 한 쌍으로 혈액 속 노폐물을 여과하여 소변을 만들고 전해질·수분을 조절하는 비뇨 기관",
    "aliases": [
      "신장",
      "콩팥",
      "kidney",
      "kidneys",
      "renal"
    ],
    "children": [
      "kidneys-kidney-left",
      "kidneys-kidney-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "bladder": {
    "id": "bladder",
    "canonicalName": "bladder",
    "koreanName": "방광 (오줌보)",
    "system": "urinary",
    "systemKorean": "비뇨기계",
    "description": "신장에서 배출된 소변을 요관을 통해 받아 모아두었다가 체외로 배출하는 근육성 주머니",
    "aliases": [
      "방광",
      "오줌보",
      "bladder"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "skeleton": {
    "id": "skeleton",
    "canonicalName": "Skeleton",
    "koreanName": "골격계 (전신 뼈)",
    "system": "skeletal",
    "systemKorean": "골격계",
    "description": "인체를 지지하고 내부 장기를 보호하며 근육의 지렛대 역할을 하는 전신 골격",
    "aliases": [
      "골격",
      "골격계",
      "뼈",
      "전신뼈",
      "skeleton"
    ],
    "children": [
      "skeleton-atlas-c1",
      "skeleton-axis-c2",
      "skeleton-body-of-sternum",
      "skeleton-coccyx",
      "skeleton-eighth-rib-left",
      "skeleton-eighth-rib-right",
      "skeleton-eleventh-rib-left",
      "skeleton-eleventh-rib-right",
      "skeleton-fifth-rib-left",
      "skeleton-fifth-rib-right",
      "skeleton-first-rib-left",
      "skeleton-first-rib-right",
      "skeleton-fourth-rib-left",
      "skeleton-fourth-rib-right",
      "skeleton-hip-bone-left",
      "skeleton-hip-bone-right",
      "skeleton-manubrium-of-sternum",
      "skeleton-ninth-rib-left",
      "skeleton-ninth-rib-right",
      "skeleton-sacrum",
      "skeleton-second-rib-left",
      "skeleton-second-rib-right",
      "skeleton-seventh-rib-left",
      "skeleton-seventh-rib-right",
      "skeleton-sixth-rib-left",
      "skeleton-sixth-rib-right",
      "skeleton-tenth-rib-left",
      "skeleton-tenth-rib-right",
      "skeleton-third-rib-left",
      "skeleton-third-rib-right",
      "skeleton-twelfth-rib-left",
      "skeleton-twelfth-rib-right",
      "skeleton-vertebra-c3",
      "skeleton-vertebra-c4",
      "skeleton-vertebra-c5",
      "skeleton-vertebra-c6",
      "skeleton-vertebra-c7",
      "skeleton-vertebra-l1",
      "skeleton-vertebra-l2",
      "skeleton-vertebra-l3",
      "skeleton-vertebra-l4",
      "skeleton-vertebra-l5",
      "skeleton-vertebra-t1",
      "skeleton-vertebra-t10",
      "skeleton-vertebra-t11",
      "skeleton-vertebra-t12",
      "skeleton-vertebra-t2",
      "skeleton-vertebra-t3",
      "skeleton-vertebra-t4",
      "skeleton-vertebra-t5",
      "skeleton-vertebra-t6",
      "skeleton-vertebra-t7",
      "skeleton-vertebra-t8",
      "skeleton-vertebra-t9",
      "skeleton-xiphoid-process"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "body-shell": {
    "id": "body-shell",
    "canonicalName": "body-shell",
    "koreanName": "body-shell",
    "system": "regional-anatomy",
    "systemKorean": "regional-anatomy",
    "description": "body-shell 복합 구조",
    "aliases": [
      "body-shell"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "brainstem": {
    "id": "brainstem",
    "canonicalName": "Brainstem",
    "koreanName": "뇌간 (뇌줄기)",
    "system": "nervous",
    "systemKorean": "신경계",
    "description": "중뇌·교뇌·연수로 구성되어 호흡·순환·체온 등 무의식적 생명유지 기능을 총괄하는 뇌줄기",
    "aliases": [
      "뇌간",
      "뇌줄기",
      "중뇌",
      "교뇌",
      "연수",
      "brainstem"
    ],
    "children": [
      "brainstem-medulla-oblongata-left",
      "brainstem-medulla-oblongata-right",
      "brainstem-midbrain-left",
      "brainstem-midbrain-right",
      "brainstem-pons-left",
      "brainstem-pons-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "fourth-ventricle": {
    "id": "fourth-ventricle",
    "canonicalName": "fourth-ventricle",
    "koreanName": "fourth-ventricle",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "fourth-ventricle 복합 구조",
    "aliases": [
      "fourth-ventricle"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "cerebral-aqueduct": {
    "id": "cerebral-aqueduct",
    "canonicalName": "cerebral-aqueduct",
    "koreanName": "cerebral-aqueduct",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "cerebral-aqueduct 복합 구조",
    "aliases": [
      "cerebral-aqueduct"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "superior-colliculi": {
    "id": "superior-colliculi",
    "canonicalName": "superior-colliculi",
    "koreanName": "superior-colliculi",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "superior-colliculi 복합 구조",
    "aliases": [
      "superior-colliculi"
    ],
    "children": [
      "superior-colliculi-superior-colliculus-left",
      "superior-colliculi-superior-colliculus-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "inferior-colliculi": {
    "id": "inferior-colliculi",
    "canonicalName": "inferior-colliculi",
    "koreanName": "inferior-colliculi",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "inferior-colliculi 복합 구조",
    "aliases": [
      "inferior-colliculi"
    ],
    "children": [
      "inferior-colliculi-inferior-colliculus-left",
      "inferior-colliculi-inferior-colliculus-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "medullary-olives": {
    "id": "medullary-olives",
    "canonicalName": "medullary-olives",
    "koreanName": "medullary-olives",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "medullary-olives 복합 구조",
    "aliases": [
      "medullary-olives"
    ],
    "children": [
      "medullary-olives-olive-left",
      "medullary-olives-olive-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "medullary-pyramids": {
    "id": "medullary-pyramids",
    "canonicalName": "medullary-pyramids",
    "koreanName": "medullary-pyramids",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "medullary-pyramids 복합 구조",
    "aliases": [
      "medullary-pyramids"
    ],
    "children": [
      "medullary-pyramids-pyramid-of-medulla-oblongata-left",
      "medullary-pyramids-pyramid-of-medulla-oblongata-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "red-nuclei": {
    "id": "red-nuclei",
    "canonicalName": "red-nuclei",
    "koreanName": "red-nuclei",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "red-nuclei 복합 구조",
    "aliases": [
      "red-nuclei"
    ],
    "children": [
      "red-nuclei-red-nucleus-left",
      "red-nuclei-red-nucleus-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "oculomotor-nuclei": {
    "id": "oculomotor-nuclei",
    "canonicalName": "oculomotor-nuclei",
    "koreanName": "oculomotor-nuclei",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "oculomotor-nuclei 복합 구조",
    "aliases": [
      "oculomotor-nuclei"
    ],
    "children": [
      "oculomotor-nuclei-accessory-nucleus-of-oculomotor-nerve-left",
      "oculomotor-nuclei-accessory-nucleus-of-oculomotor-nerve-right",
      "oculomotor-nuclei-nucleus-of-oculomotor-nerve-left",
      "oculomotor-nuclei-nucleus-of-oculomotor-nerve-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "facial-motor-nuclei": {
    "id": "facial-motor-nuclei",
    "canonicalName": "facial-motor-nuclei",
    "koreanName": "facial-motor-nuclei",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "facial-motor-nuclei 복합 구조",
    "aliases": [
      "facial-motor-nuclei"
    ],
    "children": [
      "facial-motor-nuclei-motor-nucleus-of-facial-nerve-left",
      "facial-motor-nuclei-motor-nucleus-of-facial-nerve-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "abducens-nuclei": {
    "id": "abducens-nuclei",
    "canonicalName": "abducens-nuclei",
    "koreanName": "abducens-nuclei",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "abducens-nuclei 복합 구조",
    "aliases": [
      "abducens-nuclei"
    ],
    "children": [
      "abducens-nuclei-nucleus-of-abducens-nerve-left",
      "abducens-nuclei-nucleus-of-abducens-nerve-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "superior-salivatory-nuclei": {
    "id": "superior-salivatory-nuclei",
    "canonicalName": "superior-salivatory-nuclei",
    "koreanName": "superior-salivatory-nuclei",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "superior-salivatory-nuclei 복합 구조",
    "aliases": [
      "superior-salivatory-nuclei"
    ],
    "children": [
      "superior-salivatory-nuclei-superior-salivatory-nucleus-left",
      "superior-salivatory-nuclei-superior-salivatory-nucleus-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "vestibular-nuclei": {
    "id": "vestibular-nuclei",
    "canonicalName": "vestibular-nuclei",
    "koreanName": "vestibular-nuclei",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "vestibular-nuclei 복합 구조",
    "aliases": [
      "vestibular-nuclei"
    ],
    "children": [
      "vestibular-nuclei-vestibular-nuclei-left",
      "vestibular-nuclei-vestibular-nuclei-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "interpeduncular-fossae": {
    "id": "interpeduncular-fossae",
    "canonicalName": "interpeduncular-fossae",
    "koreanName": "interpeduncular-fossae",
    "system": "nervous",
    "systemKorean": "nervous",
    "description": "interpeduncular-fossae 복합 구조",
    "aliases": [
      "interpeduncular-fossae"
    ],
    "children": [
      "interpeduncular-fossae-interpeduncular-fossa-left",
      "interpeduncular-fossae-interpeduncular-fossa-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "appendicular-skeleton": {
    "id": "appendicular-skeleton",
    "canonicalName": "Appendicular Skeleton",
    "koreanName": "Appendicular Skeleton",
    "system": "skeletal",
    "systemKorean": "skeletal",
    "description": "Appendicular Skeleton 복합 구조",
    "aliases": [
      "appendicular skeleton"
    ],
    "children": [
      "appendicular-skeleton-calcaneus-left",
      "appendicular-skeleton-calcaneus-right",
      "appendicular-skeleton-capitate-bone-left",
      "appendicular-skeleton-capitate-bone-right",
      "appendicular-skeleton-clavicle-left",
      "appendicular-skeleton-clavicle-right",
      "appendicular-skeleton-cuboid-bone-left",
      "appendicular-skeleton-cuboid-bone-right",
      "appendicular-skeleton-distal-phalanx-of-fifth-finger-of-foot-left",
      "appendicular-skeleton-distal-phalanx-of-fifth-finger-of-foot-right",
      "appendicular-skeleton-distal-phalanx-of-fifth-finger-of-hand-left",
      "appendicular-skeleton-distal-phalanx-of-fifth-finger-of-hand-right",
      "appendicular-skeleton-distal-phalanx-of-first-finger-of-foot-left",
      "appendicular-skeleton-distal-phalanx-of-first-finger-of-foot-right",
      "appendicular-skeleton-distal-phalanx-of-first-finger-of-hand-left",
      "appendicular-skeleton-distal-phalanx-of-first-finger-of-hand-right",
      "appendicular-skeleton-distal-phalanx-of-fourth-finger-of-foot-left",
      "appendicular-skeleton-distal-phalanx-of-fourth-finger-of-foot-right",
      "appendicular-skeleton-distal-phalanx-of-fourth-finger-of-hand-left",
      "appendicular-skeleton-distal-phalanx-of-fourth-finger-of-hand-right",
      "appendicular-skeleton-distal-phalanx-of-second-finger-of-foot-left",
      "appendicular-skeleton-distal-phalanx-of-second-finger-of-foot-right",
      "appendicular-skeleton-distal-phalanx-of-second-finger-of-hand-left",
      "appendicular-skeleton-distal-phalanx-of-second-finger-of-hand-right",
      "appendicular-skeleton-distal-phalanx-of-third-finger-of-foot-left",
      "appendicular-skeleton-distal-phalanx-of-third-finger-of-foot-right",
      "appendicular-skeleton-distal-phalanx-of-third-finger-of-hand-left",
      "appendicular-skeleton-distal-phalanx-of-third-finger-of-hand-right",
      "appendicular-skeleton-femur-left",
      "appendicular-skeleton-femur-right",
      "appendicular-skeleton-fibula-left",
      "appendicular-skeleton-fibula-right",
      "appendicular-skeleton-fifth-metacarpal-bone-left",
      "appendicular-skeleton-fifth-metacarpal-bone-right",
      "appendicular-skeleton-fifth-metatarsal-bone-left",
      "appendicular-skeleton-fifth-metatarsal-bone-right",
      "appendicular-skeleton-first-metacarpal-bone-left",
      "appendicular-skeleton-first-metacarpal-bone-right",
      "appendicular-skeleton-first-metatarsal-bone-left",
      "appendicular-skeleton-first-metatarsal-bone-right",
      "appendicular-skeleton-fourth-metacarpal-bone-left",
      "appendicular-skeleton-fourth-metacarpal-bone-right",
      "appendicular-skeleton-fourth-metatarsal-bone-left",
      "appendicular-skeleton-fourth-metatarsal-bone-right",
      "appendicular-skeleton-hamate-bone-left",
      "appendicular-skeleton-hamate-bone-right",
      "appendicular-skeleton-humerus-left",
      "appendicular-skeleton-humerus-right",
      "appendicular-skeleton-intermediate-cuneiform-bone-left",
      "appendicular-skeleton-intermediate-cuneiform-bone-right",
      "appendicular-skeleton-lateral-cuneiform-bone-left",
      "appendicular-skeleton-lateral-cuneiform-bone-right",
      "appendicular-skeleton-lunate-bone-left",
      "appendicular-skeleton-lunate-bone-right",
      "appendicular-skeleton-medial-cuneiform-bone-left",
      "appendicular-skeleton-medial-cuneiform-bone-right",
      "appendicular-skeleton-middle-phalanx-of-fifth-finger-of-foot-left",
      "appendicular-skeleton-middle-phalanx-of-fifth-finger-of-foot-right",
      "appendicular-skeleton-middle-phalanx-of-fifth-finger-of-hand-left",
      "appendicular-skeleton-middle-phalanx-of-fifth-finger-of-hand-right",
      "appendicular-skeleton-middle-phalanx-of-fourth-finger-of-foot-left",
      "appendicular-skeleton-middle-phalanx-of-fourth-finger-of-foot-right",
      "appendicular-skeleton-middle-phalanx-of-fourth-finger-of-hand-left",
      "appendicular-skeleton-middle-phalanx-of-fourth-finger-of-hand-right",
      "appendicular-skeleton-middle-phalanx-of-second-finger-of-foot-left",
      "appendicular-skeleton-middle-phalanx-of-second-finger-of-foot-right",
      "appendicular-skeleton-middle-phalanx-of-second-finger-of-hand-left",
      "appendicular-skeleton-middle-phalanx-of-second-finger-of-hand-right",
      "appendicular-skeleton-middle-phalanx-of-third-finger-of-foot-left",
      "appendicular-skeleton-middle-phalanx-of-third-finger-of-foot-right",
      "appendicular-skeleton-middle-phalanx-of-third-finger-of-hand-left",
      "appendicular-skeleton-middle-phalanx-of-third-finger-of-hand-right",
      "appendicular-skeleton-navicular-bone-left",
      "appendicular-skeleton-navicular-bone-right",
      "appendicular-skeleton-patella-left",
      "appendicular-skeleton-patella-right",
      "appendicular-skeleton-pisiform-bone-left",
      "appendicular-skeleton-pisiform-bone-right",
      "appendicular-skeleton-proximal-phalanx-of-fifth-finger-of-foot-left",
      "appendicular-skeleton-proximal-phalanx-of-fifth-finger-of-foot-right",
      "appendicular-skeleton-proximal-phalanx-of-fifth-finger-of-hand-left",
      "appendicular-skeleton-proximal-phalanx-of-fifth-finger-of-hand-right",
      "appendicular-skeleton-proximal-phalanx-of-first-finger-of-foot-left",
      "appendicular-skeleton-proximal-phalanx-of-first-finger-of-foot-right",
      "appendicular-skeleton-proximal-phalanx-of-first-finger-of-hand-left",
      "appendicular-skeleton-proximal-phalanx-of-first-finger-of-hand-right",
      "appendicular-skeleton-proximal-phalanx-of-fourth-finger-of-foot-left",
      "appendicular-skeleton-proximal-phalanx-of-fourth-finger-of-foot-right",
      "appendicular-skeleton-proximal-phalanx-of-fourth-finger-of-hand-left",
      "appendicular-skeleton-proximal-phalanx-of-fourth-finger-of-hand-right",
      "appendicular-skeleton-proximal-phalanx-of-second-finger-of-foot-left",
      "appendicular-skeleton-proximal-phalanx-of-second-finger-of-foot-right",
      "appendicular-skeleton-proximal-phalanx-of-second-finger-of-hand-left",
      "appendicular-skeleton-proximal-phalanx-of-second-finger-of-hand-right",
      "appendicular-skeleton-proximal-phalanx-of-third-finger-of-foot-left",
      "appendicular-skeleton-proximal-phalanx-of-third-finger-of-foot-right",
      "appendicular-skeleton-proximal-phalanx-of-third-finger-of-hand-left",
      "appendicular-skeleton-proximal-phalanx-of-third-finger-of-hand-right",
      "appendicular-skeleton-radius-left",
      "appendicular-skeleton-radius-right",
      "appendicular-skeleton-scaphoid-bone-left",
      "appendicular-skeleton-scaphoid-bone-right",
      "appendicular-skeleton-scapula-left",
      "appendicular-skeleton-scapula-right",
      "appendicular-skeleton-second-metacarpal-bone-left",
      "appendicular-skeleton-second-metacarpal-bone-right",
      "appendicular-skeleton-second-metatarsal-bone-left",
      "appendicular-skeleton-second-metatarsal-bone-right",
      "appendicular-skeleton-sesamoid-bones-of-foot-left",
      "appendicular-skeleton-sesamoid-bones-of-foot-right",
      "appendicular-skeleton-talus-left",
      "appendicular-skeleton-talus-right",
      "appendicular-skeleton-third-metacarpal-bone-left",
      "appendicular-skeleton-third-metacarpal-bone-right",
      "appendicular-skeleton-third-metatarsal-bone-left",
      "appendicular-skeleton-third-metatarsal-bone-right",
      "appendicular-skeleton-tibia-left",
      "appendicular-skeleton-tibia-right",
      "appendicular-skeleton-trapezium-bone-left",
      "appendicular-skeleton-trapezium-bone-right",
      "appendicular-skeleton-trapezoid-bone-left",
      "appendicular-skeleton-trapezoid-bone-right",
      "appendicular-skeleton-triquetrum-bone-left",
      "appendicular-skeleton-triquetrum-bone-right",
      "appendicular-skeleton-ulna-left",
      "appendicular-skeleton-ulna-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "lymphoid-organs": {
    "id": "lymphoid-organs",
    "canonicalName": "Lymphoid Organs",
    "koreanName": "Lymphoid Organs",
    "system": "lymphatic",
    "systemKorean": "lymphatic",
    "description": "Lymphoid Organs 복합 구조",
    "aliases": [
      "lymphoid organs"
    ],
    "children": [
      "lymphoid-organs-anterior-axillary-nodes-left",
      "lymphoid-organs-anterior-axillary-nodes-right",
      "lymphoid-organs-anterior-tibial-node-left",
      "lymphoid-organs-anterior-tibial-node-right",
      "lymphoid-organs-brachial-nodes-left",
      "lymphoid-organs-brachial-nodes-right",
      "lymphoid-organs-bucinator-node-left",
      "lymphoid-organs-bucinator-node-right",
      "lymphoid-organs-cystic-node",
      "lymphoid-organs-deep-popliteal-nodes-left",
      "lymphoid-organs-deep-popliteal-nodes-right",
      "lymphoid-organs-inferior-epigastric-nodes-left",
      "lymphoid-organs-inferior-epigastric-nodes-right",
      "lymphoid-organs-infra-auricular-nodes-left",
      "lymphoid-organs-infra-auricular-nodes-right",
      "lymphoid-organs-infraclavicular-nodes-left",
      "lymphoid-organs-infraclavicular-nodes-right",
      "lymphoid-organs-intermediate-deep-inguinal-node-left",
      "lymphoid-organs-intermediate-deep-inguinal-node-right",
      "lymphoid-organs-left-lobe-of-thymus",
      "lymphoid-organs-mastoid-nodes-left",
      "lymphoid-organs-mastoid-nodes-right",
      "lymphoid-organs-medial-common-iliac-nodes",
      "lymphoid-organs-medial-external-iliac-nodes-left",
      "lymphoid-organs-medial-external-iliac-nodes-right",
      "lymphoid-organs-occipital-nodes-left",
      "lymphoid-organs-occipital-nodes-right",
      "lymphoid-organs-palatine-tonsil-left",
      "lymphoid-organs-palatine-tonsil-right",
      "lymphoid-organs-posterior-tibial-node-left",
      "lymphoid-organs-posterior-tibial-node-right",
      "lymphoid-organs-postvesical-nodes",
      "lymphoid-organs-precaecal-nodes",
      "lymphoid-organs-proximal-deep-inguinal-node-left",
      "lymphoid-organs-proximal-deep-inguinal-node-right",
      "lymphoid-organs-retro-aortic-nodes",
      "lymphoid-organs-retrocaecal-nodes",
      "lymphoid-organs-retrocaval-nodes",
      "lymphoid-organs-retropharyngeal-nodes-left",
      "lymphoid-organs-retropharyngeal-nodes-right",
      "lymphoid-organs-right-lobe-of-thymus",
      "lymphoid-organs-submandibular-nodes-left",
      "lymphoid-organs-submandibular-nodes-right",
      "lymphoid-organs-submental-nodes-left",
      "lymphoid-organs-submental-nodes-right",
      "lymphoid-organs-superficial-anterior-cervical-nodes",
      "lymphoid-organs-superficial-popliteal-nodes-left",
      "lymphoid-organs-superficial-popliteal-nodes-right",
      "lymphoid-organs-superior-pancreatic-nodes",
      "lymphoid-organs-supraclavicular-nodes-left",
      "lymphoid-organs-supraclavicular-nodes-right",
      "lymphoid-organs-supratrochlear-nodes-left",
      "lymphoid-organs-supratrochlear-nodes-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "testes": {
    "id": "testes",
    "canonicalName": "Testes",
    "koreanName": "고환 (정소)",
    "system": "reproductive",
    "systemKorean": "생식계",
    "description": "음낭 내에 위치하여 정자와 테스토스테론을 생성하는 남성 생식 장기",
    "aliases": [
      "고환",
      "정소",
      "testis",
      "testes"
    ],
    "children": [
      "testes-testis-left",
      "testes-testis-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "epididymides": {
    "id": "epididymides",
    "canonicalName": "Epididymides",
    "koreanName": "Epididymides",
    "system": "reproductive",
    "systemKorean": "reproductive",
    "description": "Epididymides 복합 구조",
    "aliases": [
      "epididymides"
    ],
    "children": [
      "epididymides-epididymis-left",
      "epididymides-epididymis-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "ductus-deferentes": {
    "id": "ductus-deferentes",
    "canonicalName": "Ductus Deferentes",
    "koreanName": "Ductus Deferentes",
    "system": "reproductive",
    "systemKorean": "reproductive",
    "description": "Ductus Deferentes 복합 구조",
    "aliases": [
      "ductus deferentes"
    ],
    "children": [
      "ductus-deferentes-ductus-deferens-left",
      "ductus-deferentes-ductus-deferens-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "ejaculatory-ducts": {
    "id": "ejaculatory-ducts",
    "canonicalName": "Ejaculatory Ducts",
    "koreanName": "Ejaculatory Ducts",
    "system": "reproductive",
    "systemKorean": "reproductive",
    "description": "Ejaculatory Ducts 복합 구조",
    "aliases": [
      "ejaculatory ducts"
    ],
    "children": [
      "ejaculatory-ducts-ejaculatory-duct-left",
      "ejaculatory-ducts-ejaculatory-duct-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "seminal-glands": {
    "id": "seminal-glands",
    "canonicalName": "Seminal Glands",
    "koreanName": "Seminal Glands",
    "system": "reproductive",
    "systemKorean": "reproductive",
    "description": "Seminal Glands 복합 구조",
    "aliases": [
      "seminal glands"
    ],
    "children": [
      "seminal-glands-seminal-gland-left",
      "seminal-glands-seminal-gland-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "prostate": {
    "id": "prostate",
    "canonicalName": "Prostate",
    "koreanName": "전립선 (전립샘)",
    "system": "reproductive",
    "systemKorean": "생식계",
    "description": "방광 바로 아래 위치하여 요도를 감싸고 정액의 일부를 분비하는 남성 생식선",
    "aliases": [
      "전립선",
      "전립샘",
      "prostate"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "penile-erectile-tissues": {
    "id": "penile-erectile-tissues",
    "canonicalName": "Penile Erectile Tissues",
    "koreanName": "Penile Erectile Tissues",
    "system": "reproductive",
    "systemKorean": "reproductive",
    "description": "Penile Erectile Tissues 복합 구조",
    "aliases": [
      "penile erectile tissues"
    ],
    "children": [
      "penile-erectile-tissues-corpus-cavernosum-of-penis",
      "penile-erectile-tissues-corpus-spongiosum-of-penis",
      "penile-erectile-tissues-glans-penis"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "pituitary-gland": {
    "id": "pituitary-gland",
    "canonicalName": "Pituitary Gland",
    "koreanName": "뇌하수체",
    "system": "endocrine",
    "systemKorean": "내분비계",
    "description": "뇌 기저부에 위치하여 다른 내분비선의 기능을 총괄 조절하는 마스터 호르몬 샘",
    "aliases": [
      "뇌하수체",
      "pituitary"
    ],
    "children": [
      "pituitary-gland-adenohypophysis",
      "pituitary-gland-neurohypophysis"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "pineal-gland": {
    "id": "pineal-gland",
    "canonicalName": "Pineal Gland",
    "koreanName": "Pineal Gland",
    "system": "endocrine",
    "systemKorean": "endocrine",
    "description": "Pineal Gland 복합 구조",
    "aliases": [
      "pineal gland"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "thyroid-gland": {
    "id": "thyroid-gland",
    "canonicalName": "Thyroid Gland",
    "koreanName": "갑상선 (갑상샘)",
    "system": "endocrine",
    "systemKorean": "내분비계",
    "description": "목 앞쪽에 나비 모양으로 위치하여 티록신 등 에너지 대사 호르몬을 분비",
    "aliases": [
      "갑상선",
      "갑상샘",
      "thyroid"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "parathyroid-glands": {
    "id": "parathyroid-glands",
    "canonicalName": "Parathyroid Glands",
    "koreanName": "부갑상선 (부갑상샘)",
    "system": "endocrine",
    "systemKorean": "내분비계",
    "description": "갑상선 뒤에 4개가 위치하여 혈중 칼슘 농도를 정밀 조절하는 호르몬 분비",
    "aliases": [
      "부갑상선",
      "부갑상샘",
      "parathyroid"
    ],
    "children": [
      "parathyroid-glands-inferior-parathyroid-gland-left",
      "parathyroid-glands-inferior-parathyroid-gland-right",
      "parathyroid-glands-superior-parathyroid-gland-left",
      "parathyroid-glands-superior-parathyroid-gland-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "adrenal-glands": {
    "id": "adrenal-glands",
    "canonicalName": "Adrenal Glands",
    "koreanName": "부신 (부신샘)",
    "system": "endocrine",
    "systemKorean": "내분비계",
    "description": "좌우 신장 상단에 위치하여 코르티솔, 아드레날린 등 스트레스 호르몬 분비",
    "aliases": [
      "부신",
      "부신샘",
      "adrenal",
      "suprarenal"
    ],
    "children": [
      "adrenal-glands-suprarenal-gland-left",
      "adrenal-glands-suprarenal-gland-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "external-abdominal-obliques": {
    "id": "external-abdominal-obliques",
    "canonicalName": "External Abdominal Obliques",
    "koreanName": "외복사근 (배바깥빗근)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "복부 외측을 덮고 체간 회전 및 굴곡을 유도하는 빗근",
    "aliases": [
      "외복사근",
      "배바깥빗근",
      "옆구리근육"
    ],
    "children": [
      "external-abdominal-obliques-external-abdominal-oblique-muscle-left",
      "external-abdominal-obliques-external-abdominal-oblique-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "internal-abdominal-obliques": {
    "id": "internal-abdominal-obliques",
    "canonicalName": "Internal Abdominal Obliques",
    "koreanName": "내복사근 (배안쪽빗근)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "외복사근 내부에서 반대 방향으로 주행하여 복압과 체간 회전을 보조하는 근육",
    "aliases": [
      "내복사근",
      "배안쪽빗근"
    ],
    "children": [
      "internal-abdominal-obliques-internal-abdominal-oblique-muscle-left",
      "internal-abdominal-obliques-internal-abdominal-oblique-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "transversus-abdominis": {
    "id": "transversus-abdominis",
    "canonicalName": "Transversus Abdominis",
    "koreanName": "복횡근 (배가로근)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "가장 깊은 복벽 근육으로 코르셋처럼 복부를 감싸 척추를 안정화시키는 코어 근육",
    "aliases": [
      "복횡근",
      "배가로근",
      "코어",
      "코어근육"
    ],
    "children": [
      "transversus-abdominis-transversus-abdominis-muscle-left",
      "transversus-abdominis-transversus-abdominis-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "rectus-abdominis": {
    "id": "rectus-abdominis",
    "canonicalName": "Rectus Abdominis",
    "koreanName": "복직근 (배곧은근)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "복부 중앙 앞벽을 수직으로 덮으며 척추를 굽히고 복압을 형성하는 근육",
    "aliases": [
      "복직근",
      "배곧은근",
      "복근",
      "식스팩",
      "rectus abdominis"
    ],
    "children": [
      "rectus-abdominis-rectus-abdominis-muscle-left",
      "rectus-abdominis-rectus-abdominis-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "pyramidalis-muscles": {
    "id": "pyramidalis-muscles",
    "canonicalName": "Pyramidalis Muscles",
    "koreanName": "Pyramidalis Muscles",
    "system": "muscular",
    "systemKorean": "muscular",
    "description": "Pyramidalis Muscles 복합 구조",
    "aliases": [
      "pyramidalis muscles"
    ],
    "children": [
      "pyramidalis-muscles-pyramidalis-muscle-left",
      "pyramidalis-muscles-pyramidalis-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "quadratus-lumborum": {
    "id": "quadratus-lumborum",
    "canonicalName": "Quadratus Lumborum",
    "koreanName": "요방형근 (허리네모근)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "늑골과 골반을 연결하여 요추를 지지하고 체간 측굴을 돕는 심부 허리 근육",
    "aliases": [
      "요방형근",
      "허리네모근",
      "허리근육",
      "quadratus lumborum"
    ],
    "children": [
      "quadratus-lumborum-quadratus-lumborum-muscle-left",
      "quadratus-lumborum-quadratus-lumborum-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "inguinal-ligaments": {
    "id": "inguinal-ligaments",
    "canonicalName": "Inguinal Ligaments",
    "koreanName": "Inguinal Ligaments",
    "system": "muscular",
    "systemKorean": "muscular",
    "description": "Inguinal Ligaments 복합 구조",
    "aliases": [
      "inguinal ligaments"
    ],
    "children": [
      "inguinal-ligaments-inguinal-ligament-left",
      "inguinal-ligaments-inguinal-ligament-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "linea-alba": {
    "id": "linea-alba",
    "canonicalName": "Linea Alba",
    "koreanName": "Linea Alba",
    "system": "muscular",
    "systemKorean": "muscular",
    "description": "Linea Alba 복합 구조",
    "aliases": [
      "linea alba"
    ],
    "children": [],
    "isCompound": false,
    "has3DMesh": true
  },
  "deltoid-muscles": {
    "id": "deltoid-muscles",
    "canonicalName": "Deltoid Muscles",
    "koreanName": "삼각근 (어깨세모근)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "쇄골부·견봉부·견갑극부로 구성되어 어깨 관절을 감싸고 팔을 들어올리는 근육",
    "aliases": [
      "삼각근",
      "어깨세모근",
      "어깨근육",
      "deltoid"
    ],
    "children": [
      "deltoid-muscles-acromial-part-of-deltoid-muscle-left",
      "deltoid-muscles-acromial-part-of-deltoid-muscle-right",
      "deltoid-muscles-clavicular-part-of-deltoid-muscle-left",
      "deltoid-muscles-clavicular-part-of-deltoid-muscle-right",
      "deltoid-muscles-scapular-spinal-part-of-deltoid-muscle-left",
      "deltoid-muscles-scapular-spinal-part-of-deltoid-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "rotator-cuff-muscles": {
    "id": "rotator-cuff-muscles",
    "canonicalName": "Rotator Cuff Muscles",
    "koreanName": "회전근개 (회전근띠)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "극상근·극하근·견갑하근·소원근 4개로 구성되어 어깨 관절 안정성을 유지하는 핵심 복합 근육",
    "aliases": [
      "회전근개",
      "회전근띠",
      "극상근",
      "극하근",
      "견갑하근",
      "소원근",
      "rotator cuff"
    ],
    "children": [
      "rotator-cuff-muscles-infraspinatus-muscle-left",
      "rotator-cuff-muscles-infraspinatus-muscle-right",
      "rotator-cuff-muscles-subscapularis-muscle-left",
      "rotator-cuff-muscles-subscapularis-muscle-right",
      "rotator-cuff-muscles-supraspinatus-muscle-left",
      "rotator-cuff-muscles-supraspinatus-muscle-right",
      "rotator-cuff-muscles-teres-minor-muscle-left",
      "rotator-cuff-muscles-teres-minor-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "superficial-gluteal-muscles": {
    "id": "superficial-gluteal-muscles",
    "canonicalName": "Superficial Gluteal Muscles",
    "koreanName": "천층 둔근 (대둔근·중둔근·소둔근)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "엉덩이의 표층을 구성하며 보행 및 체간 기립을 지지하는 주요 볼기근군",
    "aliases": [
      "둔근",
      "엉덩이근육",
      "대둔근",
      "중둔근",
      "소둔근",
      "볼기근"
    ],
    "children": [
      "superficial-gluteal-muscles-gluteus-maximus-muscle-left",
      "superficial-gluteal-muscles-gluteus-maximus-muscle-right",
      "superficial-gluteal-muscles-gluteus-medius-muscle-left",
      "superficial-gluteal-muscles-gluteus-medius-muscle-right",
      "superficial-gluteal-muscles-gluteus-minimus-muscle-left",
      "superficial-gluteal-muscles-gluteus-minimus-muscle-right",
      "superficial-gluteal-muscles-tensor-fasciae-latae-left",
      "superficial-gluteal-muscles-tensor-fasciae-latae-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "deep-gluteal-muscles": {
    "id": "deep-gluteal-muscles",
    "canonicalName": "Deep Gluteal Muscles",
    "koreanName": "심층 둔근 (이상근 등)",
    "system": "muscular",
    "systemKorean": "근육계",
    "description": "이상근·내폐쇄근·쌍자근 등 고관절 회전과 골반 심부 안정을 담당하는 근육군",
    "aliases": [
      "이상근",
      "심층둔근",
      "deep gluteal"
    ],
    "children": [
      "deep-gluteal-muscles-inferior-gemellus-muscle-left",
      "deep-gluteal-muscles-inferior-gemellus-muscle-right",
      "deep-gluteal-muscles-obturator-externus-left",
      "deep-gluteal-muscles-obturator-externus-right",
      "deep-gluteal-muscles-obturator-internus-left",
      "deep-gluteal-muscles-obturator-internus-right",
      "deep-gluteal-muscles-piriformis-muscle-left",
      "deep-gluteal-muscles-piriformis-muscle-right",
      "deep-gluteal-muscles-quadratus-femoris-muscle-left",
      "deep-gluteal-muscles-quadratus-femoris-muscle-right",
      "deep-gluteal-muscles-superior-gemellus-muscle-left",
      "deep-gluteal-muscles-superior-gemellus-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "facial-expression-muscles": {
    "id": "facial-expression-muscles",
    "canonicalName": "Facial Expression Muscles",
    "koreanName": "Facial Expression Muscles",
    "system": "muscular",
    "systemKorean": "muscular",
    "description": "Facial Expression Muscles 복합 구조",
    "aliases": [
      "facial expression muscles"
    ],
    "children": [
      "facial-expression-muscles-bucinator-left",
      "facial-expression-muscles-bucinator-right",
      "facial-expression-muscles-corrugator-supercilii-left",
      "facial-expression-muscles-corrugator-supercilii-right",
      "facial-expression-muscles-depressor-anguli-oris-left",
      "facial-expression-muscles-depressor-anguli-oris-right",
      "facial-expression-muscles-depressor-labii-inferioris-left",
      "facial-expression-muscles-depressor-labii-inferioris-right",
      "facial-expression-muscles-depressor-septi-nasi-left",
      "facial-expression-muscles-depressor-septi-nasi-right",
      "facial-expression-muscles-levator-anguli-oris-left",
      "facial-expression-muscles-levator-anguli-oris-right",
      "facial-expression-muscles-levator-labii-superioris-left",
      "facial-expression-muscles-levator-labii-superioris-right",
      "facial-expression-muscles-levator-nasolabialis-left",
      "facial-expression-muscles-levator-nasolabialis-right",
      "facial-expression-muscles-mentalis-muscle-left",
      "facial-expression-muscles-mentalis-muscle-right",
      "facial-expression-muscles-nasalis-muscle-left",
      "facial-expression-muscles-nasalis-muscle-right",
      "facial-expression-muscles-orbicularis-oris-muscle-left",
      "facial-expression-muscles-orbicularis-oris-muscle-right",
      "facial-expression-muscles-orbital-part-of-orbicularis-oculi-left",
      "facial-expression-muscles-orbital-part-of-orbicularis-oculi-right",
      "facial-expression-muscles-palpebral-part-of-orbicularis-oculi-left",
      "facial-expression-muscles-palpebral-part-of-orbicularis-oculi-right",
      "facial-expression-muscles-procerus-muscle-left",
      "facial-expression-muscles-procerus-muscle-right",
      "facial-expression-muscles-risorius-muscle-left",
      "facial-expression-muscles-risorius-muscle-right",
      "facial-expression-muscles-zygomaticus-major-muscle-left",
      "facial-expression-muscles-zygomaticus-major-muscle-right",
      "facial-expression-muscles-zygomaticus-minor-muscle-left",
      "facial-expression-muscles-zygomaticus-minor-muscle-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "cerebrum": {
    "id": "cerebrum",
    "canonicalName": "Cerebrum",
    "koreanName": "대뇌",
    "system": "nervous",
    "systemKorean": "신경계",
    "description": "좌우 반구로 구성되어 감각 인지, 수의 운동, 언어, 기억 및 사고를 관장하는 중추",
    "aliases": [
      "대뇌",
      "뇌",
      "cerebrum",
      "brain"
    ],
    "children": [
      "cerebrum-amygdaloid-body-left",
      "cerebrum-amygdaloid-body-right",
      "cerebrum-angular-gyrus-left",
      "cerebrum-angular-gyrus-right",
      "cerebrum-anterior-commissure",
      "cerebrum-anterior-occipital-sulcus-left",
      "cerebrum-anterior-occipital-sulcus-right",
      "cerebrum-calcarine-sulcus-left",
      "cerebrum-calcarine-sulcus-right",
      "cerebrum-caudate-nucleus-left",
      "cerebrum-caudate-nucleus-right",
      "cerebrum-central-sulcus-left",
      "cerebrum-central-sulcus-right",
      "cerebrum-cingulate-gyrus-and-sulcus-middle-anterior-part-left",
      "cerebrum-cingulate-gyrus-and-sulcus-middle-anterior-part-right",
      "cerebrum-cingulate-gyrus-and-sulcus-middle-posterior-part-left",
      "cerebrum-cingulate-gyrus-and-sulcus-middle-posterior-part-right",
      "cerebrum-cingulate-gyrus-and-sulcus-posterior-dorsal-part-left",
      "cerebrum-cingulate-gyrus-and-sulcus-posterior-dorsal-part-right",
      "cerebrum-cingulate-gyrus-posteroventral-part-left",
      "cerebrum-cingulate-gyrus-posteroventral-part-right",
      "cerebrum-cingulate-sulcus-marginal-part-left",
      "cerebrum-cingulate-sulcus-marginal-part-right",
      "cerebrum-circular-sulcus-of-insula-left",
      "cerebrum-circular-sulcus-of-insula-right",
      "cerebrum-collateral-sulcus-left",
      "cerebrum-collateral-sulcus-right",
      "cerebrum-corpus-callosum",
      "cerebrum-cuneus-left",
      "cerebrum-cuneus-right",
      "cerebrum-fornix-left",
      "cerebrum-fornix-right",
      "cerebrum-globus-pallidus-left",
      "cerebrum-globus-pallidus-right",
      "cerebrum-habenula",
      "cerebrum-hippocampal-commissure",
      "cerebrum-hippocampus-left",
      "cerebrum-hippocampus-right",
      "cerebrum-hypothalamus",
      "cerebrum-inferior-frontal-sulcus-left",
      "cerebrum-inferior-frontal-sulcus-right",
      "cerebrum-inferior-occipital-gyrus-and-sulcus-left",
      "cerebrum-inferior-occipital-gyrus-and-sulcus-right",
      "cerebrum-inferior-temporal-gyrus-left",
      "cerebrum-inferior-temporal-gyrus-right",
      "cerebrum-inferior-temporal-sulcus-left",
      "cerebrum-inferior-temporal-sulcus-right",
      "cerebrum-insula-subcentral-gyrus-and-ant-and-post-sulci-left",
      "cerebrum-insula-subcentral-gyrus-and-ant-and-post-sulci-right",
      "cerebrum-intraparietal-sulcus-left",
      "cerebrum-intraparietal-sulcus-right",
      "cerebrum-lat-fis-ant-horizont-left",
      "cerebrum-lat-fis-ant-horizont-right",
      "cerebrum-lat-fis-ant-vertical-left",
      "cerebrum-lat-fis-ant-vertical-right",
      "cerebrum-lat-fis-post-left",
      "cerebrum-lat-fis-post-right",
      "cerebrum-lateral-geniculate-body-left",
      "cerebrum-lateral-geniculate-body-right",
      "cerebrum-lateral-occipital-gyrus-middle-occipital-gyrus-left",
      "cerebrum-lateral-occipital-gyrus-middle-occipital-gyrus-right",
      "cerebrum-lateral-occipitotemporal-gyrus-left",
      "cerebrum-lateral-occipitotemporal-gyrus-right",
      "cerebrum-lateral-ventricle-left",
      "cerebrum-lateral-ventricle-right",
      "cerebrum-lentiform-nucleus-left",
      "cerebrum-lentiform-nucleus-right",
      "cerebrum-lingual-gyrus-left",
      "cerebrum-lingual-gyrus-right",
      "cerebrum-lunate-sulcus-left",
      "cerebrum-lunate-sulcus-right",
      "cerebrum-mamillary-body-left",
      "cerebrum-mamillary-body-right",
      "cerebrum-medial-geniculate-body-left",
      "cerebrum-medial-geniculate-body-right",
      "cerebrum-medial-occipitotemporal-gyrus-parahippocampal-left",
      "cerebrum-medial-occipitotemporal-gyrus-parahippocampal-right",
      "cerebrum-middle-frontal-gyrus-left",
      "cerebrum-middle-frontal-gyrus-right",
      "cerebrum-middle-temporal-gyrus-left",
      "cerebrum-middle-temporal-gyrus-right",
      "cerebrum-occipital-pole-left",
      "cerebrum-occipital-pole-right",
      "cerebrum-occipitotemporal-sulcus-lateral-part-left",
      "cerebrum-occipitotemporal-sulcus-lateral-part-right",
      "cerebrum-olfactory-sulcus-left",
      "cerebrum-olfactory-sulcus-right",
      "cerebrum-opercular-part-of-inferior-frontal-gyrus-left",
      "cerebrum-opercular-part-of-inferior-frontal-gyrus-right",
      "cerebrum-optic-chiasm-left",
      "cerebrum-optic-chiasm-right",
      "cerebrum-optic-tract-left",
      "cerebrum-optic-tract-right",
      "cerebrum-orbital-gyri-frontomarginal-gyrus-and-sulcus-left",
      "cerebrum-orbital-gyri-frontomarginal-gyrus-and-sulcus-right",
      "cerebrum-orbital-gyri-left",
      "cerebrum-orbital-gyri-right",
      "cerebrum-orbital-part-of-inferior-frontal-gyrus-left",
      "cerebrum-orbital-part-of-inferior-frontal-gyrus-right",
      "cerebrum-orbital-sulci-h-shaped-orbital-sulci-left",
      "cerebrum-orbital-sulci-h-shaped-orbital-sulci-right",
      "cerebrum-orbital-sulci-lateral-orbital-sulcus-left",
      "cerebrum-orbital-sulci-lateral-orbital-sulcus-right",
      "cerebrum-paracentral-gyrus-and-sulcus-left",
      "cerebrum-paracentral-gyrus-and-sulcus-right",
      "cerebrum-paracentral-sulcus-left",
      "cerebrum-paracentral-sulcus-right",
      "cerebrum-parieto-occipital-sulcus-left",
      "cerebrum-parieto-occipital-sulcus-right",
      "cerebrum-postcentral-gyrus-left",
      "cerebrum-postcentral-gyrus-right",
      "cerebrum-postcentral-sulcus-left",
      "cerebrum-postcentral-sulcus-right",
      "cerebrum-posterior-commissure",
      "cerebrum-posterior-transverse-collateral-sulcus-left",
      "cerebrum-posterior-transverse-collateral-sulcus-right",
      "cerebrum-precentral-gyrus-left",
      "cerebrum-precentral-gyrus-right",
      "cerebrum-precentral-sulcus-inferior-part-left",
      "cerebrum-precentral-sulcus-inferior-part-right",
      "cerebrum-precentral-sulcus-superior-part-left",
      "cerebrum-precentral-sulcus-superior-part-right",
      "cerebrum-precuneus-left",
      "cerebrum-precuneus-right",
      "cerebrum-putamen-left",
      "cerebrum-putamen-right",
      "cerebrum-septal-nuclei",
      "cerebrum-septum-pellucidum",
      "cerebrum-straight-gyrus-gyrus-rectus-left",
      "cerebrum-straight-gyrus-gyrus-rectus-right",
      "cerebrum-stria-medullaris-thalami-left",
      "cerebrum-stria-medullaris-thalami-right",
      "cerebrum-stria-terminalis-left",
      "cerebrum-stria-terminalis-right",
      "cerebrum-subparietal-sulcus-left",
      "cerebrum-subparietal-sulcus-right",
      "cerebrum-sulcus-interm-prim-jensen-left",
      "cerebrum-sulcus-interm-prim-jensen-right",
      "cerebrum-superior-frontal-gyrus-left",
      "cerebrum-superior-frontal-gyrus-right",
      "cerebrum-superior-frontal-sulcus-left",
      "cerebrum-superior-frontal-sulcus-right",
      "cerebrum-superior-occipital-gyri-left",
      "cerebrum-superior-occipital-gyri-right",
      "cerebrum-superior-parietal-lobule-left",
      "cerebrum-superior-parietal-lobule-right",
      "cerebrum-superior-temporal-gyrus-lateral-part-left",
      "cerebrum-superior-temporal-gyrus-lateral-part-right",
      "cerebrum-superior-temporal-sulcus-left",
      "cerebrum-superior-temporal-sulcus-right",
      "cerebrum-supramarginal-gyrus-left",
      "cerebrum-supramarginal-gyrus-right",
      "cerebrum-temporal-plane-left",
      "cerebrum-temporal-plane-right",
      "cerebrum-temporal-pole-left",
      "cerebrum-temporal-pole-right",
      "cerebrum-thalamus-left",
      "cerebrum-thalamus-right",
      "cerebrum-third-ventricle",
      "cerebrum-transverse-frontopolar-gyrus-and-sulcus-left",
      "cerebrum-transverse-frontopolar-gyrus-and-sulcus-right",
      "cerebrum-transverse-occipital-sulcus-left",
      "cerebrum-transverse-occipital-sulcus-right",
      "cerebrum-transverse-temporal-gyri-left",
      "cerebrum-transverse-temporal-gyri-right",
      "cerebrum-triangular-part-of-inferior-frontal-gyrus-left",
      "cerebrum-triangular-part-of-inferior-frontal-gyrus-right",
      "cerebrum-white-matter-of-telencephalon-left",
      "cerebrum-white-matter-of-telencephalon-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "cerebellum": {
    "id": "cerebellum",
    "canonicalName": "Cerebellum",
    "koreanName": "소뇌",
    "system": "nervous",
    "systemKorean": "신경계",
    "description": "신체의 평형 감각과 정밀한 근육 협응 운동을 조율하는 소뇌 복합 구조",
    "aliases": [
      "소뇌",
      "cerebellum"
    ],
    "children": [
      "cerebellum-anterior-quadrangular-lobule-left",
      "cerebellum-anterior-quadrangular-lobule-right",
      "cerebellum-base-of-peduncle-left",
      "cerebellum-base-of-peduncle-right",
      "cerebellum-biventral-lobule-left",
      "cerebellum-biventral-lobule-right",
      "cerebellum-central-lobule",
      "cerebellum-culmen",
      "cerebellum-declive",
      "cerebellum-flocculus-left",
      "cerebellum-flocculus-right",
      "cerebellum-folium-of-vermis",
      "cerebellum-gracile-lobule-left",
      "cerebellum-gracile-lobule-right",
      "cerebellum-inferior-semilunar-lobule-left",
      "cerebellum-inferior-semilunar-lobule-right",
      "cerebellum-lingula-of-cerebellum",
      "cerebellum-nodule-of-vermis",
      "cerebellum-peduncle-of-flocculus-left",
      "cerebellum-peduncle-of-flocculus-right",
      "cerebellum-posterior-quadrangular-lobule-left",
      "cerebellum-posterior-quadrangular-lobule-right",
      "cerebellum-pyramis-of-vermis",
      "cerebellum-superior-cerebellar-peduncle-left",
      "cerebellum-superior-cerebellar-peduncle-right",
      "cerebellum-superior-semilunar-lobule-left",
      "cerebellum-superior-semilunar-lobule-right",
      "cerebellum-tonsil-of-cerebellum-left",
      "cerebellum-tonsil-of-cerebellum-right",
      "cerebellum-tuber-of-vermis",
      "cerebellum-uvula-of-vermis",
      "cerebellum-wing-of-central-lobule-left",
      "cerebellum-wing-of-central-lobule-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "cardiac-internal-structures": {
    "id": "cardiac-internal-structures",
    "canonicalName": "Cardiac Internal Structures",
    "koreanName": "심장 내부 구조 (판막·유두근)",
    "system": "cardiovascular",
    "systemKorean": "심혈관계",
    "description": "삼첨판·이첨판(승모판)·폐동맥판·대동맥판 및 유두근으로 구성된 심장 판막계",
    "aliases": [
      "심장판막",
      "판막",
      "유두근",
      "승모판",
      "삼첨판"
    ],
    "children": [
      "cardiac-internal-structures-anterior-papillary-muscle-of-right-ventricle",
      "cardiac-internal-structures-anterior-semilunar-leaflet-of-pulmonary-valve",
      "cardiac-internal-structures-inferior-leaflet-of-right-atrioventricular-valve",
      "cardiac-internal-structures-inferior-papillary-muscle-of-left-ventricle",
      "cardiac-internal-structures-inferior-papillary-muscle-of-right-ventricle",
      "cardiac-internal-structures-left-coronary-leaflet",
      "cardiac-internal-structures-left-semilunar-leaflet-of-pulmonary-valve",
      "cardiac-internal-structures-non-coronary-leaflet",
      "cardiac-internal-structures-posterior-leaflet-of-left-atrioventricular-valve",
      "cardiac-internal-structures-right-coronary-leaflet",
      "cardiac-internal-structures-right-semilunar-leaflet-of-pulmonary-valve",
      "cardiac-internal-structures-septal-leaflet-of-right-atrioventricular-valve",
      "cardiac-internal-structures-septal-papillary-muscle-of-right-ventricle"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "pulmonary-arteries": {
    "id": "pulmonary-arteries",
    "canonicalName": "Pulmonary Arteries",
    "koreanName": "폐동맥군",
    "system": "cardiovascular",
    "systemKorean": "심혈관계",
    "description": "우심실에서 폐로 정맥혈을 이송하는 폐동맥 줄기 및 분지 혈관군",
    "aliases": [
      "폐동맥",
      "폐동맥군",
      "pulmonary artery"
    ],
    "children": [
      "pulmonary-arteries-anterior-basal-segmental-artery-of-left-lung",
      "pulmonary-arteries-anterior-basal-segmental-artery-of-right-lung",
      "pulmonary-arteries-anterior-segmental-artery-of-left-lung",
      "pulmonary-arteries-anterior-segmental-artery-of-right-lung",
      "pulmonary-arteries-apical-segmental-artery-of-left-lung",
      "pulmonary-arteries-apical-segmental-artery-of-right-lung",
      "pulmonary-arteries-bifurcation-of-pulmonary-trunk",
      "pulmonary-arteries-inferior-lingular-artery-of-left-lung",
      "pulmonary-arteries-inferior-lobar-artery-of-right-lung",
      "pulmonary-arteries-lateral-basal-segmental-artery-of-left-lung",
      "pulmonary-arteries-lateral-basal-segmental-artery-of-right-lung",
      "pulmonary-arteries-lateral-segmental-artery-of-right-lung",
      "pulmonary-arteries-left-pulmonary-artery",
      "pulmonary-arteries-medial-basal-segmental-artery-of-left-lung",
      "pulmonary-arteries-medial-basal-segmental-artery-of-right-lung",
      "pulmonary-arteries-medial-segmental-artery-of-right-lung",
      "pulmonary-arteries-middle-lobar-artery-of-right-lung",
      "pulmonary-arteries-posterior-basal-segmental-artery-of-left-lung",
      "pulmonary-arteries-posterior-basal-segmental-artery-of-right-lung",
      "pulmonary-arteries-posterior-segmental-artery-of-left-lung",
      "pulmonary-arteries-posterior-segmental-artery-of-right-lung",
      "pulmonary-arteries-pulmonary-trunk",
      "pulmonary-arteries-right-pulmonary-artery",
      "pulmonary-arteries-superior-lingular-artery-of-left-lung",
      "pulmonary-arteries-superior-lobar-artery-of-right-lung",
      "pulmonary-arteries-superior-segmental-artery-of-left-lung",
      "pulmonary-arteries-superior-segmental-artery-of-right-lung"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "pulmonary-veins": {
    "id": "pulmonary-veins",
    "canonicalName": "Pulmonary Veins",
    "koreanName": "폐정맥군",
    "system": "cardiovascular",
    "systemKorean": "심혈관계",
    "description": "폐에서 산소화된 동맥혈을 좌심방으로 전달하는 폐정맥 혈관군",
    "aliases": [
      "폐정맥",
      "폐정맥군",
      "pulmonary vein"
    ],
    "children": [
      "pulmonary-veins-anterior-vein-of-left-lung",
      "pulmonary-veins-anterior-vein-of-right-lung",
      "pulmonary-veins-apical-vein-of-right-lung",
      "pulmonary-veins-apicoposterior-vein-of-left-lung",
      "pulmonary-veins-inferior-basal-vein-of-left-lung",
      "pulmonary-veins-inferior-basal-vein-of-right-lung",
      "pulmonary-veins-inferior-lingular-vein-of-left-lung",
      "pulmonary-veins-lateral-vein-of-right-lung",
      "pulmonary-veins-left-inferior-pulmonary-vein",
      "pulmonary-veins-left-superior-pulmonary-vein",
      "pulmonary-veins-lingular-vein-of-left-lung",
      "pulmonary-veins-medial-vein-of-right-lung",
      "pulmonary-veins-posterior-vein-of-right-lung",
      "pulmonary-veins-right-inferior-pulmonary-vein",
      "pulmonary-veins-right-superior-pulmonary-vein",
      "pulmonary-veins-superior-basal-vein-of-left-lung",
      "pulmonary-veins-superior-basal-vein-of-right-lung",
      "pulmonary-veins-superior-lingular-vein-of-left-lung",
      "pulmonary-veins-superior-vein-of-left-lung",
      "pulmonary-veins-superior-vein-of-right-lung"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "neck-muscles": {
    "id": "neck-muscles",
    "canonicalName": "Neck Muscles",
    "koreanName": "Neck Muscles",
    "system": "muscular",
    "systemKorean": "muscular",
    "description": "Neck Muscles 복합 구조",
    "aliases": [
      "neck muscles"
    ],
    "children": [
      "neck-muscles-anterior-belly-of-digastric-muscle-left",
      "neck-muscles-anterior-belly-of-digastric-muscle-right",
      "neck-muscles-ary-epiglottic-part-of-oblique-arytenoid-muscle-left",
      "neck-muscles-ary-epiglottic-part-of-oblique-arytenoid-muscle-right",
      "neck-muscles-external-part-of-thyro-arytenoid-muscle-left",
      "neck-muscles-external-part-of-thyro-arytenoid-muscle-right",
      "neck-muscles-geniohyoid-muscle-left",
      "neck-muscles-geniohyoid-muscle-right",
      "neck-muscles-inferior-pharyngeal-constrictor-left",
      "neck-muscles-inferior-pharyngeal-constrictor-right",
      "neck-muscles-intermediate-tendon-of-digastric-muscle-left",
      "neck-muscles-intermediate-tendon-of-digastric-muscle-right",
      "neck-muscles-lateral-crico-arytenoid-muscle-left",
      "neck-muscles-lateral-crico-arytenoid-muscle-right",
      "neck-muscles-longus-capitis-muscle-left",
      "neck-muscles-longus-capitis-muscle-right",
      "neck-muscles-longus-colli-muscle-left",
      "neck-muscles-longus-colli-muscle-right",
      "neck-muscles-middle-pharyngeal-constrictor-left",
      "neck-muscles-middle-pharyngeal-constrictor-right",
      "neck-muscles-mylohyoid-muscle-left",
      "neck-muscles-mylohyoid-muscle-right",
      "neck-muscles-oblique-part-of-cricothyroid-muscle-left",
      "neck-muscles-oblique-part-of-cricothyroid-muscle-right",
      "neck-muscles-omohyoid-muscle-left",
      "neck-muscles-omohyoid-muscle-right",
      "neck-muscles-palatopharyngeus-muscle-left",
      "neck-muscles-palatopharyngeus-muscle-right",
      "neck-muscles-platysma-left",
      "neck-muscles-platysma-right",
      "neck-muscles-posterior-belly-of-digastric-muscle-left",
      "neck-muscles-posterior-belly-of-digastric-muscle-right",
      "neck-muscles-posterior-crico-arytenoid-muscle-left",
      "neck-muscles-posterior-crico-arytenoid-muscle-right",
      "neck-muscles-rectus-anterior-capitis-muscle-left",
      "neck-muscles-rectus-anterior-capitis-muscle-right",
      "neck-muscles-rectus-lateralis-capitis-muscle-left",
      "neck-muscles-rectus-lateralis-capitis-muscle-right",
      "neck-muscles-scalenus-anterior-muscle-left",
      "neck-muscles-scalenus-anterior-muscle-right",
      "neck-muscles-scalenus-medius-muscle-left",
      "neck-muscles-scalenus-medius-muscle-right",
      "neck-muscles-scalenus-posterior-muscle-left",
      "neck-muscles-scalenus-posterior-muscle-right",
      "neck-muscles-sternocleidomastoid-muscle-left",
      "neck-muscles-sternocleidomastoid-muscle-right",
      "neck-muscles-sternohyoid-muscle-left",
      "neck-muscles-sternohyoid-muscle-right",
      "neck-muscles-sternothyroid-muscle-left",
      "neck-muscles-sternothyroid-muscle-right",
      "neck-muscles-straight-part-of-cricothyroid-muscle-left",
      "neck-muscles-straight-part-of-cricothyroid-muscle-right",
      "neck-muscles-stylohyoid-muscle-left",
      "neck-muscles-stylohyoid-muscle-right",
      "neck-muscles-stylopharyngeus-muscle-left",
      "neck-muscles-stylopharyngeus-muscle-right",
      "neck-muscles-superior-pharyngeal-constrictor-left",
      "neck-muscles-superior-pharyngeal-constrictor-right",
      "neck-muscles-thyro-epiglottic-part-of-thyro-arytenoid-muscle-left",
      "neck-muscles-thyro-epiglottic-part-of-thyro-arytenoid-muscle-right",
      "neck-muscles-thyrohyoid-muscle-left",
      "neck-muscles-thyrohyoid-muscle-right",
      "neck-muscles-transverse-arytenoid-muscle"
    ],
    "isCompound": true,
    "has3DMesh": true
  },
  "hand-muscles": {
    "id": "hand-muscles",
    "canonicalName": "Hand Muscles",
    "koreanName": "Hand Muscles",
    "system": "muscular",
    "systemKorean": "muscular",
    "description": "Hand Muscles 복합 구조",
    "aliases": [
      "hand muscles"
    ],
    "children": [
      "hand-muscles-abductor-digiti-minimi-of-hand-left",
      "hand-muscles-abductor-digiti-minimi-of-hand-right",
      "hand-muscles-abductor-pollicis-brevis-left",
      "hand-muscles-abductor-pollicis-brevis-right",
      "hand-muscles-deep-head-of-flexor-pollicis-brevis-left",
      "hand-muscles-deep-head-of-flexor-pollicis-brevis-right",
      "hand-muscles-dorsal-interossei-muscles-of-hand-left",
      "hand-muscles-dorsal-interossei-muscles-of-hand-right",
      "hand-muscles-flexor-digiti-minimi-of-hand-left",
      "hand-muscles-flexor-digiti-minimi-of-hand-right",
      "hand-muscles-lumbrical-muscles-of-hand-left",
      "hand-muscles-lumbrical-muscles-of-hand-right",
      "hand-muscles-oblique-head-of-adductor-pollicis-left",
      "hand-muscles-oblique-head-of-adductor-pollicis-right",
      "hand-muscles-opponens-digiti-minimi-muscle-of-hand-left",
      "hand-muscles-opponens-digiti-minimi-muscle-of-hand-right",
      "hand-muscles-opponens-pollicis-muscle-left",
      "hand-muscles-opponens-pollicis-muscle-right",
      "hand-muscles-palmar-interossei-muscles-left",
      "hand-muscles-palmar-interossei-muscles-right",
      "hand-muscles-superficial-head-of-flexor-pollicis-brevis-left",
      "hand-muscles-superficial-head-of-flexor-pollicis-brevis-right",
      "hand-muscles-transverse-head-of-adductor-pollicis-left",
      "hand-muscles-transverse-head-of-adductor-pollicis-right"
    ],
    "isCompound": true,
    "has3DMesh": true
  }
};
