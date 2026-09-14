---
version: alpha
name: Ieobom
description: 가족 건강 모니터링 및 만성질환 위험 선별을 위한 신뢰 기반 헬스케어 디자인 시스템
colors:
  primary: "#1d4fb8"
  primary-hover: "#173d8f"
  primary-light: "#eaf1ff"
  primary-container: "#f4f7ff"
  secondary: "#5b687e"
  secondary-strong: "#45536c"
  neutral: "#172033"
  surface: "#ffffff"
  background: "#f5f7fb"
  border: "#dce3ee"
  border-soft: "#e8edf5"
  safe: "#15936e"
  safe-text: "#0f6b50"
  safe-soft: "#e7f7f1"
  warning: "#b06000"
  warning-text: "#804600"
  warning-soft: "#fff5e6"
  danger: "#b43e47"
  danger-soft: "#fff0f1"
  garden-leaf: "#6e9b6a"
  garden-trunk: "#8a6142"
typography:
  headline-lg:
    fontFamily: Inter, Pretendard, sans-serif
    fontSize: 32px
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Inter, Pretendard, sans-serif
    fontSize: 24px
    fontWeight: 700
    lineHeight: 1.3
    letterSpacing: -0.01em
  headline-sm:
    fontFamily: Inter, Pretendard, sans-serif
    fontSize: 18px
    fontWeight: 600
    lineHeight: 1.4
  body-lg:
    fontFamily: Inter, Pretendard, sans-serif
    fontSize: 16px
    fontWeight: 400
    lineHeight: 1.5
  body-md:
    fontFamily: Inter, Pretendard, sans-serif
    fontSize: 14px
    fontWeight: 400
    lineHeight: 1.5
  body-sm:
    fontFamily: Inter, Pretendard, sans-serif
    fontSize: 12px
    fontWeight: 400
    lineHeight: 1.4
  label-md:
    fontFamily: Inter, Pretendard, sans-serif
    fontSize: 13px
    fontWeight: 600
    lineHeight: 1.2
  label-sm:
    fontFamily: Inter, Pretendard, sans-serif
    fontSize: 11px
    fontWeight: 600
    lineHeight: 1.2
rounded:
  none: 0px
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 22px
  full: 9999px
spacing:
  xs: 4px
  sm: 8px
  md: 16px
  lg: 24px
  xl: 32px
  2xl: 48px
  touch-target: 44px
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.surface}"
    rounded: "{rounded.sm}"
    height: "{spacing.touch-target}"
    padding: 16px
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
    textColor: "{colors.surface}"
  button-secondary:
    backgroundColor: "{colors.primary-light}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: "{spacing.touch-target}"
    padding: 16px
  button-outline:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.primary}"
    rounded: "{rounded.sm}"
    height: "{spacing.touch-target}"
    padding: 16px
  card-surface:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.xl}"
    padding: 24px
  card-soft:
    backgroundColor: "{colors.border-soft}"
    textColor: "{colors.secondary-strong}"
    rounded: "{rounded.md}"
    padding: 16px
  divider-line:
    backgroundColor: "{colors.border}"
    height: 1px
  badge-safe:
    backgroundColor: "{colors.safe-soft}"
    textColor: "{colors.safe-text}"
    rounded: "{rounded.full}"
    padding: 8px
  badge-warning:
    backgroundColor: "{colors.warning-soft}"
    textColor: "{colors.warning-text}"
    rounded: "{rounded.full}"
    padding: 8px
  badge-danger:
    backgroundColor: "{colors.danger-soft}"
    textColor: "{colors.danger}"
    rounded: "{rounded.full}"
    padding: 8px
  gauge-bar-safe:
    backgroundColor: "{colors.safe}"
    rounded: "{rounded.full}"
    height: 8px
  gauge-bar-warning:
    backgroundColor: "{colors.warning}"
    rounded: "{rounded.full}"
    height: 8px
  garden-art-foliage:
    backgroundColor: "{colors.garden-leaf}"
    rounded: "{rounded.lg}"
  garden-art-trunk:
    backgroundColor: "{colors.garden-trunk}"
    rounded: "{rounded.sm}"
  input-text:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.neutral}"
    rounded: "{rounded.sm}"
    height: "{spacing.touch-target}"
    padding: 12px
