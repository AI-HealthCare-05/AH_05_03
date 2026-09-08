from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]


def test_dev_deployment_enables_configured_gemini_ocr_workers() -> None:
    compose = (ROOT / "infra/docker/docker-compose.dev-mac.yml").read_text(encoding="utf-8")

    assert "ENABLE_DEV_OCR_BRIDGE: ${ENABLE_DEV_OCR_BRIDGE:-true}" in compose
    assert 'DEV_OCR_MODELS: ${DEV_OCR_MODELS:-["gemini-3.5-flash-lite","gemini-3.1-flash-lite"]}' in compose
    assert compose.count("../../modeling/artifacts/models:/app/models:ro") == 2
    assert "  ai-worker:" in compose
    assert "image: ieobom-dev-ai-worker:current" in compose
    assert 'command: ["python", "-m", "ai_worker.main"]' in compose


def test_dev_deployer_builds_starts_and_checks_ocr_workers() -> None:
    deployer = (ROOT / "scripts/deploy_admin_mac.sh").read_text(encoding="utf-8")
    workflow = (ROOT / ".github/workflows/deploy-dev-admin-mac.yml").read_text(encoding="utf-8")

    assert "build_services+=(fastapi ai-worker)" in deployer
    assert "mailpit email-worker ai-worker fastapi anatomy-assets" in deployer
    assert "fastapi ai-worker anatomy-assets" in deployer
    assert "len(data['models']) >= 20" in deployer
    assert "data['trajectory']['available']" in deployer
    assert "ai_worker/*" in deployer
    assert "- 'ai_worker/**'" in workflow
