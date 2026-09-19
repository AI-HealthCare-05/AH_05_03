import { Link } from "react-router-dom";

export interface VariantBarProps {
  current: "default" | "v1" | "v2" | "v3" | "v4" | "v5" | "v6" | "v7" | "v8" | "v9" | "v10" | "v11" | "v12" | "v13" | "v14" | "v15" | "v16" | "v17" | "v18";
}

export function VariantBar({ current }: VariantBarProps) {
  return (
    <div className="sp-variant-bar-dock">
    <aside className="sp-variant-bar" aria-label="43인치 4K 대화면 시안 비교 바" title="시안 전환 메뉴">
      <div className="sp-variant-bar-title">
        <span className="sp-variant-bar-tag">43인치 4K 대응 시안</span>
        <span>화면 크기에 맞춘 레이아웃을 직접 비교해보세요:</span>
      </div>

      <nav className="sp-variant-tabs" aria-label="시안 전환 탭">
        <Link
          to="/ui-preview"
          className={`sp-variant-tab ${current === "default" ? "active" : ""}`}
        >
          기본 (1440px)
        </Link>
        <Link
          to="/ui-preview1"
          className={`sp-variant-tab ${current === "v1" ? "active" : ""}`}
        >
          시안 1: 3분할 워크스페이스
        </Link>
        <Link
          to="/ui-preview2"
          className={`sp-variant-tab ${current === "v2" ? "active" : ""}`}
        >
          시안 2: 4K 유체 와이드
        </Link>
        <Link
          to="/ui-preview3"
          className={`sp-variant-tab ${current === "v3" ? "active" : ""}`}
        >
          시안 3: 3D 바디맵 융합 뷰
        </Link>
        <Link
          to="/ui-preview4"
          className={`sp-variant-tab ${current === "v4" ? "active" : ""}`}
        >
          시안 4: 거실 TV 월보드
        </Link>
        <Link
          to="/ui-preview5"
          className={`sp-variant-tab ${current === "v5" ? "active" : ""}`}
        >
          시안 5: 메인 실측 와이드
        </Link>
        <Link
          to="/ui-preview6"
          className={`sp-variant-tab ${current === "v6" ? "active" : ""}`}
        >
          시안 6: 심리스 타일 그리드
        </Link>
        <Link
          to="/ui-preview7"
          className={`sp-variant-tab ${current === "v7" ? "active" : ""}`}
        >
          시안 7: 마우스 리사이즈 (드래그 & 규격 프리셋)
        </Link>
        <Link
          to="/ui-preview8"
          className={`sp-variant-tab ${current === "v8" ? "active" : ""}`}
        >
          시안 8: 전문 건강 데이터 워크스페이스
        </Link>
        <Link
          to="/ui-preview9"
          className={`sp-variant-tab ${current === "v9" ? "active" : ""}`}
        >
          시안 9: 3-패널 데이터 워크스페이스
        </Link>
        <Link
          to="/ui-preview10"
          className={`sp-variant-tab ${current === "v10" ? "active" : ""}`}
        >
          시안 10: 길이 조절 타일 밀어내기 (Push on Resize)
        </Link>
        <Link
          to="/ui-preview11"
          className={`sp-variant-tab ${current === "v11" ? "active" : ""}`}
          style={current === "v11" ? { background: "#1d4ed8", color: "#fff", fontWeight: 700 } : {}}
        >
          시안 11: Stitch 3D 인체 매핑
        </Link>
        <Link
          to="/ui-preview12"
          className={`sp-variant-tab ${current === "v12" ? "active" : ""}`}
        >
          시안 12: 헬스케어 분석 대시보드
        </Link>
        <Link
          to="/ui-preview13"
          className={`sp-variant-tab ${current === "v13" ? "active" : ""}`}
          style={current === "v13" ? { background: "#1d4fb8", color: "#fff", fontWeight: 700 } : {}}
        >
          시안 13: 헬스케어 분석 대시보드 홈
        </Link>
        <Link
          to="/ui-preview14"
          className={`sp-variant-tab ${current === "v14" ? "active" : ""}`}
          style={current === "v14" ? { background: "#3c315b", color: "#fff", fontWeight: 700 } : {}}
        >
          시안 14: 스티치 캡슐 미니멀 홈 (3D 바디맵+차트2)
        </Link>
        <Link
          to="/ui-preview15"
          className={`sp-variant-tab ${current === "v15" ? "active" : ""}`}
          style={current === "v15" ? { background: "#261b44", color: "#fff", fontWeight: 700 } : {}}
        >
          시안 15: 스티치 4K 유체 와이드 (플로팅 비서)
        </Link>
        <Link
          to="/ui-preview16"
          className={`sp-variant-tab ${current === "v16" ? "active" : ""}`}
          style={current === "v16" ? { background: "#3c315b", color: "#fff", fontWeight: 700 } : {}}
        >
          시안 16: 4K 유체 와이드 + 반응형 타임라인 확장
        </Link>
        <Link
          to="/ui-preview17"
          className={`sp-variant-tab ${current === "v17" ? "active" : ""}`}
          style={current === "v17" ? { background: "#261b44", color: "#fff", fontWeight: 700 } : {}}
        >
          시안 17: 4K 멀티위젯 + 원본 비율 복원
        </Link>
        <Link
          to="/"
          className={`sp-variant-tab ${current === "v18" ? "active" : ""}`}
          style={current === "v18" ? { background: "#3c315b", color: "#fff", fontWeight: 700 } : {}}
        >
          가족 홈
        </Link>
        <Link
          to="/health-data3"
          className="sp-variant-tab"
        >
          종합 일람: 건강 데이터 3
        </Link>
      </nav>
    </aside>
    </div>
  );
}
