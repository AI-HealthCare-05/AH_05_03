import { useEffect, useState } from "react";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi, afterEach } from "vitest";

import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { PRIMARY_HOUSEHOLD_ID, useLocalDomain } from "../../app/localDomainContext";
import { PainDiaryPage } from "./PainDiaryPage";

// 챗봇 API 모킹
vi.mock("../health-assistant/healthAssistantClient", () => ({
  sendHealthAssistantMessage: vi.fn().mockResolvedValue({
    message: "통증 일기를 정제했습니다.",
    pain_diary_tool: {
      tool_name: "format_pain_diary",
      date_str: "2026-09-06",
      body_area: "팔꿈치, 왼쪽 고관절",
      intensity: 6,
      sensation: "이물감, 지지력 저하",
      aggravating_factors: "웨이트 트레이닝 후",
      formatted_diary:
        "웨이트 트레이닝을 마친 후 팔꿈치에 통증이 발생함. 아울러 왼쪽 고관절에 이물감이 느껴지며, 보행 시 왼쪽 발바닥으로 바닥을 지지하는 근력이 다소 저하된 양상을 보임.",
    },
  }),
}));

describe("PainDiaryPage", () => {
  afterEach(() => {
    cleanup();
  });
  it("통증 다이어리 화면이 렌더링되고 우측 하단에 캘린더가 표시된다", async () => {
    render(
      <MemoryRouter initialEntries={["/pain-diary?date=2026-09-06"]}>
        <LocalDomainProvider databaseName={`ieobom-pain-diary-${crypto.randomUUID()}`}>
          <SeededPainDiaryPage />
        </LocalDomainProvider>
      </MemoryRouter>,
    );

    // 헤더 및 폼 렌더링 확인
    expect(await screen.findByRole("heading", { level: 1, name: /통증 다이어리/ })).toBeInTheDocument();
    expect(screen.getByLabelText("월별 통증 캘린더")).toBeInTheDocument();
    expect(await screen.findByPlaceholderText(/오른쪽 무릎/)).toBeInTheDocument();
  });

  it("캘린더 날짜를 클릭하면 해당 날짜로 폼이 전환되고 저장 및 수정이 가능하다", async () => {
    render(
      <MemoryRouter initialEntries={["/pain-diary?date=2026-09-06"]}>
        <LocalDomainProvider databaseName={`ieobom-pain-diary-${crypto.randomUUID()}`}>
          <SeededPainDiaryPage />
        </LocalDomainProvider>
      </MemoryRouter>,
    );

    // 프로필 및 기존 기록 로드 대기
    expect(await screen.findByRole("heading", { level: 1, name: /통증 다이어리/ })).toBeInTheDocument();
    expect(await screen.findByText("홍길동")).toBeInTheDocument();

    // 폼에 새 기록 입력
    const bodyInput = screen.getByPlaceholderText(/오른쪽 무릎/);
    fireEvent.change(bodyInput, { target: { value: "왼쪽 어깨 회전근개" } });

    const noteInput = screen.getByPlaceholderText(/통증의 증상이나 불편함을 자유롭게 적어보세요/);
    fireEvent.change(noteInput, { target: { value: "팔을 들어올릴 때 찌릿한 통증이 느껴짐." } });

    // 폼 제출
    const form = screen.getByLabelText("통증 다이어리 작성 및 수정").querySelector("form")!;
    fireEvent.submit(form);

    await waitFor(() => {
      expect(screen.getByText(/통증 다이어리.*(저장|수정)되었습니다/)).toBeInTheDocument();
    });
  });

  it("AI 맞춤법 및 문장 정제 버튼 클릭 시 format_pain_diary 결과를 폼에 반영한다", async () => {
    render(
      <MemoryRouter initialEntries={["/pain-diary?date=2026-09-06"]}>
        <LocalDomainProvider databaseName={`ieobom-pain-diary-${crypto.randomUUID()}`}>
          <SeededPainDiaryPage />
        </LocalDomainProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("heading", { level: 1, name: /통증 다이어리/ })).toBeInTheDocument();

    const noteInput = screen.getByPlaceholderText(/통증의 증상이나 불편함을 자유롭게 적어보세요/);
    fireEvent.change(noteInput, {
      target: { value: "웨이트한후에 팔꿈치가 아프다. 왼쪽 고관절에 이물감이 있고 왼쪽발 바닥을 딛는 힘이 약한 것 같아." },
    });

    // AI 맞춤법 및 문장 정제 버튼 클릭
    const refineBtn = screen.getByRole("button", { name: /AI 맞춤법 및 문장 정제/ });
    fireEvent.click(refineBtn);

    await waitFor(() => {
      expect(screen.getByText(/AI가 맞춤법을 교정하고 품질 좋은 구조적 문장으로 정제했습니다/)).toBeInTheDocument();
    });

    // 교정된 문장 확인
    expect(screen.getByDisplayValue(/웨이트 트레이닝을 마친 후 팔꿈치에 통증이 발생함/)).toBeInTheDocument();
    expect(screen.getByDisplayValue("팔꿈치, 왼쪽 고관절")).toBeInTheDocument();
  });

  it("노션 스타일 마크다운 서식 툴바가 렌더링된다", async () => {
    render(
      <MemoryRouter initialEntries={["/pain-diary?date=2026-09-06"]}>
        <LocalDomainProvider databaseName={`ieobom-pain-diary-${crypto.randomUUID()}`}>
          <SeededPainDiaryPage />
        </LocalDomainProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole("toolbar", { name: "텍스트 서식 도구" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "대제목" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "중제목" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "소제목" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "굵게" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "체크리스트" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "인용구" })).toBeInTheDocument();
  });

  it("3D 해부학 이벤트가 연결된 기록을 선택하면 해부학 연결 배지가 표시되고 해제 및 3D 모달 열기가 가능하다", async () => {
    render(
      <MemoryRouter initialEntries={["/pain-diary?date=2026-09-02"]}>
        <LocalDomainProvider databaseName={`ieobom-pain-diary-${crypto.randomUUID()}`}>
          <SeededPainDiaryPage />
        </LocalDomainProvider>
      </MemoryRouter>,
    );

    // 2026-09-02의 3D 해부학 이벤트 기록 확인
    const badge = await screen.findByText(/3D 해부학 연결/, {}, { timeout: 5000 });
    expect(badge).toBeInTheDocument();
    expect(screen.getAllByText("대흉근 (오른쪽)").length).toBeGreaterThanOrEqual(2);

    // 3D 해부학 연결 해제 테스트
    const clearBtn = screen.getByTitle("3D 해부학 연결 해제");
    fireEvent.click(clearBtn);
    expect(screen.queryByText(/3D 해부학 연결/)).not.toBeInTheDocument();

    // 3D 모델에서 선택 모달 열기 테스트
    const open3DBtn = screen.getByRole("button", { name: /3D 모델에서 선택/ });
    fireEvent.click(open3DBtn);
    expect(await screen.findByRole("heading", { level: 3, name: /3D 인체 모델에서 통증 부위 선택/ })).toBeInTheDocument();
  });
});

