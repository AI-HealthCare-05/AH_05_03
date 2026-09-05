import type { FamilyProfile } from "../../shared/local/domainContracts";

interface FamilyProfileSidebarProps {
  profiles: FamilyProfile[];
  selectedProfileId: string;
  onSelect(profileId: string): void;
  onAdd?(): void;
  addDisabled?: boolean;
  hiddenCount?: number;
  onManageHidden?(): void;
  description?: string;
}

export function FamilyProfileSidebar({
  profiles,
  selectedProfileId,
  onSelect,
  onAdd,
  addDisabled = false,
  hiddenCount = 0,
  onManageHidden,
  description = "구성원을 선택하면 해당 프로필의 건강정보로 전환됩니다.",
}: FamilyProfileSidebarProps) {
  return (
    <aside className="family-switcher-panel" aria-label="가족 구성원">
      <div className="family-switcher-header">
        <div>
          <p className="section-kicker">가족 구성원</p>
          <h2>기록 대상</h2>
        </div>
        <span className="section-count">{profiles.length}명</span>
      </div>

      <p className="family-switcher-description">{description}</p>

      <div className="family-switcher-list" role="list">
        {profiles.map((profile, index) => {
          const isSelected = profile.id === selectedProfileId;
          return (
            <button
              className={isSelected ? "family-switcher-card is-selected" : "family-switcher-card"}
              key={profile.id}
              type="button"
              role="listitem"
              aria-pressed={isSelected}
              onClick={() => onSelect(profile.id)}
            >
              <span className={`member-avatar avatar-tone-${index % 4}`} aria-hidden="true">
                {profile.displayName.slice(0, 1)}
              </span>
              <span className="family-switcher-copy">
                <strong>{profile.displayName}</strong>
                <small>{formatProfileSubLabel(profile)}</small>
              </span>
              {isSelected ? <span className="family-switcher-current">현재</span> : null}
            </button>
          );
        })}

        {onAdd ? (
          <button
            className="family-switcher-card family-switcher-add"
            type="button"
            disabled={addDisabled}
            onClick={onAdd}
          >
            <span className="add-member-mark" aria-hidden="true">+</span>
            <span className="family-switcher-copy">
              <strong>구성원 추가</strong>
              <small>새 프로필 만들기</small>
            </span>
          </button>
        ) : null}
      </div>

      {hiddenCount > 0 && onManageHidden ? (
        <button className="family-switcher-hidden" type="button" onClick={onManageHidden}>
          숨긴 프로필 {hiddenCount}명 관리
        </button>
      ) : null}
    </aside>
  );
}

function formatProfileSubLabel(profile: FamilyProfile): string {
  const genderLabel = profile.gender === "male" ? "남성" : profile.gender === "female" ? "여성" : "";
  const birthYear = profile.birthDate ? `${profile.birthDate.slice(0, 4)}년생` : "";
  return [profile.relationship, genderLabel, birthYear].filter(Boolean).join(" · ");
}
