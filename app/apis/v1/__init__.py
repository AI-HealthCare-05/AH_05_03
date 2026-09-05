from fastapi import APIRouter

from app.apis.v1.account_routers import account_router
from app.apis.v1.assessment_summary_routers import assessment_summary_router
from app.apis.v1.auth_routers import auth_router
from app.apis.v1.challenge_routers import challenge_router
from app.apis.v1.chat_session_routers import chat_session_router
from app.apis.v1.dev_ocr_routers import dev_ocr_router
from app.apis.v1.family_invitation_routers import family_invitation_router
from app.apis.v1.health_assistant_routers import health_assistant_router
from app.apis.v1.household_routers import household_router
from app.apis.v1.pain_chat_routers import pain_chat_router
from app.apis.v1.prediction_job_routers import prediction_job_router
from app.apis.v1.prediction_routers import prediction_router
from app.apis.v1.profile_link_routers import profile_link_router
from app.apis.v1.rule_assessment_routers import rule_assessment_router
from app.apis.v1.subscription_routers import subscription_router

v1_routers = APIRouter(prefix="/api/v1")
v1_routers.include_router(auth_router)
v1_routers.include_router(account_router)
v1_routers.include_router(subscription_router)
v1_routers.include_router(household_router)
v1_routers.include_router(family_invitation_router)
v1_routers.include_router(profile_link_router)
v1_routers.include_router(prediction_router)
# 큐 경로는 /predictions/jobs 라서 prediction_router 보다 뒤에 와도 충돌하지 않는다.
v1_routers.include_router(prediction_job_router)
v1_routers.include_router(rule_assessment_router)
# 화면이 붙는 단일 진입점 (ADR-009 §8). 위 셋을 지우지 않는 이유는 라우터 설명 참조.
v1_routers.include_router(assessment_summary_router)
# 생활습관 챌린지. Talos 필수 셋 중 마지막 칸 (docs/37 §14~§16).
v1_routers.include_router(challenge_router)
# 대화 경로 둘. 외부 유료 API 를 부르므로 인증 + 계정별 상한이 붙어 있다.
v1_routers.include_router(health_assistant_router)
v1_routers.include_router(pain_chat_router)
# 대화 세션 및 메시지 영구 보존
v1_routers.include_router(chat_session_router)
# Gemini 문서 인식 개발 브리지 (PR #24). 기본 꺼짐 — `ENABLE_DEV_OCR_BRIDGE`.
v1_routers.include_router(dev_ocr_router)
