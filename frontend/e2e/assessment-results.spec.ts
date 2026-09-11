import { expect, test, type Page } from "@playwright/test";
import type { AssessmentSummaryData, DiseaseVerdict } from "../src/features/assessment/contracts";
import { setupE2eServerMocks } from "./mockServerApis";

/**
 * 판정 응답 한 벌. **두 테스트가 같이 쓴다.**
 *
 * `setupE2eServerMocks` 의 기본 판정 응답만으로는 카드가 그려지지 않는다
 * (`byLevel` 이 `items is not iterable` 로 죽는다). 화면을 실제로 세우려면 이
 * 모양이 필요하고, 한 테스트가 자기 안에 끼고 있으면 다음 테스트가 못 쓴다.
 */
function buildSummary(): AssessmentSummaryData {
  const items = [
    ["dlp", "이상지질혈증", 0.4645], ["hyperchol", "고콜레스테롤혈증", null],
    ["low_hdl", "낮은 HDL 콜레스테롤", null], ["htn", "고혈압", 0.1048],
    ["dm", "당뇨병", 0.0626], ["obesity", "비만", 0.53], ["mets", "대사증후군", 0.43],
    ["fatty_liver", "지방간", 0.32], ["liver", "간기능", 0.12], ["anemia", "빈혈", 0.06],
    ["uric_acid", "요산", 0.08], ["inflammation", "만성염증", 0.11],
    ["ckd", "신기능 확인 필요", null], ["hypertg", "고중성지방혈증", 0.46],
  ] as const;
  const verdicts: DiseaseVerdict[] = items.map(([key, name, value], index) => ({
    key, name, engine: "E1", engine_label: "검사값 기준", engine_reason: "검사값 기준",
    risk_level: index < 3 ? "HIGH" : "NORMAL", sub_status: "", display_label: index < 3 ? "높음" : "정상 범위",
    reason: "입력한 검사값을 확인했어요.", criteria_reference: "테스트 기준", recommendation: "결과를 확인해 주세요.",
    missing_fields: [], flags: [], superseded_by: null, disclaimer: "의료 진단이 아닙니다.",
    reference: value === null ? null : key === "htn" || key === "dm" ? {
      trajectory: {
        horizons_years: [5], onset_probability: [value], population_onset_probability: [key === "htn" ? 0.2152 : 0.0962],
        relative_hazard: 1, reference_prevalence: 0.1, conditional_on: "현재 질환이 없다는 가정",
        mortality_corrected: true, method: "test", caveats: ["테스트용 예측"],
      },
    } : {
      prevalence_trajectory: {
        horizons_years: [1, 2, 3, 4, 5], prevalence_probability: [value - 0.03, value - 0.03, value - 0.03, value - 0.03, value],
        current_probability: value - 0.03, direction: "상승", conditional_on: "현재 수치 유지",
        irreversible: false, caveats: ["테스트용 예측"],
      },
    },
  }));
  const data: AssessmentSummaryData = {
    bmi: 23.7, inputs_provided: 30, inputs_total: 35, model_available: true,
    summary: { evaluated: 14, total: 14, insufficient: [], by_engine: { E1: 14 }, needs_attention: ["dlp"],
      highest_level: "HIGH", matrix_evaluated: 0, matrix_total: 0, matrix_needs_attention: [] },
    verdicts, disease_risks: {}, disclaimers: ["의료 진단이 아닙니다."],
    top_suspects: verdicts.slice(0, 3).map((verdict, index) => ({
      target: verdict.key, name: verdict.name, rank: index + 1, score: 3, suspected: true,
      level: "높음", risk_level: "HIGH", basis: "측정", evidence_weight: 0.3,
      reason: "입력한 검사값이 기준을 넘었어요. 장기 예측 근거는 제한적이에요.",
      prevalence_trajectory: verdict.reference?.prevalence_trajectory,
    })),
  };
  return data;
}

