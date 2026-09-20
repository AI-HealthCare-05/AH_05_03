# 이어봄 도구 목록 (현재 코드)

- 상태: 2단계 계약. 권한 게이트(#206)와 러너(#207)는 아직 강제하지 않는다.
- 정본: `app/services/agent_tools/registry.py`
- 기준: [54_agent_baseline.md](54_agent_baseline.md), [ADR-0015](adr/0015-bounded-agent-on-policy-and-evidence.md)

없는 도구를 이 표에 넣지 않는다. `search_hospital`, RapidOCR, 원본 서류 판독의 대화형 호출은 코드에 없다.

노출:

| 값 | 뜻 |
|---|---|
| `model_selectable` | 챗봇이 한 차례 tool calling으로 고를 수 있다 |
| `server_prefetch` | 서버가 메인 LLM 전에 결정론적으로 실행한다. 모델에 열지 않는다 |
| `not_agent_callable` | registry에만 두고 대화형 도구로 쓰지 않는다 |

한도(`max_calls_per_turn`, `timeout_ms`, `cost_class`)는 자리만 둔다. 값은 4단계에서 강제한다.

| 이름 | access | risk | 노출 | 사용 | 입력 필드 | 비고 |
|---|---|---|---|---|---|---|
| `query_health_records` | read | high | model_selectable | 켜짐 | record_type, period, metric, operator, threshold, aggregation | 계정·프로필 ID 없음. 반환에 이름·문서 원문·전체 표 없음 |
| `get_alcohol_consultation_snapshot` | read | high | server_prefetch | 켜짐 | (없음) | 음주 주제 개인기록 스냅샷. 모델에 미등록 |
| `search_nearby_emergency_room` | read | low | model_selectable | 켜짐 | latitude, longitude, stage1, stage2, query, radius | 공공 응급의료 |
| `search_nearby_hospital` | read | low | model_selectable | 켜짐 | query, latitude, longitude, radius, keyword, only_open | `search_hospital` 아님 |
| `search_nearby_pharmacy` | read | low | model_selectable | 켜짐 | query, stage1, stage2, latitude, longitude, radius, only_open | |
| `search_medication_info` | read | medium | model_selectable | 켜짐 | drug_name, target_drug_name | 식약처 |
| `search_food_nutrition` | read | low | model_selectable | 켜짐 | food_name | 식약처 영양 |
| `search_health_knowledge` | read | medium | server_prefetch | 켜짐 | query | KDCA 포털. 모델에 미등록 |
| `get_outdoor_health_conditions` | read | low | server_prefetch | 켜짐 | latitude, longitude | 날씨·대기질. 모델에 미등록 |
| `document_vision` | read | high | not_agent_callable | 꺼짐 | (없음) | 업로드 화면 전용 판독. 8단계 전까지 에이전트 호출 금지 |

`query_health_records` 기본 반환 필드: `record_type`, `metric`, `unit`, `operator`, `threshold`, `period`, `matched_days`, `matched_measurements`, `total_measurements`, `latest_matches`(최대 5), `empty_reason`, `message`.
