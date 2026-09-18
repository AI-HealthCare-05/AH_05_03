import { useState } from "react";
import { Link } from "react-router-dom";

import { Avatar } from "./components/ui/Avatar";
import { Badge } from "./components/ui/Badge";
import { Button } from "./components/ui/Button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./components/ui/Card";
import { Progress } from "./components/ui/Progress";
import { Tabs, TabsList, TabsTrigger } from "./components/ui/Tabs";
import { VariantBar } from "./components/VariantBar";
import "./styles/shadcn-preview.css";
import "./styles/shadcn-preview-variants.css";

interface ChallengeItem {
  id: string;
  title: string;
  sub?: string;
  completed: boolean;
}

export function UiPreviewPage() {
  const [activeTab, setActiveTab] = useState<"bp" | "bs" | "weight">("bp");
  const [challenges, setChallenges] = useState<ChallengeItem[]>([
    { id: "walk", title: "20분 걷기", completed: true },
    { id: "water", title: "물 6잔", completed: true },
    { id: "med", title: "복약 확인", sub: "오늘도 잊지 마세요!", completed: false },
  ]);

  const toggleChallenge = (id: string) => {
    setChallenges((prev) =>
      prev.map((item) => (item.id === id ? { ...item, completed: !item.completed } : item)),
    );
  };

  const completedCount = challenges.filter((c) => c.completed).length;
  const challengeProgress = Math.round((completedCount / challenges.length) * 100);

  return (
    <div className="shadcn-preview-root">
      <VariantBar current="default" />
      {/* 1. Header (GNB) */}
      <header className="sp-header">
        <div className="sp-header-inner">
          <div className="sp-brand">
            <div className="sp-brand-logo">
              <svg width="32" height="32" viewBox="0 0 32 32" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                  d="M16 28C16 28 4 20 4 11.5C4 7.5 7.5 4 11.5 4C13.8 4 15.3 5.2 16 6.2C16.7 5.2 18.2 4 20.5 4C24.5 4 28 7.5 28 11.5C28 20 16 28 16 28Z"
                  stroke="#1d4fb8"
                  strokeWidth="2.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
                <circle cx="11.5" cy="12.5" r="1.8" fill="#1d4fb8" />
                <circle cx="20.5" cy="12.5" r="1.8" fill="#1d4fb8" />
                <path d="M13.5 16.5C14.2 17.3 15.1 17.8 16 17.8C16.9 17.8 17.8 17.3 18.5 16.5" stroke="#1d4fb8" strokeWidth="2" strokeLinecap="round" />
              </svg>
            </div>
            <div>
              <span className="sp-brand-title">이어봄</span>
              <span className="sp-brand-slogan">오늘도, 함께 더 건강하게</span>
            </div>
          </div>

          <nav className="sp-nav" aria-label="주 메뉴">
            <button type="button" className="sp-nav-item active">
              가족 홈
            </button>
            <Link to="/pain-diary" className="sp-nav-item">
              통증 다이어리
            </Link>
            <Link to="/assessment" className="sp-nav-item">
              위험 판정
            </Link>
            <Link to="/challenge" className="sp-nav-item">
              챌린지
            </Link>
            <Link to="/health-data" className="sp-nav-item">
              건강 현황
            </Link>
          </nav>

          <div className="sp-header-actions">
            <button type="button" className="sp-icon-btn" aria-label="검색">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
            </button>
            <button type="button" className="sp-icon-btn" aria-label="알림">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
                <path d="M13.73 21a2 2 0 0 1-3.46 0" />
              </svg>
              <span className="sp-badge-dot" />
            </button>
            <div className="sp-user-profile">
              <div className="sp-avatar-sm" style={{ background: "#e0e7ff", display: "flex", alignItems: "center", justifyContent: "center", fontSize: "16px" }}>
                👨‍🦰
              </div>
              <span className="sp-user-name">나</span>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#64748b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="6 9 12 15 18 9" />
              </svg>
            </div>
          </div>
        </div>
      </header>

      {/* 2. Main Container */}
      <main className="sp-main-container">
        {/* Top Banner Title */}
        <section className="sp-top-banner">
          <div className="sp-top-title-group">
            <h1>오늘 우리 가족 건강은 이래요</h1>
            <span className="sp-date-badge">2025년 4월 24일 (목)</span>
          </div>
          <div className="sp-motto">
            <span>
              가족의 건강한 오늘이<br />
              더 밝은 내일을 만듭니다.
            </span>
            <svg className="sp-motto-leaf" viewBox="0 0 36 36" fill="currentColor">
              <path d="M18 3C18 3 9 9 9 18C9 23 13 27 18 27C23 27 27 23 27 18C27 9 18 3 18 3ZM18 25C14.1 25 11 21.9 11 18C11 11.8 16.2 7 18 5.2C19.8 7 25 11.8 25 18C25 21.9 21.9 25 18 25Z" />
              <path d="M18 10V25" stroke="#ffffff" strokeWidth="2" strokeLinecap="round" />
            </svg>
          </div>
        </section>

        {/* 3. Top Grid (Alerts & Family Status) */}
        <section className="sp-grid-top">
          {/* Card 1: Alert Card */}
          <div className="sp-card sp-alert-card">
            <div className="sp-alert-header">
              <div className="sp-alert-icon-wrap" aria-hidden="true">
                !
              </div>
              <span className="sp-alert-title">주의가 필요한 변화 2개</span>
            </div>
            <div className="sp-alert-body">
              <div className="sp-alert-list">
                <div className="sp-alert-item" tabIndex={0} role="button">
                  <div className="sp-alert-item-left">
                    <div className="sp-avatar-circle">👴</div>
                    <span className="sp-alert-item-text">
                      <strong>아빠</strong> 혈압이 지난달보다 높아졌어요
                    </span>
                  </div>
                  <span className="sp-arrow-icon" aria-hidden="true">
                    ›
                  </span>
                </div>
                <div className="sp-alert-item" tabIndex={0} role="button">
                  <div className="sp-alert-item-left">
                    <div className="sp-avatar-circle">👩</div>
                    <span className="sp-alert-item-text">
                      <strong>엄마</strong> 공복혈당이 주의 범위예요
                    </span>
                  </div>
                  <span className="sp-arrow-icon" aria-hidden="true">
                    ›
                  </span>
                </div>
              </div>
              <Button variant="alertCta">
                변화 자세히 보기 <span>→</span>
              </Button>
            </div>
          </div>

          {/* Card 2: Family Status Card */}
          <Card>
            <CardHeader>
              <CardTitle>우리 가족 건강 상태</CardTitle>
              <Button variant="link">가족 관리 &gt;</Button>
            </CardHeader>
            <CardContent>
              <div className="sp-family-row">
                <div className="sp-family-member">
                  <Avatar status="safe">👨‍🦰</Avatar>
                  <span className="sp-member-name">나</span>
                  <span className="sp-member-status-desc safe">건강해요</span>
                </div>
                <div className="sp-family-member">
                  <Avatar status="warn">👴</Avatar>
                  <span className="sp-member-name">아빠</span>
                  <span className="sp-member-status-desc warn">주의가 필요해요</span>
                </div>
                <div className="sp-family-member">
                  <Avatar status="warn">👩</Avatar>
                  <span className="sp-member-name">엄마</span>
                  <span className="sp-member-status-desc warn">주의가 필요해요</span>
                </div>
                <div className="sp-family-member">
                  <Avatar status="safe">👦</Avatar>
                  <span className="sp-member-name">동생</span>
                  <span className="sp-member-status-desc safe">건강해요</span>
                </div>
              </div>
            </CardContent>
          </Card>
        </section>

        {/* 4. Middle Grid (Metrics, Risk, Challenge) */}
        <section className="sp-grid-middle">
          {/* Card 1: Main Metric Trends */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>주요 건강지표 변화</CardTitle>
                <CardDescription>최근 3개월간의 변화를 한눈에 확인하세요.</CardDescription>
              </div>
              <Tabs value={activeTab} onValueChange={(val) => setActiveTab(val as "bp" | "bs" | "weight")}>
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
                  <span className="sp-metric-label">
                    {activeTab === "bp" ? "최근 혈압" : activeTab === "bs" ? "공복 혈당" : "현재 체중"}
                  </span>
                  <div className="sp-metric-value-wrap">
                    <span className="sp-metric-big">
                      {activeTab === "bp" ? "128/84" : activeTab === "bs" ? "112" : "68.4"}
                    </span>
                    <span className="sp-metric-unit">
                      {activeTab === "bp" ? "mmHg" : activeTab === "bs" ? "mg/dL" : "kg"}
                    </span>
                  </div>
                  <span className="sp-metric-diff-badge">
                    ▲ 지난달보다 {activeTab === "bp" ? "+6" : activeTab === "bs" ? "+8" : "-0.8"}
                  </span>
                  <span className="sp-metric-diff-sub">
                    {activeTab === "bp" ? "(122/78 → 128/84)" : activeTab === "bs" ? "(104 → 112)" : "(69.2 → 68.4)"}
                  </span>
                </div>

                <div className="sp-chart-area">
                  <div className="sp-chart-legend">
                    <span>
                      <span className="sp-legend-dot" style={{ background: "#3b82f6" }} />
                      수축기
                    </span>
                    <span>
                      <span className="sp-legend-dot" style={{ background: "#22c55e" }} />
                      이완기
                    </span>
                  </div>
                  {/* SVG Chart with Smooth Line & Markers */}
                  <svg viewBox="0 0 320 120" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                    {/* Grid horizontal lines */}
                    <line x1="28" y1="20" x2="300" y2="20" stroke="#f1f5f9" strokeDasharray="3 3" />
                    <line x1="28" y1="50" x2="300" y2="50" stroke="#f1f5f9" strokeDasharray="3 3" />
                    <line x1="28" y1="80" x2="300" y2="80" stroke="#f1f5f9" strokeDasharray="3 3" />
                    <line x1="28" y1="110" x2="300" y2="110" stroke="#f1f5f9" strokeDasharray="3 3" />

                    {/* Y Axis Labels */}
                    <text x="5" y="24" fontSize="11" fill="#94a3b8" fontWeight="600">180</text>
                    <text x="5" y="54" fontSize="11" fill="#94a3b8" fontWeight="600">140</text>
                    <text x="5" y="84" fontSize="11" fill="#94a3b8" fontWeight="600">100</text>
                    <text x="10" y="114" fontSize="11" fill="#94a3b8" fontWeight="600">60</text>

                    {/* Blue line (Systolic) */}
                    <path
                      d="M40,55 Q80,68 120,62 T200,56 T280,52"
                      fill="none"
                      stroke="#3b82f6"
                      strokeWidth="2.5"
                    />
                    <circle cx="40" cy="55" r="3" fill="#3b82f6" />
                    <circle cx="120" cy="62" r="3" fill="#3b82f6" />
                    <circle cx="200" cy="56" r="3" fill="#3b82f6" />
                    <circle cx="280" cy="52" r="4" fill="#3b82f6" stroke="#ffffff" strokeWidth="2" />
                    {/* Value Badge on last point */}
                    <rect x="268" y="30" width="28" height="18" rx="4" fill="#3b82f6" />
                    <text x="282" y="42" fontSize="11" fill="#ffffff" fontWeight="700" textAnchor="middle">128</text>

                    {/* Green line (Diastolic) */}
                    <path
                      d="M40,88 Q80,95 120,90 T200,89 T280,84"
                      fill="none"
                      stroke="#22c55e"
                      strokeWidth="2.5"
                    />
                    <circle cx="40" cy="88" r="3" fill="#22c55e" />
                    <circle cx="120" cy="90" r="3" fill="#22c55e" />
                    <circle cx="200" cy="89" r="3" fill="#22c55e" />
                    <circle cx="280" cy="84" r="4" fill="#22c55e" stroke="#ffffff" strokeWidth="2" />
                    {/* Value Badge on last point */}
                    <rect x="271" y="93" width="22" height="18" rx="4" fill="#22c55e" />
                    <text x="282" y="105" fontSize="11" fill="#ffffff" fontWeight="700" textAnchor="middle">84</text>

                    {/* X Axis Labels */}
                    <text x="40" y="122" fontSize="11" fill="#94a3b8" fontWeight="600" textAnchor="middle">1월</text>
                    <text x="120" y="122" fontSize="11" fill="#94a3b8" fontWeight="600" textAnchor="middle">2월</text>
                    <text x="200" y="122" fontSize="11" fill="#94a3b8" fontWeight="600" textAnchor="middle">3월</text>
                    <text x="280" y="122" fontSize="11" fill="#94a3b8" fontWeight="600" textAnchor="middle">4월</text>
                  </svg>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Chronic Disease Risk */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>만성질환 위험도</CardTitle>
                <CardDescription>최근 검사결과를 기반으로 한 예측 위험도예요.</CardDescription>
              </div>
            </CardHeader>
            <CardContent>
              <div className="sp-risk-list">
                <div className="sp-risk-row" tabIndex={0} role="button">
                  <div className="sp-risk-left">
                    <span className="sp-risk-icon-heart" aria-hidden="true">❤️</span>
                    <span>고혈압</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Badge variant="warning">주의</Badge>
                    <span className="sp-arrow-icon" aria-hidden="true">›</span>
                  </div>
                </div>

                <div className="sp-risk-row" tabIndex={0} role="button">
                  <div className="sp-risk-left">
                    <span className="sp-risk-icon-drop" aria-hidden="true">💧</span>
                    <span>당뇨</span>
                  </div>
                  <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                    <Badge variant="safe">정상</Badge>
                    <span className="sp-arrow-icon" aria-hidden="true">›</span>
                  </div>
                </div>
              </div>

              <Button variant="secondary">
                위험도 분석 보기 <span>→</span>
              </Button>
            </CardContent>
          </Card>

          {/* Card 3: Today's Challenge */}
          <Card>
            <CardHeader>
              <div>
                <CardTitle>오늘의 챌린지 &gt;</CardTitle>
                <CardDescription>오늘도 조금씩, 더 건강한 하루!</CardDescription>
              </div>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--sp-primary)" }}>
                {completedCount}/{challenges.length} 달성
              </span>
            </CardHeader>
            <CardContent>
              <Progress value={challengeProgress} />

              <div className="sp-challenge-list">
                {challenges.map((item) => (
                  <div
                    key={item.id}
                    className="sp-challenge-item"
                    role="checkbox"
                    aria-checked={item.completed}
                    tabIndex={0}
                    onClick={() => toggleChallenge(item.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        toggleChallenge(item.id);
                      }
                    }}
                  >
                    <div className="sp-check-label">
                      <div className={`sp-checkbox-custom ${item.completed ? "checked" : ""}`}>
                        {item.completed ? "✓" : ""}
                      </div>
                      <span>{item.title}</span>
                    </div>
                    {item.completed ? (
                      <span className="sp-status-green">완료</span>
                    ) : (
                      <span className="sp-status-sub">{item.sub}</span>
                    )}
                  </div>
                ))}
              </div>

              <Button variant="primary">
                계속하기 <span>→</span>
              </Button>
            </CardContent>
          </Card>
        </section>

        {/* 5. Bottom Grid (Pain, Exercise, Recent Records, Quick AI) */}
        <section className="sp-grid-bottom">
          {/* Card 1: Pain Diary */}
          <Card>
            <CardHeader>
              <CardTitle>통증 기록 &gt;</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="sp-pain-body">
                <div className="sp-pain-left">
                  <div className="sp-pain-illustration" aria-hidden="true">
                    🦵
                  </div>
                  <div className="sp-pain-score-wrap">
                    <span className="sp-pain-label">무릎 통증</span>
                    <span className="sp-pain-score">
                      5 → <strong>3</strong>
                    </span>
                    <span className="sp-pain-capsule">3일 연속 기록</span>
                  </div>
                </div>

                <div className="sp-pain-right">
                  <span className="sp-pain-bubble">통증 점수가 낮아지고 있어요!</span>
                  <div className="sp-pain-mini-chart">
                    <svg viewBox="0 0 110 40" style={{ width: "100%", height: "100%" }}>
                      <path
                        d="M5,15 Q30,22 55,28 T105,32"
                        fill="none"
                        stroke="#22c55e"
                        strokeWidth="2"
                      />
                      <circle cx="5" cy="15" r="2.5" fill="#22c55e" />
                      <circle cx="55" cy="28" r="2.5" fill="#22c55e" />
                      <circle cx="105" cy="32" r="3" fill="#22c55e" stroke="#ffffff" strokeWidth="1.5" />
                      <text x="5" y="38" fontSize="11" fill="#94a3b8">1월</text>
                      <text x="40" y="38" fontSize="11" fill="#94a3b8">2월</text>
                      <text x="75" y="38" fontSize="11" fill="#94a3b8">3월</text>
                      <text x="100" y="38" fontSize="11" fill="#94a3b8">4월</text>
                    </svg>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 2: Exercise */}
          <Card>
            <CardHeader>
              <CardTitle>운동</CardTitle>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--sp-primary)" }}>
                이번 주 3회 · 92분
              </span>
            </CardHeader>
            <CardContent>
              <div className="sp-exercise-list">
                <div className="sp-exercise-item" tabIndex={0} role="button">
                  <div className="sp-exercise-left">
                    <div className="sp-exercise-icon-wrap sp-icon-running">🏃</div>
                    <div className="sp-exercise-info">
                      <strong>러닝</strong>
                      <small>2회 · 60분 (평균 6.1km, 30분)</small>
                    </div>
                  </div>
                  <span className="sp-arrow-icon" aria-hidden="true">›</span>
                </div>

                <div className="sp-exercise-item" tabIndex={0} role="button">
                  <div className="sp-exercise-left">
                    <div className="sp-exercise-icon-wrap sp-icon-strength">🏋️</div>
                    <div className="sp-exercise-info">
                      <strong>근력운동</strong>
                      <small>1회 · 32분 (하체 중심 운동)</small>
                    </div>
                  </div>
                  <span className="sp-arrow-icon" aria-hidden="true">›</span>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 3: Recent Records */}
          <Card>
            <CardHeader>
              <CardTitle>최근 건강기록 &gt;</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="sp-recent-list">
                <div className="sp-recent-item" tabIndex={0} role="button">
                  <div className="sp-recent-left">
                    <span>❤️</span>
                    <strong>혈압 측정</strong>
                    <span>128/84 mmHg</span>
                  </div>
                  <div className="sp-recent-right">
                    <span>4월 24일 08:12</span>
                    <span className="sp-arrow-icon" aria-hidden="true">›</span>
                  </div>
                </div>

                <div className="sp-recent-item" tabIndex={0} role="button">
                  <div className="sp-recent-left">
                    <span>💊</span>
                    <strong>약 복용</strong>
                    <span>고혈압 약 1정</span>
                  </div>
                  <div className="sp-recent-right">
                    <span>4월 24일 08:00</span>
                    <span className="sp-arrow-icon" aria-hidden="true">›</span>
                  </div>
                </div>

                <div className="sp-recent-item" tabIndex={0} role="button">
                  <div className="sp-recent-left">
                    <span>🏃</span>
                    <strong>운동 기록</strong>
                    <span>러닝 30분 (6.1km)</span>
                  </div>
                  <div className="sp-recent-right">
                    <span>4월 23일 19:36</span>
                    <span className="sp-arrow-icon" aria-hidden="true">›</span>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Card 4: Quick Action & AI Assistant Split Column */}
          <div className="sp-quick-ai-col">
            {/* Pain Region Finder */}
            <div className="sp-body-find-card" tabIndex={0} role="button">
              <div className="sp-body-find-left">
                <strong>아픈 부위 찾기</strong>
                <small>어디가 불편하신가요?</small>
              </div>
              <div className="sp-body-find-right">
                <svg className="sp-body-silhouette" viewBox="0 0 40 60" fill="none" stroke="currentColor">
                  {/* Human Body Silhouette wireframe */}
                  <circle cx="20" cy="10" r="5" strokeWidth="1.5" />
                  <path d="M12 20C14 18 16 18 20 18C24 18 26 18 28 20L31 34L26 35L24 24V40L25 54H21L20 42L19 54H15L16 40V24L14 35L9 34L12 20Z" strokeWidth="1.5" />
                </svg>
                <span className="sp-arrow-icon" style={{ marginLeft: "4px" }} aria-hidden="true">›</span>
              </div>
            </div>

            {/* Bomi AI Assistant */}
            <div className="sp-bomi-card" tabIndex={0} role="button">
              <div className="sp-bomi-avatar" aria-hidden="true">
                🤖
              </div>
              <div className="sp-bomi-info">
                <strong>봄이에게 물어보기</strong>
                <small>건강이 궁금할 때, 언제든지!</small>
              </div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
export default UiPreviewPage;
