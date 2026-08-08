# Proposal: 搭建 TypeScript 工程基线

## 背景：整体重构蓝图

本项目是"两轴台远程串口通讯"工业控制软件，功能已与硬件联调通过、运行稳定。当前为纯 JS（后端 CommonJS + 前端原生 ES module），无类型、无测试、配置硬编码分散，`server.js`(53KB)、`Command.js`(144KB) 已成巨石。

用户要求用 TypeScript 重构，约束：
1. **行为不变**——功能已验证 OK，重构必须保持外部行为一致；
2. **不随便引入第三方依赖**——运行时依赖保持现状（`ws`/`serialport`/`exceljs`），仅允许必要的 dev 依赖；
3. **每个 change 完成后提交一次 git**；
4. **测试一律用 mock**——测试中绝不绑定真实端口、连接真实 IP、打开真实串口或硬件，所有外部依赖必须 mock 隔离；
5. **禁止改动界面外观**——不得修改 `index.html`、`style.css`，也不得修改任何 JS 文件中的样式代码（`element.style.*` 赋值、内联样式逻辑、CSS 类名操作等），样式行为必须逐字保持；
6. **遗留代码原样保留并 TS 化**——ffmpeg / RTSP 视频流等"当前不再需要但仍存在"的代码，重构时保留、随迁移一并 TS 化，但**保持其现有调用关系与启用状态**：不删除、不新增调用、不特意接入主流程、不主动断开现有调用（受行为不变约束保护），内部逻辑不动。

因此整体重构采用"**先基线、后逐模块迁移**"的渐进策略，拆成多个 change，每个 change 一次提交：

| 序号 | Change | 目标 | 风险 |
|---|---|---|---|
| **1（本 change）** | `setup-ts-baseline` | 搭 TS/Vite/Vitest 工程基线 + 统一 config，业务代码暂不动 | 低 |
| 2 | 协议层 TS 化 + 回归测试 | `TcpBridge`/命令表/`BinaryTableHelper`/`CommandBuilder` 加测试并迁移 TS | 中（核心） |
| 3 | `server.js` 拆分 + TS 化 | HTTP / WS / 串口 / 视频流 / Excel 写盘 分层，模块化 | 中 |
| 4 | 前端 `Command.js` 拆分 + TS 化 | 144KB 巨石按命令域拆分 | 中 |
| 5 | 前端其余模块逐个 TS 化 | `Video`/`TurntableControl`/`DataRouter`/`YC`/`CodeUpload` 等 | 低～中 |

> 后续 change 在本基线就绪后逐个 `openspec new change` 创建。本 proposal 只承诺第 1 个 change 的范围。

## Why

1. **类型缺位**：协议解析（`TcpBridge.handleData` 里 `msg[12]/[13]/[14]` 等魔数位操作）、二进制组包（`BinaryTableHelper`）高度依赖字节布局，无类型保护极易出错；TS 化前需先有工程基线。
2. **测试缺位**：功能虽好，但任何后续改动都没有回归保护网。重构前必须先能跑测试。
3. **配置散落**：`server.js` 硬编码了 3 路 UDP/TCP bridge 的 IP/端口、`COM7`、`115200`、`WS_PORT_IMG=8082`、RTSP、ffmpeg、分辨率等。更严重的是 **`config.json` 已过时**——里面写 `192.168.10.x`，但实际联调用的是 `192.168.0.20 / 192.168.0.170`，且 server.js 根本没读 config.json。配置必须先统一并校准到真实值。
4. **前端无构建**：浏览器直载 ES module，TS 化需要构建器（已选 Vite）。

## What Changes

本 change 只做**工程基线**，不动任何业务逻辑，所有现有 `.js` 文件原样保留并继续运行。

### 1. TypeScript 工程
- 新增 `tsconfig.json`（`allowJs: true`、`outDir`、`strict: false` 起步，渐进收紧）
- 新增 `tsconfig.node.json`（给 server 端用）
- 现有 `.js` 暂不迁移，但 TS 工程能编译/类型检查新增的 `.ts` 文件

### 2. 前端 Vite
- 新增 `vite.config.ts`（dev server 代理 WS 到后端 8081/8082）
- `index.html` 作为 Vite 入口
- 现有 `main.js` 与 `js/` 原样被 Vite 托管（ES module 原生兼容）
- dev 依赖：`vite`、`vite-plugin`（按需）

### 3. 测试骨架 Vitest
- 新增 `vitest.config.ts`
- 新增 `tests/` 目录 + 一个 smoke 测试（如测 `Utils.parseCSV` 之类纯函数），证明测试链路通
- dev 依赖：`vitest`

### 4. 配置统一（行为不变，仅改读取方式 + 校准值）
- 扩展 `config.json` 结构，覆盖：3 路 bridge 的 IP/端口、`COM7`/波特率、`WS_PORT_IMG`、RTSP、ffmpeg 路径、分辨率等
- **以 `server.js` 当前硬编码值为准**校准 config.json（`192.168.0.20` / `192.168.0.170` / 30041/30042/30040 等）
- 改 `server.js`：从 `config.json` 读取上述值（替换硬编码常量），保证运行时值与重构前**逐字一致**
- 提供 `config.example.json` 作为模板，`config.json` 本身不入库（已在 `.gitignore`）

### 5. npm scripts 与质量门
- `package.json` 增加：`dev`（vite）/ `dev:server`（node server）/ `build` / `test`（vitest）/ `typecheck`（tsc --noEmit）
- 新增 `.editorconfig`（如需）

### 不在本 change 范围
- ❌ 任何业务逻辑的 TS 重写（留给 change 2+）
- ❌ Linter/Formatter 引入（本 change 聚焦 TS+Vite+Vitest；Biome/ESLint 可作为独立小 change 后续加）
- ❌ 任何已存在 `.js` 文件的重构或拆分

