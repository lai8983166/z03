# Tasks: 3b-5 turntable/bridges + server 收尾

> 全局约定：每 change 提交一次 git；不改 HTML/CSS/JS 样式。本 change 是 change 3b 终点：**移除 server.ts @ts-nocheck（类型债还清）**。@ts-nocheck 移除后类型错数量不确定，逐个修。

## 1. turntable.ts（skill: eric-backend）

- [ ] 1.1 新建 `turntable.ts`：createTurntable(opts) 工厂（opts: wsBus + serialPort + baudRate）；返回 init/send/setPort/close；逐字搬迁 initTurntableSerial/sendToTurntableSerial + 状态；**完整类型，无 @ts-nocheck**
- [ ] 1.2 setPort 封装关旧+设新+init（原 SET_TURNTABLE_PORT 逻辑）
- [ ] 1.3 tsconfig.node include 加 turntable.ts；typecheck 通过

## 2. bridges.ts（skill: eric-backend）

- [ ] 2.1 新建 `bridges.ts`：createBridges(opts) 工厂（opts: wsBus + bridgesConfig[3] + TcpBridge/UdpBridge 构造器）；返回 close；逐字搬迁 3 路 udpBridge 装配（事件监听 + init）；**完整类型，无 @ts-nocheck**
- [ ] 2.2 TcpBridge/UdpBridge 实例 @ts-nocheck 类型不完整 → 用 `as` 断言或 `// @ts-expect-error` 处理 .on/.init
- [ ] 2.3 tsconfig.node include 加 bridges.ts；typecheck 通过

## 3. server.ts 收尾（skill: eric-backend + eric-quality-control）

- [ ] 3.1 import createTurntable/createBridges；创建 turntable/bridges 实例（替代内联）
- [ ] 3.2 移除 turntable 函数/状态（initTurntableSerial/sendToTurntableSerial/TURNTABLE_SERIAL_PORT/turntableSerial/turntableSerialBuf）+ bridges 装配（3 路 udpBridge + 事件 + init + 常量 USE_TCP/UDP*）
- [ ] 3.3 control 的 turntable 注入改用 turntable 实例（`turntable: { send: (buf) => turntable.send(buf), setPort: (p) => turntable.setPort(p) }`）
- [ ] 3.4 SIGINT 改：bridges SIGINT 的 udpBridge.close → bridges.close；turntable.close 加入（若有）
- [ ] 3.5 移除 dead import：`spawn`（video/data 迁了）、`ExcelJS`（data 迁了）—— grep 确认 server.ts 无引用
- [ ] 3.6 移除顶部 `// @ts-nocheck`
- [ ] 3.7 **类型化迭代**：`npx tsc -p tsconfig.node.json --noEmit` → 逐个修类型错（HTTP req/res、WS ws、message Buffer 联合 narrowing、cfg Config、装配）；成本过高处用 `// @ts-expect-error <原因>`
- [ ] 3.8 grep 复核：server.ts 无 @ts-nocheck、无 dead import（spawn/exceljs）、无 turntable/bridges 函数定义残留

## 4. 验收与提交（skill: eric-quality-control + eric-review）

- [ ] 4.1 `npm run typecheck` 通过（**server.ts 无 @ts-nocheck，全后端类型检查通过**——change 3b 类型债终点）
- [ ] 4.2 `npm test` 通过（61）
- [ ] 4.3 `npm run dev:server`（tsx）启动正常（含 turntable/bridges 创建 + 全模块装配）
- [ ] 4.4 grep 复核：server.ts/turntable.ts/bridges.ts 均无 @ts-nocheck；server.ts 无 spawn/exceljs import
- [ ] 4.5 人工触发对照（turntable SET_TURNTABLE_PORT/SEND_TO_BRIDGE2；bridges UDP 事件）
- [ ] 4.6 复核约束：index.html/style.css/JS 样式未动；行为不变
- [ ] 4.7 eric-review 自查（重点：类型错修复质量、turntable/bridges 逐字搬、TcpBridge 断言、dead import 清理）
- [ ] 4.8 `git commit`（change 3b 终点）
