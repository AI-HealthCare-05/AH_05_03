import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FamilyProfile, HealthRecord } from "../../shared/local/domainContracts";
import { FamilyIntegratedMonitoring } from "./FamilyIntegratedMonitoring";

describe("FamilyIntegratedMonitoring (#122)", () => {
  afterEach(cleanup);

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

  const todayStr = new Date().toISOString().slice(0, 10);

  it("2. 간암 진단 사례: 중요 진단 기록 연결 장기 배지와 출처(문서 근거)를 정확히 표시한다", () => {
    const liverRecord = {
      id: "rec-liver-1",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "health_screening" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
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

    // 실제 관찰 시점(2026-09-08)과 시스템 입력 시점(todayStr) 분리 표시 확인
    expect(screen.getByText("2026-09-08")).toBeInTheDocument();
    expect(screen.getByText(todayStr)).toBeInTheDocument();
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
      recordedAt: `${todayStr}T10:00:00Z`,
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
      recordedAt: `${todayStr}T14:00:00Z`,
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

    // 폐 개별 칩 클릭 시: 전체 표시 부위 집합(liver, lung)은 동일하게 유지되고 상세 포커스(arg 4)만 lung으로 전달됨 (Astra 2차 요구사항 5)
    fireEvent.click(screen.getByRole("button", { name: /폐 암\/전이 판정 기록/ }));
    const focusedCall = onSelectOrgan.mock.calls[onSelectOrgan.mock.calls.length - 1];
    expect(focusedCall[0]).toContain("liver");
    expect(focusedCall[0]).toContain("lung");
    expect(focusedCall[4]).toBe("lung");

    // 다시 전체 보기 칩 클릭 시 둘 다 유지되고 상세 포커스는 초기화됨
    fireEvent.click(screen.getByText(/전체 위험 장기 동시 보기 \(간 \+ 폐\)/));
    const allCall = onSelectOrgan.mock.calls[onSelectOrgan.mock.calls.length - 1];
    expect(allCall[0]).toContain("liver");
    expect(allCall[0]).toContain("lung");
    expect(allCall[4]).toBeUndefined();
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
    expect(screen.getAllByText(/연관통 추정: 경추 \(C1~C7\) 및 신경근/).length).toBeGreaterThan(0);

    // 임상 추론 근거 텍스트 노출 확인
    expect(screen.getByText(/경추 신경근 병증\(Cervical Radiculopathy\) 또는 척수증/)).toBeInTheDocument();

    // 3D 뷰어에 cervical_spine,nervous 및 통증 강도(5) 전달 확인 (사용자 증상과 AI 추론 장기 모두 공존)
    const calls = onSelectOrgan.mock.calls;
    const aiCall = calls.find((c) => String(c[0]).includes("cervical_spine") && String(c[0]).includes("nervous"));
    expect(aiCall).toBeDefined();
    expect(aiCall![2]).toBe(5);
  });

  it("11. 같은 날짜에 서로 다른 통증 강도를 가진 복수 통증 기록(어깨 4점, 폐 10점)이 있을 때 각 칩에 통증 점수가 표시되고 동시 투시 모드 시 organIntensities 맵이 전달된다", () => {
    const onSelectOrgan = vi.fn();
    const shoulderPainRecord = {
      id: "rec-pain-shoulder",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "왼쪽 어깨",
        note: "왼쪽 어깨 뻐근함",
        intensity: 4,
      },
      version: 1,
    } as unknown as HealthRecord;

    const lungPainRecord = {
      id: "rec-pain-lung",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T11:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "폐",
        note: "호흡 시 극심한 흉통",
        intensity: 10,
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[shoulderPainRecord, lungPainRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 각 기록 칩에 점수 및 통증 강도 배지 노출 확인
    expect(screen.getByText("4점")).toBeInTheDocument();
    expect(screen.getByText("10점")).toBeInTheDocument();

    // 두 장기의 강도가 개별 매핑된 organIntensityMap 전달 확인
    expect(onSelectOrgan).toHaveBeenCalledWith(
      expect.stringContaining("shoulder"),
      expect.anything(),
      10, // maxIntensity
      expect.objectContaining({
        left_shoulder: 4,
        lung: 10,
      }),
    );
  });

  it("12. [Astra 반례 1] '손목 통증 없음' 입력 시 부정문이 fallback에 의해 hand/wrist 통증으로 부활하지 않아야 한다", () => {
    const onSelectOrgan = vi.fn();
    const negatedWristRecord = {
      id: "rec-pain-negated-wrist",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "손목",
        note: "손목 통증 없음",
        observedAt: `${todayStr}T10:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[negatedWristRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 3D 뷰어에 hand나 wrist 키가 전달되지 않아야 함 (부정된 부위의 활성 통증 키 부활 방지)
    const calls = onSelectOrgan.mock.calls;
    const hasHandOrWrist = calls.some((c) => String(c[0]).includes("hand") || String(c[0]).includes("wrist"));
    expect(hasHandOrWrist).toBe(false);
  });

  it("13. [Astra 반례 2] '간암 아님' 입력 시 암/전이 판정 기록으로 둔갑하지 않고 배제/음성 소견으로 분류되어야 한다", () => {
    const onSelectOrgan = vi.fn();
    const negatedCancerRecord = {
      id: "rec-negated-cancer",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "간",
        note: "간암 아님",
        observedAt: `${todayStr}T10:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[negatedCancerRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // '암/전이 판정 기록' 타이틀이 노출되지 않아야 함
    expect(screen.queryByText(/간 암\/전이 판정 기록/)).not.toBeInTheDocument();
    expect(screen.queryByText(/암\/전이 판정/)).not.toBeInTheDocument();
  });

  it("14. [Astra 반례 3] bodyArea와 note의 복수 필드 결합 시 좌우가 오염되지 않고 독립된 키만 추출되어야 한다", () => {
    const onSelectOrgan = vi.fn();
    const multiFieldRecord = {
      id: "rec-multi-field-side",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "왼쪽 어깨 통증",
        note: "오른쪽 무릎 통증",
        observedAt: `${todayStr}T10:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[multiFieldRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    const calls = onSelectOrgan.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastKeys = String(calls[calls.length - 1][0]).split(",").map((s) => s.trim());

    // left_shoulder와 right_knee는 반드시 포함
    expect(lastKeys).toContain("left_shoulder");
    expect(lastKeys).toContain("right_knee");

    // 필드 경계 오염으로 인한 무분별한 비측면성 키(단독 shoulder, 단독 knee)는 포함되지 않아야 함
    expect(lastKeys).not.toContain("shoulder");
    expect(lastKeys).not.toContain("knee");
  });

  it("15. [Astra 반례 4] AI 임상 추론 가설이 있더라도 사용자 원본 증상(Fact)과 AI 가설(Interpretation)이 동시에 보존되어야 한다", () => {
    const onSelectOrgan = vi.fn();
    const dualEventRecord = {
      id: "rec-dual-fact-ai",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "왼쪽 손가락",
        note: "왼쪽 손가락 저림",
        observedAt: `${todayStr}T10:00:00Z`,
        anatomyEvent: {
          concept: {
            side: "unknown",
            label: "신경계",
            canonicalConceptId: "nervous",
          },
          provenance: "clinical_ai_inferred",
          suspectedAnatomyIds: ["nervous"],
          clinicalReasoning: "상지 말단 저림으로 신경계 이상 의심",
        },
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[dualEventRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 1. AI 임상 추론 가설 이벤트 노출 확인
    expect(screen.getAllByText(/연관통 추정: 신경계/).length).toBeGreaterThan(0);

    // 2. 사용자가 실제 입력한 원본 증상(Fact) 이벤트도 묵살되지 않고 동시에 노출 확인
    expect(screen.getAllByText(/통증: 왼쪽 손가락/).length).toBeGreaterThan(0);

    // 3. [Astra 2차 요구사항 3] 두 이벤트의 3D 키와 출처(provenance) 분리 검증
    const calls = onSelectOrgan.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const dayKeys = String(calls[calls.length - 1][0]);
    expect(dayKeys).toContain("nervous");
    expect(dayKeys).toContain("left_hand");
    // AI 임상 추론 배지 확인
    expect(screen.getByText("AI 임상 추론 (연관통)")).toBeInTheDocument();
  });

  it("16. [Astra 2차 반례 1] '왼쪽 어깨 통증 / 오른쪽 어깨 통증 없음' 입력 시 우측 부정으로 인해 좌측 통증까지 삭제되지 않고 left_shoulder가 보존되어야 한다", () => {
    const onSelectOrgan = vi.fn();
    const unilateralRecord = {
      id: "rec-unilateral-negation",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "왼쪽 어깨 통증",
        note: "오른쪽 어깨 통증 없음",
        observedAt: `${todayStr}T10:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[unilateralRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 1. 왼쪽 어깨 통증 타이틀이 정상 노출되어야 함 ('이상/통증 없음 소견'으로 오분류되지 않아야 함)
    expect(screen.getAllByText(/통증: 왼쪽 어깨/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/왼쪽 어깨.*이상\/통증 없음/)).not.toBeInTheDocument();

    // 2. 3D 뷰어에 left_shoulder가 반드시 전달되어야 함 (오른쪽 부정 때문에 왼쪽까지 삭제 방지)
    const calls = onSelectOrgan.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCallKeys = String(calls[calls.length - 1][0]).split(",").map((s) => s.trim());
    expect(lastCallKeys).toContain("left_shoulder");
    expect(lastCallKeys).not.toContain("right_shoulder");
  });

  it("17. [Astra 2차 반례 2] '간암 확진, 전이 없음' 입력 시 전이 부정이 간암 진단 자체를 취소시키지 않고 간암 진단 기록으로 보존되어야 한다", () => {
    const onSelectOrgan = vi.fn();
    const cancerMetastasisRecord = {
      id: "rec-cancer-no-met",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "간",
        note: "간암 확진, 전이 없음",
        observedAt: `${todayStr}T10:00:00Z`,
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[cancerMetastasisRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // '간암 확진'이 있으므로 중요 암 진단 기록으로 올바르게 노출되어야 함 ('전이 없음'에 의해 암 진단이 지워져 단순 '통증: 간'으로 격하되지 않음)
    expect(screen.getAllByText(/간.*암.*기록|간암/).length).toBeGreaterThan(0);
    expect(screen.queryByText(/^통증: 간$/)).not.toBeInTheDocument();
  });

  it("18. [Astra 2차 반례 3] AI 가설이 있더라도 사용자 원본 증상의 3D 키(left_hand)와 출처(user_report)가 유지되어야 한다", () => {
    const onSelectOrgan = vi.fn();
    const dualDetailRecord = {
      id: "rec-dual-keys-provenance",
      householdId: "hh-1",
      profileId: "profile-self",
      recordType: "pain" as const,
      recordedAt: `${todayStr}T10:00:00Z`,
      source: "manual" as const,
      payload: {
        bodyArea: "왼쪽 손가락",
        note: "왼쪽 손가락 저림",
        observedAt: `${todayStr}T10:00:00Z`,
        anatomyEvent: {
          concept: {
            side: "unknown",
            label: "신경계",
            canonicalConceptId: "nervous",
          },
          provenance: "clinical_ai_inferred",
          suspectedAnatomyIds: ["nervous"],
          clinicalReasoning: "상지 말단 저림으로 신경계 이상 의심",
        },
      },
      version: 1,
    } as unknown as HealthRecord;

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[dualDetailRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    // 1. 3D 뷰어에 AI 추론 부위(nervous)와 사용자 원본 증상 부위(left_hand)가 모두 연결 가능해야 함
    const calls = onSelectOrgan.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const allArgs = calls.flatMap((c) => String(c[0]).split(",").map((s) => s.trim()));
    expect(allArgs).toContain("nervous");
    expect(allArgs).toContain("left_hand");

    // 2. 사용자 원본 증상 버튼과 AI 추론 버튼이 각각 분리 노출됨
    expect(screen.getByRole("button", { name: /통증: 왼쪽 손가락/ })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /연관통 추정: 신경계/ })).toBeInTheDocument();
  });

  it("19. [Astra 2차 요구사항 4] 통증 강도가 미상인 기록은 10점 fallback으로 왜곡되지 않고 undefined로 보존되어 0점/10점과 명확히 구분된다", () => {
    const onSelectOrgan = vi.fn();
    const unknownIntensityRecord = {
      id: "rec-unknown-intensity",
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

    render(
      <FamilyIntegratedMonitoring
        profiles={mockProfiles}
        selectedProfileId="profile-self"
        onSelectProfile={vi.fn()}
        records={[unknownIntensityRecord]}
        onSelectOrgan={onSelectOrgan}
      />,
    );

    const calls = onSelectOrgan.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const lastCall = calls[calls.length - 1];
    expect(lastCall[0]).toContain("shoulder");
    // 10점이나 0점으로 강제 치환되지 않고 undefined 유지
    expect(lastCall[2]).toBeUndefined();
    // organIntensityMap도 미상 강도를 10점으로 조작하지 않음
    expect(lastCall[3]).toBeUndefined();
  });
});


