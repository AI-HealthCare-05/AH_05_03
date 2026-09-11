export interface ApiEnvelope<T> {
  data: T;
  message: string;
  success: true;
}

export interface ApiErrorEnvelope {
  error_code: string;
  message: string;
  success: false;
  details?: Array<{
    field: string;
    message: string;
    type: string;
  }>;
}

export interface AccessTokenData {
  access_token: string;
  token_type: "bearer";
  expires_in: number;
}

export interface SignUpData {
  account_id: string;
  email: string;
  status: "active" | "suspended" | "closed";
}

export interface AccountSummary {
  account: {
    id: string;
    email: string;
    status: "active" | "suspended" | "closed";
    created_at: string;
  };
  subscription: SubscriptionBrief;
}

export interface SubscriptionBrief {
  plan: "FREE" | "BASIC" | "FAMILY";
  status: "active" | "expired" | "cancelled";
  renewed_at: string | null;
}

export interface SubscriptionData extends SubscriptionBrief {
  id: string;
  license_valid: boolean;
}

export interface PlanChangeData extends SubscriptionData {
  previous_plan: SubscriptionBrief["plan"];
  applied: boolean;
}

export interface HouseholdData {
  id: string;
  created_by_account_id?: string;
  master_account_id: string;
  status: "active" | "closed";
  created_at: string;
  row_version: number;
}

export interface HouseholdMembershipData {
  id: string;
  household_id: string;
  account_id: string;
  status: "active" | "left";
  joined_at: string;
  left_at: string | null;
  row_version: number;
}

export interface HouseholdMembershipListItemData extends HouseholdMembershipData {
  masked_email: string;
  local_profile_ref: string | null;
  is_master?: boolean;
}

export interface ProfileLinkData {
  id: string;
  household_id: string;
  account_id: string;
  invitation_id: string | null;
  local_profile_ref: string;
  status: "active" | "unlinked";
  linked_at: string;
  unlinked_at: string | null;
  row_version: number;
}

export interface FamilyInvitationData {
  id: string;
  household_id: string;
  inviter_account_id: string;
  invitee_email: string;
  target_profile_ref: string;
  status: "pending" | "accepted" | "declined" | "expired" | "cancelled";
  expires_at: string;
  accepted_by_account_id: string | null;
  accepted_at: string | null;
  declined_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
  row_version: number;
}

export interface FamilyInvitationListData {
  sent: FamilyInvitationData[];
  received: FamilyInvitationData[];
}

export interface FamilyInvitationCreatedData {
  invitation: FamilyInvitationData;
  delivery_queued: boolean;
}

export interface AccountCloseData {
  account_id: string;
  status: "closed";
  closed_at: string;
  subscription_status: "cancelled";
  local_data_deleted: false;
  health_data_purged?: boolean;
}

export interface ChatSessionData {
  id: string;
  account_id: string;
  profile_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
}

export interface ChatSessionListData {
  items: ChatSessionData[];
  total: number;
}

export interface ChatMessageData {
  id: string;
  session_id: string;
  role: "user" | "assistant";
  content: string;
  metadata: Record<string, unknown> | null;
  sequence_number: number;
  created_at: string;
}

export interface ChatMessageListData {
  session_id: string;
  items: ChatMessageData[];
}

/** 기록 **하나**의 판정 칸 값. `RecordPrefillData` 와 고르는 방식이 다르다 —
 *  그쪽은 여러 기록에서 칸마다 가장 최근 것을 뽑고, 이쪽은 그 기록에 담긴 것만 준다. */
export interface RecordValuesData {
  record_id: string;
  record_type: string;
  values: Record<string, number>;
}

export interface ProfileServerData {
  id: string;
  household_id: string;
  created_by_account_id: string;
  display_name: string;
  relationship: string;
  birth_date: string | null;
  gender: "male" | "female" | null;
  account_email?: string | null;
  status: "active" | "hidden" | "deleted";
  row_version: number;
  created_at: string;
  updated_at: string;
}

export interface ProfileServerListData {
  items: ProfileServerData[];
}

export interface HealthRecordServerData {
  id: string;
  profile_id: string;
  record_type: string;
  recorded_at: string;
  source: string;
  payload: Record<string, unknown>;
  note: string | null;
  /** 이 기록을 채운 원본 서류의 id. 실물은 올린 기기의 보관함에만 있다. */
  source_document_id?: string | null;
  status: string;
  row_version: number;
  created_at: string;
  updated_at: string;
}

/** 판정 폼 칸 하나와 그 값의 출처. 서버 `PrefilledFieldData` 의 손 사본. */
export interface PrefilledField {
  field: string;
  value: number;
  /** 그 값을 잰 시각. **화면이 반드시 같이 보여야 한다** — 석 달 전 혈압으로 오늘
   *  판정하면 그것은 오늘의 답이 아니다. */
  measured_at: string;
  record_type: string;
  record_id?: string | null;
}

export interface RecordPrefillData {
  items: PrefilledField[];
  /** 훑어본 기록 수. `0` 이면 "기록이 없다", `0` 이 아닌데 `items` 가 비면
   *  "옮길 수치가 없다" 다 — 화면 문구가 달라야 한다. */
  scanned: number;
}

export interface HealthRecordServerListData {
  items: HealthRecordServerData[];
  total: number;
}

