/**
 * 판정에 사용할 검진표를 고르고 OCR 결과를 확인하는 compact 입력 패널.
 *
 * 원본은 작은 썸네일로만 보여 주고, 명시적으로 요청할 때 모달에서 연다.
 * 인식된 수치는 같은 판정 화면의 직접 입력 패널에서 확인한다.
 *
 * 무엇을 넘기고 무엇을 안 넘기는가
 * --------------------------------
 * 서버(`app/services/ocr_measurements.py`)가 단위·참고치·값 범위 관문 셋을 통과시킨
 * `values` 만 폼으로 간다. 관문에 걸린 `review` 는 **여기 남겨 두고 원문 4열을 같이
 * 보여 준다.** 검사명 오독은 숫자만 보면 멀쩡해서, 원문을 붙여야 사용자가 잡아낸다.
 */

import React, { type ChangeEvent, useCallback, useEffect, useRef, useState } from "react";

import { GeminiOcrAdapter, type OcrMeasurementRow } from "../../shared/api/geminiOcrAdapter";
import type { LocalDocument } from "../../shared/local/domainContracts";
import type { LocalDomainRuntime } from "../../shared/local/localDomainRuntime";
import { buildPreview, type DocumentPreview } from "./documentPreview";
import { OcrProgressPanel, type OcrStage } from "./OcrProgressPanel";

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
  onDocument,
  onReview,
}: {
  runtime?: LocalDomainRuntime;
  householdId: string;
  profileId: string;
  profileName: string;
  onRead: (reading: DocumentReading) => void;
  /**
   * 보관함에 저장된 검진표. **판정 기록이 이 id 를 들고 있어야** 나중에 "이 판정은
   * 어느 검진표에서 왔나" 를 되짚을 수 있다. 안 넘기면 원본과 판정이 각자 남고,
   * 건강 데이터의 검진 이력에서 서류를 열 방법이 사라진다.
   */
  onDocument?: (document: LocalDocument | undefined) => void;
  onReview?: () => void;
}) {
  const [preview, setPreview] = useState<DocumentPreview>();
  const [reading, setReading] = useState<DocumentReading>();
  /**
   * 인식 진행. 한 줄 문구가 아니라 **단계 + 흘러온 글**이다.
   *
   * 예전에는 `setProgress("표를 읽고 있어요…")` 한 줄이었고, 7~20초 동안 화면에서
   * 움직이는 것이 없어서 멈춘 것과 도는 것을 구분할 수 없었다.
   */
  const [job, setJob] = useState<{ stage: OcrStage; text: string; restarted: boolean; startedAt: number }>();
  const [error, setError] = useState<string>();
  const [fileName, setFileName] = useState<string>();
  const [showOriginal, setShowOriginal] = useState(false);

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
    async (file: File | undefined) => {
      if (!file) return;

      const run = runRef.current + 1;
      runRef.current = run;
      const current = () => runRef.current === run;

      setError(undefined);
      setReading(undefined);
      setFileName(file.name);
      setShowOriginal(false);
      swapPreview(undefined);
      onDocument?.(undefined);

      const startedAt = Date.now();
      const step = (stage: OcrStage) =>
        setJob((prev) => ({ stage, text: prev?.text ?? "", restarted: prev?.restarted ?? false, startedAt }));

      try {
        // **미리보기를 먼저 띄운다.** 인식은 7~20초라, 그동안 화면이 비어 있으면
        // 사용자는 파일이 올라갔는지조차 알 수 없다.
        setJob({ stage: "opening", text: "", restarted: false, startedAt });
        const built = await buildPreview(file, file.type);
        // 그 사이 다른 파일을 골랐으면 방금 만든 것을 놓고 조용히 빠진다.
        if (!current()) return built.release();
        swapPreview(built);

        if (runtime?.documents) {
          step("storing");
          const saved = await runtime.documents.save({
            householdId,
            profileId,
            file,
            fileName: file.name,
          });
          if (!current()) return;
          if (!saved.ok) throw new Error(saved.error.message);
          onDocument?.(saved.value);
        }

        step("queued");
        const result = await new GeminiOcrAdapter().recognize(file, file.name, {
          onProgress: ({ text }) => {
            if (!current()) return;
            // 글자가 하나라도 왔으면 워커가 잡았다는 뜻이다 — 대기에서 읽기로.
            //
            // `text` 가 있다가 빈 문자열이 되면 서버가 `reset` 을 보낸 것이다
            // (앞 모델이 죽어 다른 모델로 다시 시작). 그 사실을 감추면 사용자는
            // 글자 수가 뒤로 가는 것을 버그로 읽는다.
            setJob((prev) => ({
              stage: text ? "reading" : (prev?.stage ?? "queued"),
              text,
              restarted: (prev?.restarted ?? false) || Boolean(prev && prev.text.length > 0 && text.length === 0),
              startedAt,
            }));
          },
        });
        if (!current()) return;
        step("matching");
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
        if (current()) setJob(undefined);
      }
    },
    [runtime, householdId, profileId, onRead, onDocument, swapPreview],
  );

  const pick = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.currentTarget.files?.[0];
      // 같은 파일을 다시 고를 수 있어야 한다. 값을 비우지 않으면 두 번째 선택에서
      // `change` 가 아예 안 뜬다.
      event.currentTarget.value = "";
      void take(file);
    },
    [take],
  );

  // **끌어다 놓기.** 검진표는 대개 이미 폴더에 열려 있어서, 파일 창을 한 번 더
  // 여는 것보다 끌어오는 쪽이 짧다. 같은 `take` 를 타므로 처리 경로는 하나다.
  const [dragging, setDragging] = useState(false);
  const drop = useCallback(
    (event: React.DragEvent<HTMLLabelElement>) => {
      event.preventDefault();
      setDragging(false);
      void take(event.dataTransfer.files?.[0]);
    },
    [take],
  );

  const filled = reading ? Object.keys(reading.values).length : 0;

  useEffect(() => {
    if (!showOriginal) return;
    const onEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setShowOriginal(false);
    };
    window.addEventListener("keydown", onEscape);
    return () => window.removeEventListener("keydown", onEscape);
  }, [showOriginal]);

  return (
    <aside className="checkup-pane" aria-label="검진표 불러오기">
      {!fileName ? (
        <label
          className={dragging ? "checkup-picker is-dragging" : "checkup-picker"}
          onDragOver={(event) => { event.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={drop}
        >
          <input type="file" accept="image/*,.pdf,application/pdf" aria-label="검진표 이미지나 PDF 고르기" onChange={pick} />
          <span>{dragging ? "여기에 놓으세요" : "이미지 또는 PDF 선택"}</span>
        </label>
      ) : (
        <div className="checkup-selected">
          {preview?.pages[0] ? <div className="checkup-thumbnail"><img src={preview.pages[0]} alt="선택한 검진표 첫 쪽 미리보기" /></div> : <div className="checkup-thumbnail is-loading" aria-hidden="true">문서</div>}
          <div className="checkup-file-info">
            <strong title={fileName}>{fileName}</strong>
            <span>검진일은 원본에서 확인해 주세요.</span>
            <span>{job ? "수치 인식 중" : error ? "인식 실패" : reading ? `인식 완료 · ${filled}개 항목` : "파일 준비 중"}</span>
            <div className="checkup-actions">
              <button type="button" onClick={onReview}>수치 확인</button>
              {preview?.pages.length ? <button type="button" onClick={() => setShowOriginal(true)}>원본 보기</button> : null}
              <label className="checkup-repick"><input type="file" accept="image/*,.pdf,application/pdf" aria-label="다른 검진표 고르기" onChange={pick} /><span>다시 선택</span></label>
            </div>
          </div>
        </div>
      )}
      <p className="checkup-privacy">원본은 읽는 동안에만 사용하고, 확정한 수치만 계정에 남습니다.</p>

      {job ? (
        <OcrProgressPanel stage={job.stage} text={job.text} restarted={job.restarted} startedAt={job.startedAt} />
      ) : null}
      {error ? (
        <p className="alert error-alert" role="alert">
          {error}
        </p>
      ) : null}

      {reading ? (
        <div className="checkup-reading">
          <p className={filled > 0 ? "checkup-filled" : "form-notice"}>
            {filled > 0
              ? `수치 ${filled}개를 읽어 입력에 반영했어요. 원본과 맞는지 확인해 주세요.`
              : "판정에 쓸 수치를 찾지 못했어요. 직접 입력해 주세요."}
          </p>

          {reading.review.length > 0 ? (
            <details className="checkup-review" open>
              <summary>확인이 필요한 {reading.review.length}개 — 폼에는 넣지 않았어요</summary>
              <p>검사명을 잘못 읽었을 수 있어 입력에 반영하지 않았습니다. 원본과 대조한 뒤 직접 넣어 주세요.</p>
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
      {showOriginal && preview?.pages.length ? (
        <div className="checkup-lightbox" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setShowOriginal(false); }}>
          <div className="checkup-lightbox-content" role="dialog" aria-modal="true" aria-label={`${profileName}님의 검진표 원본`}>
            <div className="checkup-lightbox-head"><strong>{fileName}</strong><button type="button" onClick={() => setShowOriginal(false)}>닫기</button></div>
            <div className="checkup-lightbox-pages">{preview.pages.map((page, index) => <img key={page} src={page} alt={`검진표 ${index + 1}쪽 원본`} />)}</div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
