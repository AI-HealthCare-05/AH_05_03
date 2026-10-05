# 이어봄 (Ieobom)

오즈코딩스쿨 **AI 헬스케어 5기 파이널 프로젝트** — 참여기업 **Talos**
주제 대응.

> 이어봄 = 가족의 건강 기록을 안전하게 **이어** 보관하고, 시간에 따른
> 변화를 함께 **봄**(지켜본다). 중요한 건강정보를 사용자 기기에 보관하는
> 로컬 우선 가족 건강기록 서비스입니다.

## Project Status

-   **공식 프로젝트 기간**: 2026-08-10 ~ 2026-09-22 (데모데이)
-   부트캠프의 공식 팀 프로젝트 일정과 최종 발표는 종료되었습니다.
-   현재 팀 단위 개발은 일시 정지된 상태입니다.
-   이후 오성민이 기존 결과물을 기반으로 **모델 평가 · AI pipeline ·
    서비스 통합**을 중심으로 후속 개발을 진행할 예정입니다.

> 이후 개인 후속 개발은 기존 팀 프로젝트 결과와 구분해 기록합니다.

## Project Overview

이어봄은 가족 단위의 건강기록을 장기간 관리하고,
건강검진·통증·가족력·질환 위험 정보를 한 서비스에서 확인하기 위한 AI
헬스케어 프로젝트입니다.

아키텍처의 핵심 원칙은 **건강정보와 서비스 계정 메타데이터의
분리**입니다. 가족 프로필과 건강정보는 가능한 범위에서 사용자 기기의
IndexedDB / OPFS에 보관하고, 서버는 인증·구독·초대 등 최소한의 계정
메타데이터를 담당하도록 설계했습니다.

검진문서 OCR처럼 CPU 비용이 큰 작업은 제한적으로 **Redis Streams → AI
Worker** 구조를 사용하며, 원본 이미지를 PostgreSQL에 저장하지 않는
경계를 두었습니다.

## My Role & Contribution

**오성민 — Team Lead / PM · Full-stack · AI Service Integration · ML
Evaluation · LLM Query Pipeline**

4명으로 시작한 팀 프로젝트에서 후반 개발과 최종 발표를 2명이
완료했습니다. 기존 Backend/Data 실무 경험을 바탕으로 서비스 구조와 AI
기능을 연결하고, 모델 결과를 지표 하나로 받아들이기보다 데이터
누수·일반화·확률 신뢰도·의사결정 기준을 검토하는 데 중점을 두었습니다.

주요 기여:

-   요구사항 정의와 roadmap 작성 및 프로젝트 진행 조율
-   FastAPI · PostgreSQL · Redis · AI Worker를 연결하는 AI 서비스 구조
    및 통합
-   만성질환 모델의 데이터 누수, validation 구조, calibration 및 위험군
    선별 관점의 평가
-   팀 내 Query Builder 구현이 정체된 상황에서 입력 검증 → 문맥·의도
    판단 → Query Builder / Enrichment → Main LLM·RAG로 이어지는 구조와
    구현 방향 제시 및 후속 pipeline 연결 지원
-   React/TypeScript 기반 서비스와 AI 기능 연결

## Key Problem Solving

### 1. 모델 점수보다 평가 타당성 확인

만성질환 모델은 진단 결과나 다른 만성질환 변수를 입력으로 사용하지
않도록 제한하고, 결측 라벨을 음성으로 처리하지 않았습니다. BRFSS 기반
baseline에서는 무작위 행 분할 대신 **주(state) 단위
train/validation/test 분리**를 적용하고 표본 가중치 `_LLCPWT`를 학습과
평가에 반영했습니다.

현재 baseline은 11개 질환에 대해 구축되어 있으며, 시험 데이터에서 모든
질환의 AUROC가 0.5를 넘고 AUPRC가 해당 질환 유병률을 넘었습니다. 다만
현재 천식 AUROC 0.643, 일부 희귀 질환 PPV 약 0.08~0.18 등 제품 적용에
충분하지 않은 결과도 그대로 기록하고 있습니다.

따라서 현재 모델은 **기술 baseline으로는 채택하지만 사용자 대상 위험
알림 모델로는 아직 채택하지 않는다**는 결정을 유지합니다.

상세 평가:
[docs/09_chronic_disease_model_plan.md](docs/09_chronic_disease_model_plan.md)

### 2. AI 작업과 서비스 경계 분리

서비스 계정 메타데이터와 건강정보를 물리적으로 분리하고, 구조화된
건강정보는 브라우저 로컬 저장소에 두는 방향을 채택했습니다.

검진문서 OCR은 예외적으로 서버 AI Worker를 사용합니다.

``` text
React / TypeScript
        │
        ├── IndexedDB / OPFS / Web Crypto
        │       └── 건강기록 · 가족 프로필 · 로컬 데이터
        │
        ▼
     FastAPI
        │
        ├── PostgreSQL
        │       └── 인증 · 구독 · 초대 등 최소 메타데이터
        │
        └── Redis Streams
                │
                ▼
             AI Worker
                └── 검진문서 OCR
```

OCR 입력 이미지는 Redis에 제한된 시간 동안만 유지하고, 처리 후 삭제하며
PostgreSQL에는 저장하지 않도록 설계했습니다.

상세 구조: [docs/05_tech_architecture.md](docs/05_tech_architecture.md)

### 3. LLM Query Pipeline

