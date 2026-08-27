"""순수 계산 테스트 전용 하네스 — DB 를 붙이지 않는다.

`app/tests/conftest.py` 의 `_override_session` 이 autouse 라서, 그대로 두면 참조표
조회나 트리 채점처럼 I/O 가 없는 테스트까지 PostgreSQL 컨테이너를 요구한다. 실제로
컨테이너가 꺼진 상태에서 표시 회귀 테스트가 `ConnectionRefusedError` 로 무더기
error 가 됐다. 잡으려는 결함과 무관한 이유로 안 돌면 아무도 안 돌린다.

여기서는 같은 이름의 no-op 픽스처로 덮는다. pytest 는 가장 가까운 conftest 의
정의를 쓰므로 이 디렉터리 안에서만 DB 오버라이드가 꺼진다. 상위 디렉터리의 API
테스트는 영향을 받지 않는다.

이 디렉터리에는 **의존성 주입이 필요 없는 것만** 둔다 — 모델 채점, 참조표, 등급
사상, 중재 규칙. 라우터·세션·인증이 끼면 상위 디렉터리로 옮긴다.
"""

from collections.abc import AsyncIterator

import pytest_asyncio


@pytest_asyncio.fixture(loop_scope="session", autouse=True)
async def _override_session() -> AsyncIterator[None]:
    """상위 conftest 의 DB 세션 오버라이드를 이 디렉터리에서만 끈다."""
    yield
