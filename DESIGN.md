---
version: alpha
name: Ieobom Violet Capsule
description: 이어봄 가족 건강 앱에 적용한 Stitch Violet Capsule Minimal. 이전 파란 키 컬러 정본은 DESIGN.ieobom.md.
colors:
  aubergine: "#3c315b"
  ghost-lavender: "#e2dffe"
  periwinkle: "#ab9ff2"
  cornflower-pop: "#4a87f2"
  buttercream: "#ffffc4"
  blush-mist: "#ffdadc"
  mint-signal: "#2ec08b"
  paper-white: "#fdfcfe"
  obsidian: "#1c1c1c"
  fog: "#86848d"
  ash: "#e9e8ea"
  bone: "#f4f2f4"
  surface: "#faf9fb"
  background: "#faf9fb"
  on-surface: "#1a1c1d"
  primary: "#261b44"
  primary-container: "#3c315b"
  secondary: "#5d5c76"
  secondary-container: "#e2dffe"
  error: "#ba1a1a"
  error-container: "#ffdad6"
  on-error-container: "#93000a"
  outline: "#7a757f"
typography:
  display:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 96px
    fontWeight: "300"
    lineHeight: "1.0"
    letterSpacing: -0.025em
  headline-lg:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 64px
    fontWeight: "300"
    lineHeight: "1.1"
    letterSpacing: -0.025em
  headline-md:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 30px
    fontWeight: "300"
    lineHeight: "1.21"
    letterSpacing: -0.025em
  headline-sm:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 24px
    fontWeight: "300"
    lineHeight: "1.25"
    letterSpacing: -0.025em
  subheading:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 20px
    fontWeight: "300"
    lineHeight: "1.35"
    letterSpacing: -0.025em
  body-md:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 16px
    fontWeight: "400"
    lineHeight: "1.4"
    letterSpacing: -0.025em
  body-sm:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 15px
    fontWeight: "300"
    lineHeight: "1.4"
    letterSpacing: -0.025em
  label-md:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 15px
    fontWeight: "400"
    lineHeight: "1.2"
    letterSpacing: -0.025em
  caption:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 13px
    fontWeight: "300"
    lineHeight: "1.35"
    letterSpacing: -0.025em
  micro:
    fontFamily: DM Sans, Noto Sans KR, Inter, Pretendard, sans-serif
    fontSize: 11px
    fontWeight: "300"
    lineHeight: "1.2"
    letterSpacing: -0.025em
rounded:
  none: 0px
  sm: 8px
  DEFAULT: 16px
  md: 24px
  lg: 32px
  xl: 48px
  full: 100px
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
    backgroundColor: "{colors.ghost-lavender}"
    textColor: "{colors.aubergine}"
    rounded: "{rounded.full}"
    height: "{spacing.touch-target}"
    padding: 16px 32px
    shadow: "0 0 24px rgba(171, 159, 242, 0.45), 0 0 8px rgba(226, 223, 254, 0.85)"
  button-secondary:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.aubergine}"
    rounded: "{rounded.full}"
    height: "{spacing.touch-target}"
    border: "1px solid {colors.ash}"
  button-danger:
    backgroundColor: "{colors.blush-mist}"
    textColor: "{colors.on-error-container}"
    rounded: "{rounded.full}"
    height: "{spacing.touch-target}"
  card-surface:
    backgroundColor: "{colors.paper-white}"
    rounded: "{rounded.md}"
    padding: 24px
    border: "1px solid {colors.ash}"
  badge-normal:
    backgroundColor: "{colors.mint-signal}"
    textColor: "{colors.paper-white}"
    rounded: "{rounded.full}"
  badge-caution:
    backgroundColor: "{colors.buttercream}"
    textColor: "{colors.obsidian}"
    rounded: "{rounded.full}"
  badge-high:
    backgroundColor: "{colors.periwinkle}"
    textColor: "{colors.aubergine}"
    rounded: "{rounded.full}"
  badge-very-high:
    backgroundColor: "{colors.blush-mist}"
    textColor: "{colors.on-error-container}"
    rounded: "{rounded.full}"
  input-text:
    backgroundColor: "{colors.paper-white}"
    textColor: "{colors.obsidian}"
    rounded: "{rounded.full}"
    height: "{spacing.touch-target}"
    border: "1px solid {colors.ash}"
---

# 이어봄 — Violet Capsule Minimal

정본은 이 파일이다. 파란 키 컬러(`#1d4fb8`) 시절 문서는 [`DESIGN.ieobom.md`](DESIGN.ieobom.md)에 백업해 두었다.

이어봄은 **가족 건강 기록과 만성질환 예측을 잇는 헬스케어 앱**이다. 시각 언어는 Stitch **Violet Capsule Minimal**(Phantom)이다. 웹3 랜딩의 재질·토큰을 쓰고, 카피·정보 구조는 가족 건강 제품에 맞춘다.

