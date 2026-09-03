"""데모 화면의 스타일.

ML 예측과 규칙 엔진이 한 화면에서 같은 껍데기를 쓴다. 두 결과를 비교하는 것이
목적이라 화면 차이가 모델 차이로 오해되면 안 된다.

색·서체·터치 타깃·상태색 대비 규칙은 docs/DESIGN.md 를 따랐다.
"""

CSS = """  :root {
    --accent: #0066CC; --canvas: #FFFFFF; --surface: #F5F5F7;
    --ink: #1D1D1F; --ink-2: #6E6E73; --ink-3: #8E8E93;
    --hairline: #E0E0E0; --divider: #F0F0F2; --placeholder: #C7C7CC;
    --low: #34C759; --moderate: #FF9500; --high: #FF6B35;
    /* 의학 기준 4단계. 위험 배지와 색 체계를 공유하되 단계가 하나 더 있다. */
    --lv0: #34C759; --lv1: #FFCC00; --lv2: #FF9500; --lv3: #FF3B30;
  }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 24px 20px 48px;
    font-family: "Pretendard Variable", Pretendard, -apple-system, system-ui, sans-serif;
    font-size: 17px; line-height: 1.55; letter-spacing: -0.2px;
    color: var(--ink); background: var(--surface);
    word-break: keep-all;
  }
  main { max-width: 640px; margin: 0 auto; }
  h1 { font-size: 30px; font-weight: 700; letter-spacing: -0.8px; line-height: 1.25; margin: 0 0 6px; }
  .kicker { font-size: 12px; font-weight: 700; letter-spacing: .06em; color: var(--ink-3); margin: 0 0 4px; }
  .lead { font-size: 15px; color: var(--ink-2); margin: 0 0 24px; }
  .card { background: var(--canvas); border-radius: 18px; padding: 20px; margin-bottom: 16px; }
  h2 { font-size: 17px; font-weight: 600; margin: 0 0 12px; }
  .group { background: var(--surface); border-radius: 14px; overflow: hidden; margin-bottom: 8px; }
  .row {
    display: flex; align-items: center; gap: 12px;
    padding: 10px 16px; min-height: 52px; border-bottom: 1px solid #E6E6EA;
  }
  .row:last-child { border-bottom: 0; }
  label { flex: 1; font-size: 16px; }
  .unit { width: 56px; text-align: right; font-size: 14px; color: var(--ink-3); }
  input, select {
    width: 116px; padding: 8px 10px; font: inherit; font-size: 17px; font-weight: 600;
    text-align: right; border: 1px solid var(--hairline); border-radius: 10px;
    background: var(--canvas); color: var(--ink); min-height: 44px;
  }
  select { text-align: left; width: 168px; font-weight: 400; }
  /* 플레이스홀더는 읽어야 하는 정보가 아니다. 값과 헷갈리지 않게 눌러 둔다. */
  input::placeholder { color: var(--placeholder); font-weight: 400; }
  input:focus, select:focus, button:focus { outline: 2px solid #0071E3; outline-offset: 2px; }
  button {
    width: 100%; min-height: 52px; border: 0; border-radius: 12px;
    background: var(--accent); color: #fff; font: inherit; font-size: 17px; font-weight: 600;
    cursor: pointer;
  }
  button:active { transform: scale(.98); }
  button.secondary { background: var(--canvas); color: var(--accent); border: 1px solid var(--accent); min-height: 44px; font-size: 15px; }
  .actions { display: flex; gap: 10px; margin-bottom: 16px; }
  .helper { font-size: 13px; color: var(--ink-3); padding: 6px 4px 0; }
  .result { display: none; }
  .result.show { display: block; }
  .risk { display: flex; align-items: baseline; gap: 10px; margin-bottom: 6px; }
  .risk strong { font-size: 34px; font-weight: 700; letter-spacing: -0.8px; font-variant-numeric: tabular-nums; }
  .badge { border-radius: 9999px; padding: 4px 11px; font-size: 13px; font-weight: 700; color: var(--ink); }
  .badge.low { background: var(--low); } .badge.moderate { background: var(--moderate); } .badge.high { background: var(--high); }
  /* 백분위 막대. 눈금은 동년배 중간값(50) 자리에 둔다. */
  .bar { position: relative; height: 8px; border-radius: 9999px; background: var(--divider); margin: 10px 0 6px; }
  .bar i { display: block; height: 100%; border-radius: 9999px; }
  .bar b { position: absolute; top: -3px; width: 2px; height: 14px; background: var(--ink-3); border-radius: 1px; }
  .scale { display: flex; justify-content: space-between; font-size: 12px; color: var(--ink-3); }

  /* 요약 타일 — 카드가 10장이면 스크롤 없이 한눈에 볼 수단이 따로 있어야 한다.
     큰 숫자 하나와 등급 알약만 남기고 나머지는 아래 카드로 미룬다. */
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(132px, 1fr)); gap: 10px; margin: 0 0 18px; }
  .tile { background: var(--surface); border-radius: 14px; padding: 13px 10px 12px; text-align: center;
    border: 1.5px solid transparent; }
  .tile.flag { border-color: var(--high); background: #fff; }
  .tile em { display: block; font-style: normal; font-size: 12px; font-weight: 600; color: var(--ink-2);
    line-height: 1.35; min-height: 33px; }
  .tile .v { font-size: 27px; font-weight: 700; letter-spacing: -0.7px; font-variant-numeric: tabular-nums;
    line-height: 1.15; margin-top: 2px; }
  /* 소수점 아래를 작게 — 자릿수가 흔들려도 시선이 정수부에 머문다. */
  .tile .v small { font-size: 15px; font-weight: 600; color: var(--ink-2); }
  .tile .badge { display: inline-block; margin-top: 8px; font-size: 11.5px; padding: 3px 9px; }

  /* 3구간 게이지. 경계는 임의로 균등 분할하지 않고 등급이 실제로 갈리는
     백분위 70·90 에 둔다 — 눈금과 판정이 어긋나면 게이지가 거짓말을 한다. */
  .gauge { position: relative; height: 10px; border-radius: 9999px; background: var(--divider); margin: 12px 0 5px; }
  .gauge i { position: absolute; top: 0; left: 0; height: 100%; border-radius: 9999px; }
  .gauge u { position: absolute; top: 0; width: 2px; height: 100%; background: var(--canvas); }
  /* 전체 평균 표시. 내 위치가 평균보다 왼쪽인지 오른쪽인지가 한눈에 보여야 한다. */
  .gauge em { position: absolute; top: -3px; width: 2px; height: 16px; background: var(--ink-3);
    opacity: .55; border-radius: 1px; }
  .gauge b { position: absolute; top: -5px; width: 4px; height: 20px; border-radius: 2px;
    background: var(--ink); box-shadow: 0 0 0 2px var(--surface); }
  .zones { display: flex; font-size: 11px; color: var(--ink-3); }
  .zones span { text-align: center; }

  /* 한 카드 안에서 두 엔진을 가르는 선. 카드를 둘로 쪼개면 같은 사람의 두 판정을
     스크롤로 이어 붙여야 하고, 붙여 놓으면 어느 쪽을 읽어야 하는지가 안 보인다. */
  .split { border-top: 1px solid var(--divider); margin: 18px 0 0; padding-top: 14px; }
  .split-label { font-size: 12px; font-weight: 700; letter-spacing: .04em; color: var(--ink-3);
    margin: 0 0 10px; }
  /* 어느 엔진을 읽어야 하는지. 카드마다 답이 다르므로 카드마다 적는다. */
  .verdict { background: var(--surface); border-radius: 12px; padding: 11px 13px;
    font-size: 14px; margin-top: 16px; color: var(--ink-2); }
  .verdict strong { color: var(--ink); font-weight: 700; }

  /* 모델 내부 값. 기본은 접어 둔다 — 화면을 읽는 사람에게 필요한 것은 위쪽
     세 줄이고, 계수와 AUROC 는 이 페이지를 디버깅할 때만 필요하다. */
  /* 정확도 줄. 위험 등급 배지와 색을 공유하지 않는다 — 위험 배지는 빨강이
     나쁜 뜻이고 정확도는 초록이 좋은 뜻이라, 같은 클래스를 쓰면 코드를 읽는
     사람이 반드시 한 번은 헷갈린다. */
  .acc { display: flex; align-items: center; gap: 9px; flex-wrap: wrap;
    background: var(--surface); border-radius: 12px; padding: 10px 12px;
    margin-top: 14px; font-size: 13px; color: var(--ink-2); }
  .acc .k { font-size: 11.5px; font-weight: 700; letter-spacing: .04em; color: var(--ink-3); }
  .acc .n { font-size: 19px; font-weight: 700; font-variant-numeric: tabular-nums; color: var(--ink); }
  .acc .sep { color: var(--ink-3); opacity: .4; }
  .badge.lv0 { background: var(--lv0); }
  .badge.lv1 { background: var(--lv1); }
  .badge.lv2 { background: var(--lv2); color: #fff; }
  .badge.lv3 { background: var(--lv3); color: #fff; }
  .badge.good { background: var(--low); }
  .badge.ok { background: var(--moderate); }
  .badge.weak { background: var(--high); }

  details.tech { margin-top: 10px; }
  details.tech > summary { cursor: pointer; font-size: 12.5px; color: var(--ink-3);
    list-style: none; padding: 5px 0; }
  details.tech > summary::-webkit-details-marker { display: none; }
  details.tech > summary::before { content: "▸ "; }
  details.tech[open] > summary::before { content: "▾ "; }
  .peer { font-size: 15px; margin: 2px 0 0; }
  .peer strong { font-weight: 600; }
  .factors { font-size: 13px; color: var(--ink-2); margin: 8px 0 0; padding-left: 18px; }
  .meta { font-size: 13px; color: var(--ink-3); margin-top: 4px; }
  .notice { background: #FFF8EC; border: 1px solid #FFDCA8; border-radius: 12px; padding: 13px 14px; font-size: 14px; }
  .notice ul { margin: 6px 0 0; padding-left: 18px; }
  .error { background: #FFF4F4; border-radius: 12px; padding: 13px 14px; font-size: 14px; color: #C9342A; }
  /* 엔진 선택 스위치. 같은 화면에서 바꿔야 결과 비교가 된다. */
  .switch { display: flex; gap: 8px; margin-bottom: 6px; }
  .switch button {
    flex: 1; width: auto; min-height: 46px; padding: 10px 6px;
    border: 1px solid var(--accent); border-radius: 10px;
    color: var(--accent); background: var(--canvas);
    font-size: 15px; font-weight: 600;
  }
  .switch button[aria-pressed="true"] { background: var(--accent); color: #fff; }
  /* 고른 엔진이 쓰지 않는 입력. 숨기지 않는다 — 어떤 항목이 빠지는지 보여야 한다.
     연한 회색으로만 눌러 둔다. 값도 지우지 않는다. 엔진을 되돌리면 그대로 있어야 한다. */
  .row.off label, .row.off .unit { color: var(--placeholder); }
  .row.off input, .row.off select {
    background: var(--surface); color: var(--placeholder); border-color: var(--divider);
    transition: color .12s ease;
  }
  /* 고치려고 들어오면 원래 색으로 돌린다. 다음 엔진용으로 미리 채울 수 있어야 한다. */
  .row.off input:focus, .row.off select:focus { color: var(--ink); }
  /* 모델이 받고도 쓰지 않은 항목 목록 */
  .ignored { background: var(--surface); border-radius: 12px; padding: 12px 14px; font-size: 13px; color: var(--ink-2); }
  .ignored strong { color: var(--ink); font-weight: 600; }
  /* 결과 묶음의 엔진 머리말 */
  .engine { display: flex; align-items: baseline; gap: 8px; flex-wrap: wrap; margin: 24px 0 10px; }
  .engine h3 { font-size: 19px; font-weight: 700; letter-spacing: -.4px; margin: 0; }
  .engine span { font-size: 13px; color: var(--ink-3); }
  /* 두 엔진이 겹치는 질환만 나란히 놓는 표 */
  table.cmp { width: 100%; border-collapse: collapse; font-size: 14px; }
  table.cmp th, table.cmp td { padding: 9px 6px; border-bottom: 1px solid var(--divider); text-align: left; }
  table.cmp tr:last-child td { border-bottom: 0; }
  table.cmp th { font-size: 12px; font-weight: 700; color: var(--ink-3); }
  table.cmp td:first-child { font-weight: 600; }
  table.cmp .num { font-variant-numeric: tabular-nums; }
  /* 검사값이 이미 답을 아는 칸. 지우지 않고 물러나게만 둔다. */
  table.cmp td.defer { color: var(--ink-3); text-decoration: line-through; }
  table.cmp td.read { font-weight: 600; }
  /* 규칙 엔진의 5단계 등급. 상태색 위에는 흰 글자를 쓰지 않는다 (DESIGN.md §2). */
  .badge.NORMAL { background: var(--low); }
  .badge.CAUTION { background: var(--moderate); }
  .badge.HIGH { background: var(--high); }
  .badge.VERY_HIGH { background: var(--high); }
  .badge.INSUFFICIENT_DATA { background: var(--divider); color: var(--ink-2); }
  .sub { font-size: 22px; font-weight: 600; letter-spacing: -0.4px; margin: 2px 0 8px; }
  .reason { font-size: 15px; color: var(--ink-2); margin: 0 0 10px; }
  .cite { font-size: 12px; color: var(--ink-3); margin-top: 10px; line-height: 1.5; }
  .missing { background: var(--surface); border-radius: 12px; padding: 12px 14px; font-size: 14px; color: var(--ink-2); }
  @media (prefers-reduced-motion: reduce) { * { transition: none !important; } }"""


ENGINES = [
    ("ml", "내 ML 모델"),
    ("rules", "규칙 엔진"),
    ("both", "둘 다"),
]


def switch(active: str) -> str:
    """어느 엔진으로 돌릴지 고르는 스위치.

    링크가 아니라 버튼이다. 화면을 새로 열면 입력값이 날아가고, 그러면 같은 사람으로
    두 엔진을 비교할 수가 없다.
    """
    buttons = "".join(
        f'<button type="button" class="engine-pick" data-engine="{key}" '
        f'aria-pressed="{"true" if key == active else "false"}">{label}</button>'
        for key, label in ENGINES
    )
    return f'<div class="switch" role="group" aria-label="예측 엔진 선택">{buttons}</div>'
