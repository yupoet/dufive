# 嘟嘟五子棋

一个面向浏览器和 Android 的离线五子棋应用。它沿用 Duchess 和 Dugo 的
React、Vite、Capacitor 和“引擎隔离 + 过期回复保护”架构，但五子棋规则、棋盘
和 AI 接口均为独立实现。

预留正式域名：`https://dufive.yupoet.com/`

## 功能

- **两种本地引擎**：内置 TypeScript 搜索（增量评估 + alpha-beta + 连续冲四搜
  杀），或 GPL 协议的 [Rapfi](https://github.com/dhbloo/rapfi) WebAssembly 强
  引擎。两者都跑在 Web Worker 里，完全离线。
- **四档棋力**：入门、初级、中级、高级，控制搜索深度、候选宽度和思考时间。
- **两种规则**：无禁手，或黑方禁手（长连、双四、双三）。禁手按棋型集合计数，
  同一条线上的两个真四算双四；只补成假活三的不算三。五连优先于一切禁手。
- **13×13 / 15×15 / 19×19** 棋盘，木纹 SVG 棋盘、星位、坐标、最后一手标记、
  胜利连线高亮。
- 本地双人、人机对战、撤销、重开、认输、提示。
- 移动端优先，支持键盘操作与读屏；PWA 离线运行；可打包 Android APK。

## 开发

```bash
npm install
npm test
npm run lint
npm run build
npm run dev
```

端到端冒烟（需要真实的 WASM 构建，会同时验证两个引擎）：

```bash
npm run build
npx vite preview --port 4173 &
node e2e/smoke.mjs
```

Android：

```bash
npm run build:android
```

生成物位于 `dist/dufive.apk`。

## 引擎

### 内置引擎

`src/engine/` 里的 TypeScript 实现：

- `evaluate.ts` — 棋型识别（活四、冲四、活三、跳三等）与增量窗口评估，落子
  只更新受影响的二十个五连窗口。
- `search.ts` — 迭代加深 alpha-beta，候选点按“自己威胁 + 对手威胁 + 中心度”
  排序；`findVcfWin` 做连续冲四搜杀。
- `ai.ts` — 组织搜索：先找直接连五，再做 VCF，最后走通用搜索；时间预算耗尽时
  保留上一层深度的最佳着法。

### Rapfi

`public/engine/rapfi/` 下是 Rapfi 0.43.02 的 Emscripten 构建（wasm 1.2 MB +
权重 79 KB）。它跑在独立的 classic worker 里，通过 Piskvork 协议通信。完整的
克隆地址、提交号、编译参数和校验和见 `public/engine/rapfi/SOURCE.md`。

引擎选择 “Rapfi 引擎” 时才会按需下载该模块，不会进入主包。若 Rapfi 运行出错，
对局会自动降级到内置引擎，棋局不会卡住。

Rapfi 为 GPL-3.0，许可证与来源说明见 `THIRD_PARTY_NOTICES.md`。

## 部署

Cloudflare Pages 项目名为 `dufive`。推送到 `main` 后 GitHub Actions 会先跑测
试、代码检查和生产构建，再自动发布；本地也可在完成 Wrangler 登录后运行
`npm run deploy:pages`。
