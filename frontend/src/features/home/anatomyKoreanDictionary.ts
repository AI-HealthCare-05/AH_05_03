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
  isStandardMatched?: boolean;
}

export interface DictionaryEntry {
  korean: string;
  canonical: string;
  system: string;
  systemKorean: string;
  description: string;
}

/**
 * 주요 근육, 골격, 인대, 관절 및 장기 해부학 표준 명칭 사전
 */
export const ANATOMY_DICTIONARY: Record<string, DictionaryEntry> = {
  // --- 소화기계 및 복막 (Peritoneum / Omentum) ---
  "greater omentum": {
    korean: "대망 (큰그물망)",
    canonical: "Greater omentum",
    system: "digestive",
    systemKorean: "소화기계",
    description: "위와 대장 앞을 앞치마처럼 넓게 덮고 있는 복막 주름으로, 복부 장기를 보호하고 면역 기능을 담당합니다.",
  },
  "lesser omentum": {
    korean: "소망 (작은그물망)",
    canonical: "Lesser omentum",
    system: "digestive",
    systemKorean: "소화기계",
    description: "간과 위의 작은만곡, 십이지장을 연결하는 복막 주름입니다.",
  },
  "mesocolon": {
    korean: "결장간막",
    canonical: "Mesocolon",
    system: "digestive",
    systemKorean: "소화기계",
    description: "대장(결장)을 후복벽에 연결하고 지지하는 복막 주름입니다.",
  },
  "meso appendix": {
    korean: "충수간막",
    canonical: "Meso-appendix",
    system: "digestive",
    systemKorean: "소화기계",
    description: "충수를 맹장 및 장간막에 연결하고 혈관을 공급하는 복막 주름입니다.",
  },
  "peritoneum": {
    korean: "복막",
    canonical: "Peritoneum",
    system: "digestive",
    systemKorean: "소화기계",
    description: "복강 내부 벽과 복부 장기 전체를 감싸 보호하는 장막입니다.",
  },

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
  // --- 두개골 및 안면골 ---
  "frontal bone": {
    korean: "전두골",
    canonical: "Frontal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "이마 부위를 형성하고 안와(눈구멍)의 천장을 이루는 머리뼈입니다.",
  },
  "parietal bone": {
    korean: "두정골",
    canonical: "Parietal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "머리의 정수리와 양 측면 상부를 이루는 판 모양의 뼈입니다.",
  },
  "occipital bone": {
    korean: "후두골",
    canonical: "Occipital bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "머리의 뒤통수와 바닥을 이루며 척수와 뇌가 연결되는 대후두공을 포함합니다.",
  },
  "temporal bone": {
    korean: "측두골",
    canonical: "Temporal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "머리의 관자 부위와 귀 주변을 둘러싸는 뼈로 청각 및 평형 기관을 보호합니다.",
  },
  "sphenoid bone": {
    korean: "접형골",
    canonical: "Sphenoid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "나비 모양의 뼈로 두개골 바닥 중앙에 위치하여 여러 뼈들을 연결합니다.",
  },
  "ethmoid bone": {
    korean: "사골",
    canonical: "Ethmoid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "비강(코안)의 천장과 안와 안쪽 벽을 이루는 벌집 모양의 가벼운 뼈입니다.",
  },
  mandible: {
    korean: "하악골",
    canonical: "Mandible",
    system: "skeletal",
    systemKorean: "골격계",
    description: "아래턱을 형성하는 가장 크고 단단한 안면골로 저작과 발음에 핵심입니다.",
  },
  maxilla: {
    korean: "상악골",
    canonical: "Maxilla",
    system: "skeletal",
    systemKorean: "골격계",
    description: "위턱을 이루고 상악 치아를 지지하며 안면 중앙을 구성하는 뼈입니다.",
  },
  "zygomatic bone": {
    korean: "협골",
    canonical: "Zygomatic bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "뺨의 도드라진 윤곽(광대뼈)을 형성하는 안면골입니다.",
  },
  "nasal bone": {
    korean: "비골",
    canonical: "Nasal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "콧등의 뼈대를 이루는 한 쌍의 작은 장방형 뼈입니다.",
  },
  "lacrimal bone": {
    korean: "누골",
    canonical: "Lacrimal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "안와의 안쪽 벽을 이루는 작고 얇은 눈물뼈입니다.",
  },
  "hyoid bone": {
    korean: "설골",
    canonical: "Hyoid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "목 앞쪽에 떠 있는 U자형 뼈로 혀와 후두의 움직임을 지지합니다.",
  },
  // --- 척추 및 체간/사지 골격 ---
  vertebra: {
    korean: "척추뼈",
    canonical: "Vertebra",
    system: "skeletal",
    systemKorean: "골격계",
    description: "척추를 구성하는 마디 뼈로 척수를 보호하고 상체의 하중을 지탱합니다.",
  },
  calcaneus: {
    korean: "종골",
    canonical: "Calcaneus",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발뒤꿈치를 형성하는 가장 큰 발뼈로 보행 시 지면 충격을 가장 먼저 받습니다.",
  },
  talus: {
    korean: "거골",
    canonical: "Talus",
    system: "skeletal",
    systemKorean: "골격계",
    description: "정강뼈와 종골 사이에 위치하여 발목 관절의 굴곡 및 신전을 매개합니다.",
  },

  // --- 수근골 (Carpal bones, 손목뼈 8종) - 대한해부학회 제6판 표준 ---
  capitate: {
    korean: "유두골 (알머리뼈)",
    canonical: "Capitate bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목뼈(수근골) 원위부 중앙에 위치한 가장 큰 뼈로 손목 관절의 중심축입니다.",
  },
  "capitate bone": {
    korean: "유두골 (알머리뼈)",
    canonical: "Capitate bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목뼈(수근골) 원위부 중앙에 위치한 가장 큰 뼈로 손목 관절의 중심축입니다.",
  },
  lunate: {
    korean: "월상골 (반달뼈)",
    canonical: "Lunate bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목뼈 근위부 중앙의 반달 모양 뼈로 요골과 관절하여 손목 운동을 주도합니다.",
  },
  "lunate bone": {
    korean: "월상골 (반달뼈)",
    canonical: "Lunate bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목뼈 근위부 중앙의 반달 모양 뼈로 요골과 관절하여 손목 운동을 주도합니다.",
  },
  scaphoid: {
    korean: "주상골 (손배뼈)",
    canonical: "Scaphoid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목 엄지 쪽에 위치한 배 모양 뼈로 손을 짚고 넘어질 때 골절이 가장 흔한 부위입니다.",
  },
  "scaphoid bone": {
    korean: "주상골 (손배뼈)",
    canonical: "Scaphoid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목 엄지 쪽에 위치한 배 모양 뼈로 손을 짚고 넘어질 때 골절이 가장 흔한 부위입니다.",
  },
  triquetrum: {
    korean: "삼각골 (세모뼈)",
    canonical: "Triquetral bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목뼈 근위부 새끼손가락 쪽에 위치한 피라미드형 세모뼈입니다.",
  },
  triquetral: {
    korean: "삼각골 (세모뼈)",
    canonical: "Triquetral bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목뼈 근위부 새끼손가락 쪽에 위치한 피라미드형 세모뼈입니다.",
  },
  "triquetral bone": {
    korean: "삼각골 (세모뼈)",
    canonical: "Triquetral bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목뼈 근위부 새끼손가락 쪽에 위치한 피라미드형 세모뼈입니다.",
  },
  pisiform: {
    korean: "두상골 (콩알뼈)",
    canonical: "Pisiform bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "삼각골 앞면에 위치한 작은 콩알 모양의 종자골로 척측수근굴근 힘줄 속에 있습니다.",
  },
  "pisiform bone": {
    korean: "두상골 (콩알뼈)",
    canonical: "Pisiform bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "삼각골 앞면에 위치한 작은 콩알 모양의 종자골로 척측수근굴근 힘줄 속에 있습니다.",
  },
  trapezium: {
    korean: "대능형골 (큰마름뼈)",
    canonical: "Trapezium bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "엄지손가락 중수골과 안장관절을 이루어 엄지의 맞섬(대립) 운동을 가능하게 합니다.",
  },
  "trapezium bone": {
    korean: "대능형골 (큰마름뼈)",
    canonical: "Trapezium bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "엄지손가락 중수골과 안장관절을 이루어 엄지의 맞섬(대립) 운동을 가능하게 합니다.",
  },
  trapezoid: {
    korean: "소능형골 (작은마름뼈)",
    canonical: "Trapezoid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "둘째 손가락 중수골 바닥과 견고하게 결합하는 작은 마름모형 손목뼈입니다.",
  },
  "trapezoid bone": {
    korean: "소능형골 (작은마름뼈)",
    canonical: "Trapezoid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "둘째 손가락 중수골 바닥과 견고하게 결합하는 작은 마름모형 손목뼈입니다.",
  },
  hamate: {
    korean: "유구골 (갈고리뼈)",
    canonical: "Hamate bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손바닥 쪽에 튀어나온 갈고리(유구)가 있어 척골신경과 인대가 주행하는 뼈입니다.",
  },
  "hamate bone": {
    korean: "유구골 (갈고리뼈)",
    canonical: "Hamate bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손바닥 쪽에 튀어나온 갈고리(유구)가 있어 척골신경과 인대가 주행하는 뼈입니다.",
  },

  // --- 손허리뼈 및 손가락뼈 (Metacarpals & Phalanges of hand) ---
  metacarpal: {
    korean: "중수골 (손허리뼈)",
    canonical: "Metacarpal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목과 손가락 사이 손바닥 뼈대를 구성하는 원통형 긴뼈입니다.",
  },
  "metacarpal bone": {
    korean: "중수골 (손허리뼈)",
    canonical: "Metacarpal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손목과 손가락 사이 손바닥 뼈대를 구성하는 원통형 긴뼈입니다.",
  },
  "proximal phalanx hand": {
    korean: "수지 기절골 (손가락 첫마디뼈)",
    canonical: "Proximal phalanx of hand",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손가락의 뿌리 쪽에 위치한 첫 번째 마디 뼈입니다.",
  },
  "middle phalanx hand": {
    korean: "수지 중절골 (손가락 중간마디뼈)",
    canonical: "Middle phalanx of hand",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손가락의 중간 마디 뼈입니다 (엄지 제외).",
  },
  "distal phalanx hand": {
    korean: "수지 말절골 (손가락 끝마디뼈)",
    canonical: "Distal phalanx of hand",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손톱을 받치는 손가락의 가장 끝마디 뼈입니다.",
  },
  phalanx: {
    korean: "지골 (마디뼈)",
    canonical: "Phalanx",
    system: "skeletal",
    systemKorean: "골격계",
    description: "손가락 또는 발가락을 구성하는 마디뼈입니다.",
  },

  // --- 골반 및 하지대 (Pelvic girdle & Lower limb) ---
  "hip bone": {
    korean: "관골 (볼기뼈 / 골반골)",
    canonical: "Hip bone (Coxal bone)",
    system: "skeletal",
    systemKorean: "골격계",
    description: "장골, 좌골, 치골이 융합되어 골반환을 형성하고 대퇴골과 고관절을 이룹니다.",
  },
  "coxal bone": {
    korean: "관골 (볼기뼈 / 골반골)",
    canonical: "Hip bone (Coxal bone)",
    system: "skeletal",
    systemKorean: "골격계",
    description: "장골, 좌골, 치골이 융합되어 골반환을 형성하고 대퇴골과 고관절을 이룹니다.",
  },
  ischium: {
    korean: "좌골 (궁둥뼈)",
    canonical: "Ischium",
    system: "skeletal",
    systemKorean: "골격계",
    description: "골반의 후하부를 이루며 앉을 때 바닥에 체중이 실리는 궁둥뼈 결절을 포함합니다.",
  },
  pubis: {
    korean: "치골 (두덩뼈)",
    canonical: "Pubis",
    system: "skeletal",
    systemKorean: "골격계",
    description: "골반의 전하부를 이루며 좌우가 결합하여 치골결합을 형성합니다.",
  },
  coccyx: {
    korean: "미골 (꼬리뼈)",
    canonical: "Coccyx",
    system: "skeletal",
    systemKorean: "골격계",
    description: "천골 아래에 연결된 척추의 가장 끝 부분 융합 뼈입니다.",
  },

  // --- 족근골, 중족골 및 족지골 (Tarsals, Metatarsals & Foot phalanges) ---
  navicular: {
    korean: "주상골 (발배뼈)",
    canonical: "Navicular bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발목 안쪽에 위치하여 거골과 설상골 사이에서 내측 발아치를 지탱하는 배 모양 뼈입니다.",
  },
  "navicular bone": {
    korean: "주상골 (발배뼈)",
    canonical: "Navicular bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발목 안쪽에 위치하여 거골과 설상골 사이에서 내측 발아치를 지탱하는 배 모양 뼈입니다.",
  },
  cuboid: {
    korean: "입방골 (입방뼈)",
    canonical: "Cuboid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발목 외측에 위치하여 종골과 제4,5 중족골을 연결하는 주사위 모양 뼈입니다.",
  },
  "cuboid bone": {
    korean: "입방골 (입방뼈)",
    canonical: "Cuboid bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발목 외측에 위치하여 종골과 제4,5 중족골을 연결하는 주사위 모양 뼈입니다.",
  },
  cuneiform: {
    korean: "설상골 (쐐기뼈)",
    canonical: "Cuneiform bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발등 중앙 아치를 형성하는 쐐기 모양의 뼈입니다.",
  },
  "medial cuneiform": {
    korean: "내측 설상골 (안쪽 쐐기뼈)",
    canonical: "Medial cuneiform bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발목뼈 중 가장 안쪽에 위치한 쐐기뼈로 제1 중족골(엄지발가락)과 관절합니다.",
  },
  "intermediate cuneiform": {
    korean: "중간 설상골 (중간 쐐기뼈)",
    canonical: "Intermediate cuneiform bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "내측과 외측 설상골 사이에 위치한 가장 작은 쐐기뼈입니다.",
  },
  "lateral cuneiform": {
    korean: "외측 설상골 (가쪽 쐐기뼈)",
    canonical: "Lateral cuneiform bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "입방골 안쪽에 위치한 쐐기뼈로 제3 중족골과 관절합니다.",
  },
  metatarsal: {
    korean: "중족골 (발허리뼈)",
    canonical: "Metatarsal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발목과 발가락 사이 발바닥 아치를 이루는 5개의 긴 뼈입니다.",
  },
  "metatarsal bone": {
    korean: "중족골 (발허리뼈)",
    canonical: "Metatarsal bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발목과 발가락 사이 발바닥 아치를 이루는 5개의 긴 뼈입니다.",
  },
  "proximal phalanx foot": {
    korean: "족지 기절골 (발가락 첫마디뼈)",
    canonical: "Proximal phalanx of foot",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발가락의 뿌리 쪽에 위치한 첫 번째 마디 뼈입니다.",
  },
  "middle phalanx foot": {
    korean: "족지 중절골 (발가락 중간마디뼈)",
    canonical: "Middle phalanx of foot",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발가락의 중간 마디 뼈입니다.",
  },
  "distal phalanx foot": {
    korean: "족지 말절골 (발가락 끝마디뼈)",
    canonical: "Distal phalanx of foot",
    system: "skeletal",
    systemKorean: "골격계",
    description: "발톱을 받치는 발가락의 가장 끝마디 뼈입니다.",
  },

  // --- 척추 및 두개골 보강 ---
  atlas: {
    korean: "환추 (제1목뼈 / 고리뼈)",
    canonical: "Atlas (C1 vertebra)",
    system: "skeletal",
    systemKorean: "골격계",
    description: "두개골을 직접 받치는 첫 번째 경추뼈로 머리의 끄덕임 운동을 담당합니다.",
  },
  axis: {
    korean: "축추 (제2목뼈 / 중쇠뼈)",
    canonical: "Axis (C2 vertebra)",
    system: "skeletal",
    systemKorean: "골격계",
    description: "치돌기가 솟아 있어 환추와 결합하여 머리의 좌우 회전 운동 축을 제공합니다.",
  },
  "costal cartilage": {
    korean: "늑연골 (갈비연골)",
    canonical: "Costal cartilage",
    system: "skeletal",
    systemKorean: "골격계",
    description: "갈비뼈 앞쪽 끝을 흉골에 연결하는 탄력 있는 유리연골로 흉곽 팽창을 돕습니다.",
  },
  "palatine bone": {
    korean: "구개골 (입천장뼈)",
    canonical: "Palatine bone",
    system: "skeletal",
    systemKorean: "골격계",
    description: "단단한 입천장(경구개)의 뒷부분과 비강 외측벽을 형성하는 L자형 안면골입니다.",
  },
  vomer: {
    korean: "서골 (보습뼈)",
    canonical: "Vomer",
    system: "skeletal",
    systemKorean: "골격계",
    description: "비중격의 후하부를 이루는 얇은 사다리꼴 쟁기 모양 뼈입니다.",
  },
};

