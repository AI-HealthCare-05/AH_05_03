import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect } from "react";
import { cleanup, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { useLocalDomain } from "../../app/localDomainContext";
import { LocalDomainProvider } from "../../app/LocalDomainProvider";
import { HomePage } from "./HomePage";

afterEach(cleanup);

describe("HomePage", () => {
  it("로컬 프로필을 생성하고 제품 대시보드에 표시한다", async () => {
    const user = userEvent.setup();
    renderHomePage();

    expect(
      screen.getByRole("heading", { name: "가족의 건강 흐름을 한곳에서 이어보세요" }),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "첫 구성원 등록" }));

    await user.type(screen.getByRole("textbox", { name: "이름 또는 호칭" }), "나");
    await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), "본인");
    await user.click(screen.getByRole("button", { name: "프로필 저장" }));

    expect(await screen.findByRole("heading", { name: "나님의 건강기록" })).toBeInTheDocument();
    expect(screen.getByText("암호화 로컬 저장")).toBeInTheDocument();
    expect(await screen.findByRole("heading", { name: "나님의 3D 인체" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "머리" }));
    expect(screen.getByText("선택한 부위").parentElement).toHaveTextContent("머리");
  });

  it("가족 구성원 프로필 정보를 수정한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "나", "본인");

    await user.click(screen.getByRole("button", { name: "프로필 관리" }));
    const nameInput = screen.getByRole("textbox", { name: "이름 또는 호칭" });
    await user.clear(nameInput);
    await user.type(nameInput, "오성민");
    await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), "본인");
    await user.click(screen.getByRole("button", { name: "변경사항 저장" }));

    expect(await screen.findByRole("heading", { name: "오성민님의 건강기록" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("오성민");
  });

  it("구성원 추가 시 성별을 선택하면 멤버 카드에 성별이 표시된다", async () => {
    const user = userEvent.setup();
    renderHomePage();

    await user.click(await screen.findByRole("button", { name: "첫 구성원 등록" }));
    await user.type(screen.getByRole("textbox", { name: "이름 또는 호칭" }), "엄마");
    await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), "부모");
    await user.selectOptions(screen.getByRole("combobox", { name: /성별/ }), "여성");
    await user.click(screen.getByRole("button", { name: "프로필 저장" }));

    expect(await screen.findByRole("heading", { name: "엄마님의 건강기록" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("부모 · 여성");
  });

  it("프로필과 기록을 보존한 채 숨기고 가족 목록으로 복원한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "엄마", "부모");

    await user.click(screen.getByRole("button", { name: "프로필 관리" }));
    await user.click(screen.getByRole("button", { name: "목록에서 숨기기" }));
    await user.click(screen.getByRole("button", { name: "프로필 숨기기" }));

    expect(await screen.findByRole("button", { name: "첫 구성원 등록" })).toBeInTheDocument();
    expect(screen.queryByText("엄마")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "숨긴 프로필 1명" }));
    expect(screen.getByRole("dialog")).toHaveTextContent("건강기록은 삭제되지 않았습니다");
    await user.click(screen.getByRole("button", { name: "엄마 프로필 복원" }));

    expect(await screen.findByRole("heading", { name: "엄마님의 건강기록" })).toBeInTheDocument();
    expect(screen.getByRole("listitem")).toHaveTextContent("엄마");
    expect(screen.queryByRole("button", { name: "숨긴 프로필 1명" })).not.toBeInTheDocument();
  });

  it("건강기록이 연결된 프로필의 영구 삭제를 거부한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "아빠", "부모");

    await openRecordForm(user);
    await user.type(screen.getByRole("textbox", { name: "기록 내용" }), "정기 검진 메모");
    await user.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(await screen.findByText("1건")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "프로필 관리" }));
    await user.click(screen.getByRole("button", { name: "빈 프로필 영구 삭제" }));
    await user.click(screen.getByRole("button", { name: "영구 삭제" }));

    expect(await screen.findByRole("alert")).toHaveTextContent(
      "연결된 기록이 있는 프로필은 삭제할 수 없습니다",
    );
    expect(screen.getByRole("dialog")).toHaveTextContent("아빠 프로필을 이 브라우저에서 삭제합니다.");
  });

  it("건강기록을 수정하고 삭제 목록에서 복원한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "나", "본인");
    await openRecordForm(user);
    await user.type(screen.getByRole("textbox", { name: "기록 내용" }), "수정 전 기록");
    await user.click(screen.getByRole("button", { name: "기록 저장" }));
    expect(await screen.findByText("수정 전 기록")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "수정" }));
    const note = screen.getByRole("textbox", { name: "기록 내용" });
    await user.clear(note);
    await user.type(note, "수정 후 기록");
    await user.click(screen.getByRole("button", { name: "변경사항 저장" }));
    expect(await screen.findByText("수정 후 기록")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "삭제" }));
    await user.click(screen.getByRole("button", { name: "삭제 목록으로 이동" }));
    await user.click(await screen.findByRole("button", { name: "삭제된 기록 1건" }));
    await user.click(screen.getByRole("button", { name: "복원" }));
    expect(await screen.findByText("수정 후 기록")).toBeInTheDocument();
  });

  it("구성원별 가족력을 생성하고 수정한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "자녀", "자녀");
    await user.click(screen.getByRole("button", { name: /가족력 관리/ }));
    await user.click(screen.getByRole("button", { name: "가족력 추가" }));
    await user.type(screen.getByRole("textbox", { name: "친족 관계" }), "외할머니");
    await user.type(screen.getByRole("textbox", { name: "질환명" }), "고혈압");
    await user.click(screen.getByRole("button", { name: "가족력 추가" }));
    expect(await screen.findByText("고혈압")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "수정" }));
    const condition = screen.getByRole("textbox", { name: "질환명" });
    await user.clear(condition);
    await user.type(condition, "당뇨병");
    await user.click(screen.getByRole("button", { name: "변경사항 저장" }));
    expect(await screen.findByText("당뇨병")).toBeInTheDocument();
  });

  it("건강기록 작성은 직접 쓰기와 검진표 올리기 중에 먼저 고르게 한다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "엄마", "부모");

    // 같은 이름의 문이 둘이다(구성원 머리말·빠른 작업). 둘 다 갈림길로 간다.
    await user.click(screen.getAllByRole("button", { name: /건강기록 작성/ })[0]);

    // 갈림길이 먼저 뜬다 — 곧장 기록 폼이 열리지 않는다.
    expect(screen.getByRole("heading", { name: "엄마님의 기록을 어떻게 남길까요?" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: "기록 종류" })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /직접 작성/ }));
    expect(await screen.findByRole("combobox", { name: "기록 종류" })).toBeInTheDocument();
  });

  it("판정 기록은 메모가 아니라 등급과 수치로 보여 준다", async () => {
    const user = userEvent.setup();
    const domainRef = renderHomePage();
    await createProfile(user, "엄마", "부모");

    const profile = domainRef.current!.profiles[0];
    await domainRef.current!.runtime!.healthRecords.create({
      householdId: profile.householdId,
      profileId: profile.id,
      recordType: "assessment",
      recordedAt: new Date().toISOString(),
      source: "manual",
      payload: {
        inputs: { age: 54, sbp: 148, dbp: 92, fasting_glucose: 112 },
        levels: { htn: "HIGH", dm: "CAUTION", anemia: "NORMAL" },
        engines: { htn: "E1", dm: "E2", anemia: "E2" },
        bmi: 26.1,
        evaluated: 3,
        total: 13,
        highestLevel: "HIGH",
      },
    });
    // 보관함에 직접 넣었으므로 화면은 아직 모른다. 기록을 하나 저장하면
    // 대시보드가 다시 읽는다 — 그때 판정 줄도 같이 올라온다.
    await openRecordForm(user);
    await user.type(screen.getByRole("textbox", { name: "기록 내용" }), "메모 한 줄");
    await user.click(screen.getByRole("button", { name: "기록 저장" }));

    // 예전에는 여기가 "저장된 건강기록" 이었다 — 판정 payload 에 note 가 없어서다.
    expect(await screen.findByText("높음")).toBeInTheDocument();
    expect(screen.getByText(/3\/13개 판정 · 주의 2개/)).toBeInTheDocument();
    expect(screen.getByText(/수축기 혈압 148 mmHg/)).toBeInTheDocument();
    expect(screen.queryByText("저장된 건강기록")).not.toBeInTheDocument();

    // 자세히를 누르면 그날 넣은 값과 질환별 등급 전부. 카드 원본이 없는 옛 기록이라
    // 등급만 남아 있다고 밝힌다.
    await user.click(screen.getByRole("button", { name: "자세히" }));
    const modal = await screen.findByRole("dialog");
    expect(within(modal).getByText("고혈압")).toBeInTheDocument();
    expect(within(modal).getByText("당뇨병")).toBeInTheDocument();
    expect(within(modal).getByText(/그날 넣은 값 4개/)).toBeInTheDocument();
    expect(within(modal).getByText(/이 기록에는 등급만 남아 있어요/)).toBeInTheDocument();
    expect(within(modal).getByRole("button", { name: "이 수치로 다시 판정하기" })).toBeInTheDocument();
  });

  it("카드 원본이 남은 기록은 판정 화면과 같은 카드를 다시 그린다", async () => {
    const user = userEvent.setup();
    const domainRef = renderHomePage();
    await createProfile(user, "엄마", "부모");

    const profile = domainRef.current!.profiles[0];
    await domainRef.current!.runtime!.healthRecords.create({
      householdId: profile.householdId,
      profileId: profile.id,
      recordType: "assessment",
      recordedAt: new Date().toISOString(),
      source: "ocr",
      payload: {
        inputs: { age: 54, sbp: 148 },
        levels: { htn: "HIGH" },
        engines: { htn: "E1" },
        bmi: 26.1,
        evaluated: 1,
        total: 13,
        highestLevel: "HIGH",
        verdicts: [
          {
            key: "htn",
            name: "고혈압",
            engine: "E1",
            engine_label: "규칙 엔진 (국내 학회 임계값)",
            engine_reason: "측정값이 있어 규칙 엔진이 정본입니다.",
            risk_level: "HIGH",
            sub_status: "고혈압 1기",
            display_label: "혈압이 기준을 넘었어요.",
            reason: "수축기 혈압 148 mmHg",
            criteria_reference: "대한고혈압학회 진료지침",
            recommendation: "재측정 후에도 같으면 진료를 권합니다.",
            missing_fields: [],
            flags: [],
            superseded_by: "E1",
            disclaimer: "의료 진단이 아닙니다.",
            reference: { probability: 0.7998, peer_percentile: 88, peer_group: "50대 남성", accuracy: null },
          },
        ],
      },
    });
    await openRecordForm(user);
    await user.type(screen.getByRole("textbox", { name: "기록 내용" }), "메모");
    await user.click(screen.getByRole("button", { name: "기록 저장" }));

    await user.click(await screen.findByRole("button", { name: "자세히" }));
    const modal = await screen.findByRole("dialog");
    // 등급 이름만이 아니라 그날 본 카드가 그대로 선다.
    expect(within(modal).getByText("고혈압 1기")).toBeInTheDocument();
    expect(within(modal).queryByText(/이 기록에는 등급만 남아 있어요/)).not.toBeInTheDocument();

    // 카드의 근거를 열면 그날의 엔진 사유와 밀려난 ML 확률까지 남아 있다.
    await user.click(within(modal).getByRole("button", { name: /고혈압 판정 근거/ }));
    const detail = screen.getAllByRole("dialog").at(-1) as HTMLElement;
    expect(within(detail).getByText(/측정값이 있어 규칙 엔진이 정본입니다/)).toBeInTheDocument();
    expect(within(detail).getByText(/밀려난 ML 추정/)).toBeInTheDocument();
    expect(within(detail).getByText("80.0%")).toBeInTheDocument();
  });

  it("판정 기록이 없는 구성원 카드도 자리를 비우지 않는다", async () => {
    const user = userEvent.setup();
    renderHomePage();
    await createProfile(user, "엄마", "부모");

    expect(screen.getByRole("listitem")).toHaveTextContent("판정 기록 없음");
  });
});

