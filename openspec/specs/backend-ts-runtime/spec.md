# Spec: backend-ts-runtime

> 后端 TypeScript 运行能力：4 个后端文件转 .ts + tsx 运行器 + 前后端 typecheck 分置 + 后续收尾（server.ts 移除 @ts-nocheck）。本 capability 在 server-modularize-ts change 中建立，并在 server-finalize change 中扩展（移除 server.ts 类型债）。

## Requirements

### Requirement: 后端 .ts 由 tsx 运行
项目 MUST 使用 `tsx` 作为后端 `.ts` 文件的运行器；`npm run dev:server` MUST 执行 `tsx server.ts`（而非 `node server.js`）。`tsx` MUST 作为 devDependency 存在于 `package.json`。

#### Scenario: dev:server 用 tsx 跑 server.ts
- **WHEN** 执行 `npm run dev:server`
- **THEN** 实际执行 `tsx server.ts`，server 正常启动（HTTP/WS/串口/bridge 初始化日志与原 `node server.js` 一致）

### Requirement: 四个后端文件以 .ts 形式存在
`server.js`、`TcpBridge.js`、`js/Udp.js`、`config.js` MUST 转为对应 `.ts` 文件（`server.ts`/`TcpBridge.ts`/`js/Udp.ts`/`config.ts`），原 `.js` 文件 MUST NOT 同时保留（避免双源）。文件内容 MUST 逐字保留业务逻辑，仅允许：扩展名变更、require 路径去 `.js` 后缀、保留 protocol-layer-ts 已加的 JSDoc。

#### Scenario: 后端无残留 .js 双源
- **WHEN** 在项目根与 js/ 目录搜索 `server.js`/`TcpBridge.js`/`Udp.js`/`config.js`
- **THEN** 这四个 .js 文件不存在（已 rename 为 .ts）

#### Scenario: require 路径解析到 .ts
- **WHEN** `server.ts` 执行 `require("./TcpBridge")`
- **THEN** tsx 解析到 `TcpBridge.ts`，加载成功

### Requirement: 前后端 typecheck 分置
项目 MUST 提供两份 tsconfig：根 `tsconfig.json`（前端，`module:ESNext`/`moduleResolution:Bundler`，include 前端 .ts + tests）与 `tsconfig.node.json`（后端，`module:CommonJS`/`moduleResolution:Node`，include `server.ts`/`TcpBridge.ts`/`js/Udp.ts`/`config.ts` 以及后续迁移出的所有后端模块）。`npm run typecheck` MUST 同时跑两份并都通过。

#### Scenario: typecheck 跑前后端两份 tsconfig
- **WHEN** 执行 `npm run typecheck`
- **THEN** 命令等价于 `tsc -p tsconfig.json --noEmit && tsc -p tsconfig.node.json --noEmit`，两者均以退出码 0 通过

### Requirement: 运行时行为逐字不变
本 capability MUST NOT 改变任何业务逻辑、变量结构、函数调用关系、协议解析、遗留代码（ffmpeg/RTSP）调用关系。`tsx server.ts` 的运行时行为 MUST 与重构前 `node server.js` 逐字一致。

#### Scenario: 完整链路人工对照
- **WHEN** 用 `npm run dev:server`（tsx）启动后端，对照重构前 `node server.js` 的运行表现
- **THEN** HTTP 静态服务、WS（8081/8082）连接与消息、3 路 bridge、转台串口、RTSP/ffmpeg 视频流、Excel 数据采集写盘的行为均与重构前一致

#### Scenario: protocol-regression-tests 的协议层测试仍全绿
- **WHEN** 执行 `npm test`
- **THEN** protocol-regression-tests capability 描述的全部测试通过（TcpBridge/Udp 改 .ts 后测试同步调整 import 路径，行为不变）

### Requirement: server.ts 移除 @ts-nocheck
server.ts MUST 移除顶部 `// @ts-nocheck`。`npm run typecheck` 的 node tsconfig MUST 对 server.ts 进行类型检查并通过（剩余入口代码类型化：HTTP req/res、WS ws、message Buffer 联合、cfg Config、装配）。允许在类型化成本过高的局部使用 `// @ts-expect-error` 并注释原因。

#### Scenario: server.ts 通过 typecheck（无 @ts-nocheck）
- **WHEN** 运行 `npm run typecheck`
- **THEN** node tsconfig 检查 server.ts（不再跳过）并通过

#### Scenario: server.ts 无 @ts-nocheck
- **WHEN** grep server.ts `@ts-nocheck`
- **THEN** 无匹配（已移除）

### Requirement: server.ts 无 dead import
server.ts MUST 移除 `spawn` 与 `ExcelJS` 的 import（已随 video/data 迁出，server.ts 无引用）。

#### Scenario: server.ts 无 dead import
- **WHEN** grep server.ts `from "child_process"`（spawn）/`from "exceljs"`
- **THEN** 无匹配（已移除；除非其他代码仍用，若用则保留）

### Requirement: control 的 turntable 注入改用 turntable 实例
server.ts 创建 control 时，opts.turntable.send/setPort MUST 改用 turntable 实例（`turntable.send`/`turntable.setPort`），替代原内联 sendToTurntableSerial/封装逻辑。

#### Scenario: control.turntable.send 走 turntable 实例
- **WHEN** control 的 SEND_TO_BRIDGE2 调 opts.turntable.send(buf)
- **THEN** 调用 turntable 实例的 send（与原 sendToTurntableSerial 行为一致）
