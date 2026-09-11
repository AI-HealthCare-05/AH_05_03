/**
 * 기록을 고칠 때 **다른 칸이 지워지지 않는다** — `LocalDomainProvider.updateHealthRecord`.
 *
 * **왜 이 파일이 생겼나.** 이 함수가 서버로 `payload: { note }` 를 보내고 있었다.
 * 서버는 `record.payload = req.payload` 로 **통째로 교체**하므로(`app/services/
 * health_records.py`), 메모만 고쳐도 혈압·혈당 수치가 함께 사라졌다.
 *
 * 화면에는 "수정했습니다" 만 뜨고 값이 없어진다 — 사용자가 그 자리에서 알아챌 방법이
 * 없고, 추이 그래프에서 점 하나가 조용히 빠진다. 지표로도 안 잡힌다.
 *
 * 그래서 이 테스트가 보는 것은 하나다. **고치지 않은 칸이 그대로 살아 있는가.**
 */

import { useEffect } from "react";
import { render, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { LocalDomainProvider } from "./LocalDomainProvider";
import { PRIMARY_HOUSEHOLD_ID, useLocalDomain } from "./localDomainContext";
import type { HealthRecord } from "../shared/local/domainContracts";

/** 기록 하나를 만들고 메모만 고친 뒤, 남은 payload 를 밖으로 알려 준다. */
function EditNoteOnly({ onDone }: { onDone: (record: HealthRecord) => void }) {
  const { runtime, createProfile, updateHealthRecord } = useLocalDomain();

  useEffect(() => {
    if (!runtime) return;
    let cancelled = false;
    void (async () => {
      const profile = await createProfile({ displayName: "나", relationship: "본인", gender: "male" });
      // **컨텍스트의 `createHealthRecord` 는 메모 전용이다**(홈 폼이 메모만 묻는다).
      // 수치가 담긴 기록을 만들려면 런타임을 직접 쓴다 — 봄이 대화·건강기록 화면이
      // 실제로 그 길로 저장한다.
      const createdResult = await runtime.healthRecords.create({
        householdId: PRIMARY_HOUSEHOLD_ID,
        profileId: profile.id,
        recordType: "blood_pressure",
        recordedAt: new Date().toISOString(),
        source: "manual",
        payload: { systolicMmHg: 128, diastolicMmHg: 82, pulseBpm: 72, note: "처음 메모" },
      });
      if (!createdResult.ok) throw new Error(createdResult.error.message);
      const created = createdResult.value;
      const updated = await updateHealthRecord(created.id, {
        recordType: created.recordType,
        recordedAt: created.recordedAt,
        note: "고친 메모",
        expectedVersion: created.version,
      });
      if (!cancelled) onDone(updated);
    })();
    return () => {
      cancelled = true;
    };
  }, [runtime, createProfile, updateHealthRecord, onDone]);

  return null;
}

describe("updateHealthRecord", () => {
  it("메모만 고쳐도 수치는 남는다", async () => {
    const done = vi.fn();
    render(
      <LocalDomainProvider databaseName={`ieobom-update-${crypto.randomUUID()}`}>
        <EditNoteOnly onDone={done} />
      </LocalDomainProvider>,
    );

    await waitFor(() => expect(done).toHaveBeenCalled(), { timeout: 5000 });
    const payload = (done.mock.calls[0][0] as HealthRecord).payload as Record<string, unknown>;

    // **이 세 줄이 이 파일의 전부다.** 예전에는 셋 다 `undefined` 였다.
    expect(payload.systolicMmHg).toBe(128);
    expect(payload.diastolicMmHg).toBe(82);
    expect(payload.pulseBpm).toBe(72);
    // 고치라고 한 것은 바뀐다.
    expect(payload.note).toBe("고친 메모");
  });
});
