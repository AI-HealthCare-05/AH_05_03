# 이어봄 도구 목록 (현재 코드)

- 상태: 2단계 계약 + 3단계 권한 게이트(#206). 러너(#207)는 아직 없다.
- 정본: `app/services/agent_tools/registry.py`
- 모델에 넘기는 결과: `app/services/agent_tools/project.py`
- 권한: `app/services/agent_tools/policy.py`. Health Assistant `respond()`/`stream()`이 도구 실행 직전 DB 상태를 다시 읽어 강제한다.
- 기준: [54_agent_baseline.md](54_agent_baseline.md), [ADR-0015](adr/0015-bounded-agent-on-policy-and-evidence.md)

없는 도구를 이 표에 넣지 않는다. `search_hospital`, RapidOCR, 원본 서류 판독의 대화형 호출은 코드에 없다.

노출:

| 값 | 뜻 |
|---|---|
| `model_selectable` | 챗봇이 한 차례 tool calling으로 고를 수 있다 |
| `server_prefetch` | 서버가 메인 LLM 전에 결정론적으로 실행한다. 모델에 열지 않는다 |
| `not_agent_callable` | registry에만 두고 대화형 도구로 쓰지 않는다 |

한도(`max_calls_per_turn`, `timeout_ms`, `cost_class`)는 자리만 둔다. 값은 4단계에서 강제한다.

차단 이유 코드: `TOOL_NOT_REGISTERED`, `TOOL_NOT_MODEL_SELECTABLE`, `TOOL_DISABLED`, `TOOL_NOT_AUTHORIZED`, `TOOL_SCOPE_DENIED`, `TOOL_SESSION_REVOKED`, `TOOL_SESSION_CONTEXT_INCOMPLETE`, `TOOL_POLICY_CONTEXT_REQUIRED`. 사용자 문구는 공통으로 「요청한 기능을 지금은 사용할 수 없습니다.」이다.

`allowed_tools()`는 `exposure == model_selectable`만 반환한다. `search_health_knowledge` 같은 서버 선행 도구는 `allowed_prefetch_tools_for()`에 둔다. 건강기록 도구는 정책 컨텍스트 없이 실행하지 않는다. PIN·벽 세션은 행위자 ID와 현재 `session_epoch`가 빠지면 `TOOL_SESSION_CONTEXT_INCOMPLETE`다.

`query_health_records`가 목록에 있어도 세션 프로필이 아닌 대상, 역할 한도를 넘는 기간, `latest_matches`처럼 좁혀야 하는 필드는 잘린다. `self_only`는 가구 기록을 못 읽고, `restricted`는 음주 스냅샷과 일자별 수치를 못 받으며, 성년 대기 프로필은 본인이 아닐 때 건강기록 도구가 닫힌다. PIN 행위자 변경·epoch 증가·세션 무효는 다음 호출을 `TOOL_SESSION_REVOKED`로 거절한다. 컨텍스트는 도구 실행 직전 DB에서 다시 읽는다.

인증 모델(#206 제품 경로): 계정 JWT + 선택적 `X-Member-Session-Token`. 프런트는 서버가 준 `session_token`을 sessionStorage에만 두고 일반·스트리밍 챗봇 요청 헤더로 보낸다. 원문은 Langfuse·로그·오류 메시지에 남기지 않는다. 건강 비서 요청이 정책 컨텍스트를 읽으면 `health_assistant.policy_actor` 감사 이벤트만 남긴다. 필드는 `session_type`, `pin_session_valid`, HMAC `actor_profile_alias`다. 토큰·PIN·건강정보 원문은 없다. 벽 기기 토큰은 계정 JWT가 아니므로 현재 건강 비서 라우터에서 401/`TOKEN_INVALID`다. 벽 기기+PIN으로 봄이를 여는 경로는 아직 없고, 그 경로 테스트가 생기기 전에는 #206을 완료하지 않는다.

| 이름 | access | risk | 노출 | 사용 | 모델 반환 필드 |
|---|---|---|---|---|---|
| `query_health_records` | read | high | model_selectable | 켜짐 | record_type, metric, unit, operator, threshold, period, matched_days, matched_measurements, total_measurements, latest_matches, empty_reason, message |
| `get_alcohol_consultation_snapshot` | read | high | server_prefetch | 켜짐 | topic, blood_pressure, liver_tests, today_activities, recent_medications, recent_alcohol_records, missing_sections, message |
| `search_nearby_emergency_room` | read | low | model_selectable | 켜짐 | facility_type, total_count, message, items(name, address_summary, distance_m, phone_available, open_now) |
| `search_nearby_hospital` | read | low | model_selectable | 켜짐 | 위와 같음. 좌표·전화번호 원문 없음 |
| `search_nearby_pharmacy` | read | low | model_selectable | 켜짐 | 위와 같음 |
| `search_medication_info` | read | medium | model_selectable | 켜짐 | query, message, has_interaction_danger, items(product_name, ingredient_summary, precautions, source) |
| `search_food_nutrition` | read | low | model_selectable | 켜짐 | query, message, items(food_name, serving_size, calories, nutrient_summary, source) |
| `search_health_knowledge` | read | medium | server_prefetch | 켜짐 | query, message, items(title, summary, url, source) |
| `get_outdoor_health_conditions` | read | low | server_prefetch | 켜짐 | weather, air_quality, errors. 사용자 위경도 없음 |
| `document_vision` | read | high | not_agent_callable | 꺼짐 | (없음) |
