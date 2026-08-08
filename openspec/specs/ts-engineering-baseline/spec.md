# Spec: ts-engineering-baseline

> TypeScript / Vite / Vitest 工程基线能力：后端渐进式 TS 化的脚手架。本 capability 在 setup-ts-baseline change 中建立。

## Requirements

### Requirement: TypeScript 编译与类型检查能力
项目 MUST 在根目录提供 `tsconfig.json`（并 MUST 提供 `tsconfig.node.json` 给 server 端），MUST 开启 `allowJs` 使现有 `.js` 与新增 `.ts` 共存，且 MUST 提供 `npm run typecheck`（执行 `tsc --noEmit`，前后端两份 tsconfig 都跑）作为类型检查统一入口。本基线 MUST NOT 强制开启 `strict`，留待后续模块迁移时逐步收紧。

#### Scenario: 全新空 TS 文件能通过类型检查
- **WHEN** 开发者在项目中新增一个空 `.ts` 文件并运行 `npm run typecheck`
- **THEN** 命令以退出码 0 成功结束，不产生错误

#### Scenario: 现有 JS 文件不被类型检查阻塞
- **WHEN** 运行 `npm run typecheck` 时项目仍包含大量未迁移的 `.js` 源文件
- **THEN** 类型检查不会因这些 `.js` 文件报错失败（通过 `allowJs` + 不强制 `checkJs` 保证）

### Requirement: Vite 作为前端构建与开发服务器
项目 MUST 提供 `vite.config.ts`，以 `index.html` 为入口托管现有前端；前端 WebSocket（`js/Client.js` 连 8081、`js/ImageUploadClient.js` 连 8082）MUST 经 `window.location.hostname` 直连后端（Vite 不配 WS 代理、前端 JS 零改动，依赖后端 wss 不校验 origin）；`fetch("./csv/...")` 等静态资源 MUST 经 Vite HTTP 代理转发到后端 8080，保证加载行为与重构前一致。

#### Scenario: 开发模式下前端正常加载
- **WHEN** 运行 `npm run dev` 启动 Vite dev server，并在浏览器打开页面
- **THEN** 页面渲染、标签切换、表格初始化等表现与重构前（浏览器直载 ES module）一致

#### Scenario: WebSocket 直连后端（不经 Vite 代理）
- **WHEN** 前端在 Vite dev server 下发起 WebSocket 连接
- **THEN** 连接经 `window.location.hostname` 直连后端 8081/8082（Vite 不配 WS 代理、前端 JS 零改动），连接、收发行为与重构前一致

#### Scenario: CSV 静态资源经 HTTP 代理加载
- **WHEN** 前端在 Vite dev server 下 `fetch("./csv/...")`
- **THEN** 请求经 Vite HTTP 代理落到后端 8080，CSV 内容与重构前一致

### Requirement: Vitest 测试骨架可用
项目 MUST 提供 `vitest.config.ts` 与 `tests/` 目录，MUST 至少包含一个 smoke 测试；`npm test` MUST 能在本地与 CI 跑通。

#### Scenario: 运行测试套件
- **WHEN** 执行 `npm test`
- **THEN** Vitest 运行 `tests/` 下所有测试，smoke 测试通过，命令以退出码 0 结束

### Requirement: 测试的网络与硬件隔离
项目下所有测试（含 smoke 测试及后续协议层测试等）MUST 通过 mock 隔离一切外部依赖，MUST NOT 绑定真实网络端口，MUST NOT 向真实 IP 发起连接，MUST NOT 打开真实串口或硬件设备，MUST NOT 触发真实子进程（如 ffmpeg）。Vitest 配置与测试代码 MUST 保证：运行 `npm test` 时不会产生任何真实网络 IO 与硬件访问。

#### Scenario: 测试不接触真实网络与硬件
- **WHEN** 运行 `npm test`，且测试机器与硬件设备处于同一网段
- **THEN** 测试全程不向 `192.168.0.170`、`192.168.10.1` 等真实地址发送任何数据包，不监听 30041 / 30042 / 30040 / 8081 / 8082 等真实业务端口，不打开 `COM7` 等真实串口，全部使用 mock

#### Scenario: 协议解析测试使用构造的字节流
- **WHEN** 后续测试 `TcpBridge.handleData` 等协议解析逻辑
- **THEN** 输入数据 MUST 为测试中手工构造的 Buffer / 字节流，不来自真实 socket；断言只针对解析输出

### Requirement: 统一的 npm scripts
`package.json` MUST 提供 `dev`（Vite 前端）、`dev:server`（后端 server）、`build`（前端构建）、`test`（Vitest）、`typecheck`（tsc --noEmit，前后端两份）五个脚本。

#### Scenario: 脚本可发现
- **WHEN** 执行 `npm run`
- **THEN** 列表中包含 `dev`、`dev:server`、`build`、`test`、`typecheck` 五个脚本
