# 관리자 MacBook `dev` 자동 배포

> 배포 대상: 관리자 MacBook의 Docker Desktop
> 배포 소스: GitHub `dev` 브랜치
> 실행 조건: GitHub-hosted `ci.yml` 성공
> 배포 방식: 전용 self-hosted macOS runner

## 1. 배포 흐름

```text
dev push
→ GitHub-hosted CI
→ CI 성공한 동일 commit SHA
→ admin-macbook-dev Environment
→ self-hosted runner(ieobom-admin)
→ Docker 이미지 로컬 빌드
→ PostgreSQL·Redis 기동
→ Alembic 1회 실행
→ FastAPI·Frontend·Nginx 교체
→ /healthz 확인
```

PR 코드는 관리자 Mac에서 실행하지 않는다. 저장소가 Public이므로 self-hosted runner는 `pull_request` 이벤트에 연결하지 않고, 같은 저장소의 `dev` push가 GitHub-hosted CI를 통과한 경우에만 사용한다.

## 2. MacBook 준비

개인 로그인 계정보다 배포 전용 macOS 사용자를 권장한다. Docker Desktop을 설치하고 해당 사용자 로그인 시 자동 시작하도록 설정한다.

GitHub 저장소의 `Settings → Actions → Runners → New self-hosted runner`에서 macOS 명령을 실행한다. GitHub가 화면에 표시한 일회성 토큰을 사용하고 다음 설정을 지정한다.

```text
Runner name: admin-macbook
Additional label: ieobom-admin
Runner group: 저장소 또는 이어봄 전용 그룹
```

설치 후 runner 디렉터리에서 서비스를 등록한다.

```bash
./svc.sh install
./svc.sh start
./svc.sh status
```

Runner 서비스 사용자에게 Docker 접근 권한이 있어야 한다. 다음 명령이 같은 사용자 세션에서 성공해야 한다.

```bash
docker info
docker compose version
curl --version
```

## 3. 배포 환경파일

환경파일은 checkout 안에 두지 않는다. `actions/checkout`은 작업 폴더를 정리하므로 저장소의 `.env`는 삭제될 수 있고, 다른 workflow가 읽을 위험도 있다.

```bash
mkdir -p ~/.config/ieobom
cp /path/to/repository/envs/example.dev-mac.env ~/.config/ieobom/dev.env
chmod 600 ~/.config/ieobom/dev.env
```

다음 값은 반드시 교체한다.

- `SECRET_KEY`
- `DB_PASSWORD`
- `CORS_ALLOW_ORIGINS`
- 필요하면 `DEV_HTTP_PORT`

Nginx의 8080 포트는 Mac 내부 헬스체크와 장애 진단에 사용한다. 사용자 브라우저는 Web Crypto 보안 컨텍스트가 필요하므로 Tailscale Serve가 제공하는 HTTPS 주소로 접속한다. `CORS_ALLOW_ORIGINS`에는 해당 HTTPS Origin을 정확히 추가하고 `REFRESH_COOKIE_SECURE=true` 및 `__Host-ieobom_refresh`를 사용한다.

```bash
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve --bg --yes http://127.0.0.1:8080
/Applications/Tailscale.app/Contents/MacOS/Tailscale serve status
```

현재 개발 환경의 접속 주소는 다음과 같다.

```text
https://admin-macbookpro.taila6d25d.ts.net/
```

`http://<admin-macbook-tailscale-ip>:8080` 같은 IP 기반 HTTP 주소에서는 `crypto.subtle`을 사용할 수 없어 로컬 키 생성과 암호화 저장이 동작하지 않는다.

## 4. GitHub Environment

저장소 `Settings → Environments`에서 `admin-macbook-dev`를 만든다.

- Deployment branches는 `dev`만 허용한다. workflow job도 `push` 이벤트와 `refs/heads/dev`를 함께 검사하고 CI를 통과한 동일 SHA를 다시 검증한다.
- 필요하면 Required reviewers에 관리자를 추가한다.
- Actions variable `IEOBOM_DEV_ENV_FILE`은 생략할 수 있다. 기본값은 `~/.config/ieobom/dev.env`다.
- 기본 포트가 아니면 `IEOBOM_DEV_HTTP_PORT`를 설정한다.
- 실제 DB 비밀번호와 `SECRET_KEY`는 GitHub Secret에 넣지 않고 Mac의 환경파일에 둔다.

## 5. 배포와 확인

`dev`에 push하면 `ci.yml`의 GitHub-hosted 프론트·린트·백엔드 테스트가 먼저 실행된다. 세 job이 모두 성공한 같은 workflow에서 `deploy-dev-admin-mac` job이 self-hosted runner로 이어진다.

`main`과 `dev`에는 branch protection을 적용하고 직접 force push를 금지한다. 배포 job과 Mac 전용 Compose가 `dev` 브랜치에 포함된 시점부터 자동 배포가 활성화된다.

