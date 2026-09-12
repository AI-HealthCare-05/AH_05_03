import { useEffect, useMemo, useRef, useState } from "react";
import { ANATOMY_DICTIONARY } from "./anatomyKoreanDictionary";
import { ADULT_TEETH } from "./dentalPickerLogic";
import type { SearchResultItem } from "./AnatomySearchDrawer";

interface VanatomeQuickSearchProps {
  onSelectAnatomy: (anatomyId: string) => void;
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
  "회전근개": ["supraspinatus", "infraspinatus", "subscapularis", "teres minor"],
  "어깨": ["deltoid", "supraspinatus", "infraspinatus", "subscapularis", "teres minor", "scapula", "clavicle", "trapezius", "humerus"],
  "오십견": ["supraspinatus", "infraspinatus", "subscapularis", "teres minor"],
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
  "폐": ["lung"],
  "심장": ["heart"],
  "위": ["stomach"],
};

export function VanatomeQuickSearch({
  onSelectAnatomy,
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

  // 외부 클릭 시 드롭다운 닫기
  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsideClick);
    return () => document.removeEventListener("mousedown", handleOutsideClick);
  }, []);

  const searchResults = useMemo<SearchResultItem[]>(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];

    const tokens = q.split(/\s+/).filter(Boolean);
    const cleanQ = q.replace(/\s+/g, "");

    const matchesSearch = (haystack: string) => {
      const lower = haystack.toLowerCase();
      if (cleanQ.length >= 2 && lower.replace(/\s+/g, "").includes(cleanQ)) return true;
      if (tokens.length > 1 && tokens.every((token) => lower.includes(token))) return true;
      if (tokens.length === 1 && lower.includes(tokens[0])) return true;
      return false;
    };

    const results: SearchResultItem[] = [];

    // 1. 치아 검색
    for (const tooth of ADULT_TEETH) {
      const toothHaystack = `${tooth.shortCode} ${tooth.koreanName} ${tooth.commonName} ${tooth.quadrant} 치아`;
      let matched = matchesSearch(toothHaystack);
      if (!matched) {
        if (cleanQ.includes("앞니") && (tooth.commonName.includes("Incisor") || tooth.koreanName.includes("절치"))) matched = true;
        if (cleanQ.includes("송곳니") && (tooth.commonName.includes("Canine") || tooth.koreanName.includes("견치"))) matched = true;
        if (cleanQ.includes("어금니") && (tooth.commonName.includes("Molar") || tooth.koreanName.includes("구치"))) matched = true;
      }
      if (matched) {
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

    // 2. 해부학 용어 사전
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
      if (results.length >= 30) break;
    }

    return results;
  }, [query]);

  const handleSelect = (item: SearchResultItem) => {
    if (item.category === "dental") {
      const fdi = Number(item.id.replace("tooth_", ""));
      if (Number.isFinite(fdi)) {
        onSelectTooth?.(fdi, item.koreanName);
      }
    } else {
      onSelectAnatomy(item.id);
    }
    setQuery(item.koreanName);
    setIsOpen(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!isOpen || searchResults.length === 0) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((prev) => (prev < searchResults.length - 1 ? prev + 1 : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((prev) => (prev > 0 ? prev - 1 : searchResults.length - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (activeIndex >= 0 && activeIndex < searchResults.length) {
        handleSelect(searchResults[activeIndex]);
      } else if (searchResults.length > 0) {
        handleSelect(searchResults[0]);
      }
    } else if (e.key === "Escape") {
      setIsOpen(false);
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
                  key={`${item.id}-${idx}`}
                  type="button"
                  className={`vanatome-quick-search-item ${isActive ? "is-active" : ""}`}
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setActiveIndex(idx)}
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
                    </span>
                    <span className="vanatome-quick-search-item-system">
                      {item.systemKorean}
                    </span>
                  </div>
                  <div className="vanatome-quick-search-item-canonical">
                    {item.canonicalName}
                    {item.description ? ` · ${item.description}` : ""}
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
