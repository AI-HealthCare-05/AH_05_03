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

from typing import Annotated, Literal

from fastapi import APIRouter, Query
from fastapi.responses import HTMLResponse

from app.apis.demo_style import CSS, switch

demo_router = APIRouter(tags=["demo"], include_in_schema=False)

Engine = Literal["ml", "rules", "both"]

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
  <p class="kicker">데모 화면</p>
  <h1>만성질환 위험도<br />두 모델 비교</h1>
  <p class="lead">한 번 입력하고 엔진을 바꿔 돌립니다. 확률을 내는 ML 모델과 국내 지침으로 등급을 내는
    규칙 엔진이 같은 사람을 어떻게 다르게 보는지 확인하는 화면입니다. 입력값은 저장하지 않습니다.</p>

__SWITCH__
  <p class="helper" id="engine-note"></p>

  <form id="form" class="card">
    <section data-for="both">
      <h2>기본</h2>
      <div class="group">
        <div class="row" data-for="both"><label for="age">나이</label><input id="age" type="number" value="54" min="19" max="100" /><span class="unit">세</span></div>
        <div class="row" data-for="both"><label for="sex">성별</label><select id="sex"><option value="M" selected>남성</option><option value="F">여성</option></select><span class="unit"></span></div>
        <div class="row" data-for="both"><label for="height_cm">키</label><input id="height_cm" type="number" step="0.1" value="172" /><span class="unit">cm</span></div>
        <div class="row" data-for="both"><label for="weight_kg">체중</label><input id="weight_kg" type="number" step="0.1" value="82" /><span class="unit">kg</span></div>
        <div class="row" data-for="both"><label for="waist_cm">허리둘레</label><input id="waist_cm" type="number" step="0.1" value="94" /><span class="unit">cm</span></div>
        <div class="row" data-for="ml">
          <label for="self_rated_health">전반적인 건강</label>
          <select id="self_rated_health">
            <option value="1">매우 좋음</option><option value="2">좋음</option>
            <option value="3" selected>보통</option><option value="4">나쁨</option><option value="5">매우 나쁨</option>
          </select><span class="unit"></span>
        </div>
      </div>
      <p class="helper">키·체중은 BMI 계산에만 씁니다. 전반적인 건강은 ML 모델의 필수 항목이고,
        허리둘레는 규칙 엔진의 복부비만 판정에 씁니다.</p>
    </section>

    <section data-for="both">
      <h2 style="margin-top:20px">혈압</h2>
      <div class="group">
        <div class="row" data-for="both"><label for="sbp">수축기</label><input id="sbp" type="number" value="138" /><span class="unit">mmHg</span></div>
        <div class="row" data-for="both"><label for="dbp">이완기</label><input id="dbp" type="number" value="88" /><span class="unit">mmHg</span></div>
      </div>
    </section>

    <section data-for="rules">
      <h2 style="margin-top:20px">혈당</h2>
      <div class="group">
        <div class="row" data-for="both"><label for="fasting_glucose">공복혈당</label><input id="fasting_glucose" type="number" value="112" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="rules">
          <label for="is_fasting">공복 상태 측정</label>
          <select id="is_fasting"><option value="">선택 안 함</option><option value="true" selected>예</option><option value="false">아니오</option></select><span class="unit"></span>
        </div>
        <div class="row" data-for="both"><label for="hba1c">당화혈색소</label><input id="hba1c" type="number" step="0.1" value="6.1" /><span class="unit">%</span></div>
        <div class="row" data-for="rules"><label for="ogtt_2h">당부하 2시간</label><input id="ogtt_2h" type="number" placeholder="선택" /><span class="unit">mg/dL</span></div>
      </div>
    </section>

    <section data-for="both">
      <h2 style="margin-top:20px">지질</h2>
      <div class="group">
        <div class="row" data-for="both"><label for="total_cholesterol">총콜레스테롤</label><input id="total_cholesterol" type="number" value="215" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="both"><label for="ldl_c">LDL</label><input id="ldl_c" type="number" value="140" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="both"><label for="hdl_c">HDL</label><input id="hdl_c" type="number" value="44" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="both"><label for="triglycerides">중성지방</label><input id="triglycerides" type="number" value="180" /><span class="unit">mg/dL</span></div>
      </div>
    </section>

    <section data-for="ml">
      <h2 style="margin-top:20px">간·신장·혈액</h2>
      <p class="cite" style="margin:0 0 8px">국가건강검진 결과지에 있는 값이다. 채우면 정밀형 모델로 채점한다.
        규칙 엔진은 이 항목을 받지 않는다.</p>
      <div class="group">
        <div class="row" data-for="ml"><label for="ast">AST(SGOT)</label><input id="ast" type="number" value="28" /><span class="unit">IU/L</span></div>
        <div class="row" data-for="ml"><label for="alt">ALT(SGPT)</label><input id="alt" type="number" value="36" /><span class="unit">IU/L</span></div>
        <div class="row" data-for="ml"><label for="ggt">감마지티피</label><input id="ggt" type="number" value="58" /><span class="unit">IU/L</span></div>
        <div class="row" data-for="ml"><label for="uric_acid">요산</label><input id="uric_acid" type="number" step="0.1" value="6.8" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="ml"><label for="creatinine">크레아티닌</label><input id="creatinine" type="number" step="0.01" value="1.10" /><span class="unit">mg/dL</span></div>
        <div class="row" data-for="ml"><label for="hemoglobin">혈색소</label><input id="hemoglobin" type="number" step="0.1" value="15.1" /><span class="unit">g/dL</span></div>
        <div class="row" data-for="ml"><label for="albumin">알부민</label><input id="albumin" type="number" step="0.1" value="4.3" /><span class="unit">g/dL</span></div>
        <div class="row" data-for="ml"><label for="urine_acr">요알부민/크레아티닌비</label><input id="urine_acr" type="number" placeholder="선택" /><span class="unit">mg/g</span></div>
      </div>
    </section>

    <section data-for="both">
      <h2 style="margin-top:20px">생활습관</h2>
      <div class="group">
        <div class="row" data-for="both">
          <label for="smoking_status">흡연</label>
          <select id="smoking_status"><option value="">선택 안 함</option><option value="never" selected>피운 적 없음</option><option value="former">과거에 피움</option><option value="current">현재 피움</option></select><span class="unit"></span>
        </div>
        <div class="row" data-for="ml"><label for="sleep_hours">평균 수면</label><input id="sleep_hours" type="number" step="0.5" placeholder="선택" /><span class="unit">시간</span></div>
        <div class="row" data-for="ml"><label for="moderate_min_per_week">주간 중강도 운동</label><input id="moderate_min_per_week" type="number" placeholder="선택" /><span class="unit">분</span></div>
        <div class="row" data-for="ml"><label for="vigorous_min_per_week">주간 고강도 운동</label><input id="vigorous_min_per_week" type="number" placeholder="선택" /><span class="unit">분</span></div>
        <div class="row" data-for="ml"><label for="alcohol_days_per_year">연간 음주 일수</label><input id="alcohol_days_per_year" type="number" placeholder="선택" /><span class="unit">일</span></div>
        <div class="row" data-for="ml">
          <label for="difficulty_walking">걷는 데 불편</label>
          <select id="difficulty_walking"><option value="">선택 안 함</option><option value="false">없음</option><option value="true">있음</option></select><span class="unit"></span>
        </div>
      </div>
      <p class="helper">흡연은 두 엔진이 함께 씁니다. 규칙 엔진은 현재 흡연 여부만 보므로
        &quot;과거에 피움&quot;은 비흡연으로 넘깁니다.</p>
    </section>

    <section data-for="rules">
      <h2 style="margin-top:20px">진단 이력</h2>
      <div class="group">
        <div class="row" data-for="rules"><label for="has_hypertension">고혈압 진단</label><select id="has_hypertension"><option value="">선택 안 함</option><option value="true">예</option><option value="false" selected>아니오</option></select><span class="unit"></span></div>
        <div class="row" data-for="rules"><label for="has_diabetes">당뇨 진단</label><select id="has_diabetes"><option value="">선택 안 함</option><option value="true">예</option><option value="false" selected>아니오</option></select><span class="unit"></span></div>
        <div class="row" data-for="rules"><label for="has_ascvd_history">심혈관질환 병력</label><select id="has_ascvd_history"><option value="">선택 안 함</option><option value="true">예</option><option value="false" selected>아니오</option></select><span class="unit"></span></div>
      </div>
    </section>
  </form>

  <div class="actions">
    <button id="submit" type="button">두 모델 실행</button>
    <button id="sample" class="secondary" type="button">임의값 채우기</button>
    <button id="clear" class="secondary" type="button">검사값 비우기</button>
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
                  ldl_c: "ldl_c", hdl_c: "hdl_c", triglycerides: "triglycerides"};
