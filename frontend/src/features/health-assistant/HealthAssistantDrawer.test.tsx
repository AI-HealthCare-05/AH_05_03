import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  HealthAssistantDrawer,
  extractMetricsFromRecords,
  HealthMetricsTrendCard,
  containsNewMedicationRecord,
  formatTargetDateTime,
  resolveMedicationTakenAt,
} from "./HealthAssistantDrawer";
import type { FamilyProfile, HealthRecord } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import * as clientModule from "./healthAssistantClient";

if (!globalThis.URL.createObjectURL) {
  globalThis.URL.createObjectURL = vi.fn(() => "blob:fake-url");
}
if (!globalThis.URL.revokeObjectURL) {
  globalThis.URL.revokeObjectURL = vi.fn();
}

describe("HealthAssistantDrawer (봄이 AI 챗봇)", () => {
  const mockProfile: FamilyProfile = {
    id: "profile-1",
    householdId: "household-1",
    displayName: "홍길동",
    relationship: "본인",
    birthDate: "1990-01-01",
    opaqueServerRef: null,
    serverRefState: "none",
    status: "active",
    mergedIntoProfileId: null,
    createdAt: "2026-08-31T00:00:00Z",
    updatedAt: "2026-08-31T00:00:00Z",
    version: 1,
  };

  const mockCreateRecord = vi.fn().mockResolvedValue({
    ok: true,
    value: { id: "record-123" },
  });

  const mockQueryRecords = vi.fn().mockResolvedValue({
    ok: true,
    value: [],
  });

  const mockReadDocById = vi.fn().mockResolvedValue({
    ok: true,
    value: { file: new File(["dummy"], "screening_result.png", { type: "image/png" }), fileName: "screening_result.png" },
  });

  const mockSaveDoc = vi.fn().mockResolvedValue({
    ok: true,
    value: { id: "doc-123", fileName: "screening_result.png" },
  });

  const mockRuntime = {
    healthRecords: {
      create: mockCreateRecord,
      query: mockQueryRecords,
    },
    documents: {
      readById: mockReadDocById,
      save: mockSaveDoc,
    },
  } as unknown as LocalDomainRuntime;

  const mockOnClose = vi.fn();
  const mockOnRecordSaved = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  it("isOpen이 false일 때는 아무것도 렌더링하지 않는다", () => {
    const { container } = render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={false}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );
    expect(container.firstChild).toBeNull();
  });

  it("열렸을 때 환영 메시지와 프로필 이름을 표시한다", () => {
    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    expect(screen.getByText(/봄이 · 건강 비서/)).toBeInTheDocument();
    expect(screen.getByText(/홍길동 \(본인\)/)).toBeInTheDocument();
    expect(screen.getByText(/안녕하세요! 홍길동님의 건강 비서/)).toBeInTheDocument();
  });

  it("복용 시각을 말하지 않으면 임의 시각 대신 현재 시각을 후보로 사용한다", () => {
    const now = new Date(2026, 8, 2, 15, 27);

    expect(resolveMedicationTakenAt("이지엔 한 알 먹었어", "2026-09-02T12:00", now)).toBe(
      "2026-09-02T15:27",
    );
    expect(resolveMedicationTakenAt("오늘 아침 8시에 이지엔 먹었어", "2026-09-02T08:00", now)).toBe(
      "2026-09-02T08:00",
    );
    expect(resolveMedicationTakenAt("어제 이지엔 먹었어", "2026-09-01T12:00", now)).toBe(
      "2026-09-01",
    );
  });

  it("새 복약 기록과 복약 관련 질문을 구분한다", () => {
    expect(containsNewMedicationRecord("이지엔 한 알 먹었어")).toBe(true);
    expect(containsNewMedicationRecord("8시에 타이레놀 1알")).toBe(true);
    expect(containsNewMedicationRecord("나 담배 피워도 돼?")).toBe(false);
    expect(containsNewMedicationRecord("타이레놀 먹어도 돼?")).toBe(false);
  });

  it("자연어 입력 후 AI가 운동 초안을 제시하면 확인 카드가 렌더링되고, 승인 전에는 저장되지 않는다", async () => {
    vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "record_exercise",
      assistant_message: "랫풀다운 20kg 10회 3세트 기록을 오늘 날짜로 저장할까요?",
      exercise_draft: {
        exercise_name: "랫풀다운",
        weight_kg: 20,
        reps: 10,
        sets: 3,
      },
      missing_fields: [],
      needs_confirmation: true,
      suggested_quick_replies: [],
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
    const sendBtn = screen.getByRole("button", { name: "전송" });

    fireEvent.change(input, { target: { value: "오늘 랫풀다운 20kg 10개 3세트 했어" } });
    fireEvent.click(sendBtn);

    // AI 응답 확인
    await waitFor(() => {
      expect(screen.getByText(/랫풀다운 20kg 10회 3세트 기록을 오늘 날짜로 저장할까요?/)).toBeInTheDocument();
    });

    // 확인 카드 렌더링 확인
    expect(screen.getByText(/운동 기록 확인/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("랫풀다운")).toBeInTheDocument();
    expect(screen.getByDisplayValue("20")).toBeInTheDocument();
    expect(screen.getByDisplayValue("10")).toBeInTheDocument();
    expect(screen.getByDisplayValue("3")).toBeInTheDocument();

    // 승인 전에는 저장이 호출되지 않음
    expect(mockCreateRecord).not.toHaveBeenCalled();

    // 저장 버튼 클릭
    const saveBtn = screen.getByRole("button", { name: /운동 기록에 저장하기/ });
    fireEvent.click(saveBtn);

    // 저장 함수가 올바른 파라미터로 호출되었는지 검증
    await waitFor(() => {
      expect(mockCreateRecord).toHaveBeenCalledTimes(1);
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          profileId: "profile-1",
          recordType: "exercise",
          source: "local_ai",
          payload: expect.objectContaining({
            type: "exercise",
            exerciseName: "랫풀다운",
            weightKg: 20,
            reps: 10,
            sets: 3,
          }),
        }),
      );
    });

    // 완료 피드백 확인
    await waitFor(() => {
      expect(screen.getByText(/안전하게 저장되었습니다/)).toBeInTheDocument();
    });
  });

  it("운동을 저장하면 오늘 운동 전체 기록을 자동으로 다시 보여준다", async () => {
    const today = new Date();
    const firstRecordedAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 0).toISOString();
    const secondRecordedAt = new Date(today.getFullYear(), today.getMonth(), today.getDate(), 10, 10).toISOString();
    const query = vi.fn().mockResolvedValue({
      ok: true,
      value: [
        {
          id: "exercise-2",
          householdId: "household-1",
          profileId: "profile-1",
          recordType: "exercise",
          recordedAt: secondRecordedAt,
          source: "local_ai",
          payload: { type: "exercise", exerciseName: "레버로우", weightKg: 35, reps: 5, sets: 3 },
          version: 1,
        },
        {
          id: "exercise-1",
          householdId: "household-1",
          profileId: "profile-1",
          recordType: "exercise",
          recordedAt: firstRecordedAt,
          source: "local_ai",
          payload: { type: "exercise", exerciseName: "랫풀다운", weightKg: 20, reps: 10, sets: 3 },
          version: 1,
        },
      ],
    });
    const runtimeWithExercises = {
      healthRecords: { create: mockCreateRecord, query },
      documents: { readById: mockReadDocById, save: mockSaveDoc },
    } as unknown as LocalDomainRuntime;

    vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "record_exercise",
      assistant_message: "레버로우 기록을 저장할까요?",
      exercise_draft: { exercise_name: "레버로우", weight_kg: 35, reps: 5, sets: 3 },
      missing_fields: [],
      needs_confirmation: true,
      suggested_quick_replies: [],
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={runtimeWithExercises}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/건강정보를 입력하거나/), {
      target: { value: "레버로우 35kg 5개 3세트" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));
    fireEvent.click(await screen.findByRole("button", { name: "운동 기록에 저장하기" }));

    expect(await screen.findByText("오늘 운동 기록 (2건)")).toBeInTheDocument();
    expect(screen.getByText("랫풀다운")).toBeInTheDocument();
    expect(screen.getAllByText("레버로우").length).toBeGreaterThanOrEqual(1);
  });

  it("응급 상황 메시지가 오면 붉은색 응급 주의 배너를 렌더링한다", async () => {
    vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "health_advice",
      assistant_message: "가슴 흉통은 위험할 수 있습니다.",
      missing_fields: [],
      needs_confirmation: false,
      suggested_quick_replies: [],
      emergency_notice: "심한 흉통은 즉시 119에 연락하세요.",
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
    fireEvent.change(input, { target: { value: "가슴이 쥐어짜듯 너무 아파" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText(/응급 주의 안내/)).toBeInTheDocument();
      expect(screen.getByText(/심한 흉통은 즉시 119에 연락하세요/)).toBeInTheDocument();
    });
  });

  it("통증 대화 입력 시 PainConfirmationCard가 표시되고 저장을 누르면 pain 레코드가 생성된다", async () => {
    vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "record_pain",
      assistant_message: "오른쪽 무릎 통증 기록을 저장할까요?",
      pain_draft: {
        body_area: "오른쪽 무릎",
        intensity: 6,
        sensation: "욱신거림",
      },
      missing_fields: [],
      needs_confirmation: true,
      suggested_quick_replies: [],
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
    fireEvent.change(input, { target: { value: "오른쪽 무릎이 욱신거려 강도 6" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("통증 기록 확인")).toBeInTheDocument();
      expect(screen.getByDisplayValue("오른쪽 무릎")).toBeInTheDocument();
      expect(screen.getByDisplayValue("욱신거림")).toBeInTheDocument();
    });

    // 저장 버튼 클릭
    fireEvent.click(screen.getByRole("button", { name: "통증 기록에 저장하기" }));

    await waitFor(() => {
      expect(mockCreateRecord).toHaveBeenCalledWith(
        expect.objectContaining({
          recordType: "pain",
          payload: expect.objectContaining({
            type: "pain",
            bodyArea: "오른쪽 무릎",
            intensity: 6,
            sensation: "욱신거림",
          }),
        }),
      );
      expect(mockOnRecordSaved).toHaveBeenCalled();
    });
  });

  it("저장된 최근 복약 기록이 있을 때 음주 질문 시 프로필 컨텍스트에 기록 요약이 전달된다", async () => {
    const runtimeWithMed = {
      healthRecords: {
        create: mockCreateRecord,
        query: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            {
              id: "med-1",
              profileId: "profile-1",
              recordType: "medication",
              recordedAt: "2026-08-31T08:30:00Z",
              source: "manual",
              payload: {
                type: "medication",
                medicationName: "타이레놀",
                dosage: "1알",
              },
            },
          ],
        }),
      },
      documents: {
        readById: mockReadDocById,
        save: mockSaveDoc,
      },
    } as unknown as LocalDomainRuntime;

    const spySend = vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "health_advice",
      assistant_message: "최근 복약 기록에 타이레놀 복용 내역이 있습니다. 타이레놀은 간 손상 위험이 있어 음주를 피하셔야 합니다.",
      missing_fields: [],
      needs_confirmation: false,
      suggested_quick_replies: [],
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={runtimeWithMed}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
    fireEvent.change(input, { target: { value: "나 오늘 술마셔도 됨?" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(spySend).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({
          profile_name: "홍길동",
          recent_records_summary: expect.stringContaining("타이레놀"),
        }),
      );
    });

    await waitFor(() => {
      expect(screen.getByText(/최근 복약 기록에 타이레놀 복용 내역이 있습니다/)).toBeInTheDocument();
    });
  });

  it("최근 복약 기록을 근거로 답할 때 동일한 복약 저장 카드를 다시 만들지 않는다", async () => {
    vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "health_advice",
      assistant_message:
        "방금 타이레놀 1알을 복용하셨습니다. 흡연은 피하시는 것이 좋습니다. 오늘 복용하신 타이레놀 기록을 저장할까요?",
      medication_draft: {
        medication_name: "타이레놀",
        dosage: "1알",
        taken_at: "2026-09-02T10:43",
      },
      missing_fields: [],
      needs_confirmation: true,
      suggested_quick_replies: ["네, 저장해 주세요", "아니요, 저장 안 할래요"],
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/건강정보를 입력하거나/), {
      target: { value: "나 담배 피워도 돼?" },
    });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    expect(await screen.findByText(/흡연은 피하시는 것이 좋습니다/)).toBeInTheDocument();
    expect(screen.queryByText(/기록을 저장할까요/)).not.toBeInTheDocument();
    expect(screen.queryByText("복약 기록 확인")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "복약 기록에 저장하기" })).not.toBeInTheDocument();
  });

  it("조회된 건강검진 기록에 sourceDocumentId가 있을 때 원본 서류 보기 버튼이 노출되고 클릭 시 모달이 뜬다", async () => {
    const runtimeWithDoc = {
      healthRecords: {
        create: mockCreateRecord,
        query: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            {
              id: "rec-screening-1",
              profileId: "profile-1",
              recordType: "health_screening",
              recordedAt: "2026-08-28T09:00:00Z",
              source: "ocr",
              sourceDocumentId: "doc-screening-1",
              payload: {
                type: "health_screening",
                screeningName: "국가건강검진",
                summary: "혈압 120/80, 공복혈당 95",
              },
            },
          ],
        }),
      },
      documents: {
        readById: vi.fn().mockResolvedValue({
          ok: true,
          value: { file: new File(["image-bytes"], "2026_08_28_screening.png", { type: "image/png" }), fileName: "2026_08_28_screening.png" },
        }),
        save: mockSaveDoc,
      },
    } as unknown as LocalDomainRuntime;

    vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "query_records",
      assistant_message: "8월 28일 건강검진 결과입니다.",
      query_draft: { record_type: "health_screening", time_range: "8/28" },
      missing_fields: [],
      needs_confirmation: false,
      suggested_quick_replies: [],
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={runtimeWithDoc}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
    fireEvent.change(input, { target: { value: "8/28 건강검진결과 원본 보여줘" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(screen.getByText("클릭하여 확대")).toBeInTheDocument();
    });

    fireEvent.click(screen.getByText("클릭하여 확대"));

    await waitFor(() => {
      expect(screen.getByRole("dialog", { name: "연결된 원본 서류" })).toBeInTheDocument();
      expect(screen.getAllByText("2026_08_28_screening.png").length).toBeGreaterThanOrEqual(1);
    });
  });

  it("+ 버튼이 있어 파일 업로드 인풋이 존재한다", () => {
    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    expect(screen.getByTitle("검진표/서류 이미지 업로드")).toBeInTheDocument();
  });

  it("parseExamDateFromText 헬퍼 함수가 서류 텍스트 내 검사일자를 정확히 추출한다", async () => {
    const { parseExamDateFromText } = await import("./HealthAssistantDrawer");
    expect(parseExamDateFromText("검진일자: 2025-08-28 (서울병원)")).toBe("2025-08-28");
    expect(parseExamDateFromText("수검일: 2025.8.28 판정")).toBe("2025-08-28");
    expect(parseExamDateFromText("2025년 8월 28일 종합건강검진표")).toBe("2025-08-28");
    expect(
      parseExamDateFromText(
        "건강검진 결과통보서 - 성명: 오성민 - 주민등록번호: 881028-1****** - 검진일자: 2022-05-30",
      ),
    ).toBe("2022-05-30");
    expect(
      parseExamDateFromText(
        "귀하의 건강검진결과를 위와 같이 통보합니다.\n2026년08월31일\n판정일 20191228 검진의사: 방성은 (재)한국의학연구소",
      ),
    ).toBe("2019-12-28");
    expect(parseExamDateFromText("날짜 정보 없음")).toBeUndefined();
  });

  it("filterRecordsByTimeRange 함수가 작년, 특정 연도, 오늘 등을 정확히 필터링한다", async () => {
    const { filterRecordsByTimeRange } = await import("./HealthAssistantDrawer");
    const currentYear = new Date().getFullYear();
    const records = [
      { id: "1", recordedAt: "2022-05-30T09:00:00Z" },
      { id: "2", recordedAt: `${currentYear - 1}-08-28T09:00:00Z` }, // 작년
      { id: "3", recordedAt: `${currentYear}-01-10T09:00:00Z` }, // 올해
    ] as unknown as HealthRecord[];

    // 작년 조회 -> 2번만
    const lastYearRes = filterRecordsByTimeRange(records, "작년");
    expect(lastYearRes.map((r) => r.id)).toEqual(["2"]);

    // 특정 4자리 연도 조회 -> 1번만
    const year2022Res = filterRecordsByTimeRange(records, "2022");
    expect(year2022Res.map((r) => r.id)).toEqual(["1"]);

    // 올해 조회 -> 3번만
    const thisYearRes = filterRecordsByTimeRange(records, "올해");
    expect(thisYearRes.map((r) => r.id)).toEqual(["3"]);

    // 없는 연도(예: 2020년) 조회 시 빈 배열 반환
    const emptyRes = filterRecordsByTimeRange(records, "2020");
    expect(emptyRes).toEqual([]);
  });

  it("드로어를 열거나 조회해도 기존 건강기록을 자동으로 수정하지 않는다", async () => {
    const mockUpdate = vi.fn().mockResolvedValue({ ok: true, value: {} });
    const runtimeWithOldRecord = {
      healthRecords: {
        query: vi.fn().mockResolvedValue({
          ok: true,
          value: [
            {
              id: "rec-old-1",
              profileId: "profile-1",
              recordType: "health_screening",
              recordedAt: "2026-08-31T09:00:00Z", // 오늘 날짜로 잘못 들어가 있음
              version: 1,
              payload: {
                screeningName: "2024년 정기건강검진",
                note: "수검일자: 2024.05.15 검사결과 정상",
              },
            },
          ],
        }),
        update: mockUpdate,
        create: vi.fn(),
      },
      documents: {
        list: vi.fn().mockResolvedValue({ ok: true, value: [] }),
      },
    } as unknown as LocalDomainRuntime;

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={runtimeWithOldRecord}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    await waitFor(() => expect(runtimeWithOldRecord.healthRecords.query).not.toHaveBeenCalled());
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it("일반 대화와 기록 입력에는 최근 건강기록 요약을 외부 AI로 보내지 않는다", async () => {
    const spySend = vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "general_chat",
      assistant_message: "안녕하세요.",
      missing_fields: [],
      needs_confirmation: false,
      suggested_quick_replies: [],
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/건강정보를 입력하거나/), { target: { value: "안녕" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await waitFor(() => {
      expect(spySend).toHaveBeenCalledWith(
        expect.any(Array),
        expect.objectContaining({ recent_records_summary: undefined }),
      );
    });
    expect(mockQueryRecords).not.toHaveBeenCalled();
  });

  it("누락 필드가 있거나 확인 준비가 되지 않은 초안에는 저장 카드를 표시하지 않는다", async () => {
    vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
      intent: "record_exercise",
      assistant_message: "몇 회 진행했는지 알려주세요.",
      exercise_draft: { exercise_name: "랫풀다운", weight_kg: 20 },
      missing_fields: ["reps"],
      needs_confirmation: false,
      suggested_quick_replies: [],
    });

    render(
      <HealthAssistantDrawer
        profile={mockProfile}
        runtime={mockRuntime}
        isOpen={true}
        onClose={mockOnClose}
        onRecordSaved={mockOnRecordSaved}
      />,
    );

    fireEvent.change(screen.getByPlaceholderText(/건강정보를 입력하거나/), { target: { value: "랫풀다운 20kg" } });
    fireEvent.click(screen.getByRole("button", { name: "전송" }));

    await screen.findByText("몇 회 진행했는지 알려주세요.");
    expect(screen.queryByRole("button", { name: "운동 기록에 저장하기" })).not.toBeInTheDocument();
    expect(mockCreateRecord).not.toHaveBeenCalled();
  });

  describe("검진 및 측정 수치 시계열 추출 (extractMetricsFromRecords)", () => {
    it("다양한 건강검진 및 측정 기록에서 시계열 수치를 정확히 추출한다", () => {
      const records: HealthRecord[] = [
        {
          id: "r1",
          householdId: "h1",
          profileId: "p1",
          recordType: "health_screening",
          recordedAt: "2019-12-28T09:00:00Z",
          version: 1,
          createdAt: "2019-12-28T09:00:00Z",
          updatedAt: "2019-12-28T09:00:00Z",
          deletedAt: null,
          source: "ocr",
          sourceDocumentId: null,
          payload: {
            screeningName: "2019년 건강검진",
            note: "혈압 113/74 mmHg, 공복혈당 85 mg/dL, AST 21, ALT 21, 총콜레스테롤 178",
          },
        },
        {
          id: "r2",
          householdId: "h1",
          profileId: "p1",
          recordType: "health_screening",
          recordedAt: "2022-05-30T09:00:00Z",
          version: 1,
          createdAt: "2022-05-30T09:00:00Z",
          updatedAt: "2022-05-30T09:00:00Z",
          deletedAt: null,
          source: "ocr",
          sourceDocumentId: null,
          payload: {
            screeningName: "2022년 건강검진",
            note: "혈압 120/80 mmHg, 당검사 식전 113, AST 41, ALT 48, 총콜레스테롤 248",
          },
        },
        {
          id: "r3",
          householdId: "h1",
          profileId: "p1",
          recordType: "blood_pressure",
          recordedAt: "2026-08-31T09:00:00Z",
          version: 1,
          createdAt: "2026-08-31T09:00:00Z",
          updatedAt: "2026-08-31T09:00:00Z",
          deletedAt: null,
          source: "local_ai",
          sourceDocumentId: null,
          payload: {
            type: "blood_pressure",
            systolicMmHg: 125,
            diastolicMmHg: 82,
          },
        },
      ];

      const series = extractMetricsFromRecords(records);
      expect(series.length).toBeGreaterThanOrEqual(4);

      // 혈압 시리즈 검증
      const bpSeries = series.find((s) => s.key === "bp");
      expect(bpSeries).toBeDefined();
      expect(bpSeries?.points).toHaveLength(3);
      expect(bpSeries?.points[0]).toEqual({ date: "2019-12-28", value: 113, secondaryValue: 74 });
      expect(bpSeries?.points[1]).toEqual({ date: "2022-05-30", value: 120, secondaryValue: 80 });
      expect(bpSeries?.points[2]).toEqual({ date: "2026-08-31", value: 125, secondaryValue: 82 });

      // 공복혈당 시리즈 검증
      const glucoseSeries = series.find((s) => s.key === "glucose");
      expect(glucoseSeries).toBeDefined();
      expect(glucoseSeries?.points).toHaveLength(2);
      expect(glucoseSeries?.points[0]).toEqual({ date: "2019-12-28", value: 85 });
      expect(glucoseSeries?.points[1]).toEqual({ date: "2022-05-30", value: 113 });

      // 간기능 시리즈 검증
      const liverSeries = series.find((s) => s.key === "liver");
      expect(liverSeries).toBeDefined();
      expect(liverSeries?.points[0]).toEqual({ date: "2019-12-28", value: 21, secondaryValue: 21 });
      expect(liverSeries?.points[1]).toEqual({ date: "2022-05-30", value: 41, secondaryValue: 48 });

      // 총콜레스테롤 시리즈 검증
      const cholSeries = series.find((s) => s.key === "chol");
      expect(cholSeries).toBeDefined();
      expect(cholSeries?.points[0]).toEqual({ date: "2019-12-28", value: 178 });
      expect(cholSeries?.points[1]).toEqual({ date: "2022-05-30", value: 248 });
    });
  });

  describe("HealthMetricsTrendCard 차트 렌더링", () => {
    it("트렌드 카드 탭 전환과 최신 수치 및 SVG 차트를 정상 렌더링한다", () => {
      const seriesList = [
        {
          key: "bp",
          name: "혈압 (수축기/이완기)",
          unit: "mmHg",
          color: "#10b981",
          secondaryColor: "#3b82f6",
          secondaryName: "이완기",
          normalRange: { max: 120, label: "정상 수축기: 120 이하" },
          points: [
            { date: "2019-12-28", value: 113, secondaryValue: 74 },
            { date: "2022-05-30", value: 120, secondaryValue: 80 },
          ],
        },
        {
          key: "glucose",
          name: "공복 혈당",
          unit: "mg/dL",
          color: "#8b5cf6",
          points: [
            { date: "2019-12-28", value: 85 },
            { date: "2022-05-30", value: 113 },
          ],
        },
      ];

      render(<HealthMetricsTrendCard seriesList={seriesList} />);

      expect(screen.getByText("수치 변화 그래프")).toBeInTheDocument();
      expect(screen.getByText("혈압 (수축기/이완기)")).toBeInTheDocument();
      expect(screen.getByText("120 / 80")).toBeInTheDocument();

      // 탭 전환: 혈당 탭 클릭
      const glucoseTab = screen.getByRole("button", { name: "공복" });
      fireEvent.click(glucoseTab);

      expect(screen.getByText("공복 혈당")).toBeInTheDocument();
      expect(screen.getAllByText("113").length).toBeGreaterThanOrEqual(1);
    });
  });

  describe("formatTargetDateTime 일시 포맷팅", () => {
    it("시각 정보가 있는 ISO 일시를 'M월 D일 H시 mm분' 형식으로 포맷팅한다", () => {
      // 2026-08-30T21:00:00 (KST 기준)
      const res = formatTargetDateTime("2026-08-30T21:00:00");
      expect(res).toContain("8월 30일");
      expect(res).toContain("21시 00분");
    });

    it("시각이 없거나 자정인 경우 'M월 D일'로 포맷팅한다", () => {
      const res = formatTargetDateTime("2022-05-30");
      expect(res).toBe("5월 30일");
    });
  });

  describe("운동 시간 및 수행 일시 기록", () => {
    it("운동 시간과 수행 일시가 포함된 운동 초안이 전달되면 정상적으로 확인 및 저장된다", async () => {
      vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
        intent: "record_exercise",
        assistant_message: "어제 저녁 9시에 하신 랫풀다운 운동 기록을 저장할까요?",
        exercise_draft: {
          exercise_name: "랫풀다운",
          duration_minutes: 40,
          weight_kg: 25,
          reps: 12,
          sets: 3,
          date_str: "2026-08-30T21:00",
        },
        missing_fields: [],
        needs_confirmation: true,
        suggested_quick_replies: [],
      });

      render(
        <HealthAssistantDrawer
          profile={mockProfile}
          runtime={mockRuntime}
          isOpen={true}
          onClose={mockOnClose}
          onRecordSaved={mockOnRecordSaved}
        />,
      );

      const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
      fireEvent.change(input, { target: { value: "어제 저녁 9시에 랫풀다운 25kg 12회 3세트 40분 동안 했어" } });
      fireEvent.click(screen.getByRole("button", { name: "전송" }));

      await waitFor(() => {
        expect(screen.getByText("운동 기록 확인")).toBeInTheDocument();
        expect(screen.getByDisplayValue("랫풀다운")).toBeInTheDocument();
        expect(screen.getByDisplayValue("40")).toBeInTheDocument();
        expect(screen.getByDisplayValue("25")).toBeInTheDocument();
        expect(screen.getByDisplayValue("2026-08-30T21:00")).toBeInTheDocument();
      });

      // 저장 버튼 클릭
      fireEvent.click(screen.getByRole("button", { name: "운동 기록에 저장하기" }));

      await waitFor(() => {
        expect(mockCreateRecord).toHaveBeenCalledWith(
          expect.objectContaining({
            recordType: "exercise",
            payload: expect.objectContaining({
              type: "exercise",
              exerciseName: "랫풀다운",
              durationMinutes: 40,
              weightKg: 25,
              reps: 12,
              sets: 3,
            }),
          }),
        );
        expect(mockOnRecordSaved).toHaveBeenCalled();
      });
    });

    it("야외 유산소 운동(러닝/자전거) 시 거리(km)와 시간이 정상적으로 확인 및 저장된다", async () => {
      vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
        intent: "record_exercise",
        assistant_message: "오늘 아침에 달린 5.5km 러닝 기록을 저장할까요?",
        exercise_draft: {
          exercise_name: "러닝",
          distance_km: 5.5,
          duration_minutes: 32,
          date_str: "2026-09-01T07:30",
        },
        missing_fields: [],
        needs_confirmation: true,
        suggested_quick_replies: [],
      });

      render(
        <HealthAssistantDrawer
          profile={mockProfile}
          runtime={mockRuntime}
          isOpen={true}
          onClose={mockOnClose}
          onRecordSaved={mockOnRecordSaved}
        />,
      );

      const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
      fireEvent.change(input, { target: { value: "오늘 아침 7시 30분에 한강에서 러닝 5.5km 32분 달렸어" } });
      fireEvent.click(screen.getByRole("button", { name: "전송" }));

      await waitFor(() => {
        expect(screen.getByText("운동 기록 확인")).toBeInTheDocument();
        expect(screen.getByDisplayValue("러닝")).toBeInTheDocument();
        expect(screen.getByDisplayValue("5.5")).toBeInTheDocument();
        expect(screen.getByDisplayValue("32")).toBeInTheDocument();
      });

      // 저장 버튼 클릭
      fireEvent.click(screen.getByRole("button", { name: "운동 기록에 저장하기" }));

      await waitFor(() => {
        expect(mockCreateRecord).toHaveBeenCalledWith(
          expect.objectContaining({
            recordType: "exercise",
            payload: expect.objectContaining({
              type: "exercise",
              exerciseName: "러닝",
              distanceKm: 5.5,
              durationMinutes: 32,
            }),
          }),
        );
        expect(mockOnRecordSaved).toHaveBeenCalled();
      });
    });
  });

  describe("검진 수치 변화 그래프 및 원본 서류 분리 노출", () => {
    it("'검진수치변화그래프' 질의 시 원본 사진 없이 수치 변화 그래프 카드만 단독 노출된다", async () => {
      const runtimeWithDoc = {
        healthRecords: {
          create: vi.fn(),
          query: vi.fn().mockResolvedValue({
            ok: true,
            value: [
              {
                id: "r-screening",
                profileId: "profile-1",
                recordType: "health_screening",
                recordedAt: "2026-08-28T09:00:00Z",
                source: "ocr",
                sourceDocumentId: "doc-123",
                payload: {
                  screeningName: "2026 건강검진",
                  note: "혈압 120/80 mmHg, 공복혈당 95 mg/dL",
                },
              },
            ],
          }),
        },
        documents: {
          readById: vi.fn().mockResolvedValue({
            ok: true,
            value: {
              file: new Blob(["fake-img"], { type: "image/jpeg" }),
              fileName: "검진서류.jpeg",
            },
          }),
          save: vi.fn(),
          list: vi.fn(),
        },
      } as unknown as LocalDomainRuntime;

      vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
        intent: "query_records",
        assistant_message: "등록된 건강검진 및 측정 기록의 시계열 수치 변화 그래프를 조회해 드립니다.",
        query_draft: {
          record_type: "trend",
          time_range: "all",
          keyword: "trend",
        },
        missing_fields: [],
        needs_confirmation: false,
        suggested_quick_replies: [],
      });

      render(
        <HealthAssistantDrawer
          profile={mockProfile}
          runtime={runtimeWithDoc}
          isOpen={true}
          onClose={mockOnClose}
          onRecordSaved={mockOnRecordSaved}
        />,
      );

      const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
      fireEvent.change(input, { target: { value: "검진수치변화그래프" } });
      fireEvent.click(screen.getByRole("button", { name: "전송" }));

      await waitFor(() => {
        // 수치 변화 그래프는 렌더링되어야 함
        expect(screen.getByText("수치 변화 그래프")).toBeInTheDocument();
        // 원본 서류 이미지 미리보기 컨테이너(.attached-docs-container)는 존재하지 않아야 함
        expect(screen.queryByText("원본 서류")).not.toBeInTheDocument();
        expect(screen.queryByAltText("원본 서류")).not.toBeInTheDocument();
      });
    });

    it("'최근 건강검진 결과 원본 보여줘' 질의 시 가장 최신 1건의 서류만 노출되고 하단 OCR 표는 숨겨진다", async () => {
      const runtimeWithMultipleDocs = {
        healthRecords: {
          create: vi.fn(),
          query: vi.fn().mockResolvedValue({
            ok: true,
            value: [
              {
                id: "r-2022",
                profileId: "profile-1",
                recordType: "health_screening",
                recordedAt: "2022-05-30T09:00:00Z",
                source: "ocr",
                sourceDocumentId: "doc-2022",
                payload: {
                  screeningName: "2022년 건강검진",
                  note: "혈압 110/70, 요검사 정상",
                },
              },
              {
                id: "r-2026",
                profileId: "profile-1",
                recordType: "health_screening",
                recordedAt: "2026-08-28T09:00:00Z",
                source: "ocr",
                sourceDocumentId: "doc-2026",
                payload: {
                  screeningName: "2026년 최신건강검진",
                  note: "혈압 120/80, 공복혈당 95",
                },
              },
            ],
          }),
        },
        documents: {
          readById: vi.fn().mockImplementation((id: string) => {
            return Promise.resolve({
              ok: true,
              value: {
                file: new Blob(["fake-img"], { type: "image/jpeg" }),
                fileName: id === "doc-2026" ? "2026검진.jpeg" : "2022검진.jpeg",
              },
            });
          }),
          save: vi.fn(),
          list: vi.fn(),
        },
      } as unknown as LocalDomainRuntime;

      vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
        intent: "query_records",
        assistant_message: "가장 최근에 등록된 2026년 8월 28일 건강검진 원본 서류입니다.",
        query_draft: {
          record_type: "health_screening",
          time_range: "recent",
          keyword: "원본",
        },
        missing_fields: [],
        needs_confirmation: false,
        suggested_quick_replies: [],
      });

      render(
        <HealthAssistantDrawer
          profile={mockProfile}
          runtime={runtimeWithMultipleDocs}
          isOpen={true}
          onClose={mockOnClose}
          onRecordSaved={mockOnRecordSaved}
        />,
      );

      const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
      fireEvent.change(input, { target: { value: "최근 건강검진 결과 원본 보여줘" } });
      fireEvent.click(screen.getByRole("button", { name: "전송" }));

      await waitFor(() => {
        // 최신 서류(2026검진.jpeg)는 노출되어야 함
        expect(screen.getByText("2026검진.jpeg")).toBeInTheDocument();
        // 과거 서류(2022검진.jpeg)는 첨부되지 않아야 함
        expect(screen.queryByText("2022검진.jpeg")).not.toBeInTheDocument();
        // 하단 OCR 텍스트 표("조회된 건강 기록")는 닫혀있어야 함
        expect(screen.queryByText(/조회된 건강 기록/)).not.toBeInTheDocument();
      });
    });

    it("'전체 검진 이력 조회' 질의 시 저장된 모든 검진 기록이 0건이 아니라 정상적으로 표에 렌더링된다", async () => {
      const mockScreeningRuntime = {
        healthRecords: {
          create: vi.fn(),
          query: vi.fn().mockResolvedValue({
            ok: true,
            value: [
              {
                id: "rec-scr-1",
                profileId: "profile-1",
                recordType: "health_screening",
                recordedAt: "2022-05-30T09:00:00Z",
                source: "ocr",
                payload: {
                  type: "health_screening",
                  screeningName: "2022년 종합검진",
                  summary: "혈압 정상, 간기능 양호",
                },
              },
              {
                id: "rec-scr-2",
                profileId: "profile-1",
                recordType: "health_screening",
                recordedAt: "2026-08-28T09:00:00Z",
                source: "ocr",
                payload: {
                  type: "health_screening",
                  screeningName: "2026년 일반건강검진",
                  summary: "혈압 120/80, 공복혈당 95",
                },
              },
            ],
          }),
        },
        documents: {
          readById: vi.fn(),
          save: vi.fn(),
          list: vi.fn(),
        },
      } as unknown as LocalDomainRuntime;

      vi.spyOn(clientModule, "sendHealthAssistantMessage").mockResolvedValueOnce({
        intent: "query_records",
        assistant_message: "등록된 모든 검진 이력을 조회해 드립니다. 아래에서 상세 내용을 확인해 보세요.",
        query_draft: {
          record_type: "health_screening",
          time_range: "all",
          keyword: "검진 이력",
        },
        missing_fields: [],
        needs_confirmation: false,
        suggested_quick_replies: ["최근 검진 원본 보기", "수치 변화 그래프", "혈압 기록하기"],
      });

      render(
        <HealthAssistantDrawer
          profile={mockProfile}
          runtime={mockScreeningRuntime}
          isOpen={true}
          onClose={mockOnClose}
          onRecordSaved={mockOnRecordSaved}
        />,
      );

      const input = screen.getByPlaceholderText(/건강정보를 입력하거나/);
      fireEvent.change(input, { target: { value: "전체 검진 이력 조회" } });
      fireEvent.click(screen.getByRole("button", { name: "전송" }));

      await waitFor(() => {
        expect(screen.getByText(/조회된 건강 기록/)).toBeInTheDocument();
        expect(screen.getByText(/2022년 종합검진/)).toBeInTheDocument();
        expect(screen.getByText(/2026년 일반건강검진/)).toBeInTheDocument();
      });
    });
  });
});
