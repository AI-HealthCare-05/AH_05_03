import { serverApiClient } from "../../shared/api/serverApiClient";
import type { ChatMessageData, ChatSessionData } from "../../shared/api/contracts";

export type { ChatMessageData, ChatSessionData };

export interface ChatMessage {
  role: "user" | "assistant" | "system";
  content: string;
}

export interface ProfileContext {
  profile_name: string;
  relationship?: string;
  birth_year?: number;
  recent_records_summary?: string;
}

export interface ExerciseDraft {
  exercise_name: string;
  weight_kg?: number | null;
  reps?: number | null;
  sets?: number | null;
  distance_km?: number | null;
  duration_minutes?: number | null;
  date_str?: string | null;
  note?: string | null;
}

export interface BloodPressureDraft {
  systolic?: number | null;
  diastolic?: number | null;
  pulse?: number | null;
  measured_at?: string | null;
  note?: string | null;
}

export interface BloodGlucoseDraft {
  value?: number | null;
  timing?: string | null;
  measured_at?: string | null;
  note?: string | null;
}

export interface MedicationDraft {
  medication_name: string;
  dosage?: string | null;
  taken_at?: string | null;
  note?: string | null;
}

export interface PainDraft {
  body_area: string;
  intensity: number;
  sensation?: string | null;
  onset_at?: string | null;
  note?: string | null;
}

export interface LabResultDraft {
  screening_name?: string | null;
  institution?: string | null;
  recorded_at?: string | null;
  summary?: string | null;
  items_summary?: string | null;
}

export interface QueryDraft {
  record_type?: string | null;
  time_range?: string | null;
  keyword?: string | null;
}

export interface ChallengeTaskDraft {
  week: number;
  day_of_week: number;
  type: "exercise" | "sleep" | "check_in";
  title: string;
  target_minutes?: number | null;
  target_distance_km?: number | null;
  note?: string | null;
}

export interface ChallengeDraft {
  action: "propose" | "create" | "adjust" | "complete";
  title: string;
  goal: string;
  weeks?: number;
  start_date?: string | null;
  tasks: ChallengeTaskDraft[];
  adjusted_minutes?: number | null;
  set_rest_day?: boolean;
}

export interface HealthAssistantResponse {
  intent:
    | "record_exercise"
    | "record_blood_pressure"
    | "record_blood_glucose"
    | "record_medication"
    | "record_pain"
    | "record_lab_result"
    | "query_records"
    | "create_challenge"
    | "adjust_challenge"
    | "complete_challenge"
    | "health_advice"
    | "general_chat"
    | "unknown";
  assistant_message: string;
  exercise_draft?: ExerciseDraft | null;
  blood_pressure_draft?: BloodPressureDraft | null;
  blood_glucose_draft?: BloodGlucoseDraft | null;
  medication_draft?: MedicationDraft | null;
  pain_draft?: PainDraft | null;
  lab_result_draft?: LabResultDraft | null;
  challenge_draft?: ChallengeDraft | null;
  query_draft?: QueryDraft | null;
  missing_fields: string[];
  needs_confirmation: boolean;
  auto_save?: boolean;
  suggested_quick_replies: string[];
  emergency_notice?: string | null;
  safety_disclaimer?: string | null;
}

/**
 * 대화 한 번. **인증된 클라이언트로 보낸다.**
 *
 * PR 원본은 맨 `fetch` 에 `VITE_API_URL` 을 붙였는데 project 의 이 경로는 토큰을
 * 요구한다(본문에 증상과 수치가 실린다). 토큰 갱신·401 재시도가 `serverApiClient`
 * 에 이미 있으므로 그쪽으로 모은다 — 여기서 다시 만들면 갱신 규칙이 두 벌이 된다.
 */
/**
 * 같은 대화를 **조각으로** 받는다. `onDelta` 로 글자가 오는 대로 흐르고, 끝나면
 * 완성된 구조화 응답을 돌려준다.
 *
 * 왜 완성본이 따로 오나. 기록 초안은 JSON 이 끝나야 유효해지고 안전 검증도 완성본에만
 * 걸 수 있다 — 덜 온 문장으로 응급 판정을 하면 "가슴이 아" 에서 119 를 띄운다.
 */
export async function createChatSession(profileId: string, title?: string): Promise<ChatSessionData> {
  return serverApiClient.createChatSession(profileId, title);
}

export async function listChatSessions(profileId?: string): Promise<ChatSessionData[]> {
  return serverApiClient.listChatSessions(profileId);
}

export async function listChatMessages(sessionId: string): Promise<ChatMessageData[]> {
  return serverApiClient.listChatMessages(sessionId);
}

export async function deleteChatSession(sessionId: string): Promise<void> {
  return serverApiClient.deleteChatSession(sessionId);
}

export async function streamHealthAssistantMessage(
  messages: ChatMessage[],
  onDelta: (text: string) => void,
  profileContext?: ProfileContext,
  signal?: AbortSignal,
  sessionId?: string,
): Promise<HealthAssistantResponse> {
  let final: HealthAssistantResponse | undefined;
  let failure: string | undefined;
  await serverApiClient.streamHealthAssistantChat(
    {
      messages,
      profile_context: profileContext,
      session_id: sessionId,
    },
    (event, data) => {
      if (event === "delta" && typeof data.text === "string") onDelta(data.text);
      else if (event === "result") final = data as unknown as HealthAssistantResponse;
      else if (event === "error" && typeof data.message === "string") failure = data.message;
    },
    signal,
  );
  if (failure) throw new Error(failure);
  if (!final) throw new Error("건강 비서 응답을 받지 못했습니다.");
  return final;
}

export async function sendHealthAssistantMessage(
  messages: ChatMessage[],
  profileContext?: ProfileContext,
  sessionId?: string,
): Promise<HealthAssistantResponse> {
  return serverApiClient.healthAssistantChat<HealthAssistantResponse>({
    messages,
    profile_context: profileContext,
    session_id: sessionId,
  });
}