/** 목을 걸고 판정까지 태운다. 두 테스트가 같은 자리에서 시작한다. */
async function runAssessment(page: Page) {
  await setupE2eServerMocks(page);
  await page.route("**/api/v1/assessments/summary", (route) =>
    route.fulfill({ json: { success: true, data: buildSummary() } }),
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/assessment");
  await page.locator(".assess-presets > summary").click();
  await page.getByRole("button", { name: "이상지질혈증", exact: true }).click();
  await page.getByRole("button", { name: "판정하기", exact: true }).click();
}

test("결과 요약은 간결하게 표시하고 상세 예측은 키보드로 펼칠 수 있다", async ({ page }) => {
  await runAssessment(page);
  const panel = page.getByRole("region", { name: /먼저 확인할 건강 신호/ });
  await expect(panel).toBeVisible();

  // **패널은 순위만 말한다.** 2026-09-11 에 확률을 질환 카드 한 곳으로 모았다 —
  // 그전에는 같은 값이 패널·카드·전체 목록 세 군데에 있었다.
  await expect(panel.locator(".suspect-card")).toHaveCount(3);
  expect(await panel.innerText()).not.toMatch(/\d+%/);
  await expect(panel.locator(".suspect-evidence").first()).toContainText("근거가 약해 참고용으로 확인");
  await panel.screenshot({ path: "test-results/assessment-results-desktop.png", style: ".site-header { visibility: hidden; }" });

  // 숫자는 카드에 남아 있어야 한다. 패널에서 지웠다고 사라지면 안 된다.
  const card = page.locator(".assess-card").filter({ hasText: "이상지질혈증" }).first();
  await expect(card).toContainText("46%");

  for (const width of [768, 390]) {
    await page.setViewportSize({ width, height: 844 });
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    await panel.screenshot({ path: `test-results/assessment-results-${width}.png`, style: ".site-header { visibility: hidden; }" });
  }
});

/**
 * 근거 모달이 **열리는 순간부터** 제 폭이어야 한다.
 *
 * 2026-09-11 버그 — 모달이 세로로 길쭉하게 떴다가 마우스를 브라우저 밖으로 빼는 등
 * 리플로우가 한 번 일어나야 제 폭으로 돌아왔다. `.modal-backdrop` 이 트랙을 정하지
 * 않은 채 `place-items: center` 만 써서 **트랙 폭과 패널 폭이 서로를 참조**한 탓이다.
 *
 * jsdom 은 레이아웃을 계산하지 않아 이 결함을 단위 테스트로는 못 잡는다. 실제
 * 브라우저에서 폭을 재는 이 검사가 유일한 그물이다. 마우스를 움직이지 않고
 * `click()` 직후에 바로 재는 것이 핵심이다 — 움직이면 그 자체가 리플로우다.
 */
test("근거 모달은 열자마자 제 폭으로 뜬다 — 리플로우를 기다리지 않는다", async ({ page }) => {
  await runAssessment(page);

  await page.getByRole("button", { name: /판정 근거 자세히/ }).first().click();

  const modal = page.locator(".modal-panel.verdict-modal");
  await expect(modal).toBeVisible();

  const box = await modal.boundingBox();
  expect(box).not.toBeNull();
  // 뷰포트 1440 이면 `min(880px, 100%)` 이 880 으로 풀려야 한다. 순환이 남아 있으면
  // 콘텐츠 최소폭으로 떨어져 한참 좁게 나온다.
  expect(box!.width).toBeGreaterThan(840);
  // 좁게 떨어지면 내용이 접혀 세로로 길어진다. 폭보다 큰 높이는 그 신호다.
  expect(box!.height).toBeLessThan(box!.width * 1.6);

  // 리플로우를 한 번 일으켜도 값이 변하지 않아야 한다. 변하면 첫 배치가 틀린 것이다.
  await page.setViewportSize({ width: 1441, height: 1000 });
  const after = await modal.boundingBox();
  expect(Math.abs(after!.width - box!.width)).toBeLessThan(2);
});
