# Tasks: bridge-impl-types（TcpBridge.ts + js/Udp.ts 收类型）

> 全局约定（见 `openspec/config.yaml`）：每个 change 一个 git commit；测试一律 mock；不改 HTML/CSS/JS 样式；遗留代码保留且不接入。本 change 是 change 3b 类型债的最终收尾——移除桥实现层的 `@ts-nocheck`。安全网：`tests/protocol/{tcp-bridge,udp-bridge}.test.ts` 50+ 测试覆盖 `handleData`/`_handleMessage`。设计依据：design.md D1-D8。

## 1. 准备与盘点（skill: eric-quality-control）

- [x] 1.1 跑一次 `npm run typecheck` 确认基线 0 错（当前两个桥文件被 @ts-nocheck 跳过）
- [x] 1.2 跑一次 `npm test` 确认基线 61/61（含 tcp-bridge/udp-bridge 测试作为本 change 安全网）
- [x] 1.3 grep 复核全后端 @ts-nocheck 残留：当前应为 `TcpBridge.ts:1` + `js/Udp.ts:1` 共 2 处（其余应已由 3b 清理）

## 2. TcpBridge.ts 收类型（skill: eric-backend）

- [x] 2.1 移除 `TcpBridge.ts:1` 的 `// @ts-nocheck`
- [x] 2.2 `@typedef CmdDef` → `interface CmdDef { cmd1: number; cmd2: number; flag: number; len: number; }`（D1）
- [x] 2.3 命令表常量类型：`CMD_54` / `CMD_32` / `CMD_4A` 改为 `const CMD_54: Record<string, CmdDef> = {...}`（D1）
- [x] 2.4 class TcpBridge 字段显式声明（不加强制访问修饰符，D2）：`ws: WebSocket | null`、`localPort: number`、`socket: dgram.Socket`、`remote: {...} | null`、`isBound: boolean`、`currentCmd: ...`、buffer/hexString 调试相关字段（遗留保留，D6）
- [x] 2.5 方法签名加类型：constructor、`init(...)`、`handleData(data: Buffer, port: number)`、`connectWS(...)`、`bindUDP(...)`、`sendPacket(...)` 等——参数与返回值统一标注（Buffer 统一，D4；EventEmitter 不强类型，D3）
- [x] 2.6 `npm run typecheck` → 收集 TcpBridge.ts 报出的类型错，逐个修；成本过高处用 `// @ts-expect-error` 并注明原因（D7）
- [x] 2.7 `npm test` → tcp-bridge 测试保持全绿（若测试代码自身有类型错只修类型，不改断言）

## 3. js/Udp.ts 收类型（skill: eric-backend）

- [x] 3.1 移除 `js/Udp.ts:1` 的 `// @ts-nocheck`
- [x] 3.2 `@typedef CmdDef` → TS interface；`CMD` 常量改 `Record<string, CmdDef>`（与 2.2/2.3 一致）
- [x] 3.3 module-level `let bufffer = new Array();` 改 `let bufffer: number[] = []`（D 字段，保持原逻辑）
- [x] 3.4 class UdpBridge 字段显式声明（`socket: dgram.Socket`、`remote: {...} | null`、`isBound: boolean`）
- [x] 3.5 方法签名加类型：constructor、`bindUDP(...)`、`_handleMessage(data: Buffer)`、`sendPacket(...)` 等
- [x] 3.6 `npm run typecheck` → 逐个修类型错；成本过高处 `// @ts-expect-error` 注明原因（D7）
- [x] 3.7 `npm test` → udp-bridge 测试保持全绿

## 4. bridges.ts expect-error 清理（skill: eric-backend）

- [x] 4.1 读 `bridges.ts`，列出所有 `// @ts-expect-error` 与 `as` 断言位置
- [x] 4.2 对每处：移除 `// @ts-expect-error` 后跑 `npm run typecheck`
  - 若直接通过 → 移除（清理成功）
  - 若报错 → 判断是否是 EventEmitter 自定义事件（ready/udp_data 等）的内置重载缺失；若是，保留 `// @ts-expect-error` 并注明具体事件名（D6）
- [x] 4.3 grep 复核 bridges.ts 内剩余 `// @ts-expect-error` 行均带具体原因注释

## 5. 全量验证（skill: eric-quality-control）

- [x] 5.1 `npm run typecheck` 通过（前后端双 tsconfig，0 错）
- [x] 5.2 `npm test` 通过（61 测试全绿）
- [x] 5.3 grep 复核全后端 @ts-nocheck：`*.ts` 应为 0 处（前后端 + tests 全部干净）
- [x] 5.4 `git diff` 复核 TcpBridge.ts / js/Udp.ts：去掉类型标注（interface/type/字段声明/`: T`/`as T`/`// @ts-expect-error`）后，可执行代码与重构前逐字一致
- [x] 5.5 `git diff` 复核未动：index.html、style.css、js/ 下非 Udp 的 .js 文件、tests/ 下断言
- [x] 5.6 复核约束：遗留代码（TcpBridge 注释的 base64/HexString、UdpBridge 未启用路径）保留 + TS 化，调用关系不变
- [x] 5.7 eric-review 自查（重点：类型化是否引入运行时副作用、Buffer 与 Uint8Array 边界处理、@ts-expect-error 是否都有原因注释、bridges 清理是否破坏运行时绑定）

## 6. 提交（skill: eric-review）

- [x] 6.1 `git commit`（本 change 一次提交）
- [x] 6.2 `git push`
