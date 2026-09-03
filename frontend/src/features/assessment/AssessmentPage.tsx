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

import { useLocalDomain } from "../../app/localDomainContext";
import {
  ServerApiError,
  serverApiClient,
} from "../../shared/api/serverApiClient";
import type { AssessmentSummaryData, RiskLevel } from "./contracts";
import { LEVEL_ORDER } from "./contracts";
import { DocumentPane, type DocumentReading } from "./DocumentPane";
import { SuspectPanel } from "./SuspectPanel";
import { LevelBadge, MatrixCard, VerdictCard, VerdictDetail } from "./VerdictCards";
import {
  FIELD_GROUPS,
  FIELD_LABELS,
  LAB_FIELDS,
  REQUIRED_FIELDS,
  rejectedFields,
  toRequestBody,
} from "./fields";
import {
  buildLevelTracks,
  buildSeries,
  listSnapshots,
  saveSnapshot,
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

export function AssessmentPage() {
  const { runtime, profiles } = useLocalDomain();
  const location = useLocation();
  // **effect 가 아니라 초기값으로 받는다.** effect 에서 setState 를 부르면 연쇄 렌더가
  // 되고(`react-hooks/set-state-in-effect`), 사용자가 그 사이에 고친 값을 덮어쓴다.
  const [prefilled] = useState(() => prefillFrom(location.state));
  const [prefillSource] = useState(
    () => (location.state as { prefillSource?: "document" | "record" } | null)?.prefillSource,
  );
  const [values, setValues] = useState<Record<string, string>>(prefilled);
  // 가족 홈에서 "검진표로 판정" 으로 들어왔는지. 켜져 있으면 왼쪽에 문서 패널이 선다.
  const [withDocument] = useState(() =>
    Boolean(
      (location.state as { withDocument?: boolean } | null)?.withDocument,
    ),
  );
  // **어느 칸을 사람이 아니라 모델이 채웠는가.** 표시가 없으면 사용자는 자기가 적은
  // 값과 읽어 온 값을 구분하지 못해, 원본과 대조할 자리를 고를 수 없다.
  // 사용자가 그 칸을 고치는 순간 표시를 뗀다 — 그때부터는 사람이 쓴 값이다.
  const [readFields, setReadFields] = useState<Set<string>>(new Set());
  // 근거를 펼쳐 볼 질환. 한 번에 하나만 연다.
  const [openVerdict, setOpenVerdict] = useState<string>();
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

  const reloadSnapshots = useCallback(async () => {
    if (!runtime || !activeProfileId) return;
    setSnapshots(await listSnapshots(runtime, activeProfileId));
  }, [runtime, activeProfileId]);

  // 취소 깃발을 두는 이유가 둘이다. 하나, 프로필을 빠르게 바꾸면 먼저 띄운 조회가
  // 늦게 돌아와 **다른 사람의 스냅샷을 덮어쓸** 수 있다. 둘, 조기 반환에서 setState 를
  // 동기로 부르면 연쇄 렌더가 된다(`react-hooks/set-state-in-effect`).
  useEffect(() => {
    if (!runtime || !activeProfileId) {
      return;
    }
    let cancelled = false;
    void listSnapshots(runtime, activeProfileId).then((found) => {
      if (!cancelled) setSnapshots(found);
    });
    return () => {
      cancelled = true;
    };
  }, [runtime, activeProfileId]);

  // `keeping` 이 없으면 버튼을 두 번 누르면 **같은 시점이 두 벌 저장된다.** 몇 밀리초
  // 차이로 나란히 선 두 점은 그래프에서 뜻이 없고, 지우는 화면도 아직 없다.
  const keep = useCallback(async () => {
    if (!runtime || !activeProfileId || !result || keeping) return;
    setSaved(undefined);
    setKeeping(true);
    try {
      await saveSnapshot(
        runtime,
        activeProfileId,
        values,
        result,
        new Date().toISOString(),
        // 자동 저장과 같은 판정을 다른 출처로 적으면 안 된다. 나중에 "이 숫자는
        // 어디서 왔나" 를 되짚을 때 같은 판정이 두 출처로 남는다.
        readFields.size > 0 || withDocument ? "ocr" : "manual",
      );
      await reloadSnapshots();
      setSaved("이 시점을 기록에 남겼습니다. 기기 안에만 저장됩니다.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "기록 저장에 실패했습니다.",
      );
    } finally {
      setKeeping(false);
    }
  }, [runtime, activeProfileId, result, values, reloadSnapshots, keeping, readFields, withDocument]);

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
        if (runtime && activeProfileId) {
          try {
            await saveSnapshot(
              runtime,
              activeProfileId,
              values,
              data,
              new Date().toISOString(),
              // 검진표에서 한 칸이라도 읽어 왔으면 그 기록의 출처는 사람이 아니다.
              readFields.size > 0 || withDocument ? "ocr" : "manual",
            );
            await reloadSnapshots();
            setSaved("판정 결과와 수치를 이 기기의 기록에 남겼어요.");
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
        if (cause instanceof ServerApiError) {
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
    [values, missingRequired, runtime, activeProfileId, reloadSnapshots, readFields, withDocument],
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

  return (
    // **공용 셸을 같이 쓴다.** 이 화면만 `.product-page` 를 빠뜨려서 좌우 여백 없이
    // 뷰포트에 딱 붙어 있었다 — 헤더의 브랜드와 세로줄도 안 맞았다.
    // `.product-page` 가 `width: min(1240px, 100% - 48px)` 와 위아래 여백을 준다
    // (`AccountPage`·`DataManagementPage` 와 같은 방식).
    <section className="product-page assess-page">
      <header className="assess-intro">
        <h1>만성질환 위험 판정</h1>
        <p>
          필수 다섯 개만 채우면 판정이 나옵니다. 검진결과지 수치를 넣을수록
          답하는 칸이 늘고,{" "}
          <strong>
            넣은 값이 있는 질환은 추정이 아니라 학회 기준 대조로 넘어갑니다.
          </strong>
        </p>
      </header>

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

      <div
        className={
          withDocument ? "assess-workspace has-document" : "assess-workspace"
        }
      >
        {withDocument && activeProfile ? (
          <DocumentPane
            runtime={runtime}
            householdId={activeProfile.householdId}
            profileId={activeProfile.id}
            profileName={activeProfile.displayName}
            onRead={applyReading}
          />
        ) : null}

        <div className="assess-form-column">
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
            <ul>
              <li>
                <strong>
                  {result.summary.evaluated} / {result.summary.total}
                </strong>{" "}
                칸 판정 · 최고 등급{" "}
                <LevelBadge level={result.summary.highest_level} />
              </li>
              <li>
                엔진별 —{" "}
                {Object.entries(result.summary.by_engine)
                  .map(([engine, count]) => `${engine} ${count}칸`)
                  .join(" · ")}
              </li>
              <li>
                수치가 가리키는 질환{" "}
                <strong>{result.summary.matrix_evaluated}</strong> /{" "}
                {result.summary.matrix_total} 칸
              </li>
              <li>
                입력 {result.inputs_provided} / {result.inputs_total} · BMI{" "}
                {result.bmi}
              </li>
            </ul>
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
                  <p className="assess-muted">
                    입력값과 등급을 <strong>기기 안 암호화 보관함</strong>에만
                    저장합니다. 서버는 판정을 저장하지 않습니다.
                  </p>
                </>
              )}
              {saved && <p className="alert success-alert">{saved}</p>}
            </div>
          </header>

          <SuspectPanel suspects={result.top_suspects ?? []} />

          <h2 className="assess-axis-title">
            질환별 결과 <span className="assess-muted">지금 내 몸의 상태</span>
          </h2>
          <div className="assess-cards">
            {verdicts.map((verdict) => (
              <VerdictCard
                key={verdict.key}
                verdict={verdict}
                values={values}
                onOpen={() => setOpenVerdict(verdict.key)}
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
          <div className="assess-cards">
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
      {openVerdict
        ? (() => {
            const found = verdicts.find((v) => v.key === openVerdict);
            return found ? (
              <VerdictDetail verdict={found} values={values} onClose={() => setOpenVerdict(undefined)} />
            ) : null;
          })()
        : null}
    </section>
  );
}