/**
 * 이름 기반 계통(System) 스마트 추론
 */
function inferSystemFromName(name: string): string {
  const lower = name.toLowerCase();
  if (
    lower.includes("bone") ||
    lower.includes("skull") ||
    lower.includes("cran") ||
    lower.includes("mandib") ||
    lower.includes("maxill") ||
    lower.includes("verteb") ||
    lower.includes("spine") ||
    lower.includes("sacrum") ||
    lower.includes("rib") ||
    lower.includes("cartilage") ||
    lower.includes("femur") ||
    lower.includes("tibia") ||
    lower.includes("fibula") ||
    lower.includes("humerus") ||
    lower.includes("radius") ||
    lower.includes("ulna") ||
    lower.includes("patell") ||
    lower.includes("clavic") ||
    lower.includes("scapul") ||
    lower.includes("carpal") ||
    lower.includes("tarsal") ||
    lower.includes("phalang") ||
    lower.includes("pelvis") ||
    lower.includes("ilium") ||
    lower.includes("ischium") ||
    lower.includes("pubis")
  ) {
    return "skeletal";
  }
  if (
    lower.includes("joint") ||
    lower.includes("ligament") ||
    lower.includes("capsule") ||
    lower.includes("articular") ||
    lower.includes("meniscus")
  ) {
    return "joints";
  }
  if (
    lower.includes("artery") ||
    lower.includes("vein") ||
    lower.includes("aorta") ||
    lower.includes("vena") ||
    lower.includes("vascular")
  ) {
    return "cardiovascular";
  }
  if (lower.includes("nerve") || lower.includes("ganglion") || lower.includes("brain")) {
    return "nervous";
  }
  if (lower.includes("lymph")) {
    return "lymphatic";
  }
  if (
    lower.includes("stomach") ||
    lower.includes("intestine") ||
    lower.includes("colon") ||
    lower.includes("rectum") ||
    lower.includes("esophagus") ||
    lower.includes("liver") ||
    lower.includes("gallbladder") ||
    lower.includes("pancreas") ||
    lower.includes("appendix") ||
    lower.includes("omentum") ||
    lower.includes("mesocolon") ||
    lower.includes("peritoneum")
  ) {
    return "digestive";
  }
  return "muscular";
}

