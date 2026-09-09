"""공공데이터포털 응답 봉투 파싱.

0건일 때 오는 `items: ""` 에 그대로 `.get` 을 부르면 `AttributeError` 가 난다.
그 예외는 호출부가 잡는 `httpx.HTTPError`·`ValueError`·`TypeError` 어디에도 들지
않아서, 병원 검색에서는 0건이 "일시적인 오류" 로 둔갑했고 날씨 조회에서는 채팅
요청 전체를 깨뜨렸다.
"""

from app.core.utils.public_data import extract_public_data_items


def test_zero_result_shapes_return_empty_list() -> None:
    assert extract_public_data_items({"response": {"body": {"items": ""}}}) == []
    assert extract_public_data_items({"response": {"body": {"items": {}}}}) == []
    assert extract_public_data_items({"response": {"body": {"items": {"item": []}}}}) == []
    assert extract_public_data_items({"response": {"body": {"items": []}}}) == []


def test_malformed_envelopes_return_empty_list() -> None:
    assert extract_public_data_items(None) == []
    assert extract_public_data_items({}) == []
    assert extract_public_data_items("") == []
    assert extract_public_data_items({"response": ""}) == []
    assert extract_public_data_items({"response": {"body": ""}}) == []
    assert extract_public_data_items({"response": {"header": {"resultCode": "03"}}}) == []


def test_nested_item_shape_is_unwrapped() -> None:
    """국립중앙의료원·기상청은 items 밑에 item 을 한 겹 더 둔다."""
    single = {"response": {"body": {"items": {"item": {"dutyName": "가나의원"}}}}}
    assert extract_public_data_items(single) == [{"dutyName": "가나의원"}]

    many = {"response": {"body": {"items": {"item": [{"category": "T1H"}, {"category": "REH"}]}}}}
    assert extract_public_data_items(many) == [{"category": "T1H"}, {"category": "REH"}]


def test_flat_list_shape_is_returned_as_is() -> None:
    """에어코리아는 items 가 바로 목록이다."""
    payload = {"response": {"body": {"items": [{"stationName": "강남구", "pm10Value": "24"}]}}}
    assert extract_public_data_items(payload) == [{"stationName": "강남구", "pm10Value": "24"}]


def test_non_dict_entries_are_dropped() -> None:
    """목록에 문자열이 섞여 오면 호출부가 item.get 에서 깨진다."""
    payload = {"response": {"body": {"items": {"item": [{"dutyName": "가나의원"}, "", None]}}}}
    assert extract_public_data_items(payload) == [{"dutyName": "가나의원"}]