const RULE_BOOL = ["is_fasting","has_hypertension","has_diabetes","has_ascvd_history"];
const LABS = ["sbp","dbp","fasting_glucose","hba1c","ogtt_2h",
              "total_cholesterol","ldl_c","hdl_c","triglycerides"];

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
const DOMAIN = {hypertension: "고혈압", diabetes: "당뇨", dyslipidemia: "이상지질혈증", obesity: "비만"};
const LEVEL = {INSUFFICIENT_DATA: "판정 불가", NORMAL: "정상", CAUTION: "주의", HIGH: "높음", VERY_HIGH: "매우 높음"};
// 비교표에서 두 엔진의 같은 질환을 맞춰 놓는다.
// 비만에는 ML 모델이 없다 — 키·몸무게를 임계값과 비교하는 일이라 예측 대상이
// 아니고 규칙 엔진이 이미 한다. 나머지 셋은 두 엔진이 같은 질환을 본다.
const PAIRS = [["dm", "diabetes"], ["htn", "hypertension"], ["dlp", "dyslipidemia"], [null, "obesity"]];
const RULE_ORDER = ["hypertension", "diabetes", "dyslipidemia", "obesity"];
// 그 질환의 라벨을 **정의하는** 검사값. 이게 입력되어 있으면 답은 이미 나와 있고
// ML 확률은 검사 전 선별값일 뿐이다. ML 모델은 이 값을 입력으로 받지 않는다 —
// 라벨을 정의하는 변수라 학습 단계에서 기계적으로 차단했다(modeling/features.py).
const DECIDER = {
  diabetes: {ids: ["fasting_glucose", "hba1c", "ogtt_2h"], name: "혈당 검사값"},
  hypertension: {ids: ["sbp", "dbp"], name: "혈압 측정값"},
  dyslipidemia: {ids: ["total_cholesterol", "ldl_c", "hdl_c", "triglycerides"], name: "지질 검사값"},
};

