"""스트리밍으로 들어오는 JSON 조각에서 사람이 읽을 문자열을 점진적으로 뽑는다.

## 왜 이게 필요한가

문서 인식은 `response_mime_type="application/json"` + `response_schema=RawOcrData` 로
부르므로 모델이 흘려 보내는 것은 **문장이 아니라 JSON 문서**다. 청크를 그대로 화면에
붙이면 사용자가 보는 것은 이렇다.

    {"text": "검사기관: 강서구보건소\n검사일자: 2024-

진행 중이라는 신호는 되지만 읽을거리는 아니다. 그렇다고 다 받은 뒤에 파싱하면 스트리밍을
붙인 이유가 사라진다. 그래서 **덜 온 JSON 에서 `text` 필드만 유효한 데까지 해독해**
늘어난 만큼을 델타로 돌려준다.

## 왜 프런트가 아니라 서버에서 하는가

프런트에서 하면 같은 파서를 TypeScript 로 한 벌 더 쓰게 되고, 두 벌이 어긋나는 순간
증상이 "글자가 이상하게 깨짐" 이라 원인을 찾기 어렵다. 서버가 깨끗한 텍스트 델타만
내보내면 프런트는 이어 붙이기만 하면 된다.

## 어디서 잘리는지가 전부다

JSON 문자열 안에서 청크 경계는 아무 데나 떨어진다. 위험한 자리가 둘이다.

1. **역슬래시 뒤** — `"\\` 까지만 왔다. 다음 글자가 `n` 이면 줄바꿈, `"` 면 따옴표다.
   여기서 끊고 해독하면 남은 역슬래시가 잘못된 이스케이프가 된다.
2. **`\\u` 부분 수신** — `\\u00` 까지만 왔다. 네 자리가 다 와야 한 글자다.

둘 다 "안전한 경계까지만 잘라 해독" 으로 푼다. 남은 꼬리는 버리지 않고 다음 청크와
이어 붙여 다시 본다.
"""

from __future__ import annotations

import json


def _safe_cut(fragment: str) -> int:
    """`fragment` 를 해독해도 되는 마지막 위치를 돌려준다.

    이스케이프가 중간에 잘린 꼬리는 잘라 낸다 — 다음 청크가 오면 이어서 다시 본다.
    """
    index = len(fragment)
    # 뒤에서부터 역슬래시가 몇 개 연달아 있는지 센다. 홀수면 마지막 하나가
    # 다음 글자를 기다리는 중이다 (`\\\\` 는 이스케이프된 역슬래시라 완결이다).
    trailing = 0
    while trailing < index and fragment[index - 1 - trailing] == "\\":
        trailing += 1
    if trailing % 2 == 1:
        return index - 1

    # `\uXXXX` 가 덜 왔는지 본다. 뒤 5자 안에 `\u` 가 있고 그 뒤가 4자에 못 미치면
    # 그 `\` 앞에서 끊는다.
    tail = fragment[-6:]
    position = tail.rfind("\\u")
    if position != -1:
        digits = len(tail) - position - 2
        # 앞의 역슬래시가 짝수 개여야 진짜 이스케이프다.
        backslashes = 0
        absolute = index - len(tail) + position
        while backslashes < absolute and fragment[absolute - 1 - backslashes] == "\\":
            backslashes += 1
        if backslashes % 2 == 0 and digits < 4:
            return absolute
    return index


class PartialJsonTextReader:
    """덜 온 JSON 을 계속 먹여 주면 `text` 필드의 새로 늘어난 부분만 돌려준다.

        reader = PartialJsonTextReader()
        reader.push('{"text": "검사기관: 강서')   # -> '검사기관: 강서'
        reader.push('구보건소\\n검사일자:')        # -> '구보건소\n검사일자:'

    `text` 키가 아직 안 나왔으면 빈 문자열이다. 모델이 필드를 어떤 순서로 내보내든
    (`tables` 가 먼저 올 수도 있다) 나오는 시점부터 따라간다.
    """

    __slots__ = ("_raw", "_emitted", "_closed")

    # 스키마의 필드명. 바뀌면 여기도 바꿔야 한다 — `RawOcrData.text` 와 같아야 한다.
    KEY = '"text"'

    def __init__(self) -> None:
        self._raw = ""
        self._emitted = 0
        self._closed = False

    def push(self, delta: str) -> str:
        """원본 JSON 청크를 먹이고 **새로 해독된 텍스트만** 돌려준다."""
        if self._closed or not delta:
            return ""
        self._raw += delta
        decoded = self._decode()
        if decoded is None or len(decoded) <= self._emitted:
            return ""
        fresh = decoded[self._emitted :]
        self._emitted = len(decoded)
        return fresh

    def _decode(self) -> str | None:
        """지금까지 받은 것으로 `text` 값을 최대한 해독한다. 아직이면 None."""
        key_at = self._raw.find(self.KEY)
        if key_at == -1:
            return None
        # `"text"` 다음의 콜론과 여는 따옴표를 찾는다. 공백이 끼어 있을 수 있다.
        colon = self._raw.find(":", key_at + len(self.KEY))
        if colon == -1:
            return None
        open_quote = self._raw.find('"', colon + 1)
        if open_quote == -1:
            return None

        body = self._raw[open_quote + 1 :]
        # 값이 끝났는가 — 이스케이프되지 않은 따옴표를 찾는다.
        end = _find_closing_quote(body)
        if end is not None:
            self._closed = True
            body = body[:end]
        else:
            body = body[: _safe_cut(body)]

        try:
            return json.loads(f'"{body}"')
        except ValueError:
            # 안전 경계를 잘못 잡은 드문 경우. 다음 청크에서 다시 본다.
            return None


def _find_closing_quote(body: str) -> int | None:
    """이스케이프되지 않은 닫는 따옴표의 위치. 아직 없으면 None."""
    index = 0
    length = len(body)
    while index < length:
        char = body[index]
        if char == "\\":
            index += 2
            continue
        if char == '"':
            return index
        index += 1
    return None
