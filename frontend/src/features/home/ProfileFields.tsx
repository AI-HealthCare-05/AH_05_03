/**
 * 구성원 프로필 네 칸 — 이름·관계·성별·생년월일.
 *
 * 왜 뽑았나
 * ---------
 * 같은 네 칸이 세 곳에 필요하다. 첫 실행 화면(모달 없이 바로 펴는 폼), 구성원을
 * 나중에 더하는 모달, 프로필 수정 모달. 복사해 두면 한쪽만 고쳐지고 나머지는
 * 남는다 — 이 저장소에서 실제로 그렇게 갈라진 자국이 여럿이다.
 *
 * 버튼은 여기서 정하지 않는다
 * ---------------------------
 * 모달에는 취소가 있고 첫 실행에는 없다. 수정 모달은 "변경사항 저장" 이고 생성은
 * "프로필 저장" 이다. 그래서 제출 줄은 부르는 쪽이 붙인다 — `AuthCard` 가 `footer`
 * 를 호출부에서 받는 것과 같은 이유다.
 */

import { BirthDateInput } from "../../shared/ui/BirthDateInput";
import type { FamilyProfile } from "../../shared/local/domainContracts";

/** 관계 보기. **한 곳에서만 정한다** — 화면마다 다른 목록을 들면 같은 가족이
 *  화면에 따라 다르게 분류된다. */
export const RELATIONSHIPS = ["본인", "배우자", "자녀", "부모", "형제·자매", "기타"];

export function ProfileFields({
  profile,
  autoFocus = false,
}: {
  /** 수정일 때 채워 넣을 값. 없으면 빈 폼이다. */
  profile?: Pick<FamilyProfile, "displayName" | "relationship" | "gender" | "birthDate">;
  autoFocus?: boolean;
}) {
  return (
    <>
      <label>
        이름 또는 호칭
        <input
          name="displayName"
          maxLength={100}
          required
          defaultValue={profile?.displayName}
          placeholder="예: 나, 엄마, 민준"
          autoFocus={autoFocus}
        />
      </label>
      <label>
        관계
        <select name="relationship" required defaultValue={profile?.relationship ?? ""}>
          <option value="" disabled>관계를 선택하세요</option>
          {RELATIONSHIPS.map((relationship) => <option key={relationship}>{relationship}</option>)}
        </select>
      </label>
      <label>
        성별
        <select name="gender" defaultValue={profile?.gender ?? ""}>
          <option value="" disabled>남성 또는 여성</option>
          <option value="male">남성</option>
          <option value="female">여성</option>
        </select>
      </label>
      <BirthDateInput defaultValue={profile?.birthDate ?? ""} />
    </>
  );
}
