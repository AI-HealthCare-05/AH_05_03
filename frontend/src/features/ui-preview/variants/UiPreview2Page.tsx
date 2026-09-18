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

export function UiPreview2Page() {
  const [activeTab, setActiveTab] = useState<"bp" | "bs" | "weight">("bp");

  return (
    <div className="shadcn-preview-root">
      <VariantBar current="v2" />

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
              <span className="sp-brand-slogan">시안 2: 4K 유체 와이드 &amp; 12개월 연간 차트 모드</span>
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
              <span className="sp-user-name">나</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Wide Container */}
      <main className="sp-v2-container">
        {/* Banner */}
        <section className="sp-top-banner">
          <div className="sp-top-title-group">
            <h1 style={{ fontSize: "32px" }}>오늘 우리 가족 건강은 이래요</h1>
            <span className="sp-date-badge" style={{ fontSize: "16px" }}>2025년 4월 24일 (목) · 3840×2160 UHD 광폭 뷰</span>
          </div>
          <div className="sp-motto">
            <span style={{ fontSize: "15px" }}>가족의 건강한 오늘이<br />더 밝은 내일을 만듭니다.</span>
            <svg className="sp-motto-leaf" viewBox="0 0 36 36" fill="currentColor">
              <path d="M18 3C18 3 9 9 9 18C9 23 13 27 18 27C23 27 27 23 27 18C27 9 18 3 18 3ZM18 25C14.1 25 11 21.9 11 18C11 11.8 16.2 7 18 5.2C19.8 7 25 11.8 25 18C25 21.9 21.9 25 18 25Z" />
            </svg>
          </div>
        </section>

        {/* 4K Top High-Density 4 KPI Cards */}
        <section className="sp-v2-stat-row">
          <div className="sp-v2-stat-card">
            <span style={{ fontSize: "14px", color: "#64748b", fontWeight: 600 }}>최근 가족 혈압</span>
            <div className="val">128/84 <small style={{ fontSize: "16px", color: "#64748b" }}>mmHg</small></div>
            <Badge variant="warning">주의 (아빠 +10 상승)</Badge>
          </div>
          <div className="sp-v2-stat-card">
            <span style={{ fontSize: "14px", color: "#64748b", fontWeight: 600 }}>공복 혈당 (엄마)</span>
            <div className="val">112 <small style={{ fontSize: "16px", color: "#64748b" }}>mg/dL</small></div>
            <Badge variant="warning">경계성 범위</Badge>
          </div>
          <div className="sp-v2-stat-card">
            <span style={{ fontSize: "14px", color: "#64748b", fontWeight: 600 }}>오늘의 가족 챌린지</span>
            <div className="val">66.7% <small style={{ fontSize: "16px", color: "#64748b" }}>2/3 달성</small></div>
            <Badge variant="safe">정상 진행 중</Badge>
          </div>
          <div className="sp-v2-stat-card">
            <span style={{ fontSize: "14px", color: "#64748b", fontWeight: 600 }}>무릎 통증 점수</span>
            <div className="val">3 <small style={{ fontSize: "16px", color: "#16a34a" }}>↓ 2점 완화</small></div>
            <Badge variant="safe">3일 연속 완화</Badge>
          </div>
        </section>

        {/* Wide Grid: Alert & Family Status */}
        <section className="sp-v2-wide-grid">
          <div className="sp-card sp-alert-card">
            <div className="sp-alert-header">
              <div className="sp-alert-icon-wrap">!</div>
              <span className="sp-alert-title">주의가 필요한 변화 2개</span>
            </div>
            <div className="sp-alert-body">
              <div className="sp-alert-list">
                <div className="sp-alert-item">
                  <div className="sp-alert-item-left"><div className="sp-avatar-circle">👴</div><span className="sp-alert-item-text"><strong>아빠</strong> 혈압이 지난달보다 높아졌어요</span></div>
                  <span className="sp-arrow-icon">›</span>
                </div>
                <div className="sp-alert-item">
                  <div className="sp-alert-item-left"><div className="sp-avatar-circle">👩</div><span className="sp-alert-item-text"><strong>엄마</strong> 공복혈당이 주의 범위예요</span></div>
                  <span className="sp-arrow-icon">›</span>
                </div>
              </div>
              <Button variant="alertCta">변화 자세히 보기 →</Button>
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
        </section>

        {/* 12-Month Extended Full Wide Chart */}
        <Card style={{ marginBottom: "24px" }}>
          <CardHeader>
            <div>
              <CardTitle style={{ fontSize: "22px" }}>연간 주요 건강지표 12개월 추세 (4K 광대역 차트)</CardTitle>
              <CardDescription>43인치 대화면에서 1년 동안의 주기적 변화와 계절성 변동을 한눈에 분석합니다.</CardDescription>
            </div>
            <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "bp" | "bs" | "weight")}>
              <TabsList>
                <TabsTrigger value="bp">혈압 (수축/이완기)</TabsTrigger>
                <TabsTrigger value="bs">혈당 (공복/식후)</TabsTrigger>
                <TabsTrigger value="weight">체중 (BMI 추세)</TabsTrigger>
              </TabsList>
            </Tabs>
          </CardHeader>
          <CardContent>
            <div style={{ height: "220px", position: "relative", width: "100%", marginTop: "12px" }}>
              <svg viewBox="0 0 1000 200" style={{ width: "100%", height: "100%", overflow: "visible" }}>
                {/* Horizontal Guide Lines */}
                {[40, 80, 120, 160].map((y) => (
                  <line key={y} x1="40" y1={y} x2="980" y2={y} stroke="#f1f5f9" strokeDasharray="4 4" />
                ))}
                <text x="10" y="44" fontSize="11" fill="#94a3b8" fontWeight="600">180</text>
                <text x="10" y="84" fontSize="11" fill="#94a3b8" fontWeight="600">140</text>
                <text x="10" y="124" fontSize="11" fill="#94a3b8" fontWeight="600">100</text>
                <text x="10" y="164" fontSize="11" fill="#94a3b8" fontWeight="600">60</text>

                {/* 12-Month Systolic Wide Wave Line */}
                <path
                  d="M60,95 Q140,110 220,105 T380,95 T540,88 T700,92 T860,82 T960,78"
                  fill="none"
                  stroke="#3b82f6"
                  strokeWidth="3.5"
                />
                {/* Points */}
                {[60, 140, 220, 300, 380, 460, 540, 620, 700, 780, 860, 960].map((cx, idx) => (
                  <circle key={idx} cx={cx} cy={idx % 2 === 0 ? 92 : 102} r="4" fill="#3b82f6" stroke="#fff" strokeWidth="2" />
                ))}
                <rect x="946" y="52" width="34" height="22" rx="6" fill="#3b82f6" />
                <text x="963" y="67" fontSize="12" fill="#ffffff" fontWeight="800" textAnchor="middle">128</text>

                {/* 12-Month Diastolic Line */}
                <path
                  d="M60,140 Q140,150 220,142 T380,138 T540,132 T700,135 T860,128 T960,124"
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth="3.5"
                />
                {[60, 140, 220, 300, 380, 460, 540, 620, 700, 780, 860, 960].map((cx, idx) => (
                  <circle key={idx} cx={cx} cy={idx % 2 === 0 ? 138 : 144} r="4" fill="#22c55e" stroke="#fff" strokeWidth="2" />
                ))}
                <rect x="948" y="132" width="30" height="22" rx="6" fill="#22c55e" />
                <text x="963" y="147" fontSize="12" fill="#ffffff" fontWeight="800" textAnchor="middle">84</text>

                {/* 12 Months Labels */}
                {["1월", "2월", "3월", "4월", "5월", "6월", "7월", "8월", "9월", "10월", "11월", "12월"].map((m, idx) => (
                  <text key={idx} x={60 + idx * 81} y="190" fontSize="12" fill="#64748b" fontWeight="600" textAnchor="middle">{m}</text>
                ))}
              </svg>
            </div>
          </CardContent>
        </Card>

        {/* 4 Bottom Cards Full Row */}
        <section style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "24px" }}>
          <Card>
            <CardHeader><CardTitle>만성질환 위험도</CardTitle></CardHeader>
            <CardContent>
              <div className="sp-risk-list">
                <div className="sp-risk-row"><div className="sp-risk-left"><span>❤️</span><span>고혈압</span></div><Badge variant="warning">주의</Badge></div>
                <div className="sp-risk-row"><div className="sp-risk-left"><span>💧</span><span>당뇨</span></div><Badge variant="safe">정상</Badge></div>
              </div>
              <Button variant="secondary">위험도 종합 분석 보고서 →</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>오늘의 챌린지</CardTitle>
              <span style={{ fontSize: "13px", fontWeight: 700, color: "var(--sp-primary)" }}>2/3 달성</span>
            </CardHeader>
            <CardContent>
              <Progress value={66} />
              <div className="sp-challenge-list" style={{ marginTop: "14px" }}>
                <div className="sp-challenge-item"><span>✓ 20분 걷기</span><span className="sp-status-green">완료</span></div>
                <div className="sp-challenge-item"><span>✓ 물 6잔</span><span className="sp-status-green">완료</span></div>
                <div className="sp-challenge-item"><span>○ 복약 확인</span><span className="sp-status-sub">미완료</span></div>
              </div>
              <Button variant="primary">계속하기 →</Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>통증 &amp; 운동 요약</CardTitle></CardHeader>
            <CardContent>
              <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "14px", padding: "10px 12px", background: "#f8fafc", borderRadius: "10px" }}>
                <div><small style={{ color: "#64748b" }}>무릎 통증</small><strong style={{ display: "block", fontSize: "18px" }}>5 → <span style={{ color: "#16a34a" }}>3</span>점</strong></div>
                <Badge variant="safe">3일 연속 개선</Badge>
              </div>
              <div style={{ display: "flex", justifyContent: "space-between", padding: "10px 12px", background: "#f8fafc", borderRadius: "10px" }}>
                <div><small style={{ color: "#64748b" }}>이번 주 운동</small><strong style={{ display: "block", fontSize: "18px" }}>3회 · 92분</strong></div>
                <Badge variant="default">목표 달성</Badge>
              </div>
            </CardContent>
          </Card>

          <div style={{ display: "flex", flexDirection: "column", gap: "14px" }}>
            <div className="sp-body-find-card">
              <div className="sp-body-find-left"><strong>아픈 부위 3D 핀포인트</strong><small>어디가 불편하신가요?</small></div>
              <div className="sp-body-find-right">
                <svg className="sp-body-silhouette" viewBox="0 0 40 60" fill="none" stroke="currentColor">
                  <circle cx="20" cy="10" r="5" strokeWidth="1.5" />
                  <path d="M12 20C14 18 16 18 20 18C24 18 26 18 28 20L31 34L26 35L24 24V40L25 54H21L20 42L19 54H15L16 40V24L14 35L9 34L12 20Z" strokeWidth="1.5" />
                </svg>
              </div>
            </div>
            <div className="sp-bomi-card">
              <div className="sp-bomi-avatar">🤖</div>
              <div className="sp-bomi-info"><strong>봄이에게 물어보기</strong><small>건강이 궁금할 때 언제든지!</small></div>
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}
export default UiPreview2Page;
