import { indexedDB } from "fake-indexeddb";
import { describe, expect, it } from "vitest";

import { IndexedDbEncryptedRecordRepository } from "./indexedDbEncryptedRecordRepository";
import { AesGcmJsonCipher } from "./jsonCipher";
import { LocalChallengeService } from "./localChallengeService";
import { LocalProfileService } from "./localDomainServices";

describe("LocalChallengeService (챌린지 로컬 암호화 저장 및 진행 관리)", () => {
  async function createFixture() {
    const repository = new IndexedDbEncryptedRecordRepository(
      "ieobom-challenge-test-" + crypto.randomUUID(),
      indexedDB,
    );
    const cipher = await AesGcmJsonCipher.create();
    const service = new LocalChallengeService(repository, cipher);
    const profiles = new LocalProfileService(repository, cipher);
    const householdId = crypto.randomUUID();
    const profileRes = await profiles.create({
      householdId,
      displayName: "홍길동",
      relationship: "본인",
    });
    if (!profileRes.ok) throw new Error("Failed to create profile");

    return {
      repository,
      cipher,
      service,
      profiles,
      householdId,
      profile: profileRes.value,
    };
  }

  it("4주 챌린지 계획을 생성하고 암호화 저장 후 복호화하여 조회한다", async () => {
    const { service, householdId, profile } = await createFixture();

    const planRes = await service.createPlan({
      householdId,
      profileId: profile.id,
      title: "혈압 관리를 위한 4주 걷기 챌린지",
      goal: "매일 20분 가볍게 걷기",
      startDate: "2026-09-01",
      tasks: [
        { week: 1, dayOfWeek: 1, type: "exercise", title: "가벼운 20분 걷기", targetMinutes: 20 },
        { week: 1, dayOfWeek: 2, type: "exercise", title: "가벼운 20분 걷기", targetMinutes: 20 },
        { week: 1, dayOfWeek: 3, type: "sleep", title: "7시간 충분한 수면 취하기" },
      ],
    });

    expect(planRes.ok).toBe(true);
    if (!planRes.ok) return;

    expect(planRes.value.status).toBe("active");
    expect(planRes.value.weeks).toBe(4);
    expect(planRes.value.tasks.length).toBe(3);

    const activeRes = await service.getActivePlan(profile.id);
    expect(activeRes.ok).toBe(true);
    if (!activeRes.ok) return;
    expect(activeRes.value?.id).toBe(planRes.value.id);
    expect(activeRes.value?.title).toBe("혈압 관리를 위한 4주 걷기 챌린지");
  });

  it("명시한 챌린지 기간을 유지하고 4주 이후 과제도 해당 주차에 조회한다", async () => {
    const { service, householdId, profile } = await createFixture();

    const planRes = await service.createPlan({
      householdId,
      profileId: profile.id,
      title: "6주 생활습관 챌린지",
      goal: "6주 동안 꾸준히 걷기",
      startDate: "2026-09-01",
      weeks: 6,
      tasks: [
        { week: 5, dayOfWeek: 2, type: "exercise", title: "5주차 화요일 걷기", targetMinutes: 30 },
      ],
    });

    expect(planRes.ok && planRes.value.weeks).toBe(6);
    expect(planRes.ok && planRes.value.endDate).toBe("2026-10-12");

    const summaryRes = await service.getTodaySummary(profile.id, "2026-09-29");
    expect(summaryRes.ok).toBe(true);
    if (!summaryRes.ok) return;
    expect(summaryRes.value.weeklyProgress?.weekNumber).toBe(5);
    expect(summaryRes.value.tasks[0]?.task.title).toBe("5주차 화요일 걷기");
  });

  it("프로필별로 활성 챌린지가 독립적으로 격리된다", async () => {
    const { service, profiles, householdId, profile: profile1 } = await createFixture();
    const profile2Res = await profiles.create({
      householdId,
      displayName: "어머니",
      relationship: "부모",
    });
    if (!profile2Res.ok) throw new Error("Failed to create profile2");
    const profile2 = profile2Res.value;

    await service.createPlan({
      householdId,
      profileId: profile1.id,
      title: "프로필1 챌린지",
      goal: "목표1",
      tasks: [{ week: 1, dayOfWeek: 1, type: "exercise", title: "운동1" }],
    });

    const active1 = await service.getActivePlan(profile1.id);
    const active2 = await service.getActivePlan(profile2.id);

    expect(active1.ok && active1.value?.title).toBe("프로필1 챌린지");
    expect(active2.ok && active2.value).toBeNull();
  });

  it("오늘 과제 목록을 조회하고 원클릭 완료 및 취소 토글이 정상 동작한다", async () => {
    const { service, householdId, profile } = await createFixture();

    // 2026-09-01은 화요일 (dayOfWeek = 2)
    const planRes = await service.createPlan({
      householdId,
      profileId: profile.id,
      title: "화요일 챌린지",
      goal: "화요일 과제 테스트",
      startDate: "2026-09-01",
      tasks: [
        { week: 1, dayOfWeek: 2, type: "exercise", title: "화요일 20분 걷기", targetMinutes: 20 },
      ],
    });
    if (!planRes.ok) throw new Error("Failed to create plan");

    const summary1 = await service.getTodaySummary(profile.id, "2026-09-01");
    expect(summary1.ok).toBe(true);
    if (!summary1.ok) return;
    expect(summary1.value.hasActiveChallenge).toBe(true);
    expect(summary1.value.tasks.length).toBe(1);
    expect(summary1.value.tasks[0].status).toBe("pending");
    expect(summary1.value.allCompleted).toBe(false);

    const taskId = summary1.value.tasks[0].task.id;

    // 1. 완료 처리
    const toggle1 = await service.toggleTaskComplete(planRes.value.id, profile.id, taskId, "2026-09-01");
    expect(toggle1.ok).toBe(true);
    if (!toggle1.ok) return;
    expect(toggle1.value.taskStatuses[taskId].status).toBe("completed");

    const summary2 = await service.getTodaySummary(profile.id, "2026-09-01");
    expect(summary2.ok && summary2.value.allCompleted).toBe(true);
    expect(summary2.ok && summary2.value.tasks[0].status).toBe("completed");

    // 2. 완료 취소
    const toggle2 = await service.toggleTaskComplete(planRes.value.id, profile.id, taskId, "2026-09-01");
    expect(toggle2.ok && toggle2.value.taskStatuses[taskId].status).toBe("pending");

    const summary3 = await service.getTodaySummary(profile.id, "2026-09-01");
    expect(summary3.ok && summary3.value.allCompleted).toBe(false);
  });

  it("오늘 챌린지 모두 완료를 수행하면 모든 당일 과제가 완료된다", async () => {
    const { service, householdId, profile } = await createFixture();

    const planRes = await service.createPlan({
      householdId,
      profileId: profile.id,
      title: "다중 과제 챌린지",
      goal: "다중 과제",
      startDate: "2026-09-01",
      tasks: [
        { week: 1, dayOfWeek: 2, type: "exercise", title: "운동 과제", targetMinutes: 20 },
        { week: 1, dayOfWeek: 2, type: "sleep", title: "수면 과제" },
      ],
    });
    if (!planRes.ok) throw new Error("Failed to create plan");

    const completeAllRes = await service.completeAllToday(planRes.value.id, profile.id, "2026-09-01");
    expect(completeAllRes.ok).toBe(true);

    const summary = await service.getTodaySummary(profile.id, "2026-09-01");
    expect(summary.ok && summary.value.allCompleted).toBe(true);
    expect(summary.ok && summary.value.tasks.every((t) => t.status === "completed")).toBe(true);
  });

  it("회복일 설정 및 과제 시간 단축이 정상 반영된다", async () => {
    const { service, householdId, profile } = await createFixture();

    const planRes = await service.createPlan({
      householdId,
      profileId: profile.id,
      title: "유연한 챌린지",
      goal: "피로 대응",
      startDate: "2026-09-01",
      tasks: [
        { week: 1, dayOfWeek: 2, type: "exercise", title: "20분 걷기", targetMinutes: 20 },
      ],
    });
    if (!planRes.ok) return;
    const taskId = planRes.value.tasks[0].id;

    // 1. 20분 -> 10분 단축
    const adjustRes = await service.adjustTaskMinutes(planRes.value.id, profile.id, taskId, 10, "2026-09-01");
    expect(adjustRes.ok).toBe(true);
    expect(adjustRes.ok && adjustRes.value.taskStatuses[taskId].adjustedMinutes).toBe(10);

    // 2. 회복일(rest) 설정
    const restRes = await service.setRestDay(planRes.value.id, profile.id, "2026-09-01");
    expect(restRes.ok).toBe(true);
    expect(restRes.ok && restRes.value.dayStatus).toBe("rest");
  });

  it("주간 진행률 및 연속 달성일(Streak)을 올바르게 계산한다", async () => {
    const { service, householdId, profile } = await createFixture();

    const planRes = await service.createPlan({
      householdId,
      profileId: profile.id,
      title: "진행률 챌린지",
      goal: "주간 달성률",
      startDate: "2026-09-01", // 화 (day 2)
      tasks: [
        { week: 1, dayOfWeek: 2, type: "exercise", title: "화요일 과제" },
        { week: 1, dayOfWeek: 3, type: "exercise", title: "수요일 과제" },
        { week: 1, dayOfWeek: 4, type: "exercise", title: "목요일 과제" },
      ],
    });
    if (!planRes.ok) return;

    // 화요일 완료
    await service.completeAllToday(planRes.value.id, profile.id, "2026-09-01");
    // 수요일 완료
    await service.completeAllToday(planRes.value.id, profile.id, "2026-09-02");

    const weekly = await service.getWeeklyProgress(planRes.value.id, profile.id, "2026-09-02");
    expect(weekly.ok).toBe(true);
    if (!weekly.ok) return;

    expect(weekly.value.completedDays).toBe(2);
    expect(weekly.value.currentStreakDays).toBe(2);
    expect(weekly.value.ratePercent).toBe(Math.round((2 / 7) * 100));
  });

  it("챌린지 데이터가 존재하는 프로필은 빈 프로필 삭제 방어로 삭제되지 않는다", async () => {
    const { service, profiles, householdId, profile } = await createFixture();

    await service.createPlan({
      householdId,
      profileId: profile.id,
      title: "보호할 챌린지",
      goal: "삭제 방어",
      tasks: [{ week: 1, dayOfWeek: 1, type: "exercise", title: "과제" }],
    });

    const deleteRes = await profiles.deleteEmpty(profile.id);
    expect(deleteRes.ok).toBe(false);
    expect(deleteRes.ok ? "" : deleteRes.error.code).toBe("DUPLICATE_RECORD");
  });
});
