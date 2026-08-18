# 이어봄 (Ieobom)

오즈코딩스쿨 **AI 헬스케어 5기 파이널 프로젝트** — 참여기업 **Talos** 주제 대응.

> 이어봄 = 가족의 건강 기록을 안전하게 **이어** 보관하고, 시간에 따른 변화를 함께 **봄**(지켜본다). 중요한 건강정보는 사용자 기기에 보관하는 로컬 우선 가족 건강기록 서비스.

## 프로젝트 정보

- **기간**: 2026-08-10 (OT) ~ 2026-09-22 (데모데이) — 결과 제출 마감 2026-09-21 15:00
- **팀원**: 오성민(팀장/PM), 정다원(FE), 권민재(BE), 조현승(데이터 엔지니어)
- **기술 스택**: FastAPI · React/TypeScript · PostgreSQL · Redis · Docker · AWS EC2 (상세는 [docs/05_tech_architecture.md](docs/05_tech_architecture.md))

## 문서 인덱스

> **안내:** `docs/`에 있는 문서는 프로젝트 초기 단계의 기준안입니다. 요구사항 구체화, 설계 검토 및 개발 진행 상황에 따라 내용이 변경되거나 보완될 수 있습니다.

| 문서 | 내용 | 담당 |
|---|---|---|
| [docs/01_requirements.md](docs/01_requirements.md) | 요구사항 정의서 (문제정의, 기능/비기능 요구사항, AI 실험 계획) | 오성민 |
| [docs/02_erd.md](docs/02_erd.md) | ERD 초안 | 조현승 |
| [docs/03_api_spec.md](docs/03_api_spec.md) | API 명세서 초안 | 권민재 |
| [docs/04_wireframe.md](docs/04_wireframe.md) | 화면 목록 및 흐름 가이드 (Figma 링크 예정) | 정다원 |
| [docs/05_tech_architecture.md](docs/05_tech_architecture.md) | 기술 스택 선정 근거 + 시스템 아키텍처 | 전체 |
| [docs/06_evaluation_plan.md](docs/06_evaluation_plan.md) | **참여기업 평가기준 20개 항목 ↔ 대응 전략 매핑표** | 전체 |
| [docs/07_roadmap.md](docs/07_roadmap.md) | 공식 일정 + 스프린트별 팀원 R&R | 오성민 |
| [docs/08_account_profile_policy.md](docs/08_account_profile_policy.md) | 서비스 계정·가족 구성원 로컬 프로필·초대·연결·병합 정책 | 전체 |

## 지금 해야 할 일 (2026-08-12 기준)

현재 **Sprint 1 [기획 문서 & 와이어프레임 작성]** 구간(~08-16)이다. `docs/01~04` 4대 문서를 각 담당자가 초안 기준으로 다듬고, 8/17 Sprint 2(기능 구현) 착수 전 확정하는 것이 최우선 목표다. 진행 상황은 `docs/06_evaluation_plan.md`의 상태 컬럼과 `docs/07_roadmap.md`의 스프린트 계획을 기준으로 관리한다.

## 백엔드 템플릿 구성

OZ Coding School의 AI Healthcare Final Project Template을 기반으로 다음 구성을 추가했다.

- `app/`: FastAPI API 서버, 인증/JWT, SQLAlchemy 2.0(async) + Alembic, 테스트
- `ai_worker/`: AI 모델 추론·학습 워커
- `envs/`: 로컬·운영 환경 변수 예시
- `infra/`: Docker Compose와 Nginx 운영 설정
- `scripts/`: CI, 배포, 인증서 자동화 스크립트

의존성은 용도별로 설치할 수 있다.

```bash
uv sync --group app
uv sync --group ai
uv sync --group dev
```

로컬 전체 스택은 `docker compose up -d --build`로 실행한다. API 문서는 실행 후 `http://localhost/api/docs`에서 확인할 수 있다.

### DB 마이그레이션

서버 DB는 PostgreSQL 17이고 스키마는 Alembic으로 관리한다.

```bash
uv run alembic revision --autogenerate -m "변경 내용"
uv run alembic upgrade head
uv run alembic check   # 모델과 마이그레이션이 어긋나면 실패한다
```

테스트는 마이그레이션 대신 모델에서 직접 스키마를 만든다. 그래서 실패 원인이 모델인지 마이그레이션인지 헷갈리지 않는 대신, 둘 사이 드리프트는 CI의 `alembic check`가 잡는다. 마이그레이션을 추가했다면 이 명령을 반드시 로컬에서도 돌려 볼 것.
