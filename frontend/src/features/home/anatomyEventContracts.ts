/**
 * 3D 해부학 이벤트 표준 계약 (Canonical Anatomy Event Contract)
 *
 * 정본 문서: docs/47_anatomy_event_gemini_instructions.md
 * 3D mesh의 특정 삼각형이나 토폴로지 변경에 종속되지 않고,
 * 해부학적 의미(canonicalConceptId), 좌표, 입력 출처, 확정 상태를 안정적으로 직렬화/복원합니다.
 */

export const ANATOMY_EVENT_SCHEMA_VERSION = "1.0.0" as const;

export type AnatomyEventSchemaVersion = typeof ANATOMY_EVENT_SCHEMA_VERSION;

export type AnatomyBodySide =
  | "left"
  | "right"
  | "midline"
  | "bilateral"
  | "unknown";

export type AnatomyInputSource =
  | "tap"
  | "brush"
  | "depth"
  | "dental"
  | "search";

export type AnatomyConfirmationState =
  | "surface_report"      // 피부 표면에서 단순 보고된 위치
  | "geometric_candidate" // 광선·깊이 관통 등으로 수집된 기하학적 후보
  | "confirmed";          // 사용자가 최종 확인/선택한 구조

export type AnatomyMappingStatus =
  | "canonical"       // 표준 FMA/BodyParts3D 개념 매핑 확인
  | "source_fallback" // mesh 이름/slug 기반 대체
  | "unmapped";       // 미매핑 상태

export type AnatomyAtlasReference = {
  id: string;
  version: string;
  referenceSex: "male" | "female";
  topologyRevision?: string;
};

export type AnatomyConcept = {
  canonicalConceptId: string;
  sourceKey: string;
  sourceMeshId: string;
  label: string;
  system: string;
  side: AnatomyBodySide;
  mappingStatus: AnatomyMappingStatus;
};

export type AnatomyGeometry = {
  coordinateSpace: "world" | "local";
  point: [number, number, number];
  normal?: [number, number, number];
  faceIndex?: number;
  uv?: [number, number];
  distance?: number;
};

export type AnatomyBrushCoverage = {
  radius: number;
  sampleCount: number;
  hitRatio?: number;
};

export type AnatomyEvent = {
  schemaVersion: AnatomyEventSchemaVersion;
  eventId: string;
  atlas: AnatomyAtlasReference;
  concept: AnatomyConcept;
  relatedConcepts?: AnatomyConcept[];
  geometry?: AnatomyGeometry;
  inputSource: AnatomyInputSource;
  state: AnatomyConfirmationState;
  coverage?: AnatomyBrushCoverage;
  uncertainty?: string;
  recordedAt: string; // ISO 8601
};

/**
 * 구조물 명칭이나 키에서 신체 기준 좌우(side)를 결정적으로 파악합니다.
 * 화면 기준이 아닌 환자/신체 기준입니다.
 */
export function parseBodySide(name: string, sourceKey: string = ""): AnatomyBodySide {
  const lowerName = name.toLowerCase();
  const lowerKey = sourceKey.toLowerCase();

  // 한글 표기 검사
  if (lowerName.includes("왼쪽") || lowerName.includes("(좌)") || lowerName.includes("좌측")) {
    return "left";
  }
  if (lowerName.includes("오른쪽") || lowerName.includes("(우)") || lowerName.includes("우측")) {
    return "right";
  }
  if (lowerName.includes("중앙") || lowerName.includes("정중") || lowerName.includes("척추")) {
    return "midline";
  }

  // 영문 네이밍 및 접미사 (_l, _r, .l, .r, left, right)
  if (/(?:[-._\s]l(?:eft)?|[-._]l)$/i.test(lowerKey) || /(?:^|[-._\s])left(?:[-._\s]|$)/i.test(lowerKey) || lowerName.includes("left")) {
    return "left";
  }
  if (/(?:[-._\s]r(?:ight)?|[-._]r)$/i.test(lowerKey) || /(?:^|[-._\s])right(?:[-._\s]|$)/i.test(lowerKey) || lowerName.includes("right")) {
    return "right";
  }
  if (/(?:^|[-._\s])midline(?:[-._\s]|$)/i.test(lowerKey) || lowerKey.includes("vertebra")) {
    return "midline";
  }

  return "unknown";
}

/**
 * AnatomyEvent 유효성 검사기
 */
