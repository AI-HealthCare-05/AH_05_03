import type { AssessmentSummaryData, DiseaseRisk, DiseaseVerdict, RiskLevel } from "./contracts";
import { LEVEL_ORDER } from "./contracts";
import { FIELD_GROUPS, valuesFromInputs } from "./fields";
import type { Snapshot } from "./snapshots";

/** Saved assessments contain the verdict the user saw, but older records may contain only levels. */
export function restoreSnapshot(snapshot: Snapshot): { result: AssessmentSummaryData; values: Record<string, string> } | null {
  const stored = snapshot.payload;
  if (!stored.verdicts?.length || !stored.inputs || !Array.isArray(stored.verdicts)) return null;
  const validLevels = new Set<string>(LEVEL_ORDER);
  const verdicts = stored.verdicts.filter((item) =>
    item && item.key && item.name && validLevels.has(item.risk_level),
  ) as DiseaseVerdict[];
  if (!verdicts.length) return null;
  const matrix = (stored.matrix ?? []).filter((item) =>
    item && item.category && validLevels.has(item.risk_level),
  ) as DiseaseRisk[];
  const values = valuesFromInputs(stored.inputs);
  if (stored.report?.verdicts?.length && stored.report.summary && stored.report.disease_risks) {
    return { result: stored.report, values };
  }
  const insufficient = verdicts.filter((item) => item.risk_level === "INSUFFICIENT_DATA").map((item) => item.key);
  const needsAttention = verdicts.filter((item) => ["VERY_HIGH", "HIGH", "CAUTION"].includes(item.risk_level)).map((item) => item.key);
  const matrixNeedsAttention = matrix.filter((item) => ["VERY_HIGH", "HIGH", "CAUTION"].includes(item.risk_level)).map((item) => item.category);
  const result: AssessmentSummaryData = {
    bmi: stored.bmi,
    summary: {
      evaluated: verdicts.length - insufficient.length,
      total: verdicts.length,
      insufficient,
      by_engine: Object.fromEntries([...new Set(verdicts.map((item) => item.engine))].map((engine) => [engine, verdicts.filter((item) => item.engine === engine).length])),
      needs_attention: needsAttention,
      highest_level: (validLevels.has(stored.highestLevel) ? stored.highestLevel : verdicts[0].risk_level) as RiskLevel,
      matrix_evaluated: matrix.filter((item) => item.risk_level !== "INSUFFICIENT_DATA").length,
      matrix_total: matrix.length,
      matrix_needs_attention: matrixNeedsAttention,
    },
    verdicts,
    disease_risks: Object.fromEntries(matrix.map((item) => [item.category, item])),
    top_suspects: [],
    disclaimers: [...new Set(verdicts.map((item) => item.disclaimer).filter(Boolean))],
    inputs_provided: Object.keys(values).length,
    inputs_total: FIELD_GROUPS.reduce((total, group) => total + group.fields.length, 0),
    model_available: verdicts.some((item) => item.engine === "E2"),
  };
  return { result, values };
}
