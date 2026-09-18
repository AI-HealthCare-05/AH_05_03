import { useState } from "react";
import { Link } from "react-router-dom";

import { Avatar } from "../components/ui/Avatar";
import { Badge } from "../components/ui/Badge";
import { Button } from "../components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "../components/ui/Card";
import { Progress } from "../components/ui/Progress";
import { Tabs, TabsList, TabsTrigger } from "../components/ui/Tabs";
import { VariantBar } from "../components/VariantBar";
import "../styles/shadcn-preview.css";
import "../styles/shadcn-preview-variants.css";

export function UiPreview1Page() {
  const [selectedMember, setSelectedMember] = useState("me");
  const [activeTab, setActiveTab] = useState<"bp" | "bs" | "weight">("bp");
  const [chatMessages, setChatMessages] = useState([
    { sender: "bomi", text: "안녕하세요! 오늘 가족 건강 상태를 분석해 드릴까요?" },
    { sender: "user", text: "아빠 혈압이 지난달보다 얼마나 오른 거야?" },
    { sender: "bomi", text: "아빠의 최근 수축기 혈압은 138mmHg로 지난달(128mmHg) 대비 10mmHg 올랐어요. 저염식과 유산소 운동 알림을 챙겨드릴게요!" },
  ]);
  const [inputVal, setInputVal] = useState("");

  const handleSend = () => {
    if (!inputVal.trim()) return;
    setChatMessages((prev) => [...prev, { sender: "user", text: inputVal }]);
    setInputVal("");
    setTimeout(() => {
      setChatMessages((prev) => [
        ...prev,
        { sender: "bomi", text: "건강기록에 바로 반영하고 주의 리포트를 작성했습니다. 언제든 더 물어보세요!" },
      ]);
    }, 600);
  };

  return (
    <div className="shadcn-preview-root">
      <VariantBar current="v1" />

      {/* Header */}
      <header className="sp-header">
        <div className="sp-header-inner">
          <div className="sp-brand">
            <div className="sp-brand-logo">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none">
                <path d="M16 28C16 28 4 20 4 11.5C4 7.5 7.5 4 11.5 4C13.8 4 15.3 5.2 16 6.2C16.7 5.2 18.2 4 20.5 4C24.5 4 28 7.5 28 11.5C28 20 16 28 16 28Z" stroke="#1d4fb8" strokeWidth="2.5" />
                <circle cx="11.5" cy="12.5" r="1.8" fill="#1d4fb8" />
                <circle cx="20.5" cy="12.5" r="1.8" fill="#1d4fb8" />
                <path d="M13.5 16.5C14.2 17.3 15.1 17.8 16 17.8C16.9 17.8 17.8 17.3 18.5 16.5" stroke="#1d4fb8" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <span className="sp-brand-title">이어봄</span>
              <span className="sp-brand-slogan">시안 1: 3분할 와이드 워크스페이스</span>
            </div>
          </div>

          <nav className="sp-nav">
            <button type="button" className="sp-nav-item active">가족 홈</button>
            <Link to="/pain-diary" className="sp-nav-item">통증 다이어리</Link>
            <Link to="/assessment" className="sp-nav-item">위험 판정</Link>
            <Link to="/challenge" className="sp-nav-item">챌린지</Link>
            <Link to="/health-data" className="sp-nav-item">건강 현황</Link>
          </nav>

          <div className="sp-header-actions">
            <div className="sp-user-profile">
              <div className="sp-avatar-sm" style={{ background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center" }}>👨‍🦰</div>
              <span className="sp-user-name">나 (관리자)</span>
            </div>
          </div>
        </div>
      </header>

      {/* 3-Panel Main Layout */}
      <div className="sp-v1-layout">
        {/* Left Panel: Family Members & Live Alert Stream */}
        <aside className="sp-v1-left-panel">
          <Card>
            <CardHeader>
              <CardTitle>가족 구성원</CardTitle>
              <span style={{ fontSize: "12px", color: "var(--sp-primary)", fontWeight: 700 }}>4명</span>
            </CardHeader>
            <CardContent style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {[
                { id: "me", name: "나", role: "본인", icon: "👨‍🦰", status: "safe", desc: "정상 안정" },
                { id: "dad", name: "아빠", role: "부", icon: "👴", status: "warn", desc: "혈압 주의" },
                { id: "mom", name: "엄마", role: "모", icon: "👩", status: "warn", desc: "혈당 주의" },
                { id: "bro", name: "동생", role: "자녀", icon: "👦", status: "safe", desc: "활동 활발" },
              ].map((m) => (
                <div
                  key={m.id}
                  className={`sp-v1-member-card ${selectedMember === m.id ? "is-active" : ""}`}
                  onClick={() => setSelectedMember(m.id)}
                  tabIndex={0}
                  role="button"
                >
                  <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
                    <Avatar status={m.status as "safe" | "warn"}>{m.icon}</Avatar>
                    <div>
                      <strong style={{ fontSize: "14px", display: "block" }}>{m.name}</strong>
                      <small style={{ color: "#64748b" }}>{m.role}</small>
                    </div>
                  </div>
                  <Badge variant={m.status === "safe" ? "safe" : "warning"}>{m.desc}</Badge>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>실시간 건강 피드</CardTitle>
            </CardHeader>
            <CardContent className="sp-v1-stream-feed">
              <div className="sp-v1-feed-item warning">
                <strong style={{ color: "#b45309" }}>⚠️ 아빠 혈압 경고</strong>
                <p style={{ margin: "4px 0 0", color: "#475569" }}>수축기 138/88 mmHg 기록 (08:12)</p>
              </div>
              <div className="sp-v1-feed-item">
                <strong style={{ color: "#1d4fb8" }}>💊 엄마 복약 완료</strong>
                <p style={{ margin: "4px 0 0", color: "#475569" }}>혈당 조절약 복용 체크됨 (08:00)</p>
              </div>
              <div className="sp-v1-feed-item">
                <strong style={{ color: "#16a34a" }}>🏃 나 운동 기록</strong>
                <p style={{ margin: "4px 0 0", color: "#475569" }}>아침 조깅 3.2km 달성 (07:30)</p>
              </div>
            </CardContent>
          </Card>
        </aside>

        {/* Center Panel: Main Core Dashboard */}
        <main style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
          {/* Banner */}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", background: "#ffffff", padding: "20px 28px", borderRadius: "16px", border: "1px solid var(--sp-border)" }}>
            <div>
              <h1 style={{ fontSize: "24px", fontWeight: 800, margin: "0 0 4px" }}>오늘 우리 가족 건강 현황</h1>
              <span style={{ color: "#64748b", fontSize: "14px" }}>2025년 4월 24일 (목) · 43인치 3분할 통합 관제 모드</span>
            </div>
            <div style={{ display: "flex", gap: "10px" }}>
              <Button variant="secondary">리포트 다운로드</Button>
              <Button variant="primary">기록 추가 +</Button>
            </div>
          </div>

          {/* Top Alerts & Family Summary Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1.1fr 0.9fr", gap: "20px" }}>
            <div className="sp-card sp-alert-card">
              <div className="sp-alert-header">
                <div className="sp-alert-icon-wrap">!</div>
                <span className="sp-alert-title">주의가 필요한 변화 2개</span>
              </div>
              <div className="sp-alert-body">
                <div className="sp-alert-list">
                  <div className="sp-alert-item">
                    <div className="sp-alert-item-left">
                      <div className="sp-avatar-circle">👴</div>
                      <span className="sp-alert-item-text"><strong>아빠</strong> 혈압이 지난달보다 높아졌어요</span>
                    </div>
                    <span className="sp-arrow-icon">›</span>
                  </div>
                  <div className="sp-alert-item">
                    <div className="sp-alert-item-left">
                      <div className="sp-avatar-circle">👩</div>
                      <span className="sp-alert-item-text"><strong>엄마</strong> 공복혈당이 주의 범위예요</span>
                    </div>
                    <span className="sp-arrow-icon">›</span>
                  </div>
                </div>
                <Button variant="alertCta">자세히 보기 →</Button>
              </div>
            </div>

            <Card>
              <CardHeader>
                <CardTitle>우리 가족 건강 상태</CardTitle>
                <Button variant="link">가족 관리 &gt;</Button>
              </CardHeader>
              <CardContent>
                <div className="sp-family-row">
                  <div className="sp-family-member"><Avatar status="safe">👨‍🦰</Avatar><span className="sp-member-name">나</span><span className="sp-member-status-desc safe">건강해요</span></div>
                  <div className="sp-family-member"><Avatar status="warn">👴</Avatar><span className="sp-member-name">아빠</span><span className="sp-member-status-desc warn">주의 필요</span></div>
                  <div className="sp-family-member"><Avatar status="warn">👩</Avatar><span className="sp-member-name">엄마</span><span className="sp-member-status-desc warn">주의 필요</span></div>
                  <div className="sp-family-member"><Avatar status="safe">👦</Avatar><span className="sp-member-name">동생</span><span className="sp-member-status-desc safe">건강해요</span></div>
                </div>
              </CardContent>
            </Card>
          </div>

          {/* Middle 3 Cards Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1.4fr 0.9fr 1fr", gap: "20px" }}>
            <Card>
              <CardHeader>
                <div>
                  <CardTitle>주요 건강지표 변화</CardTitle>
                  <CardDescription>최근 3개월간의 변화를 한눈에 확인하세요.</CardDescription>
                </div>
                <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "bp" | "bs" | "weight")}>
                  <TabsList>
                    <TabsTrigger value="bp">혈압</TabsTrigger>
                    <TabsTrigger value="bs">혈당</TabsTrigger>
                    <TabsTrigger value="weight">체중</TabsTrigger>
                  </TabsList>
                </Tabs>
              </CardHeader>
              <CardContent>
                <div className="sp-chart-body">
                  <div className="sp-metric-summary">
                    <span className="sp-metric-label">최근 혈압</span>
                    <div className="sp-metric-value-wrap">
                      <span className="sp-metric-big">128/84</span>
                      <span className="sp-metric-unit">mmHg</span>
                    </div>
                    <span className="sp-metric-diff-badge">▲ 지난달보다 +6</span>
                    <span className="sp-metric-diff-sub">(122/78 → 128/84)</span>
                  </div>
                  <div className="sp-chart-area">
                    <svg viewBox="0 0 320 120" style={{ width: "100%", height: "100%" }}>
                      <line x1="28" y1="20" x2="300" y2="20" stroke="#f1f5f9" strokeDasharray="3 3" />
                      <line x1="28" y1="60" x2="300" y2="60" stroke="#f1f5f9" strokeDasharray="3 3" />
                      <line x1="28" y1="100" x2="300" y2="100" stroke="#f1f5f9" strokeDasharray="3 3" />
                      <path d="M40,55 Q80,68 120,62 T200,56 T280,52" fill="none" stroke="#3b82f6" strokeWidth="2.5" />
                      <path d="M40,88 Q80,95 120,90 T200,89 T280,84" fill="none" stroke="#22c55e" strokeWidth="2.5" />
                      <circle cx="280" cy="52" r="4" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
                      <circle cx="280" cy="84" r="4" fill="#22c55e" stroke="#fff" strokeWidth="2" />
                      <text x="40" y="118" fontSize="11" fill="#94a3b8">1월</text>
                      <text x="120" y="118" fontSize="11" fill="#94a3b8">2월</text>
                      <text x="200" y="118" fontSize="11" fill="#94a3b8">3월</text>
                      <text x="280" y="118" fontSize="11" fill="#94a3b8">4월</text>
                    </svg>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>만성질환 위험도</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="sp-risk-list">
                  <div className="sp-risk-row">
                    <div className="sp-risk-left"><span>❤️</span><span>고혈압</span></div>
                    <Badge variant="warning">주의</Badge>
                  </div>
                  <div className="sp-risk-row">
                    <div className="sp-risk-left"><span>💧</span><span>당뇨</span></div>
                    <Badge variant="safe">정상</Badge>
                  </div>
                </div>
                <Button variant="secondary">위험도 분석 보기 →</Button>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>오늘의 챌린지</CardTitle>
                <span style={{ fontSize: "12px", color: "var(--sp-primary)", fontWeight: 700 }}>2/3 달성</span>
              </CardHeader>
              <CardContent>
                <Progress value={66} />
                <div className="sp-challenge-list" style={{ marginTop: "12px" }}>
                  <div className="sp-challenge-item"><span style={{ fontWeight: 600 }}>✓ 20분 걷기</span><span className="sp-status-green">완료</span></div>
                  <div className="sp-challenge-item"><span style={{ fontWeight: 600 }}>✓ 물 6잔</span><span className="sp-status-green">완료</span></div>
                  <div className="sp-challenge-item"><span style={{ fontWeight: 600 }}>○ 복약 확인</span><span className="sp-status-sub">미완료</span></div>
                </div>
                <Button variant="primary" style={{ marginTop: "10px" }}>계속하기 →</Button>
              </CardContent>
            </Card>
          </div>

          {/* Bottom Grid */}
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "20px" }}>
            <Card>
              <CardHeader><CardTitle>통증 기록 &gt;</CardTitle></CardHeader>
              <CardContent>
                <div className="sp-pain-body">
                  <div className="sp-pain-left">
                    <div className="sp-pain-illustration">🦵</div>
                    <div className="sp-pain-score-wrap">
                      <span className="sp-pain-label">무릎 통증</span>
                      <span className="sp-pain-score">5 → <strong>3</strong></span>
                      <span className="sp-pain-capsule">3일 연속 기록</span>
                    </div>
                  </div>
                  <span className="sp-pain-bubble">통증 감소 중!</span>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>운동 요약</CardTitle></CardHeader>
              <CardContent>
                <div className="sp-exercise-list">
                  <div className="sp-exercise-item"><div className="sp-exercise-left"><div className="sp-exercise-icon-wrap sp-icon-running">🏃</div><div className="sp-exercise-info"><strong>러닝</strong><small>2회 · 60분</small></div></div><span className="sp-arrow-icon">›</span></div>
                  <div className="sp-exercise-item"><div className="sp-exercise-left"><div className="sp-exercise-icon-wrap sp-icon-strength">🏋️</div><div className="sp-exercise-info"><strong>근력운동</strong><small>1회 · 32분</small></div></div><span className="sp-arrow-icon">›</span></div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle>최근 건강기록 &gt;</CardTitle></CardHeader>
              <CardContent>
                <div className="sp-recent-list">
                  <div className="sp-recent-item"><div className="sp-recent-left"><span>❤️</span><strong>혈압 측정</strong></div><div className="sp-recent-right"><span>128/84</span></div></div>
                  <div className="sp-recent-item"><div className="sp-recent-left"><span>💊</span><strong>약 복용</strong></div><div className="sp-recent-right"><span>08:00</span></div></div>
                  <div className="sp-recent-item"><div className="sp-recent-left"><span>🏃</span><strong>조깅 완료</strong></div><div className="sp-recent-right"><span>3.2km</span></div></div>
                </div>
              </CardContent>
            </Card>
          </div>
        </main>

        {/* Right Panel: Bomi AI Assistant Live Chat & Quick Anatomy Finder */}
        <aside className="sp-v1-right-panel">
          <div className="sp-body-find-card">
            <div className="sp-body-find-left">
              <strong>아픈 부위 3D 핀포인트</strong>
              <small>인체 모델에서 직접 선택</small>
            </div>
            <div className="sp-body-find-right">
              <svg className="sp-body-silhouette" viewBox="0 0 40 60" fill="none" stroke="currentColor">
                <circle cx="20" cy="10" r="5" strokeWidth="1.5" />
                <path d="M12 20C14 18 16 18 20 18C24 18 26 18 28 20L31 34L26 35L24 24V40L25 54H21L20 42L19 54H15L16 40V24L14 35L9 34L12 20Z" strokeWidth="1.5" />
              </svg>
            </div>
          </div>

          <div className="sp-v1-chat-widget">
            <div className="sp-v1-chat-header">
              <div style={{ width: "36px", height: "36px", borderRadius: "50%", background: "#fff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "20px" }}>🤖</div>
              <div>
                <strong style={{ fontSize: "15px", display: "block" }}>봄이 AI 건강비서</strong>
                <small style={{ color: "#bfdbfe" }}>가족 맞춤형 상시 지원 중</small>
              </div>
            </div>
            <div className="sp-v1-chat-body">
              {chatMessages.map((m, idx) => (
                <div key={idx} className={`sp-v1-msg ${m.sender}`}>
                  {m.text}
                </div>
              ))}
            </div>
            <div className="sp-v1-chat-input-bar">
              <input
                type="text"
                placeholder="건강에 대해 무엇이든 물어보세요..."
                className="sp-v1-chat-input"
                value={inputVal}
                onChange={(e) => setInputVal(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSend()}
              />
              <Button size="sm" onClick={handleSend}>전송</Button>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}
export default UiPreview1Page;
