"""공공데이터포털 응답 봉투에서 항목 목록을 꺼낸다.

**0건은 빈 객체가 아니라 빈 문자열로 온다.** `{"response": {"body": {"items": ""}}}`
가 이 API 들의 정상적인 "결과 없음" 응답이다. 그래서 아래처럼 한 줄로 이어 붙이면
그 빈 문자열에 `.get` 을 불러 `AttributeError` 가 난다.

    payload.get("response", {}).get("body", {}).get("items", {}).get("item", [])

이 예외는 호출부가 잡는 `httpx.HTTPError`·`ValueError`·`TypeError` 어디에도 들지
않는다. 그래서 두 곳에서 서로 다른 모습으로 새어 나왔다 — 국립중앙의료원 병원·약국·
응급실 검색에서는 넓은 `except Exception` 에 걸려 정상적인 0건이 "일시적인 오류가
발생했습니다" 안내로 둔갑했고, 기상청 날씨 조회에서는 감싸는 try 가 없어 채팅 요청
전체를 깨뜨렸다.

봉투 모양은 API 마다 두 가지다. 국립중앙의료원·기상청은 `items` 밑에 `item` 을 한 겹
더 두고, 에어코리아는 `items` 가 바로 목록이다. 둘 다 받는다.
"""

from typing import Any

__all__ = ["extract_public_data_items"]


def extract_public_data_items(payload: Any) -> list[dict[str, Any]]:
    """응답 본문에서 항목 목록을 돌려준다. 0건이거나 모양이 어긋나면 빈 목록이다."""
    if not isinstance(payload, dict):
        return []

    response = payload.get("response")
    body = response.get("body") if isinstance(response, dict) else None
    items_node = body.get("items") if isinstance(body, dict) else None

    # `items` 가 목록이면(에어코리아) 그대로, 사전이면(국립중앙의료원·기상청) 한 겹 더.
    # 그 밖의 값 — 0건을 뜻하는 빈 문자열 — 은 아래 검사에서 빈 목록이 된다.
    items = items_node.get("item", []) if isinstance(items_node, dict) else items_node

    if isinstance(items, dict):
        return [items]
    if isinstance(items, list):
        return [item for item in items if isinstance(item, dict)]
    return []
