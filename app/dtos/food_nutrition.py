"""식약처 식품영양성분 데이터베이스 조회 결과 DTO."""

from __future__ import annotations

from pydantic import BaseModel, Field


class FoodNutritionItem(BaseModel):
    """단일 식품의 영양성분 정보."""

    food_name: str = Field(description="식품명 (예: 신라면, 배추김치, 짜장면)")
    serving_size: str | None = Field(default=None, description="1회 제공량 / 섭취참고량 (예: 120g, 1인분(650g), 100g)")
    calories_kcal: float | None = Field(default=None, description="열량 (kcal)")
    carbohydrate_g: float | None = Field(default=None, description="탄수화물 (g)")
    protein_g: float | None = Field(default=None, description="단백질 (g)")
    fat_g: float | None = Field(default=None, description="지방 (g)")
    sugar_g: float | None = Field(default=None, description="당류 (g)")
    sodium_mg: float | None = Field(default=None, description="나트륨 (mg)")
    cholesterol_mg: float | None = Field(default=None, description="콜레스테롤 (mg)")
    saturated_fat_g: float | None = Field(default=None, description="포화지방산 (g)")
    trans_fat_g: float | None = Field(default=None, description="트랜스지방산 (g)")
    maker_name: str | None = Field(default=None, description="제조/외식/식품업체명")


class FoodNutritionSearchResult(BaseModel):
    """식품 영양성분 검색 종합 결과."""

    query: str = Field(description="검색 질의어")
    items: list[FoodNutritionItem] = Field(default_factory=list, description="검색된 식품 영양성분 목록")
    message: str = Field(default="", description="사용자에게 전달할 영양 분석 및 요약 안내 메시지")
    errors: list[str] = Field(default_factory=list, description="조회 중 발생한 오류 목록")
