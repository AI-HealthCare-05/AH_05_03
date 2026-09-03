# CLAUDE.md

규칙은 한 벌이다. 정본 요약은 `AGENTS.md` 이고 Codex·Cursor 도 같은 파일을 읽는다.

@AGENTS.md

## Claude Code 에서만 더 지킬 것

- `cwd` 는 이 폴더(`project/`)다. 상위 폴더로 올라가 `Team_project/docs/` 를 이 코드의 문서로 읽지 않는다.
- 파일을 읽을 때 `.env`·`*.pem`·`*.key`·`credentials*` 는 `Read`·`cat`·`grep` 전부 금지다. 키 이름 유무만 `grep -c` 로 본다.
- 한 작업이 끝나면 AGENTS.md §3 의 검증 명령을 **같은 순서로** 돌리고, 결과를 "통과/실패 건수" 와 "바뀐 숫자" 로 보고한다.
- 문서를 새로 만들면 `docs/NN_` 번호를 원격(`origin/dev`)에서 먼저 확인하고, 19·21번 문서의 관련 문서 표에 한 줄을 더한다.
