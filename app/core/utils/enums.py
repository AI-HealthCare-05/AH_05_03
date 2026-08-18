"""`enum.StrEnum`은 3.11+에만 있고 이 프로젝트는 requires-python >=3.10이다.

try/except ImportError 대신 sys.version_info로 분기한다. mypy는 버전 비교를
이해해서 분석 중인 파이썬 버전에 맞는 브랜치만 보지만, try/except는 양쪽을
다 보고 no-redef와 attr-defined 오류를 낸다.
"""

import sys

if sys.version_info >= (3, 11):
    from enum import StrEnum
else:
    from enum import Enum

    class StrEnum(str, Enum):
        pass


__all__ = ["StrEnum"]
