# modeling

만성질환 위험도 모델. 데이터 취득부터 모델 평가·배포까지 이 폴더에서 끝난다.

**먼저 읽을 것 — [`docs/21_modeling_overview.md`](../docs/21_modeling_overview.md)**
어떤 데이터를 썼고 무엇을 했고 어디서 이어받으면 되는지가 그 문서에 있다.
질환 확장과 정밀형 tier 는 [`docs/19_multi_disease_model_results.md`](../docs/19_multi_disease_model_results.md).

| 목적 | 문서 |
|---|---|
| 전체 개요·작업 내역·이어받을 작업 | [`docs/21_modeling_overview.md`](../docs/21_modeling_overview.md) |
| **질환 10종 확장과 정밀형 성능** | [`docs/19_multi_disease_model_results.md`](../docs/19_multi_disease_model_results.md) |
| **피처 감사·표본 충분성·미사용 입력** | [`docs/25_feature_audit_and_data_sufficiency.md`](../docs/25_feature_audit_and_data_sufficiency.md) |
| **임상 지수 피처 엔지니어링** | [`docs/26_clinical_feature_engineering.md`](../docs/26_clinical_feature_engineering.md) |
| **EDA · 사망연계 검증 · 합성 데이터** | [`docs/27_eda_new_data_and_synthetic.md`](../docs/27_eda_new_data_and_synthetic.md) |
| **앙상블 — 모델 3종·시드·비용** | [`docs/28_ensemble.md`](../docs/28_ensemble.md) |
| **세 모델 시드 앙상블 맞대결·재현성** | [`docs/29_seed_ensemble_model_comparison.md`](../docs/29_seed_ensemble_model_comparison.md) |
| **앙상블 서빙 — 번들·채점기·비용** | [`docs/30_ensemble_serving.md`](../docs/30_ensemble_serving.md) |
| 설계 근거 (3엔진 중재) | [`docs/23_multi_disease_model_design.md`](../docs/23_multi_disease_model_design.md) |
| 제품 결정용 요약 (최소 입력·지렛대) | [`docs/20_prediction_inputs_and_levers.md`](../docs/20_prediction_inputs_and_levers.md) |
| 데이터 취득 절차 | [`data/README.md`](data/README.md) |
| 온보딩 입력 ↔ 데이터 변수 대조 | [`data/VARIABLE_MAP.md`](data/VARIABLE_MAP.md) |
| 실험 결과 원본 | [`artifacts/`](artifacts/) |

## 파일이 하는 일

파이프라인은 네 단계고, 단계마다 실패하는 방식이 다르다.

| 단계 | 파일 | 실패했을 때 |
|---|---|---|
| 라벨·차단 집합 정의 | [`targets.py`](targets.py) | 라벨 누출. AUROC 가 0.99 로 **올라가서** 안 보인다 |
| 지표 | [`metrics.py`](metrics.py) | 판별력만 보고 확률이 틀린 모델을 고른다 |
| 학습·선택 | [`train_multi.py`](train_multi.py) | 성능이 낮다. 지표에 보인다 |
| 검정 | [`compare_tiers.py`](compare_tiers.py) | 우연을 개선으로 발표한다 |
| 규칙 엔진 대조 | [`engine_agreement.py`](engine_agreement.py) | 확률에 뜻이 안 붙는다. 사용자가 50%를 못 읽는다 |
| 배포 | [`export_multi.py`](export_multi.py) | 성능은 그대로인데 서빙 값만 다르다. 지표에 **안** 보인다 |

감사 쪽은 두 개다. 학습이 아니라 **재료**를 재고, 성능표가 말해 주지 않는 것을 잡는다.

| 목적 | 파일 | 잡는 것 |
|---|---|---|
| 피처 결측·표본 충분성(EPV) | [`audit_features.py`](audit_features.py) | 홀드아웃에 커버리지 0 인 특징. 성능표에는 안 보인다 |
| 분포·결측 구조·동반이환 | [`eda.py`](eda.py) | 센티널이 값으로 남은 것. 로더 버그 둘을 여기서 잡았다 |
| 미사용 입력·임상 지수의 기여도 | [`experiment_features.py`](experiment_features.py) | 짝지은 부트스트랩. 유의하지 않은 개선을 개선이라 부르는 것 |
| **위험도의 전향 타당도** | [`validate_mortality.py`](validate_mortality.py) | 같은 시점 라벨만 잘 맞히고 미래와는 무관한 모델 |
| 합성 증강·서빙 픽스처 | [`synthetic.py`](synthetic.py) | 실제 데이터로 못 만드는 입력에서 채점기가 죽는 것 |
| 앙상블·시드 앙상블 | [`ensemble.py`](ensemble.py) | 평균이 확률을 무디게 만들어 보정 게이트에서 떨어지는 것 |
| 앙상블의 번들 비용 | [`ensemble_cost.py`](ensemble_cost.py) | 이득만 보고 3배 무거운 구성을 고르는 것 |
| 모델별 시드 앙상블 맞대결 | [`seed_ensemble.py`](seed_ensemble.py) | AUROC 는 그대로인데 같은 사람 확률이 시드마다 달라지는 것 |
| 앙상블 번들 내보내기 | [`export_ensemble.py`](export_ensemble.py) | 대칭 트리 잎 색인이 뒤집혀도 AUROC 는 멀쩡한 것 |
| **발병 궤적 기준 위험표** | [`fit_trajectory.py`](fit_trajectory.py) | 표가 없으면 2단계가 통째로 조용히 빠지는 것. `trajectory.json` 을 만든다 |
| **발병 궤적 검증** | [`validate_trajectory.py`](validate_trajectory.py) | 유병 곡선을 뒤집은 숫자가 진짜 코호트·사망연계와 얼마나 어긋나는지 |

