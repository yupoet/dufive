import { mkdir } from 'node:fs/promises'
import { chromium } from 'playwright'

const BASE_URL = process.env.E2E_URL ?? 'http://localhost:4173/'
const SHOT_DIR = process.env.E2E_SHOTS ?? '/tmp/dufive-shots'
const hostResolverRules = process.env.E2E_HOST_RESOLVER_RULES

await mkdir(SHOT_DIR, { recursive: true })

const browser = await chromium.launch({
  args: hostResolverRules
    ? [`--host-resolver-rules=${hostResolverRules}`]
    : [],
})
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
})

const errors = []
page.on('pageerror', (error) => errors.push(`pageerror: ${error.message}`))
page.on('console', (message) => {
  if (message.type() === 'error') errors.push(`console: ${message.text()}`)
})

function check(condition, message) {
  if (!condition) throw new Error(message)
}

/** Menu labels can also appear in the footer, so always scope to buttons. */
function clickButton(text) {
  return page.getByRole('button').filter({ hasText: text }).first().click()
}

async function waitForEngineStone(minimum = 1, timeout = 60_000) {
  await page.waitForFunction(
    (expected) => document.querySelectorAll(
      '.board-point.has-black, .board-point.has-white',
    ).length >= expected,
    minimum,
    { timeout },
  )
}

const stoneClass = async (x, y) => (
  await page.getByTestId(`point-${x}-${y}`).getAttribute('class')
)

try {
  await page.addInitScript(() => localStorage.clear())
  await page.goto(BASE_URL, { waitUntil: 'networkidle' })

  await page.getByTestId('main-menu').waitFor()
  check(await page.getByText('嘟嘟五子棋').first().isVisible(), '主菜单标题未显示')
  await page.screenshot({ path: `${SHOT_DIR}/01-menu.png` })
  console.log('✅ 主菜单和移动布局')

  // ---------------------------------------------------------------- 双人
  await clickButton('双人对弈')
  await page.getByTestId('start-game').click()
  await page.getByTestId('gomoku-board').waitFor()

  for (const [x, y] of [[0, 0], [0, 5], [1, 0], [1, 5], [2, 0], [2, 5], [3, 0], [3, 5]]) {
    await page.getByTestId(`point-${x}-${y}`).click()
  }
  await page.getByTestId('point-4-0').click()

  check(
    (await page.getByText('黑方五子连珠').count()) > 0,
    '黑方连成五子后没有显示终局结果',
  )
  check(
    (await stoneClass(4, 0))?.includes('is-winning'),
    '获胜的五子没有高亮连线',
  )
  await page.screenshot({ path: `${SHOT_DIR}/02-local-win.png` })
  console.log('✅ 本地双人连五获胜与连线高亮')

  await page.getByTestId('undo').click()
  check(
    (await stoneClass(4, 0))?.includes('is-empty'),
    '撤销后最后一手没有收回',
  )
  console.log('✅ 撤销完整恢复棋盘')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('exit').click()
  await page.getByTestId('main-menu').waitFor()

  // ------------------------------------------------------- 内置引擎
  await clickButton('挑战帕里斯')
  await clickButton('无禁手')
  await page.getByTestId('strength-medium').click()
  await clickButton('执白')
  await page.getByTestId('start-game').click()
  await waitForEngineStone(1)
  check(
    (await page.getByTestId('engine-status').textContent())?.length > 0,
    '内置引擎状态未显示',
  )
  console.log('✅ 内置引擎执黑开局')

  await page.getByTestId('point-3-3').click()
  await waitForEngineStone(3)
  console.log('✅ 内置引擎应手')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('exit').click()
  await page.getByTestId('main-menu').waitFor()

  // ------------------------------------------------------------ Rapfi
  await clickButton('挑战帕里斯')
  await clickButton('Rapfi 引擎')
  await clickButton('执白')
  await page.getByTestId('start-game').click()

  await waitForEngineStone(1, 90_000)
  const rapfiStatus = await page.getByTestId('engine-status').textContent()
  check(
    (rapfiStatus ?? '').includes('Rapfi'),
    `Rapfi 引擎状态异常：${rapfiStatus}`,
  )
  await page.screenshot({ path: `${SHOT_DIR}/03-rapfi.png` })
  console.log(`✅ Rapfi WASM 加载并落子（${rapfiStatus?.trim()}）`)

  await page.getByTestId('point-3-3').click()
  await waitForEngineStone(3, 90_000)
  console.log('✅ Rapfi 连续应手')

  page.once('dialog', (dialog) => dialog.accept())
  await page.getByTestId('exit').click()
  await page.getByTestId('main-menu').waitFor()

  // ---------------------------------------------------------- 禁手规则
  await clickButton('双人对弈')
  await clickButton('黑方禁手')
  await page.getByTestId('start-game').click()

  for (const [x, y] of [[0, 0], [0, 7], [1, 0], [2, 7], [2, 0], [4, 7], [3, 0], [6, 7], [5, 0], [8, 7]]) {
    await page.getByTestId(`point-${x}-${y}`).click()
  }
  await page.getByTestId('point-4-0').click()
  check(
    (await stoneClass(4, 0))?.includes('is-empty'),
    '禁手规则下黑方长连没有被拦下',
  )
  console.log('✅ 黑方长连禁手被拦下')

  // ---------------------------------------------------------- 离线模式
  // The service worker precaches the app shell and both engines; wait for it
  // to be active, then cut the network and prove the game still runs.
  await page.evaluate(() => navigator.serviceWorker.ready)
  await page.context().setOffline(true)
  try {
    await page.reload({ waitUntil: 'load' })
    await page.getByTestId('main-menu').waitFor({ timeout: 15_000 })

    await clickButton('双人对弈')
    await page.getByTestId('start-game').click()
    await page.getByTestId('gomoku-board').waitFor()
    await page.getByTestId('point-7-7').click()
    check(
      (await stoneClass(7, 7))?.includes('has-black'),
      '离线模式下无法落子',
    )

    // The Rapfi module must also be served from the cache offline. Workbox
    // stores precached URLs with a revision query, so scan the cache keys
    // instead of matching an exact URL.
    const rapfiCached = await page.evaluate(async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name)
        const requests = await cache.keys()
        if (requests.some((request) => request.url.includes('rapfi.wasm'))) {
          return true
        }
      }
      return false
    })
    check(rapfiCached, 'Rapfi WASM 没有被 Service Worker 预缓存')

    await page.screenshot({ path: `${SHOT_DIR}/04-offline.png` })
    console.log('✅ 断网后 PWA 仍可对弈，Rapfi 已预缓存')
  } finally {
    await page.context().setOffline(false)
  }

  console.log('\n全部冒烟检查通过。')
} finally {
  if (errors.length > 0) {
    console.error('\n控制台错误：')
    for (const error of errors) console.error(`  ${error}`)
  }
  await browser.close()
  if (errors.length > 0) process.exitCode = 1
}
