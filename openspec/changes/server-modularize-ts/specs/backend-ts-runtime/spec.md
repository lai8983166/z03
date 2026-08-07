# Spec Delta: backend-ts-runtime

> 本 change 新增后端 TypeScript 运行能力：4 个后端文件转 .ts + tsx 运行器 + 前后端 typecheck 分置。不拆模块、不改业务逻辑，行为绝对不变。

## ADDED Requirements

### Requirement: 后端 .ts 由 tsx 运行
项目 MUST 使用 `tsx` 作为后端 `.ts` 文件的运行器；`npm run dev:server` MUST 执行 `tsx server.ts`（而非 `node server.js`）。`tsx` MUST 作为 devDependency 存在于 `package.json`。

#### Scenario: dev:server 用 tsx 跑 server.ts
- **WHEN** 执行 `npm run dev:server`
- **THEN** 实际执行 `tsx server.ts`，server 正常启动（HTTP/WS/串口/bridge 初始化日志与原 `node server.js` 一致）

### Requirement: 四个后端文件以 .ts 形式存在
`server.js`、`TcpBridge.js`、`js/Udp.js`、`config.js` MUST 转为对应 `.ts` 文件（`server.ts`/`TcpBridge.ts`/`js/Udp.ts`/`config.ts`），原 `.js` 文件 MUST NOT 同时保留（避免双源）。文件内容 MUST 逐字保留业务逻辑，仅允许：扩展名变更、require 路径去 `.js` 后缀、保留 change 2 已加的 JSDoc。

#### Scenario: 后端无残留 .js 双源
- **WHEN** 在项目根与 js/ 目录搜索 `server.js`/`TcpBridge.js`/`Udp.js`/`config.js`
- **THEN** 这四个 .js 文件不存在（已 rename 为 .ts）

#### Scenario: require 路径解析到 .ts
- **WHEN** `server.ts` 执行 `require("./TcpBridge")`
- **THEN** tsx 解析到 `TcpBridge.ts`，加载成功

### Requirement: 前后端 typecheck 分置
项目 MUST 提供两份 tsconfig：根 `tsconfig.json`（前端，`module:ESNext`/`moduleResolution:Bundler`，include 前端 .ts + tests）与 `tsconfig.node.json`（后端，`module:CommonJS`/`moduleResolution:Node`，include `server.ts`/`TcpBridge.ts`/`js/Udp.ts`/`config.ts`）。`npm run typecheck` MUST 同时跑两份并都通过。

#### Scenario: typecheck 跑前后端两份 tsconfig
- **WHEN** 执行 `npm run typecheck`
- **THEN** 命令等价于 `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit`，两者均以退出码 0 通过

### Requirement: 运行时行为逐字不变
本 change MUST NOT 改变任何业务逻辑、变量结构、函数调用关系、协议解析、遗留代码（ffmpeg/RTSP）调用关系。`tsx server.ts` 的运行时行为 MUST 与重构前 `node server.js` 逐字一致。

#### Scenario: 完整链路人工对照
- **WHEN** 用 `npm run dev:server`（tsx）启动后端，对照重构前 `node server.js` 的运行表现
- **THEN** HTTP 静态服务、WS（8081/8082）连接与消息、3 路 bridge、转台串口、RTSP/ffmpeg 视频流、Excel 数据采集写盘的行为均与重构前一致

#### Scenario: change 2 的协议层测试仍全绿
- **WHEN** 执行 `npm test`
- **THEN** change 2 的 50 个测试全部通过（TcpBridge/Udp 改 .ts 后测试同步调整 import 路径，行为不变）
