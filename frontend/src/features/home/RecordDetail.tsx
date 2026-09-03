/**
 * 건강기록 한 줄이 실제로 무엇을 담고 있는지 보여 준다.
 *
 * 왜 필요했나
 * -----------
 * 목록이 기록 종류와 `payload.note` 만 그렸다. 그런데 판정 스냅샷(`recordType`
 * `"assessment"`)에는 `note` 가 없다 — 담긴 것은 그날 넣은 수치 서른여섯 칸과
 * 질환별 등급이다. 그래서 판정을 아무리 많이 남겨도 목록에는 **"위험 판정 ·
 * 저장된 건강기록"** 이 반복될 뿐이었다. 기록을 남기는 의미가 화면에 없었다.
 *
 * 두 가지를 나눠 만든다.
 *
 * - `RecordSummary` — 목록 한 줄. 등급과 수치 서넛까지만
 * - `RecordDetail`  — 모달. 그날 넣은 값 전부와 질환별 등급 전부
 */

import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { DISEASE_NAMES, LEVEL_ORDER, type RiskLevel } from "../assessment/contracts";
import { LEVEL_TONE, levelLabel, snapshot } from "./recordSummaryData";
import type { DiseaseRisk, DiseaseVerdict } from "../assessment/contracts";
import { MatrixCard, VerdictCard, VerdictDetail } from "../assessment/VerdictCards";
import { FIELD_LABELS, FIELD_UNITS } from "../assessment/fields";
import type { HealthRecord } from "../../shared/local/domainContracts";
import { Modal } from "../../shared/ui/Modal";

/**
 * 모달. **그날 화면에 뜬 판정을 그대로 재현한다.**
 *
 * 서버에 다시 묻지 않는다. 번들은 재학습으로, 임계값은 지침 개정으로 바뀌므로
 * 다시 물으면 그날 본 것과 다른 화면이 나온다. 기록의 뜻이 사라진다.
 *
 * 카드 원본(`verdicts`)이 없는 기록도 있다 — 그 필드가 생기기 전에 남긴 것이다.
 * 그때는 남아 있는 등급만 보여 주고, 대신 **그날 넣은 값으로 다시 판정**하는 길을
 * 열어 준다. 다시 판정한 결과는 오늘 기준이라는 것을 문구로 밝힌다.
 */
export function RecordDetail({ record, onClose }: { record: HealthRecord; onClose: () => void }) {
  const navigate = useNavigate();
  const payload = snapshot(record);
  const [openVerdict, setOpenVerdict] = useState<string>();

  const inputs = Object.entries(payload.inputs ?? {}).filter(
    ([, value]) => value !== null && value !== undefined && value !== "",
  );
  // 카드가 읽는 값은 폼 상태와 같은 모양(전부 문자열)이어야 한다.
  const values = Object.fromEntries(inputs.map(([name, value]) => [name, String(value)]));

  const stored = payload.verdicts ?? [];
  const verdicts = [...stored].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.risk_level as RiskLevel) - LEVEL_ORDER.indexOf(b.risk_level as RiskLevel),
  ) as unknown as DiseaseVerdict[];
  const matrix = [...(payload.matrix ?? [])].sort(
    (a, b) => LEVEL_ORDER.indexOf(a.risk_level as RiskLevel) - LEVEL_ORDER.indexOf(b.risk_level as RiskLevel),
  ) as unknown as DiseaseRisk[];

  const order = ["VERY_HIGH", "HIGH", "CAUTION", "NORMAL", "INSUFFICIENT_DATA"];
  const levels = Object.entries(payload.levels ?? {}).sort(
    (a, b) => order.indexOf(a[1]) - order.indexOf(b[1]),
  );

  const open = verdicts.find((verdict) => verdict.key === openVerdict);

  return (
    <>
      <Modal
        kicker="이날의 판정"
        title={new Date(record.recordedAt).toLocaleString("ko-KR")}
        className="record-detail-modal"
        onClose={onClose}
      >
        <div className="record-detail-top">
          <span className={`record-level ${LEVEL_TONE[payload.highestLevel] ?? "tone-unknown"}`}>
            {levelLabel(payload.highestLevel)}
          </span>
          <span>
            {payload.evaluated}/{payload.total}개 판정
            {payload.bmi ? ` · BMI ${payload.bmi.toFixed(1)}` : ""}
          </span>
        </div>

        {verdicts.length > 0 ? (
          <>
            <h3 className="record-detail-heading">질환별 결과</h3>
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

            {matrix.length > 0 ? (
              <>
                <h3 className="record-detail-heading">수치가 가리키는 앞날</h3>
                <div className="assess-cards">
                  {matrix.map((risk) => (
                    <MatrixCard key={risk.category} risk={risk} />
                  ))}
                </div>
              </>
            ) : null}
          </>
        ) : (
          <>
            <h3 className="record-detail-heading">질환별 등급</h3>
            {/* 카드 원본이 없는 옛 기록. 남아 있는 것만 보여 주고 길을 열어 준다. */}
            <p className="form-notice">
              이 기록에는 등급만 남아 있어요. 근거와 엔진까지 남기기 시작한 것은 이후 판정부터입니다.
            </p>
            {levels.length === 0 ? (
              <p className="assess-muted">남아 있는 등급이 없습니다.</p>
            ) : (
              <ul className="record-level-list">
                {levels.map(([key, level]) => (
                  <li key={key}>
                    <span>{DISEASE_NAMES[key] ?? key}</span>
                    <span className={`record-level ${LEVEL_TONE[level] ?? "tone-unknown"}`}>
                      {levelLabel(level)}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}

        <h3 className="record-detail-heading">그날 넣은 값 {inputs.length}개</h3>
        {inputs.length === 0 ? (
          <p className="assess-muted">남아 있는 입력값이 없습니다.</p>
        ) : (
          <dl className="record-input-list">
            {inputs.map(([name, value]) => (
              <div key={name}>
                <dt>{FIELD_LABELS[name] ?? name}</dt>
                <dd>
                  {typeof value === "boolean" ? (value ? "예" : "아니오") : String(value)}
                  {FIELD_UNITS[name] ? ` ${FIELD_UNITS[name]}` : ""}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="form-actions">
          <button
            className="secondary-button"
            type="button"
            onClick={() => {
              // 판정 화면으로 값을 넘긴다. 오늘 기준으로 다시 채점되므로 이 기록을
              // 덮어쓰지 않고 새 기록이 쌓인다.
              // 숫자만 넘기면 `sex` 가 빠져 필수 칸이 비어 버린다. 그날 넣은 값을
              // 그대로 넘긴다.
              const prefill = Object.fromEntries(inputs);
              onClose();
              void navigate("/assessment", {
                state: { prefill, profileId: record.profileId, prefillSource: "record" },
              });
            }}
          >
            이 수치로 다시 판정하기
          </button>
        </div>

        <p className="assess-fineprint">
          등급과 근거는 그날 화면에 뜬 값을 그대로 남긴 것입니다. 모델과 기준이 갱신되면 지금 다시 판정한 결과와
          다를 수 있습니다.
        </p>
      </Modal>

      {/* 카드의 "판정 근거" 는 판정 화면과 같은 모달을 연다. 기록 모달 위에 겹친다. */}
      {open ? <VerdictDetail verdict={open} values={values} onClose={() => setOpenVerdict(undefined)} /> : null}
    </>
  );
}