---

# 이어봄 (Ieobom) 디자인 시스템

## Overview

이어봄은 **가족 건강 기록과 만성질환 예측 AI(XAIOps)를 하나로 잇는 신뢰 중심의 헬스케어 인터페이스**입니다.

- **대상 사용자**: 30대 자녀부터 60대 부모님까지 3세대가 함께 사용하는 가족 건강 앱입니다. 노안과 시력 저하를 배려한 고대비 타이포그래피와 큼직한 터치 영역(최소 44px)을 필수로 준수합니다.
- **디자인 철학**:
  - **신뢰와 따뜻함 (Medical Trust & Warmth)**: 차가운 임상 차트 대신 부드러운 블루·화이트 표면과 온기 있는 카드 레이아웃으로 심리적 부담을 낮춥니다.
  - **오독 방지 (Misinterpretation Defense)**: 건강 위험도 색상(초록·주황·빨강)은 오직 의학적 선별 판정과 차트에만 제한 사용하며, 일반 행동 점수(챌린지 정원)와 시각적 역할을 엄격히 분리합니다.
  - **3D 홀로그램 인체 인터랙션 (Vanatome Atlas)**: 정밀 해부학 3D 모델(남녀 전신 메쉬)과 PBR 셰이더를 온디맨드(On-Demand) 방식으로 렌더링하여 고성능 4K 대화면에서도 GPU 과열 없이 매끄럽게 동작합니다.

## Colors

색상은 명도 대비와 의료 정보 전달의 정확성을 기준으로 엄격하게 통제됩니다.

- **Primary (`#1d4fb8` / `--blue-700`)**: 주요 CTA 버튼, 활성 상태 탭, 핵심 브랜드 식별색입니다.
- **Secondary (`#5b687e` / `--muted`)**: 보조 설명문, 타임스탬프, 보조 메타데이터 색상입니다. 흰색 배경뿐 아니라 연한 파랑 배경(`--blue-50`, `--line-soft`, `--blue-100`) 위에서도 WCAG 2.1 AA(최저 4.5:1 이상, 실측 4.79:1)를 만족하도록 보정되었습니다.
- **Neutral (`#172033` / `--ink`)**: 본문 헤드라인 및 일반 텍스트의 정본 색상입니다.
- **Surface (`#ffffff`) & Background (`#f5f7fb`)**: 피로도를 낮추는 연한 쿨그레이 배경 위에 순백색 카드를 얹어 컨텐츠 위계를 구성합니다.
- **의료 위험도 3색 (Medical Risk Colors)**:
  - **Safe (`#15936e`, 텍스트용 `#0f6b50`)**: 정상/저위험 상태 배지 및 게이지. 텍스트용은 연한 배경(`--safe-soft`) 위에서 4.5:1 이상 대비를 유지하기 위해 전용 토큰을 사용합니다.
  - **Warning (`#b06000` / `--caution`)**: 주의/중등도 위험.
  - **Danger (`#b43e47` / `--danger`)**: 고위험 판정 및 위험 장기 투시 하이라이트.
- **정원 아트 전용 색상 (`--garden-*`)**:
  - `garden-leaf` (`#6e9b6a`), `garden-trunk` (`#8a6142`): 챌린지 성취 점수로 자라는 나무 일러스트 전용 색상입니다. 상태 색(`--safe`)과의 혼동을 막기 위해 저채도 어스 톤(Earth tone)을 유지합니다.

## Typography

가독성과 판별력을 극대화하기 위해 시스템 폰트 체계(Inter, Pretendard)를 사용합니다.

- **Headline Large (32px / 700)**: 페이지 최상단 핵심 타이틀 (`가족의 건강 흐름을 한곳에서 이어보세요`).
- **Headline Medium (24px / 700)**: 섹션 제목 및 프로필 헤더.
- **Headline Small (18px / 600)**: 카드 제목, 모달 타이틀.
- **Body Large (16px / 400)**: 주요 건강 수치 설명 및 본문 단락.
- **Body Medium (14px / 400)**: 입력 폼 레이블, 테이블 본문 셀.
- **Body Small (12px / 400)**: 각주, 부가 안내, 법적 고지.
- **Label / Metric (11px~13px / 600)**: 차트 축, 배지, 수치 단위.