/**
 * 척추(경추 C1~C7, 흉추 T1~T12, 요추 L1~L5), 천골, 미골 및 갈비뼈(늑골 1~12번)의
 * 분절 번호와 한글/라틴어 표준 명칭을 보존하여 개별 식별을 보장합니다.
 */
function resolveSegmentalBoneInfo(
  fullName: string,
  side?: "left" | "right" | "bilateral",
): AnatomyDisplayInfo | undefined {
  const lower = fullName.toLowerCase().replace(/[_.-]+/g, " ");
  const sidePrefixKr = side === "left" ? "좌측 " : side === "right" ? "우측 " : "";
  const sideSuffixEn = side === "left" ? " (Left)" : side === "right" ? " (Right)" : "";
  const sideShortEn = side === "left" ? " L" : side === "right" ? " R" : "";

  // 1. 환추 (경추 1번, Atlas)
  if (/\batlas\b/i.test(lower) || /\b(?:vertebra[_\s-]?)?c1\b/i.test(lower)) {
    return {
      koreanName: "환추 (경추 1번)",
      canonicalName: "Atlas (C1)",
      fullBilingualLabel: "환추 (경추 1번) (Atlas C1)",
      side,
      system: "skeletal",
      systemKorean: "골격계",
      description: "머리뼈를 직접 받치는 첫 번째 목뼈(경추 1번)로 고개를 끄덕이는 굽힘/폄 움직임을 담당합니다.",
    };
  }

  // 2. 축추 (경추 2번, Axis)
  if (/\baxis\b/i.test(lower) || /\b(?:vertebra[_\s-]?)?c2\b/i.test(lower)) {
    return {
      koreanName: "축추 (경추 2번)",
      canonicalName: "Axis (C2)",
      fullBilingualLabel: "축추 (경추 2번) (Axis C2)",
      side,
      system: "skeletal",
      systemKorean: "골격계",
      description: "환추와 맞물려 머리를 좌우로 도리도리 회전시키는 축 역할을 하는 두 번째 목뼈(경추 2번)입니다.",
    };
  }

  // 3. 경추 (C3 ~ C7)
  const cMatch = lower.match(/\b(?:vertebra|cervical)?\s*c([3-7])\b/i) || lower.match(/\bc([3-7])\b/i);
  if (cMatch && (lower.includes("vertebra") || lower.includes("cervical") || lower.includes("skeleton"))) {
    const num = cMatch[1];
    return {
      koreanName: `경추 ${num}번`,
      canonicalName: `Vertebra C${num}`,
      fullBilingualLabel: `경추 ${num}번 (Vertebra C${num})`,
      side,
      system: "skeletal",
      systemKorean: "골격계",
      description: `목 부위 척추를 구성하는 제${num}경추로 목의 하중을 분산하고 척수를 안전하게 보호합니다.`,
    };
  }

  // 4. 흉추 (T1 ~ T12)
  const tMatch = lower.match(/\b(?:vertebra|thoracic)?\s*t(1[0-2]|[1-9])\b/i) || lower.match(/\bt(1[0-2]|[1-9])\b/i);
  if (tMatch && (lower.includes("vertebra") || lower.includes("thoracic") || lower.includes("skeleton"))) {
    const num = tMatch[1];
    return {
      koreanName: `흉추 ${num}번`,
      canonicalName: `Vertebra T${num}`,
      fullBilingualLabel: `흉추 ${num}번 (Vertebra T${num})`,
      side,
      system: "skeletal",
      systemKorean: "골격계",
      description: `등 부위 척추를 구성하는 제${num}흉추로 갈비뼈와 관절을 이루어 흉곽을 형성합니다.`,
    };
  }

  // 5. 요추 (L1 ~ L5)
  const lMatch = lower.match(/\b(?:vertebra|lumbar)?\s*l([1-5])\b/i) || lower.match(/\bl([1-5])\b/i);
  if (lMatch && (lower.includes("vertebra") || lower.includes("lumbar") || lower.includes("skeleton"))) {
    const num = lMatch[1];
    return {
      koreanName: `요추 ${num}번`,
      canonicalName: `Vertebra L${num}`,
      fullBilingualLabel: `요추 ${num}번 (Vertebra L${num})`,
      side,
      system: "skeletal",
      systemKorean: "골격계",
      description: `허리 부위 척추를 구성하는 제${num}요추로 상체의 가장 큰 체중 하중을 지탱하는 핵심 뼈입니다.`,
    };
  }

  // 6. 천골 / 엉치뼈
  if (/\bsacrum\b/i.test(lower) || /\bsacral\b/i.test(lower)) {
    return {
      koreanName: "천골 (엉치뼈)",
      canonicalName: "Sacrum",
      fullBilingualLabel: "천골 (엉치뼈) (Sacrum)",
      side,
      system: "skeletal",
      systemKorean: "골격계",
      description: "척추의 아래쪽에서 골반과 척추를 단단히 연결하는 삼각형 형태의 뼈입니다.",
    };
  }

  // 7. 미골 / 꼬리뼈
  if (/\bcoccyx\b/i.test(lower) || /\bcoccygeal\b/i.test(lower)) {
    return {
      koreanName: "미골 (꼬리뼈)",
      canonicalName: "Coccyx",
      fullBilingualLabel: "미골 (꼬리뼈) (Coccyx)",
      side,
      system: "skeletal",
      systemKorean: "골격계",
      description: "척추의 가장 아래쪽 끝에 위치한 꼬리뼈입니다.",
    };
  }

  // 8. 갈비뼈 (늑골 1~12번)
  const ORDINAL_RIB: Record<string, number> = {
    first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6,
    seventh: 7, eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12,
  };
  if (lower.includes("rib")) {
    let ribNum: number | undefined;
    for (const [word, n] of Object.entries(ORDINAL_RIB)) {
      if (lower.includes(word)) {
        ribNum = n;
        break;
      }
    }
    if (!ribNum) {
      const digitMatch = lower.match(/\b(?:rib|costa)[_\s-]?([0-9]{1,2})\b/i) || lower.match(/\b([0-9]{1,2})(?:st|nd|rd|th)?\s*rib\b/i);
      if (digitMatch) {
        const parsed = parseInt(digitMatch[1], 10);
        if (parsed >= 1 && parsed <= 12) ribNum = parsed;
      }
    }
    if (ribNum) {
      const koreanName = `${sidePrefixKr}갈비뼈 ${ribNum}번 (제${ribNum}늑골)`;
      const canonicalName = `Rib ${ribNum}${sideSuffixEn}`;
      const fullBilingualLabel = `${sidePrefixKr}갈비뼈 ${ribNum}번 (Rib ${ribNum}${sideShortEn})`;
      return {
        koreanName,
        canonicalName,
        fullBilingualLabel,
        side,
        system: "skeletal",
        systemKorean: "골격계",
        description: `흉곽을 둘러싸 심장과 폐를 보호하는 좌/우 제${ribNum}번째 갈비뼈(늑골)입니다.`,
      };
    }
  }

  return undefined;
}

