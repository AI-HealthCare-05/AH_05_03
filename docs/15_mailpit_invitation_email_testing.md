# Mailpit 기반 가족 초대 메일 개발·테스트

> 기준일: 2026-08-20
> 적용 범위: 로컬 개발과 dev 검증
> 운영 메일 제공업체 결정 문서가 아니라, 초대 메일 전달 경계를 검증하는 실행 문서다.

## 1. 목적

이어봄의 가족 초대는 건강정보를 메일이나 서버에 담지 않는다. 메일에는 초대 식별자와 무작위 일회용 토큰을 포함한 연결 링크만 넣는다. Mailpit은 이 메일을 외부로 발송하지 않고 로컬 SMTP 서버가 받아 Web UI에 보여주는 개발 도구다.

이 구성으로 다음을 검증한다.

- 초대 생성 시 PostgreSQL에 초대 상태가 저장되는가
- 원문 토큰이 PostgreSQL과 API 응답에 남지 않는가
- Redis Stream 이벤트를 이메일 워커가 처리하는가
- SMTP 메일의 수신자·제목·링크가 올바른가
- 수신자가 서비스 계정으로 로그인한 뒤 초대를 수락하거나 거절할 수 있는가
- 같은 토큰을 두 번 사용할 수 없는가
- 초대 취소·만료 뒤 토큰을 사용할 수 없는가

