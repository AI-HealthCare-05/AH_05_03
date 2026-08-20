import { type FormEvent, useCallback, useEffect, useState } from "react";

import { useLocalDomain } from "../../app/localDomainContext";
import type {
  AccountSummary,
  FamilyInvitationListData,
  HouseholdData,
  ProfileLinkData,
} from "../../shared/api/contracts";
import { serverApiClient } from "../../shared/api/serverApiClient";

export function AccountPage() {
  const { runtime, profiles, refreshProfiles } = useLocalDomain();
  const [account, setAccount] = useState<AccountSummary>();
  const [households, setHouseholds] = useState<HouseholdData[]>([]);
  const [invitations, setInvitations] = useState<FamilyInvitationListData>({ sent: [], received: [] });
  const [links, setLinks] = useState<ProfileLinkData[]>([]);
  const [working, setWorking] = useState(false);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  const loadAccountData = useCallback(async () => {
    const [accountValue, householdValues, invitationValues, linkValues] = await Promise.all([
      serverApiClient.getAccount(),
      serverApiClient.listHouseholds(),
      serverApiClient.listInvitations(),
      serverApiClient.listProfileLinks(),
    ]);
    setAccount(accountValue);
    setHouseholds(householdValues);
    setInvitations(invitationValues);
    setLinks(linkValues);
  }, []);

  useEffect(() => {
    void serverApiClient.refresh().then(loadAccountData).catch(() => undefined);
  }, [loadAccountData]);

  async function authenticate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");
    const action = String(form.get("action"));
    setWorking(true);
    resetFeedback();
    try {
      if (action === "signup") await serverApiClient.signUp(email, password);
      await serverApiClient.login(email, password);
      await loadAccountData();
      setMessage(action === "signup" ? "가입하고 로그인했습니다." : "로그인했습니다.");
    } catch (caught) {
      setError(messageFrom(caught, "계정 인증에 실패했습니다."));
    } finally {
      setWorking(false);
    }
  }

  async function createHousehold() {
    await run(async () => {
      await serverApiClient.createHousehold();
      await loadAccountData();
      setMessage("가정을 만들었습니다.");
    });
  }

  async function sendInvitation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtime) return;
    const form = new FormData(event.currentTarget);
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
      setMessage("초대를 생성했습니다. 건강정보는 서버로 전송하지 않았습니다.");
    });
  }

  async function acceptAndLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!runtime) return;
    const form = new FormData(event.currentTarget);
    const invitationId = String(form.get("invitationId"));
    const token = String(form.get("token"));
    const profileId = String(form.get("profileId"));
    const invitation = invitations.received.find((item) => item.id === invitationId);
    const profile = profiles.find((item) => item.id === profileId);
    if (!invitation || !profile) return;
    await run(async () => {
      await serverApiClient.acceptInvitation(invitationId, token);
      await serverApiClient.createProfileLink(invitationId, invitation.target_profile_ref);
      const localResult = await runtime.profiles.setServerReference(profile.id, invitation.target_profile_ref, "active");
      if (!localResult.ok) throw new Error(localResult.error.message);
      await refreshProfiles();
      await loadAccountData();
      setMessage("초대를 수락하고 기존 로컬 프로필에 연결했습니다.");
    });
  }

  async function unlink(link: ProfileLinkData) {
    if (!runtime) return;
    await run(async () => {
      await serverApiClient.unlinkProfileLink(link.id);
      const profile = profiles.find((item) => item.opaqueServerRef === link.local_profile_ref);
      if (profile) await runtime.profiles.setServerReference(profile.id, null, "retired");
      await refreshProfiles();
      await loadAccountData();
      setMessage("계정 연결을 해제했습니다. 로컬 건강정보는 그대로 보존됩니다.");
    });
  }

  async function logout() {
    await run(async () => {
      await serverApiClient.logout();
      setAccount(undefined);
      setHouseholds([]);
      setInvitations({ sent: [], received: [] });
      setLinks([]);
    });
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
      <section className="dashboard-heading"><div><p className="page-kicker">서비스 계정</p><h1>구독과 가족 연결을 관리하세요</h1><p>건강정보가 아닌 계정·초대·불투명 연결 상태만 서버에서 처리합니다.</p></div>{account ? <button className="secondary-button" type="button" onClick={() => void logout()}>로그아웃</button> : null}</section>
      {message ? <div className="alert success-alert" role="status">{message}</div> : null}
      {error ? <div className="alert error-alert" role="alert">{error}</div> : null}

      {!account ? (
        <section className="account-card"><h2>가입 또는 로그인</h2><form className="product-form" onSubmit={authenticate}><label>이메일<input name="email" type="email" required /></label><label>비밀번호<input name="password" type="password" minLength={8} required /></label><div className="form-actions"><button className="secondary-button" name="action" value="signup" disabled={working}>가입</button><button className="primary-button" name="action" value="login" disabled={working}>로그인</button></div></form></section>
      ) : (
        <div className="account-grid">
          <section className="account-card"><p className="section-kicker">내 계정</p><h2>{account.account.email}</h2><dl><div><dt>플랜</dt><dd>{account.subscription.plan}</dd></div><div><dt>상태</dt><dd>{account.subscription.status}</dd></div></dl></section>
          <section className="account-card"><div className="section-title-row"><div><p className="section-kicker">가정</p><h2>{households.length}개</h2></div><button className="secondary-button" type="button" disabled={working} onClick={() => void createHousehold()}>가정 만들기</button></div>{households.map((household) => <p key={household.id} className="server-id-row">{household.id}</p>)}</section>
          <section className="account-card account-wide"><p className="section-kicker">가족 초대</p><h2>기존 로컬 프로필에 서비스 계정 초대</h2><form className="account-inline-form" onSubmit={sendInvitation}><select name="householdId" required defaultValue=""><option value="" disabled>가정 선택</option>{households.map((item) => <option key={item.id} value={item.id}>{item.id.slice(0, 8)}</option>)}</select><select name="profileId" required defaultValue=""><option value="" disabled>로컬 프로필 선택</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select><input name="inviteeEmail" type="email" required placeholder="초대할 이메일" /><button className="primary-button" disabled={working}>초대</button></form><InvitationList title="보낸 초대" items={invitations.sent} /></section>
          <section className="account-card account-wide"><p className="section-kicker">받은 초대</p><h2>초대 수락 후 기존 프로필 연결</h2>{invitations.received.filter((item) => item.status === "pending").map((invitation) => <form className="received-invitation" key={invitation.id} onSubmit={acceptAndLink}><input type="hidden" name="invitationId" value={invitation.id} /><span>{invitation.inviter_account_id.slice(0, 8)}…의 초대</span><select name="profileId" required defaultValue=""><option value="" disabled>연결할 기존 프로필</option>{profiles.map((item) => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select><input name="token" required placeholder="이메일 초대 토큰" /><button className="primary-button" disabled={working}>수락·연결</button></form>)}</section>
          <section className="account-card account-wide"><p className="section-kicker">프로필 연결</p><h2>활성 연결</h2>{links.filter((item) => item.status === "active").map((link) => <div className="profile-link-row" key={link.id}><code>{link.local_profile_ref.slice(0, 12)}…</code><button className="secondary-button" type="button" disabled={working} onClick={() => void unlink(link)}>연결 해제</button></div>)}</section>
        </div>
      )}
    </div>
  );
}

function InvitationList({ title, items }: { title: string; items: FamilyInvitationListData["sent"] }) {
  return <div className="invitation-list"><strong>{title}</strong>{items.map((item) => <p key={item.id}>{item.invitee_email}<span>{item.status}</span></p>)}</div>;
}

function createOpaqueReference(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function messageFrom(caught: unknown, fallback: string): string {
  return caught instanceof Error ? caught.message : fallback;
}