/**
 * 보관함에 직접 넣어야 하는 기록이 있어 런타임을 밖으로 꺼낸다.
 *
 * 판정 스냅샷은 판정 화면에서만 만들어지므로 홈 화면 조작만으로는 못 만든다.
 * 화면을 거치지 않고 넣으려면 `useLocalDomain()` 을 provider 안에서 잡아야 한다.
 */
function Probe({ intoRef }: { intoRef: { current?: ReturnType<typeof useLocalDomain> } }) {
  const domain = useLocalDomain();
  // 렌더 중에 ref 를 쓰면 안 된다(`react-hooks/refs`). 테스트가 프로필을 만드는
  // UI 왕복을 거친 뒤에 읽으므로 effect 로 넣어도 늦지 않는다.
  useEffect(() => {
    intoRef.current = domain;
  }, [domain, intoRef]);
  return null;
}

function renderHomePage() {
  // 운영에서는 AppProviders 가 항상 QueryClientProvider 로 감싼다. 대시보드에
  // 서버 상태를 읽는 카드(ChallengeDashboardCard)가 붙으면서 이 하네스에도 필요해졌다.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } },
  });
  const domainRef: { current?: ReturnType<typeof useLocalDomain> } = {};
  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <LocalDomainProvider databaseName={`ieobom-home-test-${crypto.randomUUID()}`}>
          <Probe intoRef={domainRef} />
          <HomePage />
        </LocalDomainProvider>
      </MemoryRouter>
    </QueryClientProvider>,
  );
  return domainRef;
}

/** 기록 폼은 갈림길을 한 번 지나서 열린다. 갈림길 자체는 아래 전용 테스트가 본다. */
async function openRecordForm(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getAllByRole("button", { name: /건강기록 작성/ })[0]);
  await user.click(screen.getByRole("button", { name: /직접 작성/ }));
  await screen.findByRole("combobox", { name: "기록 종류" });
}

async function createProfile(
  user: ReturnType<typeof userEvent.setup>,
  displayName: string,
  relationship: string,
) {
  await user.click(await screen.findByRole("button", { name: "첫 구성원 등록" }));
  await user.type(screen.getByRole("textbox", { name: "이름 또는 호칭" }), displayName);
  await user.selectOptions(screen.getByRole("combobox", { name: "관계" }), relationship);
  await user.click(screen.getByRole("button", { name: "프로필 저장" }));
  await screen.findByRole("heading", { name: `${displayName}님의 건강기록` });
}