export function validateAnatomyEvent(candidate: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];
  if (!candidate || typeof candidate !== "object") {
    return { valid: false, errors: ["이벤트 객체가 유효하지 않습니다."] };
  }

  const ev = candidate as Partial<AnatomyEvent>;

  if (ev.schemaVersion !== ANATOMY_EVENT_SCHEMA_VERSION) {
    errors.push(`schemaVersion이 올바르지 않습니다: ${ev.schemaVersion}`);
  }
  if (!ev.eventId || typeof ev.eventId !== "string") {
    errors.push("eventId가 누락되었거나 문자열이 아닙니다.");
  }
  if (!ev.recordedAt || isNaN(Date.parse(ev.recordedAt))) {
    errors.push("recordedAt 타임스탬프가 유효한 ISO 문자열이 아닙니다.");
  }

  // atlas 검증
  if (!ev.atlas || typeof ev.atlas !== "object") {
    errors.push("atlas 정보가 누락되었습니다.");
  } else {
    if (!ev.atlas.id) errors.push("atlas.id가 누락되었습니다.");
    if (!ev.atlas.version) errors.push("atlas.version이 누락되었습니다.");
    if (ev.atlas.referenceSex !== "male" && ev.atlas.referenceSex !== "female") {
      errors.push(`atlas.referenceSex가 올바르지 않습니다: ${ev.atlas.referenceSex}`);
    }
  }

  // concept 검증
  if (!ev.concept || typeof ev.concept !== "object") {
    errors.push("concept 정보가 누락되었습니다.");
  } else {
    if (!ev.concept.canonicalConceptId) errors.push("concept.canonicalConceptId가 누락되었습니다.");
    if (!ev.concept.label) errors.push("concept.label이 누락되었습니다.");
    if (!ev.concept.system) errors.push("concept.system이 누락되었습니다.");
    const validSides: AnatomyBodySide[] = ["left", "right", "midline", "bilateral", "unknown"];
    if (!validSides.includes(ev.concept.side)) {
      errors.push(`concept.side가 올바르지 않습니다: ${ev.concept.side}`);
    }
  }

  // relatedConcepts (선택적 복수 구조) 검증
  if (ev.relatedConcepts) {
    if (!Array.isArray(ev.relatedConcepts)) {
      errors.push("relatedConcepts는 배열이어야 합니다.");
    } else {
      for (let i = 0; i < ev.relatedConcepts.length; i++) {
        const rc = ev.relatedConcepts[i];
        if (!rc || !rc.canonicalConceptId || !rc.label) {
          errors.push(`relatedConcepts[${i}]의 필수 필드가 누락되었습니다.`);
        }
      }
    }
  }

  // inputSource & state 검증
  const validSources: AnatomyInputSource[] = ["tap", "brush", "depth", "dental", "search"];
  if (!ev.inputSource || !validSources.includes(ev.inputSource)) {
    errors.push(`inputSource가 올바르지 않습니다: ${ev.inputSource}`);
  }

  const validStates: AnatomyConfirmationState[] = ["surface_report", "geometric_candidate", "confirmed"];
  if (!ev.state || !validStates.includes(ev.state)) {
    errors.push(`state가 올바르지 않습니다: ${ev.state}`);
  }

  // geometry (선택적) 검증
  if (ev.geometry) {
    if (!Array.isArray(ev.geometry.point) || ev.geometry.point.length !== 3 || ev.geometry.point.some((n) => typeof n !== "number" || isNaN(n))) {
      errors.push("geometry.point는 3차원 숫자 배열이어야 합니다.");
    }
    if (ev.geometry.normal && (!Array.isArray(ev.geometry.normal) || ev.geometry.normal.length !== 3 || ev.geometry.normal.some((n) => typeof n !== "number" || isNaN(n)))) {
      errors.push("geometry.normal은 3차원 숫자 배열이어야 합니다.");
    }
  }

  return { valid: errors.length === 0, errors };
}

/**
 * 안전한 AnatomyEvent 생성 팩토리 함수
 */
export function createAnatomyEvent(params: {
  atlas: AnatomyAtlasReference;
  concept: Omit<AnatomyConcept, "side"> & { side?: AnatomyBodySide };
  relatedConcepts?: AnatomyConcept[];
  geometry?: AnatomyGeometry;
  inputSource?: AnatomyInputSource;
  state?: AnatomyConfirmationState;
  coverage?: AnatomyBrushCoverage;
  uncertainty?: string;
  eventId?: string;
  recordedAt?: string;
}): AnatomyEvent {
  const side = params.concept.side ?? parseBodySide(params.concept.label, params.concept.sourceKey || params.concept.sourceMeshId);

  const event: AnatomyEvent = {
    schemaVersion: ANATOMY_EVENT_SCHEMA_VERSION,
    eventId: params.eventId || (typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `ev-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`),
    atlas: params.atlas,
    concept: {
      ...params.concept,
      side,
    },
    relatedConcepts: params.relatedConcepts,
    geometry: params.geometry,
    inputSource: params.inputSource || "tap",
    state: params.state || "confirmed",
    coverage: params.coverage,
    uncertainty: params.uncertainty,
    recordedAt: params.recordedAt || new Date().toISOString(),
  };

  const validation = validateAnatomyEvent(event);
  if (!validation.valid) {
    throw new Error(`AnatomyEvent 계약 위반: ${validation.errors.join(", ")}`);
  }

  return event;
}
