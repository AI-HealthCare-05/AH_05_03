# 미등록 해부학 사전 항목 추적 및 등록 가이드

본 문서는 이어봄 3D 인체 모델(Z-Anatomy) 연동 시 발생하는 메쉬 명칭 중, 표준 해부학 사전에 미등록된 항목의 자동 감지 메커니즘, 메모 위치 및 등록 절차를 정의한다.

---

## 1. 배경 및 원칙

이어봄의 3D 인체 뷰어는 Terminologia Anatomica(TA98/TA2) 및 FMA 기반의 Z-Anatomy 오픈소스 GLTF 모델을 사용한다.
모델 내 수천 개의 세부 해부학 메쉬는 계층 구조 명칭(예: `Appendicular Skeleton Capitate Bone Left Capitate Bonel`)을 지니고 있어, 표준 의학 사전이 없으면 난독성 영문 원문이 사용자 화면에 그대로 노출되는 문제가 발생한다.

이에 따라 다음 원칙을 준수한다:
1. **대한해부학회(KAA) 해부학 용어집 제6판 및 대한의사협회(KMA) 의학용어 제6판 정본 준수**:
   - 임상 한자어(구용어)와 환자 친화적 순우리말(신용어)을 병기한다. (예: `유두골 (알머리뼈)`)
2. **미등록 메쉬의 자동 추적 및 메모**:
   - 뷰어 로드 또는 스프레이 칠하기/탐색 중 사전에 없는 메쉬가 탐지되면 즉시 레지스트리에 자동 메모된다.
3. **무결점 레이아웃(Safe Fallback)**:
   - 미등록 상태이더라도 거대한 계층 접두사(`Appendicular Skeleton `, `Skeleton ` 등)와 중복 토큰을 자동 정제하여 정돈된 학명(`CleanedName (Left)`)으로 표시하며, 줄바꿈/말줄임과 툴팁을 제공한다.

---

## 2. 미등록 부위 메모 및 확인 위치

미등록 부위는 런타임 및 개발 환경에서 다음과 같은 위치에 메모되고 확인된다.

### (1) 코드 레벨 메모 위치
- **모듈 파일**: `frontend/src/features/home/anatomyKoreanDictionary.ts`
- **저장소 객체**: `unregisteredAnatomyRegistry: Set<string>`
- **조회 함수**: `getUnregisteredAnatomyList(): string[]`
- **초기화 함수**: `clearUnregisteredAnatomyList(): void`

### (2) 브라우저 콘솔 확인 위치
프런트엔드가 로컬 또는 개발 모드로 실행 중일 때 브라우저 개발자 도구(F12) 콘솔에서 언제든 다음 명령어로 미등록 부위 목록을 조회할 수 있다:

```javascript
// 현재까지 뷰어에서 감지된 미등록 해부학 메쉬 원문 목록 배열 반환
window.__getUnregisteredAnatomy();
```

---

## 3. 2026-09-10 정식 보강 완료 항목 (골격계)

스크린샷 결함 원인이었던 주요 골격계 부위는 대한해부학회 제6판 표준에 따라 전수 등록되었다:

| 원문 메쉬 키워드 | 대한해부학회 제6판 표준 한글명 | Canonical Name (TA98) | 비고 |
|---|---|---|---|
| `capitate` | **유두골 (알머리뼈)** | Capitate bone | 수근골 원위부 중앙 최대뼈 |
| `lunate` | **월상골 (반달뼈)** | Lunate bone | 수근골 근위부 반달형 뼈 |
| `scaphoid` | **주상골 (손배뼈)** | Scaphoid bone | 수근골 골절 최다 호발 부위 |
| `triquetrum` | **삼각골 (세모뼈)** | Triquetral bone | 수근골 근위부 새끼손가락 쪽 |
| `pisiform` | **두상골 (콩알뼈)** | Pisiform bone | 삼각골 전면 종자골 |
| `trapezium` | **대능형골 (큰마름뼈)** | Trapezium bone | 엄지손가락 대립 관절 형성 |
| `trapezoid` | **소능형골 (작은마름뼈)** | Trapezoid bone | 제2중수골 결합 마름모뼈 |
| `hamate` | **유구골 (갈고리뼈)** | Hamate bone | 척골신경 통과 갈고리 돌기 |
| `metacarpal` | **중수골 (손허리뼈)** | Metacarpal bone | 손바닥 뼈대 |
| `phalanx hand` | **수지 지골 (기절골·중절골·말절골)** | Phalanges of hand | 손가락 마디뼈 |
| `hip bone` / `coxal bone` | **관골 (볼기뼈 / 골반골)** | Hip bone (Coxal bone) | 장골·좌골·치골 복합체 |
| `ischium` | **좌골 (궁둥뼈)** | Ischium | 궁둥뼈 결절 |
| `pubis` | **치골 (두덩뼈)** | Pubis | 치골결합 |
| `coccyx` | **미골 (꼬리뼈)** | Coccyx | 천골 하단 융합뼈 |
| `navicular` | **주상골 (발배뼈)** | Navicular bone | 발목 내측 아치 지지 |
| `cuboid` | **입방골 (입방뼈)** | Cuboid bone | 발목 외측 주사위뼈 |
| `cuneiform` | **설상골 (내측·중간·외측 쐐기뼈)** | Cuneiform bones | 발등 아치 쐐기뼈 3종 |
| `metatarsal` | **중족골 (발허리뼈)** | Metatarsal bone | 발바닥 아치 뼈대 |
| `phalanx foot` | **족지 지골 (기절골·중절골·말절골)** | Phalanges of foot | 발가락 마디뼈 |
| `atlas` | **환추 (제1목뼈 / 고리뼈)** | Atlas (C1 vertebra) | 머리 끄덕임 관절 |
| `axis` | **축추 (제2목뼈 / 중쇠뼈)** | Axis (C2 vertebra) | 머리 좌우 회전축 |
| `costal cartilage` | **늑연골 (갈비연골)** | Costal cartilage | 흉골-늑골 연결 유리연골 |
| `palatine bone` | **구개골 (입천장뼈)** | Palatine bone | 입천장 뒷부분 |
| `vomer` | **서골 (보습뼈)** | Vomer | 비중격 후하부 쟁기뼈 |

---

## 4. 미등록 부위 발생 시 신규 등록 절차

1. 브라우저 콘솔에서 `window.__getUnregisteredAnatomy()` 호출 또는 뷰어 동작 중 콘솔 경고 로그 확인.
2. 미등록 메쉬명의 영문 학명 확인 (예: `zygomaticus major`).
3. 대한의사협회 의학용어 제6판 검색기(https://term.kma.org) 또는 대한해부학회 용어집 대조.
4. `frontend/src/features/home/anatomyKoreanDictionary.ts`의 `ANATOMY_DICTIONARY` 객체에 신규 항목 추가:
   ```typescript
   "zygomaticus major": {
     korean: "대관골근 (큰광대근)",
     canonical: "Zygomaticus major muscle",
     system: "muscular",
     systemKorean: "근육계",
     description: "입꼬리를 위뒤쪽으로 당겨 미소나 웃는 표정을 짓게 하는 주요 안면 표정근입니다.",
   },
   ```
5. `src/features/home/anatomyKoreanDictionary.test.ts`에 단위 테스트 케이스 추가 후 검증 실행 (`npm test`).
