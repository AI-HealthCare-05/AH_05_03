import { useState } from "react";
import { HealthRecordForm } from "./components/HealthRecordForm";
import { HealthRecordHistory } from "./components/HealthRecordHistory";
import { OcrImportPanel } from "./components/OcrImportPanel";
import { DocumentLibrary } from "./components/DocumentLibrary";

const demoProfiles = [
  { id: "profile-dawon", name: "정다원", relationship: "본인" },
  { id: "profile-mother", name: "김봄", relationship: "어머니" },
  { id: "profile-father", name: "정한결", relationship: "아버지" },
];

export function App() {
  const [view, setView] = useState<"history" | "create" | "documents">("history");
  return <div className="app"><aside><div className="brand"><span>이</span>이어봄</div><nav><a>홈</a><a className={view === "history" || view === "create" ? "active" : ""} onClick={() => setView("history")}>건강 기록</a><a className={view === "documents" ? "active" : ""} onClick={() => setView("documents")}>원본 서류</a><a>건강 변화</a><a>가족 관리</a></nav><div className="privacy">● 이 기기에 안전하게 저장 중</div></aside>{view === "history" ? <HealthRecordHistory profiles={demoProfiles} onCreate={() => setView("create")} /> : view === "create" ? <HealthRecordForm householdId="local-household-demo" profiles={demoProfiles} onShowHistory={() => setView("history")} /> : <DocumentLibrary householdId="local-household-demo" profiles={demoProfiles} />}<OcrImportPanel /></div>;
}
