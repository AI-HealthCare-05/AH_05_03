# SYSTEM_DESIGN

이 프로젝트의 핵심 시스템 설계 규칙이다.
충돌 시 우선순위: 프로젝트 도구 설정(`pyproject.toml`, ruff/mypy 설정) > [34번 규칙 문서](docs/34_project_rules_and_workflow.md) / [ADR](docs/adr/README.md) > 본 문서 > Google Python Style Guide > PEP 8.

---

## 1. Python 버전 & 타이핑 (Python 3.10+)

- 런타임 기준: **Python 3.10+** (Docker 배포 환경 및 uv 가상환경 호환).
- 현대적인 네이티브 타이핑 문법을 사용한다:
  - **내장 제네릭 (PEP 585)**: `list[int]`, `dict[str, float]`, `set[str]`
    — `typing.List`, `typing.Dict`, `typing.Set` 사용 금지.
  - **유니온 구문 (PEP 604)**: `int | None`, `str | bytes`
    — `typing.Optional`, `typing.Union` 사용 금지.
  - **타입 별칭**: 일반 대입문 `UserId = int` 또는 `NewType` 사용 (Python 3.12+ 전용 PEP 695 `type X = ...` 문법은 3.10 파서 충돌 방지를 위해 지양).
- `typing` 모듈에서의 임포트는 내장 대체재가 없는 항목으로 한정한다:
  `Any`, `Protocol`, `Literal`, `TypedDict`, `cast`, `TYPE_CHECKING` 등.
- 모든 공개(Public) 함수, 메서드, DTO 필드에는 매개변수 및 반환값 타입을 명시한다.

---

## 2. 코드 스타일 & 린트