## Layout

**반응형 하이브리드 레이아웃**: 모바일 단일 칼럼부터 4K 대화면 3분할 워크스페이스까지 유연하게 대응합니다.

- **4K 모니터링 뷰**: 상단(가족 타임라인 바둑판 매트릭스), 좌하단(3D Vanatome 인체 뷰어 및 해부학 필터 툴바), 우측(봄이 AI 건강비서 및 치아 선택기 캔버스 드로어)의 고정 높이 그리드로 한눈에 가족 건강 상태를 조망합니다.
- **그리드 간격**: 8px 배수 시스템(4px 보조 스텝)을 기반으로 일관된 수직·수평 리듬을 유지합니다.
- **접근성 터치 타깃**: 모든 클릭 가능 요소(버튼, 체크박스, 날짜 셀, 프로필 카드)는 최소 **44px × 44px** 이상의 조작 영역을 확보합니다.

## Elevation & Depth

과도한 그림자나 네온 글로우 대신 **톤 레이어링(Tonal Layering)과 부드러운 감쇄 그림자**로 깊이감을 형성합니다.

- **Level 1 (Card Surface)**: `0 10px 32px rgba(35, 61, 112, 0.05)` — 배경 위에 살짝 떠 있는 부드러운 깊이감.
- **Level 2 (Dropdown / Dialog)**: `0 18px 50px rgba(35, 61, 112, 0.09)` — 모달 대화상자 및 플로팅 패널.
- **3D 인체 캔버스 컨테이너**: 심도 있는 블랙/다크 블루 백드롭(`rgba(15, 23, 42, 0.95)`)으로 PBR 셰이더와 장기 투시 발광을 극대화합니다.

## Shapes

친근하고 안정된 느낌을 주는 **소프트 라운디드 렉탱글(Soft Rounded Rectangle)** 언어를 채택합니다.

- **Card Radius (22px / `--card-radius`)**: 가족 홈 대시보드의 주요 패널과 요약 카드를 감싸는 부드러운 곡률.
- **Interactive Radius (8px~12px)**: 버튼, 입력창, 선택 박스.
- **Pill (9999px)**: 상태 배지, 태그, 필터 칩.

## Components

- **Primary Button**: 주 행동 유도 버튼 (`건강기록 작성`, `프로필 저장`). 높이 44px 이상, 반경 8px, Primary 블루 배경에 백색 텍스트.
- **Secondary / Ghost Button**: 보조 액션 (`프로필 관리`, `취소`). 연한 파랑 배경 또는 테두리 버튼.
- **Member Card**: 가족 구성원 탭. 선택 시 두꺼운 블루 테두리와 은은한 그림자로 명확한 포커스 제공.
- **Timeline Matrix Cell**: 날짜별 관찰 기록 블록. 기록 유무·심각도에 따라 색상과 도트가 부여되며, 키보드 및 스크린리더 `aria-label` 완벽 지원.
- **Vanatome 3D Viewer**: 3D 해부학 인체 뷰어로, 회전/줌 조작 및 장기 펄스 애니메이션은 GPU 과열 방지를 위해 필요 시에만 수렴 정지(On-demand) 방식으로 렌더링.

## Do's and Don'ts

- **Do** 모든 텍스트에 대해 WCAG 2.1 AA (4.5:1 이상) 명도 대비를 유지하세요.
- **Do** 터치 요소는 최소 44px 크기 또는 여백을 보장하여 50~60대 사용자도 편안하게 터치할 수 있게 하세요.
- **Do** 3D WebGL 렌더링은 반드시 온디맨드(On-Demand) 렌더링과 타임아웃 수렴을 적용하여 GPU 유휴 상태를 보장하세요.
- **Don't** 상태 색상(빨강/초록/주황)을 의학적 위험 판정 이외의 일반 장식이나 정원 나무 그래픽에 혼용하지 마세요.
- **Don't** 한 화면에 3개 이상의 폰트 패밀리나 임의의 인라인 색상을 정의하지 마세요.
- **Don't** 색상 단독으로만 상태를 전달하지 마세요. 반드시 레이블 텍스트(`주의 4개`, `안전`)나 아이콘을 병기하세요.
