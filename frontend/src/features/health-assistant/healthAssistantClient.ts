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

export async function sendHealthAssistantMessage(
  messages: ChatMessage[],
  profileContext?: ProfileContext,
): Promise<HealthAssistantResponse> {
  const apiUrl = import.meta.env.VITE_API_URL || "";
  const response = await fetch(`${apiUrl}/api/v1/health-assistant/chat`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      messages,
      profile_context: profileContext,
    }),
  });

  const body = await response.json();

  if (!response.ok || !body.success) {
    throw new Error(body.message || "건강 비서 응답을 받지 못했습니다.");
  }

  return body.data as HealthAssistantResponse;
}
