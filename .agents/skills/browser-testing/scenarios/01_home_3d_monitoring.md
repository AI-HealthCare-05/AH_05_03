# 시나리오 01: 가족 홈 대시보드 & 3D 장기 뷰어 렌더링 부하 감사

```gherkin
Feature: 가족 홈 대시보드 로딩, 3D 장기 해부학 뷰어 부하 및 API 호출수 감사

  Scenario: 사용자가 홈 화면에 접속하여 대시보드와 3D 뷰어가 정상 렌더링되고 부하가 없는지 확인한다
    Given 사용자가 웹 브라우저를 열고 "http://127.0.0.1/" 에 접속한다
    
    # 1. 콘솔 및 소프트 에러 검증
    Then 브라우저 콘솔에 "console.error" 및 치명적 런타임 에러가 0건이어야 한다
    And React key 경고("Each child in a list should have a unique 'key' prop")가 없어야 한다
    And React hydration mismatch 경고가 없어야 한다

    # 2. 네트워크 부하 & API 호출 수 감사
    Then 초기 로딩 시 호출된 백엔드 API 목록을 수집한다
    And 동일한 API 엔드포인트가 2초 내에 3회 이상 중복 호출되는 오버페칭(Over-fetching)이 없어야 한다
    And 모든 API 응답 상태 코드가 200, 201, 또는 304이어야 하며 4xx, 5xx 소리 없는 실패(Silent catch)가 없어야 한다

    # 3. 3D 해부학 뷰어 (WebGL) 렌더링 및 GPU 부하 감사
    Then 3D 뷰어 캔버스("canvas") 요소가 3초 이내에 렌더링을 완료해야 한다
    And 장기 메쉬 및 타임블록라인 이벤트 노드가 화면에 시각적으로 표시되어야 한다
    And 사용자의 마우스 인터랙션이 없을 때 불필요한 GPU 무한 렌더 루프가 유휴(Idle) 상태로 수렴해야 한다

    # 4. 계통 레이어 인터랙션 및 GLB 리소스 부하 감사 (ERR_ABORTED 탐지)
    When 3D 계통 레이어 토글 버튼(신경계, 소화계 등)을 순차적으로 3회 이상 클릭한다
    Then 대용량 GLB 메쉬 다운로드 시 비정상 중단("net::ERR_ABORTED") 에러가 발생하지 않아야 한다
    And WebGL "GPU stall due to ReadPixels" 과다 경고가 발생하지 않는지 확인한다

    # 5. 최종 증적 및 원본 콘솔 로그 첨부 (추측 보고 금지)
    Then 전체 페이지 렌더링 완료 상태의 스크린샷을 캡처한다
    And 수집된 콘솔 로그(에러/경고/네트워크 실패) 원본 전체를 리포트 본문에 인용한다
```

