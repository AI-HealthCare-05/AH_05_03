import { NavLink } from "react-router-dom";

import { useAuth } from "../../../app/authContext";

interface StitchAccountChipProps {
  displayName?: string;
  variant?: "up15" | "hd3";
}

export function StitchAccountChip({ displayName, variant = "up15" }: StitchAccountChipProps) {
  const { email } = useAuth();
  const shownName = displayName?.trim() || "계정";
  const label = email ? `${shownName}(${email})` : shownName;
  const isHd3 = variant === "hd3";

  return (
    <NavLink
      to="/account"
      className={isHd3 ? "hd3-profile-chip" : "up15-user-pill"}
      title={`계정 관리${email ? ` (${email})` : ""}`}
      aria-label={`계정 관리${email ? ` (${email})` : ""}`}
    >
      <span className={isHd3 ? "hd3-avatar-circle" : "up15-avatar"} aria-hidden="true">
        {shownName.slice(0, isHd3 ? 1 : 2)}
      </span>
      <span className={isHd3 ? "hd3-user-name" : "up15-user-name"}>{label}</span>
    </NavLink>
  );
}
