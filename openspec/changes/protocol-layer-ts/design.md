# Design: protocol-layer-ts

## Context

协议层 4 个文件是项目核心，功能已与硬件联调通过：
- `TcpBridge.js`（后端 CJS，16KB）：`CMD_54`/`CMD_32`/`CMD_4A` 命令表 + `handleData(msg, port)` 字节解析与事件分发；当前 `USE_TCP=true` 走它。
- `js/Udp.js`（后端 CJS，遗留）：`UdpBridge` 类 + 自有 `CMD` 表 + `_handleMessage`；当前未被实例化（`USE_TCP=true`），按遗留代码原则保留并加注解、不接入。
- `js/CommandBuilder.js`（前端 ESM）：`buildPacket`（16 字节包头 + payload）+ `bufferToHex`，纯函数。
- `js/BinaryTableHelper.js`（前端 ESM，22KB）：`BinaryTableHelper`（`_loc.csv` 内存布局 + DataView 读写 + scale/endian）+ `PacketManager`（多协议管理，`init` 用 fetch）。

change 1 已建立 TS/Vitest 基线（`allowJs`/`tsc --noEmit`/`vitest`）。本 change 在此基础上为协议层补类型与测试。

## Goals / Non-Goals

**Goals**
- 4 个协议层文件添加 JSDoc 类型注解（tsc/IDE 完整识别）。
- 协议层纯逻辑回归测试覆盖（CommandBuilder / BinaryTableHelper 纯方法 / TcpBridge.handleData / UdpBridge._handleMessage）。
- 行为绝对不变：只加注释/注解，可执行代码逐字不动。

**Non-Goals**
- 不改任何文件 `.js` → `.ts`（留 change 3 后端整体 / change 4-5 前端整体）。
- 不改 import / require 路径。
- 不测 DOM 相关方法（`readCell`/`updateAllToTable`/`getAllNames`/`getSpecInfo` 等，留 change 4/5 引入 jsdom）。
- 不测 `PacketManager.init`（依赖 fetch，价值有限）。
- 不改任何业务逻辑（哪怕看似 bug——本 change 只锁行为）。

## Decisions

### D1. JSDoc 而非真 .ts（用户已确认）
后端 `TcpBridge`/`Udp` 被 `server.js` 用 `require` 加载、`node` 直跑（change 1 决策不引入 tsx/build），改 `.ts` 会让 `require` 失败；前端 `CommandBuilder`/`BinaryTableHelper` 单独改 `.ts` 牵动整条 import 链。因此本 change 用 JSDoc 注解（`allowJs` 下 tsc/IDE 完整识别类型），文件保持 `.js`，import/require 零改动。真 `.ts` 迁移推到 change 3（后端，引入运行方案）/ change 4-5（前端，整体更新 import 链）。

### D2. TcpBridge/UdpBridge 测试：构造实例 + emit 监听，不碰 socket
`TcpBridge extends EventEmitter`，构造函数只初始化字段（`recvBuffer = Buffer.alloc(0)` 等），不创建 socket。测试方式：
```ts
const bridge = new TcpBridge();
const events: any[] = [];
bridge.on("rs485", (e) => events.push(e));
bridge.handleData(Buffer.from([...]), 30041);
expect(events).toEqual([...]);
```
MUST NOT 调用 `init`/`bindUDP`/`connectWS`/`sendPacket`（这些才碰 socket）。`handleData`/`_handleMessage` 是纯解析（emit 事件），安全。

### D3. BinaryTableHelper 测试 fixture：CSV 字符串字面量
`parseLocData` 接收 CSV 文本。测试**不读真实文件、不 fetch**——直接在测试里写构造的 CSV 字符串字面量（含各类型 + scale + RES 的代表性片段）。这样测试自包含、零 IO、可在 CI 跑。
```ts
const csv = "name1,0+UINT16+0.1,name2,1+RES+4,2+FLOAT+1.0";
helper.parseLocData(csv);
```
（实际 `_loc.csv` 格式：`名称,序号+类型+scale` 交替列；fixture 按此构造。）

### D4. DOM 方法不测
`BinaryTableHelper` 的 `readCell`/`updateBufFromTable`/`updateAllFromTable`/`updateAllToTable`/`getAllNames`/`getSpecInfo` 用 `document.getElementById`，需要 jsdom。本 change 不引入 jsdom（受"不引入依赖"+ 这些方法更偏 UI 桥接），留 change 4/5 前端整体 TS 化时统一处理。本 change 给它们加 JSDoc `@param`/`@returns`，但**不写测试**。

### D5. JSDoc 暴露的"潜在类型问题"处理
加 JSDoc 后 `tsc --noEmit` 可能暴露出当前代码的潜在类型不一致（如 `item.type` 在 `if (!type) type = typeStr` 后是 string，与 DataType 枚举不符）。处理原则：**如实描述当前行为，不改行为**。优先用精确的 JSDoc 类型（如 `DataType | string`）如实标注；必要时用 `// @ts-expect-error` 配注释说明"当前行为如此，本 change 不修"。绝不为了"修类型"而改可执行逻辑。

### D6. 模块级状态污染（TcpBridge.handleData）
`handleData` 读写模块级 `heixiazi_flag`（`let`）。测试 heixiazi 分支时，用例间可能污染。对策：相关测试用 `beforeEach` 不易重置模块级 `let`（CommonJS 模块缓存），故**把 heixiazi 相关测试设计为自包含**——按协议顺序构造输入（先发 `msg[0]==0x13 && msg[1]==0x00` 置 flag，再发 `0x13 0x01` 触发 emit），在同测试用例内完成完整流程；不依赖跨用例的 flag 状态。

## Risks / Trade-offs

- **JSDoc 手滑改逻辑** → 只动注释/`@type`，`git diff` 审查可执行代码逐字不变；测试全绿作客观证据。
- **CSV fixture 不真实** → fixture 含各类型代表性片段；`parseLocData` 的 offset/scale 逻辑用多组小 case 覆盖。
- **模块级状态污染** → heixiazi 测试自包含（D6）。
- **tsc 暴露类型 bug** → 如实描述当前行为（D5），不改逻辑。
- **JSDoc 类型不如真 .ts 严格** → 本 change 是过渡；change 3-5 转 .ts 时收紧。

## Migration Plan

- 开发工具类 change，无部署迁移。
- 顺序：JSDoc 注解（4 文件）→ 回归测试（4 测试文件）→ 验收（typecheck + test + git diff 审查）→ git commit。
- 回滚：`git revert`。JSDoc 注解与测试都是新增性质，revert 后行为不变（注解删掉、测试删掉，源文件逻辑本就没动）。
