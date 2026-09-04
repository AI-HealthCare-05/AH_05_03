/**
 * 판정 폼 왼쪽에 서는 검진표 패널 — 올리기·인식·원본 대조를 한 자리에서.
 *
 * 왜 폼 옆에 두는가
 * -----------------
 * 예전에는 `/data` 에서 올려 인식하고, 결과를 들고 `/assessment` 로 넘어와야 했다.
 * 사용자가 확인해야 하는 것은 **"이 숫자가 저 표의 그 줄과 같은가"** 인데 두 화면에
 * 나뉘어 있으면 대조 자체가 불가능하다 — 기억으로 맞추게 된다.
 *
 * 무엇을 넘기고 무엇을 안 넘기는가
 * --------------------------------
 * 서버(`app/services/ocr_measurements.py`)가 단위·참고치·값 범위 관문 셋을 통과시킨
 * `values` 만 폼으로 간다. 관문에 걸린 `review` 는 **여기 남겨 두고 원문 4열을 같이
 * 보여 준다.** 검사명 오독은 숫자만 보면 멀쩡해서, 원문을 붙여야 사용자가 잡아낸다.
 */

import { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import { GeminiOcrAdapter, type OcrMeasurementRow } from "../../shared/api/geminiOcrAdapter";
import type { LocalDocument } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { buildPreview, type DocumentPreview } from "./documentPreview";

const ZOOM_STEPS = [1, 1.5, 2, 3] as const;

export interface DocumentReading {
  /** 관문을 통과해 폼으로 갈 수치. */
  values: Record<string, number>;
  /** 걸러 낸 행. 폼에는 안 들어가고 사용자가 눈으로 확인한다. */
  review: OcrMeasurementRow[];
}

export function DocumentPane({
  runtime,
  householdId,
  profileId,
  profileName,
  onRead,
}: {
  runtime?: LocalDomainRuntime;
  householdId: string;
  profileId: string;
  profileName: string;
  onRead: (reading: DocumentReading) => void;
}) {
  const [document, setDocument] = useState<LocalDocument>();
  const [preview, setPreview] = useState<DocumentPreview>();
  const [reading, setReading] = useState<DocumentReading>();
  const [progress, setProgress] = useState<string>();
  const [error, setError] = useState<string>();
  const [zoom, setZoom] = useState<number>(1);

  // 미리보기를 갈아 끼울 때 이전 것의 `blob:` 을 반드시 놓아 준다. 안 놓으면 원본
  // 바이트가 탭이 닫힐 때까지 메모리에 남는다 — 검진표는 장당 수 MB 다.
  // 이 ref 의 주인은 `swapPreview` 하나다. effect 로 또 맞추면 둘이 어긋난다.
  const previewRef = useRef<DocumentPreview>(undefined);
  useEffect(() => () => previewRef.current?.release(), []);

  /**
   * 지금 살아 있는 선택. 검진표를 고르면 올라간다.
   *
   * 인식이 7~20 초라 그동안 다른 파일을 고를 수 있다. 표를 안 두면 **먼저 시작한
   * 인식이 늦게 끝나면서 나중에 고른 파일의 결과를 덮어쓴다** — 화면에는 두 번째
   * 검진표가 떠 있는데 폼에는 첫 번째 수치가 들어간다.
   */
  const runRef = useRef(0);

  const swapPreview = useCallback((next?: DocumentPreview) => {
    // `setPreview` 업데이터 안에서 놓아 주면 StrictMode 가 업데이터를 두 번 부를 때
    // 같은 것을 두 번 놓는다. 업데이터는 순수해야 하므로 여기서 처리한다.
    previewRef.current?.release();
    previewRef.current = next;
    setPreview(next);
  }, []);

  const take = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      // 같은 파일을 다시 고를 수 있어야 한다. 값을 비우지 않으면 두 번째 선택에서
      // `change` 가 아예 안 뜬다.
      event.currentTarget.value = "";
      if (!file || !runtime?.documents) return;

      const run = runRef.current + 1;
      runRef.current = run;
      const current = () => runRef.current === run;

      setError(undefined);
      setReading(undefined);
      setZoom(1);
      swapPreview(undefined);
      setDocument(undefined);

      try {
        // **미리보기를 먼저 띄운다.** 인식은 7~20초라, 그동안 화면이 비어 있으면
        // 사용자는 파일이 올라갔는지조차 알 수 없다.
        setProgress("검진표를 여는 중이에요…");
        const built = await buildPreview(file, file.type);
        // 그 사이 다른 파일을 골랐으면 방금 만든 것을 놓고 조용히 빠진다.
        if (!current()) return built.release();
        swapPreview(built);

        setProgress("이 브라우저에 암호화해 저장하는 중이에요…");
        const saved = await runtime.documents.save({
          householdId,
          profileId,
          file,
          fileName: file.name,
        });
        if (!current()) return;
        if (!saved.ok) throw new Error(saved.error.message);
        setDocument(saved.value);

        setProgress("검진표를 읽고 있어요… 7~20초쯤 걸려요");
        const result = await new GeminiOcrAdapter().recognize(file, file.name, {
          onProgress: ({ text }) => {
            if (text && current()) setProgress("표를 읽고 있어요…");
          },
        });
        if (!current()) return;
        const next: DocumentReading = {
          values: result.measurements?.values ?? {},
          review: result.measurements?.review ?? [],
        };
        setReading(next);
        onRead(next);
      } catch (caught) {
        // 밀려난 선택의 실패로 지금 화면을 어지럽히지 않는다.
        if (current()) setError(caught instanceof Error ? caught.message : "검진표를 읽지 못했어요.");
      } finally {
        if (current()) setProgress(undefined);
      }
    },
    [runtime, householdId, profileId, onRead, swapPreview],
  );

  const filled = reading ? Object.keys(reading.values).length : 0;

  return (
    <aside className="checkup-pane" aria-label="올린 검진표">
      <div className="checkup-pane-head">
        <div>
          <p className="section-kicker">검진표</p>
          <h2>{profileName}님의 검진결과지</h2>
        </div>
        {preview && preview.pages.length > 0 ? (
          <div className="checkup-zoom" role="group" aria-label="확대">
            {ZOOM_STEPS.map((step) => (
              <button
                key={step}
                type="button"
                className={step === zoom ? "is-active" : undefined}
                aria-pressed={step === zoom}
                onClick={() => setZoom(step)}
              >
                ×{step}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <label className="checkup-picker">
        <input type="file" accept="image/*,.pdf,application/pdf" onChange={(event) => void take(event)} />
        <span>{document ? "다른 검진표 고르기" : "검진표 이미지나 PDF 고르기"}</span>
      </label>

      <p className="checkup-privacy">
        원본은 이 브라우저에 암호화해 두고, 읽는 동안에만 서버를 거칩니다. 서버 데이터베이스에는 남지 않아요.
      </p>

      {progress ? (
        <p className="checkup-progress" role="status">
          {progress}
        </p>
      ) : null}
      {error ? (
        <p className="alert error-alert" role="alert">
          {error}
        </p>
      ) : null}

      {preview && preview.pages.length > 0 ? (
        <div className="checkup-viewer">
          {preview.pages.map((page, index) => (
            <img key={page} src={page} alt={`검진표 ${index + 1}쪽`} style={{ width: `${zoom * 100}%` }} />
          ))}
        </div>
      ) : null}

      {reading ? (
        <div className="checkup-reading">
          <p className={filled > 0 ? "checkup-filled" : "form-notice"}>
            {filled > 0
              ? `표에서 수치 ${filled}개를 읽어 오른쪽 폼에 채웠어요. 원본과 맞는지 확인하고 고쳐 주세요.`
              : "표에서 판정에 쓸 수치를 찾지 못했어요. 오른쪽 폼에 직접 넣어 주세요."}
          </p>

          {reading.review.length > 0 ? (
            <details className="checkup-review" open>
              <summary>확인이 필요한 {reading.review.length}개 — 폼에는 넣지 않았어요</summary>
              <p>검사명을 잘못 읽었을 수 있어서 뺐습니다. 원본의 해당 줄과 맞으면 오른쪽 폼에 직접 넣어 주세요.</p>
              <ul>
                {reading.review.map((row, index) => (
                  <li key={`${row.field}-${index}`}>
                    <span className="checkup-review-label">{row.label}</span>
                    <span className="checkup-review-value">
                      {Number.isFinite(row.value) ? row.value : "—"} {row.unit}
                    </span>
                    {row.reason ? <span className="checkup-review-reason">{row.reason}</span> : null}
                    {/* 원문 4열. 이게 있어야 사용자가 표의 어느 줄인지 짚을 수 있다. */}
                    {row.source.length > 0 ? <code>{row.source.join(" · ")}</code> : null}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
      ) : null}
    </aside>
  );
}
