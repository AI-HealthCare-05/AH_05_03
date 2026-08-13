# 기술 스택 & 아키텍처 설계

> 관련 평가기준: 2-1(기술스택 적절성), 2-2(확장성), 2-3(아키텍처), 3-2(비동기 학습/추론), 5-1(P95 지연), 5-5(서버 비동기)

## 1. 기술 스택

프로젝트 기술 스택 Guide의 권장안을 기준으로 채택한다. 배포 세션에서 전체 팀 방식이 통일되어야 하므로 임의 변경은 지양하되, 초기 검토 후 팀 합의로 변경 가능하다.

| 영역 | 채택 | 대안(비교 대상) | 채택 이유 |
|---|---|---|---|
| 백엔드 프레임워크 | FastAPI | Django, Flask | 비동기 네이티브 지원(AI 추론 대기시간 처리에 유리), Pydantic 기반 자동 검증·문서화로 API명세서와 실제 구현 싱크 유지 용이 |
| 프론트엔드 | React + TypeScript | Vue, Next.js | 팀 기존 숙련도, Vite 기반 빠른 개발 속도, 캠프 배포 세션이 이 스택 기준으로 진행됨 |
| 상태관리 | Zustand + TanStack Query | Redux, Context API | 보일러플레이트 최소화, 서버 상태(TanStack Query)와 클라이언트 상태(Zustand) 분리로 대시보드의 잦은 데이터 갱신에 적합 |
| DB | PostgreSQL | MySQL, MongoDB | 관계형 데이터(회원-건강데이터-예측이력-챌린지)가 명확한 1:N 구조라 RDB가 적합, JSON 컬럼으로 설문/비정형 데이터도 수용 가능 |
| 캐시/브로커 | Redis (Stream) | RabbitMQ, Kafka | 캐싱과 메시지 큐를 하나로 해결, 소규모 팀 프로젝트에 운영 부담이 가장 낮음 |
| AI/ML | scikit-learn, PyTorch, LangChain | - | 정형 건강데이터 예측은 scikit-learn으로 충분, 선택기능(LLM 예방행동추천)은 LangChain+OpenAI API |
| 인프라 | Docker, Docker Compose, AWS EC2, Nginx | Kubernetes | 팀 규모(4인)·프로젝트 기간(5주) 대비 K8s는 과도한 운영 비용, EC2 단일/이중 인스턴스 + Docker Compose로 충분 |
| CI/CD | GitHub Actions | Jenkins | 별도 서버 불필요, GitHub 저장소와 통합되어 PR 기반 협업(평가기준 6-2)과 자연스럽게 연결 |

## 2. 시스템 아키텍처

**핵심 설계 원칙(가이드 원문 인용)**: "무거운 AI 작업을 안정적으로 처리하면서 확장 가능한 구조를 만드는 것". Talos의 필수 기능(만성질환 예측 모델링)은 추론 지연이 발생할 수 있으므로, 웹 서버가 직접 추론을 수행하지 않고 Producer-Consumer 패턴으로 분리한다.

```
[Client(React)] → [Nginx] → [FastAPI(Producer)] → [Redis Stream(Broker)] → [AI Worker(Consumer)]
                                    │                                              │
                                    ▼                                              ▼
                              [PostgreSQL]                                   [AWS S3(모델 파일)]
```

- **Nginx**: 리버스 프록시, HTTPS 종단점, SSE 연결 유지.
- **FastAPI**: 사용자 요청 접수. 만성질환 예측처럼 무거운 작업은 즉시 처리하지 않고 Redis Stream에 작업을 등록(XADD)한 뒤 "접수완료" 응답. 완료 시점은 SSE로 클라이언트에 실시간 전달.
- **Redis Stream**: FastAPI와 AI Worker를 디커플링하는 메시지 브로커. 서버 재시작에도 작업 유실 없음(영속성), 워커별 처리 상태 추적(XACK) 가능.
- **AI Worker**: 예측 모델 추론(및 추후 이미지 분류 등)을 전담하는 별도 프로세스/컨테이너. 요청이 몰리면 워커 컨테이너 수만 늘려 수평 확장(2-2 확장성 대응).
- **PostgreSQL**: 회원, 건강데이터, 예측이력, 챌린지, 피드백 등 정형 데이터.
- **AWS S3**: 학습된 모델 파일(.pkl/.pt), 건강검진 결과지 이미지 등 대용량 파일 저장.

이 구조로 2-3(계층 분리), 2-2(워커 단위 확장), 3-2(비동기 추론)를 동시에 만족한다.

## 3. 성능/보안 대응

- **인증/인가(5-4)**: JWT Access(짧은 만료) + Refresh Token, 인증 필요 API는 FastAPI Dependency로 일괄 검증.
- **비동기 I/O(5-5)**: DB 드라이버는 비동기(asyncpg 계열) 사용, 모든 라우터 `async def`로 작성.
- **캐싱**: 대시보드 조회처럼 반복적이고 변경이 적은 데이터는 Redis에 TTL 캐싱.
- **성능 테스트(5-1)**: 배포 완료(Sprint 6) 후 locust로 부하 테스트를 수행하고 P95 latency를 문서화. 3초 초과 엔드포인트는 캐싱/쿼리 최적화로 개선.

## 4. 협업 규칙 (평가기준 6-2)

- **브랜치 전략**: Git Flow — `main`(배포) / `develop`(통합) / `feature/*`(기능 단위). `main` 직접 push 금지, 모든 병합은 PR 경유.
- **커밋/PR**: PR에 변경 요약과 관련 Issue 번호를 명시. 최소 1인 리뷰 후 머지.
- **이슈 관리**: GitHub Issues로 기능 단위 작업표 관리, 라벨(backend/frontend/ai/infra)로 담당 영역 구분.
- **일일 스크럼**: 전일 진행상황 / 금일 예정 작업 / 막힌 점을 15분 이내로 공유 (`07_roadmap.md` 참고).
