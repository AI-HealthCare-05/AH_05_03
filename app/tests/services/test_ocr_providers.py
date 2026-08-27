"""공급자 선택과 **허용 목록**. 여기가 뚫리면 엉뚱한 — 그리고 비싼 — 모델을 부른다.

Gemini 는 무료 등급이라 실수해도 429 로 끝나지만 OpenAI 는 건당 과금이다. 그래서
"쓸 수 있는 모델" 을 값으로 못 박고, 목록에 없는 것이 들어오면 **기동 시점에** 막는다.
"""

import pytest

from app.core.config import Config
from app.exceptions import OcrUnavailableError, OcrUnsupportedTypeError
from app.services import ocr_providers


def test_bare_names_still_mean_gemini() -> None:
    """접두사 없는 기존 표기가 그대로 동작해야 한다 — 배포 중에 목록이 안 깨지도록."""
    assert ocr_providers.parse_entry("gemini-3.5-flash-lite") == ("gemini", "gemini-3.5-flash-lite")


def test_provider_prefix_is_split_off() -> None:
    assert ocr_providers.parse_entry("openai:gpt-4o-mini") == ("openai", "gpt-4o-mini")


def test_allowed_openai_model_builds(monkeypatch) -> None:
    monkeypatch.setattr(ocr_providers.config, "OPENAI_API_KEY", "sk-test")
    built = ocr_providers.build("openai:gpt-4o-mini")
    assert isinstance(built, ocr_providers.OpenAIProvider)
    assert built.model == "gpt-4o-mini"


def test_openai_entry_is_skipped_without_a_key(monkeypatch) -> None:
    """키를 안 채운 채 목록에 항목만 둬도 경로가 죽으면 안 된다 — 다음 항목으로 넘어간다."""
    monkeypatch.setattr(ocr_providers.config, "OPENAI_API_KEY", None)
    with pytest.raises(OcrUnavailableError, match="OpenAI API 키"):
        ocr_providers.build("openai:gpt-4o-mini")


def test_model_outside_the_allowlist_is_refused(monkeypatch) -> None:
    monkeypatch.setattr(ocr_providers.config, "OPENAI_API_KEY", "sk-test")
    with pytest.raises(OcrUnavailableError, match="허용하지 않은"):
        ocr_providers.build("openai:gpt-4o")


def test_embedding_model_is_refused_for_ocr(monkeypatch) -> None:
    """임베딩 모델은 벡터만 돌려준다. 목록에 있어도 문서 인식에는 못 쓴다."""
    monkeypatch.setattr(ocr_providers.config, "OPENAI_API_KEY", "sk-test")
    with pytest.raises(OcrUnavailableError, match="임베딩 모델"):
        ocr_providers.build("openai:text-embedding-3-small")


def test_unknown_provider_is_refused() -> None:
    with pytest.raises(OcrUnavailableError, match="알 수 없는 OCR 공급자"):
        ocr_providers.build("anthropic:claude")


@pytest.mark.asyncio
async def test_openai_refuses_pdf_so_gemini_can_take_it(monkeypatch) -> None:
    """OpenAI 는 PDF 를 인라인으로 못 받는다. 예외로 알려 다음 항목이 처리하게 한다."""
    monkeypatch.setattr(ocr_providers.config, "OPENAI_API_KEY", "sk-test")
    provider = ocr_providers.OpenAIProvider("gpt-4o-mini")
    with pytest.raises(OcrUnsupportedTypeError, match="application/pdf"):
        async for _ in provider.stream([(b"%PDF-1.4", "application/pdf")], "prompt"):
            pass


# -- 기동 시점 검증 ----------------------------------------------------


def test_config_rejects_a_model_outside_the_allowlist() -> None:
    with pytest.raises(ValueError, match="허용하지 않은 OpenAI 모델"):
        Config(DEV_OCR_MODELS=["openai:gpt-4o"])


def test_config_rejects_an_embedding_model() -> None:
    with pytest.raises(ValueError, match="임베딩 모델"):
        Config(DEV_OCR_MODELS=["openai:text-embedding-3-small"])


def test_config_rejects_an_unknown_provider() -> None:
    with pytest.raises(ValueError, match="알 수 없는 OCR 공급자"):
        Config(DEV_OCR_MODELS=["anthropic:claude-opus"])


def test_config_accepts_the_intended_mix() -> None:
    cfg = Config(DEV_OCR_MODELS=["gemini-3.5-flash-lite", "openai:gpt-4o-mini"])
    assert cfg.DEV_OCR_MODELS == ["gemini-3.5-flash-lite", "openai:gpt-4o-mini"]


def test_strictify_marks_every_object_closed() -> None:
    """OpenAI strict 모드는 모든 객체에 `additionalProperties: false` 와 전체 required 를 요구한다."""
    schema = ocr_providers._strictify(
        {"type": "object", "properties": {"a": {"type": "string"}, "b": {"type": "integer"}}, "required": ["a"]}
    )
    assert schema["additionalProperties"] is False
    assert sorted(schema["required"]) == ["a", "b"]
