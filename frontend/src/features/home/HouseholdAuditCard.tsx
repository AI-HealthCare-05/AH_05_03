import { useEffect, useState } from "react";

import type { AccountAuditEventData, HouseholdData } from "../../shared/api/contracts";
import { serverApiClient } from "../../shared/api/serverApiClient";

const LABELS: Record<string, string> = {
  "auth.login_succeeded": "로그인 성공",
  "auth.login_failed": "로그인 실패",
  "auth.password_reset_completed": "비밀번호 재설정",
  "member_pin.issued": "구성원 PIN 발급",
  "member_pin.failed": "구성원 PIN 실패",
  "member_pin.lock": "구성원 PIN 잠금",
  "member_pin.lock_acknowledged": "PIN 잠금 확인",
  "household_device.pairing_created": "벽 페어링 발급",
  "household_device.claimed": "벽 기기 등록",
  "household_device.revoked": "벽 기기 철회",
  "household_device.emergency_revoked": "벽 비상 철회",
  "profile.claimed": "프로필 연결",
  "profile.unshared": "가족 공유 해제",
  "profile.deletion_requested": "삭제 요청",
  "profile.role_changed": "역할 변경",
};

export function HouseholdAuditCard({
  households,
  currentAccountId,
}: {
  households: HouseholdData[];
  currentAccountId: string;
}) {
  const masterHousehold = households.find((item) => item.status === "active" && item.master_account_id === currentAccountId);
  const householdId = masterHousehold?.id;
  const [events, setEvents] = useState<AccountAuditEventData[]>([]);

  useEffect(() => {
    if (!householdId) return;
    void serverApiClient
      .listAuditEvents(householdId)
      .then(setEvents)
      .catch(() => setEvents([]));
  }, [householdId]);

  if (!householdId) return null;

  return (
    <section className="account-card account-wide">
      <p className="section-kicker">보안 감사</p>
      <h2>권한 변경 기록</h2>
      <p className="account-help">PIN·비밀번호·건강수치 원문은 남기지 않습니다. 법적 본인 확인 증거가 아닙니다.</p>
      {events.length === 0 ? (
        <p className="account-empty">아직 감사 이벤트가 없습니다.</p>
      ) : (
        <ul>
          {events.slice(0, 20).map((event) => (
            <li key={event.id}>
              {LABELS[event.event_type] ?? event.event_type} · {new Date(event.occurred_at).toLocaleString("ko-KR")}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
