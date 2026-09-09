import { useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { ANATOMY_DICTIONARY } from "./anatomyKoreanDictionary";
import { ADULT_TEETH } from "./dentalPickerLogic";

export interface SearchResultItem {
  id: string;
  sourceKey: string;
  koreanName: string;
  canonicalName: string;
  system: string;
  systemKorean: string;
  description: string;
  category: "anatomy" | "dental";
  approxPoint?: [number, number, number];
}

interface AnatomySearchDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectResult?: (item: SearchResultItem) => void;
  onSelectAnatomy?: (item: SearchResultItem) => void;
}

export function AnatomySearchDrawer({
  isOpen,
  onClose,
  onSelectResult,
  onSelectAnatomy,
}: AnatomySearchDrawerProps) {
  const [query, setQuery] = useState("");

  const handleSelect = (item: SearchResultItem) => {
    onSelectResult?.(item);
    onSelectAnatomy?.(item);
  };

  const searchResults = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const tokens = q.split(/\s+/).filter(Boolean);
    const cleanQ = q.replace(/\s+/g, "");

    const matchesSearch = (haystack: string) => {
      const lower = haystack.toLowerCase();
      // 1. 공백 제거 형태 포함 (예: "회전 근개" <-> "회전근개")
      if (cleanQ.length >= 2 && lower.replace(/\s+/g, "").includes(cleanQ)) return true;
      // 2. 다중 토큰 전체 포함 (AND 검색, 순서 무관)
      if (tokens.length > 1 && tokens.every((token) => lower.includes(token))) return true;
      // 3. 단일 토큰 포함
      if (tokens.length === 1 && lower.includes(tokens[0])) return true;
      return false;
    };

    const COMMON_ALIASES: Record<string, string[]> = {
      "회전근개": ["supraspinatus", "infraspinatus", "subscapularis", "teres minor"],
      "어깨": ["deltoid", "supraspinatus", "infraspinatus", "subscapularis", "teres minor", "scapula", "clavicle", "trapezius"],
      "오십견": ["supraspinatus", "infraspinatus", "subscapularis", "teres minor"],
      "허리": ["vertebra", "erector spinae", "quadratus lumborum", "sacrum", "latissimus dorsi"],
      "목": ["vertebra", "sternocleidomastoid", "splenius capitis", "trapezius"],
      "무릎": ["patella", "rectus femoris", "vastus lateralis", "vastus medialis", "biceps femoris"],
      "햄스트링": ["biceps femoris", "semitendinosus", "semimembranosus"],
      "종아리": ["gastrocnemius", "soleus", "tibialis anterior"],
      "갈비뼈": ["rib"],
      "늑골": ["rib"],
    };

    const results: SearchResultItem[] = [];

    // 1. 치아 검색 매칭
    for (const tooth of ADULT_TEETH) {
      const toothHaystack = `${tooth.shortCode} ${tooth.koreanName} ${tooth.commonName} ${tooth.quadrant} 치아`;
      let toothMatched = matchesSearch(toothHaystack);
      if (!toothMatched) {
        if (cleanQ.includes("앞니") && (tooth.commonName.includes("Incisor") || tooth.koreanName.includes("절치"))) toothMatched = true;
        if (cleanQ.includes("송곳니") && (tooth.commonName.includes("Canine") || tooth.koreanName.includes("견치"))) toothMatched = true;
        if (cleanQ.includes("어금니") && (tooth.commonName.includes("Molar") || tooth.koreanName.includes("구치"))) toothMatched = true;
      }
      if (toothMatched) {
        results.push({
          id: `tooth_${tooth.fdiNumber}`,
          sourceKey: `dental:fdi:${tooth.fdiNumber}`,
          koreanName: tooth.koreanName,
          canonicalName: tooth.commonName,
          system: "dental",
          systemKorean: "치아/구강",
          description: `${tooth.shortCode} (${tooth.quadrant})`,
          category: "dental",
          approxPoint: tooth.approxPoint,
        });
      }
    }

    // 2. 해부학 용어 사전 매칭
    for (const [key, entry] of Object.entries(ANATOMY_DICTIONARY)) {
      const haystack = `${key} ${entry.korean} ${entry.canonical} ${entry.systemKorean} ${entry.description}`;
      let matched = matchesSearch(haystack);
      if (!matched) {
        for (const [aliasKey, targetKeys] of Object.entries(COMMON_ALIASES)) {
          if (cleanQ.includes(aliasKey) && targetKeys.some((tk) => key.toLowerCase().includes(tk))) {
            matched = true;
            break;
          }
        }
      }
      if (matched) {
        results.push({
          id: key,
          sourceKey: `vanatome:1.0:${key}`,
          koreanName: entry.korean,
          canonicalName: entry.canonical,
          system: entry.system,
          systemKorean: entry.systemKorean,
          description: entry.description,
          category: "anatomy",
        });
      }
      if (results.length >= 40) break; // 최대 40개 표시
    }

    return results;
  }, [query]);

  if (!isOpen) return null;

  const content = (
    <div className="anatomy-search-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-label="해부학 부위 검색">
      <div className="anatomy-search-drawer" onClick={(e) => e.stopPropagation()}>
        <div className="anatomy-search-header">
          <div className="search-input-wrapper">
            <span className="search-icon">🔍</span>
            <input
              type="text"
              className="anatomy-search-input"
              placeholder="부위명 검색 (예: 승모근, 갈비뼈, 위, #16, 어금니)"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              autoFocus
            />
            {query && (
              <button
                type="button"
                className="search-clear-btn"
                onClick={() => setQuery("")}
                aria-label="검색어 지우기"
              >
                ✕
              </button>
            )}
          </div>
          <button type="button" className="drawer-close-btn" onClick={onClose} aria-label="닫기">
            ✕
          </button>
        </div>

        {/* 추천 퀵 키워드 */}
        {!query && (
          <div className="anatomy-search-suggestions">
            <p>자주 찾는 부위</p>
            <div className="suggestion-chips">
              {["대흉근", "승모근", "요추(허리)", "갈비뼈", "무릎 관절", "어금니 #16", "위장", "어깨 회전근개"].map((kw) => (
                <button
                  key={kw}
                  type="button"
                  className="suggestion-chip"
                  onClick={() => setQuery(kw.replace(/ #\d+/, ""))}
                >
                  {kw}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 검색 결과 목록 */}
        <div className="anatomy-search-results">
          {query && searchResults.length === 0 && (
            <div className="search-empty-state">
              <p>"{query}"에 일치하는 해부학 구조를 찾지 못했습니다.</p>
              <small>다른 동의어(예: 무릎, 앞니, 승모근 등)로 검색해 보세요.</small>
            </div>
          )}

          {searchResults.map((item) => (
            <button
              key={item.id}
              type="button"
              className="search-result-row"
              onClick={() => {
                handleSelect(item);
                onClose();
              }}
            >
              <div className="result-main-info">
                <span className="result-korean-name">{item.koreanName}</span>
                <span className="result-canonical-name">{item.canonicalName}</span>
              </div>
              <div className="result-meta-info">
                <span className={`system-badge is-${item.system}`}>
                  {item.systemKorean}
                </span>
                <span className="result-desc">{item.description}</span>
              </div>
            </button>
          ))}
        </div>
      </div>
    </div>
  );

  return typeof document !== "undefined" ? createPortal(content, document.body) : content;
}