function SeededPainDiaryPage() {
  const { runtime, refreshProfiles } = useLocalDomain();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!runtime || ready) return;
    void (async () => {
      const profileResult = await runtime.profiles.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        displayName: "홍길동",
        relationship: "본인",
      });
      if (!profileResult.ok) throw new Error(profileResult.error.message);

      // 2026-09-01 에 기존 통증 기록 하나 추가
      await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profileResult.value.id,
        recordType: "pain",
        recordedAt: "2026-09-01T12:00:00.000Z",
        source: "manual",
        payload: {
          type: "pain",
          bodyArea: "허리 요추부",
          intensity: 5,
          sensation: "묵직함",
          note: "오래 앉아 있었더니 허리가 뻐근함.",
        },
      });

      // 2026-09-02 에 3D 해부학 이벤트가 연결된 통증 기록 추가
      await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profileResult.value.id,
        recordType: "pain",
        recordedAt: "2026-09-02T12:00:00.000Z",
        source: "manual",
        payload: {
          type: "pain",
          bodyArea: "대흉근 (오른쪽)",
          intensity: 4,
          sensation: "당김",
          note: "운동 후 뻐근함",
          anatomyEvent: {
            schemaVersion: "1.0.0",
            eventId: "ev-test-pec-1",
            atlas: { id: "vanatome-male-reference", version: "1.0", referenceSex: "male" },
            concept: {
              canonicalConceptId: "fma:pectoralis-major-r",
              sourceKey: "vanatome:1.0:pectoralis_major_r",
              sourceMeshId: "VH_M_pectoralis_major_r",
              label: "대흉근 (오른쪽)",
              system: "muscular",
              side: "right",
              mappingStatus: "canonical",
            },
            geometry: { coordinateSpace: "world", point: [0.1, 1.4, 0.2] },
            inputSource: "tap",
            state: "confirmed",
            recordedAt: "2026-09-02T12:00:00.000Z",
          },
        },
      });

      await refreshProfiles();
      setReady(true);
    })();
  }, [refreshProfiles, runtime, ready]);

  if (!ready) return <div className="route-loading">테스트 시딩 중…</div>;
  return <PainDiaryPage />;
}
