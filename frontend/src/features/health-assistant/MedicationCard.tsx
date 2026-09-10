import React, { useState } from "react";
import type { DrugInfo, MedicationSearchResult } from "./healthAssistantClient";

interface MedicationCardProps {
  searchResult: MedicationSearchResult;
  children?: React.ReactNode;
}

export const MedicationCard: React.FC<MedicationCardProps> = ({ searchResult, children }) => {
  const { items, interaction_items, has_interaction_danger, target_drug_name, query } = searchResult;
  const [selectedDrugIndex, setSelectedDrugIndex] = useState(0);

  const isInteractionQuery = Boolean(target_drug_name || (interaction_items && interaction_items.length > 0));
  const [showDetails, setShowDetails] = useState(!isInteractionQuery && !children);

  if (!isInteractionQuery && (!items || items.length === 0)) {
    return children ? <>{children}</> : null;
  }

  return (
    <div
      className={`medication-card ${has_interaction_danger ? "interaction-danger" : ""}`}
      role="region"
      aria-label="식약처 의약품 및 DUR 정보"
    >
      {/* 1. 최상단: 결론 및 DUR 병용 검사 결과 영역 */}
      {isInteractionQuery ? (
        <div className="medication-interaction-section">
          <div className="medication-header">
            <span
              className={`medication-badge ${
                has_interaction_danger ? "badge-danger" : "badge-safe"
              }`}
            >
              {has_interaction_danger ? "식약처 DUR 병용금기 주의" : "식약처 DUR 병용 안전 확인"}
            </span>
            <span className="medication-query-text">{query}</span>
          </div>

          {has_interaction_danger && interaction_items.length > 0 ? (
            <div className="interaction-danger-content">
              {interaction_items.map((item, idx) => (
                <div key={idx} className="interaction-item-box">
                  <div className="interaction-drugs-row">
                    <span className="drug-pill primary">{item.drug_a}</span>
                    <span className="interaction-vs">⚠️ 병용금기 ⚠️</span>
                    <span className="drug-pill secondary">{item.drug_b}</span>
                  </div>

                  <div className="interaction-reason-box">
                    <strong className="reason-label">금기 사유:</strong>
                    <span className="reason-text">{item.prohibition_content}</span>
                  </div>

                  <div className="interaction-ingredients">
                    {item.ingredient_a && (
                      <span className="ingredient-tag">
                        기준 성분: {item.ingredient_a}
                      </span>
                    )}
                    {item.ingredient_b && (
                      <span className="ingredient-tag">
                        상대 성분: {item.ingredient_b}
                      </span>
                    )}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="interaction-safe-content">
              <p className="interaction-safe-message">
                식약처 DUR 데이터베이스상 두 약품 간의 <strong>직접적인 병용금기 항목은 확인되지 않았습니다.</strong>
              </p>
            </div>
          )}
        </div>
      ) : (
        /* 단일 약품 정보인 경우 상단 배너 */
        items && items.length > 0 && !children && (
          <div className="medication-header">
            <span className="medication-badge badge-safe">💊 식약처 의약품 정보</span>
            <span className="medication-query-text">{query}</span>
          </div>
        )
      )}

      {/* 2. 중간: AI 어시스턴트의 설명 본문 (children이 전달된 경우) */}
      {children && <div className="medication-chat-content">{children}</div>}

      {/* 3. 하단 바: 상세 접기/펼치기 버튼 및 출처 */}
      {items && items.length > 0 && (
        <div className="medication-bottom-bar">
          <button
            type="button"
            className="medication-toggle-details-btn"
            onClick={() => setShowDetails((prev) => !prev)}
            aria-expanded={showDetails}
          >
            <span>각 약품 상세 정보(효능·용법) {showDetails ? "접기 ▲" : "보기 ▼"}</span>
          </button>
          <span className="medication-source-text">출처: 식약처 e약은요 & DUR</span>
        </div>
      )}

      {/* 4. 개별 의약품 기본 정보 탭 및 세부 정보 (접기/펼치기 제어) */}
      {showDetails && items && items.length > 0 && (
        <div className="medication-details-section">
          {items.length > 1 && (
            <div className="medication-tabs" role="tablist">
              {items.map((drug, idx) => (
                <button
                  key={idx}
                  type="button"
                  role="tab"
                  aria-selected={selectedDrugIndex === idx}
                  className={`medication-tab-btn ${selectedDrugIndex === idx ? "active" : ""}`}
                  onClick={() => setSelectedDrugIndex(idx)}
                >
                  {drug.item_name.split("(")[0].trim()}
                </button>
              ))}
            </div>
          )}

          {(() => {
            const currentDrug: DrugInfo = items[selectedDrugIndex] ?? items[0];
            return (
              <div className="medication-info-body">
                <div className="medication-title-row">
                  <h4 className="medication-item-name">{currentDrug.item_name}</h4>
                  {currentDrug.entp_name && (
                    <span className="medication-entp-name">{currentDrug.entp_name}</span>
                  )}
                  {currentDrug.class_name && (
                    <span className="medication-class-name">[{currentDrug.class_name}]</span>
                  )}
                </div>

                <div className="medication-info-fields">
                  {currentDrug.efcy_qesitm && (
                    <div className="medication-field">
                      <span className="field-label">효능·효과</span>
                      <p className="field-content">{currentDrug.efcy_qesitm}</p>
                    </div>
                  )}

                  {currentDrug.use_method_qesitm && (
                    <div className="medication-field">
                      <span className="field-label">용법·용량</span>
                      <p className="field-content">{currentDrug.use_method_qesitm}</p>
                    </div>
                  )}

                  {currentDrug.dur_items && currentDrug.dur_items.length > 0 && (
                    <div className="medication-field dur-warnings">
                      <span className="field-label">DUR 주의</span>
                      <div className="dur-items-list">
                        {currentDrug.dur_items.slice(0, 3).map((d, dIdx) => (
                          <span key={dIdx} className="dur-item-tag">
                            [{d.prohibition_type}] {d.ingredient_name || d.reason || ""}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}

                  {(currentDrug.atpn_warn_qesitm || currentDrug.atpn_qesitm) && (
                    <div className="medication-field">
                      <span className="field-label">주의사항</span>
                      <p className="field-content warn-text">
                        {currentDrug.atpn_warn_qesitm || currentDrug.atpn_qesitm}
                      </p>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}
        </div>
      )}

      {!isInteractionQuery && !items?.length && (
        <div className="medication-card-footer">
          <span className="medication-source-text">출처: 식품의약품안전처 e약은요 & DUR 품목정보</span>
        </div>
      )}
    </div>
  );
};