- **대상**: 30대 자녀부터 60대 부모님까지. 터치 타깃은 최소 **44px** (시안 검색 아이콘 32px를 그대로 쓰지 않는다).
- **철학**: 단색 바이올렛 축 + 캡슐 기하 + 속삭이듯 가벼운 타이포(DM Sans 300/350, tracking `-0.025em`). 임상 차트처럼 차가운 파란 크롬을 기본으로 두지 않는다.

## Colors

구조 축은 하나다.

- **Aubergine (`#3c315b`)**: 제목, 내비 글자, 아이콘 스트로크, 어두운 모듈.
- **Ghost Lavender (`#e2dffe`)**: 주요 CTA 면. Paper White 위에 떠 있는 행동 면.
- **Periwinkle (`#ab9ff2`)**: 보조 강조, 글로우, 「높음」 계열 워시.
- **Paper White (`#fdfcfe`) / Bone (`#f4f2f4`) / Surface (`#faf9fb`)**: 캔버스와 카드.
- **Obsidian (`#1c1c1c`)**: 밝은 면의 본문. Fog (`#86848d`)는 보조 문구. Ash (`#e9e8ea`)는 헤어라인.
- **캔디 악센트** (리듬용, 키 컬러로 늘리지 않음): Buttercream `#ffffc4`, Blush Mist `#ffdadc`, Cornflower Pop `#4a87f2`(희소).
- **상태**: Mint Signal `#2ec08b`(정상·활성), Blush+`#93000a`(매우 높음·파괴적 확인). **색만으로 상태를 말하지 않는다.** 배지에는 반드시 라벨(`매우 높음`, `주의`)을 둔다. 예전 Primary Blue `#1d4fb8`·선홍 `#ef4444`·차트 초록을 버튼·뱃지 기본값으로 쓰지 않는다.

## Typography

**DM Sans** (+ 한글 **Noto Sans KR**). 기본 무게 300/350, 본문만 400. 모든 단계 letter-spacing `-0.025em`.

앱 화면의 글자 위계는 이 일곱 칸만 쓴다. **11px 미만은 쓰지 않는다.** 12·14·17px처럼 칸 사이에 끼는 값은 아래 표로 올린다.

| 역할 | 크기 | 쓰는 곳 |
|---|---|---|
| micro | 11px | 오버라인·배지·단위·차트 눈금 |
| caption | 13px | 보조 설명·타임스탬프 |
| label / body-sm | 15px | 내비·버튼·이름·폼 |
| body-md | 16px | 본문 문단 |
| subheading | 20px | 카드·패널 제목 |
| headline-sm | 24px | 화면 제목(좁은 폭) |
| headline-md | 30px | 화면 제목 |

디스플레이·히어로는 line-height 1.0–1.1. 앱 화면 제목은 24–30px light가 기본이고, 랜딩용 64–96px는 마케팅 면에만 쓴다.

## Layout & Spacing

4px 스케일. 앱 본문 폭은 화면마다 `min(1120–1400px, 100% - 48px)`.

- 모바일: 여백 16px, 섹션 간격 48px까지 접힘.
- 데스크톱: 거터 24px, 카드 안 패딩 24px(앱) / 시안 데스크톱 48px.

## Elevation

방향성 그림자를 쌓지 않는다. 카드는 Ash 1px + Paper/Bone 면. 유일한 상시 그림자는 **Ghost CTA의 바이올렛 글로우**: `0 0 24px rgba(171, 159, 242, 0.45)`.

## Shapes

클릭 요소·칩·내비는 **캡슐 100px**. 카드·다이얼로그는 **24–32px**. 16px 미만 반경을 새로 만들지 않는다.

## Components

- **Primary CTA**: Ghost Lavender 면, Aubergine 글, 100px, 높이 ≥44px, 바이올렛 글로우. (`판정하기`, `초대`)
- **Secondary**: Paper + Ash 보더, 또는 Ghost 면 없이 글로우.
- **Danger**: Blush Mist 면, `#93000a` 글.
- **Nav pill**: Paper 면, Ash 보더, 활성 탭은 Ghost.
- **Input**: Paper, Ash 보더, 반경 16–100px, 높이 ≥44px, placeholder Fog.
- **배지**: 매우 높음=Blush, 높음=Periwinkle 워시, 주의=Buttercream, 정상=Mint 워시. 텍스트 라벨 필수.

## Do's and Don'ts

- **Do** 본문 대비 WCAG 2.1 AA(4.5:1). Mint 위 흰 글이 작으면 대비가 부족하니 워시+Obsidian을 쓴다.
- **Do** 터치 44px. 색과 라벨을 같이 쓴다.
- **Do** 3D WebGL은 온디맨드 렌더.
- **Don't** `#1d4fb8`를 키 컬러로 되돌리거나, 선홍/차트초록을 기본 뱃지·CTA에 쓰지 않는다.
- **Don't** 한 화면에 폰트 패밀리를 세 개 이상 섞지 않는다 (DM Sans + Noto Sans KR + 아이콘).
- **Don't** ui-ux-pro-max `--design-system`이 뽑는 청록·뉴모피즘을 이 파일 대신 쓰지 않는다.
