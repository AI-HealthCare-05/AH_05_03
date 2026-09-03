"""위험도 예측을 손으로 확인하는 데모 화면.

React 앱이 리포지토리에 들어오기 전까지 예측 API가 실제로 동작하는지 사람이
눌러 볼 수 있어야 한다. 그 목적의 단일 HTML이며 제품 화면이 아니다.

**한 화면에서 두 엔진을 고른다.** 내 ML 모델(`/predictions/risk`)과 팀원의 규칙
엔진(`/assessments/rules`)을 스위치로 바꿔 돌리거나 둘 다 돌린다. 화면을 두 개로
나누면 입력값이 날아가서 같은 사람으로 비교할 수가 없다.

두 엔진이 받는 입력이 다르다. 겹치는 항목은 입력 하나를 공유하고, 고른 엔진이 쓰지
않는 항목은 **숨기지 않고** 연한 회색으로 눌러 둔다. 무엇이 빠지는지 보여야 하고,
값도 지우지 않아야 엔진을 되돌렸을 때 그대로 남는다.

각 엔진이 받고도 쓰지 않은 항목은 결과에 그대로 적는다. 모델이 실제로 무엇을 무시했는지
`GET /predictions/model-info` 의 입력 목록으로 계산하므로 재학습해서 입력이 바뀌면
화면도 따라 바뀐다.

`/api/demo` 에 두는 이유는 nginx가 `/api/` 만 FastAPI로 프록시하기 때문이다.
nginx 설정을 건드리지 않고 배포된 스택에서도 같은 경로로 열린다.

색·서체·터치 타깃은 docs/DESIGN.md 를 따랐다. 상태 색 위에는 흰 글자를 쓰지
않는다(§2 대비 규칙).
"""

from fastapi import APIRouter
from fastapi.responses import HTMLResponse, RedirectResponse

from app.apis.demo_style import CSS

demo_router = APIRouter(tags=["demo"], include_in_schema=False)


