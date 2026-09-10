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
});
