import type { EncryptedLocalRecord, EncryptedRecordRepository } from "./contracts";
import type {
  ChallengePlan,
  ChallengeProgress,
  ChallengeTask,
  ChallengeTaskStatus,
  ChallengeWeeklyProgress,
  ISODate,
  LocalResult,
  TodayChallengeSummary,
  TodayTaskItem,
} from "./domainContracts";
import type { JsonCipher } from "./jsonCipher";

function success<T>(value: T): LocalResult<T> {
  return { ok: true, value };
}

function failure<T>(
  code:
    | "VALIDATION_ERROR"
    | "NOT_FOUND"
    | "VERSION_CONFLICT"
    | "ENCRYPTION_FAILED"
    | "DECRYPTION_FAILED"
    | "VAULT_LOCKED"
    | "DUPLICATE_RECORD",
  message: string,
  retryable = false,
): LocalResult<T> {
  return { ok: false, error: { code, message, retryable } };
}

async function toEncryptedRecord<T>(
  payload: T,
  recordType: EncryptedLocalRecord["recordType"],
  id: string,
  householdId: string,
  profileId: string,
  cipher: JsonCipher,
): Promise<EncryptedLocalRecord> {
  const encryptedPayload = await cipher.encrypt(payload);
  const now = new Date().toISOString();
  return {
    id,
    householdRef: householdId,
    profileRef: profileId,
    recordType,
    schemaVersion: 1,
    encryptedPayload,
    createdAt: now,
    updatedAt: now,
  };
}

async function decryptRecord<T>(record: EncryptedLocalRecord, cipher: JsonCipher): Promise<LocalResult<T>> {
  try {
    const payload = await cipher.decrypt<T>(record.encryptedPayload);
    return success(payload);
  } catch {
    return failure("DECRYPTION_FAILED", "챌린지 데이터를 복호화하지 못했습니다.", true);
  }
}

