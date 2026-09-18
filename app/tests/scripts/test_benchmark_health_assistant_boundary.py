import json
from pathlib import Path
from tempfile import TemporaryDirectory
from typing import Any, Literal
from unittest.mock import AsyncMock, patch

import pytest

from app.dtos.health_assistant import HealthAssistantScopeDecision
from app.exceptions import LlmProviderFailedError
from app.services.health_assistant_boundary import HealthAssistantBoundaryResult, HealthAssistantBoundaryService
from scripts.benchmark_health_assistant_boundary import (
    CASES,
    BenchmarkCase,
    calculate_percentile,
    run_benchmark,
)


def test_calculate_percentile() -> None:
    with pytest.raises(ValueError):
        calculate_percentile([1.0, 2.0, 3.0], -0.1)
    with pytest.raises(ValueError):
        calculate_percentile([1.0, 2.0, 3.0], 1.1)

    data = [3.0, 1.0, 2.0]
    original = data.copy()
    assert calculate_percentile(data, 0.5) == 2.0
    assert data == original

    assert calculate_percentile([], 0.5) == 0.0
    assert calculate_percentile([5.0], 0.5) == 5.0

    data2 = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0]
    assert calculate_percentile(data2, 0.5) == 5.5
    assert abs(calculate_percentile(data2, 0.95) - 9.55) < 1e-9


@pytest.mark.asyncio
async def test_invalid_runs_and_warmup() -> None:
    assert await run_benchmark(False, warmup=1, runs=0, report_path=None) == 1
    assert await run_benchmark(False, warmup=1, runs=-1, report_path=None) == 1
    assert await run_benchmark(False, warmup=-1, runs=1, report_path=None) == 1
    assert await run_benchmark(False, warmup=0, runs=1, report_path=None) == 0


@pytest.mark.asyncio
async def test_expected_routes() -> None:
    assert len(CASES) > 0
    route_by_case = {case.case_id for case in CASES}

    with TemporaryDirectory() as d:
        report_path = Path(d) / "report.json"
        assert await run_benchmark(False, warmup=0, runs=1, report_path=str(report_path)) == 0

        with open(report_path) as f:
            report = json.load(f)

        case_summaries = report["case_summaries"]
        assert {c["case_id"] for c in case_summaries} == route_by_case

        for c in case_summaries:
            expected_case = next(bc for bc in CASES if bc.case_id == c["case_id"])
            assert c["route_counts"].get(expected_case.expected_route, 0) == 1
            matched_outcome = sum(c["outcome_counts"].get(out, 0) for out in expected_case.expected_outcomes)
            assert matched_outcome == 1
            assert c.get("contract_mismatches", 0) == 0


@pytest.mark.asyncio
@pytest.mark.parametrize("contract", ["health_knowledge", "medication"])
async def test_contract_violation_is_a_hard_failure(
    contract: Literal["health_knowledge", "medication"],
) -> None:
    case = BenchmarkCase(
        case_id=f"invalid_{contract}_contract",
        message="합성 계약 검증 문장",
        expected_route="fast_path",
        expected_outcomes=frozenset({"answer"}),
        contract=contract,
    )
    invalid_result = HealthAssistantBoundaryResult(
        request=None,
        decision=HealthAssistantScopeDecision(
            scope="health",
            request_kind="personalized_advice",
            clinical_contexts=["pregnancy"],
            requires_authoritative_evidence=False,
            required_evidence_types=[],
        ),
    )

    with TemporaryDirectory() as d:
        report_path = Path(d) / "report.json"
        with (
            patch("scripts.benchmark_health_assistant_boundary.CASES", [case]),
            patch.object(
                HealthAssistantBoundaryService,
                "check_request",
                new=AsyncMock(return_value=invalid_result),
            ),
        ):
            assert await run_benchmark(False, warmup=0, runs=1, report_path=str(report_path)) == 1

        with open(report_path) as f:
            report = json.load(f)

        assert report["contract_mismatch_count"] == 1
        assert report["safety_status"] == "fail"
        assert report["behavior_status"] == "pass"


@pytest.mark.asyncio
async def test_outcome_mismatch_is_reported_as_degraded() -> None:
    case = BenchmarkCase(
        case_id="degraded_outcome",
        message="합성 동작 결과 검증 문장",
        expected_route="fast_path",
        expected_outcomes=frozenset({"clarify"}),
    )
    answer_result = HealthAssistantBoundaryResult(
        request=None,
        decision=HealthAssistantScopeDecision(
            scope="health",
            request_kind="information",
            clinical_contexts=["none"],
        ),
    )

    with TemporaryDirectory() as d:
        report_path = Path(d) / "report.json"
        with (
            patch("scripts.benchmark_health_assistant_boundary.CASES", [case]),
            patch.object(
                HealthAssistantBoundaryService,
                "check_request",
                new=AsyncMock(return_value=answer_result),
            ),
        ):
            assert await run_benchmark(False, warmup=0, runs=1, report_path=str(report_path)) == 0

        with open(report_path) as f:
            report = json.load(f)

        assert report["outcome_mismatch_count"] == 1
        assert report["safety_status"] == "pass"
        assert report["behavior_status"] == "degraded"


