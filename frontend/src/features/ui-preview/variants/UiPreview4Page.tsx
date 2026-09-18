import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Progress } from "../components/ui/Progress";
import { VariantBar } from "../components/VariantBar";
import "../styles/shadcn-preview.css";
import "../styles/shadcn-preview-variants.css";

export function UiPreview4Page() {
  const [timeStr, setTimeStr] = useState("09:41:20");

  useEffect(() => {
    const updateTime = () => {
      const now = new Date();
      setTimeStr(now.toLocaleTimeString("ko-KR", { hour12: false }));
    };
    updateTime();
    const interval = setInterval(updateTime, 1000);
    return () => clearInterval(interval);
  }, []);

  return (
    <div className="shadcn-preview-root">
      <VariantBar current="v4" />

      {/* Wallboard Layout */}
      <div className="sp-v4-wallboard">
        {/* Top TV Screen Bar */}
        <header className="sp-v4-top-bar">
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <div style={{ width: "44px", height: "44px", borderRadius: "12px", background: "var(--sp-primary)", display: "flex", alignItems: "center", justifyContent: "center", color: "#fff" }}>
              <svg width="28" height="28" viewBox="0 0 32 32" fill="none">
                <path d="M16 28C16 28 4 20 4 11.5C4 7.5 7.5 4 11.5 4C13.8 4 15.3 5.2 16 6.2C16.7 5.2 18.2 4 20.5 4C24.5 4 28 7.5 28 11.5C28 20 16 28 16 28Z" stroke="#ffffff" strokeWidth="2.5" />
                <circle cx="11.5" cy="12.5" r="1.8" fill="#ffffff" />
                <circle cx="20.5" cy="12.5" r="1.8" fill="#ffffff" />
              </svg>
            </div>
            <div>
              <h1 style={{ fontSize: "28px", fontWeight: 900, margin: 0, color: "#0f172a" }}>이어봄 가족 건강 월보드</h1>
              <span style={{ fontSize: "14px", color: "#64748b" }}>우리 집 거실 43인치 스마트 스크린 상시 관제 모드</span>
            </div>
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "28px" }}>
            <div style={{ textAlign: "right" }}>
              <div style={{ fontSize: "13px", color: "#64748b", fontWeight: 600 }}>2025년 4월 24일 (목)</div>
              <div className="sp-v4-clock">{timeStr}</div>
            </div>
            <Link to="/ui-preview" style={{ padding: "10px 18px", borderRadius: "10px", background: "#e2e8f0", color: "#334155", textDecoration: "none", fontSize: "14px", fontWeight: 700 }}>
              기본 화면 닫기 ✕
            </Link>
          </div>
        </header>

        {/* 4-Column Equal High-Impact Grid */}
        <div className="sp-v4-grid-4col">
          {/* Column 1: Family Status & Alerts */}
          <div className="sp-v4-col">
            <div className="sp-v4-card sp-alert-card">
              <div className="sp-alert-header">
                <div className="sp-alert-icon-wrap">!</div>
                <span className="sp-alert-title" style={{ fontSize: "20px" }}>주의가 필요한 변화 2개</span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: "12px", marginTop: "12px" }}>
                <div className="sp-alert-item" style={{ padding: "16px" }}>
                  <div className="sp-alert-item-left">
                    <div className="sp-avatar-circle" style={{ width: "44px", height: "44px", fontSize: "22px" }}>👴</div>
                    <div>
                      <strong style={{ fontSize: "15px", display: "block" }}>아빠 혈압 상승</strong>
                      <small style={{ color: "#64748b" }}>수축기 138mmHg (+10 상승)</small>
                    </div>
                  </div>
                  <Badge variant="warning">주의</Badge>
                </div>
                <div className="sp-alert-item" style={{ padding: "16px" }}>
                  <div className="sp-alert-item-left">
                    <div className="sp-avatar-circle" style={{ width: "44px", height: "44px", fontSize: "22px" }}>👩</div>
                    <div>
                      <strong style={{ fontSize: "15px", display: "block" }}>엄마 공복혈당 경계</strong>
                      <small style={{ color: "#64748b" }}>공복 112 mg/dL (주의 범위)</small>
                    </div>
                  </div>
                  <Badge variant="warning">주의</Badge>
                </div>
              </div>
            </div>

            <div className="sp-v4-card">
              <div className="sp-v4-card-title">우리 가족 상태 (4인)</div>
              <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "16px" }}>
                {[
                  { name: "나", icon: "👨‍🦰", status: "safe", desc: "정상 안정", bp: "118/76" },
                  { name: "아빠", icon: "👴", status: "warn", desc: "혈압 주의", bp: "138/88" },
                  { name: "엄마", icon: "👩", status: "warn", desc: "혈당 주의", bp: "124/82" },
                  { name: "동생", icon: "👦", status: "safe", desc: "건강해요", bp: "115/74" },
                ].map((m, idx) => (
                  <div key={idx} style={{ padding: "14px", border: "1px solid var(--sp-border)", borderRadius: "14px", display: "flex", alignItems: "center", gap: "12px", background: "#f8fafc" }}>
                    <Avatar status={m.status as "safe" | "warn"}>{m.icon}</Avatar>
                    <div>
                      <strong style={{ fontSize: "15px", display: "block" }}>{m.name}</strong>
                      <small style={{ color: m.status === "safe" ? "#16a34a" : "#d97706", fontWeight: 700 }}>{m.desc}</small>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          {/* Column 2: Today's Family Challenge & Activity */}
          <div className="sp-v4-col">
            <div className="sp-v4-card">
              <div className="sp-v4-card-title">
                <span>오늘의 가족 챌린지</span>
                <Badge variant="default">2/3 완료 (66%)</Badge>
              </div>
              <Progress value={66} style={{ height: "12px" }} />
              <div style={{ display: "flex", flexDirection: "column", gap: "14px", marginTop: "20px" }}>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px", background: "#f0fdf4", borderRadius: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "20px" }}>🚶</span><strong style={{ fontSize: "16px" }}>20분 걷기</strong></div>
                  <span className="sp-status-green" style={{ fontSize: "14px" }}>달성 완료</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px", background: "#f0fdf4", borderRadius: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "20px" }}>💧</span><strong style={{ fontSize: "16px" }}>물 6잔 마시기</strong></div>
                  <span className="sp-status-green" style={{ fontSize: "14px" }}>달성 완료</span>
                </div>
                <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "14px", background: "#fffbeb", borderRadius: "12px" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}><span style={{ fontSize: "20px" }}>💊</span><strong style={{ fontSize: "16px" }}>저녁 복약 확인</strong></div>
                  <span style={{ color: "#d97706", fontWeight: 700 }}>오후 8시 예정</span>
                </div>
              </div>
            </div>

            <div className="sp-v4-card">
              <div className="sp-v4-card-title">이번 주 운동 기록</div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", background: "#f8fafc", borderRadius: "12px", marginBottom: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div className="sp-exercise-icon-wrap sp-icon-running" style={{ width: "48px", height: "48px", fontSize: "24px" }}>🏃</div>
                  <div><strong style={{ fontSize: "16px" }}>러닝 (나)</strong><small style={{ color: "#64748b", display: "block" }}>총 60분 (평균 6.1km)</small></div>
                </div>
                <span style={{ fontSize: "18px", fontWeight: 800, color: "var(--sp-primary)" }}>2회</span>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "16px", background: "#f8fafc", borderRadius: "12px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
                  <div className="sp-exercise-icon-wrap sp-icon-strength" style={{ width: "48px", height: "48px", fontSize: "24px" }}>🏋️</div>
                  <div><strong style={{ fontSize: "16px" }}>하체 근력 (아빠)</strong><small style={{ color: "#64748b", display: "block" }}>32분 완주</small></div>
                </div>
                <span style={{ fontSize: "18px", fontWeight: 800, color: "#9333ea" }}>1회</span>
              </div>
            </div>
          </div>

          {/* Column 3: Big Metrics Chart & Disease Risk */}
          <div className="sp-v4-col">
            <div className="sp-v4-card">
              <div className="sp-v4-card-title">
                <span>주요 혈압 추세 (4개월)</span>
                <span style={{ fontSize: "24px", fontWeight: 900, color: "var(--sp-primary)" }}>128/84</span>
              </div>
              <div style={{ height: "160px", width: "100%", marginTop: "10px" }}>
                <svg viewBox="0 0 320 130" style={{ width: "100%", height: "100%" }}>
                  <line x1="20" y1="20" x2="300" y2="20" stroke="#f1f5f9" strokeDasharray="3 3" />
                  <line x1="20" y1="60" x2="300" y2="60" stroke="#f1f5f9" strokeDasharray="3 3" />
                  <line x1="20" y1="100" x2="300" y2="100" stroke="#f1f5f9" strokeDasharray="3 3" />
                  <path d="M30,55 Q80,68 130,62 T210,56 T290,52" fill="none" stroke="#3b82f6" strokeWidth="3.5" />
                  <path d="M30,88 Q80,95 130,90 T210,89 T290,84" fill="none" stroke="#22c55e" strokeWidth="3.5" />
                  <circle cx="290" cy="52" r="5" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
                  <circle cx="290" cy="84" r="5" fill="#22c55e" stroke="#fff" strokeWidth="2" />
                  <text x="30" y="125" fontSize="11" fill="#94a3b8" fontWeight="700">1월</text>
                  <text x="115" y="125" fontSize="11" fill="#94a3b8" fontWeight="700">2월</text>
                  <text x="200" y="125" fontSize="11" fill="#94a3b8" fontWeight="700">3월</text>
                  <text x="285" y="125" fontSize="11" fill="#94a3b8" fontWeight="700">4월</text>
                </svg>
              </div>
            </div>

            <div className="sp-v4-card">
              <div className="sp-v4-card-title">만성질환 AI 선별 위험도</div>
              <div className="sp-risk-list">
                <div className="sp-risk-row" style={{ padding: "14px" }}>
                  <div className="sp-risk-left"><span style={{ fontSize: "20px" }}>❤️</span><strong style={{ fontSize: "16px" }}>고혈압 선별</strong></div>
                  <Badge variant="warning">주의 단계</Badge>
                </div>
                <div className="sp-risk-row" style={{ padding: "14px" }}>
                  <div className="sp-risk-left"><span style={{ fontSize: "20px" }}>💧</span><strong style={{ fontSize: "16px" }}>당뇨 선별</strong></div>
                  <Badge variant="safe">정상 상태</Badge>
                </div>
              </div>
            </div>
          </div>

          {/* Column 4: Pain Progress & Bomi AI Family Daily Summary */}
          <div className="sp-v4-col">
            <div className="sp-v4-card">
              <div className="sp-v4-card-title">
                <span>통증 모니터링 (무릎)</span>
                <span className="sp-pain-bubble">완화 추세</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", margin: "16px 0" }}>
                <div style={{ fontSize: "40px" }}>🦵</div>
                <div>
                  <div style={{ fontSize: "14px", color: "#64748b" }}>통증 강도 스케일</div>
                  <div style={{ fontSize: "32px", fontWeight: 900 }}>5 → <span style={{ color: "#16a34a" }}>3</span></div>
                </div>
                <Badge variant="safe">3일 연속 완화</Badge>
              </div>
            </div>

            <div className="sp-bomi-card" style={{ padding: "24px", borderRadius: "18px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "14px", marginBottom: "12px" }}>
                <div className="sp-bomi-avatar" style={{ width: "52px", height: "52px", fontSize: "26px" }}>🤖</div>
                <div>
                  <strong style={{ fontSize: "18px" }}>봄이의 가족 건강 총평</strong>
                  <small style={{ color: "#bfdbfe" }}>2025.04.24 저녁 종합 리포트</small>
                </div>
              </div>
              <p style={{ margin: 0, fontSize: "14px", lineHeight: 1.6, color: "#f0f9ff" }}>
                "오늘 가족 구성원의 챌린지 달성률이 우수합니다. 아빠의 혈압 상승세가 관찰되오니 오늘 저녁 식단은 저염식으로 권장해 드립니다. 밤 8시 혈압약 복용 알림을 거실 스크린에 띄워드릴게요!"
              </p>
              <div style={{ marginTop: "16px" }}>
                <Button variant="secondary" style={{ background: "rgba(255,255,255,0.2)", color: "#ffffff", width: "100%", border: "none" }}>
                  가족 스마트폰으로 알림 전송 🔔
                </Button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
export default UiPreview4Page;
