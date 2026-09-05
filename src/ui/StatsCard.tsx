import type { GameStats } from '../state/stats'

export interface StatsCardProps {
  readonly stats: GameStats
  readonly onReset: () => void
}

function percentage(wins: number, total: number): string {
  if (total === 0) return '—'
  return `${Math.round((wins / total) * 100)}%`
}

function streakLabel(streak: number): string {
  if (streak === 0) return '还没有连胜'
  return streak > 0 ? `${streak} 连胜` : `${-streak} 连败`
}

export function StatsCard({ stats, onReset }: StatsCardProps) {
  if (stats.total === 0) {
    return (
      <section className="stats-card" aria-label="战绩">
        <div className="stats-card__row">
          <strong>战绩</strong>
          <span>第一局之后开始记录</span>
        </div>
      </section>
    )
  }

  return (
    <section className="stats-card" aria-label="战绩">
      <div className="stats-card__row">
        <strong>战绩</strong>
        <button
          type="button"
          data-testid="reset-stats"
          onClick={() => {
            if (window.confirm('清空全部战绩记录吗？')) onReset()
          }}
        >
          清空
        </button>
      </div>

      <dl className="stats-card__grid">
        <div>
          <dt>总对局</dt>
          <dd data-testid="stats-total">{stats.total}</dd>
        </div>
        <div>
          <dt>胜 / 负 / 和</dt>
          <dd>
            <span data-testid="stats-wins">{stats.wins}</span>
            {' / '}
            <span data-testid="stats-losses">{stats.losses}</span>
            {' / '}
            <span data-testid="stats-draws">{stats.draws}</span>
          </dd>
        </div>
        <div>
          <dt>总胜率</dt>
          <dd>{percentage(stats.wins, stats.total)}</dd>
        </div>
        <div>
          <dt>当前状态</dt>
          <dd data-testid="stats-streak">{streakLabel(stats.streak)}</dd>
        </div>
        <div>
          <dt>最佳连胜</dt>
          <dd>{stats.bestStreak}</dd>
        </div>
        <div>
          <dt>执黑 / 执白</dt>
          <dd>
            {percentage(stats.asBlack.wins, stats.asBlack.total)}
            {' / '}
            {percentage(stats.asWhite.wins, stats.asWhite.total)}
          </dd>
        </div>
      </dl>
    </section>
  )
}

export default StatsCard