@pytest.mark.asyncio
async def test_swallowed_live_classifier_failure_is_reported_as_error() -> None:
    class FailingLiveClient:
        model_name = "test-model"

        async def generate_structured_response_with_tools(self, *args: Any, **kwargs: Any) -> tuple[Any, Any]:
            if "tools" in kwargs:
                del kwargs["tools"]
            if "tool_executor" in kwargs:
                del kwargs["tool_executor"]
            return await self.generate_structured_response(*args, **kwargs), None

        async def stream_structured_response_with_tools(self, *args: Any, **kwargs: Any) -> tuple[Any, Any]:
            if "tools" in kwargs:
                del kwargs["tools"]
            if "tool_executor" in kwargs:
                del kwargs["tool_executor"]
            return self.stream_structured_response(*args, **kwargs), None

        async def generate_structured_response(self, *args: Any, **kwargs: Any) -> Any:
            raise LlmProviderFailedError("synthetic provider failure")

        def stream_structured_response(self, *args: Any, **kwargs: Any) -> Any:
            raise NotImplementedError

    case = BenchmarkCase(
        case_id="provider_failure",
        message="합성 분류기 실패 문장",
        expected_route="llm_classifier",
        expected_outcomes=frozenset({"answer"}),
    )

    with TemporaryDirectory() as d:
        report_path = Path(d) / "report.json"
        with (
            patch("scripts.benchmark_health_assistant_boundary.CASES", [case]),
            patch("app.integrations.llm.gemini.GeminiLLMClient", return_value=FailingLiveClient()),
        ):
            assert await run_benchmark(True, warmup=0, runs=1, report_path=str(report_path)) == 1

        with open(report_path) as f:
            report = json.load(f)

        assert report["total_errors"] == 1
        assert report["case_summaries"][0]["errors"] == 1
        assert report["case_summaries"][0]["error_categories"] == {"classifier_exception": 1}
        assert report["aggregates"]["llm_classifier"]["samples"] == 0
        assert report["safety_status"] == "fail"


@pytest.mark.asyncio
async def test_report_phi_allowlist(capsys: pytest.CaptureFixture) -> None:
    with TemporaryDirectory() as d:
        report_path = Path(d) / "report.json"
        assert await run_benchmark(False, warmup=0, runs=1, report_path=str(report_path)) == 0

        with open(report_path) as f:
            report = json.load(f)

        allowed_keys = {
            "schema_version",
            "generated_at",
            "mode",
            "model",
            "warmup",
            "runs",
            "aggregates",
            "case_summaries",
            "case_id",
            "route_counts",
            "outcome_counts",
            "contract_mismatches",
            "samples",
            "p50_ms",
            "p95_ms",
            "errors",
            "error_categories",
            "fast_path",
            "llm_classifier",
            "total",
            "answer",
            "clarify",
            "blocked",
            "fail_closed",
            "error",
            "classifier_exception",
            "invalid_decision",
            "unexpected_error",
            "total_outcome_counts",
            "route_mismatch_count",
            "outcome_mismatch_count",
            "contract_mismatch_count",
            "total_errors",
            "safety_status",
            "behavior_status",
        }

        def check_keys(obj: Any) -> None:
            if isinstance(obj, dict):
                for k, v in obj.items():
                    assert k in allowed_keys, f"Disallowed key found in report: {k}"
                    check_keys(v)
            elif isinstance(obj, list):
                for v in obj:
                    check_keys(v)

        check_keys(report)

        report_str = json.dumps(report)
        for case in CASES:
            if not case.message.startswith("dummy") and case.message != "안녕":
                assert case.message not in report_str, f"Message '{case.message}' leaked in report"

        captured = capsys.readouterr()
        for case in CASES:
            if not case.message.startswith("dummy") and case.message != "안녕":
                assert case.message not in captured.out
                assert case.message not in captured.err


@pytest.mark.asyncio
async def test_live_init_failure(capsys: pytest.CaptureFixture) -> None:
    with patch("app.integrations.llm.gemini.GeminiLLMClient", side_effect=Exception("mocked init failure")):
        result = await run_benchmark(True, warmup=0, runs=1, report_path=None)
        assert result == 1
        captured = capsys.readouterr()
        assert (
            "Failed to initialize live client: live client initialization failed (configuration/credential error)"
            in captured.out
        )
