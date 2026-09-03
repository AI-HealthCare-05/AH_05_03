"""수치 -> 질환 위험 매트릭스가 지켜야 하는 것들.

이 모듈은 의학적 주장을 코드로 적은 것이라, 틀려도 예외가 나지 않고 조용히 틀린
숫자를 화면에 띄운다. 그래서 계산이 아니라 **판단의 전제**를 검사한다 —
같은 재료를 두 번 세지 않는가, 안 낸 검사를 통과했다고 말하지 않는가, 연관을
인과라고 말하지 않는가.
"""

from typing import Any

import pytest

from app.services.disease_risk_matrix import (
    DISEASES,
    SIGNALS,
    assess_disease_risks,
    detect_signals,
)

# 간에 지방이 낀 사람. γ-GTP·ALT·지방간지수 셋이 동시에 걸린다.
FATTY: dict[str, Any] = {
    "sex": "M",
    "age": 52,
    "height_cm": 172.0,
    "weight_kg": 88.0,
    "waist_cm": 98.0,
    "triglycerides": 240.0,
    "ggt": 95.0,
    "alt": 48.0,
}


class TestMatrixIntegrity:
    """표 자체가 말이 되는지. 손으로 적은 표라 오타 하나가 조용히 섞인다."""

    def test_every_link_points_at_a_known_disease(self) -> None:
        for signal in SIGNALS:
            for link in signal.links:
                assert link.disease in DISEASES, f"{signal.key} -> 없는 질환 {link.disease}"

    def test_weights_are_within_the_defined_scale(self) -> None:
        # 1~3 밖의 값이 들어오면 등급 경계가 통째로 의미를 잃는다.
        for signal in SIGNALS:
            for link in signal.links:
                assert 1 <= link.weight <= 3, f"{signal.key} -> {link.disease} 가중치 {link.weight}"

    def test_every_link_carries_its_evidence(self) -> None:
        # 근거 없이 적힌 화살표는 나중에 아무도 검증하지 못한다.
        for signal in SIGNALS:
            for link in signal.links:
                assert link.evidence.effect.strip(), f"{signal.key} -> {link.disease} 효과크기 없음"
                assert link.evidence.source.strip(), f"{signal.key} -> {link.disease} 출처 없음"

    def test_signal_keys_are_unique(self) -> None:
        keys = [signal.key for signal in SIGNALS]
        assert len(keys) == len(set(keys))

    def test_every_signal_declares_what_it_reads(self) -> None:
        # reads 가 비면 "볼 값이 없었다" 와 "봤는데 안 걸렸다" 를 구분하지 못한다.
        for signal in SIGNALS:
            assert signal.reads, f"{signal.key} 가 읽는 입력이 선언되지 않았다"


class TestNoDoubleCounting:
    def test_one_fatty_liver_is_counted_once(self) -> None:
        """γ-GTP·ALT·지방간지수는 셋 다 간에 낀 지방을 본다.

        따로 더하면 재료 하나를 세 번 세는 셈이라 당뇨 위험이 부풀려진다.
        같은 무리에서는 가장 센 하나만 남아야 한다.
        """
        signals = {s["key"] for s in detect_signals(FATTY)}
        assert {"ggt_high", "alt_high", "fatty_liver_high"} <= signals, "세 신호가 다 걸리는 입력이어야 한다"

        contributors = assess_disease_risks(FATTY)["dm_risk"]["contributors"]
        hepatic = [c for c in contributors if c["key"] in {"ggt_high", "alt_high", "fatty_liver_high"}]
        assert len(hepatic) == 1, f"간 지방 무리에서 {len(hepatic)}개가 남았다"
        assert hepatic[0]["key"] == "fatty_liver_high", "무리 안에서는 가장 센 것이 남아야 한다"

    def test_score_never_exceeds_the_sum_of_cluster_maxima(self) -> None:
        result = assess_disease_risks(FATTY)["dm_risk"]
        assert result["score"] == sum(c["weight"] for c in result["contributors"])


