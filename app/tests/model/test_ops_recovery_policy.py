from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.core.config import Config, Env
from app.core.logger import MaskJobIds
from app.services.ops_recovery_policy import (
    break_glass_audit_metadata,
    ops_break_glass_available,
    ops_recovery_client_identity,
    presented_key_matches,
    should_mount_ops_recovery_router,
)
from app.services.profile_access import sanitize_audit_metadata


def _enable_break_glass(
    monkeypatch, *, current: str = "new-key", previous: str = "", expires: datetime | None = None
) -> None:
    from app.core import config

    monkeypatch.setattr(config, "ENV", Env.LOCAL)
    monkeypatch.setattr(config, "OPS_RECOVERY_ENABLED", True)
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY", current)
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS", previous)
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS_EXPIRES_AT", expires)
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY_ID", "v2")


def test_break_glass_closed_in_prod_for_current_and_previous(monkeypatch) -> None:
    from app.core import config

    monkeypatch.setattr(config, "ENV", Env.PROD)
    monkeypatch.setattr(config, "OPS_RECOVERY_ENABLED", False)
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY", "ops-test-key")
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS", "old-key")
    monkeypatch.setattr(
        config,
        "OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS_EXPIRES_AT",
        datetime(2099, 1, 1, tzinfo=timezone.utc),
    )
    assert ops_break_glass_available() is False
    assert presented_key_matches("ops-test-key") is None
    assert presented_key_matches("old-key") is None
    assert should_mount_ops_recovery_router() is False


def test_empty_keys_do_not_match(monkeypatch) -> None:
    from app.core import config

    monkeypatch.setattr(config, "ENV", Env.LOCAL)
    monkeypatch.setattr(config, "OPS_RECOVERY_ENABLED", True)
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY", "")
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS", "")
    assert ops_break_glass_available() is False
    assert presented_key_matches("") is None


def test_disabled_flag_blocks_even_with_key(monkeypatch) -> None:
    from app.core import config

    monkeypatch.setattr(config, "ENV", Env.LOCAL)
    monkeypatch.setattr(config, "OPS_RECOVERY_ENABLED", False)
    monkeypatch.setattr(config, "OPS_CIVIL_MAJORITY_RECOVERY_KEY", "ops-test-key")
    assert ops_break_glass_available() is False
    assert presented_key_matches("ops-test-key") is None


def test_env_aliases_map_to_prod() -> None:
    for raw in ("production", "prd", "PROD", "live"):
        assert Config.normalize_env(raw) is Env.PROD


def test_production_cannot_enable_ops_recovery() -> None:
    with pytest.raises(ValidationError, match="OPS_RECOVERY_ENABLED"):
        Config(ENV="prod", OPS_RECOVERY_ENABLED=True)


def test_break_glass_accepts_current_and_previous_key_before_expiry(monkeypatch) -> None:
    expires = datetime(2099, 1, 1, tzinfo=timezone.utc)
    _enable_break_glass(monkeypatch, previous="old-key", expires=expires)
    assert presented_key_matches("new-key") == "v2"
    assert presented_key_matches("old-key") == "previous"
    assert presented_key_matches("wrong") is None


def test_previous_key_rejected_after_expiry(monkeypatch) -> None:
    expires = datetime(2020, 1, 1, tzinfo=timezone.utc)
    _enable_break_glass(monkeypatch, previous="old-key", expires=expires)
    assert presented_key_matches("new-key") == "v2"
    assert presented_key_matches("old-key") is None


def test_previous_key_rejected_without_expiry(monkeypatch) -> None:
    _enable_break_glass(monkeypatch, previous="old-key", expires=None)
    assert presented_key_matches("old-key") is None


def test_untrusted_forwarded_for_is_ignored(monkeypatch) -> None:
    from app.core import config

    monkeypatch.setattr(config, "OPS_RECOVERY_TRUSTED_PROXY_IPS", "")
    assert ops_recovery_client_identity(peer_host="10.0.0.8", x_forwarded_for="1.2.3.4, 10.0.0.1") == "10.0.0.8"


def test_trusted_proxy_skips_trusted_hops_from_the_right(monkeypatch) -> None:
    from app.core import config

    monkeypatch.setattr(config, "OPS_RECOVERY_TRUSTED_PROXY_IPS", "10.0.0.8,10.0.0.9")
    assert (
        ops_recovery_client_identity(
            peer_host="10.0.0.8",
            x_forwarded_for="203.0.113.10, 10.0.0.9",
        )
        == "203.0.113.10"
    )


def test_trusted_proxy_single_hop_is_client(monkeypatch) -> None:
    from app.core import config

    monkeypatch.setattr(config, "OPS_RECOVERY_TRUSTED_PROXY_IPS", "10.0.0.8")
    assert ops_recovery_client_identity(peer_host="10.0.0.8", x_forwarded_for="203.0.113.10") == "203.0.113.10"


def test_all_forwarded_hops_trusted_falls_back_to_peer(monkeypatch) -> None:
    from app.core import config

    monkeypatch.setattr(config, "OPS_RECOVERY_TRUSTED_PROXY_IPS", "10.0.0.8,10.0.0.9")
    assert ops_recovery_client_identity(peer_host="10.0.0.8", x_forwarded_for="10.0.0.9") == "10.0.0.8"


def test_invalid_previous_key_expiry_fails_closed() -> None:
    with pytest.raises(ValidationError):
        Config(OPS_CIVIL_MAJORITY_RECOVERY_KEY_PREVIOUS_EXPIRES_AT="not-a-date")


def test_prod_config_disables_docs_and_boots() -> None:
    cfg = Config(ENV="prod", OPS_RECOVERY_ENABLED=False)
    assert cfg.ENV is Env.PROD
    assert cfg.API_DOCS_ENABLED is False
    assert cfg.OPS_RECOVERY_ENABLED is False


def test_prod_openapi_schema_omits_ops_recovery_path() -> None:
    from fastapi import FastAPI
    from fastapi.openapi.utils import get_openapi

    from app.apis.v1.ops_recovery_routers import ops_recovery_router

    cfg = Config(ENV="prod", OPS_RECOVERY_ENABLED=False, API_DOCS_ENABLED=True)
    app = FastAPI()
    if cfg.ENV is not Env.PROD:
        app.include_router(ops_recovery_router, prefix="/api/v1")
    schema = get_openapi(title="prod", version="0", routes=app.routes)
    assert not any("civil-majority-invalidations" in path for path in schema.get("paths", {}))
    assert cfg.API_DOCS_ENABLED is False


def test_access_log_masks_ops_recovery_header() -> None:
    masked = MaskJobIds._scrub("X-Ops-Recovery-Key: super-secret-value Authorization: Bearer abc")
    assert isinstance(masked, str)
    assert "super-secret-value" not in masked
    assert "X-Ops-Recovery-Key: ***" in masked


def test_asserted_operator_is_not_verified_identity() -> None:
    meta = break_glass_audit_metadata(key_id="v2", operator_id="아무이름", ticket_ref="가짜티켓")
    assert meta["asserted_operator_id"] == "아무이름"
    assert meta["asserted_ticket_ref"] == "가짜티켓"
    assert meta["authentication_method"] == "ops_recovery_key"
    assert meta["identity_verified"] == "false"
    assert "verified_operator_id" not in meta
    cleaned = sanitize_audit_metadata({**meta, "operator_id": "아무이름", "ticket_ref": "가짜티켓"})
    assert "operator_id" not in cleaned
    assert cleaned["asserted_operator_id"] == "아무이름"
    assert cleaned["identity_verified"] == "false"
