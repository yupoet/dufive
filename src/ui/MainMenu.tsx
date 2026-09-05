import {
  BOARD_SIZES,
  type BoardSize,
  type Color,
  type RuleSet,
} from '../game/types'
import {
  ENGINE_STRENGTH_PROFILES,
  ENGINE_STRENGTHS,
  type EngineKind,
  type EngineStrength,
} from '../engine'
import type { GameStats } from '../state/stats'
import StatsCard from './StatsCard'

export type GameMode = 'human-vs-engine' | 'local-two-player'
export type PlayerColor = Color | 'random'
export type EngineChoice = EngineKind

export interface MainMenuProps {
  readonly boardSize: BoardSize
  readonly gameMode: GameMode
  readonly playerColor: PlayerColor
  readonly engineStrength: EngineStrength
  readonly engineChoice: EngineChoice
  readonly ruleSet: RuleSet
  readonly soundEnabled?: boolean
  readonly nnueAvailable?: boolean
  readonly engineReady?: boolean
  readonly engineLabel?: string
  readonly starting?: boolean
  readonly onBoardSizeChange: (size: BoardSize) => void
  readonly onGameModeChange: (mode: GameMode) => void
  readonly onPlayerColorChange: (color: PlayerColor) => void
  readonly onEngineStrengthChange: (strength: EngineStrength) => void
  readonly onEngineChoiceChange: (choice: EngineChoice) => void
  readonly onRuleSetChange: (ruleSet: RuleSet) => void
  readonly onSoundEnabledChange: (enabled: boolean) => void
  readonly onStart: () => void
  readonly stats?: GameStats
  readonly onResetStats?: () => void
}

const BOARD_DETAILS: Record<BoardSize, string> = {
  13: '轻快 · 一局几分钟',
  15: '标准 · 五子棋正统',
  19: '开阔 · 长考慢棋',
}

const COLOR_OPTIONS: readonly {
  readonly value: PlayerColor
  readonly label: string
  readonly detail: string
}[] = [
  { value: 'black', label: '执黑', detail: '先行' },
  { value: 'white', label: '执白', detail: '后行' },
  { value: 'random', label: '随机', detail: '交给棋运' },
]

const ENGINE_CHOICES: readonly {
  readonly value: EngineChoice
  readonly label: string
  readonly detail: string
}[] = [
  { value: 'built-in', label: '随身棋力', detail: '内置引擎 · 立刻开局' },
  { value: 'rapfi', label: 'Rapfi 引擎', detail: '经典权重 · 约 1.3 MB' },
  { value: 'rapfi-nnue', label: 'Rapfi 超最强', detail: 'NNUE 权重 · 约 40 MB' },
]

const RULE_OPTIONS: readonly {
  readonly value: RuleSet
  readonly label: string
  readonly detail: string
}[] = [
  { value: 'free', label: '无禁手', detail: '连成五子即胜' },
  { value: 'renju', label: '黑方禁手', detail: '长连/双四/双三不可落' },
]

