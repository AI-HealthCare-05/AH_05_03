import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { FamilyProfile, HealthRecord } from "../../shared/local/domainContracts";
import { FamilyIntegratedMonitoring } from "./FamilyIntegratedMonitoring";

describe("FamilyIntegratedMonitoring (#122)", () => {
  const mockProfiles = [
    {
      id: "profile-self",
      householdId: "hh-1",
      displayName: "오성민",
      relationship: "본인",
      gender: "male" as const,
      status: "active" as const,
      version: 1,
    },
    {
      id: "profile-child",
      householdId: "hh-1",
      displayName: "오민재",
      relationship: "자녀",
      gender: "male" as const,
      status: "active" as const,
      version: 1,
    },
  ] as unknown as FamilyProfile[];

  it("1. 관찰·기록 뷰와 예측·분석 탭이 분리되어 탭 전환이 동작한다", () => {
    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[]}
      />,
    );

    const recordsTab = screen.getByRole("tab", { name: /기록 기반 상태/ });
    const predictionsTab = screen.getByRole("tab", { name: /예측·분석 뷰/ });

    expect(recordsTab).toHaveAttribute("aria-selected", "true");
    expect(predictionsTab).toHaveAttribute("aria-selected", "false");

    fireEvent.click(predictionsTab);
    expect(predictionsTab).toHaveAttribute("aria-selected", "true");
    expect(recordsTab).toHaveAttribute("aria-selected", "false");
  });

  it("2. 간암 진단 사례: 중요 진단 기록 연결 장기 배지와 출처(문서 근거)를 정확히 표시한다", () => {
    const liverRecord = {
      id: "rec-liver-1",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "health_screening" as const,
      recordedAt: "2026-09-10T10:00:00Z",
      source: "ocr" as const,
      payload: {
        note: "간기능 정밀 검사 결과 간암 소견 확인됨",
        observedAt: "2026-09-08T09:00:00Z", // 사후 입력
      },
      sourceDocumentId: "doc-liver-101",
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[liverRecord]}
      />,
    );

    // 출처 배지: 문서 근거 확인
    expect(screen.getByText("문서 근거 확인")).toBeInTheDocument();
    expect(screen.getByText("간암 진단 기록")).toBeInTheDocument();

    // 실제 관찰 시점(2026-09-08)과 시스템 입력 시점(2026-09-10) 분리 표시 확인
    expect(screen.getByText("2026-09-08")).toBeInTheDocument();
    expect(screen.getByText("2026-09-10")).toBeInTheDocument();
    expect(screen.getByText("(사후 입력 기록)")).toBeInTheDocument();

    // 장기 강조 문구: 손상률이나 응급도가 아님을 명시
    expect(screen.getByText(/손상률이나 현재 응급도를 뜻하지 않습니다/)).toBeInTheDocument();
  });

  it("3. '아버지가 간암' 등 가족력 문구는 본인의 장기에 연결되지 않고 가족력으로 구분된다", () => {
    const familyHistoryRecord = {
      id: "rec-fh-1",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "note" as const,
      recordedAt: "2026-09-10T10:00:00Z",
      source: "manual" as const,
      payload: {
        note: "아버지가 과거 간암 치료를 받으셨음",
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[familyHistoryRecord]}
      />,
    );

    // 가족력 배지 확인
    expect(screen.getByText("가족력")).toBeInTheDocument();
    expect(screen.getByText("가족력: 간암")).toBeInTheDocument();
    // 본인의 장기 손상률과는 무관함을 안내
    expect(screen.getByText(/본인의 장기 손상률과는 무관합니다/)).toBeInTheDocument();
  });

  it("4. 타임블록라인에서 기록이 없는 날은 정상/완치가 아닌 '기록 없음'으로 명시된다", () => {
    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[]}
      />,
    );

    // 범례에 기록 없음(정상 아님) 명시
    const emptyElements = screen.getAllByText(/기록 없음 \(정상 아님\)/);
    expect(emptyElements.length).toBeGreaterThan(0);
    expect(emptyElements[0]).toBeInTheDocument();
  });

  it("5. 건강 다이어리에 '폐로 암이 전이 되었다고 판정받음' 작성 시 폐(lung) 장기가 자동 추출되고 onSelectOrgan이 호출된다", () => {
    const lungMetastasisRecord = {
      id: "rec-pain-lung-1",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: "2026-09-10T14:00:00Z",
      source: "manual" as const,
      payload: {
        bodyArea: "가슴/폐",
        sensation: "숨쉴 때 결림",
        note: "폐로 암이 전이 되었다고 판정받음",
      },
      version: 1,
    } as unknown as HealthRecord;

    const onSelectOrgan = vi.fn();

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[lungMetastasisRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 폐 암/전이 판정 기록 제목과 중요 진단 알림 배지 렌더링 확인
    expect(screen.getByText("폐 암/전이 판정 기록")).toBeInTheDocument();
    expect(screen.getByText(/건강 다이어리에 기록된 중요 진단\(암\/전이\) 연결 장기입니다/)).toBeInTheDocument();

    // 3D 뷰어에 폐(lung) 장기 자동 통보 확인
    expect(onSelectOrgan).toHaveBeenCalledWith("lung", expect.stringContaining("폐"));
  });

  it("6. 타임라인 날짜 네비게이션으로 과거 7일로 이동할 수 있고 오늘 버튼으로 복귀한다", () => {
    const { container } = render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[]}
      />,
    );

    const prevBtn = container.querySelector(".timeline-nav-btn") as HTMLButtonElement;
    const navBtns = container.querySelectorAll(".timeline-nav-btn");
    const todayBtn = navBtns[1] as HTMLButtonElement;
    const nextBtn = navBtns[2] as HTMLButtonElement;

    // 초기 상태: 오늘은 비활성화된 다음 7일 (미래로 갈 수 없음)
    expect(nextBtn).toBeDisabled();

    // 과거 7일 이동
    fireEvent.click(prevBtn);
    expect(nextBtn).not.toBeDisabled();

    // 오늘로 복귀
    fireEvent.click(todayBtn);
    expect(nextBtn).toBeDisabled();
  });

  it("7. 특정 날짜 블록 클릭 시 시점이 동기화되며, 기록 없는 빈 날짜 클릭 시 빈 상태 안내와 함께 onSelectOrgan('', '')이 호출된다", () => {
    const onSelectOrgan = vi.fn();
    const todayStr = new Date().toISOString().slice(0, 10);

    const painRecord = {
      id: "rec-pain-today",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "어깨",
        sensation: "뻐근함",
        observedAt: `${todayStr}T10:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    const { container } = render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[painRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 오늘 날짜에 기록(1건)이 있는 블록 클릭
    const countBlocks = container.querySelectorAll(".block-count");
    expect(countBlocks.length).toBeGreaterThan(0);
    fireEvent.click(countBlocks[0]);

    // 해당 기록의 제목 노출
    expect(screen.getByText("통증: 어깨")).toBeInTheDocument();

    // 기록이 없는 빈 날짜(·) 클릭 시
    const emptyMarks = container.querySelectorAll(".block-empty-mark");
    expect(emptyMarks.length).toBeGreaterThan(0);
    fireEvent.click(emptyMarks[0]);

    // 관찰 기록 없음 빈 패널 렌더링 확인
    const emptyPanels = screen.getAllByText(/관찰 기록 없음/);
    expect(emptyPanels.length).toBeGreaterThan(0);

    // 3D 뷰어 중립 상태 초기화 호출 확인
    expect(onSelectOrgan).toHaveBeenCalledWith("", "");
  });

  it("8. 같은 날짜에 간암과 폐 전이 기록이 동시에 있을 때 3D 뷰어에 두 장기(liver,lung)가 동시에 전달되고 전체 동시 보기 칩이 활성화된다", () => {
    const onSelectOrgan = vi.fn();
    const todayStr = new Date().toISOString().slice(0, 10);

    const liverRecord = {
      id: "rec-liver-cancer",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "note" as const,
      recordedAt: `${todayStr}T09:00:00Z`,
      source: "manual" as const,
      payload: {
        note: "간암 진단 판정받음",
        observedAt: `${todayStr}T09:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    const lungRecord = {
      id: "rec-lung-metastasis",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T11:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "가슴",
        sensation: "호흡 시 통증",
        note: "폐로 암이 전이 되었다고 판정받음",
        observedAt: `${todayStr}T11:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[liverRecord, lungRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 기본 렌더링 시 두 장기 모두 추출되어 동시 전달 ("liver,lung" 또는 순서 무관하게 두 키 포함)
    const calls = onSelectOrgan.mock.calls;
    const multiCall = calls.find((c) => c[0].includes("liver") && c[0].includes("lung"));
    expect(multiCall).toBeDefined();

    // 상단에 전체 동시 보기 칩과 개별 칩 노출 확인
    expect(screen.getByText(/전체 위험 장기 동시 보기 \(간 \+ 폐\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /간암 진단 기록/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /폐 암\/전이 판정 기록/ })).toBeInTheDocument();

    // 동시 투시 모드 안내 문구 노출 확인
    expect(screen.getByText(/동시 투시 모드/)).toBeInTheDocument();

    // 폐 개별 칩 클릭 시 폐만 선택
    fireEvent.click(screen.getByRole("button", { name: /폐 암\/전이 판정 기록/ }));
    expect(onSelectOrgan).toHaveBeenLastCalledWith("lung", "폐 (폐 암/전이 판정)");

    // 다시 전체 보기 칩 클릭 시 둘 다 선택
    fireEvent.click(screen.getByText(/전체 위험 장기 동시 보기 \(간 \+ 폐\)/));
    const lastCall = onSelectOrgan.mock.calls[onSelectOrgan.mock.calls.length - 1];
    expect(lastCall[0]).toContain("liver");
    expect(lastCall[0]).toContain("lung");
  });

  it("9. 다이어리/메모에 '대장암 확진' 추가 시 대장(colon)이 자동으로 중요 진단 장기로 추출되어 onSelectOrgan으로 전달된다", () => {
    const onSelectOrgan = vi.fn();
    const todayStr = new Date().toISOString().slice(0, 10);

    const colonCancerRecord = {
      id: "rec-colon-cancer-diary",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T15:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "하복부",
        sensation: "간헐적 복통",
        note: "병원 진료 결과 대장암 확진 판정받음",
        observedAt: `${todayStr}T15:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[colonCancerRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 대장 장기 추출 확인
    expect(screen.getByText("대장 암/전이 판정 기록")).toBeInTheDocument();
    expect(screen.getByText("대장 (대장 암/전이 판정)")).toBeInTheDocument();

    // 3D 뷰어로 colon 키 전달 확인
    expect(onSelectOrgan).toHaveBeenCalledWith("colon", expect.stringContaining("대장"));
  });

  it("10. 손가락 저림·뒤꿈치 위약감 복합 증상 시 AI Agent가 추론한 anatomyEvent(경추 및 신경계 연관통)가 우선 채택되어 3D 뷰어에 cervical_spine,nervous 전달 및 AI 임상 추론 배지가 표시된다", () => {
    const onSelectOrgan = vi.fn();
    const todayStr = new Date().toISOString().slice(0, 10);

    const referredPainRecord = {
      id: "rec-referred-pain-ai",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T11:00:00Z`,
      source: "local_ai" as const,
      payload: {
        bodyArea: "왼쪽 손가락, 왼쪽 하지(발꿈치)",
        intensity: 5,
        sensation: "저림 및 악력 약화, 뒤꿈치 힘 빠짐",
        note: "왼쪽 손가락이 저리고 왼쪽 뒤꿈치에도 힘이 잘 안실리는 것 같아. 오른손에 비해서 악력도 약한듯?",
        observedAt: `${todayStr}T11:00:00Z`,
        suspectedAnatomyIds: ["cervical_spine", "nervous"],
        suspectedSystem: "nervous",
        clinicalReasoning:
          "상지 원위부 이상감각(손가락 저림)과 악력 저하 및 하지 위약감이 동반된 소견은 단순 말초 병변보다 경추 신경근 병증(Cervical Radiculopathy) 또는 척수증(Myelopathy) 연관통 가능성을 시사합니다.",
        anatomyEvent: {
          schemaVersion: "1.0.0",
          eventId: "ev-cervical-spine-ai-1",
          atlas: {
            id: "vanatome-human-atlas",
            version: "1.0",
            referenceSex: "female",
          },
          concept: {
            canonicalConceptId: "cervical_spine",
            sourceKey: "inferred:cervical_spine",
            sourceMeshId: "skeleton-cervical-vertebra",
            label: "경추 (C1~C7) 및 신경근",
            system: "nervous",
            side: "midline",
            mappingStatus: "canonical",
          },
          relatedConcepts: [
            {
              canonicalConceptId: "nervous",
              sourceKey: "inferred:nervous",
              sourceMeshId: "nervous-system",
              label: "신경계 및 척수근",
              system: "nervous",
              side: "midline",
              mappingStatus: "canonical",
            },
          ],
          inputSource: "ai_inference",
          state: "confirmed",
          provenance: "clinical_ai_inferred",
          clinicalReasoning:
            "상지 원위부 이상감각(손가락 저림)과 악력 저하 및 하지 위약감이 동반된 소견은 단순 말초 병변보다 경추 신경근 병증(Cervical Radiculopathy) 또는 척수증(Myelopathy) 연관통 가능성을 시사합니다.",
          recordedAt: `${todayStr}T11:00:00Z`,
        },
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[referredPainRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // AI 임상 추론 배지 및 연관통 추정 타이틀 노출 확인
    expect(screen.getByText("AI 임상 추론 (연관통)")).toBeInTheDocument();
    expect(screen.getByText(/연관통 추정: 경추 \(C1~C7\) 및 신경근/)).toBeInTheDocument();

    // 임상 추론 근거 텍스트 노출 확인
    expect(screen.getByText(/경추 신경근 병증\(Cervical Radiculopathy\) 또는 척수증/)).toBeInTheDocument();

    // 3D 뷰어에 cervical_spine,nervous 전달 확인
    expect(onSelectOrgan).toHaveBeenCalledWith(
      "cervical_spine,nervous",
      expect.stringContaining("경추 (C1~C7) 및 신경근"),
    );
  });
});


