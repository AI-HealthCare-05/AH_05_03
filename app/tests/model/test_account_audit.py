from app.services.profile_access import sanitize_audit_metadata


def test_sanitize_drops_pin_token_and_health_keys() -> None:
    cleaned = sanitize_audit_metadata(
        {
            "attempts": "5",
            "pin": "123456",
            "temporary_pin": "482913",
            "password": "Password123!",
            "session_token": "abc",
            "glucose": "110",
            "generation": "2",
            "pin_hash": "argon",
        }
    )
    assert cleaned == {"attempts": "5", "generation": "2"}
    assert "123456" not in cleaned.values()
    assert "Password123!" not in cleaned.values()


def test_sanitize_keeps_masked_policy_actor_fields() -> None:
    cleaned = sanitize_audit_metadata(
        {
            "session_type": "pin",
            "pin_session_valid": "true",
            "actor_profile_alias": "session_ab" + "c" * 30,
            "session_token": "must-not-keep",
            "pin": "123456",
        }
    )
    assert cleaned["session_type"] == "pin"
    assert cleaned["pin_session_valid"] == "true"
    assert cleaned["actor_profile_alias"].startswith("session_")
    assert "must-not-keep" not in cleaned.values()
    assert "123456" not in cleaned.values()


def test_sanitize_allowlist_walks_nested_and_arrays() -> None:
    cleaned = sanitize_audit_metadata(
        {
            "nested": {"PIN": "9999", "attempts": "3", "query": "token=abc"},
            "items": [{"password": "x", "scope": "view_public_summary"}],
            "payload": {"systolic": "140", "note": "상담 본문"},
            "stack": "Traceback token=secret",
        }
    )
    assert cleaned == {"attempts": "3", "scope": "view_public_summary"}
    assert "9999" not in str(cleaned)
    assert "상담" not in str(cleaned)
    assert "140" not in str(cleaned)
