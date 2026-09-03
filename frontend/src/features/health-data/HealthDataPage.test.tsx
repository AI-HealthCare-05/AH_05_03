import { useEffect, useRef } from "react";
import { render, screen } from "@testing-library/react";
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

    expect(await screen.findByRole("heading", { name: "나님의 건강 변화" })).toBeInTheDocument();
    expect(await screen.findByText("최근 3개월간 체중이 2.1kg 감소했습니다.")).toBeInTheDocument();
    expect(screen.getByRole("complementary", { name: "가족 구성원" })).toBeInTheDocument();
  });
});

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
