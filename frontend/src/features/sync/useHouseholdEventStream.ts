import { useEffect, useRef } from "react";
import type { ServerApiClient } from "../../shared/api/serverApiClient";

export interface UseHouseholdEventStreamOptions {
  serverClient: ServerApiClient | null;
  householdId: string | null | undefined;
  enabled?: boolean;
  onRecordEvent: (event: string, data: Record<string, unknown>) => void;
}

/**
 * 가구 실시간 SSE 이벤트를 구독하고 끊겼을 때 자동 재연결하는 훅.
 *
 * 다른 가족 구성원(다른 기기나 탭)이 건강 기록을 남기면 서버가 푸시하는
 * `record_saved`·`record_deleted` 이벤트를 즉시 수신하여 콜백을 실행한다.
 */
export function useHouseholdEventStream({
  serverClient,
  householdId,
  enabled = true,
  onRecordEvent,
}: UseHouseholdEventStreamOptions): void {
  const onRecordEventRef = useRef(onRecordEvent);
  useEffect(() => {
    onRecordEventRef.current = onRecordEvent;
  }, [onRecordEvent]);

  useEffect(() => {
    if (!enabled || !serverClient || !householdId) return;

    // "household-local-primary" 같은 로컬 전용 가구 ID는 서버에 존재하지 않으므로 UUID 형태인지 점검
    const isUuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(householdId);
    if (!isUuid) return;

    const controller = new AbortController();
    let active = true;
    let timer: number | undefined;

    const connect = async () => {
      while (active && !controller.signal.aborted) {
        try {
          await serverClient.streamHouseholdEvents(
            householdId,
            (event, data) => {
              if (!active) return;
              if (event === "record_saved" || event === "record_deleted") {
                onRecordEventRef.current(event, data);
              }
            },
            controller.signal,
          );
        } catch {
          if (!active || controller.signal.aborted) break;
          // 연결 끊김 발생 시 3초 후 재연결 시도
          await new Promise<void>((resolve) => {
            timer = window.setTimeout(resolve, 3000);
          });
        }
      }
    };

    void connect();

    return () => {
      active = false;
      controller.abort();
      if (timer) window.clearTimeout(timer);
    };
  }, [enabled, serverClient, householdId]);
}
