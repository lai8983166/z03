## Context

change 3b（server-finalize）在归档时把"桥实现层 @ts-nocheck"显式留给后续 change——`TcpBridge.ts:1` 与 `js/Udp.ts:1` 是全后端仅剩的两条 `@ts-nocheck`。两个文件合计 652 行，承担协议层核心：

- `TcpBridge`：WS + dgram 双通道桥，`handleData` 按字节头（`0x13 0x02`）+ AR（`0x54`/`0x32`/`0x4A`）+ cmd 路由，emit `rs485` 事件；当前生产 USE_TCP=true 走它
- `UdpBridge`：UDP-only 桥，`_handleMessage` 按命令表路由；当前未被实例化（遗留备选），调用关系不变

protocol-layer-ts change 已给 4 个协议层文件（含这两个）加过 JSDoc，但只是注释级，未消除 `@ts-nocheck`。protocol-regression-tests 主 spec 已对 `handleData`/`_handleMessage` 提供 50+ 测试覆盖（构造 Buffer 输入 + emit 断言），构成本 change 的安全网。

约束（来自 openspec/config.yaml）：
- 测试一律 mock，禁碰真实端口/IP/串口/子进程
- 不改 index.html/style.css/JS 样式
- 遗留代码（含 TcpBridge.js 注释里的 base64/HexString 调试、UdpBridge 未启用路径）保留并 TS 化，调用关系不变

## Goals / Non-Goals

**Goals:**
- 移除 `TcpBridge.ts:1` 与 `js/Udp.ts:1` 的 `@ts-nocheck`
- 给两个文件的 class 字段、方法签名、命令表、Buffer 处理加完整 TS 类型，使 `tsc -p tsconfig.node.json --noEmit` 对它们生效并通过
- 已有 JSDoc（`@typedef CmdDef` / `@type {...}`）转为 TS `interface`，避免重复
- 评估并尽量清理 `bridges.ts` 内对 TcpBridge/UdpBridge 实例的 `// @ts-expect-error` / `as` 断言（若桥层类型已足够）
- `npm test`（61 个）保持全绿
- 行为逐字不变（与 protocol-layer-ts 一致，只允许加类型标注与 interface/类型断言）

**Non-Goals:**
- **不**动 `js/CommandBuilder.js` 与 `js/BinaryTableHelper.js`——这两个仍是 `.js` + JSDoc，本 change 不升级（它们当前未被 `@ts-nocheck` 跳过，已有 JSDoc 通过 typecheck；升级留下一 change）
- **不**改任何协议解析逻辑、命令表数值、字节布局
- **不**开 `strict: true`（tsconfig 保持 `strict:false`，留独立 change）
- **不**改 `UdpBridge` 的"未被实例化"现状（遗留备选，不接入主流程）
- **不**改测试代码（除非 typecheck 暴露测试自身的类型错，此时只修测试类型不改断言）

## Decisions

### D1: 命令表 typedef 转 TS interface

**决定**：把 `@typedef CmdDef` 转为 `interface CmdDef { cmd1: number; cmd2: number; flag: number; len: number; }`，命令表常量从 `@type {{ [name: string]: CmdDef }}` 改为 `const CMD_54: Record<string, CmdDef> = {...}`。

**理由**：JSDoc typedef 与 TS interface 同义，但 interface 在 TS 工具链（hover/跳转/补全）上体验更好；同时去掉 JSDoc 重复声明。

**替代方案**：保留 JSDoc typedef，仅移除 `@ts-nocheck` —— 风险：tsc 仍可能对部分调用点报类型错（JSDoc 推断不完整），且与"完整 TS 类型"的 goal 不符。否决。

### D2: class 字段显式声明 + 访问修饰符不强制

**决定**：TcpBridge / UdpBridge 的实例字段（`socket`/`remote`/`isBound`/`localPort`/`currentCmd` 等）MUST 在 class 顶部显式声明类型，**不**强制加 `public`/`private`/`readonly`（保留与原代码的访问语义，避免引入访问修饰符带来的运行/编译期约束变化）。

**理由**：本 change 是"补类型"，不是"重构访问控制"。原代码字段全公开（无修饰符），保留这一现状最小化风险。

**替代方案**：把内部字段标 `private`——风险：测试代码（`tests/protocol/tcp-bridge.test.ts`）可能直接读写字段，加 private 会破坏测试。否决。

### D3: EventEmitter 子类与 emit 类型