### 实施时遵循的 skill
apply 阶段按场景套用项目已安装的 eric-* skill，并对与用户硬约束的冲突点显式记录权衡：
- **eric-javascript**：装依赖、配 scripts、初始化 TS 工程时遵循其 pnpm 偏好。**权衡**：skill 要求引入 Antfu 的 `ni` 作为 npm 替代，但受"不随便引入依赖"约束，本 change 直接用 `pnpm`/`pnpm run`，不引入 `ni`。
- **eric-quality-control**：质量门（`tsc --noEmit` / `vitest`）按其 tool defaults 配置，CI 与本地跑同一套命令；本 change 暂不引入 Linter/Formatter（见"不在本 change 范围"）。
- **eric-writing-tests**：写 smoke 测试先过其 Global Gate 两问（适不适合测、值不值得测）——smoke 测试的价值是证明"测试链路通"，符合 lightest method；全程 mock，遵循本 change"测试隔离"spec。
- **eric-backend**：改 `server.js` 读取 config 时遵循"validate at trust boundaries"——config 缺失/字段缺失明确报错退出（已写进 config-unification spec 的健壮性 requirement）。
- **eric-review**：apply 完成、`git commit` 之前按其清单自查（implementation degradation、边界违规、过度抽象、样式改动、遗留代码接入等），确认无回归后再提交。
- **eric-grill**：本 change 方向已明确、无需 grill；后续涉及领域边界的 change（如 change 3 拆 `server.js`、change 4 拆 `Command.js`）启用 grill 梳理边界。

## Capabilities

### New Capabilities
- `ts-engineering-baseline`：TypeScript + Vite + Vitest 工程基线，提供编译、类型检查、测试、dev/build 的统一入口。
- `config-unification`：所有运行时参数（网络/串口/视频/路径）集中到 `config.json` 单一来源，代码仅读取不硬编码。

### Modified Capabilities
- 无。本 change 不改变任何业务行为。

## Impact

### 新增文件
- `tsconfig.json`、`tsconfig.node.json`
- `vite.config.ts`、`vitest.config.ts`
- `config.example.json`（基于校准后的真实值生成模板）
- `tests/smoke.test.ts`（或 `.js`，证明 vitest 能跑）
- `openspec/specs/ts-engineering-baseline/spec.md`、`openspec/specs/config-unification/spec.md`（capability specs）

### 修改文件
- `package.json`：devDependencies（vite/vitest/typescript/node 类型）、scripts
- `server.js`：仅替换硬编码常量为 `require('./config.json')` 读取，逻辑不动
- `config.json`：扩展 + 校准到真实联调值
- `.gitignore`：放行 `config.example.json`，确认 `config.json` 仍在忽略列表

### 不变
- 所有业务逻辑、协议解析、前端交互、硬件通讯行为
- 运行时依赖列表（`ws`/`serialport`/`exceljs` 不动）
- 现有 `.js` 源文件内容（除 server.js 的常量读取方式）
- **`index.html`、`style.css` 内容，以及所有 JS 文件中的样式代码**（`element.style.*`、内联样式、类名操作）——本 change 及后续所有 change 都不得修改
- **遗留代码的调用关系与启用状态**（见下"遗留代码处理"）

### 遗留代码处理（本 change 及后续通用）
项目中存在遗留且当前不再需要但仍存在的代码，典型例子是 **ffmpeg / RTSP 视频流相关逻辑**（`startVideoStream` / `stopVideoStream` / `broadcastVideoFrame` 及二值化视频流等——server 启动时仍会自动 spawn ffmpeg 连接 RTSP）。处理原则：
- **保留**：不删除任何遗留代码，包括已注释的大段调试代码（如 `TcpBridge.js` 中的 base64 解析、HexString 调试等）。
- **随迁移一并 TS 化**：当某个模块进入迁移 change 时，其中的遗留代码与正常代码一同转为 TS。
- **不改变启用状态与调用关系**：保持遗留代码当前的调用关系——原本被调用的（如 ffmpeg 自动启动）继续被调用，原本未被调用的继续不被调用。**不得新增对遗留代码的调用、不得特意将其接入主流程，也不得主动断开其现有调用**（后者属于"行为不变"约束）。
- **逻辑不动**：TS 化只改类型与结构，遗留代码内部的运行逻辑逐字保持。
- **配置项随代码保留**：ffmpeg 路径、RTSP 地址等遗留功能对应的配置项继续保留在 `config.json`（因对应代码保留），但配置项存在不等于"接入"，不影响上述调用关系原则。

### 验收
- `npm run typecheck` 通过（无 .ts 时也应正常退出）
- `npm test` 跑通 smoke 测试
- `npm run dev` 前端能起，`node server.js` 后端能起，浏览器打开页面、WS 连接、UDP 桥接行为与重构前**逐字一致**（人工对照一次完整链路）
- 本 change 验收通过后**立即 git 提交一次**

### 风险与对策
- **风险 1**：config 校准时抄错值导致联调环境失联。**对策**：以 `server.js` grep 出的原始值为唯一真相，逐项 diff 校对；保留 `config.example.json` 记录模板。
- **风险 2**：Vite 下前端 WS 连接或 CSV 加载异常。**对策**：前端 WS 用 `window.location.hostname` 直连后端 8081/8082（后端 wss 不校验 origin，vite.config.ts 不配 WS 代理）；CSV 等静态资源经 HTTP 代理到后端 8080；验收时浏览器人工核对。
- **风险 3**：`strict: false` 起步会让 TS 保护打折。**对策**：本 change 只搭基线不写业务 TS；后续迁移各模块时在各自 change 里逐步打开 strict 标志。
