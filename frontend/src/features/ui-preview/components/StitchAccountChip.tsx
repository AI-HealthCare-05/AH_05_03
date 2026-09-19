import { useEffect, useId, useRef, useState } from "react";
import { NavLink } from "react-router-dom";

import { useAuth } from "../../../app/authContext";

interface StitchAccountChipProps {
  displayName?: string;
  variant?: "up15" | "hd3";
}

export function StitchAccountChip({ displayName, variant = "up15" }: StitchAccountChipProps) {
  const { email, signOut } = useAuth();
  const shownName = displayName?.trim() || "계정";
  const label = email ? `${shownName}(${email})` : shownName;
  const isHd3 = variant === "hd3";
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const buttonId = useId();

  useEffect(() => {
    if (!open) return;

    const onPointerDown = (event: PointerEvent) => {
      const root = rootRef.current;
      if (root && event.target instanceof Node && !root.contains(event.target)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div className="up15-account-menu" ref={rootRef}>
      <button
        type="button"
        className={isHd3 ? "hd3-profile-chip" : "up15-user-pill"}
        id={buttonId}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={menuId}
        title={`계정 메뉴${email ? ` (${email})` : ""}`}
        aria-label={`계정 메뉴${email ? ` (${email})` : ""}`}
        onClick={() => setOpen((current) => !current)}
      >
        <span className={isHd3 ? "hd3-avatar-circle" : "up15-avatar"} aria-hidden="true">
          {shownName.slice(0, isHd3 ? 1 : 2)}
        </span>
        <span className={isHd3 ? "hd3-user-name" : "up15-user-name"}>{label}</span>
      </button>
      {open ? (
        <div className="up15-account-menu-list" role="menu" id={menuId} aria-labelledby={buttonId}>
          <NavLink
            role="menuitem"
            to="/account"
            className="up15-account-menu-item"
            onClick={() => setOpen(false)}
          >
            가족 접근
          </NavLink>
          <button
            role="menuitem"
            type="button"
            className="up15-account-menu-item up15-account-menu-signout"
            onClick={() => {
              setOpen(false);
              void signOut();
            }}
          >
            로그아웃
          </button>
        </div>
      ) : null}
    </div>
  );
}
