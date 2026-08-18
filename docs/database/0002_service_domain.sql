-- 이어봄 서버 메타데이터 스키마
-- Target: PostgreSQL 17
-- Prerequisite: Alembic revision ba4d3280e8b8 (service_accounts, subscriptions)
-- Boundary: 건강기록, 가족력, 통증 기록, 건강서류, OCR 및 예측 결과를 이 스키마에 저장하지 않는다.

BEGIN;

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 기존 최소 서비스 계정에 대소문자 무시 이메일과 낙관적 잠금을 추가한다.
ALTER TABLE service_accounts
    ALTER COLUMN email TYPE varchar(320),
    ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1;

CREATE UNIQUE INDEX IF NOT EXISTS uq_service_accounts_email_ci
    ON service_accounts (lower(email));

CREATE OR REPLACE FUNCTION set_updated_at_and_version()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    NEW.updated_at := clock_timestamp();
    NEW.row_version := OLD.row_version + 1;
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_service_accounts_updated_at ON service_accounts;
CREATE TRIGGER trg_service_accounts_updated_at
BEFORE UPDATE ON service_accounts
FOR EACH ROW
EXECUTE FUNCTION set_updated_at_and_version();

CREATE TABLE households (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    created_by_account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE RESTRICT,
    status varchar(16) NOT NULL DEFAULT 'active',
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    closed_at timestamptz,
    row_version bigint NOT NULL DEFAULT 1,
    CONSTRAINT ck_households_status
        CHECK (status IN ('active', 'closed')),
    CONSTRAINT ck_households_closed_at
        CHECK ((status = 'closed' AND closed_at IS NOT NULL) OR (status = 'active' AND closed_at IS NULL))
);

CREATE TABLE household_memberships (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
    status varchar(16) NOT NULL DEFAULT 'active',
    joined_at timestamptz NOT NULL DEFAULT now(),
    left_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 1,
    CONSTRAINT uq_household_memberships_household_account
        UNIQUE (household_id, account_id),
    CONSTRAINT ck_household_memberships_status
        CHECK (status IN ('active', 'left')),
    CONSTRAINT ck_household_memberships_left_at
        CHECK ((status = 'left' AND left_at IS NOT NULL) OR (status = 'active' AND left_at IS NULL))
);

CREATE INDEX ix_household_memberships_account_status
    ON household_memberships (account_id, status);

ALTER TABLE subscriptions
    ADD COLUMN IF NOT EXISTS provider varchar(24) NOT NULL DEFAULT 'internal',
    ADD COLUMN IF NOT EXISTS provider_customer_ref varchar(255),
    ADD COLUMN IF NOT EXISTS provider_subscription_ref varchar(255),
    ADD COLUMN IF NOT EXISTS current_period_start timestamptz,
    ADD COLUMN IF NOT EXISTS current_period_end timestamptz,
    ADD COLUMN IF NOT EXISTS cancel_at_period_end boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS cancelled_at timestamptz,
    ADD COLUMN IF NOT EXISTS row_version bigint NOT NULL DEFAULT 1;

ALTER TABLE subscriptions
    DROP CONSTRAINT IF EXISTS ck_subscriptions_provider,
    DROP CONSTRAINT IF EXISTS ck_subscriptions_period,
    DROP CONSTRAINT IF EXISTS ck_subscriptions_provider_refs,
    ADD CONSTRAINT ck_subscriptions_provider
        CHECK (provider IN ('internal', 'stripe', 'app_store', 'play_store')),
    ADD CONSTRAINT ck_subscriptions_period
        CHECK (current_period_end IS NULL OR current_period_start IS NULL OR current_period_end > current_period_start),
    ADD CONSTRAINT ck_subscriptions_provider_refs
        CHECK (provider = 'internal' OR (provider_customer_ref IS NOT NULL AND provider_subscription_ref IS NOT NULL));

CREATE UNIQUE INDEX uq_subscriptions_provider_subscription_ref
    ON subscriptions (provider, provider_subscription_ref)
    WHERE provider_subscription_ref IS NOT NULL;

