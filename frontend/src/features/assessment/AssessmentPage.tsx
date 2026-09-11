/**
 * 판정 화면 — 수치 입력에서 질환별 결과까지 한 화면.
 *
 * 왜 이 화면이 필요했나
 * ---------------------
 * 서버는 질환 13칸 + 매트릭스 4칸을 근거까지 붙여 내보내는데 **받을 화면이 없었다.**
 * 모델 작업 전부가 사용자에게 도달하지 않는 상태였고, 문서 32번이 그것을 축 A 의
 * `output` 끊김으로 판정했다.
 *
 * 무엇을 그대로 보여주는가
 * ------------------------
 * 확률 하나만 크게 띄우지 않는다. 서버가 `engine` · `engine_reason` ·
 * `superseded_by` 를 실어 보내는 이유가 **"왜 이 답인가"를 화면이 설명할 수
 * 있어야** 하기 때문이다. 검사값을 넣으면 정본이 규칙 엔진으로 넘어가고 ML 확률은
 * 참고로 내려가는데, 그 사실이 화면에 보이지 않으면 사용자는 숫자가 왜 바뀌었는지
 * 알 수 없다.
 *
 * 두 축을 나란히 두는 이유는 재료가 겹쳐서다. 위쪽 열세 칸은 "여러 수치 → 이 장기의
 * 현재 상태", 아래쪽 매트릭스는 그 전치인 "수치 하나 → 여러 질환의 앞날"이다.
 * 합치면 같은 값을 두 번 세게 되고, **심혈관질환은 아래 축에만 있다.**
 */