// 모델이 받는 입력 목록. 무엇을 무시했는지 여기서 계산한다. 재학습해서 입력이
// 바뀌면 화면도 따라 바뀐다.
let modelInfo = null;
fetch("/api/v1/predictions/model-info")
  .then(response => response.json())
  .then(json => { modelInfo = json.data; })
  .catch(() => {});

const RUN_LABEL = {ml: "위험도 확인", rules: "판정 확인", both: "두 모델 실행"};
const NOTE = {
  ml: "생활습관 문항으로 확률을 냅니다. 검사값이 없어도 결과가 나옵니다. 연한 회색 항목은 이 모델이 받지 않으며 값을 넣어도 결과에 반영되지 않습니다.",
  rules: "검사값을 국내 학회 지침 임계값과 비교합니다. 검사값이 없는 영역은 판정하지 않습니다. 연한 회색 항목은 이 엔진이 받지 않습니다.",
  both: "같은 입력을 두 엔진에 넣습니다. 회색 처리 없이 모든 항목을 씁니다 — 단, 각 모델이 실제로 쓰지 않는 항목은 결과에 따로 적습니다.",
};

let engine = "__ENGINE__";

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
  const wants = key => engine === "both" || key === "both" || key === engine;
  // 숨기지 않는다. 어떤 항목이 빠지는지 사용자가 보고 있어야 한다. 연한 회색으로만 눌러 둔다.
  for (const el of document.querySelectorAll(".row[data-for]")) el.classList.toggle("off", !wants(el.dataset.for));
  for (const el of document.querySelectorAll(".engine-pick")) {
    el.setAttribute("aria-pressed", el.dataset.engine === engine ? "true" : "false");
  }
  document.getElementById("submit").textContent = RUN_LABEL[engine];
  document.getElementById("engine-note").textContent = NOTE[engine];
  document.getElementById("clear").hidden = engine === "ml";
  // 고른 엔진의 결과만 화면에 남긴다. 입력을 고친 뒤 엔진을 바꾸면 이전 결과는 거짓이 된다.
  document.getElementById("out").className = "result";
  document.getElementById("out").innerHTML = "";
  document.getElementById("err").innerHTML = "";
}

for (const el of document.querySelectorAll(".engine-pick")) {
  el.addEventListener("click", () => { engine = el.dataset.engine; applyEngine(); });
}

