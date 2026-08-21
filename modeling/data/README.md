# 만성질환 학습 데이터 — 해외 공개 자료 단독 구성

국내 자료(NHIS 건강검진정보·KNHANES·한국의료패널) 확보가 막혀 해외 공개 데이터만으로 재구성했다. 참여기업 브리프가 "Kaggle, AIHub, HuggingFace 등 공개 데이터셋"을 명시하므로 범위 안이다.

| 데이터 | 역할 | 규모 | 취득 | 상태 |
|---|---|---:|---|---|
| **NHANES 8개 주기 통합** | 주 학습 (실측 수치, 검사값 분기) | 48,895 | 스크립트 | 완료 |
| **CDC Diabetes Health Indicators** | 일반형 대규모 보조 (UCI 891 / BRFSS 2015) | 253,680 | 스크립트 | 완료 |
| **Framingham teaching set** | 발병(10년 CHD) 라벨 데모 | 4,240 | 스크립트 | 완료 |

세 자료는 성질이 달라서 **한 테이블로 합치지 않는다.** 각각 다른 모델과 다른 모델 카드를 갖는다.

## 폴더 구조

```
modeling/data/
├── raw/                          ← 원본. git에 올리지 않는다
│   ├── nhanes/{2005_2006 … 2021_2023}/  8개 주기 334 MB
│   ├── brfss_health_indicators/  13.5 MB
│   └── framingham/               0.2 MB
├── processed/                    ← 로더 산출물. git에 올리지 않는다
├── schema.py                     ← 공통 분석 스키마
├── labels.py                     ← 라벨 정의와 임계값
├── download_nhanes.py            ← 8개 주기 자동 다운로드
├── load_nhanes.py                ← 주기별 차이를 감지해 통합
├── load_brfss_indicators.py      ← UCI 891
├── load_framingham.py            ← 10년 CHD
├── load_nhis_checkup.py          ← 국내 재개 시 사용 (미사용)
├── load_khp.py                   ← 국내 재개 시 사용 (미사용)
└── VARIABLE_MAP.md               ← 온보딩 입력 ↔ 데이터 변수 대조표
```

## 재현 명령

```bash
uv sync --group ds

python modeling/data/download_nhanes.py            # 8개 주기, 334 MB
cd modeling/data
../../.venv/Scripts/python.exe load_nhanes.py --adults-only --out processed/nhanes_pooled.csv
../../.venv/Scripts/python.exe load_brfss_indicators.py --out processed/brfss_indicators.csv
../../.venv/Scripts/python.exe load_framingham.py --out processed/framingham.csv
```

BRFSS·Framingham 원본이 없으면 각각 이렇게 받는다.

```bash
curl -L -o raw/brfss_health_indicators/cdc_diabetes_health_indicators.csv \
  https://archive.ics.uci.edu/static/public/891/data.csv
curl -L -o raw/framingham/framingham.csv \
  https://raw.githubusercontent.com/GauravPadawe/Framingham-Heart-Study/master/framingham.csv
```

## 0. 2026-08-21에 늘어난 것 — 파일 세 개, 질환 여덟 개

같은 8개 주기에서 CDC 파일 세 개를 더 받았다. 신청도 승인도 없다.

| 파일 | 주는 것 | 새로 만들어진 라벨 |
|---|---|---|
| `CBC` | 혈색소 (`LBXHGB`) | 빈혈 |
| `ALB_CR` | 요알부민·요크레아티닌 | 만성콩팥병의 두 번째 KDIGO 기준(ACR ≥30) |
| `LUX` | 간 탄성초음파 감쇠계수 (`LUXCAPM`) | **지방간 — 지수가 아니라 실측** |

`LUX`는 2017–2018과 2021–2023 두 주기에만 있다. 그래도 이걸 받은 이유는 HSI 같은 지수 라벨이 BMI를 자기 안에 담고 있어서 "BMI로 BMI를 예측하는" 모델이 되기 때문이다. CAP은 초음파 실측이라 그 순환이 없고, AST·ALT·γ-GTP를 **특징으로** 쓸 수 있다.

그리고 이미 받아 둔 `BIOPRO`에서 γ-GTP(`LBXSGTSI`)·요산(`LBXSUA`)·알부민(`LBXSAL`)을, `BPQ`에서 지질강하제 복용(`BPQ100D`/`BPQ101D`)을 추가로 읽는다. 파일을 더 받은 게 아니라 **읽지 않던 컬럼을 읽었다.**

라벨 정의와 성능은 [`docs/19_multi_disease_model_results.md`](../../docs/19_multi_disease_model_results.md).

## 1. NHANES 통합 (주 학습)

성인 48,895명. 주기별 5,247 / 6,088 / 6,384 / 5,719 / 5,922 / 5,854 / 5,712 / 7,969. 연령 19~85세, 평균 49.5세.

2026-08-20에 2005–2012 4개 주기를 추가했다. 표본이 두 배가 됐지만 **성능은 변하지 않았다** — [21번](../../docs/21_modeling_overview.md) §4.7 참조. 2003-2004 이전은 넣지 않았다. GLU·GHB·SLQ 가 없거나 다른 이름을 써서 라벨을 만들 수 없다.

