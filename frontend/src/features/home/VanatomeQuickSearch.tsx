import { useEffect, useMemo, useRef, useState } from "react";
import { ANATOMY_DICTIONARY, ANATOMY_SEARCH_OMIT_KEYS } from "./anatomyKoreanDictionary";
import { ANATOMY_COMPOUND_REGISTRY } from "./anatomyCompoundRegistry";
import {
  childLaterality,
  childOfficialMeshHint,
  compoundCoversKorean,
  parseSearchSide,
  queryWithoutSide,
  sideKoreanPrefix,
} from "./anatomySearchQuery";
import { ADULT_TEETH } from "./dentalPickerLogic";
import type { SearchResultItem } from "./AnatomySearchDrawer";

interface VanatomeQuickSearchProps {
  onSelectAnatomy: (anatomyId: string, item?: SearchResultItem) => void;
  onHoverAnatomy?: (anatomyId: string | null, item?: SearchResultItem | null) => void;
  onSelectTooth?: (toothFdi: number, koreanName: string) => void;
  inputRef?: React.RefObject<HTMLInputElement | null>;
  disabled?: boolean;
}
const SYSTEM_COLORS: Record<string, string> = {
  nervous: "#eab308", // 노란색 (신경계)
  skeletal: "#06b6d4", // 청록색 (골격계)
  muscular: "#f43f5e", // 적장미색 (근육계)
  cardiovascular: "#ef4444", // 빨간색 (심혈관)
  digestive: "#10b981", // 초록색 (소화기)
  respiratory: "#38bdf8", // 하늘색 (호흡기)
  urinary: "#f59e0b", // 주황색 (비뇨기)
  dental: "#a855f7", // 보라색 (치아)
  integumentary: "#0ea5e9", // 외피
  endocrine: "#ec4899", // 내분비
};

const COMMON_ALIASES: Record<string, string[]> = {
  "회전근개": ["rotator-cuff", "supraspinatus", "infraspinatus", "subscapularis", "teres minor"],
  "어깨": ["deltoid", "supraspinatus", "infraspinatus", "subscapularis", "teres minor", "scapula", "clavicle", "trapezius", "humerus"],
  "오십견": ["rotator-cuff", "supraspinatus", "infraspinatus", "subscapularis", "teres minor"],
  "허리": ["vertebra", "erector spinae", "quadratus lumborum", "sacrum", "latissimus dorsi"],
  "목": ["vertebra", "cervical", "sternocleidomastoid", "splenius capitis", "trapezius"],
  "경추": ["cervical", "atlas", "axis", "vertebra"],
  "무릎": ["patella", "rectus femoris", "vastus lateralis", "vastus medialis", "biceps femoris", "femur", "tibia"],
  "햄스트링": ["biceps femoris", "semitendinosus", "semimembranosus"],
  "종아리": ["gastrocnemius", "soleus", "tibialis anterior"],
  "갈비뼈": ["rib"],
  "늑골": ["rib"],
  "척골신경": ["ulnar", "ulnar_nerve", "ulnar nerve"],
  "상완신경총": ["brachial plexus", "roots of brachial plexus"],
  "신경": ["nerve", "nervous", "ulnar", "brachial", "spinal_cord"],
  "간": ["liver"],
  "폐": ["lungs", "lung"],
  "심장": ["heart"],
  "위": ["stomach"],
  "콩팥": ["kidneys", "kidney", "renal"],
  "신장": ["kidneys", "kidney", "renal"],
};

