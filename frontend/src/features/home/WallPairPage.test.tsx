/**
 * 벽 페어링은 관문 밖에 선다. 건강기록 계층을 import 하면 안 된다.
 */

/// <reference types="node" />
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { WallPairPage } from "./WallPairPage";

afterEach(cleanup);

describe("WallPairPage 경계", () => {
  it("useLocalDomain 과 로컬 건강기록 계층을 import 하지 않는다", () => {
    const source = readFileSync(resolve(import.meta.dirname, "WallPairPage.tsx"), "utf8");
    const forbidden = ["useLocalDomain", "localDomainContext", "shared/local/", "local-domain/"];
    const offenders = forbidden.filter((token) => {
      const pattern = new RegExp(`^\\s*import[^;]*${token.replace(/[/.]/gu, "\\$&")}`, "mu");
      return pattern.test(source);
    });
    expect(offenders).toEqual([]);
  });

  it("페어링 폼을 그린다", () => {
    render(
      <MemoryRouter initialEntries={["/wall/pair"]}>
        <Routes>
          <Route path="/wall/pair" element={<WallPairPage />} />
          <Route path="/wall" element={<div>wall</div>} />
        </Routes>
      </MemoryRouter>,
    );
    expect(screen.getByRole("heading", { name: "거실 대시보드 연결" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "이 가구에 연결" })).toBeInTheDocument();
  });
});