export function MainMenu({
  boardSize,
  gameMode,
  playerColor,
  engineStrength,
  engineChoice,
  ruleSet,
  soundEnabled = true,
  nnueAvailable = false,
  engineReady = true,
  engineLabel = '本地离线引擎',
  starting = false,
  onBoardSizeChange,
  onGameModeChange,
  onPlayerColorChange,
  onEngineStrengthChange,
  onEngineChoiceChange,
  onRuleSetChange,
  onSoundEnabledChange,
  onStart,
  stats,
  onResetStats = () => {},
}: MainMenuProps) {
  return (
    <main className="main-menu" data-testid="main-menu">
      <div className="menu-atmosphere" aria-hidden="true">
        <span className="menu-stone menu-stone--black" />
        <span className="menu-stone menu-stone--white" />
      </div>

      <section className="menu-shell" aria-labelledby="dufive-title">
        <header className="menu-hero">
          <div className="brand-mark" aria-hidden="true">
            <span className="brand-mark__stone brand-mark__stone--black" />
            <span className="brand-mark__stone brand-mark__stone--white" />
            <span className="brand-mark__stone brand-mark__stone--black" />
            <span className="brand-mark__stone brand-mark__stone--white" />
            <span className="brand-mark__stone brand-mark__stone--black" />
          </div>
          <p className="eyebrow">棋魂帕里斯 · 随身棋院</p>
          <h1 id="dufive-title">嘟嘟五子棋</h1>
          <p className="menu-subtitle">
            五子连珠即为胜。也可以从每一手重新理解连线。
          </p>
        </header>

        <div className="menu-card">
          <fieldset className="menu-fieldset">
            <legend>
              <span>棋盘大小</span>
              <small>选择你的对局节奏</small>
            </legend>
            <div className="board-size-options">
              {BOARD_SIZES.map((size) => (
                <button
                  className="choice-card choice-card--board"
                  type="button"
                  aria-pressed={boardSize === size}
                  key={size}
                  onClick={() => onBoardSizeChange(size)}
                >
                  <strong>{size}×{size}</strong>
                  <span>{BOARD_DETAILS[size]}</span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="menu-fieldset">
            <legend>
              <span>对弈方式</span>
              <small>引擎在设备本地思考</small>
            </legend>
            <div className="mode-options">
              <button
                className="choice-card choice-card--mode"
                type="button"
                aria-pressed={gameMode === 'human-vs-engine'}
                onClick={() => onGameModeChange('human-vs-engine')}
              >
                <span className="choice-icon" aria-hidden="true">✦</span>
                <span>
                  <strong>挑战帕里斯</strong>
                  <small>与本地引擎对弈</small>
                </span>
              </button>
              <button
                className="choice-card choice-card--mode"
                type="button"
                aria-pressed={gameMode === 'local-two-player'}
                onClick={() => onGameModeChange('local-two-player')}
              >
                <span className="choice-icon" aria-hidden="true">◐</span>
                <span>
                  <strong>双人对弈</strong>
                  <small>面对面轮流落子</small>
                </span>
              </button>
            </div>
          </fieldset>

          <fieldset
            className="menu-fieldset"
            disabled={gameMode === 'local-two-player'}
          >
            <legend>
              <span>引擎</span>
              <small>都是本机计算，越强越能等</small>
            </legend>
            <div className="engine-options">
              {ENGINE_CHOICES
                .filter((option) => option.value !== 'rapfi-nnue' || nnueAvailable)
                .map((option) => (
                <button
                  className="choice-card choice-card--mode"
                  type="button"
                  aria-pressed={engineChoice === option.value}
                  key={option.value}
                  onClick={() => onEngineChoiceChange(option.value)}
                >
                  <span className="choice-icon" aria-hidden="true">
                    {option.value === 'built-in' ? '◍' : '⚙'}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset
            className="menu-fieldset"
            disabled={gameMode === 'local-two-player'}
          >
            <legend>
              <span>帕里斯棋力</span>
              <small>越高想得越深</small>
            </legend>
            <div className="strength-options">
              {ENGINE_STRENGTHS.map((strength) => {
                const profile = ENGINE_STRENGTH_PROFILES[strength]
                return (
                  <button
                    className={`strength-choice strength-choice--${strength}`}
                    data-testid={`strength-${strength}`}
                    type="button"
                    aria-pressed={engineStrength === strength}
                    key={strength}
                    onClick={() => onEngineStrengthChange(strength)}
                  >
                    <strong>{profile.label}</strong>
                    <small>{profile.detail}</small>
                  </button>
                )
              })}
            </div>
          </fieldset>

          <fieldset
            className="menu-fieldset"
            disabled={gameMode === 'local-two-player'}
          >
            <legend>
              <span>你的棋色</span>
              <small>
                {gameMode === 'local-two-player' ? '双人模式由黑方先行' : '黑方先行'}
              </small>
            </legend>
            <div className="color-options">
              {COLOR_OPTIONS.map((option) => (
                <button
                  className="color-choice"
                  type="button"
                  aria-pressed={playerColor === option.value}
                  key={option.value}
                  onClick={() => onPlayerColorChange(option.value)}
                >
                  <span
                    className={`color-choice__stone color-choice__stone--${option.value}`}
                    aria-hidden="true"
                  >
                    {option.value === 'random' ? '?' : ''}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <fieldset className="menu-fieldset">
            <legend>
              <span>落子音效</span>
              <small>轻微的落子声</small>
            </legend>
            <div className="mode-options">
              <button
                className="choice-card choice-card--mode"
                type="button"
                aria-pressed={soundEnabled}
                onClick={() => onSoundEnabledChange(true)}
              >
                <span className="choice-icon" aria-hidden="true">♪</span>
                <span>
                  <strong>开启</strong>
                  <small>每手都有反馈</small>
                </span>
              </button>
              <button
                className="choice-card choice-card--mode"
                type="button"
                aria-pressed={!soundEnabled}
                onClick={() => onSoundEnabledChange(false)}
              >
                <span className="choice-icon" aria-hidden="true">✕</span>
                <span>
                  <strong>关闭</strong>
                  <small>安静对弈</small>
                </span>
              </button>
            </div>
          </fieldset>

          <fieldset className="menu-fieldset">
            <legend>
              <span>规则</span>
              <small>禁手只限制黑方</small>
            </legend>
            <div className="mode-options">
              {RULE_OPTIONS.map((option) => (
                <button
                  className="choice-card choice-card--mode"
                  type="button"
                  aria-pressed={ruleSet === option.value}
                  key={option.value}
                  onClick={() => onRuleSetChange(option.value)}
                >
                  <span className="choice-icon" aria-hidden="true">
                    {option.value === 'renju' ? '✕' : '○'}
                  </span>
                  <span>
                    <strong>{option.label}</strong>
                    <small>{option.detail}</small>
                  </span>
                </button>
              ))}
            </div>
          </fieldset>

          <div className="menu-start">
            <div
              className={`engine-readiness ${engineReady ? 'is-ready' : 'is-loading'}`}
              role="status"
            >
              <span aria-hidden="true" />
              {engineReady ? engineLabel : '正在唤醒本地棋力…'}
            </div>
            <button
              className="start-game-button"
              data-testid="start-game"
              type="button"
              disabled={starting}
              onClick={onStart}
            >
              <span>{starting ? '正在布置棋盘…' : '开始对弈'}</span>
              <span aria-hidden="true">落子</span>
            </button>
          </div>
        </div>

        {stats && <StatsCard stats={stats} onReset={onResetStats} />}

        <footer className="menu-footer">
          离线运行 · 无禁手或黑方禁手（长连、双四、双三）
        </footer>
      </section>
    </main>
  )
}

export default MainMenu
