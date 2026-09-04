import { type FormEvent, type MouseEvent, useCallback, useEffect, useState } from "react";

import { useAuth } from "../../app/authContext";
import { useLocalDomain } from "../../app/localDomainContext";
import type {
  AccountSummary,
  FamilyInvitationData,
  FamilyInvitationListData,
  HouseholdData,
  HouseholdMembershipListItemData,
  ProfileLinkData,
  SubscriptionBrief,
  SubscriptionData,
} from "../../shared/api/contracts";
import { serverApiClient } from "../../shared/api/serverApiClient";

type Confirmation =
  | { kind: "leave-household"; household: HouseholdData }
  | { kind: "close-household"; household: HouseholdData }
  | { kind: "cancel-invitation"; invitation: FamilyInvitationData }
  | { kind: "unlink-profile"; link: ProfileLinkData }
  | { kind: "close-account" };

interface LinkRecovery {
  invitationId: string;
  profileRef: string;
}

export function AccountPage() {
  const { markSignedOut } = useAuth();
  const { runtime, profiles, refreshProfiles } = useLocalDomain();
  const [account, setAccount] = useState<AccountSummary>();
  const [subscription, setSubscription] = useState<SubscriptionData>();
  const [households, setHouseholds] = useState<HouseholdData[]>([]);
  const [selectedHouseholdId, setSelectedHouseholdId] = useState<string>();
  const [memberships, setMemberships] = useState<HouseholdMembershipListItemData[]>([]);
  const [invitations, setInvitations] = useState<FamilyInvitationListData>({ sent: [], received: [] });
  const [links, setLinks] = useState<ProfileLinkData[]>([]);
  const [confirmation, setConfirmation] = useState<Confirmation>();
  const [linkRecovery, setLinkRecovery] = useState<LinkRecovery>();
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();
  const invitationFragment = readInvitationFragment();
  const sentInvitation = invitationFragment
    ? invitations.sent.find((item) => item.id === invitationFragment.invitationId)
    : undefined;
  const invitationEmail = invitationFragment?.email ?? sentInvitation?.invitee_email;
  const hasInvitationAccountMismatch = Boolean(
    account && invitationEmail && account.account.email.toLowerCase() !== invitationEmail.toLowerCase(),
  );

  const loadAccountData = useCallback(async () => {
    const [accountValue, subscriptionValue, householdValues, invitationValues, linkValues] = await Promise.all([
      serverApiClient.getAccount(),
      serverApiClient.getSubscription(),
      serverApiClient.listHouseholds(),
      serverApiClient.listInvitations(),
      serverApiClient.listProfileLinks(),
    ]);
    setAccount(accountValue);
    setSubscription(subscriptionValue);
    setHouseholds(householdValues);
    setInvitations(invitationValues);
    setLinks(linkValues);
  }, []);

  useEffect(() => {
    void serverApiClient.refresh().then(loadAccountData).catch(() => undefined);
  }, [loadAccountData]);

  async function changePlan(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const plan = String(new FormData(event.currentTarget).get("plan")) as SubscriptionBrief["plan"];
    await run(async () => {
      const changed = await serverApiClient.changeSubscription(plan);
      setSubscription(changed);
      await loadAccountData();
      setMessage(`${changed.previous_plan}에서 ${changed.plan}(으)로 플랜을 변경했습니다.`);
    });
  }

  async function createHousehold() {
    await run(async () => {
      const household = await serverApiClient.createHousehold();
      await loadAccountData();
      await selectHousehold(household.id);
      setMessage("가정을 만들었습니다.");
    });
  }

  async function selectHousehold(householdId: string) {
    setSelectedHouseholdId(householdId);
    try {
      setMemberships(await serverApiClient.listHouseholdMemberships(householdId));
    } catch (caught) {
      setMemberships([]);
      setError(messageFrom(caught, "가정 구성원을 불러오지 못했습니다."));
    }
  }

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtime) return;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const householdId = String(form.get("householdId"));
    const profileId = String(form.get("profileId"));
    const inviteeEmail = String(form.get("inviteeEmail"));
    const profile = profiles.find((item) => item.id === profileId);
    if (!profile) return;
    await run(async () => {
      const reference = createOpaqueReference();
      const localResult = await runtime.profiles.setServerReference(profile.id, reference, "pending");
      if (!localResult.ok) throw new Error(localResult.error.message);
      try {
        await serverApiClient.createInvitation({ householdId, inviteeEmail, targetProfileRef: reference });
      } catch (caught) {
        await runtime.profiles.setServerReference(profile.id, null, "retired");
        throw caught;
      }
      await refreshProfiles();
      await loadAccountData();
      formElement.reset();
      setMessage("초대를 생성했습니다. 건강정보는 서버로 전송하지 않았습니다.");
    });
  }

  async function acceptAndLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const invitationId = String(form.get("invitationId"));
    const token = String(form.get("token"));
    const invitation = invitations.received.find((item) => item.id === invitationId);
    if (!invitation) return;
    await run(async () => {
      await serverApiClient.acceptInvitation(invitationId, token);
      try {
        await linkAcceptedInvitation(invitationId, invitation.target_profile_ref);
      } catch (caught) {
        setLinkRecovery({ invitationId, profileRef: invitation.target_profile_ref });
        throw new Error(
          `초대는 수락됐지만 프로필 연결이 끝나지 않았습니다. 아래 재시도를 이용하세요. ${messageFrom(caught, "")}`,
          { cause: caught },
        );
      }
      setLinkRecovery(undefined);
      clearInvitationFragment();
      setMessage("초대를 수락하고 서비스 계정을 연결했습니다. 건강정보를 받으려면 기기 연결이 필요합니다.");
    });
  }

  async function declineInvitation(event: MouseEvent<HTMLButtonElement>) {
    const formElement = event.currentTarget.form;
    if (!formElement) return;
    const form = new FormData(formElement);
    const invitationId = String(form.get("invitationId"));
    const token = String(form.get("token"));
    if (!token) {
      setError("초대를 거절하려면 이메일 초대 토큰을 입력하세요.");
      return;
    }
    await run(async () => {
      await serverApiClient.declineInvitation(invitationId, token);
      await loadAccountData();
      clearInvitationFragment();
      setMessage("초대를 거절했습니다.");
    });
  }

  async function retryProfileLink() {
    if (!linkRecovery) return;
    await run(async () => {
      await linkAcceptedInvitation(linkRecovery.invitationId, linkRecovery.profileRef);
      setLinkRecovery(undefined);
      setMessage("중단됐던 서비스 계정 연결을 완료했습니다. 현재 기기는 건강정보 연결 대기 상태입니다.");
    });
  }

  async function linkAcceptedInvitation(invitationId: string, profileRef: string) {
    const serverLinks = await serverApiClient.listProfileLinks();
    const existingLink = serverLinks.find(
      (item) => item.status === "active" && (item.invitation_id === invitationId || item.local_profile_ref === profileRef),
    );
    if (!existingLink) await serverApiClient.createProfileLink(invitationId, profileRef);
    await loadAccountData();
  }

  async function confirmAction(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!confirmation) return;
    if (confirmation.kind === "close-account") {
      const email = String(new FormData(event?.currentTarget).get("email-confirmation") ?? "");
      if (email !== account?.account.email) {
        setError("확인을 위해 현재 계정 이메일을 정확히 입력하세요.");
        return;
      }
    }
    await run(async () => {
      if (confirmation.kind === "leave-household") {
        await serverApiClient.leaveHousehold(confirmation.household.id);
        setMessage("가정에서 나왔습니다. 이 브라우저의 로컬 건강정보는 유지됩니다.");
      } else if (confirmation.kind === "close-household") {
        await serverApiClient.closeHousehold(confirmation.household.id);
        setMessage("가정을 종료했습니다. 구성원의 로컬 건강정보는 삭제되지 않습니다.");
      } else if (confirmation.kind === "cancel-invitation") {
        await serverApiClient.cancelInvitation(confirmation.invitation.id);
        if (runtime) {
          const profile = profiles.find((item) => item.opaqueServerRef === confirmation.invitation.target_profile_ref);
          if (profile) await runtime.profiles.setServerReference(profile.id, null, "retired");
          await refreshProfiles();
        }
        setMessage("보낸 초대를 취소했습니다.");
      } else if (confirmation.kind === "unlink-profile") {
        await serverApiClient.unlinkProfileLink(confirmation.link.id);
        setMessage("서비스 계정 연결을 해제했습니다. 이 브라우저의 로컬 프로필과 건강정보는 변경하지 않았습니다.");
      } else {
        await serverApiClient.closeAccount();
        serverApiClient.clearAccessToken();
        clearAccountState();
        // 로그아웃과 같은 이유로 관문에도 알린다 — 종료한 계정으로 화면이 남으면
        // 누르는 것마다 401 이 된다.
        markSignedOut();
        setMessage("서비스 계정을 종료했습니다. 이 브라우저의 로컬 건강정보는 삭제되지 않았습니다.");
      }
      setConfirmation(undefined);
      if (confirmation.kind !== "close-account") {
        setSelectedHouseholdId(undefined);
        setMemberships([]);
        await loadAccountData();
      }
    });
  }

  async function logout() {
    await run(async () => {
      await serverApiClient.logout();
      clearAccountState();
      // 관문에도 알린다. 안 알리면 레이아웃은 아직 로그인 상태라고 믿어서,
      // 로그아웃한 사용자에게 메뉴와 화면이 그대로 남는다.
      markSignedOut();
      setMessage("로그아웃했습니다. 로컬 건강정보는 이 브라우저에 유지됩니다.");
    });
  }

  async function switchInvitationAccount() {
    if (invitationEmail) preserveInvitationEmail(invitationEmail);
    await logout();
  }

  function clearAccountState() {
    setAccount(undefined);
    setSubscription(undefined);
    setHouseholds([]);
    setSelectedHouseholdId(undefined);
    setMemberships([]);
    setInvitations({ sent: [], received: [] });
    setLinks([]);
  }

  async function run(action: () => Promise<void>) {
    setWorking(true);
    resetFeedback();
    try {
      await action();
    } catch (caught) {
      setError(messageFrom(caught, "서버 요청을 처리하지 못했습니다."));
    } finally {
      setWorking(false);
    }
  }

  function resetFeedback() {
    setMessage(undefined);
    setError(undefined);
  }

  return (
    <div className="product-page account-page">
      <section className="dashboard-heading">
        <div><p className="page-kicker">서비스 계정</p><h1>구독과 가족 연결을 관리하세요</h1><p>건강정보가 아닌 계정·초대·불투명 연결 상태만 서버에서 처리합니다.</p></div>
        {account ? <button className="secondary-button" type="button" onClick={() => void logout()}>로그아웃</button> : null}
      </section>
      {message ? <div className="alert success-alert" role="status">{message}</div> : null}
      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

      {/* 로그인은 관문(`SignInPage`)이 한다. 여기까지 왔다는 건 이미 로그인했다는 뜻이라
          계정을 아직 못 읽은 순간만 비워 둔다. */}
      {!account ? <p className="account-empty">계정 정보를 불러오는 중…</p> : hasInvitationAccountMismatch && invitationEmail ? (
        <InvitationAccountMismatch
          currentEmail={account.account.email}
          invitationEmail={invitationEmail}
          working={working}
          onSwitch={switchInvitationAccount}
        />
      ) : (
        <div className="account-grid">
          <section className="account-card"><p className="section-kicker">내 계정</p><h2>{account.account.email}</h2><dl><div><dt>계정 상태</dt><dd>{account.account.status}</dd></div><div><dt>가입일</dt><dd>{formatDate(account.account.created_at)}</dd></div></dl></section>
          <SubscriptionCard account={account} subscription={subscription} working={working} onSubmit={changePlan} />
          <HouseholdCard households={households} selectedHouseholdId={selectedHouseholdId} memberships={memberships} profiles={profiles} currentAccountId={account.account.id} working={working} onCreate={createHousehold} onSelect={selectHousehold} onConfirm={setConfirmation} />
          <InvitationCard households={households} profiles={profiles} invitations={invitations} working={working} onSend={sendInvitation} onAccept={acceptAndLink} onDecline={declineInvitation} onCancel={(invitation) => setConfirmation({ kind: "cancel-invitation", invitation })} linkRecovery={linkRecovery} onRetry={retryProfileLink} />
          <section className="account-card account-wide"><p className="section-kicker">서비스 계정 연결</p><h2>연결된 프로필 참조</h2>{links.filter((item) => item.status === "active").length === 0 ? <p className="account-empty">활성 연결이 없습니다.</p> : links.filter((item) => item.status === "active").map((link) => <div className="profile-link-row" key={link.id}><code>{link.local_profile_ref.slice(0, 12)}…</code><span>계정 연결 완료 · 기기 연결 대기</span><button className="secondary-button" type="button" disabled={working} onClick={() => setConfirmation({ kind: "unlink-profile", link })}>연결 해제</button></div>)}</section>
          <section className="account-card account-wide danger-zone"><p className="section-kicker">계정 종료</p><h2>서비스 계정 닫기</h2><p>인증·구독·서버 연결 상태를 종료합니다. 이 브라우저에 저장된 로컬 건강정보는 삭제하지 않습니다.</p><button className="danger-button" type="button" onClick={() => setConfirmation({ kind: "close-account" })}>계정 종료</button></section>
        </div>
      )}
      {confirmation ? <ConfirmationDialog confirmation={confirmation} email={account?.account.email} working={working} onCancel={() => setConfirmation(undefined)} onConfirm={confirmAction} /> : null}
    </div>
  );
}

