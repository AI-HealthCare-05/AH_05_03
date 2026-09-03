import zoneinfo
from dataclasses import field

from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="allow")

    TIMEZONE: zoneinfo.ZoneInfo = field(default_factory=lambda: zoneinfo.ZoneInfo("Asia/Seoul"))

    # 큐 키의 접두사와 TTL은 app.core.config가 정본이다. 여기에는 워커
    # 자신의 실행 방식만 둔다. 같은 항목을 두 곳에서 정의하면 갈라진다.
    REDIS_URL: str = "redis://localhost:6379/0"
    REDIS_MAX_CONNECTIONS: int = 20

    #: 한 프로세스에서 동시에 돌릴 소비자 수.
    WORKER_CONCURRENCY: int = 2
    #: XREADGROUP이 새 작업을 기다리는 시간. 종료 신호를 받고 최대 이만큼 늦게 멈춘다.
    WORKER_BLOCK_MS: int = 5_000
    #: 이 시간 넘게 ack가 없으면 그 작업을 집었던 워커가 죽은 것으로 보고 회수한다.
    WORKER_CLAIM_MIN_IDLE_MS: int = 60_000
    WORKER_CLAIM_INTERVAL_SECONDS: float = 30.0
    #: 재배달 상한. 넘으면 실패로 확정해 무한 재시도를 막는다.
    WORKER_MAX_ATTEMPTS: int = 3
