import { FormEvent, useMemo, useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { ServerApiError, serverApiClient } from "../../shared/api/serverApiClient";
import { readWallDevice, wallDeviceRef, writeWallDevice } from "./wallDeviceStore";
import "../ui-preview/styles/ui-preview18.css";

/**
 * 관문 밖 벽 페어링. 마스터 계정 세션·건강기록을 읽지 않는다.
 */
export function WallPairPage() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const existing = readWallDevice();
  const [householdId, setHouseholdId] = useState(params.get("household") ?? existing?.householdId ?? "");
  const [code, setCode] = useState(params.get("code") ?? "");
  const [displayName, setDisplayName] = useState("거실 벽");
  const [error, setError] = useState<string>();
  const [working, setWorking] = useState(false);

  const previewUrl = useMemo(() => {
    if (!householdId || !code) return "";
    return `/wall/pair?household=${encodeURIComponent(householdId)}&code=${encodeURIComponent(code)}`;
  }, [householdId, code]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setWorking(true);
    setError(undefined);
    try {
      const claimed = await serverApiClient.claimHouseholdDevice({
        pairingCode: code.trim().toUpperCase(),
        householdId: householdId.trim(),
        displayName: displayName.trim() || "거실 벽",
        deviceRef: wallDeviceRef(),
      });
      writeWallDevice({
        householdId: claimed.household_id,
        deviceId: claimed.id,
        deviceToken: claimed.device_token,
        displayName: claimed.display_name,
      });
      navigate("/wall");
    } catch (caught) {
      if (caught instanceof ServerApiError) {
        setError(caught.message);
      } else {
        setError("기기를 연결하지 못했습니다.");
      }
      setWorking(false);
    }
  }

  return (
    <main className="up15-root" style={{ minHeight: "100dvh", padding: "32px 20px" }}>
      <p className="up15-kicker">공용 벽 기기</p>
      <h1 style={{ fontFamily: "Fraunces, serif", color: "var(--up15-aubergine)" }}>거실 대시보드 연결</h1>
      <p style={{ color: "var(--up15-fog)", maxWidth: "40rem" }}>
        마스터가 개인 기기에서 재인증해 만든 코드만 사용합니다. 구성원 PIN으로는 새 기기를 등록할 수 없습니다.
      </p>
      {previewUrl ? <p className="form-notice">연결 주소: {previewUrl}</p> : null}
      <form className="up17-modal" style={{ marginTop: "24px", maxWidth: "28rem" }} onSubmit={(event) => void onSubmit(event)}>
        <label>
          가정 ID
          <input value={householdId} onChange={(event) => setHouseholdId(event.target.value)} required autoComplete="off" />
        </label>
        <label>
          페어링 코드
          <input value={code} onChange={(event) => setCode(event.target.value.toUpperCase())} required autoComplete="off" />
        </label>
        <label>
          기기 이름
          <input value={displayName} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        {error ? <p role="alert">{error}</p> : null}
        <button type="submit" className="primary-button" disabled={working}>
          이 가구에 연결
        </button>
      </form>
      <p style={{ marginTop: "24px" }}>
        <Link to="/wall">이미 연결된 벽 화면</Link>
      </p>
    </main>
  );
}
