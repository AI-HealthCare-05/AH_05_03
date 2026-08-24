# 변수 매핑표 — 온보딩 입력 ↔ 해외 학습 데이터

온보딩 화면(`docs/planning/02_IA_화면목록.md` SCR-ONBD-02~05)에서 사용자가 실제로 입력하는 값만 모델 입력으로 쓴다. 학습 데이터에만 있고 사용자가 줄 수 없는 변수를 쓰면 서빙 시점에 정보 누수가 된다.

커버리지는 NHANES 4개 주기 통합 성인 25,457명 기준 실측값이다.

## 1. 기본정보 — SCR-ONBD-02

| 온보딩 항목 | canonical | NHANES 통합 | 커버리지 | UCI 891 | Framingham |
|---|---|---|---:|---|---|
| 나이 | `age` | `RIDAGEYR` | 100% | 13단계 구간 → 중앙값 | `age` 연속 |
| 성별 | `sex` | `RIAGENDR` | 100% | `Sex` | `male` |

## 2. 가족력 — SCR-ONBD-02

| 온보딩 항목 | canonical | NHANES 통합 | 커버리지 | 비고 |
|---|---|---|---:|---|
| 당뇨 가족력 | `fh_diabetes` | `MCQ300C` | **65.8%** | 2013–2018 주기에만 존재 |
| 심혈관 가족력 | `fh_cvd` | `MCQ300A` | **65.3%** | 동일 |
| 고혈압 가족력 | `fh_hypertension` | **없음** | 0% | NHANES가 물은 적이 없다 |

가족력을 쓰면 학습 표본이 19,190 → 13,415로 줄고 2021–2023 주기 전체가 빠진다. **가족력을 넣은 모델과 뺀 모델을 둘 다 만들어 비교하는 쪽을 권한다.** 고혈압 가족력은 화면에 남기되 모델 입력에서는 제외한다.

## 3. 생활습관 — SCR-ONBD-03

| 온보딩 항목 | canonical | NHANES 통합 | 커버리지 | UCI 891 |
|---|---|---|---:|---|
| 흡연 | `smoking_status` | `SMQ020`+`SMQ040` → never/former/current | 99.8% | `Smoker` (never만 판별 가능) |
| 음주 | `alcohol_days_per_year` | `ALQ121` 또는 `ALQ120Q`+단위 | 81.2% | `HvyAlcoholConsump` (임계 플래그) |
| 중강도 활동 | `moderate_min_per_week` | 긴/짧은 형식 각각 유도 | 99.6% | 없음 |
| 고강도 활동 | `vigorous_min_per_week` | 동일 | 99.7% | 없음 |
| 좌식 시간 | `sedentary_min_per_day` | `PAD680` | 99.2% | 없음 |
| 수면 | `sleep_hours` | `SLD012` / `SLD010H` | 99.2% | 없음 |
| 채소·과일 | `veg_fruit_servings_per_day` | **없음** | 0% | `Fruits`+`Veggies` → `veg_fruit_daily` |
| 활동 여부 | `physical_activity_any` | — | — | `PhysActivity` |

`ALQ121_TO_DAYS`(빈도 범주 → 연간 일수)와 `ALQ120U` 단위 환산은 `load_nhanes.py` 상단에 있다. 구간 응답을 점추정으로 바꾼 근사값이다.

## 4. 신체·측정값 — SCR-ONBD-04

| 온보딩 항목 | canonical | NHANES 통합 | 커버리지 | Framingham |
|---|---|---|---:|---|
| 키 | `height_cm` | `BMXHT` | 88.9% | 없음 |
| 체중 | `weight_kg` | `BMXWT` | 88.9% | 없음 |
| BMI | `bmi` | `BMXBMI` | 88.7% | `BMI` |
| 허리둘레 | `waist_cm` | `BMXWAIST` | 84.8% | 없음 |
| 수축기 혈압 | `sbp` | `BPXSY1~4` 또는 `BPXOSY1~3` 평균 | 86.7% | `sysBP` |
| 이완기 혈압 | `dbp` | 동일 (0은 "청취 불가"라 결측 처리) | 86.7% | `diaBP` |

## 5. 검사값 (선택) — SCR-ONBD-05

비우면 일반형, 채우면 정밀형으로 분기한다.

| 온보딩 항목 | canonical | NHANES 통합 | 커버리지 |
|---|---|---|---:|
| 당화혈색소 | `hba1c` | `LBXGH` | 85.8% |
| 총콜레스테롤 | `total_chol` | `LBXTC` | 84.1% |
| HDL | `hdl` | `LBDHDD` | 84.1% |
| 크레아티닌 | `creatinine` | `LBXSCR` | 83.7% |
| eGFR | `egfr` | CKD-EPI 2021로 파생 | 83.7% |
| AST / ALT | `ast` / `alt` | `LBXSATSI` / `LBXSASSI` | 83.6% / 83.5% |
| **공복혈당** | `fasting_glucose` | `LBXGLU` | **42.8%** |
| LDL | `ldl` | `LBDLDL` | 40.7% |
| 중성지방 | `triglyceride` | `LBXTLG` 또는 `LBXTR` | 41.2% |

공복혈당·LDL·중성지방이 40%대인 것은 공복 서브샘플에게만 측정하기 때문이다. **HbA1c는 85.8%라서 당뇨 라벨의 주 근거로는 HbA1c가 공복혈당보다 낫다.**

## 6. 라벨

| 라벨 | 정의 | NHANES 통합 | UCI 891 | Framingham |
|---|---|---:|---:|---:|
| `label_dm_prevalent` | FPG ≥126 또는 HbA1c ≥6.5 또는 진단·투약 | 18.27% | 13.93%¹ | 2.57% |
| `label_htn_prevalent` | SBP ≥140 또는 DBP ≥90 또는 진단·투약 | 42.42% | 42.90%¹ | 38.56% |
| `label_dm_undiagnosed` | 측정치는 기준 초과인데 진단·투약 없음 | 3.29% | — | 0% |
| `label_htn_undiagnosed` | 동일 | 5.85% | — | 7.50% |
| `label_prediabetes` | FPG 100–125 또는 HbA1c 5.7–6.4 | 34.06% | — | — |
| `label_chd_10yr` | 10년 내 관상동맥질환 발생 | — | — | **15.19%** |

¹ 자가보고 기반이라 NHANES의 측정 기반 라벨과 성질이 다르다. 같은 학습셋에 섞지 않는다.

임계값은 `labels.py`의 `Thresholds`에 모여 있다. 통용 기준을 따랐을 뿐 임상 검토를 받지 않았다 — 화면에 나가기 전에 `reviewed_by`를 채워야 한다.

## 7. 정리 — 이 매핑에서 나온 판단

- **주 학습은 NHANES 통합.** 실측 수치와 생활습관을 한 사람에게서 받은 유일한 자료이고, 온보딩 입력과 가장 넓게 겹친다.
- **당뇨 라벨은 HbA1c 우선.** 공복혈당만 쓰면 표본이 절반으로 줄어든다.
- **가족력은 A/B로 검증.** 넣으면 정확도가 오를 수 있지만 표본이 30% 줄고 최신 주기가 통째로 빠진다.
- **UCI 891은 규모 보조·외부 대조로만.** 자가보고 라벨을 측정 라벨과 섞지 않는다.
- **Framingham은 발병 예측의 형식을 보여주는 용도.** 목표 질환도 인구도 다르다는 걸 모델 카드에 쓴다.
- **한국인 보정은 현재 구성으로 불가능하다.** 국내 자료가 열리기 전까지는 한계로 명시하는 것 외에 방법이 없다.
