import React from "react";
import type { TodayChallengeSummary, TodayTaskItem } from "../../shared/local/domainContracts";
import "./todayChallengeCard.css";

export interface TodayChallengeCardProps {
  profileName: string;
  summary?: TodayChallengeSummary;
  loading?: boolean;
  onToggleTask: (taskId: string) => void;
  onCompleteAll: () => void;
  onOpenAssistantForChallenge: () => void;
}

const DAY_NAMES = ["일", "월", "화", "수", "목", "금", "토"];

export function TodayChallengeCard({
  profileName,
  summary,
  loading = false,
  onToggleTask,
  onCompleteAll,
  onOpenAssistantForChallenge,
}: TodayChallengeCardProps) {
  if (loading) {
    return (
      <div className="today-challenge-card is-loading">
        <p className="subtle-status">오늘의 챌린지를 확인하는 중…</p>
      </div>
    );
  }

  // 활성 챌린지가 없는 경우: 봄이와 시작하기 유도 카드
  if (!summary || !summary.hasActiveChallenge || !summary.plan) {
    return (
      <div className="today-challenge-card is-empty">
        <div className="challenge-empty-content">
          <div className="challenge-empty-text">
            <span className="challenge-kicker">맞춤 생활습관 챌린지</span>
            <h2>{profileName}님의 맞춤 챌린지를 시작해 보세요</h2>
            <p>건강 비서 봄이와 대화하며 혈압·혈당·수면을 개선하는 매일의 작은 습관을 세울 수 있습니다.</p>
          </div>
          <button
            className="primary-button create-challenge-btn"
            type="button"
            onClick={onOpenAssistantForChallenge}
          >
            봄이에게 챌린지 추천받기
          </button>
        </div>
      </div>
    );
  }

  const { plan, tasks, allCompleted, weeklyProgress } = summary;

  return (
    <div className="today-challenge-card is-active" aria-labelledby="today-challenge-heading">
      <div className="challenge-card-top">
        <div>
          <div className="challenge-kicker-row">
            <span className="challenge-kicker">
              {plan.weeks}주 건강 챌린지 · {weeklyProgress?.weekNumber ?? 1}주차
            </span>
            {weeklyProgress && weeklyProgress.currentStreakDays > 0 ? (
              <span className="streak-badge" aria-label={`연속 달성 ${weeklyProgress.currentStreakDays}일`}>
                {weeklyProgress.currentStreakDays}일 연속 달성
              </span>
            ) : null}
            {allCompleted ? <span className="today-done-badge">오늘 목표 달성!</span> : null}
          </div>
          <div className="challenge-title-group">
            <h2 id="today-challenge-heading">{plan.title}</h2>
            <p className="challenge-goal">목표: {plan.goal}</p>
          </div>
        </div>

        <div className="challenge-top-actions">
          {tasks.length > 0 && !allCompleted ? (
            <button
              className="secondary-button complete-all-btn"
              type="button"
              onClick={onCompleteAll}
            >
              오늘 챌린지 모두 완료
            </button>
          ) : null}
        </div>
      </div>

      {/* 오늘 실천 과제 목록 */}
      <div className="today-tasks-panel">
        <h3 className="tasks-section-title">오늘의 실천 과제 ({tasks.length}개)</h3>
        {tasks.length === 0 ? (
          <p className="challenge-empty-task-note">오늘은 지정된 과제가 없는 날입니다. 편안한 하루 보내세요!</p>
        ) : (
          <ul className="challenge-task-list">
            {tasks.map((item) => (
              <TaskItemRow key={item.task.id} item={item} onToggle={onToggleTask} />
            ))}
          </ul>
        )}
      </div>

      {/* 주간 진행률 & 스트릭 현황 */}
      {weeklyProgress ? (
        <div className="challenge-weekly-section">
          <div className="weekly-header">
            <span className="weekly-label">{weeklyProgress.weekNumber}주차 달성률</span>
            <span className="weekly-stat">
              <strong>{weeklyProgress.completedDays}일</strong> / {weeklyProgress.totalDays}일 완료 (
              {weeklyProgress.ratePercent}%)
            </span>
          </div>
          <div className="weekly-progress-bar-bg" role="progressbar" aria-valuenow={weeklyProgress.ratePercent} aria-valuemin={0} aria-valuemax={100}>
            <div className="weekly-progress-bar-fill" style={{ width: `${weeklyProgress.ratePercent}%` }} />
          </div>
          <div className="weekly-days-grid">
            {weeklyProgress.dailyStatuses.map((day) => {
              const isDone = day.status === "completed" || day.status === "rest";
              const isToday = day.date === summary.todayDate;
              return (
                <div
                  key={day.date}
                  className={`weekly-day-pill ${isDone ? "is-done" : ""} ${isToday ? "is-today" : ""}`}
                >
                  <span className="day-name">{DAY_NAMES[day.dayOfWeek]}</span>
                  <span className="day-mark" aria-hidden="true">
                    {day.status === "completed" ? "✓" : day.status === "rest" ? "休" : "·"}
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      ) : null}
    </div>
  );
}

interface TaskItemRowProps {
  item: TodayTaskItem;
  onToggle: (taskId: string) => void;
}

function TaskItemRow({ item, onToggle }: TaskItemRowProps) {
  const { task, status, adjustedMinutes } = item;
  const isCompleted = status === "completed";
  const isRest = status === "rest";

  return (
    <li className={`challenge-task-item ${isCompleted ? "is-completed" : ""} ${isRest ? "is-rest" : ""}`}>
      <label className="task-checkbox-label">
        <input
          type="checkbox"
          checked={isCompleted}
          disabled={isRest}
          onChange={() => onToggle(task.id)}
          aria-label={`${task.title} 완료 토글`}
        />
        <span className="task-custom-checkbox" aria-hidden="true">
          {isCompleted ? "✓" : ""}
        </span>
        <div className="task-info">
          <div className="task-main-row">
            <span className={`task-type-tag tag-${task.type}`}>
              {task.type === "exercise" ? "운동" : task.type === "sleep" ? "수면" : "체크인"}
            </span>
            <span className="task-title">{task.title}</span>
            {adjustedMinutes ? (
              <span className="task-target-badge">조정: {adjustedMinutes}분</span>
            ) : task.targetMinutes ? (
              <span className="task-target-badge">{task.targetMinutes}분 목표</span>
            ) : null}
          </div>
          {task.note ? <span className="task-note">{task.note}</span> : null}
        </div>
      </label>

      {isCompleted ? (
        <button
          className="task-cancel-link"
          type="button"
          onClick={() => onToggle(task.id)}
          aria-label="완료 취소"
        >
          완료 취소
        </button>
      ) : isRest ? (
        <span className="rest-status-badge">회복일</span>
      ) : null}
    </li>
  );
}