사용자의 짧거나 불완전한 입력을 downstream LLM/RAG에 그대로 전달하지
않도록 다음과 같은 전처리 흐름을 구체화했습니다.

``` text
Raw User Query
      ↓
Hard Rule / Input Validation
      ↓
Context · Intent 판단
      ↓
Query Builder / Enrichment
      ↓
Main LLM / RAG
```

이 부분은 팀 내 Query Builder 구현이 정체된 상황에서 구조와 구현 방향을
먼저 제시하고 후속 AI pipeline 연결을 지원한 영역입니다.

## Tech Stack

**Frontend**\
React · TypeScript · Zustand · TanStack Query · IndexedDB · OPFS · Web
Crypto

**Backend / Data**\
FastAPI · SQLAlchemy 2.x Async · Alembic · PostgreSQL · Redis

**AI / ML**\
scikit-learn · chronic disease risk modeling · AI Worker · OCR pipeline
· LLM Query Pipeline

**Infra**\
Docker · AWS EC2 · Nginx

## Team

  -----------------------------------------------------------------------
  팀원                                역할
  ----------------------------------- -----------------------------------
  오성민                              팀장/PM · AI Service Integration ·
                                      ML Evaluation · Full-stack

  정다원                              Frontend

  권민재                              Backend

  조현승                              Data Engineering
  -----------------------------------------------------------------------

> 프로젝트는 4명으로 시작했으며 후반 개발과 최종 발표는 2명이
> 완료했습니다. 팀 프로젝트 기간 이후의 개인 후속 개발은 별도로 구분해
> 기록합니다.

## Repository Structure

``` text
.
├── app/            # FastAPI API server
├── ai_worker/      # AI/OCR worker
├── frontend/       # React/TypeScript frontend
├── modeling/       # ML training/evaluation
├── models/         # model artifacts / manifests
├── docs/           # requirements, architecture, evaluation, ADR
├── infra/          # deployment infrastructure
├── scripts/        # CI/deployment utilities
├── docker/         # container configuration
├── docker-compose.yml
├── pyproject.toml
└── uv.lock
```

## Documentation

> `docs/`에는 초기 기준안과 개발 과정에서 갱신된 설계 문서가 함께
> 있습니다. 구현 상태와 시점에 따라 일부 문서의 내용은 현재 코드와
> 차이가 있을 수 있습니다.

  --------------------------------------------------------------------------------------------------------------------------------
  문서                                                                             내용                    담당
  -------------------------------------------------------------------------------- ----------------------- -----------------------
  [docs/01_requirements.md](docs/01_requirements.md)                               요구사항 정의서         오성민

  [docs/02_erd.md](docs/02_erd.md)                                                 ERD 초안                조현승

  [docs/03_api_spec.md](docs/03_api_spec.md)                                       서버 REST API·로컬 기능 권민재
                                                                                   상세 목표 계약          

  [docs/api/openapi.yaml](docs/api/openapi.yaml)                                   OpenAPI 3.1 계약        권민재

  [docs/database/0002_service_domain.sql](docs/database/0002_service_domain.sql)   PostgreSQL 서버         조현승·권민재
                                                                                   메타데이터 DDL          

  [docs/04_wireframe.md](docs/04_wireframe.md)                                     화면 목록 및 흐름       정다원
                                                                                   가이드                  

  [docs/05_tech_architecture.md](docs/05_tech_architecture.md)                     기술 스택 선정 근거 +   전체
                                                                                   시스템 아키텍처         

  [docs/06_evaluation_plan.md](docs/06_evaluation_plan.md)                         참여기업 평가기준 대응  전체
                                                                                   전략                    

  [docs/07_roadmap.md](docs/07_roadmap.md)                                         공식 일정 + 스프린트별  오성민
                                                                                   R&R                     

  [docs/08_account_profile_policy.md](docs/08_account_profile_policy.md)           계정·가족               전체
                                                                                   프로필·초대·연결·병합   
                                                                                   정책                    

  [docs/09_chronic_disease_model_plan.md](docs/09_chronic_disease_model_plan.md)   만성질환 모델 실행 계획 \-
                                                                                   및 평가                 

  [docs/10_local_data_contract.md](docs/10_local_data_contract.md)                 로컬 데이터 계약과 백업 전체
                                                                                   포맷                    

  [docs/adr/README.md](docs/adr/README.md)                                         Architecture Decision   전체
                                                                                   Records                 
  --------------------------------------------------------------------------------------------------------------------------------

## Local Development

``` bash
uv sync --group app
uv sync --group ai
uv sync --group dev
docker compose up -d --build
```

DB migration:

``` bash
uv run alembic revision --autogenerate -m "변경 내용"
uv run alembic upgrade head
uv run alembic check
```

## Current Limitations & Next Steps

-   만성질환 모델은 연구용 baseline이며 의료 진단·미래 발병 예측 모델로
    검증되지 않았습니다.
-   BRFSS 2024 한 해와 현재의 주 단위 분할만으로 external
    generalization을 주장하지 않습니다.
-   일부 질환은 낮은 sensitivity / PPV와 성별 성능 차이가 확인되어 추가
    검증이 필요합니다.
-   향후 주 단위 반복 교차검증, 외부 연도 검증, calibration 재평가와
    질환별 모델 개선을 진행할 예정입니다.
-   공식 팀 프로젝트 종료 이후의 후속 개발은 기존 팀 결과와 구분하여
    기록할 예정입니다.

------------------------------------------------------------------------

**Status:** Official team project completed · Team development paused ·
Post-project development planned
