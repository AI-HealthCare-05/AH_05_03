/**
 * anatomyKoreanDictionary.ts
 * 3D 해부학 모델 메쉬명을 표준 한글 명칭과 라틴어/영문 원문으로 상호 변환하고
 * 계통 분류 및 일반 사용자 친화적 설명을 제공하는 사전 모듈.
 */

export interface AnatomyDisplayInfo {
  koreanName: string;
  canonicalName: string;
  fullBilingualLabel: string;
  side?: "left" | "right" | "bilateral";
  systemKorean: string;
  system: string;
  description: string;
}

interface DictionaryEntry {
  korean: string;
  canonical: string;
  system: string;
  systemKorean: string;
  description: string;
}

/**
 * 주요 근육, 골격, 인대, 관절 및 장기 해부학 표준 명칭 사전
 */
const ANATOMY_DICTIONARY: Record<string, DictionaryEntry> = {
  // --- 하지 근육 및 근막 ---
  "fascia lata": {
    korean: "대퇴근막",
    canonical: "Fascia lata",
    system: "muscular",
    systemKorean: "근육·결합조직계",
    description: "허벅지 바깥쪽을 감싸 골반과 무릎 관절의 안정성을 지지하는 단단한 결합조직막입니다.",
  },
  "rectus femoris": {
    korean: "대퇴직근",
    canonical: "Rectus femoris",
    system: "muscular",
    systemKorean: "근육계",
    description: "대퇴사두근 중앙에 위치하여 무릎을 펴고 고관절을 앞으로 굽히는 핵심 허벅지 근육입니다.",
  },
  "vastus lateralis": {
    korean: "외측광근",
    canonical: "Vastus lateralis",
    system: "muscular",
    systemKorean: "근육계",
    description: "대퇴사두근의 바깥쪽 부위로 스쿼트나 계단 오를 때 무릎을 강력하게 펴주는 근육입니다.",
  },
  "vastus medialis": {
    korean: "내측광근",
    canonical: "Vastus medialis",
    system: "muscular",
    systemKorean: "근육계",
    description: "대퇴사두근의 안쪽 부위로 무릎뼈(슬개골)의 안정적인 주행과 무릎 폄을 돕습니다.",
  },
  "vastus intermedius": {
    korean: "중간광근",
    canonical: "Vastus intermedius",
    system: "muscular",
    systemKorean: "근육계",
    description: "대퇴직근 아래 깊은 곳에 위치하여 무릎을 곧게 펴는 역할을 합니다.",
  },
  "iliotibial tract": {
    korean: "장경인대",
    canonical: "Iliotibial tract",
    system: "muscular",
    systemKorean: "근육·인대계",
    description: "골반에서 정강이뼈 바깥쪽으로 이어져 달리기 시 무릎 외측 안정성을 지지합니다.",
  },
  "biceps femoris": {
    korean: "대퇴이두근",
    canonical: "Biceps femoris",
    system: "muscular",
    systemKorean: "근육계",
    description: "햄스트링의 바깥쪽 근육으로 무릎을 굽히고 다리를 뒤로 뻗을 때 쓰입니다.",
  },
  "semitendinosus": {
    korean: "반건양근",
    canonical: "Semitendinosus",
    system: "muscular",
    systemKorean: "근육계",
    description: "햄스트링 안쪽에 위치하여 무릎을 굽히고 안쪽 회전을 돕는 힘줄형 근육입니다.",
  },
  "semimembranosus": {
    korean: "반막양근",
    canonical: "Semimembranosus",
    system: "muscular",
    systemKorean: "근육계",
    description: "햄스트링의 깊은 안쪽 근육으로 무릎 관절 굽힘과 골반 신전을 담당합니다.",
  },
  "sartorius": {
    korean: "봉공근",
    canonical: "Sartorius",
    system: "muscular",
    systemKorean: "근육계",
    description: "골반에서 무릎 안쪽으로 사선 주행하는 인체에서 가장 긴 근육(제기차기 동작에 관여)입니다.",
  },
  "gracilis": {
    korean: "박근",
    canonical: "Gracilis",
    system: "muscular",
    systemKorean: "근육계",
    description: "허벅지 가장 안쪽에 얇고 길게 위치하여 다리를 모으고 무릎을 굽히는 내전근입니다.",
  },
  "adductor longus": {
    korean: "장내전근",
    canonical: "Adductor longus",
    system: "muscular",
    systemKorean: "근육계",
    description: "허벅지 안쪽의 주요 내전근으로 다리를 안으로 모으는 역할을 합니다.",
  },
  "adductor magnus": {
    korean: "대내전근",
    canonical: "Adductor magnus",
    system: "muscular",
    systemKorean: "근육계",
    description: "허벅지 안쪽 깊숙이 자리한 가장 크고 두꺼운 다리 모음 근육입니다.",
  },
  "tensor fasciae latae": {
    korean: "대퇴근막장근",
    canonical: "Tensor fasciae latae",
    system: "muscular",
    systemKorean: "근육계",
    description: "골반 외측에서 대퇴근막과 장경인대를 팽팽하게 당겨 다리를 벌리고 보행을 지탱합니다.",
  },
  "gluteus maximus": {
    korean: "대둔근",
    canonical: "Gluteus maximus",
    system: "muscular",
    systemKorean: "근육계",
    description: "엉덩이의 가장 표층에 있는 큰 근육으로 상체를 세우고 다리를 뒤로 밀어내는 강력한 힘을 냅니다.",
  },
  "gluteus medius": {
    korean: "중둔근",
    canonical: "Gluteus medius",
    system: "muscular",
    systemKorean: "근육계",
    description: "엉덩이 바깥쪽 상단에 위치하여 한 발로 설 때 골반의 수평 균형을 유지하는 핵심 근육입니다.",
  },
  "gluteus minimus": {
    korean: "소둔근",
    canonical: "Gluteus minimus",
    system: "muscular",
    systemKorean: "근육계",
    description: "중둔근 안쪽 깊은 곳에 위치하여 고관절 외전과 안쪽 회전을 보조합니다.",
  },
  "piriformis": {
    korean: "이상근",
    canonical: "Piriformis",
    system: "muscular",
    systemKorean: "근육계",
    description: "골반 안쪽에서 대퇴골을 잇는 배 모양 근육으로, 좌골신경과 인접해 통증이 흔히 발생합니다.",
  },
  "gastrocnemius": {
    korean: "비복근",
    canonical: "Gastrocnemius",
    system: "muscular",
    systemKorean: "근육계",
    description: "종아리 뒤쪽의 두 갈래 표층 근육으로 까치발을 들거나 뛸 때 발목을 펴줍니다.",
  },
  "soleus": {
    korean: "가자미근",
    canonical: "Soleus",
    system: "muscular",
    systemKorean: "근육계",
    description: "비복근 깊은 곳에 넓게 위치하며 서 있는 자세 유지와 정맥 혈액 순환을 돕습니다.",
  },
  "tibialis anterior": {
    korean: "전경골근",
    canonical: "Tibialis anterior",
    system: "muscular",
    systemKorean: "근육계",
    description: "정강이 앞쪽에 위치하여 발목을 위로 들어 올리고 발 안쪽을 세워주는 근육입니다.",
  },
  "peroneus longus": {
    korean: "장비골근",
    canonical: "Peroneus longus",
    system: "muscular",
    systemKorean: "근육계",
    description: "종아리 바깥쪽을 따라 발바닥으로 이어져 발목 외측 안정성을 잡아줍니다.",
  },
  "achilles tendon": {
    korean: "아킬레스건",
    canonical: "Achilles tendon",
    system: "muscular",
    systemKorean: "근육·힘줄계",
    description: "종아리 근육을 발꿈치뼈에 연결하는 인체에서 가장 굵고 강한 힘줄입니다.",
  },

  // --- 상지 근육 ---
  "biceps brachii": {
    korean: "상완이두근",
    canonical: "Biceps brachii",
    system: "muscular",
    systemKorean: "근육계",
    description: "위팔 앞쪽의 두 갈래 근육으로 팔꿈치를 굽히고 손바닥을 위로 돌리는 역할을 합니다.",
  },
  "brachialis": {
    korean: "상완근",
    canonical: "Brachialis",
    system: "muscular",
    systemKorean: "근육계",
    description: "이두근 아래에서 팔꿈치 굽힘의 가장 순수하고 강력한 힘을 발휘하는 근육입니다.",
  },
  "triceps brachii": {
    korean: "상완삼두근",
    canonical: "Triceps brachii",
    system: "muscular",
    systemKorean: "근육계",
    description: "위팔 뒤쪽의 세 갈래 근육으로 팔꿈치를 곧게 펴고 밀어내는 동작을 담당합니다.",
  },
  "deltoid": {
    korean: "삼각근",
    canonical: "Deltoid",
    system: "muscular",
    systemKorean: "근육계",
    description: "어깨를 둥글게 감싸며 팔을 앞, 옆, 뒤로 들어 올리는 어깨 대표 근육입니다.",
  },
  "supraspinatus": {
    korean: "극상근",
    canonical: "Supraspinatus",
    system: "muscular",
    systemKorean: "근육계",
    description: "회전근개 상단 근육으로 팔을 처음 옆으로 들어 올릴 때 어깨 관절을 단단히 고정합니다.",
  },
  "infraspinatus": {
    korean: "극하근",
    canonical: "Infraspinatus",
    system: "muscular",
    systemKorean: "근육계",
    description: "회전근개 뒤쪽 근육으로 팔을 바깥쪽으로 회전시키며 어깨 후방 안정성을 담당합니다.",
  },
  "subscapularis": {
    korean: "견갑하근",
    canonical: "Subscapularis",
    system: "muscular",
    systemKorean: "근육계",
    description: "견갑골 앞면에서 팔을 안으로 회전시키고 어깨 관절의 탈구를 방지합니다.",
  },
  "teres minor": {
    korean: "소원근",
    canonical: "Teres minor",
    system: "muscular",
    systemKorean: "근육계",
    description: "회전근개를 구성하며 팔의 외회전과 어깨 안정성에 기여합니다.",
  },
  "brachioradialis": {
    korean: "완요골근",
    canonical: "Brachioradialis",
    system: "muscular",
    systemKorean: "근육계",
    description: "전완(아래팔) 바깥쪽에 두껍게 위치하여 엄지를 세운 상태로 팔꿈치를 굽힙니다.",
  },
  "pronator teres": {
    korean: "원회내근",
    canonical: "Pronator teres",
    system: "muscular",
    systemKorean: "근육계",
    description: "손바닥을 아래로 엎어 돌리는 역할을 하는 전완 안쪽 근육입니다.",
  },

  // --- 체간/가슴/등 근육 ---
  "pectoralis major": {
    korean: "대흉근",
    canonical: "Pectoralis major",
    system: "muscular",
    systemKorean: "근육계",
    description: "가슴 앞쪽을 넓게 덮는 부채꼴 근육으로 팔을 앞으로 모으고 밀어내는 동작을 합니다.",
  },
  "pectoralis minor": {
    korean: "소흉근",
    canonical: "Pectoralis minor",
    system: "muscular",
    systemKorean: "근육계",
    description: "대흉근 안쪽에서 견갑골을 앞으로 당겨 내리고 깊은 호흡을 보조합니다.",
  },
  "rectus abdominis": {
    korean: "복직근",
    canonical: "Rectus abdominis",
    system: "muscular",
    systemKorean: "근육계",
    description: "복부 중앙의 세로 근육(왕자 복근)으로 몸통을 앞으로 굽히고 복압을 유지합니다.",
  },
  "external oblique": {
    korean: "외복사근",
    canonical: "External oblique",
    system: "muscular",
    systemKorean: "근육계",
    description: "옆구리 표층 근육으로 몸통을 옆으로 숙이거나 반대쪽으로 회전시킵니다.",
  },
  "internal oblique": {
    korean: "내복사근",
    canonical: "Internal oblique",
    system: "muscular",
    systemKorean: "근육계",
    description: "외복사근 아래에서 몸통 회전과 복벽 지지를 돕습니다.",
  },
  "transversus abdominis": {
    korean: "복횡근",
    canonical: "Transversus abdominis",
    system: "muscular",
    systemKorean: "근육계",
    description: "복부 가장 깊은 층에서 코르셋처럼 척추와 복부 장기를 단단히 감싸 지지합니다.",
  },
  "trapezius": {
    korean: "승모근",
    canonical: "Trapezius",
    system: "muscular",
    systemKorean: "근육계",
    description: "목 뒤에서 등 중앙까지 다이아몬드형으로 덮여 어깨뼈를 올리고 내리며 자세를 지탱합니다.",
  },
  "latissimus dorsi": {
    korean: "광배근",
    canonical: "Latissimus dorsi",
    system: "muscular",
    systemKorean: "근육계",
    description: "등 아래쪽을 넓게 덮는 역삼각형 근육으로 팔을 아래로 당기는 힘(턱걸이, 풀다운)을 냅니다.",
  },
  "rhomboid major": {
    korean: "대능형근",
    canonical: "Rhomboid major",
    system: "muscular",
    systemKorean: "근육계",
    description: "견갑골 안쪽에서 척추를 잇는 마름모꼴 근육으로 어깨뼈를 뒤로 모아줍니다.",
  },
  "levator scapulae": {
    korean: "견갑거근",
    canonical: "Levator scapulae",
    system: "muscular",
    systemKorean: "근육계",
    description: "목 옆에서 견갑골 위쪽을 연결하여 어깨를 으쓱 올리며 목 통증과 자주 연관됩니다.",
  },
  "erector spinae": {
    korean: "척추기립근",
    canonical: "Erector spinae",
    system: "muscular",
    systemKorean: "근육계",
    description: "척추를 따라 길게 뻗어 허리와 등을 곧게 펴고 체간을 지탱하는 핵심 코어 근육군입니다.",
  },

  // --- 골격계 ---
  patella: {
    korean: "슬개골",
    canonical: "Patella",
    system: "skeletal",
    systemKorean: "골격계",
    description: "무릎 앞쪽에 위치한 밤톨 모양 뼈로 무릎 폄 시 지렛대 역할을 하여 힘을 배가시킵니다.",
  },
  femur: {
    korean: "대퇴골",
    canonical: "Femur",
    system: "skeletal",
    systemKorean: "골격계",
    description: "골반과 무릎을 연결하는 인체에서 가장 길고 튼튼한 넙다리뼈입니다.",
  },
  tibia: {
    korean: "경골",
    canonical: "Tibia",
    system: "skeletal",
    systemKorean: "골격계",
    description: "종아리 안쪽의 굵은 정강이뼈로 체중의 대부분을 지탱합니다.",
  },
  fibula: {
    korean: "비골",
    canonical: "Fibula",
    system: "skeletal",
    systemKorean: "골격계",
    description: "종아리 바깥쪽의 가느다란 종아리뼈로 근육 부착과 발목 관절 외측 안정성을 돕습니다.",
  },
  humerus: {
    korean: "상완골",
    canonical: "Humerus",
    system: "skeletal",
    systemKorean: "골격계",
    description: "어깨와 팔꿈치를 잇는 위팔의 긴 뼈입니다.",
  },
  radius: {
    korean: "요골",
    canonical: "Radius",
    system: "skeletal",
    systemKorean: "골격계",
    description: "아래팔의 엄지손가락 쪽에 위치한 뼈로 손목 회전에 핵심 역할을 합니다.",
  },
  ulna: {
    korean: "척골",
    canonical: "Ulna",
    system: "skeletal",
    systemKorean: "골격계",
    description: "아래팔의 새끼손가락 쪽에 위치하며 팔꿈치 관절의 주두(팔꿈치 머리)를 이룹니다.",
  },
  clavicle: {
    korean: "쇄골",
    canonical: "Clavicle",
    system: "skeletal",
    systemKorean: "골격계",
    description: "가슴뼈와 어깨를 가로로 연결하는 빗장뼈로 팔을 몸통에 연결하는 지지대입니다.",
  },
  scapula: {
    korean: "견갑골",
    canonical: "Scapula",
    system: "skeletal",
    systemKorean: "골격계",
    description: "등 뒤쪽의 날개뼈로 어깨 관절의 자유로운 움직임을 제공합니다.",
  },
  sternum: {
    korean: "흉골",
    canonical: "Sternum",
    system: "skeletal",
    systemKorean: "골격계",
    description: "가슴 앞 중앙의 넥타이 모양 복장뼈로 늑골과 함께 심장과 폐를 보호합니다.",
  },
  pelvis: {
    korean: "골반골",
    canonical: "Pelvis",
    system: "skeletal",
    systemKorean: "골격계",
    description: "장골, 좌골, 치골이 결합하여 내부 장기를 받치고 척추와 다리를 연결합니다.",
  },
  ilium: {
    korean: "장골",
    canonical: "Ilium",
    system: "skeletal",
    systemKorean: "골격계",
    description: "골반에서 가장 크고 넓은 상부 뼈로 허리띠가 걸쳐지는 골반 날개입니다.",
  },
  sacrum: {
    korean: "천골",
    canonical: "Sacrum",
    system: "skeletal",
    systemKorean: "골격계",
    description: "척추 아래쪽 5개의 척추뼈가 하나로 융합된 엉치뼈입니다.",
  },
  rib: {
    korean: "늑골",
    canonical: "Rib",
    system: "skeletal",
    systemKorean: "골격계",
    description: "가슴 부위를 둥글게 둘러싸며 호흡과 내부 장기 보호를 담당하는 갈비뼈입니다.",
  },
};