function InvitationAccountMismatch({ currentEmail, invitationEmail, working, onSwitch }: { currentEmail: string; invitationEmail: string; working: boolean; onSwitch: () => Promise<void> }) {
  return <section className="account-card auth-card invitation-account-gate" role="alert"><p className="section-kicker">계정 전환 필요</p><h2>이 초대는 다른 계정으로 도착했습니다</h2><dl><div><dt>현재 로그인</dt><dd>{currentEmail}</dd></div><div><dt>초대받은 이메일</dt><dd>{invitationEmail}</dd></div></dl><p>현재 계정에서는 이 초대를 수락할 수 없습니다. 로그아웃한 뒤 초대받은 이메일로 가입하거나 로그인하세요. 초대 링크는 그대로 유지됩니다.</p><button className="primary-button" type="button" disabled={working} onClick={() => void onSwitch()}>초대받은 계정으로 전환</button></section>;
}

function SubscriptionCard({ account, subscription, working, onSubmit }: { account: AccountSummary; subscription?: SubscriptionData; working: boolean; onSubmit: (event: FormEvent<HTMLFormElement>) => Promise<void> }) {
  return <section className="account-card"><p className="section-kicker">구독</p><h2>{subscription?.plan ?? account.subscription.plan}</h2><form className="subscription-form" onSubmit={(event) => void onSubmit(event)}><label><span>플랜 변경</span><select name="plan" defaultValue={subscription?.plan ?? account.subscription.plan}><option value="FREE">FREE</option><option value="BASIC">BASIC</option><option value="FAMILY">FAMILY</option></select></label><button className="secondary-button" disabled={working}>적용</button></form><small>{subscription?.license_valid ? "라이선스 사용 가능" : "라이선스 확인 필요"}</small></section>;
}