주기마다 조사 설계가 달라서 로더가 이를 **감지해서** 처리한다. 하드코딩이 아니라 파일에 있는 컬럼을 보고 분기한다.

| 항목 | 2013–2018 | 2021–2023 |
|---|---|---|
| 혈압 | `BPX` 청진식, 최대 4회 | `BPXO` 오실로메트릭, 3회 |
| 고혈압 투약 | `BPQ040A` | `BPQ150` |
| 신체활동 | 긴 GPAQ 형식 (`PAQ650`/`PAQ665` 게이트) | 짧은 여가활동 형식 (`PAD790Q`) |
| 음주 | `ALQ120Q` + 단위 | `ALQ121` 빈도 범주 |
| 가족력 | `MCQ300A`/`MCQ300C` 있음 | **없음** |
| 수면 | `SLD010H`(2013–14) → `SLD012` | `SLD012` |

두 형식 모두 **여가시간 활동만** 계산한다. 긴 형식에는 직업 활동도 있지만 짧은 형식에 대응이 없어 통합 컬럼의 의미가 달라진다.

주기별 유병률이 서로 일치해 통합이 어긋나지 않았음을 보여준다.

| 주기 | 당뇨 유병 | 고혈압 유병 |
|---|---:|---:|
| 2013–2014 | 16.3% | 41.5% |
| 2015–2016 | 19.1% | 41.4% |
| 2017–2018 | 20.6% | 45.1% |
| 2021–2023 | 17.4% | 41.9% |

**사용 가능한 행**

| 조합 | 행 수 |
|---|---:|
| 일반형 12개 입력 (가족력 제외) | 19,190 |
| 일반형 + 가족력 | 13,415 |
| 정밀형 (+공복혈당·HbA1c) | 9,194 |

## 2. CDC Diabetes Health Indicators (일반형 보조)

253,680행 × 21변수. 당뇨 13.93%, 고혈압 42.90%.

**전부 자가보고다.** `HighBP`·`Diabetes_binary` 모두 "의사에게 들었다"이지 측정 기준 충족이 아니다. NHANES의 측정 기반 라벨과 한 학습셋에 섞으면 서로 다른 타깃을 뭉개게 된다. 그리고 `Diabetes_binary`는 **전당뇨와 당뇨를 한 양성 클래스로 합쳐 놨다.**

대신 NHANES에 없는 걸 준다 — 채소·과일 섭취(`veg_fruit_daily`)와 신체활동 여부(`physical_activity_any`), 그리고 10배 규모.

## 3. Framingham (발병 라벨)

4,240행, `TenYearCHD` 양성률 15.19%. 즉시 확보 가능한 자료 중 **전향적 발병 라벨을 가진 유일한 데이터**다.

네 가지를 반드시 같이 말해야 한다.

- **출처.** 널리 유통되는 교육용 추출본을 GitHub 미러에서 받았다. 정본은 NHLBI BioLINCC 교육용 데이터셋이고 등록이 필요하다. "Framingham 코호트 전체"라고 말하면 안 된다.
- **인구.** 1948년 미국 매사추세츠 주민. 2026년 한국 사용자와 거리가 멀다.
- **결과변수.** 관상동맥질환이지 당뇨·고혈압이 아니다. 발병 예측의 **틀을 보여줄 뿐** 목표 질환에 답하지 않는다.
- **혈당.** 공복 여부가 불명확해 `fasting_glucose`가 아니라 `casual_glucose`로 따로 담았다.

## 이 구성이 감당하는 것과 못 하는 것

**할 수 있다**
- 당뇨·고혈압 위험도 산출 (측정 기준 유병 + 미진단 선별)
- 검사값 유무에 따른 일반형/정밀형 분기
- SHAP 기여 요인과 우선 관리 영역 도출
- 주기 홀드아웃 검증 (2021–2023을 시험 세트로)

**할 수 없다**
- **한국인 대상 보정.** 전부 미국 인구다. 이건 모델 카드와 발표 자료에 한계로 명시해야 하고, 숨기면 평가에서 더 크게 걸린다.
- 당뇨·고혈압의 발병 시점 예측. Framingham은 CHD만 답한다.
- 고혈압 가족력. NHANES는 이 항목을 물은 적이 없다.

## 남은 확인 사항

- **라이선스.** NHANES와 UCI 891은 공개 자료지만 서비스 이용·재배포 범위는 별도 확인. Framingham 미러는 출처 표기를 어떻게 할지 정해야 한다.
- **임계값 임상 검토.** `labels.py`의 `Thresholds.reviewed_by`가 비어 있다. 화면에 숫자가 나가기 전에 채운다.
- **국내 자료 재개 시.** `load_nhis_checkup.py`와 `load_khp.py`는 그대로 두었다. KoGES·AI-Hub IRB가 풀리거나 KLoSA(고용정보원 가입만으로 다운로드) 경로가 열리면 국내 보정 데이터로 붙일 수 있다.
