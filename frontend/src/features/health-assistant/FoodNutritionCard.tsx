import React, { useState } from "react";
import type { FoodNutritionItem, FoodNutritionSearchResult } from "./healthAssistantClient";

interface FoodNutritionCardProps {
  searchResult: FoodNutritionSearchResult;
}

export const FoodNutritionCard: React.FC<FoodNutritionCardProps> = ({ searchResult }) => {
  const { items } = searchResult;
  const [selectedIndex, setSelectedIndex] = useState(0);

  if (!items || items.length === 0) {
    return null;
  }

  const currentItem: FoodNutritionItem = items[selectedIndex] ?? items[0];

  const isSodiumHigh = currentItem.sodium_mg !== null && currentItem.sodium_mg !== undefined && currentItem.sodium_mg >= 1000;
  const isSugarHigh = currentItem.sugar_g !== null && currentItem.sugar_g !== undefined && currentItem.sugar_g >= 20;

  return (
    <div className="food-nutrition-card" role="region" aria-label="식품영양성분 정보">
      <div className="food-nutrition-header">
        <div className="food-nutrition-title-area">
          <span className="food-nutrition-badge">식품영양성분</span>
          <h4 className="food-nutrition-food-name">{currentItem.food_name}</h4>
          {currentItem.maker_name && (
            <span className="food-nutrition-maker">({currentItem.maker_name})</span>
          )}
        </div>
        {currentItem.serving_size && (
          <span className="food-nutrition-serving">제공량: {currentItem.serving_size}</span>
        )}
      </div>

      {items.length > 1 && (
        <div className="food-nutrition-tabs" role="tablist">
          {items.map((item, idx) => (
            <button
              key={idx}
              type="button"
              role="tab"
              aria-selected={selectedIndex === idx}
              className={`food-nutrition-tab-btn ${selectedIndex === idx ? "active" : ""}`}
              onClick={() => setSelectedIndex(idx)}
            >
              {item.food_name}
            </button>
          ))}
        </div>
      )}

      <div className="food-nutrition-grid">
        <div className="food-nutrition-stat-item primary">
          <span className="stat-label">열량</span>
          <span className="stat-value">
            {currentItem.calories_kcal !== null && currentItem.calories_kcal !== undefined
              ? `${currentItem.calories_kcal.toLocaleString()} kcal`
              : "-"}
          </span>
        </div>

        <div className={`food-nutrition-stat-item ${isSodiumHigh ? "warning" : ""}`}>
          <div className="stat-label-row">
            <span className="stat-label">나트륨</span>
            {isSodiumHigh && <span className="stat-pill-warn">주의</span>}
          </div>
          <span className="stat-value">
            {currentItem.sodium_mg !== null && currentItem.sodium_mg !== undefined
              ? `${currentItem.sodium_mg.toLocaleString()} mg`
              : "-"}
          </span>
        </div>

        <div className={`food-nutrition-stat-item ${isSugarHigh ? "warning" : ""}`}>
          <div className="stat-label-row">
            <span className="stat-label">당류</span>
            {isSugarHigh && <span className="stat-pill-warn">주의</span>}
          </div>
          <span className="stat-value">
            {currentItem.sugar_g !== null && currentItem.sugar_g !== undefined
              ? `${currentItem.sugar_g.toLocaleString()} g`
              : "-"}
          </span>
        </div>

        <div className="food-nutrition-stat-item">
          <span className="stat-label">탄수화물</span>
          <span className="stat-value">
            {currentItem.carbohydrate_g !== null && currentItem.carbohydrate_g !== undefined
              ? `${currentItem.carbohydrate_g.toLocaleString()} g`
              : "-"}
          </span>
        </div>

        <div className="food-nutrition-stat-item">
          <span className="stat-label">단백질</span>
          <span className="stat-value">
            {currentItem.protein_g !== null && currentItem.protein_g !== undefined
              ? `${currentItem.protein_g.toLocaleString()} g`
              : "-"}
          </span>
        </div>

        <div className="food-nutrition-stat-item">
          <span className="stat-label">지방</span>
          <span className="stat-value">
            {currentItem.fat_g !== null && currentItem.fat_g !== undefined
              ? `${currentItem.fat_g.toLocaleString()} g`
              : "-"}
          </span>
        </div>
      </div>

      {(isSodiumHigh || isSugarHigh) && (
        <div className="food-nutrition-alert">
          {isSodiumHigh && (
            <p>나트륨 함량이 1일 권장량(2,000mg) 대비 높은 편입니다. 국물을 적게 드시길 권장합니다.</p>
          )}
          {isSugarHigh && (
            <p>당류 함량이 높은 편이므로 혈당 관리가 필요하신 경우 섭취량 조절을 권장합니다.</p>
          )}
        </div>
      )}
    </div>
  );
};