class TestInsufficientData:
    def test_empty_profile_is_not_called_healthy(self) -> None:
        """아무것도 안 낸 사람에게 "위험 신호가 없다" 고 말하면 안 낸 검사를 통과했다는 뜻이 된다."""
        for disease, result in assess_disease_risks({}).items():
            assert result["risk_level"] == "INSUFFICIENT_DATA", f"{disease} 가 빈 입력에 등급을 매겼다"

    def test_partial_input_says_it_is_partial(self) -> None:
        # 신호 하나만 보고 낸 판정과 전부 보고 낸 판정은 무게가 다르다. 그 차이가 보여야 한다.
        result = assess_disease_risks({"sex": "M", "age": 40, "smoking": True})["cvd_risk"]
        assert result["risk_level"] != "INSUFFICIENT_DATA"
        assert result["missing_fields"], "확인하지 못한 항목이 비어 있다"
        assert any("보고 냈습니다" in flag for flag in result["flags"])

    def test_full_input_leaves_nothing_unread(self) -> None:
        complete = {
            "sex": "F",
            "age": 61,
            "height_cm": 158.0,
            "weight_kg": 68.0,
            "waist_cm": 92.0,
            "systolic_bp": 145.0,
            "diastolic_bp": 92.0,
            "fasting_glucose": 118.0,
            "is_fasting": True,
            "hba1c": 6.0,
            "ldl_c": 172.0,
            "hdl_c": 38.0,
            "triglycerides": 260.0,
            "creatinine": 1.4,
            "urine_acr": 380.0,
            "alt": 31.0,
            "ggt": 55.0,
            "uric_acid": 7.2,
            "smoking": True,
            "has_diabetes": False,
            "has_hypertension": False,
        }
        for disease, result in assess_disease_risks(complete).items():
            assert not result["missing_fields"], f"{disease} 가 {result['missing_fields']} 를 못 읽었다"


class TestDiagnosedPeople:
    def test_diagnosed_disease_is_not_given_a_risk_score(self) -> None:
        """이미 당뇨를 진단받은 사람에게 "당뇨 위험 높음" 은 아무 정보가 아니다."""
        profile = {**FATTY, "has_diabetes": True}
        result = assess_disease_risks(profile)["dm_risk"]
        assert result["sub_status"] == "이미 진단됨"
        assert result["contributors"] == []
        assert result["score"] == 0

    def test_diagnosis_still_feeds_the_other_diseases(self) -> None:
        # 진단받은 질환의 위험은 안 세지만, 그 진단이 **다른** 질환에 주는 위험은 센다.
        result = assess_disease_risks({"sex": "M", "age": 60, "has_diabetes": True})
        assert any(c["key"] == "diabetes_history" for c in result["ckd_risk"]["contributors"])
        assert any(c["key"] == "diabetes_history" for c in result["cvd_risk"]["contributors"])


class TestCausalHonesty:
    @pytest.mark.parametrize("key", ["ggt_high", "hdl_low"])
    def test_known_non_causal_links_are_marked(self, key: str) -> None:
        """인과가 아니라고 밝혀진 고리를 인과처럼 적으면 안 된다.

        γ-GTP 는 멘델 무작위화에서 귀무(RR 0.96), 낮은 HDL 은 올리는 약이 심근경색을
        줄이지 못했다. 둘 다 위험인자로는 쓰이지만 원인은 아니다.
        """
        signal = next(s for s in SIGNALS if s.key == key)
        assert all(link.evidence.causal is False for link in signal.links)

    def test_non_causal_contribution_raises_a_flag(self) -> None:
        result = assess_disease_risks({"sex": "M", "age": 50, "hdl_c": 32.0})["cvd_risk"]
        assert any("원인이라는 뜻은 아닙니다" in flag for flag in result["flags"])

    def test_causal_none_and_false_are_not_conflated(self) -> None:
        # None 은 "따져본 적 없다", False 는 "따져봤더니 아니다" 다. 섞으면 둘 다 뜻을 잃는다.
        values = {link.evidence.causal for signal in SIGNALS for link in signal.links}
        assert None in values and False in values and True in values


class TestLabelDoesNotContradictTheCount:
    def test_caution_label_does_not_claim_a_single_signal(self) -> None:
        """등급은 개수가 아니라 가중 점수로 정해진다.

        1점짜리 둘이 붙어도 CAUTION 이라, 문구가 "하나 보여요" 라고 말하면 바로 옆의
        "위험 신호 2개" 와 어긋난다. 실제로 그렇게 나갔던 적이 있다.
        """
        result = assess_disease_risks({"sex": "M", "age": 40, "uric_acid": 7.8, "smoking": True})["ckd_risk"]
        assert result["risk_level"] == "CAUTION"
        assert len(result["contributors"]) == 2
        assert "하나" not in result["display_label"]


class TestSingleSignalIsHedged:
    def test_lone_signal_says_so(self) -> None:
        result = assess_disease_risks({"sex": "M", "age": 30, "waist_cm": 96.0})["htn_risk"]
        assert len(result["contributors"]) == 1
        assert any("하나뿐" in flag for flag in result["flags"])
