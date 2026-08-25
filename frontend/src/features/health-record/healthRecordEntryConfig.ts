/**
 * 건강기록 진입 도우미 챗봇 설정
 *
 * 챗봇 이름('봄이' 등)은 가칭이므로 한 곳에서 쉽게 변경할 수 있도록 상수로 관리합니다.
 */
export const HEALTH_ASSISTANT_CONFIG = {
  name: "봄이",
  role: "건강기록 챗봇",
  greeting: (assistantName: string) => `안녕하세요!\n저는 이어봄의 건강기록 챗봇, ${assistantName}입니다.\n무엇을 도와드릴까요?`,
  inputPlaceholder: "통증을 말로 적어보세요. 저장 전 내용을 확인할 수 있어요.",
  disclaimer: "※ 봄이는 건강기록 작성을 돕는 도우미입니다. 의학적 진단이나 처방은 하지 않으며, 작성된 내용은 사용자가 직접 확인·확정한 뒤에만 브라우저 로컬에 암호화 저장됩니다.",
  actions: [
    {
      key: "ocr" as const,
      title: "검진 서류 올리기",
      description: "검진 결과지 이미지나 PDF를 읽고 확인합니다.",
      icon: "📄",
      badge: "AI 문서 인식",
    },
    {
      key: "manual" as const,
      title: "간편 기록",
      description: "혈압, 혈당, 체중, 검사 수치를 직접 기록합니다.",
      icon: "✍️",
      badge: "수치·수기",
    },
    {
      key: "pain" as const,
      title: "통증 기록",
      description: "대화로 통증 기록 초안을 만들고 직접 확인합니다.",
      icon: "🩺",
      badge: "대화형 입력",
    },
  ],
};