function HouseholdCard({ households, selectedHouseholdId, memberships, profiles, currentAccountId, working, onCreate, onSelect, onConfirm }: { households: HouseholdData[]; selectedHouseholdId?: string; memberships: HouseholdMembershipListItemData[]; profiles: ReturnType<typeof useLocalDomain>["profiles"]; currentAccountId: string; working: boolean; onCreate: () => Promise<void>; onSelect: (id: string) => Promise<void>; onConfirm: (confirmation: Confirmation) => void }) {
  return <section className="account-card account-wide"><div className="section-title-row"><div><p className="section-kicker">가정</p><h2>가입한 가정 {households.length}개</h2></div><button className="secondary-button" type="button" disabled={working} onClick={() => void onCreate()}>가정 만들기</button></div>{households.length === 0 ? <p className="account-empty">아직 가입한 가정이 없습니다.</p> : <div className="household-list">{households.map((household) => <article key={household.id} className={selectedHouseholdId === household.id ? "is-selected" : ""}><div><strong>가정 {household.id.slice(0, 8)}</strong><small>{household.status} · {formatDate(household.created_at)}</small></div><div className="row-actions"><button className="secondary-button" type="button" onClick={() => void onSelect(household.id)}>멤버 보기</button><button className="text-danger-button" type="button" onClick={() => onConfirm({ kind: "leave-household", household })}>나가기</button><button className="text-danger-button" type="button" onClick={() => onConfirm({ kind: "close-household", household })}>가정 종료</button></div></article>)}</div>}{selectedHouseholdId ? <div className="membership-panel"><h3>가정 구성원</h3>{memberships.map((membership) => {
    const isCurrent = membership.account_id === currentAccountId;
    const localProfile = profiles.find((profile) => profile.opaqueServerRef === membership.local_profile_ref);
    const displayName = localProfile?.displayName ?? (isCurrent ? "내 계정" : membership.masked_email);
    const connectionLabel = localProfile
      ? "로컬 프로필 연결됨"
      : membership.local_profile_ref
        ? "프로필 연결됨 · 이 브라우저에서 이름 확인 불가"
        : "로컬 프로필 미연결";
    return <div key={membership.id}><div className="membership-identity"><strong>{displayName}{isCurrent ? <span className="current-member-badge">나</span> : null}</strong><small>{membership.masked_email}</small></div><div className="membership-state"><span>{membership.status === "active" ? "활동 중" : "나감"}</span><small>{connectionLabel}</small></div><time>{formatDate(membership.joined_at)}</time></div>;
  })}</div> : null}</section>;
}