- 기본 스타일 가이드: **Google Python Style Guide** (<https://google.github.io/styleguide/pyguide.html>). 언급이 없는 부분은 **PEP 8**을 따른다.
- 기계적 스타일링은 문서가 아닌 도구로 강제한다. 커밋 전 항상 다음을 통과해야 한다:
  ```bash
  uv run ruff check .
  uv run ruff format . --check
  uv run mypy app
  ```
- 도구를 통과한 코드는 올바르게 스타일링된 것으로 보며, 도구가 잡지 않는 주관적 포맷팅을 억지로 강요하지 않는다.

---

## 3. 객체지향 설계 원칙

- 도메인은 데이터와 그 데이터에 대한 행위를 함께 소유하는 클래스로 모델링한다. 외부 호출자가 직접 알 필요 없는 내부 상태는 비공개(`_name`)로 유지한다.
- **경계에서의 인터페이스 의존**: 특정 계층이 직접 구현하지 않는 기능(외부 API, DB 접근, 알림 등)을 소비할 때는 반드시 `Protocol`(또는 추상 베이스)을 정의하고 의존성을 주입받는다.
- **상속보다 합성(Composition over Inheritance)**: 하위 클래스가 상위 클래스를 완전히 대체할 수 있는 명확한 is-a 관계(Liskov 치환 원칙)에서만 상속을 허용한다. 단순 코드 재사용 목적의 상속은 금지한다.
- **YAGNI (You Aren't Gonna Need It)**: 최소 2개 이상의 구체적인 구현체나 사용처가 존재하기 전까지는 미리 추상화 계층(인터페이스, 팩토리, 제네릭 프레임워크)을 도입하지 않는다.

---

## 4. 클린 아키텍처 (Clean Architecture)

로버트 C. 마틴의 **Clean Architecture** 원칙을 준수한다.
단 하나의 최우선 규칙은 **의존성 규칙(Dependency Rule)**이다: **소스코드 의존성은 반드시 안쪽(고수준 정책)을 향해야 한다.** 안쪽 원은 바깥쪽 원의 세부사항을 결코 알아서는 안 된다.

```
Domain (Entities) → Services (Use Cases) → Adapters/DTOs (Interface Adapters) → Infra/FastAPI (Frameworks & Drivers)
     (안쪽)                                                                              (바깥쪽)
        ↑ ────────── 모든 소스코드 의존성은 안쪽(Domain)으로만 향한다 ────────── ↑
```

- **Domain (`chronic_disease_engine/`, 도메인 계산 규칙)**: 순수 비즈니스 로직. 프레임워크, 외부 I/O, DB 의존성이 전혀 없으며 순수 단위 테스트로 검증된다.
- **Services/Use Cases (`app/services/`)**: 애플리케이션 유스케이스 및 오케스트레이션. 외부 계층과 소통하기 위한 경계 인터페이스(`Protocol`)를 소유한다.
- **Interface Adapters (`app/api/`, `app/dtos/`)**: 웹 요청/응답 변환, DTO 직렬화, 외부 포맷과의 데이터 중재.
- **Frameworks & Drivers (`app/core/db/`, `app/integrations/`, Docker, Redis)**: 데이터베이스, 웹 프레임워크, LLM 외부 API, 서드파티 SDK 등 세부사항(Details).

경계를 넘나들 때는 **의존성 역전 원칙(DIP)**을 사용한다: 안쪽 계층이 `Protocol`을 정의하고, 바깥쪽 계층이 이를 구현하여 주입한다.

과도한 엔지니어링 방지 규칙:
- 단순히 전달만 하는 무의미한 패스스루(Pass-through) 파일이나 패키지를 만들지 않는다.
- 응집도 높은 클래스들은 하나의 모듈에 모으고, 클래스 1개당 파일 1개를 기계적으로 강제하지 않는다.

---

## 5. 이어봄(Ieobom) 4대 서브시스템 파이프라인 설계

이어봄은 만성질환 예방 및 가족 건강 관리를 위한 4대 서브시스템으로 구성된다.

### ① 만성질환 위험도 예측 (ML 서빙 파이프라인)
- **서빙 런타임 sklearn·numpy 의존 0**: 배포 컨테이너의 가벼움과 결정론적 채점을 위해 학습 모델은 순수 JSON 가중치 번들로 export되며, 서빙은 순수 파이썬으로 가동된다.
- **라벨 누출 차단**: 단일 진실 원천 `modeling/targets.py`를 엄격히 준수한다.
- **단조 방향 계약**: 위험 요인과 판정 결과의 인과적 일관성을 유지한다.

### ② 봄이 건강 비서 (챗봇 & RAG 파이프라인)
- **인풋 가드레일 & 쿼리 빌더 (3단계)**:
  1. 하드룰 정규식 필터링 (욕설/탈옥 차단)
  2. 사전 패스트패스 (인사말, 서비스 사용법 즉각 응답)
  3. LLM 기반 맥락 추론 및 쿼리 풍부화 (`QueryAnalyst`)
- **실시간 외부 환경 및 의료 툴콜링**:
  - 기상청 단기예보 실황 (`KMA_API_KEY`), 에어코리아 대기질 (`AIRKOREA_API_KEY`), 카카오 로컬 (`KAKAO_REST_API_KEY`)
  - 식약처 의약품(`MFDS_API_KEY`), 식품영양성분(`FOOD_NUTRITION_API_KEY`)
- **그라운딩(Grounding) 안전 수칙**: 수치적 근거가 없는 경우 임의로 추측하거나 환각을 일으키지 않고 확인 불가 사실을 명시한다.

### ③ 3D 장기 해부학 뷰어 (Anatomy Event 연동)
- 건강 다이어리 및 검진 소견에서 추출된 장기/계통 식별자를 3D Atlas (`vanatome`) 메쉬 ID와 매핑한다.
- 진단 소견(적색), 통증/증상(황색), 사후 입력 기록 등을 타임라인과 결합하여 인터랙티브하게 가시화한다.

### ④ 건강검진 결과지 OCR & 저장소 파이프라인
- 검진 결과지(이미지/PDF)에서 검사 항목과 수치를 디지털 레코드로 변환.
- 원본 이미지나 민감 정보는 마스킹 처리되며, 표준화된 `HealthRecord` 엔티티로 암호화 저장된다.

---

## 6. Tidy First & 커밋 원칙

Kent Beck의 **Tidy First** 철학을 저장소의 Conventional Commit 체계와 결합한다:

- 모든 변경은 다음 둘 중 하나로 명확히 분리한다:
  1. **구조적 변경 (Structural)**: 동작을 바꾸지 않는 정리 (이름 변경, 함수 추출, 파일 이동, 타입 힌트 보강 등)
  2. **기능적 변경 (Behavioral)**: 새로운 기능 추가, 버그 수정, 정책 변경 등
- **원칙**: 구조적 정리와 기능 추가를 한 커밋에 섞지 않는다. 리팩토링이 필요할 때는 먼저 구조를 정리하여 테스트를 통과시킨 후(`refactor: ...`), 별도의 커밋으로 기능을 추가(`feat: ...` 또는 `fix: ...`)한다.
- **한 커밋에 한 변경**: 원자적 단위(Atomic Commit)로 커밋하며, 커밋 메시지에 변경 목적과 측정값을 명확히 기록한다.

---

## 7. 테스트 및 검증 격리 전략

- **네트워크 격리 (격리도 100%)**: 단위 테스트(`app/tests/model/`, 프론트엔드 유닛테스트)는 외부 네트워크 호출이 0이어야 한다. 모든 외부 API 클라이언트는 `Protocol`을 기반으로 Mocking/Fake 객체를 주입한다.
- **DB 불필요 테스트 우선 실행**: 모델 채점 및 순수 로직 테스트(`app/tests/model`)를 DB 통합 테스트보다 항상 먼저 수행하여 빠른 피드백 루프를 유지한다.
