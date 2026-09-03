/**
 * 검진문서 OCR — Local Domain API 계약
 *
 * docs/10_local_data_contract.md는 §3.3에서 `OcrResult` 엔티티를 정의하지만
 * §4에는 대응하는 서비스 인터페이스가 없다. 이 파일이 그 빈칸을 채운다.
 *
 * 경계(ADR-002 §4·§5): 이 계층은 네트워크 요청을 발생시키지 않는다.
 * 원본 파일·인식 결과·확정값은 전부 브라우저 안에 머문다.
 */

export type UUID = string;
export type ISODate = string; // YYYY-MM-DD
export type ISODateTime = string; // UTC RFC 3339

/** docs/10_local_data_contract.md §2 */
export type LocalResult<T, E extends LocalErrorCode = LocalErrorCode> =
  | { ok: true; value: T }
  | { ok: false; error: LocalError<E> };

export interface LocalError<E extends LocalErrorCode = LocalErrorCode> {
  code: E;
  message: string;
  fieldErrors?: Array<{ field: string; reason: string }>;
  retryable: boolean;
}

export type LocalErrorCode =
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "VERSION_CONFLICT"
  | "OCR_UNAVAILABLE"
  | "DECRYPTION_FAILED"
  | "ENCRYPTION_FAILED";

/** 문서 종류. 지금은 국가건강검진 결과지만 지원한다. */
export type DocumentKind = "checkup_report";

/**
 * 엔진이 뱉는 원시 단어 하나.
 * 좌표계는 전처리 배율을 되돌린 뒤의 원본 픽셀 기준이다.
 */
export interface OcrWord {
  text: string;
  /** 0~100 */
  confidence: number;
  /** 좌측 x */
  x: number;
  /** 세로 중심 y */
  y: number;
  /** 가로 폭. 인접 조각 병합에 쓴다 */
  width?: number;
}

/** 엔진 교체를 전제로 한 어댑터 경계. Tesseract든 ONNX든 이 모양만 지키면 된다. */
export interface OcrEngine {
  readonly id: string;
  readonly version: string;
  /**
   * @param region 원본 이미지에서 잘라낼 영역
   * @param hint   숫자만 읽을지 한글을 읽을지
   */
  recognize(
    image: ImageSource,
    region: Rect,
    hint: RecognizeHint,
  ): Promise<OcrWord[]>;
}

export type ImageSource = Blob | ArrayBuffer | string;
export interface Rect { left: number; top: number; width: number; height: number }
export interface RecognizeHint {
  /** numeric이면 숫자·소수점만 허용한다 */
  charset: "numeric" | "korean";
  /** 노란 형광펜 제거. 적색 채널만 남기면 형광펜이 흰색으로 날아간다 */
  dropHighlight?: boolean;
}

/** 표에서 뽑아낸 한 행. 확정 전 후보값이다. */
export interface ExtractedRow {
  /** 사전에 매칭된 표준 항목명. 매칭 실패 시 null */
  itemCode: string | null;
  /** OCR이 읽은 라벨 원문 */
  rawLabel: string;
  /** 사전 매칭 유사도 0~1 */
  labelSimilarity: number;
  /** 파싱된 수치. 실패 시 null */
  value: number | null;
  rawValue: string | null;
  /** 라벨·값 중 낮은 쪽 신뢰도 0~100 */
  confidence: number;
  /** 신뢰도가 임계값 미만이거나 매칭·파싱에 실패해 사람이 봐야 하는 행 */
  needsReview: boolean;
}

export interface ExtractionResult {
  engine: string;
  engineVersion: string;
  kind: DocumentKind;
  /** 문서에서 읽어낸 검진일. 못 읽으면 null */
  measuredDate: ISODate | null;
  rows: ExtractedRow[];
  /** 자동 확정 가능한 행 수 */
  autoConfirmable: number;
  /** 사람 확인이 필요한 행 수 */
  needsReview: number;
  elapsedMs: number;
}

/**
 * 검진문서 OCR 서비스.
 *
 * 중요: `extract`의 결과는 후보값일 뿐이다. `HealthRecord`로 전개되는 것은
 * 사용자가 `confirm`을 호출한 뒤이며, 이는 docs/API 설계서 9-3의
 * "승인 전 수치는 예측 입력 조립에서 제외된다"와 같은 장치다.
 * OCR 오인식이 그대로 위험도 예측에 들어가는 것을 막는다.
 */
export interface OcrService {
  /** 원본 이미지에서 후보값을 뽑는다. 저장하지 않는다. */
  extract(
    image: ImageSource,
    kind: DocumentKind,
  ): Promise<LocalResult<ExtractionResult, "OCR_UNAVAILABLE" | "VALIDATION_ERROR">>;

  /**
   * 사용자가 검수·수정한 값을 확정한다.
   * 원문(rawText)과 확정값(confirmedText)을 각각 보관한다 (§3.3).
   */
  confirm(
    documentId: UUID,
    measuredDate: ISODate,
    rows: Array<{ itemCode: string; value: number }>,
  ): Promise<LocalResult<{ ocrResultId: UUID; healthRecordIds: UUID[] }>>;
}

/**
 * tesseract.js 인식 결과 중 스크립트가 실제로 훑는 부분.
 *
 * SDK 가 내보내는 `Page` 는 블록 계층이 전부 nullable 이라 그대로 쓰면 접근할
 * 때마다 좁히기가 필요하다. 벤치·검증 스크립트가 읽는 필드만 여기 적어 둔다.
 */
export interface TesseractBBox { x0: number; y0: number; x1: number; y1: number }
export interface TesseractWord { text: string; confidence: number; bbox: TesseractBBox }
export interface TesseractLine {
  text?: string;
  confidence?: number;
  bbox: TesseractBBox;
  words?: TesseractWord[];
}
export interface TesseractParagraph { lines?: TesseractLine[] }
export interface TesseractBlock { paragraphs?: TesseractParagraph[] }
export interface TesseractPage { blocks?: TesseractBlock[] | null }
