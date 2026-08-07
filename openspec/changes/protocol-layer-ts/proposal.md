# Proposal: 协议层回归测试与 JSDoc 类型

## 背景：在重构蓝图中的位置

本 change 是整体 TS 重构的第 2 步（共 5 步），承接 change 1（`setup-ts-baseline`）的工程基线。

| 序号 | Change | 状态 |
|---|---|---|
| 1 | setup-ts-baseline（TS/Vite/Vitest 基线 + config 统一） | ✅ 已完成 |
| **2（本 change）** | **协议层回归测试 + JSDoc 类型** | 进行中 |
| 3 | `server.js` 拆分 + 整体 TS 化（含后端协议层真 .ts 迁移） | 待启动 |
| 4 | 前端 `Command.js` 拆分 + TS 化（含前端协议层真 .ts 迁移） | 待启动 |
| 5 | 前端其余模块逐个 TS 化 | 待启动 |

## Why

协议层是项目核心——字节级解析（`TcpBridge.handleData` 里 `msg[12]/[13]/[14]` 等魔数位操作）、命令路由（CMD_54/32/4A 命令表）、二进制布局（`BinaryTableHelper` 的 `_loc.csv` 内存布局 + DataView 读写 + scale/endian）、组包（`CommandBuilder.buildPacket` 的 16 字节包头）。这些逻辑**功能已与硬件联调通过**，但：

1. **零回归保护**：任何后续改动（change 3 拆 server、change 4 拆 Command.js）都可能悄悄改变协议解析行为，而当前无测试能抓住。重构前必须先锁住这些已验证的行为。
2. **零类型保护**：`msg[14]`、`item.offset`、`def.cmd1` 等全是 `any`，字节布局错误在编译期不可见。
3. **是后续 change 的安全网**：change 3/4/5 做"真 .ts 迁移"时，必须有测试兜底确认行为不变。

## What Changes

本 change 的核心是**先锁行为、再加类型**，**不改变量结构与文件形态**。

### 关键决策：为什么用 JSDoc 而非真 .ts

用户已确认（见上方 AskUserQuestion）。技术约束：
- **后端** `TcpBridge.js`/`Udp.js` 是 CommonJS，被 `server.js` 用 `require` 加载、`node` 直跑（change 1 决策：不引入 tsx/build）。改为 `.ts` 会让 `require` 失败——真 .ts 迁移必须等 change 3（server 整体 TS 化时引入运行方案）。
- **前端** `CommandBuilder.js`/`BinaryTableHelper.js` 被 `main.js` 和多个 `js/` 模块 import。单独改这两个为 `.ts` 会牵动整条 import 链的路径更新，改动面与风险不成正比。
- 因此本 change 采用 **JSDoc 类型注解**（tsc `allowJs` + IDE 完整识别类型，等价于 TS 类型保护），文件保持 `.js`，import/require 零改动，**行为绝对不变**。真 `.ts` 迁移整体推到 change 3（后端）/ change 4-5（前端）。

### 1. JSDoc 类型注解（4 个文件，逻辑逐字不动）
- `TcpBridge.js`：`CMD_54`/`CMD_32`/`CMD_4A` 命令表项类型、`handleData(msg, port)` 参数与 emit 事件 payload 类型、模块级 `heixiazi_flag`/`upload_count_6000h` 类型。
- `js/Udp.js`：`CMD` 表类型、`_handleMessage(msg, rinfo)` 类型（遗留代码，注解同上，调用关系不变）。
- `js/CommandBuilder.js`：`buildPacket(cmdByte1, cmdByte2, payload)` 参数与返回 `Uint8Array`、`bufferToHex` 类型（已有部分 JSDoc，补全）。
- `js/BinaryTableHelper.js`：`DataType` 枚举、`BinaryTableHelper` 类各方法的 `metaData` 项类型/`index`/`offset`/`scale`、`PacketManager` 类型。

### 2. 回归测试（vitest，全程 mock，零真实网络/串口/子进程）
测试文件位置：`tests/protocol/*.test.ts`（被 change 1 的 `vitest.config.ts` include 覆盖）。

**测试范围**（纯逻辑 + 构造实例测 emit，不碰 socket/fetch/DOM）：
- **CommandBuilder**（纯函数）：
  - `buildPacket`：各种 cmd/payload 组合 → 输出字节布局（固定头 0x13 0x02、长度字段小端、地址位 0x54/0x52、命令字、payload 拼接）
  - `bufferToHex`：Uint8Array → hex 字符串
- **BinaryTableHelper**（纯逻辑，不碰 DOM）：
  - `parseLocData`：输入构造的 `_loc.csv` 文本 → 检查 metaData 字段、offset 计算、totalBytes、buffer 分配
  - `setValue`/`getValue`：各 DataType（UINT8/16/32、INT、FLOAT）的写入读回、scale 换算、endian
  - `getValueByName`/`setValueByName`/`getIndexByName`：按名查找 + 读写
  - `formatFloat`：整数、小数、科学计数法分支
  - `getAllValues`/`copyTo`/`loadBufferFromNet`：buffer 操作