function InvitationCard({ households, profiles, invitations, working, onSend, onAccept, onDecline, onCancel, linkRecovery, onRetry }: { households: HouseholdData[]; profiles: ReturnType<typeof useLocalDomain>["profiles"]; invitations: FamilyInvitationListData; working: boolean; onSend: (event: FormEvent<HTMLFormElement>) => Promise<void>; onAccept: (event: FormEvent<HTMLFormElement>) => Promise<void>; onDecline: (event: MouseEvent<HTMLButtonElement>) => Promise<void>; onCancel: (invitation: FamilyInvitationData) => void; linkRecovery?: LinkRecovery; onRetry: () => Promise<void> }) {
  const received = invitations.received.filter((item) => item.status === "pending");
  const fragment = readInvitationFragment();
  return <><section className="account-card account-wide"><p className="section-kicker">가족 초대</p><h2>기존 로컬 프로필에 서비스 계정 초대</h2><p className="account-help">발신자가 여기서 선택한 프로필이 연결 대상입니다. 초대에는 건강정보 대신 무작위 불투명 참조값만 저장됩니다.</p><form className="account-inline-form" onSubmit={(event) => void onSend(event)}><select name="householdId" required defaultValue=""><option value="" disabled>가정 선택</option>{households.map((item) => <option key={item.id} value={item.id}>{item.id.slice(0, 8)}</option>)}</select><select name="profileId" required defaultValue=""><option value="" disabled>연결 대상 프로필 선택</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select><input name="inviteeEmail" type="email" required placeholder="초대할 이메일" /><button className="primary-button" disabled={working || households.length === 0 || profiles.length === 0}>초대</button></form><InvitationList items={invitations.sent} onCancel={onCancel} /></section><section className="account-card account-wide"><p className="section-kicker">받은 초대</p><h2>발신자가 지정한 프로필과 계정 연결</h2><p className="account-help">연결 대상은 초대에 이미 지정돼 있습니다. 수락 후 건강정보는 자동으로 내려받지 않으며 별도의 기기 연결이 필요합니다.</p>{received.length === 0 ? <p className="account-empty">처리할 초대가 없습니다.</p> : received.map((invitation) => <form className="received-invitation" key={invitation.id} onSubmit={(event) => void onAccept(event)}><input type="hidden" name="invitationId" value={invitation.id} /><span>{invitation.inviter_account_id.slice(0, 8)}…의 초대</span><input name="token" required placeholder="이메일 초대 토큰" defaultValue={fragment?.invitationId === invitation.id ? fragment.token : ""} /><div className="row-actions"><button className="secondary-button" type="button" disabled={working} onClick={(event) => void onDecline(event)}>거절</button><button className="primary-button" disabled={working}>초대 수락</button></div></form>)}{linkRecovery ? <div className="inline-confirmation"><strong>계정 연결 복구가 필요합니다.</strong><p>초대 수락은 완료됐지만 서버의 계정 연결이 중단됐습니다. 로컬 프로필은 변경하지 않았습니다.</p><button className="primary-button" type="button" disabled={working} onClick={() => void onRetry()}>계정 연결 재시도</button></div> : null}</section></>;
}

