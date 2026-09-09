from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from app.dtos.anatomy_event import AnatomyEvent


def test_anatomy_event_valid_deserialization() -> None:
    raw_payload = {
        "schemaVersion": "1.0.0",
        "eventId": "ev-test-1234",
        "atlas": {
            "id": "vanatome-male-reference",
            "version": "1.0.0",
            "referenceSex": "male",
        },
        "concept": {
            "canonicalConceptId": "fma:pectoralis-major-right",
            "sourceKey": "vanatome:male:1.0:pectoralis_major_r",
            "sourceMeshId": "VH_M_pectoralis_major_r",
            "label": "대흉근 (오른쪽)",
            "system": "muscular",
            "side": "right",
            "mappingStatus": "canonical",
        },
        "geometry": {
            "coordinateSpace": "world",
            "point": [0.12, 1.45, 0.22],
            "normal": [0.0, 0.0, 1.0],
            "faceIndex": 42,
        },
        "inputSource": "tap",
        "state": "confirmed",
        "recordedAt": "2026-09-08T12:00:00Z",
    }

    event = AnatomyEvent.model_validate(raw_payload)
    assert event.schema_version == "1.0.0"
    assert event.event_id == "ev-test-1234"
    assert event.concept.canonical_concept_id == "fma:pectoralis-major-right"
    assert event.concept.side == "right"
    assert event.geometry is not None
    assert event.geometry.point == (0.12, 1.45, 0.22)
    assert event.recorded_at == datetime(2026, 9, 8, 12, 0, tzinfo=timezone.utc)


def test_anatomy_event_invalid_schema_version() -> None:
    raw_payload = {
        "schemaVersion": "2.0.0",  # 지원하지 않는 버전
        "eventId": "ev-test-1234",
        "atlas": {
            "id": "test",
            "version": "1.0",
            "referenceSex": "male",
        },
        "concept": {
            "canonicalConceptId": "test",
            "sourceKey": "test",
            "sourceMeshId": "test",
            "label": "테스트",
            "system": "muscular",
        },
        "recordedAt": "2026-09-08T12:00:00Z",
    }
    with pytest.raises(ValidationError):
        AnatomyEvent.model_validate(raw_payload)
