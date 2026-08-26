/**
 * 건강기록 진입 도우미 챗봇 설정
 *
 * 챗봇 이름('봄이' 등)은 가칭이므로 한 곳에서 쉽게 변경할 수 있도록 상수로 관리합니다.
 */
export const HEALTH_ASSISTANT_CONFIG = {
  name: "봄이",
  role: "건강기록 도우미",
  greeting: (assistantName: string) => `안녕하세요. 건강기록 도우미 ${assistantName}입니다.\n기록을 조회하거나 새로 작성할 내용을 편하게 입력해 주세요.`,
  inputPlaceholder: "예: '지난번 혈당 얼마였지?' 또는 '오늘 혈당 105 나왔어'",
  disclaimer: "※ 봄이는 건강기록 검색과 작성을 돕는 보조 도구입니다. 의학적 진단이나 처방은 하지 않으며, 모든 내용은 사용자가 직접 확인·확정한 뒤에만 브라우저 로컬에 안전하게 저장됩니다.",
  actions: [
    {
      key: "ocr" as const,
      title: "검진 서류 올리기",
      description: "검진 결과지 이미지나 PDF 문서를 읽고 기록합니다.",
      badge: "문서 인식",
    },
    {
      key: "manual" as const,
      title: "간편 기록",
      description: "혈압, 혈당, 체중 등 측정 수치를 직접 입력합니다.",
      badge: "직접 입력",
    },
    {
      key: "pain" as const,
      title: "통증 기록",
      description: "대화로 통증 부위와 강도를 기록합니다.",
      badge: "증상 대화",
    },
  ],
};
