import logging
import re
import sys

#: 접근 로그에서 가려야 하는 작업 id.
#:
#: **`job_id` 는 식별자가 아니라 자격증명이다.** 예측·문서 인식 작업 조회는 소유권을
#: 검사하지 않는다 — 작업 해시에 계정 식별자를 넣지 않기로 했고(ADR-010 §6), 128 비트
#: 난수를 아는 것 자체가 접근 자격이다(`prediction_job_routers.py` 주석).
#:
#: 그 전제를 로그가 깨고 있었다. 2026-08-27 실측 — 앱 접근 로그에 31 건, nginx 쪽에
#: 1110 건이 평문이었다. 로그를 볼 수 있으면 TTL 동안 남의 건강 판정을 다시 받아올 수
#: 있고, 로그는 수집기·백업으로 TTL 보다 오래 남는다.
#:
#: 경로 구조는 남기고 id 만 지운다 — 어느 엔드포인트가 몇 번 불렸는지는 그대로 본다.
_JOB_ID_IN_PATH = re.compile(r"(/api/v1/(?:predictions|dev/ocr)/jobs/)[A-Za-z0-9_-]{8,}")


class MaskJobIds(logging.Filter):
    """로그 메시지에 섞인 작업 id 를 `***` 로 바꾼다.

    `record.args` 까지 훑는 이유 — uvicorn 의 접근 로그는 경로를 포맷 인자로 넘기므로
    `record.msg` 만 고쳐서는 안 지워진다.
    """

    @staticmethod
    def _scrub(value: object) -> object:
        if isinstance(value, str) and "/jobs/" in value:
            return _JOB_ID_IN_PATH.sub(r"\1***", value)
        return value

    def filter(self, record: logging.LogRecord) -> bool:
        record.msg = self._scrub(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(self._scrub(a) for a in record.args)
        elif isinstance(record.args, dict):
            record.args = {k: self._scrub(v) for k, v in record.args.items()}
        return True


def install_access_log_mask() -> None:
    """uvicorn 접근 로거에 마스킹을 건다. `main.py` 가 기동 때 한 번 부른다.

    uvicorn 로거는 우리 `setup_logger` 를 안 타므로 따로 붙여야 한다.
    """
    for name in ("uvicorn.access", "uvicorn.error"):
        logger = logging.getLogger(name)
        if not any(isinstance(f, MaskJobIds) for f in logger.filters):
            logger.addFilter(MaskJobIds())


def setup_logger(
    # 기본값이 `"ai_worker"` 였다. 이 파일은 **fastapi 이미지의** 로거이고
    # `default_logger` 가 이 기본값을 쓰므로, 앱과 초대 메일 워커의 모든 로그가
    # `[ai_worker]` 로 찍혔다 — 예측·문서 인식을 도는 진짜 ai-worker 컨테이너와
    # 구분이 안 돼서 로그를 이름으로 거를 수가 없었다.
    name: str = "app",
    level: int = logging.INFO,
) -> logging.Logger:
    _logger = logging.getLogger(name)

    # 중복 핸들러 방지 (중요)
    if _logger.handlers:
        return _logger

    _logger.setLevel(level)

    formatter = logging.Formatter("[%(asctime)s] [%(levelname)s] [%(name)s] %(message)s")

    # 콘솔 출력
    console_handler = logging.StreamHandler(sys.stdout)
    console_handler.setFormatter(formatter)

    _logger.addHandler(console_handler)
    # 우리 로그도 마스킹을 태운다. 예외 메시지·경고에 job_id 가 섞여 나갈 수 있다.
    _logger.addFilter(MaskJobIds())
    _logger.propagate = False  # root logger로 중복 전달 방지

    return _logger


# 앱 전역에서 사용할 로거
default_logger = setup_logger()
