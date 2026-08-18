"""`enum.StrEnum`은 3.11+에만 있고 이 프로젝트는 requires-python >=3.10이다.

app/core/config.py와 app/models/users.py에 같은 shim이 중복돼 있던 것을
여기로 모았다.
"""

try:
    from enum import StrEnum
except ImportError:  # Python 3.10 compatibility
    from enum import Enum

    class StrEnum(str, Enum):  # type: ignore[no-redef]
        pass


__all__ = ["StrEnum"]