import {
  type FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { useLocation } from "react-router-dom";

import { useAuth } from "../../app/authContext";
import { useLocalDomain } from "../../app/localDomainContext";
import {
  ServerApiError,
  serverApiClient,
} from "../../shared/api/serverApiClient";
import type { PrefilledField, RecordPrefillData } from "../../shared/api/contracts";
import { recordValues } from "../../shared/local/recordSummary";
import { RecordCard } from "../home/RecordCard";
import { RecordValueDetail } from "../health-data/ValueSheet";
import type { HealthRecord } from "../../shared/local/domainContracts";
import type { LocalDocument } from "../../shared/local/domainContracts";
import type { AssessmentSummaryData, RiskLevel } from "./contracts";
import { LEVEL_ORDER } from "./contracts";
import { DetailReport } from "./DetailReport";
import { DocumentPane, type DocumentReading } from "./DocumentPane";
import type { ModelSpec } from "./Evidence";
import { ASSESSMENT_PRESETS, type AssessmentPreset, presetValues } from "./presets";
import { SuspectPanel } from "./SuspectPanel";
import { briefList, objectParticle, sharedRefining } from "./precision";
import { LevelBadge, MatrixCard, VerdictCard } from "./VerdictCards";
import {
  calculateAgeFromBirthDate,
  FIELD_BY_NAME,
  FIELD_GROUPS,
  FIELD_LABELS,
  LAB_FIELDS,
  outOfRangeFields,
  profileGenderToSex,
  REQUIRED_FIELDS,
  rejectedFields,
  valuesFromInputs,
  toRequestBody,
} from "./fields";
import {
  buildLevelTracks,
  buildSeries,
  listSnapshots,
  saveSnapshot,
  saveTypedValues,
  TREND_WINDOW,
  type Snapshot,
} from "./snapshots";
import { TrendChart } from "./TrendChart";

function byLevel<T>(items: T[], level: (item: T) => RiskLevel): T[] {
  return [...items].sort(
    (a, b) => LEVEL_ORDER.indexOf(level(a)) - LEVEL_ORDER.indexOf(level(b)),
  );
}

/**
 * 문서 화면에서 넘어온 수치. `/data` 의 인식 결과 중 **관문을 통과한 것만** 온다
 * (`app/services/ocr_measurements.py`).
 *
 * 라우터 state 로 받는 이유는 이 값이 **한 번 쓰고 버리는 것**이기 때문이다.
 * 전역 스토어에 두면 새로고침 뒤에도 남아, 사용자가 지운 값이 되살아난다.
 */
/** 목록에 쓰는 짧은 날짜. 초는 안 쓴다 — 한 줄에 등급과 같이 들어가야 한다. */
function shortDateTime(iso: string): string {
  return new Date(iso).toLocaleString("ko-KR", {
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}


/**
 * 지난 판정 칩의 시각 라벨. **겹칠 때만 초를 붙인다.**
 *
 * 분 단위 라벨은 한 칸에 두 판정이 들어오면 완전히 같아진다 — 실측으로
 * `13:23:52` 와 `13:23:02` 가 둘 다 "9월 8일 오후 01:23" 이었고, 입력 칸 수와 BMI
 * 까지 같아서 어느 칩을 누르는지 알 수 없었다(2026-09-10). 판정은 폼을 조금 고쳐
 * 다시 돌리는 일이 흔해서 같은 분에 둘이 남는 것이 예외가 아니다.
 *
 * 그렇다고 전부 초를 붙이면 안 겹치는 칩까지 시끄러워진다. 겹치는 것만 늘린다.
 */
function disambiguatedTimes(isoList: string[]): string[] {
  const base = isoList.map(shortDateTime);
  const seen = new Map<string, number>();
  for (const label of base) seen.set(label, (seen.get(label) ?? 0) + 1);
  return base.map((label, index) => {
    if ((seen.get(label) ?? 0) < 2) return label;
    const seconds = new Date(isoList[index]).getSeconds();
    return `${label}:${String(seconds).padStart(2, "0")}`;
  });
}

function prefillFrom(state: unknown): Record<string, string> {
  const prefill = (
    state as { prefill?: Record<string, number | string | boolean> } | null
  )?.prefill;
  if (!prefill) return {};
  // **숫자만 받으면 안 된다.** 지난 기록으로 다시 판정할 때 `sex` 가 빠지면 필수
  // 다섯 중 하나가 비어서, 값이 다 있는데도 경고부터 보게 된다. 흡연·진단 이력도
  // 같이 온다. 폼은 전부 문자열로 들고 있으므로 그 모양으로 되돌린다
  // (`toRequestBody` 가 다시 원래 타입으로 바꾼다).
  return Object.fromEntries(
    Object.entries(prefill)
      .filter(([, value]) => value !== null && value !== undefined && value !== "")
      .filter(([, value]) => typeof value !== "number" || Number.isFinite(value))
      .map(([name, value]) => [name, String(value)]),
  );
}

/**
 * 고쳐야 할 칸으로 화면을 옮기고 커서를 놓는다.
 *
 * `focus()` 도 스스로 스크롤하지만 그 칸을 **뷰포트 가장자리에 겨우 걸치게** 둔다.
 * 위쪽 `legend`(“기본”·“혈압” …)가 같이 보여야 어느 그룹의 무슨 칸인지 아니까,
 * 스크롤은 `preventScroll` 로 막고 `block: "center"` 로 따로 옮긴다.
 */
function revealField(
  element: HTMLInputElement | HTMLSelectElement | null | undefined,
) {
  if (!element) return;
  element.focus({ preventScroll: true });
  const reduceMotion = window.matchMedia(
    "(prefers-reduced-motion: reduce)",
  ).matches;
  element.scrollIntoView({
    behavior: reduceMotion ? "auto" : "smooth",
    block: "center",
  });
}

/**
 * 401 인가. 세션이 풀렸다는 뜻이고, 그때 할 일은 오류를 띄우는 게 아니라
 * 로그인 관문으로 돌려보내는 것이다.
 *
 * 코드까지 같이 보는 이유: 갱신 토큰 쿠키가 없으면 `TOKEN_INVALID`, 접근 토큰만
 * 없으면 `AUTH_REQUIRED` 로 서로 다른 코드가 온다. 둘 다 사용자에게는 같은 상황이다.
 */
function isAuthError(cause: unknown): cause is ServerApiError {
  return cause instanceof ServerApiError && cause.status === 401;
}

export function AssessmentPage() {
  const { runtime, profiles } = useLocalDomain();
  const { markSignedOut } = useAuth();
  const location = useLocation();
  // **effect 가 아니라 초기값으로 받는다.** effect 에서 setState 를 부르면 연쇄 렌더가
  // 되고(`react-hooks/set-state-in-effect`), 사용자가 그 사이에 고친 값을 덮어쓴다.
  const [prefilled] = useState(() => prefillFrom(location.state));
  const [prefillSource] = useState(
    () => (location.state as { prefillSource?: "document" | "record" } | null)?.prefillSource,
  );
  const [values, setValues] = useState<Record<string, string>>(prefilled);
  /**
   * 검진표를 붙였는가. **화면을 가르는 것은 이제 진입 경로가 아니라 이 값이다.**
   *
   * 예전에는 가족 홈의 "검진표 올려서 판정" 이 넘겨준 `state.withDocument` 하나로
   * 갈렸다. 그래서 같은 `/assessment` 인데 내비로 들어오면 **검진표를 올릴 자리가
   * 아예 없었다** — 같은 주소가 두 화면이었고, 사용자는 왜 어떤 날은 업로드가
   * 보이고 어떤 날은 안 보이는지 알 수 없었다.
   *
   * 지금은 언제나 올릴 수 있다. 문서가 없으면 폼 위에 얇게 앉고, 붙으면 왼쪽으로
   * 펼쳐져 원본과 폼을 나란히 본다. 가족 홈에서 온 state 는 "그 의도로 들어왔다"
   * 는 표시로만 남아 저장 출처(`ocr`)를 가른다.
   */
  const [document, setDocument] = useState<LocalDocument>();
  /**
   * 보관함에 저장된 검진표를 **ref 로도** 들고 있는다.
   *
   * `DocumentPane` 은 문서를 먼저 저장하고 곧바로 인식을 시작한다. 인식이 끝나
   * `onRead` 가 불릴 때 `document` state 는 아직 이 렌더에 반영되지 않았을 수 있고,
   * 그러면 기록이 원본 고리를 잃은 채 저장된다 — 검진 이력에서 서류를 열 방법이 없다.
   */
  const documentRef = useRef<LocalDocument>(undefined);
  /** 방금 검진표에서 몇 칸을 기록으로 남겼는가. 화면이 그 사실을 말해야 한다. */
  const [screeningSaved, setScreeningSaved] = useState<number>();
  /**
   * 지금 폼에 든 값이 **어느 수치 기록에서 왔는가.**
   *
   * 판정을 저장할 때 이 고리를 같이 남긴다. 그러면 최근 기록 목록은 수치 기록만
   * 세우고 판정은 그 기록의 자세히에서 열린다 — 같은 일이 두 줄로 서지 않는다.
   * 손으로 채운 경우에는 비어 있고, 그때는 저장 직전에 수치 기록을 만들어 잇는다.
   */
  const [sourceRecordId, setSourceRecordId] = useState<string>();
  /**
   * 목록에 세울 **수치 기록**. 가족 홈과 같은 카드로 그리고, 눌러서 전체 수치를 본다.
   *
   * 예전에는 서버가 준 칸 목록(`recordPrefill.items`)을 평평하게 늘어놓았다. 값마다
   * 잰 날이 붙어 있어도 그것이 몇 건의 검진에서 온 것인지 읽히지 않았고, 원본을 열
   * 길도 없었다. 기록 자체를 들고 있으면 카드를 눌러 `RecordValueDetail` 로 전체
   * 수치와 원본을 보고, 그 자리에서 폼으로 옮길 수 있다.
   */
  const [valueRecords, setValueRecords] = useState<HealthRecord[]>([]);
  /** 카드를 눌러 펼쳐 본 기록. */
  const [openValueRecord, setOpenValueRecord] = useState<HealthRecord>();

  const rememberDocument = useCallback((next: LocalDocument | undefined) => {
    documentRef.current = next;
    setDocument(next);
  }, []);
  const cameForDocument = useMemo(
    () => Boolean((location.state as { withDocument?: boolean } | null)?.withDocument),
    [location.state],
  );
  const hasDocument = document !== undefined;
  // **어느 칸을 사람이 아니라 모델이 채웠는가.** 표시가 없으면 사용자는 자기가 적은
  // 값과 읽어 온 값을 구분하지 못해, 원본과 대조할 자리를 고를 수 없다.
  // 사용자가 그 칸을 고치는 순간 표시를 뗀다 — 그때부터는 사람이 쓴 값이다.
  const [readFields, setReadFields] = useState<Set<string>>(new Set());
  // 예측 근거 전체 리포트를 열었는가. 질환 하나가 아니라 열 장을 한 화면에 세운다.
  const [openDetail, setOpenDetail] = useState(false);
  /**
   * 적재된 모델의 입력 목록. 카드의 "모델이 쓰지 않은 입력" 을 계산하는 데 쓴다.
   *
   * **판정과 함께 부르지 않고 화면이 뜰 때 한 번 받는다.** 사용자 입력과 무관한
   * 배포 메타데이터라 판정마다 다시 물을 이유가 없고, 실패하면 그 블록만 빠진다.
   */
  const [models, setModels] = useState<ModelSpec[]>([]);
  // 어느 테스트 프로필로 채웠는가. 채운 뒤 손으로 고쳐도 표시는 남긴다 —
  // 결과를 보고 "이게 내가 넣은 값인가 프리셋인가" 를 되짚을 자리가 필요하다.
  const [preset, setPreset] = useState<string>();
  // 눌러 보기 전에는 아무 칸도 붉게 칠하지 않는다. 폼을 열자마자 다섯 칸이 빨가면
  // 아직 아무것도 안 했는데 뭘 틀린 것처럼 읽힌다.
  const [attempted, setAttempted] = useState(false);
  // 판정하기를 눌렀을 때 커서를 옮길 자리. 라벨이 아니라 실제 input·select 를 잡는다.
  const fieldRefs = useRef<
    Record<string, HTMLInputElement | HTMLSelectElement | null>
  >({});
  // 인식 결과를 부을 때 "지금 비어 있는 칸" 을 알아야 한다. 문서 패널의 콜백은
  // 렌더 밖에서 늦게 불려서, 닫힌 `values` 를 보면 옛 값을 본다.
  // 렌더 중에 ref 를 쓰면 안 된다(`react-hooks/refs`) — effect 로 맞춘다. 이 콜백은
  // 인식이 끝난 뒤(수 초 후) 불리므로 그때는 이미 최신값이 들어 있다.
  const valuesRef = useRef(values);
  useEffect(() => {
    valuesRef.current = values;
  }, [values]);
  const [result, setResult] = useState<AssessmentSummaryData>();
  const [error, setError] = useState<string>();
  // 서버가 되돌려준 칸. 값을 고치는 즉시 그 칸만 풀린다 — 다시 눌러 봐야
  // 빨간색이 사라지면 사용자는 자기가 고친 게 맞는지 알 수 없다.
  const [rejected, setRejected] = useState<Record<string, string>>({});
  const [working, setWorking] = useState(false);
  const [profileId, setProfileId] = useState<string>();
  const [snapshots, setSnapshots] = useState<Snapshot[]>([]);
  const [saved, setSaved] = useState<string>();
  const [keeping, setKeeping] = useState(false);

  // 프로필을 고르지 않았으면 첫 구성원으로 둔다. 대부분 본인 하나다.
  // 가족 홈에서 구성원을 골라 들어왔으면 그 사람이 먼저다.
  const activeProfileId =
    profileId ??
    (location.state as { profileId?: string } | null)?.profileId ??
    profiles[0]?.id;
  const activeProfile = profiles.find((item) => item.id === activeProfileId);

  useEffect(() => {
    let cancelled = false;
    void serverApiClient
      .modelInfo<{ models: ModelSpec[] }>()
      .then((data) => {
        if (!cancelled) setModels(data.models ?? []);
      })
      .catch(() => {
        // 없는 것을 없다고 말할 수 없을 뿐이다. 나머지 근거는 그대로 나간다.
        if (!cancelled) setModels([]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 구성원의 기본 정보(성별, 생년월일 기반 나이)가 있고 폼의 해당 칸이 비어 있으면 채워 준다.
  useEffect(() => {
    if (!activeProfile) return;
    setValues((prev) => {
      let changed = false;
      const next = { ...prev };
      if (!next.sex && activeProfile.gender) {
        const sex = profileGenderToSex(activeProfile.gender);
        if (sex) {
          next.sex = sex;
          changed = true;
        }
      }
      if (!next.age && activeProfile.birthDate) {
        const age = calculateAgeFromBirthDate(activeProfile.birthDate);
        if (age !== undefined && age >= 19 && age <= 100) {
          next.age = String(age);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [activeProfile]);

  const reloadSnapshots = useCallback(async () => {
    if (!runtime || !activeProfileId) return;
    setSnapshots(await listSnapshots(runtime, activeProfileId));
  }, [runtime, activeProfileId]);

  const reloadValueRecords = useCallback(async () => {
    if (!runtime || !activeProfileId) return;
    const found = await runtime.healthRecords.query({ profileId: activeProfileId });
    if (!found.ok) return;
    // 판정 스냅샷은 옆 줄("지난 판정에서")이 맡는다. 수치를 든 기록만 세운다.
    setValueRecords(
      found.value.filter((record) => record.recordType !== "assessment" && recordValues(record).length > 0),
    );
  }, [runtime, activeProfileId]);

  useEffect(() => {
    void reloadValueRecords();
  }, [reloadValueRecords, screeningSaved]);


  // 취소 깃발을 두는 이유가 둘이다. 하나, 프로필을 빠르게 바꾸면 먼저 띄운 조회가
  // 늦게 돌아와 **다른 사람의 스냅샷을 덮어쓸** 수 있다. 둘, 조기 반환에서 setState 를
  // 동기로 부르면 연쇄 렌더가 된다(`react-hooks/set-state-in-effect`).
  useEffect(() => {
    if (!runtime || !activeProfileId) {
      return;
    }
    let cancelled = false;
    // **삼키지 않는다.** 기기 안 암호화 보관함은 시크릿 모드·용량 초과·손상으로
    // 실패할 수 있는데, `.catch` 가 없으면 화면은 "기록이 아직 없다" 와 똑같이 보인다.
    // 사용자는 자기 기록이 사라진 줄 안다.
    void listSnapshots(runtime, activeProfileId)
      .then((found) => {
        if (!cancelled) setSnapshots(found);
      })
      .catch((caught: unknown) => {
        if (!cancelled) {
          setError(caught instanceof Error ? caught.message : "기기에 저장된 지난 판정을 불러오지 못했습니다.");
        }
      });
    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfileId]);

  // `keeping` 이 없으면 버튼을 두 번 누르면 **같은 시점이 두 벌 저장된다.** 몇 밀리초
  // 차이로 나란히 선 두 점은 그래프에서 뜻이 없고, 지우는 화면도 아직 없다.
  const keep = useCallback(async () => {
    if (!runtime || !activeProfileId || !result || keeping) return;
    // 자동 저장과 **같은 규칙**을 쓴다. 한쪽만 막으면 프리셋으로 판정한 뒤 이 버튼을
    // 누르는 길로 테스트 값이 그대로 들어온다 — 막으려던 것이 문을 하나 더 찾는다.
    if (preset) {
      setSaved("테스트 값이라 기록에 남기지 않아요. 내 수치로 남기려면 '테스트 값 비우기' 를 누르고 직접 채워 주세요.");
      return;
    }
    setSaved(undefined);
    setKeeping(true);
    try {
      const outcome = await saveSnapshot(
        runtime,
        activeProfileId,
        values,
        result,
        new Date().toISOString(),
        // 자동 저장과 같은 판정을 다른 출처로 적으면 안 된다. 나중에 "이 숫자는
        // 어디서 왔나" 를 되짚을 때 같은 판정이 두 출처로 남는다.
        readFields.size > 0 || hasDocument || cameForDocument ? "ocr" : "manual",
        document?.id,
      );
      await reloadSnapshots();
      setSaved(
        outcome.kind === "created"
          ? "이 시점을 기록에 남겼습니다."
          : outcome.kind === "changed"
            ? `같은 값인데 등급이 달라져 ${outcome.run}차로 남겼어요. 모델이나 기준이 갱신됐다는 뜻입니다.`
            : "바로 앞 기록과 값·등급이 같아 새로 남기지 않았어요. 수치를 고쳐 판정하면 새 시점이 됩니다.",
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "기록 저장에 실패했습니다.",
      );
    } finally {
      setKeeping(false);
    }
  }, [runtime, activeProfileId, result, values, reloadSnapshots, keeping, readFields, hasDocument, cameForDocument, document, preset]);

  // 최근 창만 그린다. 이유는 `TREND_WINDOW` 설명 참조 — 보관함에는 다 남아 있다.
  const recent = useMemo(() => snapshots.slice(-TREND_WINDOW), [snapshots]);
  const series = useMemo(() => buildSeries(recent), [recent]);
  const tracks = useMemo(() => buildLevelTracks(recent), [recent]);
  const diseaseNames = useMemo(
    () =>
      Object.fromEntries((result?.verdicts ?? []).map((v) => [v.key, v.name])),
    [result],
  );

  const missingRequired = useMemo(
    () => REQUIRED_FIELDS.filter((name) => !values[name]),
    [values],
  );
  const labsFilled = useMemo(
    () => LAB_FIELDS.filter((name) => values[name]).length,
    [values],
  );
  // 눌러 본 뒤에만 표시한다. 채우는 즉시 사라지고, 다시 비우면 다시 뜬다 —
  // 한 번 시도한 사용자에게는 그게 맞다.
  const flagged = attempted ? missingRequired : [];

  /**
   * 칸을 떠나는 순간 그 칸만 검사한다.
   *
   * **글자를 칠 때마다 하지 않는 이유.** `sbp` 의 하한은 60 인데, 120 을 넣으려면
   * "1" → "12" → "120" 을 지나간다. 앞의 둘은 범위 밖이라 치는 내내 빨간색이
   * 깜빡이고, 사용자는 자기가 뭘 잘못했는지 모른 채 경고를 본다. 다 치고 나가는
   * 순간이 "값을 넣었다"에 해당하는 시점이다.
   *
   * 판정 버튼을 누를 때 한 번 더 전체를 본다(`submit`). 여기는 일찍 알려 주는
   * 것이고, 거기는 놓친 칸이 없게 하는 것이다.
   */
  const checkField = useCallback((name: string, value: string) => {
    setRejected((prev) => {
      const hit = outOfRangeFields({ [name]: value })[name];
      if (hit === undefined) {
        if (!(name in prev)) return prev;
        const next = { ...prev };
        delete next[name];
        return next;
      }
      if (prev[name] === hit) return prev;
      return { ...prev, [name]: hit };
    });
  }, []);

  const setField = useCallback((name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }));
    // 고치는 즉시 그 칸의 빨간 표시를 푼다. 다시 제출해야 풀리면 사용자는
    // 자기가 고친 값이 이제 맞는지를 화면에서 확인할 방법이 없다.
    setRejected((prev) => {
      if (!(name in prev)) return prev;
      const next = { ...prev };
      delete next[name];
      return next;
    });
    // 사람이 손을 댄 순간 그 칸은 더 이상 "모델이 채운 값" 이 아니다.
    setReadFields((prev) => {
      if (!prev.has(name)) return prev;
      const next = new Set(prev);
      next.delete(name);
      return next;
    });
  }, []);

  /**
   * 검진표에서 읽어 온 수치를 폼에 붓는다.
   *
   * **이미 값이 있는 칸은 건드리지 않는다.** 사용자가 먼저 적어 둔 나이·키를 인식
   * 결과가 덮으면 고쳐 놓은 값이 소리 없이 사라진다.
   *
   * 어느 칸이 비어 있었는지는 `valuesRef` 로 본다. `setValues` 업데이터 안에서
   * 판단해 바깥 변수에 담으면 **StrictMode 가 업데이터를 두 번 부르면서** 표시가
   * 어긋난다 — 업데이터는 순수해야 한다.
   */
  const applyReading = useCallback((reading: DocumentReading) => {
    const current = valuesRef.current;
    const applied = Object.entries(reading.values).filter(
      ([name, value]) => Number.isFinite(value) && !current[name],
    );
    if (applied.length === 0) return;
    setValues((prev) => {
      const next = { ...prev };
      for (const [name, value] of applied) next[name] = String(value);
      return next;
    });
    setReadFields(new Set(applied.map(([name]) => name)));
  }, []);

  /**
   * 읽은 검진표를 **그 자리에서 건강검진 기록으로 남긴다.**
   *
   * 예전에는 판정 버튼을 눌러야 기록이 생겼다. 그래서 서류를 올려 수치를 확인만
   * 하고 화면을 떠나면 읽은 것이 전부 사라졌다 — 인식에 7~20초가 걸리는데 그 결과가
   * 아무 데도 안 남는다. 판정은 별개의 일이고, 서류를 올린 것은 그것만으로 기록이다.
   *
   * 판정 스냅샷과 **다른 기록**이다. 이쪽은 "그 검진표에 무엇이 적혀 있었나" 이고
   * 판정은 "그 값으로 오늘 무엇을 판정했나" 다. 하나로 합치면 판정을 지울 때 검진
   * 수치가 같이 사라진다.
   *
   * 실패해도 화면을 막지 않는다. 폼에는 값이 이미 들어갔고, 사용자가 지금 하려는
   * 일은 판정이다.
   */
  const saveScreening = useCallback(
    async (reading: DocumentReading, document?: LocalDocument) => {
      if (!runtime || !activeProfile) return;
      const values = Object.fromEntries(
        Object.entries(reading.values).filter(([, value]) => Number.isFinite(value)),
      );
      if (Object.keys(values).length === 0) return;
      try {
        const created = await runtime.healthRecords.create({
          householdId: activeProfile.householdId,
          profileId: activeProfile.id,
          recordType: "health_screening",
          recordedAt: new Date().toISOString(),
          source: "ocr",
          sourceDocumentId: document?.id,
          payload: {
            type: "health_screening",
            screeningName: "건강검진",
            // 판정이 바로 읽는 정본 모양. 화면·서버가 같은 칸 이름을 본다.
            values,
            // 관문을 못 넘어 폼에 안 들어간 행. 기록에는 남긴다 — 원본에 무엇이
            // 적혀 있었는지는 나중에 손으로 고칠 때 필요하다.
            review: reading.review,
            note: `검진표에서 ${Object.keys(values).length}개 수치를 읽었습니다.`,
          },
        });
        if (!created.ok) throw new Error(created.error.message);
        setScreeningSaved(Object.keys(values).length);
        setSourceRecordId(created.value.id);
      } catch (caught) {
        console.warn("검진 기록 저장 실패 (폼에는 값이 들어갔습니다):", caught);
      }
    },
    [runtime, activeProfile],
  );

  /** 문서를 읽으면 폼을 채우고 **동시에** 기록으로 남긴다. */
  const handleReading = useCallback(
    (reading: DocumentReading) => {
      applyReading(reading);
      void saveScreening(reading, documentRef.current);
    },
    [applyReading, saveScreening],
  );

  /**
   * 테스트 프로필로 폼을 채운다. **덮어쓴다** — 비어 있는 칸만 채우는 방식이면
   * 프로필을 바꿔 눌렀을 때 앞 프로필의 값이 남아 섞인 사람이 만들어진다.
   *
   * **채우고 채점은 하지 않는다.** 프로필을 고른 뒤 몇 칸을 손으로 고쳐 보는 것이
   * 이 기능의 쓸모인데, 자동으로 돌면 고치기 전 결과가 먼저 떠서 헷갈린다.
   * 예측 데모(`app/apis/demo_routers.py` 의 `applyProfile`)가 같은 이유로 그랬다.
   */
  /**
   * 테스트 값을 통째로 비운다. **프리셋 표시만 떼지 않는다.**
   *
   * 표시만 떼면 예시 수치가 "내가 넣은 값" 으로 둔갑해 기록에 들어간다 — 막으려던
   * 것이 이름만 바꿔 통과하는 셈이다. 폼을 비워 처음부터 채우게 하는 것이 유일하게
   * 안전한 탈출구다.
   */
  const clearPreset = useCallback(() => {
    setValues({});
    setPreset(undefined);
    setSourceRecordId(undefined);
    setReadFields(new Set());
    setResult(undefined);
    setError(undefined);
    setRejected({});
    setAttempted(false);
    setSaved(undefined);
  }, []);

  const applyPreset = useCallback((chosen: AssessmentPreset) => {
    setValues(presetValues(chosen));
    setPreset(chosen.key);
    setSourceRecordId(undefined);
    // 프리셋 값은 사람이 넣은 것도 문서에서 읽은 것도 아니다. 문서 표시를 지운다 —
    // 안 지우면 "검진표에서 읽음" 배지가 프리셋 값에 붙는다.
    setReadFields(new Set());
    setResult(undefined);
    setError(undefined);
    setRejected({});
    setAttempted(false);
  }, []);

  const submit = useCallback(
    async (event: FormEvent) => {
      event.preventDefault();
      setError(undefined);
      setRejected({});
      setAttempted(true);

      // **막지 않고 알려 준다.** 버튼을 비활성으로 두면 왜 못 누르는지 설명할 자리가
      // 화면에 없다 — 옆의 "필수 5개가 남았습니다" 는 *몇 개*만 말하고 *어느 칸*인지는
      // 끝내 말하지 않는다. 서른여섯 칸짜리 폼에서 그건 답이 아니다.
      // 눌러 보게 두고, 비어 있는 칸을 이름으로 세운 뒤 첫 칸으로 커서를 옮긴다.
      if (missingRequired.length > 0) {
        revealField(fieldRefs.current[missingRequired[0]]);
        return;
      }

      // **보내기 전에 범위를 본다.** 예전에는 서버의 422 만 믿었는데, 판정 API 는
      // 인증을 요구하므로 세션이 풀린 상태에서는 422 가 아니라 401 이 먼저 온다 —
      // 그러면 `rejectedFields` 가 아무 칸도 못 찾아 빨간 표시도 스크롤도 없이
      // 영문 오류 한 줄만 떴다. 사용자에게는 "틀린 값을 넣었는데 아무 반응이 없다".
      const badRange = outOfRangeFields(values);
      const badNames = Object.keys(badRange);
      if (badNames.length > 0) {
        setRejected(badRange);
        // 그룹 순서대로 위에 있는 칸부터 데려간다. `FIELD_GROUPS` 를 훑어 만든
        // 객체라 키 순서가 곧 화면 순서다.
        revealField(fieldRefs.current[badNames[0]]);
        return;
      }

      // 새로 판정했으면 지난 저장 안내를 지운다. 안 지우면 값을 바꿔 다시 판정한
      // 뒤에도 "기록에 남겼습니다"가 남아, 방금 것이 저장된 줄로 읽힌다.
      setSaved(undefined);
      setWorking(true);
      try {
        const data = await serverApiClient.assessSummary<AssessmentSummaryData>(
          toRequestBody(values),
        );
        setResult(data);
        // **판정과 기록을 한 번에 남긴다.** 나눠 두면 사용자가 판정만 보고 나가서
        // 추이 그래프가 영영 비어 있다 — 이 화면의 값은 검진표에서 온 것이라
        // 다시 모을 방법도 없다. 실패해도 판정 결과는 지키려고 따로 감싼다.
        // **테스트 값은 기록에 남기지 않는다.** 프리셋은 학회 기준 예시 수치라
        // 사용자의 실제 몸이 아니고, 그대로 남으면 추이 그래프와 "지난 판정으로
        // 채우기" 목록이 시연용 점으로 오염된다. 그러면 그 목록에서 자기 기록을
        // 골라내지 못하고, 그래프의 오르내림도 사실이 아니게 된다.
        //
        // 판정 자체는 그대로 보여 준다 — 프리셋의 쓸모가 "몇 칸을 고치면 무엇이
        // 움직이나" 를 보는 것이므로, 결과를 안 내면 기능이 사라진다.
        // 프리셋을 **먼저** 본다. 저장을 막는 이유는 런타임이 아니라 값의 출처이므로,
        // 런타임 조건 안에 넣으면 보관함이 없을 때 안내가 통째로 사라진다.
        if (preset) {
          setSaved("테스트 값이라 기록에 남기지 않았어요. 내 수치로 남기려면 아래 '테스트 값 비우기' 를 누르고 직접 채워 주세요.");
        } else if (runtime && activeProfileId) {
          try {
            // **판정에는 반드시 수치 기록이 딸린다.** 목록은 수치 기록만 세우므로,
            // 고리가 없으면 그 판정은 어디에서도 열 수 없다. 손으로 채운 값도
            // 검진표에서 읽은 값과 **같은 모양**(`payload.values`)으로 남긴다 —
            // 그래야 추이 그래프·판정 채우기·챗봇이 한 곳만 읽는다.
            const linked = sourceRecordId ?? (await saveTypedValues(runtime, activeProfileId, values));
            const outcome = await saveSnapshot(
              runtime,
              activeProfileId,
              values,
              data,
              new Date().toISOString(),
              // 검진표에서 한 칸이라도 읽어 왔으면 그 기록의 출처는 사람이 아니다.
              readFields.size > 0 || hasDocument || cameForDocument ? "ocr" : "manual",
              document?.id,
              linked,
            );
            await reloadSnapshots();
            await reloadValueRecords();
            setSaved(
              outcome.kind === "created"
                ? "판정 결과와 수치를 기록에 남겼어요."
                : outcome.kind === "changed"
                  ? `같은 값인데 등급이 달라져 ${outcome.run}차로 남겼어요.`
                  : "바로 앞 기록과 값·등급이 같아 새 기록을 만들지 않았어요.",
            );
          } catch {
            setSaved(undefined);
            setError(
              "판정은 끝났지만 기록으로 남기지 못했어요. 아래 결과에서 다시 저장할 수 있어요.",
            );
          }
        }
      } catch (cause) {
        // 422 는 어느 필드가 왜 틀렸는지를 메시지에 담아 온다. 통째로 "실패"라고
        // 쓰면 사용자가 고칠 수 없다. 칸을 집어내 빨갛게 세우고 커서를 옮긴다 —
        // 값이 검진표에서 자동으로 들어온 경우가 많아, 어느 칸인지 말해 주지 않으면
        // 사용자는 자기가 적지도 않은 값을 서른 몇 칸에서 찾아야 한다.
        // **인증 실패를 먼저 가른다.** 서버는 "Refresh Token 쿠키가 필요합니다"
        // 처럼 토큰 사정을 그대로 말하는데, 그 문장은 사용자가 할 일을 알려 주지
        // 않는다 — 화면에 그대로 떠 있었다. 세션이 풀린 것이므로 관문으로 돌린다.
        // `markSignedOut` 이 상태를 내리면 `RootLayout` 이 로그인 화면을 대신
        // 그리므로, 아래 메시지는 관문이 없는 화면에서만 보이는 안전망이다.
        if (isAuthError(cause)) {
          setRejected({});
          setError("로그인이 필요합니다. 로그인한 뒤 다시 판정해 주세요.");
          markSignedOut();
        } else if (cause instanceof ServerApiError) {
          const bad = rejectedFields(cause.message);
          const names = Object.keys(bad);
          if (names.length > 0) {
            setRejected(bad);
            setError(undefined);
            revealField(fieldRefs.current[names[0]]);
          } else {
            const detail = cause.details
              ? ` (${JSON.stringify(cause.details)})`
              : "";
            setError(`${cause.message}${detail}`);
          }
        } else {
          setError("판정 요청이 실패했습니다.");
        }
      } finally {
        setWorking(false);
      }
    },
    [
      values,
      missingRequired,
      runtime,
      activeProfileId,
      reloadSnapshots,
      readFields,
      hasDocument,
      cameForDocument,
      document,
      markSignedOut,
      preset,
      sourceRecordId,
      reloadValueRecords,
    ],
  );

  // 정렬을 렌더마다 하면 **입력창에 글자 하나 칠 때마다** 스무 장 넘는 카드를 다시
  // 세운다. 배열이 매번 새로 생겨 아래쪽 memo 도 전부 무효가 된다.
  const verdicts = useMemo(
    () => (result ? byLevel(result.verdicts, (v) => v.risk_level) : []),
    [result],
  );
  const matrix = useMemo(
    () =>
      result
        ? byLevel(Object.values(result.disease_risks), (r) => r.risk_level)
        : [],
    [result],
  );
  /**
   * 남긴 기록에서 만든 판정 입력. **매핑은 서버가 한다**(`record_prefill`).
   *
   * 값이 판정 폼에 들어오는 길이 사실상 검진표 OCR 하나였다 — 혈압·혈당·체성분·검사값을
   * 남겨도 여기서 같은 수치를 손으로 다시 쳐야 했다. 기록 종류가 열넷인데 판정으로
   * 가는 것은 판정 스냅샷뿐이었기 때문이다.
   */
  const [recordPrefill, setRecordPrefill] = useState<RecordPrefillData>();

  useEffect(() => {
    if (!activeProfileId) {
      setRecordPrefill(undefined);
      return;
    }
    let cancelled = false;
    void serverApiClient
      .prefillFromRecords(activeProfileId)
      // 실패해도 판정은 되어야 한다. 이 블록만 조용히 빠진다 —
      // 판정을 막으면 "기록으로 채우기" 를 만든 대가로 판정을 잃는다.
      .then((data) => {
        if (!cancelled) setRecordPrefill(data);
      })
      .catch(() => {
        if (!cancelled) setRecordPrefill(undefined);
      });
    return () => {
      cancelled = true;
    };
  }, [activeProfileId]);

  /** 기록 값을 폼에 붓는다. **비어 있는 칸만** 채운다 — 손으로 넣은 값을 덮지 않는다. */
  const applyRecordPrefill = useCallback((only?: PrefilledField[], overwrite = false) => {
    const items = only ?? recordPrefill?.items;
    if (!items || items.length === 0) return;
    // 카드 하나에서 가져왔으면 그 기록이 출처다. 여러 건을 섞어 가져오면 어느
    // 하나를 출처라 할 수 없으므로 비워 둔다(저장할 때 새로 만든다).
    const from = new Set(items.map((item) => item.record_id ?? ""));
    setSourceRecordId(from.size === 1 ? ([...from][0] || undefined) : undefined);
    setValues((prev) => {
      const next = { ...prev };
      for (const item of items) {
        // **골라서 가져온 것은 덮는다.** 카드를 눌러 "이 수치 사용하기" 를 누른 것은
        // 그 검진을 쓰겠다는 명시적인 선택이다. 비어 있는 칸만 채우면 프리셋이나
        // 앞서 친 값이 남아 있을 때 아무 일도 안 일어난 것처럼 보인다.
        if (!overwrite && next[item.field] !== undefined && next[item.field] !== "") continue;
        // **참·거짓 칸은 숫자로 담을 수 없다.** 폼은 `bool` 칸을 `"true"`/`"false"`
        // 문자열로 들고 있고(`toRequestBody` 가 `raw === "true"` 로 되돌린다),
        // 서버는 그 값을 1.0 으로 실어 보낸다. `"1"` 을 넣으면 select 에 없는 값이라
        // **아무 오류 없이 빈칸으로 남는다** — 실측으로 `is_fasting` 이 그랬다.
        const spec = FIELD_BY_NAME[item.field];
        next[item.field] = spec?.kind === "bool" ? (item.value ? "true" : "false") : String(item.value);
      }
      return next;
    });
    setResult(undefined);
    setSaved(undefined);
    setError(undefined);
    setRejected({});
    setAttempted(false);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [recordPrefill]);


  // 카드 여럿에 똑같이 걸린 정밀화 입력. 카드 위에서 한 번만 적고 카드에서는 뺀다.
  const sharedInputs = useMemo(
    () => sharedRefining(verdicts, values, models),
    [verdicts, values, models],
  );

  return (
    // **공용 셸을 같이 쓴다.** 이 화면만 `.product-page` 를 빠뜨려서 좌우 여백 없이
    // 뷰포트에 딱 붙어 있었다 — 헤더의 브랜드와 세로줄도 안 맞았다.
    // `.product-page` 가 `width: min(1240px, 100% - 48px)` 와 위아래 여백을 준다
    // (`AccountPage`·`DataManagementPage` 와 같은 방식).
    <section className="product-page assess-page">
      {/* **가족 홈·건강 데이터와 같은 머리말 틀이다**(`dashboard-heading` ·
          `page-kicker`). 예전에는 이 화면만 `<header className="assess-intro">`
          로 따로 놀아서 제목 글자 크기가 다른 화면 h1 의 2/3 정도였고, 위에
          붙는 작은 이름표(`page-kicker`)도 없었다 — 다른 화면과 나란히 두면
          "여기만 다른 앱" 처럼 보였다. */}
      <section className="dashboard-heading">
        <div>
          <p className="page-kicker">위험 판정</p>
          <h1>만성질환 위험 판정</h1>
          <p>
            기본 정보와 혈압·공복혈당을 채우면 판정이 나옵니다. 나머지 검진결과지
            수치를 넣을수록 답하는 칸이 늘고,{" "}
            <strong>
              넣은 값이 있는 질환은 추정이 아니라 학회 기준 대조로 넘어갑니다.
            </strong>
          </p>
        </div>
      </section>

      {Object.keys(prefilled).length > 0 && (
        <p className="form-notice assess-prefilled">
          {/* 어디서 온 값인지 밝힌다. 안 밝히면 "이건 내가 안 적었는데" 가 된다. */}
          {prefillSource === "record" ? (
            <>
              지난 기록의 값 <strong>{Object.keys(prefilled).length}개</strong>를 미리 채웠어요. 오늘 기준으로 다시
              판정하며, 지난 기록은 그대로 남습니다.
            </>
          ) : (
            <>
              건강자료에서 읽은 수치 <strong>{Object.keys(prefilled).length}개</strong>를 미리 채웠어요. 원본과 맞는지
              확인하고 판정하세요 — 확실하지 않은 항목은 넣지 않았습니다.
            </>
          )}
        </p>
      )}

      <div className={hasDocument ? "assess-workspace has-document" : "assess-workspace"}>
        {/* **언제 들어와도 올릴 수 있다.** 문서가 없으면 폼 위에 얇게 앉고, 붙으면
            왼쪽으로 펼쳐져 원본과 폼을 나란히 본다 — 화면을 가르는 것은 진입
            경로가 아니라 문서 유무다(위 `hasDocument` 머리말). */}
        {activeProfile ? (
          <DocumentPane
            runtime={runtime}
            householdId={activeProfile.householdId}
            profileId={activeProfile.id}
            profileName={activeProfile.displayName}
            onRead={handleReading}
            onDocument={rememberDocument}
          />
        ) : null}

        <div className="assess-form-column">
          {/* **지난 판정을 눌러 값을 되불러온다.**
              예전에는 가족 홈으로 돌아가 기록을 열고 "이 값으로 다시 판정" 을 눌러야
              여기로 왔다. 수치 하나만 바꿔 다시 돌려 보는 것이 이 화면에서 가장 자주
              하는 일인데, 그때마다 화면을 두 번 옮겨야 했다. */}
          {/* **채우는 문을 한 곳으로 모았다.**
              예전에는 "남긴 기록으로 채우기" 와 "지난 판정으로 채우기" 가 따로 서 있었다.
              각각 다른 때에 만들어져 모양도 달랐고(하나는 값 목록, 하나는 칩), 사용자
              입장에서는 **같은 일**을 하는 문이 둘이라 어느 쪽을 눌러야 하는지 알 수 없었다.

              둘의 차이는 남겨야 한다 — 뜻이 다르다.
                기록에서   혈압·혈당·검사값 기록을 **칸 단위로** 모은 것. 값마다 잰 날이 다르다.
                지난 판정   그날 폼에 넣었던 값 **한 벌**. 한 시점의 스냅샷이다.
              그래서 한 섹션 안에 두 줄로 두고, 각각이 무엇인지 한 문장으로 적는다. */}
          {/* **자동 저장은 말해 주지 않으면 안 된 것과 같다.** 검진표를 올리면 판정
              버튼을 누르기 전에 이미 기록이 남는데, 그 사실을 화면이 밝히지 않으면
              사용자는 판정을 눌러야 저장되는 줄 알고 같은 서류를 다시 올린다. */}
          {screeningSaved ? (
            <p className="assess-saved-note" role="status">
              검진표에서 읽은 <strong>{screeningSaved}개</strong> 수치를 건강기록으로 저장했어요. 판정하지 않고
              나가도 남아 있습니다.
            </p>
          ) : null}

          {(valueRecords.length > 0 || snapshots.length > 0) && (
            <section className="assess-fill" aria-labelledby="assess-fill-heading">
              <h3 id="assess-fill-heading">값을 불러와 채우기</h3>

              {valueRecords.length > 0 && (
                <div className="assess-fill-row">
                  <div className="assess-fill-copy">
                    <strong>남긴 건강검진에서</strong>
                    <small>
                      카드를 누르면 그 검진의 전체 수치와 원본을 볼 수 있어요. 확인한 뒤 "이 수치 사용하기" 를
                      누르면 폼으로 옮깁니다.
                    </small>
                  </div>
                  {/* **가족 홈과 같은 카드다**(`RecordCard`). 같은 기록을 화면마다 다른
                      모양으로 그리면 사용자가 같은 것을 두 번 배워야 한다. 예전에는
                      여기가 칸 이름과 숫자를 평평하게 늘어놓아서, 그 값들이 몇 건의
                      검진에서 온 것인지도 원본이 무엇인지도 읽히지 않았다. */}
                  <ul className="record-list">
                    {valueRecords.slice(0, 6).map((record) => (
                      <RecordCard
                        key={record.id}
                        record={record}
                        pressed={openValueRecord?.id === record.id}
                        onOpen={() => setOpenValueRecord(record)}
                      />
                    ))}
                  </ul>
                  {/* 칸마다 가장 최근 값을 한 번에 모으는 문. 여러 검진에 흩어져 있을
                      때 쓴다(서버 `record_prefill.build` 가 그렇게 고른다). */}
                  {recordPrefill && recordPrefill.items.length > 0 && valueRecords.length > 1 ? (
                    <button type="button" className="secondary-button" onClick={() => applyRecordPrefill()}>
                      최근 값 전부 가져오기 ({recordPrefill.items.length}칸)
                    </button>
                  ) : null}
                </div>
              )}

              {snapshots.length > 0 && (
                <div className="assess-fill-row">
                  <div className="assess-fill-copy">
                    <strong>지난 판정에서</strong>
                    <small>그날 넣은 값 한 벌이 그대로 들어와요. 고쳐 다시 판정하면 새 기록으로 남습니다.</small>
                  </div>
                  <ul className="assess-history-list">
                  {(() => {
                  // 라벨을 목록 단위로 먼저 만든다 — 초를 붙일지는 **다른 칩과 겹치는지**
                  // 로 정해지므로 칩 하나만 보고는 알 수 없다.
                  const shown = [...snapshots].reverse().slice(0, 8);
                  const labels = disambiguatedTimes(shown.map((item) => item.recordedAt));
                  return shown.map((snapshot, index) => {
                  const restored = valuesFromInputs(snapshot.payload.inputs ?? {});
                  const level = snapshot.payload.highestLevel as RiskLevel;
                  return (
                    <li key={snapshot.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setValues(restored);
                          // 앞의 결과를 지운다. 안 지우면 새로 채운 값 옆에 지난 판정이
                          // 남아 어느 쪽이 지금 것인지 알 수 없다.
                          setResult(undefined);
                          setError(undefined);
                          setRejected({});
                          setAttempted(false);
                          setSaved(undefined);
                          window.scrollTo({ top: 0, behavior: "smooth" });
                        }}
                      >
                        <time dateTime={snapshot.recordedAt}>{labels[index]}</time>
                        <LevelBadge level={level} />
                        <small>
                          입력 {Object.keys(restored).length}칸 · BMI {snapshot.payload.bmi}
                        </small>
                      </button>
                    </li>
                  );
                  });
                })()}
                  </ul>
                </div>
              )}

            </section>
          )}

          {/* **섹션 밖에 둔다.** 위 섹션은 채울 것이 있을 때만 서므로, 안에 두면
              "옮길 수치가 없다" 는 말이 영영 뜨지 않는다 — 실제로 그랬다.
              기록이 아예 없는 경우와 있어도 수치가 없는 경우는 다른 상황이고,
              후자는 "수치 기록을 남기면 여기가 채워진다" 를 말할 자리다. */}
          {recordPrefill && recordPrefill.items.length === 0 && recordPrefill.scanned > 0 && (
            <p className="assess-muted assess-records-empty">
              남긴 기록 {recordPrefill.scanned}건에는 판정에 쓸 수치가 없었어요. 혈압·혈당·체성분이나 검사
              결과를 기록으로 남기면 다음 판정에서 이 자리가 채워집니다.
            </p>
          )}


          {flagged.length > 0 && (
            <div
              className="alert error-alert assess-required-alert"
              role="alert"
            >
              <p>
                필수 항목 <strong>{flagged.length}개</strong>가 비어 있어요.
                채우면 바로 판정합니다.
              </p>
              <ul>
                {flagged.map((name) => (
                  <li key={name}>
                    {/* `type="button"` 이 없으면 폼 안의 button 은 submit 이 된다 — 누를 때마다 다시 제출된다. */}
                    <button
                      type="button"
                      onClick={() => revealField(fieldRefs.current[name])}
                    >
                      {FIELD_LABELS[name]}
                    </button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {Object.keys(rejected).length > 0 && (
            <div
              className="alert error-alert assess-required-alert"
              role="alert"
            >
              <p>
                값이 범위를 벗어난 칸이{" "}
                <strong>{Object.keys(rejected).length}개</strong> 있어요.
                검진표에서 읽어 온 값이면 원본과 다시 맞춰 보세요.
              </p>
              <ul>
                {Object.entries(rejected).map(([name, range]) => (
                  <li key={name}>
                    <button
                      type="button"
                      onClick={() => revealField(fieldRefs.current[name])}
                    >
                      {FIELD_LABELS[name]}
                    </button>{" "}
                    <span className="assess-muted">
                      {values[name]} → {range}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/*
        **`noValidate` 로 브라우저 검사를 끈다.** 안 끄면 필수 칸이 비었을 때 브라우저가
        `submit` 이벤트 자체를 막아 아래 `submit` 이 실행되지 않는다 — 대신 뜨는 기본
        말풍선은 문구를 못 바꾸고, 다른 칸을 건드리면 사라져 버린다.
        `required` 속성은 그대로 둔다. 검사에는 안 쓰이지만 보조기술에는 여전히 필요하다.
      */}
          {/* **테스트 프로필. 폼 맨 위, 기본 칸 위에 선다.**
              예측 데모(`/api/demo`)가 갖고 있던 것을 여기로 옮겼다 — 수치 34칸을 손으로
              채우지 않고도 "당뇨인 사람" 을 한 번에 넣어 볼 수 있다는 것이 그 화면의
              쓸모 절반이었고, 데모를 지우면서 그 절반을 데려왔다.

              **필수 다섯 칸이 어느 프로필에서나 채워진다**(`presets.test.ts` 가 고정).
              그래서 프리셋을 누르면 곧바로 판정할 수 있다. */}
          <section className="assess-presets" aria-labelledby="assess-presets-heading">
            <h3 id="assess-presets-heading">테스트로 돌려보기</h3>
            <p className="assess-group-note">
              학회 기준에 맞춘 예시 수치로 폼을 한 번에 채웁니다. 채운 뒤 몇 칸을 고쳐 보면 무엇이 판정을 움직이는지
              보입니다. <strong>채우기만 하고 판정은 하지 않습니다.</strong>
            </p>
            <div className="assess-preset-buttons">
              {ASSESSMENT_PRESETS.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={preset === item.key ? "assess-preset is-active" : "assess-preset"}
                  aria-pressed={preset === item.key}
                  onClick={() => applyPreset(item)}
                >
                  {item.label}
                </button>
              ))}
            </div>
            {preset && (
              <>
                <p className="assess-preset-note">
                  {ASSESSMENT_PRESETS.find((item) => item.key === preset)?.note}
                </p>
                {/* **판정은 되지만 기록에는 안 남는다는 것을 미리 말한다.** 판정을
                    돌린 뒤에야 알려 주면 사용자는 저장이 실패한 줄 안다. */}
                <p className="assess-preset-note is-warning">
                  <strong>이 값으로 판정해도 기록에는 남지 않아요.</strong> 학회 기준 예시 수치라 실제 몸의
                  기록이 아니기 때문입니다.
                </p>
                <button type="button" className="secondary-button" onClick={clearPreset}>
                  테스트 값 비우기
                </button>
              </>
            )}
          </section>

          <form className="assess-form" onSubmit={submit} noValidate>
            {FIELD_GROUPS.map((group) => (
              <fieldset key={group.key} className="assess-group">
                <legend>{group.title}</legend>
                {group.note && (
                  <p className="assess-group-note">{group.note}</p>
                )}
                <div className="assess-fields">
                  {group.fields.map((field) => {
                    const blank = flagged.includes(field.name);
                    const outOfRange = rejected[field.name];
                    const fromDocument = readFields.has(field.name);
                    // 콜백 ref 는 **반드시 값을 반환하지 않아야 한다.** React 19 는 반환값을
                    // 정리 함수로 보고, 함수가 아니면 오류를 낸다. 그래서 중괄호 본문이다.
                    const hold = (
                      node: HTMLInputElement | HTMLSelectElement | null,
                    ) => {
                      fieldRefs.current[field.name] = node;
                    };
                    return (
                      <label
                        key={field.name}
                        className={[
                          "assess-field",
                          blank ? "is-blank" : "",
                          outOfRange ? "is-rejected" : "",
                          fromDocument ? "is-from-document" : "",
                        ]
                          .filter(Boolean)
                          .join(" ")}
                      >
                        <span className="assess-field-label">
                          {field.label}
                          {field.required && <em aria-label="필수"> *</em>}
                          {field.unit && (
                            <span className="assess-unit"> {field.unit}</span>
                          )}
                          {/* 사람이 적은 값과 읽어 온 값을 가른다. 고치면 바로 사라진다. */}
                          {fromDocument && (
                            <span
                              className="assess-read-mark"
                              title="검진표에서 읽은 값"
                            >
                              검진표
                            </span>
                          )}
                        </span>
                        {field.kind === "number" && (
                          <input
                            ref={hold}
                            type="number"
                            inputMode="decimal"
                            min={field.min}
                            max={field.max}
                            step={field.step ?? 1}
                            value={values[field.name] ?? ""}
                            onChange={(event) =>
                              setField(field.name, event.target.value)
                            }
                            // 다 치고 칸을 떠날 때 그 칸만 검사한다. 치는 도중에는
                            // 하지 않는다 — 120 을 향해 가는 "1" 이 매번 빨개진다.
                            onBlur={(event) =>
                              checkField(field.name, event.target.value)
                            }
                            required={field.required}
                            aria-invalid={blank || Boolean(outOfRange) || undefined}
                            aria-describedby={
                              outOfRange ? `${field.name}-range` : undefined
                            }
                          />
                        )}
                        {field.kind === "select" && (
                          <select
                            ref={hold}
                            value={values[field.name] ?? ""}
                            onChange={(event) =>
                              setField(field.name, event.target.value)
                            }
                            required={field.required}
                            aria-invalid={blank || Boolean(outOfRange) || undefined}
                          >
                            <option value="">선택 안 함</option>
                            {field.options?.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        )}
                        {field.kind === "bool" && (
                          <select
                            ref={hold}
                            value={values[field.name] ?? ""}
                            onChange={(event) =>
                              setField(field.name, event.target.value)
                            }
                          >
                            <option value="">선택 안 함</option>
                            <option value="true">예</option>
                            <option value="false">아니오</option>
                          </select>
                        )}
                        {field.hint && (
                          <span className="assess-hint">{field.hint}</span>
                        )}
                        {/* 라벨 안에 두면 보조기술이 칸 이름과 함께 읽는다. 따로 `aria-describedby`
                        를 걸면 같은 말을 두 번 하게 된다. */}
                        {blank && (
                          <span className="assess-blank-hint">채워 주세요</span>
                        )}
                        {outOfRange && (
                          <span
                            className="assess-range-hint"
                            id={`${field.name}-range`}
                          >
                            {outOfRange}
                          </span>
                        )}
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            ))}

            <div className="assess-submit">
              {/* 필수가 비었다고 잠그지 않는다 — 눌러야 어디가 비었는지 알려 줄 수 있다. */}
              <button type="submit" disabled={working}>
                {working ? "판정 중…" : "판정하기"}
              </button>
              <p className="assess-muted">
                {missingRequired.length > 0
                  ? `필수 ${missingRequired.length}개가 남았습니다.`
                  : `검사값 ${labsFilled}개를 넣었습니다.`}
              </p>
            </div>
          </form>
        </div>
      </div>

      {error && (
        <p className="alert error-alert" role="alert">
          {error}
        </p>
      )}

      {result && (
        <section className="assess-result">
          <header className="assess-summary">
            <h2>판정 요약</h2>
            {/* **예측 근거 전체를 여는 한 곳.** 카드마다 있는 "판정 근거" 는 질환
                하나를 설명하는데, 열 장을 나란히 놓고 게이지·정확도·안 쓴 입력까지
                보려면 자리가 따로 있어야 한다. 예측 데모가 그 자리였다. */}
            <button type="button" className="secondary-button" onClick={() => setOpenDetail(true)}>
              예측 근거 자세히 보기
            </button>
            {!result.model_available && (
              <p className="alert error-alert">
                예측 모델이 적재되지 않아 규칙·공식으로만 판정했습니다.
              </p>
            )}

            <div className="assess-keep">
              {profiles.length === 0 ? (
                <p className="assess-muted">
                  변화 추이를 남기려면 먼저 <strong>가족 홈</strong>에서
                  구성원을 등록해 주세요. 판정은 지금도 보이지만 시점을 이을
                  자리가 없습니다.
                </p>
              ) : (
                <>
                  <label className="assess-field">
                    <span className="assess-field-label">누구의 기록으로</span>
                    <select
                      value={activeProfileId ?? ""}
                      onChange={(event) => setProfileId(event.target.value)}
                    >
                      {profiles.map((profile) => (
                        <option key={profile.id} value={profile.id}>
                          {profile.displayName}
                        </option>
                      ))}
                    </select>
                  </label>
                  {/* 판정할 때 이미 남긴다. 이 버튼은 그게 실패했거나 구성원을 바꿔
                      다시 남기고 싶을 때를 위한 것이라 문구도 "다시" 다. */}
                  <button type="button" onClick={keep} disabled={keeping}>
                    {keeping ? "저장 중…" : "이 구성원의 기록으로 다시 남기기"}
                  </button>
                  {/* "기기 안 암호화 보관함에 남기고 서버로 동기화" 였다. 앞 절이
                      옛 구조다 — 로그인 상태에서는 서버 런타임이 정본이고 보관함은
                      레거시 이전용으로만 열린다(`LocalDomainProvider`). 두 곳에
                      남는다고 적으면 사용자가 기기를 지우면 기록이 사라진다고 읽는다. */}
                  <p className="assess-muted">
                    입력값과 등급을 <strong>로그인한 계정</strong>에 남깁니다 (ADR-011).
                    같은 계정이면 다른 기기에서도 같은 기록을 봅니다.
                  </p>
                </>
              )}
              {saved && <p className="alert success-alert">{saved}</p>}
            </div>
          </header>

          <SuspectPanel suspects={result.top_suspects ?? []} verdicts={result.verdicts ?? []} />

          <h2 className="assess-axis-title">
            질환별 결과 <span className="assess-muted">지금 내 몸의 상태</span>
          </h2>
          {/* **여러 카드가 같은 값을 기다린다면 그 말은 한 번만 한다.**
              카드마다 적던 때 "앉아 있는 시간을 넣으면 예측이 정밀해져요" 가 한 화면에
              14번 나왔다(2026-09-10 실측). 같은 한 칸을 채우면 그 카드들이 동시에
              정밀해지니 정보는 하나뿐이고, 열네 번 반복되면 정보가 아니라 배경이 된다.
              세 장 이상에 걸린 것만 올린다 — `sharedRefining` 의 문턱 참조. */}
          {sharedInputs.length > 0 ? (
            <p className="assess-axis-note assess-shared-need">
              <strong>{briefList(sharedInputs)}</strong>
              {objectParticle(briefList(sharedInputs))} 채우면 여러 카드의 예측이 함께 정밀해져요.
            </p>
          ) : null}
          <div className="assess-cards">
            {verdicts.map((verdict) => (
              <VerdictCard
                key={verdict.key}
                verdict={verdict}
                values={values}
                models={models}
                sharedRefining={sharedInputs}
              />
            ))}
          </div>

          <h2 className="assess-axis-title">
            수치가 가리키는 앞날 <span className="assess-muted">이 값이 무엇을 예고하는가</span>
          </h2>
          <p className="assess-axis-note">
            위가 "지금 어떤가"라면 여기는 "이 값이 앞으로 무엇을 부르는가"입니다. 같은 질환이 양쪽에 나올 수
            있어요 — 예를 들어 γ-GTP 는 간 수치이면서 당뇨 발생도 예고합니다.
          </p>
          {/* **판정 카드와 다른 격자를 쓴다.** 이쪽은 넷뿐인데 신호 목록이 붙어
              카드가 훨씬 길다. 같은 격자에 두면 판정 카드용 최소 행 높이(15.5rem)와
              싸우고, 좁은 칸에 네 줄짜리 신호가 접혀 글 벽이 된다. */}
          <div className="assess-matrix-grid">
            {matrix.map((risk) => (
              <MatrixCard key={risk.category} risk={risk} />
            ))}
          </div>

          {snapshots.length > 0 && (
            <>
              <h2 className="assess-axis-title">
                추적 대시보드{" "}
                <span className="assess-muted">같은 사람 · 다른 시점</span>
              </h2>
              <p className="assess-axis-note">
                그래프의 확률은{" "}
                <strong>
                  발병 가능성이 아니라 "지금 재면 기준을 넘을 가능성"
                </strong>
                입니다. 그래서 여기서는 확률선을 그리지 않고{" "}
                <strong>입력한 수치 자체</strong>와 <strong>등급의 변화</strong>
                를 겹칩니다. 등급은 그날 계산한 값을 그대로 남긴 것입니다 —
                나중에 재채점하면 그날 본 화면과 달라집니다.
              </p>
              <TrendChart
                series={series}
                tracks={tracks}
                names={diseaseNames}
                dates={recent.map((s) => s.recordedAt)}
                total={snapshots.length}
              />
            </>
          )}

          <footer className="assess-disclaimers">
            {result.disclaimers.map((line) => (
              <p key={line}>{line}</p>
            ))}
          </footer>
        </section>
      )}

      {/* 근거 모달. `verdicts` 에서 다시 찾는 이유는 재판정하면 같은 키의 내용이
          바뀌기 때문이다 — 열어 둔 채 판정하면 옛 값이 남는다. */}

      {/* 같은 이유로 결과가 없으면 닫는다. `result` 를 캡처해 두면 다시 판정한 뒤에도
          옛 리포트가 열린 채 남는다. */}
      {openDetail && result ? (
        <DetailReport result={result} values={values} models={models} onClose={() => setOpenDetail(false)} />
      ) : null}

      {/* **카드를 눌러 펼친 모습.** 기록 화면의 자세히와 **같은 컴포넌트**다 —
          같은 기록을 여기서만 다르게 보여 줄 이유가 없다. 확인한 뒤 "이 수치
          사용하기" 를 누르면 폼으로 옮기고, 그 기록이 이 판정의 출처가 된다. */}
      {openValueRecord ? (
        <RecordValueDetail
          record={openValueRecord}
          onClose={() => setOpenValueRecord(undefined)}
          onUse={(picked) => {
            const items: PrefilledField[] = Object.entries(picked).map(([field, value]) => ({
              field,
              value,
              measured_at: openValueRecord.recordedAt,
              record_type: openValueRecord.recordType,
              record_id: openValueRecord.id,
            }));
            applyRecordPrefill(items, true);
            setSourceRecordId(openValueRecord.id);
            // 예시 수치 위에 실제 수치를 올렸으면 프리셋 표시를 떼야 한다 — 안 떼면
            // 기록에 남기지 않는 쪽으로 걸러진다.
            setPreset(undefined);
            setReadFields(new Set());
            setOpenValueRecord(undefined);
          }}
        />
      ) : null}
    </section>
  );
}

