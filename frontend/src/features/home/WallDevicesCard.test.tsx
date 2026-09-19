import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { HouseholdData } from "../../shared/api/contracts";
import { serverApiClient } from "../../shared/api/serverApiClient";
import { WallDevicesCard } from "./WallDevicesCard";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const household: HouseholdData = {
  id: "household-1",
  created_by_account_id: "account-id",
  master_account_id: "account-id",
  status: "active",
  created_at: "2026-09-19T00:00:00Z",
  row_version: 1,
};

describe("WallDevicesCard 보안 알림", () => {
  it("PIN 잠금 알림을 보여주고 확인하면 목록에서 뺍니다", async () => {
    const user = userEvent.setup();
    vi.spyOn(serverApiClient, "listHouseholdDevices").mockResolvedValue([]);
    const alerts = vi
      .spyOn(serverApiClient, "listPinLockAlerts")
      .mockResolvedValueOnce([
        { id: "alert-1", profile_id: "profile-lock", attempts: "5", occurred_at: "2026-09-19T00:00:00Z" },
      ])
      .mockResolvedValueOnce([]);
    const ack = vi.spyOn(serverApiClient, "acknowledgePinLockAlert").mockResolvedValue({
      id: "alert-1",
      profile_id: "profile-lock",
      attempts: "5",
      occurred_at: "2026-09-19T00:00:00Z",
    });

    render(<WallDevicesCard households={[household]} currentAccountId="account-id" working={false} />);

    expect(await screen.findByText(/구성원 PIN이 잠겼습니다/)).toBeInTheDocument();
    expect(screen.queryByText("482913")).not.toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "확인했습니다" }));
    await waitFor(() => {
      expect(ack).toHaveBeenCalledWith("household-1", "alert-1");
    });
    await waitFor(() => {
      expect(alerts).toHaveBeenCalledTimes(2);
    });
    await waitFor(() => {
      expect(screen.queryByText(/구성원 PIN이 잠겼습니다/)).not.toBeInTheDocument();
    });
  });
});
