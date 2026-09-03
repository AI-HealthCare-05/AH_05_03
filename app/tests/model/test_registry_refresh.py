"""레지스트리 갱신 계약.

`refresh()` 는 요청마다 불린다. glob 한 번 + stat 20 번이라 1.4ms 였고, 채점 전체가
26ms 이니 5% 를 파일시스템 조회에 쓰고 있었다. `STAT_INTERVAL_SECONDS` 로 스로틀을
걸어 없앴다.

**스로틀이 재학습 반영을 막으면 안 된다.** 모델 번들을 `ro` 볼륨으로 마운트하는
이유가 "재학습해도 이미지 재빌드 없이 반영된다"인데, 여기서 mtime 을 영영 안 보면
그 성질이 사라진다. 그래서 간격이 지난 뒤에는 반드시 다시 읽는지 검사한다.
"""

from __future__ import annotations

import json
from pathlib import Path

import pytest

from app.services.risk import RiskModelRegistry

BUNDLE_DIR = Path(__file__).resolve().parents[3] / "modeling" / "artifacts" / "models"


def _registry() -> RiskModelRegistry:
    if not BUNDLE_DIR.is_dir() or not list(BUNDLE_DIR.glob("risk_*.json")):
        pytest.skip(f"서빙 번들이 없다: {BUNDLE_DIR}")
    registry = RiskModelRegistry(BUNDLE_DIR)
    registry.refresh(now=0.0)
    return registry


def test_repeated_refresh_within_interval_does_not_stat(monkeypatch: pytest.MonkeyPatch) -> None:
    """간격 안에서는 파일시스템을 건드리지 않는다."""
    registry = _registry()
    calls = 0
    original = Path.glob

    def counting_glob(self: Path, pattern: str):  # type: ignore[no-untyped-def]
        nonlocal calls
        calls += 1
        return original(self, pattern)

    monkeypatch.setattr(Path, "glob", counting_glob)
    for _ in range(50):
        registry.refresh(now=0.1)
    assert calls == 0, f"간격 안인데 glob 이 {calls}회 돌았다"


def test_refresh_after_interval_reloads_changed_bundle(tmp_path: Path) -> None:
    """간격이 지나면 다시 읽는다. 재학습 반영이 이 성질에 걸려 있다."""
    if not BUNDLE_DIR.is_dir():
        pytest.skip("서빙 번들이 없다")
    source = next(iter(sorted(BUNDLE_DIR.glob("risk_*.json"))), None)
    if source is None:
        pytest.skip("서빙 번들이 없다")

    target = tmp_path / source.name
    target.write_text(source.read_text(encoding="utf-8"), encoding="utf-8")

    registry = RiskModelRegistry(tmp_path)
    loaded = len(registry.models)
    assert loaded > 0, "생성자가 번들을 읽어야 한다"

    # 첫 refresh 는 간격과 무관하게 확인한다. 내용이 그대로이므로 False.
    assert registry.refresh(now=0.0) is False
    # 같은 순간에 다시 불러도 스로틀에 걸린다
    assert registry.refresh(now=0.0) is False

    # 파일을 바꾸고 간격을 넘기면 다시 읽는다
    bundle = json.loads(target.read_text(encoding="utf-8"))
    bundle["description"] = "갱신 확인용"
    target.write_text(json.dumps(bundle, ensure_ascii=False), encoding="utf-8")

    later = registry.STAT_INTERVAL_SECONDS + 1.0
    assert registry.refresh(now=later) is True, "간격이 지났는데 다시 읽지 않았다"
    assert len(registry.models) == loaded
    assert any(model.description == "갱신 확인용" for model in registry.models.values())


def test_unchanged_bundles_do_not_reparse() -> None:
    """내용이 그대로면 24MB 를 다시 파싱하지 않는다."""
    registry = _registry()
    before = {name: id(model) for name, model in registry.models.items()}
    assert registry.refresh(now=registry.STAT_INTERVAL_SECONDS + 1.0) is False
    after = {name: id(model) for name, model in registry.models.items()}
    assert before == after, "변경이 없는데 모델 객체가 새로 만들어졌다"