```bash
curl http://127.0.0.1:8080/healthz
curl http://127.0.0.1:8080/api/openapi.json
curl https://admin-macbookpro.taila6d25d.ts.net/healthz
```

서비스 상태와 로그는 runner 사용자로 확인한다.

```bash
docker compose \
  --project-name ieobom-dev \
  --env-file ~/.config/ieobom/dev.env \
  --file /path/to/checkout/infra/docker/docker-compose.dev-mac.yml \
  ps
```

Redis는 호스트 포트를 열지 않는다. PostgreSQL은 DBeaver 점검을 위해 기본적으로 `127.0.0.1:15432`에만 노출하며, 팀 공유가 필요할 때에만 admin Mac의 Tailscale IPv4에 바인딩한다. PostgreSQL 데이터와 Redis 운영 상태는 `ieobom-dev` 이름의 Docker volume에 유지되며 배포 과정에서 `down -v`를 실행하지 않는다.

## 6. 팀 DBeaver 접근

팀원에게 애플리케이션의 `DB_USER`와 `DB_PASSWORD`를 공유하지 않는다. admin Mac의 `~/.config/ieobom/dev.env`에 다음 값을 설정해 PostgreSQL을 Tailscale 안에서만 노출한다.

```dotenv
DEV_DB_BIND_HOST=<admin-macbook-tailscale-ip>
DEV_DB_PORT=15432
```

`DEV_DB_BIND_HOST`에는 admin Mac의 현재 Tailscale IPv4만 사용한다. `0.0.0.0`, LAN IP 또는 공인 IP를 사용하지 않는다. Tailscale 관리 화면에서는 TCP 15432 접근 대상을 프로젝트 팀원 또는 프로젝트 기기 그룹으로 제한한다.

설정 반영 후 admin Mac에서 다음을 확인한다.

```bash
docker compose \
  --project-name ieobom-dev \
  --env-file ~/.config/ieobom/dev.env \
  --file /path/to/checkout/infra/docker/docker-compose.dev-mac.yml \
  up -d postgres

nc -vz <admin-macbook-tailscale-ip> 15432
```

### 6.1 팀원별 읽기 전용 계정

공유 계정 하나 대신 로그인 계정을 팀원별로 생성하고, 공통 읽기 전용 역할을 부여한다. 아래 SQL의 로그인 이름과 비밀번호는 팀원마다 바꾸고 비밀번호는 Git·Discord·문서에 기록하지 않는다.

```sql
CREATE ROLE ieobom_team_readonly NOLOGIN;
GRANT CONNECT ON DATABASE ieobom_dev TO ieobom_team_readonly;
GRANT USAGE ON SCHEMA public TO ieobom_team_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ieobom_team_readonly;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO ieobom_team_readonly;

ALTER DEFAULT PRIVILEGES FOR ROLE ieobom IN SCHEMA public
GRANT SELECT ON TABLES TO ieobom_team_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE ieobom IN SCHEMA public
GRANT SELECT ON SEQUENCES TO ieobom_team_readonly;

CREATE ROLE ieobom_member_name LOGIN PASSWORD '<long-random-password>';
GRANT ieobom_team_readonly TO ieobom_member_name;
```

이미 역할이 존재하면 `CREATE ROLE`은 다시 실행하지 않는다. 팀원이 나가면 해당 로그인만 `ALTER ROLE ieobom_member_name NOLOGIN`으로 즉시 비활성화한다. 데이터 수정이 필요한 팀원에게도 애플리케이션 계정을 공유하지 않고 별도의 쓰기 역할을 검토한다.

### 6.2 DBeaver 설정

| 항목 | 값 |
|---|---|
| Driver | PostgreSQL |
| Host | admin Mac 관리자가 별도로 전달한 Tailscale IPv4 또는 MagicDNS 이름 |
| Port | `15432` |
| Database | `ieobom_dev` |
| Username | 발급받은 개인 DB 로그인 |
| Password | 개인에게 별도 전달된 비밀번호 |
| SSL | Tailscale 내부 연결에서는 Disable |

연결 전 팀원 기기에서 `tailscale ping admin-macbookpro`가 성공해야 한다. DBeaver의 `Test Connection`이 실패하면 PostgreSQL 비밀번호를 공유하기 전에 Tailscale 소속·ACL, admin Mac의 절전 상태와 Docker 컨테이너 상태부터 확인한다.

## 7. 운영상 제한

- Mac이 잠자기 상태면 runner와 서비스가 응답하지 않을 수 있으므로 전원 연결 중 자동 잠자기를 비활성화한다.
- Docker Desktop 또는 runner 서비스가 중지되면 배포가 대기한다.
- Alembic 마이그레이션 성공 후 애플리케이션 헬스체크가 실패할 수 있으므로 파괴적 마이그레이션은 expand/contract 방식으로 작성한다.
- 이 구성은 `dev` 검증 환경이다. 외부 공개 운영 환경과 TLS 배포는 별도 workflow와 ADR로 분리한다.