**决定**：`class TcpBridge extends EventEmitter`，**不**引入强类型 `EventEmitter<{ rs485: [...] }>`（即不重写 emit/on 签名）。原代码 `emit("rs485", {flag, name, data})` 保持原样。

**理由**：强类型 EventEmitter 在 TS 上需要 `EventEmitter` 子类泛型重写 + 与 Node 类型互动复杂；本项目测试只检查 emit 后监听器收到的对象形状，不强类型也通过。属于"成本高于收益"，留后续 change。

**替代方案**：用 `declare interface TcpBridge { on(event: "rs485", listener: (...) => void): this; ... }` 加强类型——风险：声明与实现可能不同步，引入伪错误。本 change 不做。

### D4: Buffer 与 Uint8Array 联合

**决定**：方法签名统一用 `Buffer`（Node 类型），**不**用 `Buffer | Uint8Array` 联合，即使 `dgram.Socket` 的 message 事件回调签名是 `(msg: Buffer, rinfo: RemoteInfo)`。如果 dgram 类型推断成 `Uint8Array`（取决于 @types/node 版本），用 `Buffer.from(msg)` 转换或 `as Buffer` 断言，MUST 注明原因。

**理由**：项目内部协议处理统一基于 `Buffer`（slice/readUInt16LE/write 等都是 Buffer 方法）；引入联合类型会让所有下游代码加 narrowing，成本过高。

### D5: dgram socket / WebSocket 字段类型

**决定**：
- `socket: dgram.Socket`（UdpBridge）
- `ws: WebSocket | null`（TcpBridge，因 WS 是可选通道，USE_TCP=true 时才有）
- `localPort: number`

**理由**：直接用 @types/node 与 @types/ws 提供的类型，不引入自定义包装。

### D6: bridges.ts 内 expect-error 清理

**决定**：本 change 完成桥层类型后，**视情**清理 `bridges.ts` 内的 `// @ts-expect-error` 与 `as` 断言：
- 若桥层类型足以支撑 `udpBridge.on("ready", ...)` 与 `udpBridge.init(...)` 直接通过类型检查 → 移除 expect-error / 断言
- 若 EventEmitter 的 `.on` 重载仍不识别自定义事件名 → 保留 `// @ts-expect-error` 并注明"EventEmitter 自定义事件，TS 内置重载不识别"

**理由**：移除 expect-error 是清理债务，但若清理本身需要重写 EventEmitter 类型（D3 已不做），则保留更稳妥。

### D7: `@ts-expect-error` 在桥文件内的使用规则

**决定**：本 change 在 `TcpBridge.ts` / `js/Udp.ts` 内**尽量不引入新的 `@ts-expect-error`**；只有以下情形允许使用并 MUST 注明原因：
- Node 内置 API 类型与运行时行为不一致（罕见）
- 第三方库（@types/node/ws）类型缺失

**理由**：`@ts-expect-error` 是逃生舱，滥用会让"完整 TS 类型"目标失真。本 change 的 goal 是尽量让类型自然通过。

### D8: 单 commit，可回滚

**决定**：本 change 全部改动一个 commit（与项目历史 9 个 change 一致）。回滚用 `git revert`。

## Risks / Trade-offs

- **[类型化引入伪错误，掩盖真实逻辑]** → 缓解：`npm test` 61 个测试全绿作为不可妥协的门禁；protocol-regression-tests 的 50+ 测试专门覆盖 `handleData`/`_handleMessage`，任何协议解析误改会被立即抓住
- **[Buffer vs Uint8Array 类型冲突大面积爆发]** → 缓解：D4 策略统一用 Buffer；如某 API 强制返回 `Uint8Array`，用 `Buffer.from()` 包装（运行时无开销，Buffer.from(buf) 共享内存）
- **[EventEmitter 自定义事件类型让 .on 调用大量报错]** → 缓解：D3 不强类型化 EventEmitter；如确实需要，用 `declare interface` 增量加（非替换）
- **[bridges.ts expect-error 清理反而引入新错误]** → 缓解：D6 保守策略——只在能直接通过类型检查时清理，否则保留并注明原因
- **[遗留调试代码（base64/HexString）类型化成本高]** → 缓解：保留代码 + 给最低限度的类型（如 `// @ts-expect-error: 遗留调试代码，保留以便未来启用`）；不删除（约束）
- **[测试代码自身的类型错]** → 缓解：测试已经全绿，typecheck 也通过，预期测试代码类型 OK；若个别报错只修测试类型不改断言