CREATE TABLE family_invitations (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    inviter_account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE RESTRICT,
    invitee_email varchar(320) NOT NULL,
    target_profile_ref varchar(86) NOT NULL,
    token_hash bytea NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'pending',
    expires_at timestamptz NOT NULL,
    accepted_by_account_id uuid REFERENCES service_accounts(id) ON DELETE RESTRICT,
    accepted_at timestamptz,
    declined_at timestamptz,
    cancelled_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 1,
    CONSTRAINT ck_family_invitations_profile_ref
        CHECK (target_profile_ref ~ '^[A-Za-z0-9_-]{43,86}$'),
    CONSTRAINT ck_family_invitations_token_hash_length
        CHECK (octet_length(token_hash) = 32),
    CONSTRAINT ck_family_invitations_status
        CHECK (status IN ('pending', 'accepted', 'declined', 'expired', 'cancelled')),
    CONSTRAINT ck_family_invitations_expiry
        CHECK (expires_at > created_at),
    CONSTRAINT ck_family_invitations_terminal_state
        CHECK (
            (status = 'pending' AND accepted_at IS NULL AND declined_at IS NULL AND cancelled_at IS NULL)
            OR (status = 'accepted' AND accepted_at IS NOT NULL AND accepted_by_account_id IS NOT NULL AND declined_at IS NULL AND cancelled_at IS NULL)
            OR (status = 'declined' AND declined_at IS NOT NULL AND accepted_at IS NULL AND cancelled_at IS NULL)
            OR (status = 'cancelled' AND cancelled_at IS NOT NULL AND accepted_at IS NULL AND declined_at IS NULL)
            OR (status = 'expired' AND accepted_at IS NULL AND declined_at IS NULL AND cancelled_at IS NULL)
        )
);

CREATE UNIQUE INDEX uq_family_invitations_token_hash
    ON family_invitations (token_hash);

CREATE UNIQUE INDEX uq_family_invitations_one_pending_target
    ON family_invitations (household_id, lower(invitee_email), target_profile_ref)
    WHERE status = 'pending';

CREATE INDEX ix_family_invitations_invitee_status
    ON family_invitations (lower(invitee_email), status, created_at DESC);

CREATE INDEX ix_family_invitations_expiry
    ON family_invitations (expires_at)
    WHERE status = 'pending';

CREATE TABLE profile_links (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    household_id uuid NOT NULL REFERENCES households(id) ON DELETE CASCADE,
    account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
    invitation_id uuid UNIQUE REFERENCES family_invitations(id) ON DELETE RESTRICT,
    local_profile_ref varchar(86) NOT NULL,
    status varchar(16) NOT NULL DEFAULT 'active',
    linked_at timestamptz NOT NULL DEFAULT now(),
    unlinked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    row_version bigint NOT NULL DEFAULT 1,
    CONSTRAINT ck_profile_links_profile_ref
        CHECK (local_profile_ref ~ '^[A-Za-z0-9_-]{43,86}$'),
    CONSTRAINT ck_profile_links_status
        CHECK (status IN ('active', 'unlinked')),
    CONSTRAINT ck_profile_links_unlinked_at
        CHECK ((status = 'unlinked' AND unlinked_at IS NOT NULL) OR (status = 'active' AND unlinked_at IS NULL))
);

CREATE UNIQUE INDEX uq_profile_links_one_active_profile_per_account_household
    ON profile_links (household_id, account_id)
    WHERE status = 'active';

CREATE UNIQUE INDEX uq_profile_links_one_active_account_per_profile
    ON profile_links (household_id, local_profile_ref)
    WHERE status = 'active';

CREATE INDEX ix_profile_links_account_status
    ON profile_links (account_id, status);

-- WebRTC 기술검증 통과 전에는 API에서 이 테이블을 사용하지 않는다.
CREATE TABLE registered_devices (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
    device_ref varchar(86) NOT NULL,
    display_name varchar(80) NOT NULL,
    platform varchar(32),
    browser_family varchar(32),
    public_key_jwk jsonb,
    status varchar(16) NOT NULL DEFAULT 'active',
    last_seen_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    revoked_at timestamptz,
    row_version bigint NOT NULL DEFAULT 1,
    CONSTRAINT uq_registered_devices_account_ref
        UNIQUE (account_id, device_ref),
    CONSTRAINT ck_registered_devices_device_ref
        CHECK (device_ref ~ '^[A-Za-z0-9_-]{43,86}$'),
    CONSTRAINT ck_registered_devices_public_key_object
        CHECK (public_key_jwk IS NULL OR jsonb_typeof(public_key_jwk) = 'object'),
    CONSTRAINT ck_registered_devices_status
        CHECK (status IN ('active', 'revoked')),
    CONSTRAINT ck_registered_devices_revoked_at
        CHECK ((status = 'revoked' AND revoked_at IS NOT NULL) OR (status = 'active' AND revoked_at IS NULL))
);

