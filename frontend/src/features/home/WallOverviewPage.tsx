import { FormEvent, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";

import type { WallProfileCardData } from "../../shared/api/contracts";
import { ServerApiError } from "../../shared/api/serverApiClient";
import { Modal } from "../../shared/ui/Modal";
import { PIN_SESSION_MS, isPinSessionFresh } from "./memberPin";
import { clearPinSession, writePinSession } from "./memberPinStore";
import { clearWallDevice, readWallDevice } from "./wallDeviceStore";
import "../ui-preview/styles/ui-preview18.css";

async function deviceRequest<T>(path: string, token: string, init?: RequestInit): Promise<T | null> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      ...(init?.headers ?? {}),
    },
  });
  if (response.status === 204) return null;
  const body = (await response.json()) as { success?: boolean; data?: T; error_code?: string; message?: string };
  if (!response.ok) {
    throw new ServerApiError(response.status, body.error_code ?? "INTERNAL_ERROR", body.message ?? "요청에 실패했습니다.");
  }
  return body.data as T;
}

/**
 * 관문 밖 벽 개요. 마스터 장기 세션 없이 기기 토큰만 쓴다. 상세 수치는 그리지 않는다.
 */
export function WallOverviewPage() {
  const [binding, setBinding] = useState(readWallDevice);
  const [cards, setCards] = useState<WallProfileCardData[]>([]);
  const [error, setError] = useState<string>();
  const [selectedId, setSelectedId] = useState("");
  const [pinProfile, setPinProfile] = useState<WallProfileCardData>();
  const [pinInput, setPinInput] = useState("");
  const [unlockedAt, setUnlockedAt] = useState(0);

  const load = useCallback(async () => {
    if (!binding) return;
    try {
      const data = await deviceRequest<{ household_id: string; items: WallProfileCardData[] }>(
        "/household-devices/me/profiles",
        binding.deviceToken,
      );
      setCards(data?.items ?? []);
      setError(undefined);
    } catch (caught) {
      if (caught instanceof ServerApiError && (caught.errorCode === "DEVICE_REVOKED" || caught.status === 401)) {
        clearWallDevice();
        setBinding(undefined);
        setError("이 벽 기기는 철회되었거나 등록되지 않았습니다.");
        return;
      }
      setError(caught instanceof Error ? caught.message : "가족 개요를 불러오지 못했습니다.");
    }
  }, [binding]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    if (!selectedId) return;
    const onActivity = () => setUnlockedAt(Date.now());
    const timer = window.setInterval(() => {
      if (!isPinSessionFresh(unlockedAt)) {
        setSelectedId("");
        clearPinSession();
      }
    }, 5_000);
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
    };
  }, [selectedId, unlockedAt]);

  async function submitPin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!binding || !pinProfile) return;
    try {
      await deviceRequest(
        "/household-devices/me/member-sessions",
        binding.deviceToken,
        {
          method: "POST",
          body: JSON.stringify({ profile_id: pinProfile.id, pin: pinInput }),
        },
      );
      writePinSession({ profileId: pinProfile.id, unlockedAt: Date.now() });
      setSelectedId(pinProfile.id);
      setUnlockedAt(Date.now());
      setPinInput("");
      setPinProfile(undefined);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "PIN을 확인하지 못했습니다.");
    }
  }

  if (!binding) {
    return (
      <main className="up15-root" style={{ minHeight: "100dvh", padding: "32px 20px" }}>
        <h1>연결된 벽 기기가 없습니다</h1>
        {error ? <p role="alert">{error}</p> : null}
        <p>
          <Link to="/wall/pair">페어링 코드로 연결</Link>
        </p>
      </main>
    );
  }

  const selected = cards.find((card) => card.id === selectedId);

  return (
    <main className="up15-root" style={{ minHeight: "100dvh", padding: "24px" }}>
      <p className="up15-kicker">{binding.displayName}</p>
      <h1 style={{ fontFamily: "Fraunces, serif", color: "var(--up15-aubergine)" }}>가족 개요</h1>
      <p style={{ color: "var(--up15-fog)" }}>상세 수치는 개인 화면에서만 엽니다. {Math.round(PIN_SESSION_MS / 60000)}분 동안 움직임이 없으면 개요로 돌아갑니다.</p>
      {error ? <p role="alert">{error}</p> : null}
      <div className="up17-member-rail" style={{ marginTop: "24px" }}>
        {cards.map((card) => (
          <button
            key={card.id}
            type="button"
            className="up17-member-chip"
            aria-pressed={selectedId === card.id}
            onClick={() => {
              setError(undefined);
              setPinProfile(card);
              setPinInput("");
            }}
          >
            {card.display_name} · {card.relationship}
          </button>
        ))}
      </div>
      {selected ? (
        <p style={{ marginTop: "24px" }}>
          지금 {selected.display_name} 권한입니다. 건강 수치는 이 벽에 표시하지 않습니다.
        </p>
      ) : (
        <p style={{ marginTop: "24px" }}>구성원을 고르면 PIN을 묻습니다.</p>
      )}
      {pinProfile ? (
        <Modal className="up17-modal" kicker="위임 PIN" title={`${pinProfile.display_name} PIN`} onClose={() => setPinProfile(undefined)}>
          <form onSubmit={(event) => void submitPin(event)}>
            <label>
              구성원 PIN
              <input
                type="password"
                inputMode="numeric"
                autoComplete="off"
                value={pinInput}
                onChange={(event) => setPinInput(event.target.value)}
              />
            </label>
            <button type="submit" className="primary-button">
              이 구성원으로
            </button>
          </form>
        </Modal>
      ) : null}
    </main>
  );
}
