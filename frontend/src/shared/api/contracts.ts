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