Mailpit 공식 Docker 이미지는 Web UI `8025`, SMTP `1025`를 기본 포트로 사용한다. 참고: [Mailpit Docker 문서](https://mailpit.axllent.org/docs/install/docker/), [Mailpit 저장소](https://github.com/axllent/mailpit).

## 2. 비목표

- 실제 Gmail·네이버·회사 메일로 발송
- 반송, 스팸 신고, 도메인 평판 관리
- SPF·DKIM·DMARC 설정
- 운영 메일 제공업체 선정
- 건강기록·가족력·문서·OCR 결과 전송

운영 메일 제공업체를 붙일 때도 초대 도메인 로직은 변경하지 않고 SMTP 전송 설정 또는 `InvitationSender` 구현만 교체한다.

## 3. 데이터 경계

| 데이터 | 저장 위치 | 수명·정책 |
|---|---|---|
| 초대 상태·수신 이메일·토큰 해시 | PostgreSQL | 초대 생명주기 정본 |
| 원문 초대 토큰 | Redis 임시 키 | 메일 워커 전달용 5분, 수락용은 초대 만료까지 |
| 전달 이벤트 | Redis Stream | 원문 토큰 없이 초대 ID만 기록 |
| 개발 수신 메일 | Mailpit 메모리/로컬 컨테이너 | 개발 확인용, 운영 데이터 금지 |
| 건강정보 | 브라우저 IndexedDB·OPFS | 메일·Redis·PostgreSQL에 포함 금지 |

메일 워커는 `InvitationStore.take_delivery()`로 전달용 원문 토큰을 한 번 인계받는다. SMTP 오류가 발생하면 짧은 TTL로 다시 저장하고 새 Stream 이벤트를 만든다. 초대 수락 API는 별도의 Redis 토큰 키를 `GETDEL`로 소비하므로 메일이 중복 전달되어도 수락은 한 번만 성공한다.

## 4. 구성 요소와 흐름

```text
POST /api/v1/family-invitations
  ├─ PostgreSQL: 초대 행 + SHA-256 토큰 해시
  └─ Redis
      ├─ 수락 검증용 원문 토큰
      ├─ 메일 전달용 원문 토큰(짧은 TTL)
      └─ delivery Stream(초대 ID만 포함)
             ↓
      invitation email worker
             ↓ SMTP :1025
          Mailpit
             ↓ Web UI :8025
      /account#invitation=...&token=...
             ↓
      로그인 또는 가입 → 수락·거절
```

초대 토큰은 URL query가 아닌 fragment(`#`)에 둔다. fragment는 HTTP 요청과 일반적인 프록시 접근 로그에 포함되지 않는다. 프론트는 일치하는 받은 초대의 토큰 입력란을 채우고, 수락·거절이 끝나면 주소 표시줄에서 fragment를 제거한다.

## 5. 로컬 실행

### 5.1 Mailpit과 이메일 워커 시작

```bash
docker compose --profile mail up -d --build mailpit email-worker
```

전체 개발 스택과 함께 시작하려면 다음을 사용한다.

```bash
docker compose --profile mail up -d --build
```

기본 접속 주소:

- 프론트: `http://127.0.0.1:4173`
- Mailpit Web UI: `http://127.0.0.1:8025`
- Mailpit SMTP: `127.0.0.1:1025`

일반 로컬 Compose의 Mailpit 포트는 호스트의 `127.0.0.1`에만 바인딩한다.
공인 인터페이스와 LAN 주소에는 노출하지 않는다.

### 5.2 admin Mac 팀 공유 개발 환경

팀원이 같은 Tailscale tailnet에 가입된 개발 환경에서는 Mailpit Web UI만 admin Mac의
Tailscale IPv4에 바인딩할 수 있다. SMTP `1025`는 Docker 내부 네트워크에서만 사용하며
호스트 포트로 공개하지 않는다.

GitHub Environment `admin-macbook-dev`에는 다음 변수를 설정한다. 실제 주소를 Git 문서나
Compose 파일에 하드코딩하지 않는다.

| GitHub Environment 변수 | 예시 형식 | 용도 |
|---|---|---|
| `IEOBOM_DEV_TAILSCALE_HOST` | `100.x.y.z` | Mailpit Web UI가 바인딩할 admin Mac Tailscale IPv4 |
| `IEOBOM_DEV_INVITATION_WEB_ORIGIN` | `http://100.x.y.z:8080` | 초대 메일의 이어봄 dev 링크 |

배포가 끝나면 tailnet에 초대된 팀원은 다음 주소로 접속한다.

```text
http://<admin-mac-tailscale-ip>:8025
```

Mailpit에는 로그인 기능이 없고 초대 토큰이 표시된다. 따라서 이 공유는 개발·합성 데이터에만
사용하고, Tailscale 멤버 권한이 없는 사용자에게 포트를 열지 않는다. 운영 배포에서는 Mailpit을
실행하지 않는다.

### 5.3 상태 확인

```bash
docker compose --profile mail ps
docker compose logs -f email-worker
```

정상 처리 로그 예시:

```text
invitation email worker started: group=invitation-email-workers ...
invitation email delivered: <invitation UUID>
```

## 6. 수동 종단 간 테스트

서로 다른 이메일의 서비스 계정 두 개와 서로 분리된 브라우저 저장소가 필요하다. 일반 창과 시크릿 창, 또는 서로 다른 브라우저 프로필을 사용한다.

1. 발신자 브라우저에서 서비스 계정 A로 로그인한다.
2. 가정을 만들고 가족 구성원 로컬 프로필을 만든다.
3. `/account`에서 가정·로컬 프로필·계정 B 이메일을 선택해 초대를 보낸다.
4. Mailpit `http://127.0.0.1:8025`에서 수신 메일을 연다.
5. 메일의 `초대 확인하기` 링크를 수신자 브라우저에서 연다.
6. 다른 계정이 이미 로그인돼 있으면 `초대받은 계정으로 전환`을 누른다.
7. 초대 이메일이 자동 입력된 상태에서 계정 B로 로그인하거나 신규 가입한다.
8. `/account`의 받은 초대에서 발신자가 지정한 연결 대상임을 확인한다. 토큰은 링크에서 자동 입력된다.
9. 별도의 로컬 프로필을 선택하지 않고 `초대 수락`을 실행한다.
10. `계정 연결 완료·기기 연결 대기` 상태를 확인한다.
11. 발신자와 수신자의 계정 화면에서 초대·멤버십·프로필 참조 연결 상태를 확인한다.

현재 초대 수락은 서버 연결 메타데이터를 만든다. 실제 건강정보의 기기 간 암호화 전송은 후순위 기능이며 Mailpit 테스트 범위에 포함하지 않는다.

## 7. 필수 실패 시나리오

| 시나리오 | 기대 결과 |
|---|---|
| 다른 이메일 계정으로 링크 사용 | 초대를 찾을 수 없는 것과 같은 응답 |
| 토큰 일부 변경 | 토큰 오류, 초대 상태는 pending 유지 |
| 같은 토큰 재사용 | 재사용 감지 또는 상태 충돌 |
| 발신자가 초대 취소 후 링크 사용 | 수락 불가 |
| 만료 뒤 링크 사용 | expired 전이 후 수락 불가 |
| Mailpit 중지 후 초대 | 워커가 SMTP 실패를 기록하고 전달을 재큐잉 |
| Redis 중지 | 초대 생성은 fail-closed, 원문 토큰 없는 초대 행만 남기지 않음 |
| 프로필 연결 중단 | 계정 화면에서 연결 재시도 제공 |

## 8. 환경변수

| 변수 | 로컬 기본값 | 설명 |
|---|---|---|
| `SMTP_HOST` | `mailpit` | 이메일 워커가 접속할 SMTP 호스트 |
| `SMTP_PORT` | `1025` | SMTP 포트 |
| `SMTP_FROM_EMAIL` | `no-reply@ieobom.local` | 발신 주소 |
| `SMTP_FROM_NAME` | `이어봄` | 발신 이름 |
| `SMTP_USERNAME` | 없음 | 운영 SMTP 인증 사용자 |
| `SMTP_PASSWORD` | 없음 | 운영 SMTP 인증 비밀값, Git 저장 금지 |
| `SMTP_USE_TLS` | `false` | 연결 시점부터 TLS를 사용하는 SMTPS |
| `SMTP_USE_STARTTLS` | `false` | 평문 연결 후 STARTTLS 전환 |
| `INVITATION_WEB_ORIGIN` | `http://127.0.0.1:4173` | 메일 링크의 프론트 Origin |
| `MAILPIT_WEB_PORT` | `8025` | 호스트 Web UI 포트 |
| `MAILPIT_SMTP_PORT` | `1025` | 호스트 SMTP 포트 |
| `DEV_MAILPIT_BIND_HOST` | `127.0.0.1` | admin Mac dev Mailpit Web UI 바인딩 주소 |
| `DEV_MAILPIT_WEB_PORT` | `8025` | admin Mac dev Mailpit Web UI 포트 |

`SMTP_USE_TLS`와 `SMTP_USE_STARTTLS`는 제공업체 계약에 맞춰 하나만 사용한다. 운영 자격증명은 GitHub Secret 또는 배포 환경의 비밀 저장소로 주입한다.

## 9. 운영 제공업체로 전환할 때

1. Mailpit 서비스를 운영 Compose에서 제외한다.
2. SMTP 호스트·포트·TLS·인증 비밀값을 운영 환경에 설정한다.
3. 발신 도메인의 SPF·DKIM·DMARC를 구성한다.
4. 이메일 워커의 전송 성공률·지연·재시도·실패 건수를 관측한다.
5. 영구 실패와 반송을 처리할 dead-letter 정책을 추가한다.
6. 초대 재발송 시 기존 토큰 폐기 여부와 UX를 확정한다.
7. 메일 본문과 로그에 건강정보가 포함되지 않는지 회귀 검사한다.

SMTP 대신 제공업체 HTTP API를 채택해도 `InvitationSender.send()` 경계 안에서 교체한다. 가족 초대 서비스가 특정 제공업체 SDK를 직접 import하지 않게 유지한다.

## 10. 알려진 한계와 후속 작업

- 현재 SMTP 실패는 짧은 TTL로 재큐잉하지만 최대 재시도 횟수와 dead-letter Stream은 없다.
- 워커가 SMTP 전송 직후 강제 종료되면 동일 링크 메일이 중복될 수 있다. 수락 토큰은 한 번만 소비된다.
- 메일 발송 상태는 PostgreSQL 정본에 별도 기록하지 않는다. 운영 전에는 delivery attempt 테이블 또는 관측 이벤트를 검토한다.
- 초대받은 새 기기에서 로컬 프로필을 어떻게 생성·확인할지 onboarding UX를 더 구체화해야 한다.
- 실제 건강정보의 공유·동기화는 별도의 암호화 기기 연결 기능으로 구현한다.

## 11. 완료 기준

- [x] `docker compose --profile mail up`으로 Mailpit과 워커가 시작된다.
- [x] 개발 스모크 이벤트 생성 후 Mailpit에 한 통의 메일이 나타난다.
- [x] 메일 생성 테스트에서 건강정보 필드를 입력하지 않는다.
- [x] 링크 토큰이 HTTP query가 아니라 fragment에 있다.
- [x] 프론트 테스트에서 일치하는 수신 초대의 토큰이 자동 입력된다.
- [x] 초대 처리 후 fragment가 주소에서 제거된다.
- [x] 재사용·취소·만료 테스트가 실패한다.
- [x] Mailpit 포트가 loopback에만 바인딩된다.
- [x] 운영 비밀값이 저장소에 들어가지 않는다.