- **TcpBridge.handleData**（构造 `new TcpBridge()` 实例，监听 emit，喂构造的 Buffer，不调 `init`/`bindUDP`/`connectWS`）：
  - 各 AR（0x54/0x32/0x4A）+ 各 cmd → emit `rs485` 的 flag/name/data
  - 短包 / 非法头（不是 0x13 0x02）→ 不 emit
  - localPort==30042 分支 → emit `YC`
  - `heixiazi` 分支（msg[0]==0x13 && msg[1]==0x00/0x01）
  - 6000H 代码上传分支（protocolAt==0x52 + CODE_UPLOAD_6000H_AR）
  - **构造实例不碰 socket**：只调 `handleData`，不调 `init`/`connectWS`/`bindUDP`/`sendPacket`
- **UdpBridge._handleMessage**（同理，构造实例 + 喂 Buffer，不调 `init`）

**不测**（本 change 范围外）：
- ❌ DOM 相关方法：`BinaryTableHelper.readCell`/`updateBufFromTable`/`updateAllFromTable`/`updateAllToTable`/`getAllNames`/`getSpecInfo`（依赖 `document`，留 change 4/5 引入 jsdom 时再测）
- ❌ `PacketManager.init`（依赖 `fetch`，测试要 mock fetch，价值有限，留后续）
- ❌ socket 相关：`bindUDP`/`connectWS`/`sendUDP`/`sendWS`/`sendPacket`（碰真实网络，违反测试隔离）

### 不在本 change 范围
- ❌ 任何文件 `.js` → `.ts` 改名（留 change 3/4/5）
- ❌ 任何 import/require 路径改动
- ❌ 任何业务逻辑、字节布局、命令表数值的修改（哪怕看起来是 bug——本 change 只锁行为，不改行为）
- ❌ DOM 相关方法的测试
- ❌ `DataHandler.js`（应用层路由，依赖 change 4 的 Command.js 拆分，留 change 4）

## Capabilities

### New Capabilities
- `protocol-regression-tests`：协议层（TcpBridge / Udp / CommandBuilder / BinaryTableHelper）的纯逻辑回归测试套件，锁住字节解析、命令路由、二进制布局的已验证行为，为后续 TS 迁移提供安全网。

### Modified Capabilities
- 无。本 change 不改变任何业务行为，只加类型注解与测试。

## Impact

### 新增文件
- `tests/protocol/command-builder.test.ts`
- `tests/protocol/binary-table-helper.test.ts`
- `tests/protocol/tcp-bridge.test.ts`
- `tests/protocol/udp-bridge.test.ts`
- `openspec/specs/protocol-regression-tests/spec.md`（capability spec）

### 修改文件（仅加 JSDoc 注解，逻辑逐字不动）
- `TcpBridge.js`
- `js/Udp.js`
- `js/CommandBuilder.js`
- `js/BinaryTableHelper.js`

### 不变
- 所有业务行为、协议解析、字节布局、命令表数值
- 所有文件扩展名（保持 `.js`）
- 所有 import / require 路径
- `index.html`、`style.css`、JS 样式代码（全局约束）
- 遗留代码调用关系（`Udp.js` 仍不被实例化、ffmpeg 仍按原样运行）

### 验收
- `npm run typecheck` 通过（JSDoc 注解不引入类型错误）
- `npm test` 通过（新增协议层测试全绿）
- `git diff` 确认 4 个源文件的改动**只增加注释/类型注解**，可运行代码逐字不变（可用 `git diff --stat` 看 insertions，配合人工审查）
- 测试全程零真实网络/串口/子进程/DOM（符合测试隔离 spec）
- 本 change 验收通过后**立即 git 提交一次**

### 风险与对策
- **风险 1**：JSDoc 注解时手滑改了逻辑。**对策**：只动注释/`@type`/`@param`/`@returns`，不改可执行语句；`git diff` 审查时确认无逻辑改动；测试全绿作为行为不变的客观证据。
- **风险 2**：`BinaryTableHelper.parseLocData` 的 CSV 格式复杂，测试构造的输入不真实。**对策**：从 `csv/` 目录取一个真实 `_loc.csv` 片段作为测试 fixture（构造一小段代表性 CSV 文本，不读真实文件——直接在测试里写字符串字面量，避免 fetch）。
- **风险 3**：`TcpBridge.handleData` 测试时模块级 `heixiazi_flag`/`upload_count_6000h` 状态在测试间污染。**对策**：每个相关测试用例独立构造输入、显式重置或用 `beforeEach` 处理；这些变量是 handleData 的协议状态，测试它必然涉及。
- **风险 4**：JSDoc 注解后 `tsc --noEmit` 报新的类型错误（暴露潜在 bug）。**对策**：若发现的"bug"是当前实际行为，**不改行为**（行为不变约束），而是在 JSDoc 里用精确类型如实描述当前行为，或在该处加 `// @ts-expect-error` 注释说明（优先如实描述）。
