export const EMPTY = 0
export const BLACK = 1
export const WHITE = 2

export type Cell = typeof EMPTY | typeof BLACK | typeof WHITE

export const FIVE = 10_000_000
export const OPEN_FOUR = 1_000_000
export const FOUR = 120_000
export const OPEN_THREE = 40_000
export const BROKEN_THREE = 10_000
export const THREE = 6_000
export const OPEN_TWO = 900
export const BROKEN_TWO = 300
export const TWO = 200
export const ONE = 40

/** Value of a five-cell window holding `n` stones of one colour. */
const WINDOW_SCORE = [0, 1, 12, 120, 1_500, FIVE]

const OFF_BOARD = -1

export function other(color: Cell): Cell {
  return color === BLACK ? WHITE : BLACK
}

interface WindowTable {
  readonly windows: readonly (readonly number[])[]
  readonly windowsAt: readonly (readonly number[])[]
}

const windowCache = new Map<number, WindowTable>()

/**
 * Every five-cell window on the board, plus the reverse index used to update
 * only the twenty windows that touch a placed stone.
 */
export function windowTable(size: number): WindowTable {
  const cached = windowCache.get(size)
  if (cached) return cached

  const windows: number[][] = []
  const directions = [[1, 0], [0, 1], [1, 1], [1, -1]]

  for (let y = 0; y < size; y += 1) {
    for (let x = 0; x < size; x += 1) {
      for (const [dx, dy] of directions) {
        const endX = x + dx * 4
        const endY = y + dy * 4
        if (endX < 0 || endY < 0 || endX >= size || endY >= size) continue

        const window: number[] = []
        for (let step = 0; step < 5; step += 1) {
          window.push((y + dy * step) * size + (x + dx * step))
        }
        windows.push(window)
      }
    }
  }

  const windowsAt: number[][] = Array.from({ length: size * size }, () => [])
  windows.forEach((window, id) => {
    for (const index of window) windowsAt[index].push(id)
  })

  const table: WindowTable = { windows, windowsAt }
  windowCache.set(size, table)
  return table
}

/**
 * Incrementally maintained board evaluation. Placing or removing a stone only
 * revisits the windows that contain it, which keeps alpha-beta affordable.
 */
export class BoardEvaluator {
  private readonly windowsAt: readonly (readonly number[])[]
  private readonly counts: Int16Array
  private readonly totals: Int32Array
  readonly cells: Uint8Array

  constructor(cells: Uint8Array, size: number) {
    this.cells = cells
    const table = windowTable(size)
    this.windowsAt = table.windowsAt
    this.counts = new Int16Array(table.windows.length * 2)
    this.totals = new Int32Array(3)

    for (let id = 0; id < table.windows.length; id += 1) {
      let black = 0
      let white = 0
      for (const index of table.windows[id] ?? []) {
        if (cells[index] === BLACK) black += 1
        else if (cells[index] === WHITE) white += 1
      }
      this.counts[id * 2] = black
      this.counts[id * 2 + 1] = white
      this.applyWindow(id)
    }
  }

  private contribution(id: number, color: Cell): number {
    const own = this.counts[id * 2 + (color - 1)] ?? 0
    if (own === 0) return 0
    const rival = this.counts[id * 2 + (other(color) - 1)] ?? 0
    if (rival > 0) return 0
    return WINDOW_SCORE[own] ?? 0
  }

  private applyWindow(id: number): void {
    this.totals[BLACK] += this.contribution(id, BLACK)
    this.totals[WHITE] += this.contribution(id, WHITE)
  }

  private clearWindow(id: number): void {
    this.totals[BLACK] -= this.contribution(id, BLACK)
    this.totals[WHITE] -= this.contribution(id, WHITE)
  }

  place(index: number, color: Cell): void {
    for (const id of this.windowsAt[index] ?? []) {
      this.clearWindow(id)
      this.counts[id * 2 + (color - 1)] += 1
      this.applyWindow(id)
    }
    this.cells[index] = color
  }

  remove(index: number): void {
    const color = this.cells[index] as Cell
    if (color === EMPTY) return
    for (const id of this.windowsAt[index] ?? []) {
      this.clearWindow(id)
      this.counts[id * 2 + (color - 1)] -= 1
      this.applyWindow(id)
    }
    this.cells[index] = EMPTY
  }

  /** Static value of the position for `color`, with a small defensive bias. */
  score(color: Cell): number {
    const own = this.totals[color] ?? 0
    const rival = this.totals[other(color)] ?? 0
    return own - rival * 0.9
  }
}

function lineCells(
  cells: Uint8Array,
  size: number,
  index: number,
  dx: number,
  dy: number,
): number[] {
  const x = index % size
  const y = Math.floor(index / size)
  const line: number[] = []

  for (let offset = -4; offset <= 4; offset += 1) {
    const nextX = x + dx * offset
    const nextY = y + dy * offset
    if (nextX < 0 || nextY < 0 || nextX >= size || nextY >= size) {
      line.push(OFF_BOARD)
    } else {
      line.push(cells[nextY * size + nextX] ?? EMPTY)
    }
  }

  return line
}

