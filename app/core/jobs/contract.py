"""예측 작업 큐의 계약. **FastAPI 와 ai-worker 가 같이 읽는 유일한 정의다.**

키 이름·상태 값·TTL 을 두 곳에 적으면 한쪽만 바꾸는 사고가 난다. 오늘 이 저장소에서
같은 판단이 네 곳에 복사돼 있어 한 곳만 고쳤다가 아무것도 안 바뀐 일이 있었다
(`docs/34_project_rules_and_workflow.md` §0 사고 1). 큐는 프로세스 경계를 넘으므로
그 사고가 나면 증상이 "조용히 아무 일도 안 일어남"이다.

## Redis 의 두 역할

| 키 공간 | 용도 | 수명 |
| --- | --- | --- |
| `ieobom:rt:*` | 리프레시 토큰 저장소 (기존) | 토큰 만료까지 |
| `ieobom:predict:stream` | 예측 작업 스트림 | `MAXLEN` 으로 절단 |
| `ieobom:predict:job:{id}` | 작업 상태·결과 해시 | `JOB_TTL_SECONDS` |

**둘이 같은 인스턴스에 있고, 그래서 지속화를 끈다.** 예측 payload 에는 건강 수치가
들어가므로 RDB 스냅샷이나 AOF 로 디스크에 남으면 `docs/adr/0010` §6 의 조건을 어긴다.
compose 에서 `redis-server --save "" --appendonly no` 로 띄운다. 대가는 Redis 를
재시작하면 리프레시 토큰이 사라져 전원이 재로그인해야 하는 것이고, 이 프로젝트에서는
받아들일 수 있는 교환이다.

## 왜 payload 를 Redis 에 두는가

워커가 읽어야 한다. 대안은 요청 수명 안에서 동기로 채점하는 것뿐이고 그러면 큐가
성립하지 않는다. 그래서 `docs/adr/0010` §6 의 네 조건을 그대로 적용한다.

1. TTL 은 `JOB_TTL_SECONDS`, 작업이 끝나면 payload 필드를 **즉시 지운다**
2. 키에 계정·프로필 식별자를 넣지 않는다. 무작위 `job_id` 만 쓴다
3. 지속화를 켜지 않는다 (위 표 참조)
4. 요청·응답 본문과 건강 수치를 로그에 남기지 않는다

`app/tests/model/test_job_contract.py` 가 1·2·4 를 검사하고, 3 은 compose 설정이다.
"""

from __future__ import annotations

from app.core import config
from app.core.utils.enums import StrEnum


class JobStatus(StrEnum):
    """작업 생애. `queued → running → succeeded | failed` 로만 움직인다."""

    QUEUED = "queued"
    RUNNING = "running"
    SUCCEEDED = "succeeded"
    FAILED = "failed"


#: 끝난 작업. 폴링하는 쪽이 더 기다릴지 판단하는 데 쓴다.
TERMINAL_STATUSES = frozenset({JobStatus.SUCCEEDED, JobStatus.FAILED})

#: 해시 필드 이름. 문자열을 흩뿌리지 않고 여기서만 정의한다.
FIELD_STATUS = "status"
FIELD_PAYLOAD = "payload"
FIELD_RESULT = "result"
FIELD_ERROR = "error"
FIELD_CREATED_AT = "created_at"
FIELD_STARTED_AT = "started_at"
FIELD_FINISHED_AT = "finished_at"
FIELD_ATTEMPTS = "attempts"
FIELD_WORKER = "worker"


def stream_key() -> str:
    return f"{config.REDIS_KEY_PREFIX}:predict:stream"


def job_key(job_id: str) -> str:
    """작업 해시 키. `job_id` 는 무작위 UUID 라서 계정을 되짚을 수 없다."""
    return f"{config.REDIS_KEY_PREFIX}:predict:job:{job_id}"


#: 스트림 메시지의 유일한 필드. payload 는 해시에 있고 스트림에는 참조만 흐른다.
#: 스트림은 `MAXLEN` 으로 절단될 뿐 TTL 이 없어서, 건강 수치를 여기 실으면
#: 지울 시점을 통제할 수 없다.
MESSAGE_FIELD_JOB_ID = "job_id"
