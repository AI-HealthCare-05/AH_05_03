export type SharePreset = "senior" | "transparent" | "privacy";
export type ShareBadge = "sensitive" | "metabolic" | "prescription" | "top_privacy" | "medical_record" | "circadian";
export type ShareIcon = "heart" | "droplet" | "pill" | "body" | "file" | "moon";
export type AuditAction = "approval" | "notification" | "security_block";

export type ShareMember = {
  id: string;
  name: string;
  relationship: string;
  initial: string;
};

export type ShareCategory = {
  id: string;
  title: string;
  badgeText: string;
  badgeType: ShareBadge;
  description: string;
  isEnabled: boolean;
  isLocked?: boolean;
  allowedMemberIds: string[];
  ruleDescription: string;
  iconName: ShareIcon;
};

export type ShareAuditLog = {
  id: string;
  memberName: string;
  initial?: string;
  actionType: AuditAction;
  title: string;
  detail: string;
  timeLabel: string;
};

export const SHARE_MEMBERS: ShareMember[] = [
  { id: "father", name: "오진철", relationship: "부친", initial: "진철" },
  { id: "spouse", name: "김다원", relationship: "배우자", initial: "다원" },
  { id: "child", name: "오민재", relationship: "자녀", initial: "민재" },
];

export const INITIAL_SHARE_CATEGORIES: ShareCategory[] = [
  {
    id: "bp_hr",
    title: "혈압 및 심박수 연속 모니터링",
    badgeText: "민감 바이탈",
    badgeType: "sensitive",
    description: "실시간 스마트워치 수축기/이완기 혈압, 아침 서지 경고, 24시간 변동 추이",
    isEnabled: true,
    allowedMemberIds: ["father", "spouse"],
    ruleDescription: "수치 140 이상 시 자동 긴급 알림 규칙 설정됨",
    iconName: "heart",
  },
  {
    id: "glucose_cgm",
    title: "공복 혈당 및 당화혈색소 추이",
    badgeText: "대사 지표",
    badgeType: "metabolic",
    description: "연속혈당측정기(CGM) 실시간 데이터 및 식후 2시간 스파이크 수치 기록",
    isEnabled: true,
    allowedMemberIds: ["spouse"],
    ruleDescription: "식후 급상승(Spike) 데이터 공유 동의",
    iconName: "droplet",
  },
  {
    id: "prescription_timeline",
    title: "처방전 & 일일 복약 타임라인",
    badgeText: "처방 의료정보",
    badgeType: "prescription",
    description: "복용 중인 고혈압/위장약 목록, 실시간 복약 여부 체크, 복약 누락 푸시 알림 연동",
    isEnabled: true,
    allowedMemberIds: ["father", "spouse", "child"],
    ruleDescription: "복약 미이행 알림 조건 관리",
    iconName: "pill",
  },
  {
    id: "pain_diary",
    title: "3D 통증 다이어리 및 일상 증상 기록",
    badgeText: "최상위프라이버시",
    badgeType: "top_privacy",
    description: "3D 바디맵 부위별 통증 척도(NRS 1~10), 봄이 AI 챗봇 상담 상세 기록 및 개인 심리 노트",
    isEnabled: false,
    isLocked: true,
    allowedMemberIds: [],
    ruleDescription: "통증 심화(NRS 7 이상 응급) 시에만 보호자에게 자동 알림 연동 가능",
    iconName: "body",
  },
  {
    id: "medical_exam_doc",
    title: "종합검진 원본 서류 & 의사 종합소견",
    badgeText: "종합 의무기록",
    badgeType: "medical_record",
    description: "세브란스 건강검진 결과표 스캔 원본 이미지, 위내시경 판독문, 28개 랩(Lab) 상세 수치",
    isEnabled: true,
    allowedMemberIds: ["spouse"],
    ruleDescription: "원본 다운로드 차단(뷰어 전용) 적용됨",
    iconName: "file",
  },
  {
    id: "sleep_stress_hrv",
    title: "웨어러블 수면 패턴 & 스트레스/HRV",
    badgeText: "생체 리듬",
    badgeType: "circadian",
    description: "수면 주기(렘/깊은 수면), 야간 심박변이도(HRV), 수면 중 호흡 안정도 지수",
    isEnabled: true,
    allowedMemberIds: ["spouse"],
    ruleDescription: "오전 08:00 데일리 수면 리포트 자동 동기화",
    iconName: "moon",
  },
];

export const INITIAL_SHARE_AUDIT_LOGS: ShareAuditLog[] = [
  { id: "log-1", memberName: "오진철", initial: "진철", actionType: "approval", title: "부친 오진철 열람 승인", detail: "'아침 혈압 측정값(128/82)' 조회", timeLabel: "오늘 08:35" },
  { id: "log-2", memberName: "김다원", initial: "다원", actionType: "notification", title: "배우자 김다원 알림 수신", detail: "'저녁 혈압약 복약 완료' 푸시 수신", timeLabel: "어제 21:14" },
  { id: "log-3", memberName: "보안 시스템 방어벽", actionType: "security_block", title: "비인가 접근 시도 (최근 30일)", detail: "0건 (침해 시도 완전 원천 차단됨)", timeLabel: "최근 30일" },
  { id: "log-4", memberName: "김다원", initial: "다원", actionType: "approval", title: "배우자 김다원 열람 승인", detail: "'수면 및 야간 HRV 회복 지수' 데일리 리포트 동기화", timeLabel: "2일 전 08:01" },
];

export function applySharePreset(categories: ShareCategory[], preset: SharePreset): ShareCategory[] {
  const allIds = SHARE_MEMBERS.map((member) => member.id);
  if (preset === "senior") {
    return categories.map((category) =>
      category.id === "bp_hr" || category.id === "prescription_timeline" || category.id === "glucose_cgm"
        ? { ...category, isEnabled: true, allowedMemberIds: ["father", "spouse"] }
        : { ...category, isEnabled: false },
    );
  }
  if (preset === "transparent") {
    return categories.map((category) =>
      category.id === "pain_diary"
        ? { ...category, isEnabled: false, allowedMemberIds: [] }
        : { ...category, isEnabled: true, allowedMemberIds: allIds },
    );
  }
  return categories.map((category) => ({ ...category, isEnabled: false, allowedMemberIds: [] }));
}

export function toggleShareCategory(categories: ShareCategory[], categoryId: string): ShareCategory[] {
  return categories.map((category) => (category.id === categoryId ? { ...category, isEnabled: !category.isEnabled } : category));
}
