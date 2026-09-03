# 단일 모델 번들 — 되돌리기용 스냅샷

`models/` 를 시드 앙상블(모델 2종 × 시드 3개)로 바꾸기 전의 번들이다. 질환 하나당
모델 하나였던 시절의 것이고, [30번 문서](../../../docs/30_ensemble_serving.md) §5.4 가
"내려간 두 칸(지방간 일반형·고중성지방 일반형)을 되돌릴지" 를 열어 두면서 여기를 가리킨다.

## 그대로 복사하면 안 된다

**이 스냅샷은 2026-08 말 상태에서 멈춰 있고, 그 뒤 셋이 바뀌었다.** 파일을 `models/`
로 복사하면 셋이 같이 돌아온다.

| 무엇 | 지금 | 여기 |
|---|---|---|
| 빈혈 단조 제약 | `mean_arterial_pressure: -1` 로 고침 | 옛 방향 그대로 — 19번 문서의 빈혈 수치(0.7157/0.8171)가 이 제약으로 잰 값이다 |
| `difficulty_walking` | 뺐다(홀드아웃 커버리지 0%) | 특징에 들어 있다 |
| `education_level` | 뺐다(제품 판단, 등급 변동 1.5%) | 특징에 들어 있다 |

앞의 둘은 [42번 문서](../../../docs/42_ml_evaluation_strategy.md) §6.1 · §5,
셋째는 `modeling/targets.py` 의 `BASIC_FEATURES` 주석에 근거가 있다.

## 되돌려야 한다면

복사하지 말고 **그 시점 설정으로 다시 뽑는다.** 번들은 파일 단위라 한 칸만 되돌리는
데 코드가 들지 않는다.

```bash
# 되돌릴 칸만 지정해서 다시 내보낸다
uv run python modeling/export_ensemble.py --target fatty_liver hypertg --tiers basic

# 번들이 나온 뒤에 앵커를 다시 주입한다 — 재export 가 사후 주입물을 지운다
uv run python modeling/engine_agreement.py --tier basic --write-bundles
```

옛 특징 집합까지 그대로 재현해야 한다면 `git log -- modeling/targets.py` 로 그 시점
커밋을 찾아 `BASIC_FEATURES` 를 되돌린 뒤 위 명령을 돌린다. 이 디렉터리의 JSON 은
**무엇이 달랐는지 대조하는 용도**로만 쓴다.

## 왜 지우지 않았나

30번 문서의 결정이 아직 열려 있고, 그 결정을 하려면 "예전 번들이 이 칸에서 몇이었나"
를 볼 자료가 필요하다. 지우면 그 숫자를 다시 학습해서 얻어야 한다. 결정이 닫히면
이 디렉터리도 같이 닫는다.
