import { FormEvent, useEffect, useState } from "react";

import type { DevicePairingCreatedData, HouseholdData, HouseholdDeviceData, PinLockAlertData } from "../../shared/api/contracts";
import { ServerApiError, serverApiClient } from "../../shared/api/serverApiClient";

export function WallDevicesCard({
  households,
  currentAccountId,
  working,
}: {
  households: HouseholdData[];
  currentAccountId: string;
  working: boolean;
}) {
  const masterHousehold = households.find((item) => item.status === "active" && item.master_account_id === currentAccountId);
  const householdId = masterHousehold?.id;
  const [devices, setDevices] = useState<HouseholdDeviceData[]>([]);
  const [alerts, setAlerts] = useState<PinLockAlertData[]>([]);
  const [password, setPassword] = useState("");
  const [pairing, setPairing] = useState<DevicePairingCreatedData>();
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  async function refresh(boundId: string) {
    const [nextDevices, nextAlerts] = await Promise.all([
      serverApiClient.listHouseholdDevices(boundId),
      serverApiClient.listPinLockAlerts(boundId).catch(() => [] as PinLockAlertData[]),
    ]);
    setDevices(nextDevices);
    setAlerts(nextAlerts);
  }

  useEffect(() => {
    if (!householdId) return;
    void refresh(householdId).catch(() => {
      setDevices([]);
      setAlerts([]);
    });
  }, [householdId]);

  if (!householdId) return null;
  const boundHouseholdId = householdId;

  const pairUrl =
    pairing && typeof window !== "undefined"
      ? `${window.location.origin}/wall/pair?household=${encodeURIComponent(pairing.household_id)}&code=${encodeURIComponent(pairing.code)}`
      : "";

  async function issue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(undefined);
    try {
      const created = await serverApiClient.createDevicePairing(boundHouseholdId, password);
      setPairing(created);
      setPassword("");
    } catch (caught) {
      setError(caught instanceof ServerApiError ? caught.message : "페어링 코드를 만들지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function revoke(device: HouseholdDeviceData) {
    const confirmed = window.prompt("이 벽 기기를 철회하려면 계정 비밀번호를 다시 입력하세요.");
    if (!confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      await serverApiClient.revokeHouseholdDevice(boundHouseholdId, device.id, confirmed, device.row_version);
      await refresh(boundHouseholdId);
    } catch (caught) {
      setError(caught instanceof ServerApiError ? caught.message : "기기를 철회하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function emergencyRevoke() {
    const confirmed = window.prompt("모든 벽 기기와 구성원 PIN 세션을 끊으려면 계정 비밀번호를 다시 입력하세요.");
    if (!confirmed) return;
    setBusy(true);
    setError(undefined);
    try {
      await serverApiClient.emergencyRevokeHouseholdDevices(boundHouseholdId, confirmed);
      await refresh(boundHouseholdId);
    } catch (caught) {
      setError(caught instanceof ServerApiError ? caught.message : "비상 철회를 완료하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function acknowledge(alert: PinLockAlertData) {
    setBusy(true);
    setError(undefined);
    try {
      await serverApiClient.acknowledgePinLockAlert(boundHouseholdId, alert.id);
      await refresh(boundHouseholdId);
    } catch (caught) {
      setError(caught instanceof ServerApiError ? caught.message : "알림을 확인하지 못했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="account-card account-wide">
      <p className="section-kicker">공용 벽</p>
      <h2>벽 기기 연결</h2>
      <p className="account-help">구성원 PIN으로는 등록할 수 없습니다. 마스터 계정 비밀번호로 재인증한 뒤 코드를 벽에 입력합니다. 철회는 다음 요청부터 바로 적용됩니다.</p>
      {alerts.length > 0 ? (
        <div className="alert error-alert" role="alert">
          <p>구성원 PIN이 잠겼습니다. 무차별 시도로 보입니다. PIN 원문은 알림에 없습니다.</p>
          <ul>
            {alerts.map((alert) => (
              <li key={alert.id}>
                프로필 {alert.profile_id.slice(0, 8)} · 시도 {alert.attempts ?? "제한 초과"}
                <button className="text-danger-button" type="button" disabled={busy} onClick={() => void acknowledge(alert)}>
                  확인했습니다
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <form className="account-inline-form" onSubmit={(event) => void issue(event)}>
        <label className="visually-hidden" htmlFor="wall-reauth">
          계정 비밀번호
        </label>
        <input
          id="wall-reauth"
          type="password"
          autoComplete="current-password"
          placeholder="재인증 비밀번호"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button className="primary-button" type="submit" disabled={working || busy}>
          페어링 코드 만들기
        </button>
      </form>
      {pairing ? (
        <div>
          <p>
            코드 <strong>{pairing.code}</strong>
          </p>
          <p>
            연결 주소 <code>{pairUrl}</code>
          </p>
        </div>
      ) : null}
      {error ? (
        <p className="alert error-alert" role="alert">
          {error}
        </p>
      ) : null}
      {devices.length === 0 ? (
        <p className="account-empty">등록된 벽 기기가 없습니다.</p>
      ) : (
        <ul>
          {devices.map((device) => (
            <li key={device.id}>
              {device.display_name} · {device.status}
              {device.status === "active" ? (
                <button className="text-danger-button" type="button" disabled={busy} onClick={() => void revoke(device)}>
                  원격 철회
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      <button className="danger-button" type="button" disabled={working || busy} onClick={() => void emergencyRevoke()}>
        모든 벽 기기 비상 철회
      </button>
    </section>
  );
}