function InvitationList({ items, onCancel }: { items: FamilyInvitationListData["sent"]; onCancel: (invitation: FamilyInvitationData) => void }) {
  return <div className="invitation-list"><strong>보낸 초대</strong>{items.length === 0 ? <p className="account-empty">보낸 초대가 없습니다.</p> : items.map((item) => <p key={item.id}><span>{item.invitee_email}<small>{item.status} · {formatDate(item.expires_at)} 만료</small></span>{item.status === "pending" ? <button className="text-danger-button" type="button" onClick={() => onCancel(item)}>취소</button> : <span>{item.status}</span>}</p>)}</div>;
}

function ConfirmationDialog({ confirmation, email, working, onCancel, onConfirm }: { confirmation: Confirmation; email?: string; working: boolean; onCancel: () => void; onConfirm: (event?: FormEvent<HTMLFormElement>) => Promise<void> }) {
  const content = confirmationCopy(confirmation);
  return <div className="modal-backdrop"><section className="modal-panel" role="alertdialog" aria-modal="true" aria-labelledby="account-confirm-title"><div className="modal-heading"><div><p className="section-kicker">확인 필요</p><h2 id="account-confirm-title">{content.title}</h2></div><button className="modal-close" type="button" aria-label="닫기" onClick={onCancel}>×</button></div><p className="confirmation-copy">{content.description}</p><form className="product-form" onSubmit={(event) => void onConfirm(event)}>{confirmation.kind === "close-account" ? <label>계정 이메일 입력<input name="email-confirmation" type="email" placeholder={email} autoComplete="off" required /></label> : null}<div className="form-actions"><button className="secondary-button" type="button" onClick={onCancel}>돌아가기</button><button className="danger-button" disabled={working}>{content.action}</button></div></form></section></div>;
}