document.getElementById("sample").addEventListener("click", () => {
  const rnd = (a, b, d = 0) => (Math.random() * (b - a) + a).toFixed(d);
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const set = (id, value) => { document.getElementById(id).value = value; };
  set("age", rnd(25, 78));
  set("sex", pick(["M", "F"]));
  set("height_cm", rnd(150, 188, 1));
  set("weight_kg", rnd(48, 108, 1));
  set("waist_cm", rnd(65, 118, 1));
  set("self_rated_health", String(Math.ceil(Math.random() * 5)));
  set("sbp", rnd(105, 172));
  set("dbp", rnd(62, 100));
  set("fasting_glucose", rnd(80, 160));
  set("is_fasting", "true");
  set("hba1c", rnd(4.8, 8.4, 1));
  set("total_cholesterol", rnd(150, 270));
  set("ldl_c", rnd(80, 190));
  set("hdl_c", rnd(30, 75));
  set("triglycerides", rnd(70, 320));
  set("smoking_status", pick(["never","former","current"]));
  set("sleep_hours", rnd(4, 9, 1));
  set("moderate_min_per_week", rnd(0, 420));
  set("vigorous_min_per_week", rnd(0, 240));
  set("alcohol_days_per_year", rnd(0, 300));
  set("difficulty_walking", pick(["true","false"]));
  for (const id of ["has_hypertension","has_diabetes","has_ascvd_history"]) set(id, pick(["true","false"]));
});

// 검사값이 없을 때 두 엔진이 어떻게 갈리는지 보려면 이 버튼이 필요하다.
// ML 모델은 중앙값으로 채워 확률을 내고, 규칙 엔진은 판정을 거부한다.
document.getElementById("clear").addEventListener("click", () => {
  for (const id of LABS) document.getElementById(id).value = "";
  document.getElementById("is_fasting").value = "";
});

async function call(kind) {
  const path = kind === "ml" ? "/api/v1/predictions/risk" : "/api/v1/assessments/rules";
  const body = kind === "ml" ? mlPayload() : rulePayload();
  try {
    const response = await fetch(path, {
      method: "POST",
      headers: {"Content-Type": "application/json"},
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

document.getElementById("submit").addEventListener("click", async () => {
  const out = document.getElementById("out");
  const err = document.getElementById("err");
  const button = document.getElementById("submit");
  err.innerHTML = "";
  button.disabled = true;
  button.textContent = "실행 중…";

  try {
    const kinds = engine === "both" ? ["ml", "rules"] : [engine];
    const results = await Promise.all(kinds.map(call));
    const found = Object.fromEntries(results.map(r => [r.kind, r]));

    let html = "";
    const bothOk = engine === "both" && found.ml && found.rules && found.ml.data && found.rules.data;

    if (bothOk) {
      // 두 엔진을 다 돌렸으면 질환 하나에 카드 하나. 요약 → 비교표 → 합친 카드 순으로,
      // 엔진별 섹션으로 쪼개지 않는다.
      const ml = found.ml.data, rules = found.rules.data;
      html += `<div class="card"><h2>한눈에</h2>${overview(ml)}${summaryTiles(ml)}
          <p class="cite">ML 숫자는 <strong>지금 검사받으면 진단 기준을 넘을 가능성</strong>입니다.
            발병 확률이 아닙니다. 아래 카드마다 두 엔진의 판정과 <strong>어느 쪽을 읽어야 하는지</strong>가 함께 있습니다.</p></div>
        ${mergedCards(ml, rules)}
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
    button.textContent = RUN_LABEL[engine];
  }
});

applyEngine();
</script>
</body>
</html>
"""


def _render(engine: Engine) -> HTMLResponse:
    page = PAGE.replace("__CSS__", CSS).replace("__SWITCH__", switch(engine)).replace("__ENGINE__", engine)
    return HTMLResponse(page)


@demo_router.get("/api/demo", response_class=HTMLResponse, summary="예측 데모 화면 (두 엔진)")
async def demo_page(
    engine: Annotated[Engine, Query(description="처음에 고를 엔진")] = "both",
) -> HTMLResponse:
    return _render(engine)


@demo_router.get("/api/demo/rules", response_class=HTMLResponse, summary="규칙 엔진을 고른 데모 화면")
async def demo_rules_page() -> HTMLResponse:
    # 화면이 둘이던 시절의 주소. 문서와 팀 대화에 남아 있어 살려 둔다.
    return _render("rules")