/**
 * 런타임에 감지된 미등록 해부학 부위 레지스트리 (중복 제거)
 */
export const unregisteredAnatomyRegistry = new Set<string>();

/**
 * 현재까지 감지된 미등록 해부학 부위 목록 반환
 */
export function getUnregisteredAnatomyList(): string[] {
  return Array.from(unregisteredAnatomyRegistry).sort();
}

if (typeof window !== "undefined") {
  (window as unknown as { __getUnregisteredAnatomy: typeof getUnregisteredAnatomyList }).__getUnregisteredAnatomy =
    getUnregisteredAnatomyList;
}

/**
 * 미등록 해부학 부위 목록 초기화
 */
export function clearUnregisteredAnatomyList(): void {
  unregisteredAnatomyRegistry.clear();
}


/**
 * 메쉬명에서 좌/우 방향성 및 기본 토큰을 추출하고 표준 한글/라틴어 병기 정보를 반환
 */
export function resolveAnatomyDisplayInfo(
  rawName: string,
  fallbackSystem?: string,
): AnatomyDisplayInfo {
  const resolvedFallback = fallbackSystem ?? inferSystemFromName(rawName);

  // 1. Z-Anatomy 계층 접두사 및 모델 래퍼 접두사 정리
  let cleaned = rawName
    .replace(/^body-shell__/, "")
    .replace(/^VH_[FM]_/, "")
    .replace(/^appendicular skeleton\s*/i, "")
    .replace(/^axial skeleton\s*/i, "")
    .replace(/^skeleton\s*/i, "")
    .trim();

  let side: "left" | "right" | "bilateral" | undefined;

  // 2. 방향성 검출 (접미사 .l, _l, -l 뿐 아니라 문자열 내부 단어 left/right 매칭)
  if (/\bleft\b/i.test(cleaned) || /\.l$/i.test(cleaned) || /_l$/i.test(cleaned) || /-l$/i.test(cleaned)) {
    side = "left";
    cleaned = cleaned
      .replace(/\.l$/i, "")
      .replace(/_l$/i, "")
      .replace(/-l$/i, "")
      .replace(/\bleft\b/gi, "")
      .trim();
  } else if (/\bright\b/i.test(cleaned) || /\.r$/i.test(cleaned) || /_r$/i.test(cleaned) || /-r$/i.test(cleaned)) {
    side = "right";
    cleaned = cleaned
      .replace(/\.r$/i, "")
      .replace(/_r$/i, "")
      .replace(/-r$/i, "")
      .replace(/\bright\b/gi, "")
      .trim();
  }

  // 3. Z-Anatomy 특유의 끝글자 오타 또는 방향성 잔여어(Bonel, Boner 등) 정규화
  cleaned = cleaned
    .replace(/\bbonel\b/gi, "bone")
    .replace(/\bboner\b/gi, "bone")
    .replace(/[_.-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  // 4. 반복되는 중복 토큰 정규화 (예: "Capitate Bone Capitate Bone" -> "Capitate Bone", "Exotic Test Bone Exotic Bone" -> "Exotic Test Bone")
  const rawWords = cleaned.split(/\s+/).filter(Boolean);
  const dedupedWords: string[] = [];
  const seenLower = new Set<string>();
  for (const w of rawWords) {
    const lower = w.toLowerCase();
    if (!seenLower.has(lower)) {
      dedupedWords.push(w);
      seenLower.add(lower);
    }
  }
  if (dedupedWords.length > 0) {
    cleaned = dedupedWords.join(" ");
  }


  // 척추/갈비뼈 등 분절 번호 보존 매칭 우선 수행
  const segmental = resolveSegmentalBoneInfo(`${rawName} ${cleaned}`, side);
  if (segmental) {
    return segmental;
  }

  // 언더스코어 공백 치환 및 정규화
  const normalizedKey = cleaned.toLowerCase().trim();

  // 사전 검색 (완전 일치 또는 부분 일치)
  let entry: DictionaryEntry | undefined = ANATOMY_DICTIONARY[normalizedKey];

  if (!entry) {
    // 단어 기반 탐색: 더 구체적인 키를 우선 매칭하기 위해 키 길이 내림차순 정렬 후 탐색
    const sortedKeys = Object.keys(ANATOMY_DICTIONARY).sort((a, b) => b.length - a.length);
    for (const key of sortedKeys) {
      if (normalizedKey === key || normalizedKey.includes(key)) {
        entry = ANATOMY_DICTIONARY[key];
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
      isStandardMatched: true,
    };
  }

  // 사전에 없는 경우: 미등록 레지스트리에 메모 등록 및 정돈된 자연어 표기
  unregisteredAnatomyRegistry.add(rawName);

  const titleCased = cleaned
    .split(" ")
    .filter((w) => w.length > 0)
    .map((w) => w[0].toUpperCase() + w.slice(1).toLowerCase())
    .join(" ");

  const fallbackKr = `${sidePrefixKr}${titleCased}`;
  const canonicalName = `${titleCased}${sideSuffixEn}`;
  const fullBilingualLabel = `${fallbackKr} (${titleCased}${sideShortEn})`;

  return {
    koreanName: fallbackKr,
    canonicalName,
    fullBilingualLabel,
    side,
    systemKorean: systemToKorean(resolvedFallback),
    system: resolvedFallback,
    description: "인체 3D 모델에서 선택된 세부 해부학 구조입니다.",
    isStandardMatched: false,
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