/**
 * 메쉬명에서 좌/우 방향성 및 기본 토큰을 추출하고 표준 한글/라틴어 병기 정보를 반환
 */
export function resolveAnatomyDisplayInfo(
  rawName: string,
  fallbackSystem: string = "muscular",
): AnatomyDisplayInfo {
  let cleaned = rawName
    .replace(/^body-shell__/, "")
    .replace(/^VH_[FM]_/, "")
    .trim();

  let side: "left" | "right" | "bilateral" | undefined;

  // 방향성 검출 (.l, .r, _L, _R, -l, -r, .left, .right 등)
  if (/\.l$/i.test(cleaned) || /_l$/i.test(cleaned) || /-l$/i.test(cleaned) || /\bleft\b/i.test(cleaned)) {
    side = "left";
    cleaned = cleaned
      .replace(/\.l$/i, "")
      .replace(/_l$/i, "")
      .replace(/-l$/i, "")
      .replace(/\bleft\b/i, "")
      .trim();
  } else if (/\.r$/i.test(cleaned) || /_r$/i.test(cleaned) || /-r$/i.test(cleaned) || /\bright\b/i.test(cleaned)) {
    side = "right";
    cleaned = cleaned
      .replace(/\.r$/i, "")
      .replace(/_r$/i, "")
      .replace(/-r$/i, "")
      .replace(/\bright\b/i, "")
      .trim();
  }

  // 언더스코어 공백 치환 및 정규화
  const normalizedKey = cleaned.replace(/[_.-]+/g, " ").trim().toLowerCase();

  // 사전 검색 (완전 일치 또는 부분 일치)
  let entry: DictionaryEntry | undefined = ANATOMY_DICTIONARY[normalizedKey];

  if (!entry) {
    // 키워드 탐색 (예: "gastrocnemius medial head" -> "gastrocnemius")
    for (const [key, val] of Object.entries(ANATOMY_DICTIONARY)) {
      if (normalizedKey.includes(key)) {
        entry = val;
        break;
      }
    }
  }

  const sidePrefixKr = side === "left" ? "좌측 " : side === "right" ? "우측 " : "";
  const sideSuffixEn = side === "left" ? " (Left)" : side === "right" ? " (Right)" : "";
  const sideShortEn = side === "left" ? " L" : side === "right" ? " R" : "";

  if (entry) {
    const koreanName = `${sidePrefixKr}${entry.korean}`;
    const canonicalName = `${entry.canonical}${sideSuffixEn}`;
    const fullBilingualLabel = `${koreanName} (${entry.canonical}${sideShortEn})`;

    return {
      koreanName,
      canonicalName,
      fullBilingualLabel,
      side,
      systemKorean: entry.systemKorean,
      system: entry.system,
      description: entry.description,
    };
  }

  // 사전에 없는 경우 자연어 표기 복원
  const titleCased = cleaned
    .replace(/[_.-]+/g, " ")
    .split(" ")
    .map((w) => (w.length > 0 ? w[0].toUpperCase() + w.slice(1).toLowerCase() : ""))
    .join(" ");

  const fallbackKr = `${sidePrefixKr}${titleCased}`;
  const canonicalName = `${titleCased}${sideSuffixEn}`;
  const fullBilingualLabel = `${fallbackKr} (${titleCased}${sideShortEn})`;

  return {
    koreanName: fallbackKr,
    canonicalName,
    fullBilingualLabel,
    side,
    systemKorean: systemToKorean(fallbackSystem),
    system: fallbackSystem,
    description: "인체 3D 모델에서 선택된 세부 해부학 구조입니다.",
  };
}

function systemToKorean(system: string): string {
  switch (system.toLowerCase()) {
    case "muscular":
      return "근육계";
    case "skeletal":
    case "skeleton":
      return "골격계";
    case "joints":
      return "관절계";
    case "nervous":
      return "신경계";
    case "cardiovascular":
      return "순환기계";
    case "digestive":
      return "소화기계";
    case "respiratory":
      return "호흡기계";
    case "integumentary":
      return "피부계";
    default:
      return "해부학계통";
  }
}
