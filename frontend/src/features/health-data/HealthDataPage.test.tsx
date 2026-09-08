import { useEffect, useRef } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { PRIMARY_HOUSEHOLD_ID, useLocalDomain } from "../../app/localDomainContext";
import { HealthDataPage } from "./HealthDataPage";

describe("HealthDataPage", () => {
  it("선택 기간의 체중 변화를 실제 로컬 기록으로 계산한다", async () => {
    render(
      <LocalDomainProvider databaseName={`ieobom-health-data-${crypto.randomUUID()}`}>
        <SeededHealthDataPage />
      </LocalDomainProvider>,
    );

    expect(await screen.findByRole("heading", { name: "나님의 건강 변화" }, { timeout: 5000 })).toBeInTheDocument();
    expect(await screen.findByText("최근 3개월간 체중이 2.1kg 감소했습니다.", {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "가족 구성원" })).toBeInTheDocument();
  });

  it("판정 기록의 검진 수치도 같은 차트에 들어간다", async () => {
    // **이 화면이 계속 비어 있던 이유다.** 사용자가 실제로 남기는 수치는 대부분
    // 판정 화면에서 검진결과지를 옮겨 적은 것이고, 그건 `assessment` 기록의
    // `payload.inputs` 에 통째로 들어간다. 이 화면은 `body_measurement` 같은
    // 전용 타입만 찾고 있어서 기록이 열두 건 있는데도 "아직 기록이 없습니다" 였다.
    const { container } = render(
      <LocalDomainProvider databaseName={`ieobom-health-data-${crypto.randomUUID()}`}>
        <SeededAssessmentPage />
      </LocalDomainProvider>,
    );

    await screen.findAllByRole("heading", { name: "나님의 건강 변화" });
    // 체중은 판정 입력의 `weight_kg` 에서 온다.
    await waitFor(() => expect(summaryOf(container)).toContain("70"));
    // 혈압·혈당 카드도 "기록 없음" 이 아니어야 한다.
    // 세 요약 카드가 전부 값을 갖는다. 판정 입력에서 왔다.
    const summary = container.querySelector(".health-summary-grid") as HTMLElement;
    expect(summary.textContent).toContain("70");   // 체중 kg
    expect(summary.textContent).toContain("132");  // 수축기
    expect(summary.textContent).toContain("104");  // 공복혈당
    expect(within(summary).queryByText("기록 없음")).not.toBeInTheDocument();
    // 검진 수치 목록에는 폼 라벨을 그대로 쓴다 — 화면마다 다른 이름이 나가면 안 된다.
    const options = [...container.querySelectorAll(".lab-metric-select option")].map((o) => o.textContent);
    expect(options).toContain("당화혈색소");
    // **나이·키는 검진 수치가 아니다.** 프리셋을 바꿔 가며 판정하면 나이가
    // 26 → 52 → 61 로 그려지는데, 그래프는 그걸 "나이가 오르내렸다" 로 보여 준다.
    expect(options).not.toContain("나이");
    expect(options).not.toContain("키");
    expect(options).not.toContain("전반적 건강");
  });
});

function summaryOf(container: HTMLElement): string {
  return container.querySelector(".health-summary-grid")?.textContent ?? "";
}

function SeededAssessmentPage() {
  const { runtime, refreshProfiles } = useLocalDomain();
  const started = useRef(false);

  useEffect(() => {
    if (!runtime || started.current) return;
    started.current = true;
    void (async () => {
      const profileResult = await runtime.profiles.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        displayName: "나",
        relationship: "본인",
      });
      if (!profileResult.ok) throw new Error(profileResult.error.message);
      const now = new Date();
      const earlier = new Date(now);
      earlier.setDate(earlier.getDate() - 30);
      const snapshot = (at: Date, weight: number, sbp: number, glucose: number, hba1c: number) => ({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profileResult.value.id,
        recordType: "assessment" as const,
        recordedAt: at.toISOString(),
        source: "manual" as const,
        payload: {
          inputs: { age: 52, sex: "M", height_cm: 172, weight_kg: weight, sbp, dbp: 82, fasting_glucose: glucose, hba1c },
          levels: { htn: "HIGH" },
          engines: { htn: "E1" },
          bmi: 26,
          evaluated: 1,
          total: 14,
          highestLevel: "HIGH",
        },
      });
      await runtime.healthRecords.create(snapshot(earlier, 72, 148, 112, 6.1));
      await runtime.healthRecords.create(snapshot(now, 70, 132, 104, 5.8));
      await refreshProfiles();
    })();
  }, [refreshProfiles, runtime]);

  return <HealthDataPage />;
}

function SeededHealthDataPage() {
  const { runtime, refreshProfiles } = useLocalDomain();
  const started = useRef(false);

  useEffect(() => {
    if (!runtime || started.current) return;
    started.current = true;
    void (async () => {
      const profileResult = await runtime.profiles.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        displayName: "나",
        relationship: "본인",
      });
      if (!profileResult.ok) throw new Error(profileResult.error.message);
      const now = new Date();
      const earlier = new Date(now);
      earlier.setDate(earlier.getDate() - 30);
      await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profileResult.value.id,
        recordType: "body_measurement",
        recordedAt: earlier.toISOString(),
        source: "manual",
        payload: { weightKg: 70 },
      });
      await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profileResult.value.id,
        recordType: "body_measurement",
        recordedAt: now.toISOString(),
        source: "manual",
        payload: { weightKg: 67.9 },
      });
      await refreshProfiles();
    })();
  }, [refreshProfiles, runtime]);

  return <HealthDataPage />;
}