const DIRECTION_PAIRS = [[1, 0], [0, 1], [1, 1], [1, -1]] as const

/**
 * Value of placing `color` at `index`, judged along a single direction. Both
 * solid runs and broken shapes such as `XX_X` are considered.
 */
export function analyzeDirection(
  cells: Uint8Array,
  size: number,
  index: number,
  color: Cell,
  dx: number,
  dy: number,
): number {
  const line = lineCells(cells, size, index, dx, dy)
  line[4] = color

  let left = 0
  while (left < 4 && line[4 - left - 1] === color) left += 1
  let right = 0
  while (right < 4 && line[4 + right + 1] === color) right += 1

  const own = left + right + 1
  const leftEnd = left >= 4 ? OFF_BOARD : line[4 - left - 1]
  const rightEnd = right >= 4 ? OFF_BOARD : line[4 + right + 1]
  const leftOpen = leftEnd === EMPTY
  const rightOpen = rightEnd === EMPTY
  const openCount = Number(leftOpen) + Number(rightOpen)

  let best = 0
  if (own >= 5) best = FIVE
  else if (own === 4) {
    best = openCount === 2 ? OPEN_FOUR : openCount === 1 ? FOUR : 0
  } else if (own === 3) {
    best = openCount === 2 ? OPEN_THREE : openCount === 1 ? THREE : 0
  } else if (own === 2) {
    best = openCount === 2 ? OPEN_TWO : openCount === 1 ? TWO : 0
  } else if (openCount === 2) best = ONE * 2
  else if (openCount === 1) best = ONE

  for (let start = 0; start <= 4; start += 1) {
    let stones = 0
    let empty = 0
    let blocked = false

    for (let offset = 0; offset < 5; offset += 1) {
      const value = line[start + offset]
      if (value === OFF_BOARD) {
        blocked = true
        break
      }
      if (value === color) stones += 1
      else if (value === EMPTY) empty += 1
      else {
        blocked = true
        break
      }
    }

    if (blocked) continue
    if (stones === 5) best = Math.max(best, FIVE)
    else if (stones === 4 && empty === 1) best = Math.max(best, FOUR)
    else if (stones === 3 && empty === 2) best = Math.max(best, BROKEN_THREE)
    else if (stones === 2 && empty === 3) best = Math.max(best, BROKEN_TWO)
  }

  return best
}

/** Total attacking value of placing `color` at `index` across all directions. */
export function pointThreat(
  cells: Uint8Array,
  size: number,
  index: number,
  color: Cell,
): number {
  let total = 0
  for (const [dx, dy] of DIRECTION_PAIRS) {
    total += analyzeDirection(cells, size, index, color, dx, dy)
  }
  return total
}

/**
 * Move-ordering heuristic: what the move does for us, plus slightly less than
 * what it denies the opponent, plus a small pull towards the centre.
 */
export function moveScore(
  cells: Uint8Array,
  size: number,
  index: number,
  color: Cell,
): number {
  const attack = pointThreat(cells, size, index, color)
  const defence = pointThreat(cells, size, index, other(color))
  const x = index % size
  const y = Math.floor(index / size)
  const centre = (size - 1) / 2
  const centrality = 12 - (Math.abs(x - centre) + Math.abs(y - centre))

  return attack + defence * 0.85 + centrality
}

/** True when the stone just placed at `index` makes six or more in a row. */
export function createsOverline(
  cells: Uint8Array,
  size: number,
  index: number,
): boolean {
  const color = cells[index]
  if (!color) return false

  for (const [dx, dy] of DIRECTION_PAIRS) {
    let count = 1
    for (const step of [1, -1]) {
      for (let offset = 1; offset < size; offset += 1) {
        const nextX = (index % size) + dx * offset * step
        const nextY = Math.floor(index / size) + dy * offset * step
        if (nextX < 0 || nextY < 0 || nextX >= size || nextY >= size) break
        if (cells[nextY * size + nextX] !== color) break
        count += 1
      }
    }

    if (count >= 6) return true
  }

  return false
}

/** True when the stone just placed at `index` completes five in a row. */
export function createsFive(
  cells: Uint8Array,
  size: number,
  index: number,
  exactFiveOnly = false,
): boolean {
  const color = cells[index]
  if (!color) return false

  for (const [dx, dy] of DIRECTION_PAIRS) {
    let count = 1
    for (const step of [1, -1]) {
      for (let offset = 1; offset < size; offset += 1) {
        const nextX = (index % size) + dx * offset * step
        const nextY = Math.floor(index / size) + dy * offset * step
        if (nextX < 0 || nextY < 0 || nextX >= size || nextY >= size) break
        if (cells[nextY * size + nextX] !== color) break
        count += 1
      }
    }

    if (count >= 5 && (!exactFiveOnly || count === 5)) return true
  }

  return false
}