export function VanatomeQuickSearch({
  onSelectAnatomy,
  onHoverAnatomy,
  onSelectTooth,
  inputRef: externalInputRef,
  disabled = false,
}: VanatomeQuickSearchProps) {
  const [query, setQuery] = useState("");
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(-1);

  const localInputRef = useRef<HTMLInputElement>(null);
  const inputRef = externalInputRef || localInputRef;
  const containerRef = useRef<HTMLDivElement>(null);

  // 외부 클릭 시 드롭다운 닫기 & 호버 해제
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        onHoverAnatomy?.(null, null);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, [onHoverAnatomy]);

  const searchResults = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const side = parseSearchSide(q);
    const organQ = (queryWithoutSide(query).trim() || query.trim()).toLowerCase();
    const tokens = organQ.split(/\s+/).filter(Boolean);
    const cleanQ = organQ.replace(/\s+/g, "");

    const matchesSearch = (haystack: string) => {
      const lower = haystack.toLowerCase();
      if (cleanQ.length >= 2 && lower.replace(/\s+/g, "").includes(cleanQ)) return true;
      if (tokens.length > 1 && tokens.every((token) => lower.includes(token))) return true;
      if (tokens.length === 1 && lower.includes(tokens[0])) return true;
      return false;
    };

    // 중복 방지를 위한 Map 자료구조 (key: 중복 불가 고유 키)
    const resultsMap = new Map<string, SearchResultItem>();

    // 1. 치아 검색 (fdiNumber 기준 중복 방지)
    for (const tooth of ADULT_TEETH) {
      const toothHaystack = `${tooth.shortCode} ${tooth.koreanName} ${tooth.commonName} ${tooth.quadrant} 치아`;
      let matched = matchesSearch(toothHaystack);
      if (!matched) {
        if (cleanQ.includes("앞니") && (tooth.commonName.includes("Incisor") || tooth.koreanName.includes("절치"))) matched = true;
        if (cleanQ.includes("송곳니") && (tooth.commonName.includes("Canine") || tooth.koreanName.includes("견치"))) matched = true;
        if (cleanQ.includes("어금니") && (tooth.commonName.includes("Molar") || tooth.koreanName.includes("구치"))) matched = true;
      }
      if (matched) {
        const dedupeKey = `dental:${tooth.fdiNumber}`;
        if (!resultsMap.has(dedupeKey)) {
          resultsMap.set(dedupeKey, {
            id: `tooth_${tooth.fdiNumber}`,
            sourceKey: `dental:fdi:${tooth.fdiNumber}`,
            koreanName: tooth.koreanName,
            canonicalName: tooth.commonName,
            system: "dental",
            systemKorean: "치아/구강",
            description: `${tooth.shortCode} (${tooth.quadrant})`,
            category: "dental",
            approxPoint: tooth.approxPoint,
            has3DMesh: true,
          });
        }
      }
    }

    // 2. 공식 해부학 복합 장기 레지스트리 (Compound Organs: 심장, 신장, 폐, 위 등 최우선 인덱싱)
    for (const [orgId, organ] of Object.entries(ANATOMY_COMPOUND_REGISTRY)) {
      const aliasStr = organ.aliases.join(" ");
      const haystack = `${orgId} ${organ.koreanName} ${organ.canonicalName} ${organ.systemKorean} ${organ.description} ${aliasStr}`;
      let matched = matchesSearch(haystack);
      if (!matched) {
        for (const [aliasKey, targetKeys] of Object.entries(COMMON_ALIASES)) {
          if (cleanQ.includes(aliasKey) && targetKeys.some((tk) => orgId.toLowerCase().includes(tk) || organ.canonicalName.toLowerCase().includes(tk))) {
            matched = true;
            break;
          }
        }
      }
      if (matched) {
        if (side) {
          const sideChildren = organ.children.filter((childId) => childLaterality(childId) === side);
          if (sideChildren.length > 0) {
            for (const childId of sideChildren) {
          const meshHint = childOfficialMeshHint(childId, organ.id);
              const baseKorean = organ.koreanName.replace(/\s*\([^)]*\)\s*$/u, "").trim();
              resultsMap.set(`part:${childId}`, {
                id: childId,
                sourceKey: `vanatome:official:${childId}`,
                koreanName: `${sideKoreanPrefix(side)}${baseKorean}`,
                canonicalName: meshHint,
                system: organ.system,
                systemKorean: organ.systemKorean,
                description: organ.description,
                category: "anatomy",
                isCompound: false,
                childMeshIds: [childId],
                has3DMesh: true,
              });
            }
            continue;
          }
        }
        const dedupeKey = `compound:${organ.system}:${organ.id}`;
        if (!resultsMap.has(dedupeKey)) {
          resultsMap.set(dedupeKey, {
            id: organ.id,
            sourceKey: `vanatome:compound:${organ.id}`,
            koreanName: organ.koreanName,
            canonicalName: organ.canonicalName,
            system: organ.system,
            systemKorean: organ.systemKorean,
            description: organ.description,
            category: "anatomy",
            isCompound: organ.isCompound,
            childMeshIds: organ.children,
            has3DMesh: true,
          });
        }
      }
    }

    // 3. 해부학 세부 파츠 사전 (개별 메쉬 및 미세 조직 구조)
    for (const [key, entry] of Object.entries(ANATOMY_DICTIONARY)) {
      if (ANATOMY_SEARCH_OMIT_KEYS.has(key)) continue;
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
        if (Object.values(ANATOMY_COMPOUND_REGISTRY).some((organ) => compoundCoversKorean(organ, entry.korean))) {
          continue;
        }
        const dedupeKey = `${entry.system}:${entry.korean.toLowerCase()}`;
        if (!resultsMap.has(dedupeKey)) {
          const meshId = side ? `${key}.${side === "right" ? "r" : "l"}` : key;
          resultsMap.set(dedupeKey, {
            id: meshId,
            sourceKey: `vanatome:1.0:${meshId}`,
            koreanName: side ? `${sideKoreanPrefix(side)}${entry.korean}` : entry.korean,
            canonicalName: side ? `${entry.canonical}${side === "right" ? ".r" : ".l"}` : entry.canonical,
            system: entry.system,
            systemKorean: entry.systemKorean,
            description: entry.description,
            category: "anatomy",
            has3DMesh: true,
          });
        }
      }
      if (resultsMap.size >= 30) break;
    }

    return Array.from(resultsMap.values());
  }, [query]);

  const handleSelect = (item: SearchResultItem) => {
    onHoverAnatomy?.(null, null);
    if (item.category === "dental") {
      const fdi = Number(item.id.replace("tooth_", ""));
      if (Number.isFinite(fdi)) {
        onSelectTooth?.(fdi, item.koreanName);
      }
    } else {
      onSelectAnatomy(item.id, item);
    }
    setQuery(item.koreanName);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || searchResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      const nextIdx = activeIndex < searchResults.length - 1 ? activeIndex + 1 : 0;
      setActiveIndex(nextIdx);
      onHoverAnatomy?.(searchResults[nextIdx].id, searchResults[nextIdx]);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      const prevIdx = activeIndex > 0 ? activeIndex - 1 : searchResults.length - 1;
      setActiveIndex(prevIdx);
      onHoverAnatomy?.(searchResults[prevIdx].id, searchResults[prevIdx]);
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < searchResults.length) {
        handleSelect(searchResults[activeIndex]);
      } else if (searchResults.length > 0) {
        handleSelect(searchResults[0]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
      onHoverAnatomy?.(null, null);
    }
  };

  return (
    <div className="vanatome-quick-search" ref={containerRef} role="search">
      <div className="vanatome-quick-search-box">
        <span className="vanatome-quick-search-icon" aria-hidden="true">
          🔍
        </span>
        <input
          ref={inputRef as React.RefObject<HTMLInputElement>}
          type="text"
          className="vanatome-quick-search-input"
          placeholder="부위·신경·장기 검색..."
          value={query}
          disabled={disabled}
          onChange={(e) => {
            setQuery(e.target.value);
            setIsOpen(true);
            setActiveIndex(-1);
            if (!e.target.value.trim()) {
              onHoverAnatomy?.(null, null);
            }
          }}
          onFocus={() => {
            if (query.trim()) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          aria-label="3D 인체 모델 부위 즉각 검색"
          aria-expanded={isOpen}
          autoComplete="off"
          spellCheck="false"
        />
        {query ? (
          <button
            type="button"
            className="vanatome-quick-search-clear"
            onClick={() => {
              setQuery("");
              setIsOpen(false);
              onHoverAnatomy?.(null, null);
              inputRef.current?.focus();
            }}
            title="검색어 지우기"
            aria-label="검색어 지우기"
          >
            ✕
          </button>
        ) : null}
      </div>

      {isOpen && query.trim().length > 0 ? (
        <div className="vanatome-quick-search-dropdown" role="listbox">
          {searchResults.length === 0 ? (
            <div className="vanatome-quick-search-empty">
              일치하는 해부학 부위가 없습니다.
            </div>
          ) : (
            searchResults.map((item, idx) => {
              const dotColor = SYSTEM_COLORS[item.system] || "#94a3b8";
              const isActive = idx === activeIndex;
              return (
                <button
                  key={`${item.system}-${item.canonicalName}-${idx}`}
                  type="button"
                  className={`vanatome-quick-search-item ${isActive ? "is-active" : ""}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => {
                    setActiveIndex(idx);
                    onHoverAnatomy?.(item.id, item);
                  }}
                  onMouseLeave={() => {
                    onHoverAnatomy?.(null, null);
                  }}
                  role="option"
                  aria-selected={isActive}
                >
                  <div className="vanatome-quick-search-item-top">
                    <span className="vanatome-quick-search-item-name">
                      <span
                        className="vanatome-quick-search-item-dot"
                        style={{ backgroundColor: dotColor }}
                        aria-hidden="true"
                      />
                      {item.koreanName}
                      {item.isCompound ? <span className="vanatome-quick-search-item-badge">복합 장기</span> : null}
                    </span>
                    <span className="vanatome-quick-search-item-system">
                      {item.systemKorean}
                    </span>
                  </div>
                  <div className="vanatome-quick-search-item-canonical">
                    {item.canonicalName}
                    {item.fallbackTarget ? ` → 클릭 시 ${item.fallbackTarget.koreanName} 선택` : item.description ? ` · ${item.description}` : ""}
                  </div>
                </button>
              );
            })
          )}
        </div>
      ) : null}
    </div>
  );
}