function confirmationCopy(confirmation: Confirmation) {
  if (confirmation.kind === "leave-household") return { title: "가정에서 나갈까요?", description: "서버 멤버십과 연결 상태가 변경됩니다. 이 브라우저의 로컬 건강정보는 유지됩니다.", action: "가정 나가기" };
  if (confirmation.kind === "close-household") return { title: "가정을 종료할까요?", description: "다른 활성 멤버가 있으면 서버가 종료를 거절합니다. 로컬 건강정보는 삭제되지 않습니다.", action: "가정 종료" };
  if (confirmation.kind === "cancel-invitation") return { title: "초대를 취소할까요?", description: "초대 참조값을 더 이상 사용할 수 없게 하고 로컬 프로필의 대기 연결도 폐기합니다.", action: "초대 취소" };
  if (confirmation.kind === "unlink-profile") return { title: "프로필 연결을 해제할까요?", description: "서비스 계정과의 연결만 해제합니다. 로컬 프로필과 건강정보는 보존됩니다.", action: "연결 해제" };
  return { title: "서비스 계정을 종료할까요?", description: "구독과 서버 연결을 종료합니다. 확인을 위해 현재 계정 이메일을 입력하세요. 로컬 건강정보는 삭제되지 않습니다.", action: "계정 종료" };
}

function createOpaqueReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("ko-KR", { dateStyle: "medium" }).format(new Date(value));
}

function readInvitationFragment(): { invitationId: string; token: string; email?: string } | undefined {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  const invitationId = params.get("invitation");
  const token = params.get("token");
  const email = params.get("email") ?? undefined;
  return invitationId && token ? { invitationId, token, email } : undefined;
}

function clearInvitationFragment() {
  window.history.replaceState(null, "", `${window.location.pathname}${window.location.search}`);
}

function preserveInvitationEmail(email: string) {
  const params = new URLSearchParams(window.location.hash.replace(/^#/u, ""));
  params.set("email", email);
  window.history.replaceState(
    null,
    "",
    `${window.location.pathname}${window.location.search}#${params.toString()}`,
  );
}

function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