CREATE TABLE api_idempotency_keys (
    account_id uuid NOT NULL REFERENCES service_accounts(id) ON DELETE CASCADE,
    operation varchar(80) NOT NULL,
    idempotency_key varchar(72) NOT NULL,
    request_hash bytea NOT NULL,
    response_status smallint,
    response_body jsonb,
    created_at timestamptz NOT NULL DEFAULT now(),
    expires_at timestamptz NOT NULL,
    PRIMARY KEY (account_id, operation, idempotency_key),
    CONSTRAINT ck_api_idempotency_request_hash_length
        CHECK (octet_length(request_hash) = 32),
    CONSTRAINT ck_api_idempotency_response_status
        CHECK (response_status IS NULL OR response_status BETWEEN 200 AND 599),
    CONSTRAINT ck_api_idempotency_expiry
        CHECK (expires_at > created_at)
);

CREATE INDEX ix_api_idempotency_keys_expiry
    ON api_idempotency_keys (expires_at);

CREATE TABLE account_audit_events (
    id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
    actor_account_id uuid REFERENCES service_accounts(id) ON DELETE SET NULL,
    household_id uuid REFERENCES households(id) ON DELETE SET NULL,
    event_type varchar(80) NOT NULL,
    target_type varchar(40),
    target_ref varchar(86),
    request_id uuid,
    metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
    occurred_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT ck_account_audit_metadata_object
        CHECK (jsonb_typeof(metadata) = 'object')
);

CREATE INDEX ix_account_audit_events_actor_time
    ON account_audit_events (actor_account_id, occurred_at DESC);

CREATE INDEX ix_account_audit_events_household_time
    ON account_audit_events (household_id, occurred_at DESC);

-- updated_at/row_version을 사용하는 모든 서버 엔티티에 동일한 낙관적 잠금 규칙을 적용한다.
DO $$
DECLARE
    table_name text;
BEGIN
    FOREACH table_name IN ARRAY ARRAY[
        'households',
        'household_memberships',
        'subscriptions',
        'family_invitations',
        'profile_links',
        'registered_devices'
    ]
    LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS %I ON %I', 'trg_' || table_name || '_updated_at', table_name);
        EXECUTE format(
            'CREATE TRIGGER %I BEFORE UPDATE ON %I FOR EACH ROW EXECUTE FUNCTION set_updated_at_and_version()',
            'trg_' || table_name || '_updated_at',
            table_name
        );
    END LOOP;
END;
$$;

COMMENT ON TABLE service_accounts IS '최소 서비스 계정. 건강기록의 저장 단위가 아니다.';
COMMENT ON TABLE households IS '가족 초대와 계정 연결을 묶는 서버 컨테이너. 가족 이름이나 건강정보를 저장하지 않는다.';
COMMENT ON TABLE household_memberships IS '서비스 계정의 가정 참여 상태. 건강정보 접근 권한을 의미하지 않는다.';
COMMENT ON TABLE family_invitations IS '서비스 계정 초대 상태와 불투명 로컬 프로필 참조값만 저장한다.';
COMMENT ON COLUMN family_invitations.target_profile_ref IS '무작위 불투명 참조값. 이름, 관계, 생년 또는 건강정보를 인코딩하지 않는다.';
COMMENT ON TABLE profile_links IS '서비스 계정과 불투명 로컬 프로필 참조값의 연결. 실제 프로필은 브라우저에만 존재한다.';
COMMENT ON TABLE registered_devices IS '후순위 WebRTC 기술검증용 공개 연결정보. 건강정보 또는 암호화 건강파일을 저장하지 않는다.';
COMMENT ON TABLE account_audit_events IS '계정·구독·초대 메타데이터 감사 로그. metadata에 건강정보를 넣는 것을 금지한다.';

COMMIT;
