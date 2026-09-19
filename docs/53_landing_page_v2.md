# 공개 랜딩페이지 v2 — 제거됨

> 최종 갱신: 2026-09-20
> 관련 문서: [52 랜딩페이지](52_landing_page.md) · [DESIGN.md](../DESIGN.md)

캡슐·오버진 비교 시안(`/landing-v2`, `frontend/src/features/landing-v2/`)은 제품에서 뺐다. 공개 소개는 [52번](52_landing_page.md)의 `/landing`(연꽃 마크·히어로 차트) 한 벌이다.

예전 주소 `/landing-v2` 는 `/landing` 으로 보낸다. `LandingV2Page` 와 `features/landing-v2` 를 다시 넣지 않는다. 그 조건은 `app/router.test.tsx` 가 지킨다.