`validate_mortality.py` 는 [`data/load_mortality.py`](data/load_mortality.py) 가 받아 온
NCHS 사망연계(59,064명·사망 9,249건·추적 최대 19.5년)를 쓴다. 신청 절차가 없다.
2021-2023 주기는 연계본이 아직 없어서 **홀드아웃 평가에는 쓸 수 없고** 학습을
2005-2010 으로 앞당긴 별도 분할로 잰다.

`fit_trajectory.py` 와 `validate_trajectory.py` 는 2단계 **발병 궤적**의 재료다. 표는 단면 유병률을 illness-death 모형으로 뒤집고 사망연계 초과사망으로 보정한 것이라 **하한에 가깝다**. 정리는 [41번 문서](../docs/41_onset_trajectory.md).

`experiment_features.py` 는 프리셋 셋으로 돈다. `legacy` 는 가족력처럼 2018 년까지만
있는 변수를 재려고 홀드아웃을 `2017_2018` 로 옮기고, `onboarding` 과 `indices` 는
운영 홀드아웃(`2021_2023`)을 그대로 쓴다.

`export_ensemble.py` 는 XGBoost 3시드 + CatBoost 3시드를 `artifacts/models_ensemble/` 로
내보낸다. 배포 위치(`artifacts/models/`)는 **안 바꿨다** — compose 가 후자를 마운트하므로
지금 상태에서 서빙 동작은 그대로다.

`targets.DERIVED` 의 임상 지수 13 개는 **기본으로 꺼져 있다**(`ENABLED_INDICES` 가 비어
있다). 26번 문서의 실측이 "일괄 적용은 손해"라고 나와서다. 켜는 것은
`enable_indices()` 로 한 항목씩 한다.

`targets.py` 와 `export_multi.py` 가 위험한 쪽이다. 둘 다 지표로 잡히지 않는
실패를 하고, 그래서 각각 회귀 검사가 붙어 있다 — 라벨 누출은
`app/tests/prediction_apis` 의 `test_label_defining_measurements_are_not_model_inputs`,
직렬화는 같은 파일의 `test_pure_python_matches_sklearn` 이 잡는다.

기존 2질환 경로(`train_risk.py` · `export_model.py` · `refine.py` · `experiments.py`)는
그대로 둔다. 비교 대조군이고, `artifacts/models_legacy/` 에 그때 번들이 있다.

## 빠른 실행

```bash
cd ..                                   # project/
uv sync --group ds
python modeling/data/download_nhanes.py

cd modeling/data
../../.venv/Scripts/python.exe load_nhanes.py --adults-only --out processed/nhanes_pooled.csv
../../.venv/Scripts/python.exe load_brfss_indicators.py --out processed/brfss_indicators.csv
../../.venv/Scripts/python.exe load_framingham.py --out processed/framingham.csv
../../.venv/Scripts/python.exe build_unified.py

cd ..
../.venv/Scripts/python.exe train_multi.py      # 질환 × tier × 모델 전부 측정하고 고른다
../.venv/Scripts/python.exe compare_tiers.py    # 개선이 우연인지 짝지은 부트스트랩으로 검정
../.venv/Scripts/python.exe export_multi.py     # 고른 구성을 서빙 JSON 으로
../.venv/Scripts/python.exe engine_agreement.py --tier basic --write-bundles
../.venv/Scripts/python.exe engine_agreement.py --tier lab   --write-bundles
```

`export_multi.py` 는 `train_multi.py` 가 남긴 `artifacts/multi_target_results.json`
에서 선택을 읽는다. 그 파일 없이 돌리면 무엇을 내보낼지 모른다고 하며 멈춘다.

`engine_agreement.py` 는 **번들이 나온 뒤에** 돌린다. 규칙 엔진을 같은 사람들에게
돌려서 ML 확률 구간별 학회 기준 초과율을 세고, 그 표를 번들의 `rule_anchor` 에
써 넣는다. 화면의 "이 확률대의 100명 중 N명" 문장이 거기서 나온다.

`raw/`와 `processed/`는 git에 올리지 않는다. 위 명령으로 동일하게 재현된다.
`artifacts/models/`(약 2.5MB)는 올린다 — compose 가 이 디렉터리를 API 컨테이너에
읽기 전용으로 마운트한다.
