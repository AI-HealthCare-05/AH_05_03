# modeling

만성질환 위험도 모델. 데이터 취득부터 모델 평가·배포까지 이 폴더에서 끝난다.

**먼저 읽을 것 — [`docs/21_modeling_overview.md`](../docs/21_modeling_overview.md)**
어떤 데이터를 썼고 무엇을 했고 어디서 이어받으면 되는지가 그 문서에 있다.
질환 확장과 정밀형 tier 는 [`docs/19_multi_disease_model_results.md`](../docs/19_multi_disease_model_results.md).

| 목적 | 문서 |
|---|---|
| 전체 개요·작업 내역·이어받을 작업 | [`docs/21_modeling_overview.md`](../docs/21_modeling_overview.md) |
| **질환 10종 확장과 정밀형 성능** | [`docs/19_multi_disease_model_results.md`](../docs/19_multi_disease_model_results.md) |
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
