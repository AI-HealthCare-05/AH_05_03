set -eo pipefail

COLOR_GREEN=$(tput setaf 2)
COLOR_BLUE=$(tput setaf 4)
COLOR_RED=$(tput setaf 1)
COLOR_NC=$(tput sgr0)

cd "$(dirname "$0")/../.."

echo "${COLOR_BLUE}Run Mypy${COLOR_NC}"
# **범위가 `app` 인 이유.** CI 도 `mypy app` 만 돈다. `modeling/` 은 실험 코드라
# 타입이 깨끗한 적이 없고(2026-09-03 기준 45건), 여기서 `mypy .` 를 돌리면 로컬만
# 빨갛게 떠서 아무도 이 스크립트를 안 쓰게 된다. 로컬과 CI 는 같은 것을 재야 한다.
if ! uv run mypy app ; then
  echo ""
  echo "${COLOR_RED}✖ Mypy found issues.${COLOR_NC}"
  echo "${COLOR_RED}→ Please fix the issues above manually and re-run the command.${COLOR_NC}"
  exit 1
fi

echo "${COLOR_GREEN}Successfully Ended.${COLOR_NC}"