PAGE = """<!doctype html>
<html lang="ko">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>만성질환 위험도 · 두 모델 비교 (데모)</title>
<style>
__CSS__
</style>
</head>
<body>
<main>
  <a class="home-link" href="/"><span aria-hidden="true">&#8592;</span> 이어봄 홈으로</a>
  <p class="kicker">데모 화면</p>
  <h1>만성질환 위험도<br />두 모델 비교</h1>
  <p class="lead">한 번 입력하고 엔진을 바꿔 돌립니다. 확률을 내는 ML 모델과 국내 지침으로 등급을 내는
    규칙 엔진이 같은 사람을 어떻게 다르게 보는지 확인하는 화면입니다. 입력값은 저장하지 않습니다.</p>

  <div class="card profiles">
    <h2>수치 프로필</h2>
    <p class="helper">각 질환이 <strong>위험으로 잡히는 값</strong>을 한 번에 채워 넣습니다. 눌러서 두 엔진이
      같은 사람을 어떻게 다르게 읽는지 확인하세요 — 라벨을 정의하는 검사값은 ML 입력에서 차단돼 있어서,
      <strong>규칙 엔진이 "기준 초과"라고 하는데 ML 확률은 낮게 나오는 경우</strong>가 정상 동작입니다.
      등급(낮음·관심·주의)은 절대 확률이 아니라 <strong>동년배 백분위</strong>로 정해집니다.</p>
    <div class="profile-chips" id="profiles"></div>
  </div>

  <p class="helper" id="engine-note"></p>

  <form id="form" class="card">
    <section data-for="both">
      <h2>기본</h2>
      <div class="group">
        <div class="row" data-for="both"><label for="age">나이</label><input id="age" type="number" min="19" max="100" /><span class="unit">세</span></div>
        <div class="row" data-for="both"><label for="sex">성별</label><select id="sex"><option value="" selected>선택 안 함</option><option value="M">남성</option><option value="F">여성</option></select><span class="unit"></span></div>
        <div class="row" data-for="both"><label for="height_cm">키</label><input id="height_cm" type="number" step="0.1" /><span class="unit">cm</span></div>
        <div class="row" data-for="both"><label for="weight_kg">체중</label><input id="weight_kg" type="number" step="0.1" /><span class="unit">kg</span></div>
        <div class="row" data-for="both"><label for="waist_cm">허리둘레</label><input id="waist_cm" type="number" step="0.1" /><span class="unit">cm</span></div>
        <div class="row" data-for="ml">
          <label for="self_rated_health">전반적인 건강</label>
          <select id="self_rated_health">
            <option value="" selected>선택 안 함</option>
            <option value="1">매우 좋음</option><option value="2">좋음</option>
            <option value="3">보통</option><option value="4">나쁨</option><option value="5">매우 나쁨</option>
          </select><span class="unit"></span>
        </div>
      </div>
      <p class="helper">키·체중은 BMI 계산에만 씁니다. 전반적인 건강은 ML 모델의 필수 항목이고,
        허리둘레는 규칙 엔진의 복부비만 판정에 씁니다.</p>
    </section>

    <section data-for="both" data-labs>
      <h2 style="margin-top:20px">혈압</h2>
      <div class="group">
        <div class="row" data-for="both"><label for="sbp">수축기</label><input id="sbp" type="number" /><span class="unit">mmHg</span></div>
        <div class="row" data-for="both"><label for="dbp">이완기</label><input id="dbp" type="number" /><span class="unit">mmHg</span></div>
      </div>
    </section>

    <section data-for="rules" data-labs>
      <h2 style="margin-top:20px">혈당</h2>
      <div class="group">
        <div class="row" data-for="both"><label for="fasting_glucose">공복혈당</label><input id="fasting_glucose" type="number" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="rules">
          <label for="is_fasting">공복 상태 측정</label>
          <select id="is_fasting"><option value="" selected>선택 안 함</option><option value="true">예</option><option value="false">아니오</option></select><span class="unit"></span>
        </div>
        <div class="row" data-for="both"><label for="hba1c">당화혈색소</label><input id="hba1c" type="number" step="0.1" /><span class="unit">%</span></div>
        <div class="row" data-for="rules"><label for="ogtt_2h">당부하 2시간</label><input id="ogtt_2h" type="number" placeholder="선택" /><span class="unit">mg/dL</span></div>
      </div>
    </section>

    <section data-for="both" data-labs>
      <h2 style="margin-top:20px">지질</h2>
      <div class="group">
        <div class="row" data-for="both"><label for="total_cholesterol">총콜레스테롤</label><input id="total_cholesterol" type="number" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="both"><label for="ldl_c">LDL</label><input id="ldl_c" type="number" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="both"><label for="hdl_c">HDL</label><input id="hdl_c" type="number" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="both"><label for="triglycerides">중성지방</label><input id="triglycerides" type="number" /><span class="unit">mg/dL</span></div>
      </div>
    </section>

    <section data-for="ml" data-labs>
      <h2 style="margin-top:20px">간·신장·혈액</h2>
      <p class="cite" style="margin:0 0 8px">국가건강검진 결과지에 있는 값이다. 채우면 정밀형 모델로 채점한다.
        규칙 엔진은 이 항목을 받지 않는다.</p>
      <div class="group">
        <div class="row" data-for="ml"><label for="ast">AST(SGOT)</label><input id="ast" type="number" /><span class="unit">IU/L</span></div>
        <div class="row" data-for="ml"><label for="alt">ALT(SGPT)</label><input id="alt" type="number" /><span class="unit">IU/L</span></div>
        <div class="row" data-for="ml"><label for="ggt">감마지티피</label><input id="ggt" type="number" /><span class="unit">IU/L</span></div>
        <div class="row" data-for="ml"><label for="uric_acid">요산</label><input id="uric_acid" type="number" step="0.1" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="ml"><label for="creatinine">크레아티닌</label><input id="creatinine" type="number" step="0.01" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="ml"><label for="hemoglobin">혈색소</label><input id="hemoglobin" type="number" step="0.1" /><span class="unit">g/dL</span></div>
        <div class="row" data-for="ml"><label for="albumin">알부민</label><input id="albumin" type="number" step="0.1" /><span class="unit">g/dL</span></div>
        <div class="row" data-for="ml"><label for="urine_acr">요알부민/크레아티닌비</label><input id="urine_acr" type="number" placeholder="선택" /><span class="unit">mg/g</span></div>
      </div>
    </section>

    <section data-for="both">
      <h2 style="margin-top:20px">생활습관</h2>
      <div class="group">
        <div class="row" data-for="both">
          <label for="smoking_status">흡연</label>
          <select id="smoking_status"><option value="" selected>선택 안 함</option><option value="never">피운 적 없음</option><option value="former">과거에 피움</option><option value="current">현재 피움</option></select><span class="unit"></span>
        </div>
        <div class="row" data-for="ml"><label for="sleep_hours">평균 수면</label><input id="sleep_hours" type="number" step="0.5" placeholder="선택" /><span class="unit">시간</span></div>
        <div class="row" data-for="ml"><label for="moderate_min_per_week">주간 중강도 운동</label><input id="moderate_min_per_week" type="number" placeholder="선택" /><span class="unit">분</span></div>
        <div class="row" data-for="ml"><label for="vigorous_min_per_week">주간 고강도 운동</label><input id="vigorous_min_per_week" type="number" placeholder="선택" /><span class="unit">분</span></div>
        <div class="row" data-for="ml"><label for="alcohol_days_per_year">연간 음주 일수</label><input id="alcohol_days_per_year" type="number" placeholder="선택" /><span class="unit">일</span></div>
        <div class="row" data-for="ml">
          <label for="difficulty_walking">걷는 데 불편</label>
          <select id="difficulty_walking"><option value="" selected>선택 안 함</option><option value="false">없음</option><option value="true">있음</option></select><span class="unit"></span>
        </div>
      </div>
      <p class="helper">흡연은 두 엔진이 함께 씁니다. 규칙 엔진은 현재 흡연 여부만 보므로
        &quot;과거에 피움&quot;은 비흡연으로 넘깁니다.</p>
    </section>

    <section data-for="rules">
      <h2 style="margin-top:20px">진단 이력</h2>
      <div class="group">
        <div class="row" data-for="rules"><label for="has_hypertension">고혈압 진단</label><select id="has_hypertension"><option value="" selected>선택 안 함</option><option value="true">예</option><option value="false">아니오</option></select><span class="unit"></span></div>
        <div class="row" data-for="rules"><label for="has_diabetes">당뇨 진단</label><select id="has_diabetes"><option value="" selected>선택 안 함</option><option value="true">예</option><option value="false">아니오</option></select><span class="unit"></span></div>
        <div class="row" data-for="rules"><label for="has_ascvd_history">심혈관질환 병력</label><select id="has_ascvd_history"><option value="" selected>선택 안 함</option><option value="true">예</option><option value="false">아니오</option></select><span class="unit"></span></div>
      </div>
    </section>
  </form>

  <div class="actions">
    <div id="auth" style="width:100%;border-top:1px solid #e5e7eb;padding-top:12px;margin-top:4px">
      <label for="demo_email">데모 로그인 (예측 API 가 인증을 요구한다)</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
        <input id="demo_email" type="email" placeholder="이메일" style="flex:1;min-width:180px" />
        <input id="demo_password" type="password" placeholder="비밀번호" style="flex:1;min-width:140px" />
        <button id="login" class="secondary" type="button">로그인</button>
        <span id="auth_state" style="font-size:13px;color:#6b7280">로그인 필요</span>
      </div>
    </div>
    <button id="submit" type="button">예측하기</button>
    <button id="sample" class="secondary" type="button">임의값 채우기</button>
    <button id="clear" class="secondary" type="button">전체 비우기</button>
  </div>

  <div id="out" class="result"></div>
  <div id="err"></div>
</main>

<script>
// 겹치는 항목은 입력 하나를 공유하고 엔진별 필드명으로 갈라 보낸다. 두 요청 모델 모두
// 정의되지 않은 필드를 거부하므로(extra="forbid") 각자 쓰는 것만 담아야 한다.
const ML_NUM = ["age","height_cm","weight_kg","waist_cm","sbp","dbp","sleep_hours",
                "moderate_min_per_week","vigorous_min_per_week","alcohol_days_per_year"];
// 검사값. 폼 id 는 규칙 엔진 이름을 따르므로 ML DTO 이름으로 갈아 끼운다.
// 하나라도 채워 보내면 서버가 정밀형 번들로 채점하고 응답의 tier 가 lab 이 된다.
const ML_LAB = {fasting_glucose: "fasting_glucose", hba1c: "hba1c",
                total_cholesterol: "total_chol", ldl_c: "ldl", hdl_c: "hdl",
                triglycerides: "triglyceride", ast: "ast", alt: "alt", ggt: "ggt",
                uric_acid: "uric_acid", creatinine: "creatinine",
                hemoglobin: "hemoglobin", albumin: "albumin", urine_acr: "urine_acr"};
const RULE_NUM = {age: "age", height_cm: "height_cm", weight_kg: "weight_kg", waist_cm: "waist_cm",
                  sbp: "systolic_bp", dbp: "diastolic_bp", fasting_glucose: "fasting_glucose",
                  hba1c: "hba1c", ogtt_2h: "ogtt_2h", total_cholesterol: "total_cholesterol",
                  ldl_c: "ldl_c", hdl_c: "hdl_c", triglycerides: "triglycerides",
                  // 벤더 엔진은 아래 값을 무시한다(extra="ignore"). 우리가 붙인 네 영역이 쓴다.
                  creatinine: "creatinine", urine_acr: "urine_acr", ast: "ast", alt: "alt",
                  ggt: "ggt", uric_acid: "uric_acid", hemoglobin: "hemoglobin"};
const RULE_BOOL = ["is_fasting","has_hypertension","has_diabetes","has_ascvd_history"];
// 비울 대상은 DOM 에서 끌어온다. 상수로 적어 두면 폼에 항목이 늘 때 조용히
// 어긋난다 — 실제로 질환이 10종으로 늘면서 간효소·요산·크레아티닌·혈색소·알부민·
// 요알부민비 여덟 개가 비우기에서 빠진 채로 남아 있었다.
const formFields = () => Array.from(document.querySelectorAll("#form input, #form select"));

// 카드 제목은 응답의 name 을 쓴다. 질환이 10종이라 프런트에 이름표를 박아 두면
// 모델을 하나 더 내보낼 때마다 여기를 같이 고쳐야 하고, 안 고치면 카드가
// "hyperchol" 같은 영문 키로 뜬다. TARGET 은 구 응답용 대비값으로만 남긴다.
const TARGET = {dm: "당뇨", htn: "고혈압"};
const cardName = c => c.name || TARGET[c.target] || c.target;

// 확률 하나만 보여주면 읽을 수가 없다. "고혈압 83%"와 "동년배 이하" 배지가 한 줄에
// 같이 뜨면 사용자는 둘 중 뭘 믿어야 할지 모른다. 둘 다 맞는 말인데 단위가 다르다 —
// 83%는 절대 확률이고 배지는 동년배 대비 위치다.
//
// 앵커는 그 사이를 메운다. 같은 확률대에 있던 NHANES 응답자들에게 규칙 엔진(국내
// 학회 임계값)을 실제로 돌려서 몇 %가 '주의' 이상을 받았는지 세어 둔 값이다.
// 확률도 백분위도 아닌 세 번째 숫자이고, 사용자가 실제로 알고 싶은 것에 가장 가깝다.
// 등급이 갈리는 백분위. 게이지 눈금을 여기 두어야 눈금과 판정이 어긋나지 않는다.
// 의학 기준 등급 경계. "이 점수대의 100명 중 몇 명이 학회 기준을 넘는가"에 건다.
// 동년배 백분위에 걸지 않는다 — 유병률이 나이를 따라 오르므로, 나이로 나눠 주면
// 70대에서 실제 위험이 높은 사람도 "동년배 이하"가 되고 배지가 초록으로 뜬다.
const MED_EDGES = [25, 50, 75];
const MED_LEVELS = ["낮음", "관심", "주의", "높음"];
const medTone = level => "lv" + Math.max(0, MED_LEVELS.indexOf(level));

// 큰 숫자의 소수점 아래를 작게 — 자릿수가 흔들려도 시선이 정수부에 머문다.
function bigNumber(value) {
  const [whole, fraction] = (value * 100).toFixed(1).split(".");
  return `${whole}<small>.${fraction}%</small>`;
}

// 카드 10장을 스크롤하며 비교하는 대신 한 화면에 요약한다. 경보 구간만 테두리로
// 띄우고 나머지는 눈에 걸리지 않게 둔다 — 열 장이 전부 강조되면 아무것도 강조가 아니다.
function overview(d) {
  const lab = d.conditions[0] && d.conditions[0].tier === "lab";
  return `<p class="meta" style="margin:0 0 12px">BMI ${d.bmi} ·
    입력 ${d.inputs_provided}/${d.inputs_total}개 ·
    ${lab ? "검사값을 써서 <strong>정밀형</strong>으로 채점했습니다"
          : "검사값 없이 <strong>일반형</strong>으로 채점했습니다"}</p>`;
}

function summaryTiles(d) {
  const tiles = d.conditions.map(c => {
    const m = c.medical;
    const level = m ? m.level : BAND[c.band];
    const tone = m ? medTone(m.level) : c.band;
    return `
    <div class="tile ${m && (m.level === "주의" || m.level === "높음") ? "flag" : ""}">
      <em>${cardName(c)}</em>
      <div class="v">${bigNumber(m ? m.rate : c.probability)}</div>
      <span class="badge ${tone}">${level}</span>
    </div>`;
  }).join("");
  return `<div class="tiles">${tiles}</div>`;
}

// 의학 기준 축. 눈금은 등급이 실제로 갈리는 25·50·75%에 둔다 — 눈금과 판정이
// 어긋나면 게이지가 거짓말을 한다.
function gauge(c) {
  const m = c.medical;
  if (!m) return "";
  const pos = Math.max(0, Math.min(100, m.rate * 100));
  const widths = [MED_EDGES[0], MED_EDGES[1] - MED_EDGES[0], MED_EDGES[2] - MED_EDGES[1], 100 - MED_EDGES[2]];
  const mark = m.baseline === null || m.baseline === undefined ? ""
    : `<em style="left:${Math.max(0, Math.min(100, m.baseline * 100))}%"></em>`;
  return `<div class="gauge">
      <i style="width:${pos}%;background:var(--${medTone(m.level)})"></i>
      ${MED_EDGES.map(e => `<u style="left:${e}%"></u>`).join("")}
      ${mark}
      <b style="left:calc(${pos}% - 2px)"></b>
    </div>
    <div class="zones">${widths.map((w, i) =>
      `<span style="flex:0 0 ${w}%">${MED_LEVELS[i]}</span>`).join("")}</div>`;
}


// 이 카드의 숫자를 얼마나 믿어도 되는가. 카드마다 다르다 — 같은 화면에 AUROC
// 0.87 짜리와 0.68 짜리가 나란히 있는데 그 사실을 안 적으면 둘이 같아 보인다.
function accuracyLine(c) {
  const a = c.accuracy;
  if (!a) return "";
  const tone = a.headline_auroc >= 0.80 ? "good" : a.headline_auroc >= 0.70 ? "ok" : "weak";
  const alert = (a.alert_ppv === null || a.alert_ppv === undefined) ? ""
    : `<span class="sep">|</span><span>상위 10% 경보 적중 <strong>${Math.round(a.alert_ppv * 100)}%</strong>
        · 실제 해당자 <strong>${Math.round(a.alert_sensitivity * 100)}%</strong> 발견</span>`;
  const scope = a.measured_on === "미진단자"
    ? "미진단자 기준" : "전체 기준";
  return `<div class="acc">
      <span class="k">정확도</span>
      <span class="n">${a.headline_auroc.toFixed(3)}</span>
      <span class="badge ${tone}">${a.grade}</span>
      <span>${scope} AUROC</span>
      ${alert}
    </div>
    <p class="cite">AUROC 는 "100명 중 몇 명을 맞힌다"가 아닙니다. 해당자와 비해당자를 한 명씩 뽑았을 때
      해당자에게 더 높은 점수를 줄 확률입니다.${a.auroc_undiagnosed !== null && a.auroc_undiagnosed !== undefined
        ? ` 이미 진단받은 사람을 맞히는 건 쉬우므로 그들을 뺀 값을 씁니다 (라벨 전체 기준은 ${a.auroc.toFixed(3)}).`
        : ""}
      ${a.holdout_cycle || ""} 주기${a.holdout_n ? " " + a.holdout_n.toLocaleString() + "명" : ""} 홀드아웃 측정.</p>`;
}

function anchorLine(c) {
  const a = c.rule_anchor;
  if (!a) return `<p class="cite" style="margin-top:6px">이 질환은 규칙 엔진에 대응 영역이 없어
    학회 기준 대조를 붙이지 못했습니다. 위 백분위로만 읽으십시오.</p>`;
  const people = Math.round(a.rule_positive_rate * 100);
  const average = a.overall_rate === null ? null : Math.round(a.overall_rate * 100);
  const compare = a.lift === null ? ""
    : ` <span style="color:var(--ink-3)">(같은 검사를 받은 사람 전체 평균 ${average}명 · <strong>${a.lift}배</strong>)</span>`;
  const tone = a.lift === null ? "low" : a.lift >= 1.3 ? "high" : a.lift >= 1.05 ? "moderate" : "low";
  return `<p class="peer" style="margin-top:10px">이 확률대의 <strong>100명</strong>을 실제로 검사했을 때
    <span class="badge ${tone}">${people}명</span>이 ${a.society} 기준 '${LEVEL[a.positive_from] || a.positive_from}' 이상이었습니다.${compare}</p>`;
}
// ML 등급은 동년배 백분위 기준이다. 절대 확률이 아니다.
const BAND = {low: "동년배 이하", moderate: "관심", high: "주의"};
const DOMAIN = {
  hypertension: "고혈압", diabetes: "당뇨", dyslipidemia: "이상지질혈증", obesity: "비만",
  // 벤더 엔진이 다루지 않아 따로 붙인 영역 (app/services/lab_staging.py).
  kidney: "신장 기능", liver: "간 효소", fatty_liver: "지방간 지수", uric_acid: "요산", anemia: "빈혈",
};
const LEVEL = {INSUFFICIENT_DATA: "판정 불가", NORMAL: "정상", CAUTION: "주의", HIGH: "높음", VERY_HIGH: "매우 높음"};
// 비교표에서 두 엔진의 같은 질환을 맞춰 놓는다.
// 비만에는 ML 모델이 없다 — 키·몸무게를 임계값과 비교하는 일이라 예측 대상이
// 아니고 규칙 엔진이 이미 한다. 나머지 셋은 두 엔진이 같은 질환을 본다.
const PAIRS = [
  ["dm", "diabetes"], ["htn", "hypertension"], ["dlp", "dyslipidemia"], [null, "obesity"],
  // 새로 붙인 넷 중 셋은 ML 카드와 짝이 있다. 요산은 ML 모델이 없다 —
  // 학습 라벨을 세우지 않아서고, 규칙만으로 충분히 읽히는 값이라 그대로 둔다.
  ["ckd", "kidney"], ["fatty_liver", "fatty_liver"], ["anemia", "anemia"],
  // 간 효소 상승과 요산은 ML 카드가 없다. 전자는 학습은 했으나 서빙하지 않고
  // (targets.py 의 serve=False), 후자는 라벨을 세우지 않았다.
  [null, "liver"], [null, "uric_acid"],
];
const RULE_ORDER = ["hypertension", "diabetes", "dyslipidemia", "obesity", "kidney", "fatty_liver", "liver", "uric_acid", "anemia"];
// 그 질환의 라벨을 **정의하는** 검사값. 이게 입력되어 있으면 답은 이미 나와 있고
// ML 확률은 검사 전 선별값일 뿐이다. ML 모델은 이 값을 입력으로 받지 않는다 —
// 라벨을 정의하는 변수라 학습 단계에서 기계적으로 차단했다(modeling/features.py).
const DECIDER = {
  diabetes: {ids: ["fasting_glucose", "hba1c", "ogtt_2h"], name: "혈당 검사값"},
  hypertension: {ids: ["sbp", "dbp"], name: "혈압 측정값"},
  dyslipidemia: {ids: ["total_cholesterol", "ldl_c", "hdl_c", "triglycerides"], name: "지질 검사값"},
  kidney: {ids: ["creatinine", "urine_acr"], name: "신장 검사값"},
  anemia: {ids: ["hemoglobin"], name: "혈색소"},
};

// 모델이 받는 입력 목록. 무엇을 무시했는지 여기서 계산한다. 재학습해서 입력이
// 바뀌면 화면도 따라 바뀐다.
let modelInfo = null;
fetch("/api/v1/predictions/model-info")
  .then(response => response.json())
  .then(json => { modelInfo = json.data; })
  .catch(() => {});

const RUN_LABEL = "예측하기";
// 엔진 선택을 없앴다. 화면이 늘 두 엔진을 같이 돌리므로 고를 것이 남아 있지 않고,
// 고르게 두면 "왜 한쪽만 나오지" 를 매번 설명해야 했다.
const NOTE = "같은 입력을 두 엔진에 넣습니다. 회색 처리 없이 모든 항목을 씁니다 — 단, 각 모델이 실제로 쓰지 않는 항목은 결과에 따로 적습니다.";

const engine = "both";

function num(id) {
  const el = document.getElementById(id);
  return el && el.value !== "" ? Number(el.value) : null;
}
function bool(id) {
  const v = document.getElementById(id).value;
  return v === "" ? null : v === "true";
}

function mlPayload() {
  const body = {};
  for (const id of ML_NUM) { const v = num(id); if (v !== null) body[id] = v; }
  for (const [id, field] of Object.entries(ML_LAB)) { const v = num(id); if (v !== null) body[field] = v; }
  body.sex = document.getElementById("sex").value;
  body.self_rated_health = Number(document.getElementById("self_rated_health").value);
  const smoking = document.getElementById("smoking_status").value;
  if (smoking) body.smoking_status = smoking;
  const walking = bool("difficulty_walking");
  if (walking !== null) body.difficulty_walking = walking;
  return body;
}

function rulePayload() {
  const body = {};
  for (const [id, field] of Object.entries(RULE_NUM)) { const v = num(id); if (v !== null) body[field] = v; }
  for (const id of RULE_BOOL) { const v = bool(id); if (v !== null) body[id] = v; }
  body.sex = document.getElementById("sex").value;
  // 규칙 엔진은 현재 흡연 여부만 본다. "과거에 피움"은 비흡연으로 넘어간다.
  const smoking = document.getElementById("smoking_status").value;
  if (smoking) body.smoking = smoking === "current";
  return body;
}

// 폼에 라벨이 없는 파생 입력.
const DERIVED_LABEL = {bmi: "BMI (키·체중)"};

function labelOf(id) {
  if (DERIVED_LABEL[id]) return DERIVED_LABEL[id];
  const el = document.querySelector(`label[for="${id}"]`);
  return el ? el.textContent : id;
}

// 값이 들어 있는 ML 필드명. 폼 id 가 그대로 ML 필드명이다.
function mlEntered() {
  // 키·체중은 그대로 모델에 가지 않는다. BMI 하나로 합쳐 들어가므로 "안 쓴 입력"으로
  // 세면 거짓말이 된다.
  const names = ML_NUM.filter(id => num(id) !== null && id !== "height_cm" && id !== "weight_kg");
  if (num("height_cm") !== null && num("weight_kg") !== null) names.push("bmi");
  names.push("sex", "self_rated_health");
  if (document.getElementById("smoking_status").value) names.push("smoking_status");
  if (bool("difficulty_walking") !== null) names.push("difficulty_walking");
  return names;
}

// 그 모델이 받고도 쓰지 않은 항목. dm 은 혈압을 쓰지만 htn 은 쓰지 않는다 —
// 혈압이 고혈압 라벨을 정의하므로 학습에서 차단됐다.
function mlIgnored(target) {
  if (!modelInfo) return [];
  const spec = modelInfo.models.find(m => m.target === target);
  if (!spec) return [];
  const used = new Set([...spec.required_inputs, ...spec.optional_inputs]);
  return mlEntered().filter(name => !used.has(name)).map(labelOf);
}

// 규칙 엔진이 아예 받지 않는 항목 중 사용자가 채운 것.
function rulesIgnored() {
  const out = [];
  for (const row of document.querySelectorAll('.row[data-for="ml"]')) {
    const control = row.querySelector("input, select");
    if (control && control.value !== "") out.push(row.querySelector("label").textContent);
  }
  return out;
}

function ignoredBox(names, engineName) {
  if (!names.length) return "";
  return `<p class="ignored"><strong>${engineName}이 쓰지 않은 입력 ${names.length}개</strong><br />
    ${names.join(" · ")} — 값을 넣어도 결과에 반영되지 않습니다.</p>`;
}

function hasDecider(domain) {
  const spec = DECIDER[domain];
  if (!spec) return true;
  return spec.ids.some(id => document.getElementById(id).value !== "");
}

function applyEngine() {
  // 두 엔진을 같이 돌리므로 회색 처리할 행이 없다. `data-for` 는 결과 카드에서
  // "이 모델이 안 쓴 입력" 을 적는 데 계속 쓰이므로 마크업은 그대로 둔다.
  for (const el of document.querySelectorAll(".row[data-for]")) el.classList.remove("off");
  document.getElementById("submit").textContent = RUN_LABEL;
  document.getElementById("engine-note").textContent = NOTE;
  document.getElementById("out").className = "result";
  document.getElementById("out").innerHTML = "";
  document.getElementById("err").innerHTML = "";
}


/* 수치 프로필. 질환마다 "이 값이면 기준을 넘는다"를 한 벌로 묶어 둔 것이다.
   임계값은 targets.py 의 Criterion 과 같은 학회 기준을 따르고, 여유를 조금 둬서
   경계에 걸치지 않게 했다 — 경계값 자체를 보고 싶으면 손으로 고치면 된다. */
const BASE_PROFILE = {
  age: 52, sex: "M", height_cm: 172, weight_kg: 70, waist_cm: 84,
  self_rated_health: "3", sbp: 118, dbp: 74,
  fasting_glucose: 92, is_fasting: "true", hba1c: 5.3,
  total_cholesterol: 180, ldl_c: 105, hdl_c: 55, triglycerides: 110,
  ast: 22, alt: 21, ggt: 24, uric_acid: 5.2, creatinine: 0.9,
  hemoglobin: 15.0, albumin: 4.4, urine_acr: 8,
  smoking_status: "never", sleep_hours: 7, moderate_min_per_week: 180,
  vigorous_min_per_week: 60, alcohol_days_per_year: 24, difficulty_walking: "false",
  has_hypertension: "false", has_diabetes: "false", has_ascvd_history: "false",
};

const PROFILES = [
  { key: "normal", label: "정상 범위", note: "모든 값이 기준 안에 있습니다", set: {} },
  { key: "dm", label: "당뇨", note: "공복혈당 148 · HbA1c 7.2 — 규칙 엔진이 기준 초과로 판정합니다",
    set: { fasting_glucose: 148, hba1c: 7.2, weight_kg: 84, waist_cm: 96, self_rated_health: "4" } },
  { key: "htn", label: "고혈압", note: "158/96 — 혈압은 라벨이라 ML 입력에서 차단됩니다",
    set: { sbp: 158, dbp: 96, weight_kg: 82, waist_cm: 95, age: 61 } },
  { key: "dlp", label: "이상지질혈증", note: "TC 268 · LDL 178 · TG 260 · HDL 34",
    set: { total_cholesterol: 268, ldl_c: 178, triglycerides: 260, hdl_c: 34 } },
  { key: "mets", label: "대사증후군", note: "5요소 중 4개 충족 — 규칙 엔진이 다루지 않는 질환이라 ML 확률만 나옵니다",
    set: { waist_cm: 98, triglycerides: 210, hdl_c: 38, sbp: 138, dbp: 88, fasting_glucose: 112, weight_kg: 88 } },
  { key: "ckd", label: "신기능", note: "크레아티닌 1.6 · 요알부민비 120 — eGFR 저하와 알부민뇨",
    set: { creatinine: 1.6, urine_acr: 120, age: 68, sbp: 142, dbp: 86 } },
  { key: "liver", label: "지방간", note: "BMI 31 · 허리 104 · γ-GTP 92 · ALT 68 — 규칙 엔진이 다루지 않아 ML 확률만 나옵니다",
    set: { weight_kg: 92, waist_cm: 104, ggt: 92, alt: 68, ast: 44, triglycerides: 240 } },
  { key: "anemia", label: "빈혈", note: "혈색소 10.4 — WHO 기준(남 13 미만) 미달",
    set: { hemoglobin: 10.4, albumin: 3.6, self_rated_health: "4" } },
];

function applyProfile(profile) {
  const values = Object.assign({}, BASE_PROFILE, profile.set);
  for (const [id, value] of Object.entries(values)) {
    const el = document.getElementById(id);
    if (el) el.value = String(value);
  }
  const note = document.getElementById("profile-note");
  if (note) note.textContent = profile.note;
  for (const button of document.querySelectorAll("#profiles button")) {
    button.setAttribute("aria-pressed", String(button.dataset.key === profile.key));
  }
  // 값만 채우고 채점은 하지 않는다. 프로필을 고른 뒤 손으로 몇 개 고쳐 보는 것이
  // 이 화면의 쓰임새인데, 자동으로 돌면 고치기 전 결과가 먼저 떠서 헷갈린다.
  document.getElementById("out").innerHTML = "";
  document.getElementById("err").innerHTML = "";
}

(() => {
  const host = document.getElementById("profiles");
  if (!host) return;
  for (const profile of PROFILES) {
    const button = document.createElement("button");
    button.type = "button";
    button.dataset.key = profile.key;
    button.setAttribute("aria-pressed", "false");
    button.textContent = profile.label;
    button.addEventListener("click", () => applyProfile(profile));
    host.appendChild(button);
  }
  const note = document.createElement("p");
  note.id = "profile-note";
  note.className = "helper";
  note.style.margin = "10px 0 0";
  host.parentNode.appendChild(note);
})();

/* 임의값 명세. 필드마다 그럴듯한 범위를 적어 두고, 폼에 있는데 여기 없는 필드가
   생기면 콘솔로 알린다 — 질환이 2종에서 10종으로 늘 때 간·신장·혈액 여덟 개가
   조용히 빠진 채로 남아 있었고, "임의값 채우기를 눌러도 안 채워진다"로 뒤늦게
   드러났다. 목록을 손으로 관리하면 같은 일이 또 생긴다. */
const SAMPLE = {
  age: [25, 78, 0], height_cm: [150, 188, 1], weight_kg: [48, 108, 1], waist_cm: [65, 118, 1],
  sbp: [105, 172, 0], dbp: [62, 100, 0],
  fasting_glucose: [80, 160, 0], hba1c: [4.8, 8.4, 1],
  total_cholesterol: [150, 270, 0], ldl_c: [80, 190, 0], hdl_c: [30, 75, 0], triglycerides: [70, 320, 0],
  // 국가건강검진 결과지에 인쇄되는 값. 정밀형 tier 를 태우려면 이쪽이 채워져야 한다.
  ast: [12, 60, 0], alt: [10, 70, 0], ggt: [10, 120, 0], uric_acid: [3.0, 9.0, 1],
  creatinine: [0.6, 1.5, 2], hemoglobin: [10.5, 17.0, 1], albumin: [3.5, 5.0, 1], urine_acr: [3, 200, 0],
  sleep_hours: [4, 9, 1], moderate_min_per_week: [0, 420, 0],
  vigorous_min_per_week: [0, 240, 0], alcohol_days_per_year: [0, 300, 0],
};
const SAMPLE_CHOICE = {
  sex: ["M", "F"],
  self_rated_health: ["1", "2", "3", "4", "5"],
  is_fasting: ["true"],
  smoking_status: ["never", "former", "current"],
  difficulty_walking: ["true", "false"],
  has_hypertension: ["true", "false"],
  has_diabetes: ["true", "false"],
  has_ascvd_history: ["true", "false"],
};
// 선택 입력이라 비워 두는 것이 정상인 필드.
const SAMPLE_SKIP = new Set(["ogtt_2h"]);

document.getElementById("sample").addEventListener("click", () => {
  const rnd = (a, b, d) => (Math.random() * (b - a) + a).toFixed(d);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const missing = [];
  for (const el of document.querySelectorAll("#form input, #form select")) {
    const id = el.id;
    if (SAMPLE_SKIP.has(id)) continue;
    if (SAMPLE[id]) el.value = rnd(...SAMPLE[id]);
    else if (SAMPLE_CHOICE[id]) el.value = pick(SAMPLE_CHOICE[id]);
    else missing.push(id);
  }
  if (missing.length) console.warn("[demo] 임의값 규칙이 없는 필드:", missing.join(", "));
});

// 폼 전체를 초기 상태로 되돌린다. 검사값만 비우던 버튼이었는데, 일부만 비는 것이
// 매번 버그로 읽혀서 전부 비우는 쪽으로 바꿨다. 검사값 유무로 일반형·정밀형이
// 갈리는 것을 보려면 채운 뒤 그 섹션만 손으로 지우면 된다.
document.getElementById("clear").addEventListener("click", () => {
  for (const el of formFields()) el.value = "";
  for (const button of document.querySelectorAll("#profiles button")) {
    button.setAttribute("aria-pressed", "false");
  }
  const note = document.getElementById("profile-note");
  if (note) note.textContent = "";
  document.getElementById("out").innerHTML = "";
  document.getElementById("err").innerHTML = "";
});

// 접근 토큰은 **메모리에만** 둔다. localStorage 에 넣으면 XSS 한 방에 털리고,
// 이 페이지는 건강 수치를 다루는 화면이라 그 습관을 여기서 만들면 안 된다.
// 새로고침하면 다시 로그인해야 하는 것이 그 대가다.
let accessToken = null;

async function login() {
  const email = document.getElementById("demo_email").value.trim();
  const password = document.getElementById("demo_password").value;
  const state = document.getElementById("auth_state");
  state.textContent = "로그인 중...";
  try {
    const response = await fetch("/api/v1/auth/login", {
      method: "POST",
      headers: {"Content-Type": "application/json"},
      body: JSON.stringify({email, password}),
    });
    const json = await response.json();
    if (!response.ok || json.success === false) {
      accessToken = null;
      state.textContent = json.message || "로그인 실패";
      state.style.color = "#b91c1c";
      return;
    }
    accessToken = json.data.access_token;
    state.textContent = "로그인됨";
    state.style.color = "#15803d";
  } catch (e) {
    accessToken = null;
    state.textContent = "서버에 연결하지 못했습니다";
    state.style.color = "#b91c1c";
  }
}

async function call(kind) {
  const path = kind === "ml" ? "/api/v1/predictions/risk" : "/api/v1/assessments/rules";
  const body = kind === "ml" ? mlPayload() : rulePayload();
  if (!accessToken) {
    return {kind, error: "먼저 로그인하세요. 예측 API 는 인증을 요구합니다 (ADR-009 §10)."};
  }
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {"Content-Type": "application/json", "Authorization": "Bearer " + accessToken},
      body: JSON.stringify(body),
    });
    const json = await response.json();
    if (!response.ok || json.success === false) {
      const detail = (json.details || []).map(d => `${(d.loc || []).join(".")}: ${d.msg || ""}`).join(" / ");
      return {kind, error: (json.message || "요청이 실패했습니다.") + (detail ? " — " + detail : "")};
    }
    return {kind, data: json.data};
  } catch (e) {
    return {kind, error: `서버에 연결하지 못했습니다. ${e}`};
  }
}

// 카드 본문과 카드 껍데기를 나눈다. 두 엔진을 한 카드에 합칠 때 본문만 필요하다.
function mlBody(c) {
  const m = c.medical;
  const p = c.peer_percentile;
  const ratio = c.peer_ratio;
  // 동년배 비교는 남기되 등급에서는 뺀다. 참고로는 쓸모가 있다 — 같은 나이대에서
  // 유독 높은지는 알아 둘 값이다. 다만 그걸로 "괜찮다"를 말하면 안 된다.
  const peerLine = p === null ? ""
    : `<p class="meta" style="margin-top:6px">참고 · ${c.peer_group} 중 상위 ${(100 - p).toFixed(0)}%${
        ratio === null ? "" : ` (동년배 평균의 ${ratio}배)`} — 나이가 많을수록 유병률이 오르므로 이 값으로 안심하면 안 됩니다.</p>`;

  const factors = c.top_factors.map(f =>
    `<li>${f.feature} <span class="num">${f.contribution > 0 ? "+" : ""}${f.contribution.toFixed(2)}</span></li>`).join("");

  const headline = m
    ? `<div class="risk"><strong>${bigNumber(m.rate)}</strong><span class="badge ${medTone(m.level)}">${m.level}</span></div>
       <p class="peer">이 점수대의 <strong>100명</strong> 중 <strong>${Math.round(m.rate * 100)}명</strong>이
         ${m.basis}입니다.${m.baseline === null || m.baseline === undefined ? ""
           : ` <span style="color:var(--ink-3)">같은 검사를 받은 사람 전체는 ${Math.round(m.baseline * 100)}명 · <strong>${m.lift}배</strong></span>`}</p>`
    : `<div class="risk"><strong>${bigNumber(c.probability)}</strong></div>`;

  return `${headline}
    ${gauge(c)}
    ${m && m.anchored_on_rule_engine
      ? `<p class="cite">규칙 엔진(국내 학회 임계값)을 같은 확률대의 NHANES 응답자에게 실제로 돌려서 센 값입니다.</p>`
      : `<p class="cite">모델 확률 자체가 그 비율입니다 — 라벨이 곧 의학 기준이고 보정을 거쳤습니다.</p>`}
    ${peerLine}
    ${accuracyLine(c)}
    <details class="tech"><summary>모델 내부 값</summary>
      <p class="meta">모델 확률 ${(c.probability * 100).toFixed(1)}%${c.peer_median === null ? ""
        : ` · ${c.peer_group} 중간값 ${(c.peer_median * 100).toFixed(1)}%`}${c.alert ? " · 동년배 상위 10%" : ""}</p>
      ${c.threshold_source ? `<p class="cite" style="margin-top:6px">${c.label_definition}<br><em>${c.threshold_source}</em></p>` : ""}
      <p class="meta" style="margin-top:8px">기여가 큰 항목 (로그오즈)</p>
      <ul class="factors">${factors}</ul>
      ${ignoredBox(mlIgnored(c.target), `${cardName(c)} 모델`)}
    </details>`;
}

function mlCards(d) {
  return d.conditions.map(c => {
    // 라벨을 정의하는 검사값이 이미 들어와 있으면 이 확률은 답이 아니라 검사 전 추정이다.
    const domain = (PAIRS.find(([target]) => target === c.target) || [])[1];
    const decider = DECIDER[domain];
    const superseded = decider && hasDecider(domain)
      ? `<p class="notice" style="margin-top:10px"><strong>${decider.name}이 이미 입력되어 있습니다.</strong>
           이 모델은 ${decider.name}을 입력으로 받지 않습니다 — ${cardName(c)} 라벨을 정의하는 값이라
           학습에서 차단했습니다. 검사값이 있으면 규칙 엔진의 판정을 읽으십시오.</p>`
      : "";
    return `<div class="card">
      <h2>${cardName(c)}${c.tier === "lab" ? '<span class="badge low" style="margin-left:8px">정밀형</span>' : ""}</h2>
      ${mlBody(c)}
      ${superseded}
    </div>`;
  }).join("");
}

function ruleBody(c) {
  const insufficient = c.risk_level === "INSUFFICIENT_DATA";
  const values = Object.entries(c.input_values || {})
    .map(([key, value]) => `<li>${key} <span class="num">${value}</span></li>`).join("");
  // 판정이 나왔으면 안 쓴 항목은 경고가 아니다. 규칙 엔진은 자기가 볼 수 있었던
  // 값을 전부 missing_fields 에 적는데, 당뇨는 공복혈당·당화혈색소·경구부하 셋 중
  // 둘만 있어도 판정한다. 그걸 회색 상자로 크게 띄우면 성공한 판정이 실패로 읽힌다.
  // 판정을 실제로 막았을 때만 눈에 걸리게 두고, 아니면 근거 블록으로 내린다.
  const gaps = (c.missing_fields || []).join(", ");
  const missing = !gaps ? ""
    : insufficient
    ? `<p class="missing">판정에 필요한 값이 없습니다 — ${gaps}</p>`
    : "";
  const skipped = gaps && !insufficient
    ? `<p class="meta">입력하지 않아 판정에 쓰지 않은 항목 — ${gaps}</p>` : "";
  const flags = (c.flags || []).length ? `<p class="cite">${c.flags.join("<br />")}</p>` : "";
  return `<div class="risk"><span class="badge ${c.risk_level}">${LEVEL[c.risk_level] || c.risk_level}</span></div>
    ${insufficient ? "" : `<p class="sub">${c.sub_status}</p>`}
    <p class="peer"><strong>${c.display_label}</strong></p>
    <p class="reason">${c.reason}</p>
    ${missing}
    ${insufficient ? "" : `<p class="meta">권장</p><p class="reason">${c.recommendation}</p>`}
    <details class="tech"><summary>판정 근거</summary>
      ${values ? `<p class="meta">판정에 쓴 값</p><ul class="factors">${values}</ul>` : ""}
      ${skipped}
      ${flags}
      <p class="cite">기준 — ${c.criteria_reference}</p>
    </details>`;
}

function ruleCards(d) {
  return RULE_ORDER.filter(k => d.domains[k]).map(k =>
    `<div class="card"><h2>${DOMAIN[k] || k}</h2>${ruleBody(d.domains[k])}</div>`).join("");
}

// 위 아홉 영역은 "여러 수치 -> 이 장기의 현재 상태"를 본다. 아래는 그 전치다 —
// "수치 하나 -> 여러 질환의 앞날". 같은 값이 양쪽에 나오고 뜻이 다르므로 섞지 않고
// 별도 묶음으로 둔다.
const DISEASE_RISK = {dm_risk: "당뇨병", cvd_risk: "심혈관질환", ckd_risk: "만성콩팥병", htn_risk: "고혈압"};
const RISK_ORDER = ["dm_risk", "cvd_risk", "ckd_risk", "htn_risk"];
// 인과인지 연관인지를 화면에서 구분한다. 이걸 빼면 "이것 때문에 병이 생긴다"로 읽힌다.
// null 은 "따져본 적 없다", false 는 "따져봤더니 아니다" 라 서로 다른 말이다.
function causalMark(causal) {
  if (causal === true) return '<span class="badge NORMAL" title="원인으로 볼 근거가 있다">인과</span>';
  if (causal === false) return '<span class="badge CAUTION" title="같은 값을 가진 사람에게서 더 잦았을 뿐, 원인은 아니다">연관</span>';
  return '<span class="badge INSUFFICIENT_DATA" title="인과를 따로 따져본 적이 없다">미검증</span>';
}

function riskContributors(c) {
  if (!c.contributors.length) return "";
  const rows = c.contributors.map(x => {
    const mark = causalMark(x.causal);
    return `<tr>
      <td><span class="num">+${x.weight}</span></td>
      <td><strong>${x.label}</strong><br><span style="color:var(--ink-3)">${x.detail}</span></td>
      <td>${mark}<br><span style="color:var(--ink-3)">${x.effect}</span>
          <br><span class="cite" style="margin:0">${x.source}</span></td>
    </tr>`;
  }).join("");
  return `<div class="contrib-wrap"><table class="contrib">
    <thead><tr><th>가중</th><th>어떤 값이</th><th>근거</th></tr></thead>
    <tbody>${rows}</tbody></table></div>`;
}

function riskMatrixCards(d) {
  if (!d.disease_risks) return "";
  const cards = RISK_ORDER.filter(k => d.disease_risks[k]).map(k => {
    const c = d.disease_risks[k];
    const flags = (c.flags || []).length ? `<p class="cite">${c.flags.join("<br />")}</p>` : "";
    const insufficient = c.risk_level === "INSUFFICIENT_DATA";
    return `<div class="card">
      <h2>${DISEASE_RISK[k] || k} 위험</h2>
      <div class="risk"><span class="badge ${c.risk_level}">${LEVEL[c.risk_level] || c.risk_level}</span></div>
      ${insufficient ? "" : `<p class="sub">${c.sub_status}</p>`}
      <p class="peer"><strong>${c.display_label}</strong></p>
      ${riskContributors(c)}
      ${flags}
      <p class="verdict">${c.recommendation}</p>
    </div>`;
  }).join("");
  if (!cards) return "";
  return `<div class="card"><h2>수치가 가리키는 질환</h2>
      <p class="cite">위쪽 아홉 개는 <strong>여러 수치를 묶어 장기 하나의 지금 상태</strong>를 봅니다.
        여기는 반대로 <strong>수치 하나가 여러 질환의 앞날</strong>을 얼마나 가리키는지를 봅니다.
        γ-GTP는 간 항목에서 읽히지만 제2형 당뇨 발생도 예측하고, 알부민뇨는 신장 판정의 재료지만
        eGFR과 따로 심혈관 사망을 예측합니다. 장기별로 묶어 읽으면 이 화살표들이 보이지 않습니다.</p>
      <p class="cite">같은 것을 두 번 세지 않습니다 — γ-GTP·ALT·지방간지수는 셋 다 간에 낀 지방을 보므로
        가장 센 하나만 셉니다. 가중치는 보고된 효과크기로 매겼고(1=약함 2=중등도 3=강함),
        <strong>인과</strong>와 <strong>연관</strong>을 구분해 적었습니다.</p>
    </div>${cards}`;
}

// 두 엔진을 다 돌렸으면 질환 하나에 카드 하나로 합친다. 따로 두면 같은 사람의 두
// 판정을 스크롤로 이어 붙여야 하고, 어느 쪽을 읽어야 하는지가 어디에도 안 적힌다.
function mergedCards(ml, rules) {
  const byTarget = Object.fromEntries(ml.conditions.map(c => [c.target, c]));
  const paired = new Set();
  const cards = [];

  for (const [target, domain] of PAIRS) {
    const c = target ? byTarget[target] : null;
    const r = rules.domains[domain];
    if (!c && !r) continue;
    if (target) paired.add(target);

    // 검사값이 있으면 규칙 엔진이 답을 알고 있다. 없으면 ML 모델만 답할 수 있다.
    const decided = hasDecider(domain);
    const readRules = !c || (decided && r && r.risk_level !== "INSUFFICIENT_DATA");
    const decider = DECIDER[domain];
    const verdict = !c
      ? `<strong>규칙 엔진</strong>을 읽으십시오. 이 영역은 측정값을 기준과 비교하는 일이라 ML 모델을 두지 않았습니다.`
      : readRules
      ? `<strong>규칙 엔진</strong>을 읽으십시오. ${decider ? decider.name + "이" : "검사값이"} 입력돼 있고,
         ML 모델은 그 값을 입력으로 받지 못합니다 — ${cardName(c)} 라벨을 정의하는 값이라 학습에서 차단했습니다.`
      : `<strong>ML 모델</strong>을 읽으십시오. ${decider ? decider.name + "이" : "검사값이"} 없어
         규칙 엔진은 판정할 수 없고, ML 모델은 그 값 없이 답하도록 학습했습니다.`;

    cards.push(`<div class="card">
      <h2>${c ? cardName(c) : (DOMAIN[domain] || domain)}${c && c.tier === "lab"
        ? '<span class="badge low" style="margin-left:8px">정밀형</span>' : ""}</h2>
      ${c ? `<p class="split-label">ML 모델 — 지금 검사받으면 기준을 넘을 가능성</p>${mlBody(c)}`
          : `<p class="split-label">ML 모델 없음</p>`}
      ${r ? `<div class="split"><p class="split-label">규칙 엔진 — 입력한 검사값의 기준 판정</p>${ruleBody(r)}</div>` : ""}
      <p class="verdict">${verdict}</p>
    </div>`);
  }

  // 규칙 엔진에 대응 영역이 없는 질환은 ML 카드만. 빼 버리면 "왜 없지"가 된다.
  for (const c of ml.conditions) {
    if (paired.has(c.target)) continue;
    cards.push(`<div class="card">
      <h2>${cardName(c)}${c.tier === "lab" ? '<span class="badge low" style="margin-left:8px">정밀형</span>' : ""}</h2>
      ${mlBody(c)}
      <p class="verdict">규칙 엔진에 대응 영역이 없어 <strong>ML 모델</strong>만 답합니다.</p>
    </div>`);
  }
  return cards.join("");
}

function section(kind, note, inner) {
  const title = kind === "ml" ? "내 ML 모델" : "규칙 엔진 (PR #4)";
  return `<div class="engine"><h3>${title}</h3><span>${note}</span></div>${inner}`;
}

document.getElementById("login").addEventListener("click", login);
document.getElementById("submit").addEventListener("click", async () => {
  const out = document.getElementById("out");
  const err = document.getElementById("err");
  const button = document.getElementById("submit");
  err.innerHTML = "";
  button.disabled = true;
  button.textContent = "실행 중…";

  try {
    const kinds = ["ml", "rules"];
    const results = await Promise.all(kinds.map(call));
    const found = Object.fromEntries(results.map(r => [r.kind, r]));

    let html = "";
    const bothOk = found.ml && found.rules && found.ml.data && found.rules.data;

    if (bothOk) {
      // 두 엔진을 다 돌렸으면 질환 하나에 카드 하나. 요약 → 비교표 → 합친 카드 순으로,
      // 엔진별 섹션으로 쪼개지 않는다.
      const ml = found.ml.data, rules = found.rules.data;
      html += `<div class="card"><h2>한눈에</h2>${overview(ml)}${summaryTiles(ml)}
          <p class="cite">ML 숫자는 <strong>지금 검사받으면 진단 기준을 넘을 가능성</strong>입니다.
            발병 확률이 아닙니다. 아래 카드마다 두 엔진의 판정과 <strong>어느 쪽을 읽어야 하는지</strong>가 함께 있습니다.</p></div>
        ${mergedCards(ml, rules)}
        ${riskMatrixCards(rules)}
        ${ignoredBox(rulesIgnored(), "규칙 엔진")}
        <div class="notice"><strong>읽어야 하는 안내</strong>
          <ul>${ml.disclaimers.map(x => `<li>${x}</li>`).join("")}
            <li>단일 시점 측정값의 참고 분류입니다. 진단이 아닙니다.</li></ul></div>`;
    } else {
      if (found.ml) {
        const body = found.ml.error
          ? `<div class="error">${found.ml.error}</div>`
          : `<div class="card"><h2>한눈에</h2>${overview(found.ml.data)}${summaryTiles(found.ml.data)}
               <p class="cite">숫자는 <strong>지금 검사받으면 진단 기준을 넘을 가능성</strong>입니다.
                 발병 확률이 아닙니다. 유병률이 높은 질환은 누구나 절반 근처가 나오므로,
                 절대값보다 아래 카드의 <strong>동년배 위치</strong>와 <strong>학회 기준 대조</strong>를 읽으십시오.</p></div>
             ${mlCards(found.ml.data)}
             <div class="notice"><strong>읽어야 하는 안내</strong>
               <ul>${found.ml.data.disclaimers.map(x => `<li>${x}</li>`).join("")}</ul></div>`;
        html += section("ml", "NHANES 부스팅 트리 · 확률 · 동년배 위치 · 학회 기준 대조", body);
      }

      if (found.rules) {
        let body;
        if (found.rules.error) {
          body = `<div class="error">${found.rules.error}</div>`;
        } else {
          const d = found.rules.data;
          const first = Object.values(d.domains)[0];
          body = `<div class="card"><h2>판정 요약</h2>
              <p class="meta">4개 영역 중 ${d.evaluated}개 판정${d.insufficient.length
                ? ` · 판정 불가 ${d.insufficient.map(x => DOMAIN[x] || x).join(", ")}` : ""}</p>
              <p class="cite">엔진 — ${d.engine}</p></div>
            ${ruleCards(d)}
            ${riskMatrixCards(d)}
            ${ignoredBox(rulesIgnored(), "규칙 엔진")}
            <div class="notice"><strong>읽어야 하는 안내</strong><ul><li>${first.disclaimer}</li>
              <li>단일 시점 측정값의 참고 분류입니다. 진단이 아닙니다.</li>
              <li>입력한 값은 저장하지 않습니다.</li></ul></div>`;
        }
        html += section("rules", "국내 학회 지침 임계값 · 5단계 등급", body);
      }
    }

    out.innerHTML = html;
    out.className = "result show";
  } finally {
    button.disabled = false;
    button.textContent = RUN_LABEL;
  }
});

applyEngine();
</script>
</body>
</html>
"""


def _render() -> HTMLResponse:
    return HTMLResponse(PAGE.replace("__CSS__", CSS))


@demo_router.get("/api/demo", response_class=HTMLResponse, summary="예측 데모 화면 (두 엔진)")
async def demo_page() -> HTMLResponse:
    return _render()


@demo_router.get("/api/demo/rules", response_class=HTMLResponse, summary="구 주소 — 데모 화면으로 보낸다")
async def demo_rules_page() -> RedirectResponse:
    # 엔진을 고르던 시절의 주소다. 이제 화면이 늘 두 엔진을 같이 돌리므로 따로
    # 보여 줄 것이 없다. 문서와 팀 대화에 남아 있어 주소만 살려 둔다.
    return RedirectResponse("/api/demo", status_code=308)
