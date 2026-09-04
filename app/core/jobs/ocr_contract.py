"""문서 인식 작업 큐의 계약. **FastAPI 와 ai-worker 가 같이 읽는 유일한 정의다.**

`contract.py`(예측 큐)와 같은 이유로 존재하고 같은 규칙을 따른다. 스트림·그룹·키
공간만 다르다 — 한 스트림에 두 종류를 섞으면 소비자가 자기 것이 아닌 메시지를
집어 `XACK` 없이 버리게 된다.

## 왜 원본 이미지를 Redis 에 두는가

워커가 읽어야 한다. 대안은 요청 수명 안에서 동기로 Gemini 를 부르는 것뿐이고 그러면
큐가 성립하지 않는다. 그래서 [ADR-010](../../../docs/adr/0010-checkup-document-ocr-path.md)
§6 의 네 조건을 **예측 큐보다 더 좁게** 적용한다 — 여기 흐르는 것은 수치가 아니라
검진 결과지 원본이고, 이 저장소에서 가장 민감한 자료다.

1. TTL 은 `DEV_OCR_JOB_TTL_SECONDS`(예측 큐의 절반). 작업이 끝나면 원본을 **즉시 지운다**
2. 키에 계정·프로필 식별자를 넣지 않는다. 무작위 `job_id` 만 쓴다
3. 지속화를 켜지 않는다 (compose 의 `--save "" --appendonly no`)
4. 파일명·본문·인식 결과를 로그에 남기지 않는다. 찍는 것은 `job_id`·상태·소요 시간뿐

## 원본을 base64 로 싣는 이유

FastAPI 와 워커의 Redis 연결이 둘 다 `decode_responses=True` 다. 바이너리를 그대로
넣으면 읽는 쪽에서 유니코드 디코딩에 실패한다. 별도의 바이너리 연결을 하나 더 두는
방법도 있지만, 연결이 둘이 되면 **어느 쪽이 지속화 꺼진 인스턴스인지**를 두 곳에서
관리해야 한다. 33% 크기 손해를 받아들이고 예측 큐와 같은 배선을 쓴다.

대신 `DEV_OCR_JOB_MAX_TOTAL_BYTES` 로 한 작업의 원본 총합을 묶는다. 상한이 없으면
20MB 짜리를 여러 장 올려 Redis 메모리를 한 번에 밀어낼 수 있다.
"""

from __future__ import annotations

from app.core import config
from app.core.utils.enums import StrEnum


class OcrJobStatus(StrEnum):
    """작업 생애. `queued → running → succeeded | failed` 로만 움직인다."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


#: 끝난 작업. 폴링하는 쪽이 더 기다릴지 판단하는 데 쓴다.
OCR_TERMINAL_STATUSES = frozenset({OcrJobStatus.SUCCEEDED, OcrJobStatus.FAILED})

#: 해시 필드 이름. 예측 큐와 같은 이름을 쓰되 정의는 따로 둔다 — 한쪽 계약이
#: 바뀔 때 다른 쪽이 조용히 끌려가면 안 된다.
FIELD_STATUS = "status"
FIELD_PAYLOAD = "payload"
FIELD_RESULT = "result"
FIELD_ERROR = "error"
FIELD_CREATED_AT = "created_at"
FIELD_STARTED_AT = "started_at"
FIELD_FINISHED_AT = "finished_at"
FIELD_ATTEMPTS = "attempts"
FIELD_WORKER = "worker"


def ocr_stream_key() -> str:
    return f"{config.REDIS_KEY_PREFIX}:ocr:stream"


def ocr_job_key(job_id: str) -> str:
    """작업 해시 키. `job_id` 는 무작위 UUID 라서 계정을 되짚을 수 없다."""
    return f"{config.REDIS_KEY_PREFIX}:ocr:job:{job_id}"


def ocr_chunk_key(job_id: str) -> str:
    """부분 결과 스트림 키. 워커가 쓰고 FastAPI 가 SSE 로 중계한다.

    **Pub/Sub 이 아니라 스트림인 이유.** Pub/Sub 은 구독한 시점 이후만 받는다.
    사용자가 새로고침하거나 네트워크가 잠깐 끊겨 SSE 가 다시 붙으면 그 사이 조각이
    영영 사라져 글이 중간부터 시작한다. 스트림은 `0` 부터 다시 읽을 수 있어서
    재연결이 그냥 된다.

    **여기에도 인식 결과가 흐른다.** `ocr_contract` 상단 네 조건이 그대로 적용되고,
    TTL 은 결과 해시보다 짧은 `DEV_OCR_CHUNK_TTL_SECONDS` 다 — 완성본이 해시에
    있으므로 조각을 더 오래 들고 있을 이유가 없다.
    """
    return f"{config.REDIS_KEY_PREFIX}:ocr:chunks:{job_id}"


#: 부분 결과 스트림의 필드. `kind` 는 `delta` · `reset` 둘뿐이고, 완성 결과는 여기
#: 흐르지 않는다 — 그건 작업 해시의 `result` 가 단일 진실 원천이다. 두 곳에 쓰면
#: 어느 쪽이 맞는지 판단해야 하는 순간이 온다.
CHUNK_FIELD_KIND = "kind"
CHUNK_FIELD_TEXT = "text"
CHUNK_KIND_DELTA = "delta"
CHUNK_KIND_RESET = "reset"


#: 스트림 메시지의 유일한 필드. 원본은 해시에 있고 스트림에는 참조만 흐른다.
#: 스트림은 `MAXLEN` 으로 절단될 뿐 TTL 이 없어서, 원본을 여기 실으면 지울 시점을
#: 통제할 수 없다.
MESSAGE_FIELD_JOB_ID = "job_id"