function getLocalDateString(date = new Date()): ISODate {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}` as ISODate;
}

function addDaysToDate(dateStr: ISODate, days: number): ISODate {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  date.setDate(date.getDate() + days);
  return getLocalDateString(date);
}

function getDayOfWeek(dateStr: ISODate): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return new Date(y, m - 1, d).getDay(); // 0(일) ~ 6(토)
}

function getWeekNumber(startDateStr: ISODate, currentDateStr: ISODate, totalWeeks: number): number {
  const [sy, sm, sd] = startDateStr.split("-").map(Number);
  const [cy, cm, cd] = currentDateStr.split("-").map(Number);
  const start = new Date(sy, sm - 1, sd).getTime();
  const current = new Date(cy, cm - 1, cd).getTime();
  const diffDays = Math.floor((current - start) / (1000 * 60 * 60 * 24));
  if (diffDays < 0) return 1;
  return Math.min(totalWeeks, Math.floor(diffDays / 7) + 1);
}

export class LocalChallengeService {
  public constructor(
    private readonly repository: EncryptedRecordRepository,
    private readonly cipher: JsonCipher,
  ) {}

  /**
   * 사용자 요청 기간에 맞춘 챌린지 계획 생성
   */
  public async createPlan(input: {
    householdId: string;
    profileId: string;
    title: string;
    goal: string;
    startDate?: ISODate;
    weeks?: number;
    tasks: Array<Omit<ChallengeTask, "id"> & { id?: string }>;
    createdBy?: "health_assistant" | "manual";
  }): Promise<LocalResult<ChallengePlan>> {
    if (!input.title.trim()) return failure("VALIDATION_ERROR", "챌린지 제목을 입력해 주세요.");
    if (!input.goal.trim()) return failure("VALIDATION_ERROR", "챌린지 목표를 입력해 주세요.");
    if (input.tasks.length === 0) return failure("VALIDATION_ERROR", "하나 이상의 챌린지 과제를 등록해야 합니다.");

    const now = new Date().toISOString();
    const startDate = input.startDate ?? getLocalDateString();
    const weeks = input.weeks ?? 4;
    const endDate = addDaysToDate(startDate, weeks * 7 - 1);

    const tasks: ChallengeTask[] = input.tasks.map((t, idx) => ({
      id: t.id ?? `task-${Date.now()}-${idx}-${crypto.randomUUID().slice(0, 4)}`,
      week: t.week ?? 1,
      dayOfWeek: t.dayOfWeek,
      type: t.type,
      title: t.title.trim(),
      targetMinutes: t.targetMinutes,
      targetDistanceKm: t.targetDistanceKm,
      note: t.note?.trim(),
    }));

    // 기존에 활성 상태인 챌린지가 있다면 archived로 변경
    const activeExisting = await this.getActivePlan(input.profileId);
    if (activeExisting.ok && activeExisting.value) {
      const archived: ChallengePlan = {
        ...activeExisting.value,
        status: "archived",
        updatedAt: now,
        version: activeExisting.value.version + 1,
      };
      await this.repository.put(
        await toEncryptedRecord(archived, "challenge-plan", archived.id, archived.householdId, archived.profileId, this.cipher),
      );
    }

    const plan: ChallengePlan = {
      id: crypto.randomUUID(),
      householdId: input.householdId,
      profileId: input.profileId,
      title: input.title.trim(),
      goal: input.goal.trim(),
      startDate,
      endDate,
      status: "active",
      weeks,
      tasks,
      createdBy: input.createdBy ?? "health_assistant",
      createdAt: now,
      updatedAt: now,
      version: 1,
    };

    try {
      await this.repository.put(
        await toEncryptedRecord(plan, "challenge-plan", plan.id, plan.householdId, plan.profileId, this.cipher),
      );
      return success(plan);
    } catch {
      return failure("ENCRYPTION_FAILED", "챌린지 계획을 암호화하여 저장하지 못했습니다.", true);
    }
  }

  /**
   * 프로필의 현재 활성(active) 챌린지 조회
   */
  public async getActivePlan(profileId: string): Promise<LocalResult<ChallengePlan | null>> {
    const rawRecords = await this.repository.list({
      profileRef: profileId,
      recordType: "challenge-plan",
    });

    for (const raw of rawRecords) {
      const res = await decryptRecord<ChallengePlan>(raw, this.cipher);
      if (res.ok && res.value.status === "active") {
        return success(res.value);
      }
    }
    return success(null);
  }

  /**
   * 특정 ID의 챌린지 조회
   */
  public async getPlan(planId: string): Promise<LocalResult<ChallengePlan>> {
    const raw = await this.repository.get(planId);
    if (!raw || raw.recordType !== "challenge-plan") {
      return failure("NOT_FOUND", "챌린지 계획을 찾을 수 없습니다.");
    }
    return decryptRecord<ChallengePlan>(raw, this.cipher);
  }

  /**
   * 챌린지 계획 수정 (일정, 과제 등)
   */
  public async updatePlan(
    planId: string,
    updates: Partial<Pick<ChallengePlan, "title" | "goal" | "tasks" | "status" | "startDate" | "endDate">> & {
      expectedVersion?: number;
    },
  ): Promise<LocalResult<ChallengePlan>> {
    const current = await this.getPlan(planId);
    if (!current.ok) return current;

    if (updates.expectedVersion !== undefined && current.value.version !== updates.expectedVersion) {
      return failure("VERSION_CONFLICT", "챌린지 계획 버전이 일치하지 않습니다.");
    }

    const now = new Date().toISOString();
    const updated: ChallengePlan = {
      ...current.value,
      title: updates.title?.trim() ?? current.value.title,
      goal: updates.goal?.trim() ?? current.value.goal,
      tasks: updates.tasks ?? current.value.tasks,
      status: updates.status ?? current.value.status,
      startDate: updates.startDate ?? current.value.startDate,
      endDate: updates.endDate ?? current.value.endDate,
      updatedAt: now,
      version: current.value.version + 1,
    };

    try {
      await this.repository.put(
        await toEncryptedRecord(updated, "challenge-plan", updated.id, updated.householdId, updated.profileId, this.cipher),
      );
      return success(updated);
    } catch {
      return failure("ENCRYPTION_FAILED", "챌린지 수정을 암호화하여 저장하지 못했습니다.", true);
    }
  }

  /**
   * 특정 일자의 진행 데이터 조회
   */
  public async getProgress(challengeId: string, date: ISODate): Promise<LocalResult<ChallengeProgress | null>> {
    const progressId = `prog-${challengeId}-${date}`;
    const raw = await this.repository.get(progressId);
    if (!raw || raw.recordType !== "challenge-progress") {
      return success(null);
    }
    return decryptRecord<ChallengeProgress>(raw, this.cipher);
  }

  /**
   * 특정 일자의 진행 데이터 저장/갱신
   */
  private async saveProgress(progress: ChallengeProgress, householdId: string): Promise<LocalResult<ChallengeProgress>> {
    try {
      await this.repository.put(
        await toEncryptedRecord(
          progress,
          "challenge-progress",
          progress.id,
          householdId,
          progress.profileId,
          this.cipher,
        ),
      );
      return success(progress);
    } catch {
      return failure("ENCRYPTION_FAILED", "챌린지 진행 상태를 저장하지 못했습니다.", true);
    }
  }

  /**
   * 오늘 챌린지 및 과제 목록 요약 조회
   */
  public async getTodaySummary(profileId: string, todayDate?: ISODate): Promise<LocalResult<TodayChallengeSummary>> {
    const today = todayDate ?? getLocalDateString();
    const activePlanRes = await this.getActivePlan(profileId);
    if (!activePlanRes.ok) return activePlanRes;

    const plan = activePlanRes.value;
    if (!plan) {
      return success({
        hasActiveChallenge: false,
        todayDate: today,
        tasks: [],
        allCompleted: false,
      });
    }

    const currentWeek = getWeekNumber(plan.startDate, today, plan.weeks);
    const currentDayOfWeek = getDayOfWeek(today);

    // 해당 주차 및 요일에 해당하는 과제 찾기
    let matchedTasks = plan.tasks.filter((t) => t.week === currentWeek && t.dayOfWeek === currentDayOfWeek);
    if (matchedTasks.length === 0) {
      matchedTasks = plan.tasks.filter((t) => t.dayOfWeek === currentDayOfWeek);
    }

    const progressRes = await this.getProgress(plan.id, today);
    const progress = progressRes.ok ? progressRes.value : null;

    const taskItems: TodayTaskItem[] = matchedTasks.map((task) => {
      const taskState = progress?.taskStatuses[task.id];
      return {
        task,
        status: taskState?.status ?? (progress?.dayStatus === "rest" ? "rest" : "pending"),
        adjustedMinutes: taskState?.adjustedMinutes,
        completedAt: taskState?.completedAt,
      };
    });

    const allCompleted =
      taskItems.length > 0 &&
      taskItems.every((item) => item.status === "completed" || item.status === "rest" || item.status === "skipped");

    const weeklyProgressRes = await this.getWeeklyProgress(plan.id, profileId, today);
    const weeklyProgress = weeklyProgressRes.ok ? weeklyProgressRes.value : undefined;

    return success({
      hasActiveChallenge: true,
      plan,
      todayDate: today,
      tasks: taskItems,
      allCompleted,
      weeklyProgress,
    });
  }

  /**
   * 개별 과제 원클릭 완료 / 완료 취소 토글
   */
  public async toggleTaskComplete(
    challengeId: string,
    profileId: string,
    taskId: string,
    date?: ISODate,
  ): Promise<LocalResult<ChallengeProgress>> {
    const targetDate = date ?? getLocalDateString();
    const planRes = await this.getPlan(challengeId);
    if (!planRes.ok) return planRes;
    const plan = planRes.value;

    const existingProgressRes = await this.getProgress(challengeId, targetDate);
    const existing = existingProgressRes.ok ? existingProgressRes.value : null;

    const now = new Date().toISOString();
    const currentStatus = existing?.taskStatuses[taskId]?.status ?? "pending";
    const nextStatus: ChallengeTaskStatus = currentStatus === "completed" ? "pending" : "completed";

    const updatedTaskStatuses = {
      ...(existing?.taskStatuses ?? {}),
      [taskId]: {
        status: nextStatus,
        completedAt: nextStatus === "completed" ? now : undefined,
      },
    };

    const currentWeek = getWeekNumber(plan.startDate, targetDate, plan.weeks);
    const currentDayOfWeek = getDayOfWeek(targetDate);
    let todayTasks = plan.tasks.filter((t) => t.week === currentWeek && t.dayOfWeek === currentDayOfWeek);
    if (todayTasks.length === 0) {
      todayTasks = plan.tasks.filter((t) => t.dayOfWeek === currentDayOfWeek);
    }

    const completedCount = todayTasks.filter((t) => updatedTaskStatuses[t.id]?.status === "completed").length;
    let dayStatus: ChallengeTaskStatus = "pending";
    if (completedCount === todayTasks.length && todayTasks.length > 0) {
      dayStatus = "completed";
    } else if (completedCount > 0) {
      dayStatus = "partial";
    }

    const progress: ChallengeProgress = {
      id: existing?.id ?? `prog-${challengeId}-${targetDate}`,
      challengeId,
      profileId,
      date: targetDate,
      dayStatus,
      taskStatuses: updatedTaskStatuses,
      completedAt: dayStatus === "completed" ? now : null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };

    return this.saveProgress(progress, plan.householdId);
  }

  /**
   * 오늘 과제 모두 한번에 완료
   */
  public async completeAllToday(
    challengeId: string,
    profileId: string,
    date?: ISODate,
  ): Promise<LocalResult<ChallengeProgress>> {
    const targetDate = date ?? getLocalDateString();
    const planRes = await this.getPlan(challengeId);
    if (!planRes.ok) return planRes;
    const plan = planRes.value;

    const existingProgressRes = await this.getProgress(challengeId, targetDate);
    const existing = existingProgressRes.ok ? existingProgressRes.value : null;

    const now = new Date().toISOString();
    const currentWeek = getWeekNumber(plan.startDate, targetDate, plan.weeks);
    const currentDayOfWeek = getDayOfWeek(targetDate);
    let todayTasks = plan.tasks.filter((t) => t.week === currentWeek && t.dayOfWeek === currentDayOfWeek);
    if (todayTasks.length === 0) {
      todayTasks = plan.tasks.filter((t) => t.dayOfWeek === currentDayOfWeek);
    }

    const updatedTaskStatuses = { ...(existing?.taskStatuses ?? {}) };
    for (const t of todayTasks) {
      updatedTaskStatuses[t.id] = {
        status: "completed",
        completedAt: now,
      };
    }

    const progress: ChallengeProgress = {
      id: existing?.id ?? `prog-${challengeId}-${targetDate}`,
      challengeId,
      profileId,
      date: targetDate,
      dayStatus: "completed",
      taskStatuses: updatedTaskStatuses,
      completedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };

    return this.saveProgress(progress, plan.householdId);
  }

  /**
   * 오늘을 회복일(휴식)로 설정
   */
  public async setRestDay(
    challengeId: string,
    profileId: string,
    date?: ISODate,
  ): Promise<LocalResult<ChallengeProgress>> {
    const targetDate = date ?? getLocalDateString();
    const planRes = await this.getPlan(challengeId);
    if (!planRes.ok) return planRes;
    const plan = planRes.value;

    const existingProgressRes = await this.getProgress(challengeId, targetDate);
    const existing = existingProgressRes.ok ? existingProgressRes.value : null;

    const now = new Date().toISOString();
    const currentWeek = getWeekNumber(plan.startDate, targetDate, plan.weeks);
    const currentDayOfWeek = getDayOfWeek(targetDate);
    let todayTasks = plan.tasks.filter((t) => t.week === currentWeek && t.dayOfWeek === currentDayOfWeek);
    if (todayTasks.length === 0) {
      todayTasks = plan.tasks.filter((t) => t.dayOfWeek === currentDayOfWeek);
    }

    const updatedTaskStatuses = { ...(existing?.taskStatuses ?? {}) };
    for (const t of todayTasks) {
      updatedTaskStatuses[t.id] = {
        status: "rest",
        note: "충분한 휴식을 취한 날",
      };
    }

    const progress: ChallengeProgress = {
      id: existing?.id ?? `prog-${challengeId}-${targetDate}`,
      challengeId,
      profileId,
      date: targetDate,
      dayStatus: "rest",
      taskStatuses: updatedTaskStatuses,
      completedAt: now,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };

    return this.saveProgress(progress, plan.householdId);
  }

  /**
   * 오늘 과제 시간 단축 또는 조정 (예: 20분 -> 10분)
   */
  public async adjustTaskMinutes(
    challengeId: string,
    profileId: string,
    taskId: string,
    adjustedMinutes: number,
    date?: ISODate,
  ): Promise<LocalResult<ChallengeProgress>> {
    const targetDate = date ?? getLocalDateString();
    const planRes = await this.getPlan(challengeId);
    if (!planRes.ok) return planRes;
    const plan = planRes.value;

    const existingProgressRes = await this.getProgress(challengeId, targetDate);
    const existing = existingProgressRes.ok ? existingProgressRes.value : null;

    const now = new Date().toISOString();
    const updatedTaskStatuses = {
      ...(existing?.taskStatuses ?? {}),
      [taskId]: {
        status: existing?.taskStatuses[taskId]?.status ?? ("pending" as ChallengeTaskStatus),
        adjustedMinutes,
        note: `컨디션에 맞춰 ${adjustedMinutes}분으로 조정`,
      },
    };

    const progress: ChallengeProgress = {
      id: existing?.id ?? `prog-${challengeId}-${targetDate}`,
      challengeId,
      profileId,
      date: targetDate,
      dayStatus: existing?.dayStatus ?? "pending",
      taskStatuses: updatedTaskStatuses,
      completedAt: existing?.completedAt ?? null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      version: (existing?.version ?? 0) + 1,
    };

    return this.saveProgress(progress, plan.householdId);
  }

  /**
   * 주간 진행률 및 연속 달성일(Streak) 계산
   */
  public async getWeeklyProgress(
    challengeId: string,
    profileId: string,
    referenceDate?: ISODate,
  ): Promise<LocalResult<ChallengeWeeklyProgress>> {
    const refDate = referenceDate ?? getLocalDateString();
    const planRes = await this.getPlan(challengeId);
    if (!planRes.ok) return planRes;
    const plan = planRes.value;

    const weekNumber = getWeekNumber(plan.startDate, refDate, plan.weeks);
    const weekStartOffset = (weekNumber - 1) * 7;
    const weekStartDate = addDaysToDate(plan.startDate, weekStartOffset);

    const dailyStatuses: ChallengeWeeklyProgress["dailyStatuses"] = [];
    let completedDays = 0;

    for (let i = 0; i < 7; i++) {
      const date = addDaysToDate(weekStartDate, i);
      const dayOfWeek = getDayOfWeek(date);
      const progressRes = await this.getProgress(challengeId, date);
      const prog = progressRes.ok ? progressRes.value : null;

      let tasksForDay = plan.tasks.filter((t) => t.week === weekNumber && t.dayOfWeek === dayOfWeek);
      if (tasksForDay.length === 0) {
        tasksForDay = plan.tasks.filter((t) => t.dayOfWeek === dayOfWeek);
      }

      const isDone = prog?.dayStatus === "completed" || prog?.dayStatus === "rest";
      if (isDone) completedDays++;

      const completedCount = tasksForDay.filter((t) => prog?.taskStatuses[t.id]?.status === "completed").length;

      dailyStatuses.push({
        date,
        dayOfWeek,
        status: prog?.dayStatus ?? "pending",
        tasksCount: tasksForDay.length,
        completedCount,
      });
    }

    // 연속 달성일(Streak) 계산
    let streak = 0;
    let checkDate = refDate;
    while (true) {
      const progRes = await this.getProgress(challengeId, checkDate);
      const prog = progRes.ok ? progRes.value : null;
      if (prog && (prog.dayStatus === "completed" || prog.dayStatus === "rest")) {
        streak++;
        checkDate = addDaysToDate(checkDate, -1);
      } else {
        break;
      }
    }

    const ratePercent = Math.round((completedDays / 7) * 100);

    return success({
      challengeId,
      profileId,
      weekNumber,
      totalDays: 7,
      completedDays,
      ratePercent,
      currentStreakDays: streak,
      dailyStatuses,
    });
  }
}
