# Spec: protocol-regression-tests

> 协议层回归测试套件 + 完整 TS 类型（4 个文件全部 .ts + 类型化），锁住已联调通过的协议解析行为，作为后续重构的安全网。本 capability 在 protocol-layer-ts change 中建立（JSDoc），bridge-impl-types 升级桥层为完整 TS 类型，protocol-tools-ts 升级 CommandBuilder/BinaryTableHelper 为完整 TS 类型。

## Requirements

### Requirement: 协议层纯逻辑测试覆盖
项目 MUST 为协议层的纯逻辑提供回归测试，至少覆盖：`CommandBuilder.buildPacket`/`bufferToHex`；`BinaryTableHelper.parseLocData`/`setValue`/`getValue`/`getValueByName`/`setValueByName`/`getIndexByName`/`formatFloat`/`getAllValues`/`copyTo`/`loadBufferFromNet`；`TcpBridge.handleData` 的各 AR(0x54/0x32/0x4A) 与命令字路由、短包/非法头、`localPort==30042` 的 YC 分支、heixiazi 分支、6000H 代码上传分支；`UdpBridge._handleMessage` 的命令表路由；`DataHandler.handleRS485` 的 flag 路由（含 data[0] 分支）；`control.handleControlCommand`/`handleJsonControlMessage` 的消息路由（含 saveType 分支、threshold 变化触发 restart、空 port 错误）。

#### Scenario: TcpBridge.handleData 按 AR+cmd 路由 emit rs485
- **WHEN** 构造 `new TcpBridge()` 实例，注册 `rs485` 监听，调用 `handleData(构造的 0x54 AR + 某 cmd 的 Buffer, port)`
- **THEN** 监听器收到 `{flag, name, data}`，flag/name 与 CMD_54 命令表对应项一致，data 为 payload

#### Scenario: 短包/非法头不触发 emit
- **WHEN** 调用 `handleData` 传入长度 < 16 或 `[0]`/`[1]` 非 `0x13`/`0x02` 的 Buffer
- **THEN** 不 emit 任何事件

#### Scenario: BinaryTableHelper 各 DataType 读写一致
- **WHEN** `parseLocData` 解析含各类型（UINT8/16/32、INT、FLOAT32/64、RES）的 CSV，`setValue` 写入后 `getValue` 读回
- **THEN** 读回值经 scale 换算后与写入值一致（考虑类型范围与精度）

#### Scenario: CommandBuilder.buildPacket 包头布局正确
- **WHEN** 调用 `buildPacket(0x00, 0x20, payload)`
- **THEN** 输出 `[0]=0x13 [1]=0x02`、`[6-7]` 为 `payload.length+2` 的小端序、`[12]=0x54 [13]=0x52`、`[14]=0x00 [15]=0x20`、`[16..]` 为 payload

### Requirement: 测试的网络/硬件/DOM 隔离
所有协议层测试 MUST 通过纯函数或构造实例方式隔离，MUST NOT 绑定真实端口，MUST NOT 连接真实 IP，MUST NOT 打开真实串口，MUST NOT 触发真实子进程，MUST NOT 依赖浏览器 DOM。`TcpBridge`/`UdpBridge` 测试 MUST 只调用 `handleData`/`_handleMessage` 等纯解析方法，MUST NOT 调用 `init`/`bindUDP`/`connectWS`/`sendPacket` 等碰 socket 的方法。

#### Scenario: 测试不接触 socket
- **WHEN** 运行协议层测试套件
- **THEN** 全程不创建 dgram socket、不连 WebSocket、不打开串口、不 spawn 子进程；只通过构造 Buffer 输入与监听 emit 验证

#### Scenario: 不依赖 DOM
- **WHEN** 运行协议层测试（vitest `environment: node`）
- **THEN** 不调用 `document.getElementById` 等 DOM API；DOM 相关方法（`readCell`/`updateAllToTable` 等）不在测试范围

### Requirement: 协议层完整 TS 类型
4 个协议层源文件（`TcpBridge.ts`、`js/Udp.ts`、`js/CommandBuilder.ts`、`js/BinaryTableHelper.ts`）MUST 全部以 `.ts` 形式存在并提供完整 TS 类型，使 `tsc --noEmit`（tsconfig.node 与 tsconfig.json）能识别字段、参数、返回值类型。其中：
- `TcpBridge.ts` 与 `js/Udp.ts`：class 字段、方法签名、命令表 `interface`/`Record<string, CmdDef>`、Buffer 处理；MUST 移除顶部 `// @ts-nocheck`
- `js/CommandBuilder.ts` 与 `js/BinaryTableHelper.ts`：原 `.js` + JSDoc rename 为 `.ts`；`@typedef MetaItem` 转 TS `interface MetaItem`；DataType 用 `as const` + `DataTypeValue` union；class 字段、方法签名（含 DOM 方法 narrowing）、PacketManager 单例

#### Scenario: 4 个协议层源文件全部通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** tsconfig.json（前端）与 tsconfig.node.json（后端）都通过；4 个文件均提供完整 TS 类型，0 错

#### Scenario: 4 个文件均无 @ts-nocheck
- **WHEN** grep `@ts-nocheck` 4 个文件
- **THEN** 无匹配（CommandBuilder/BinaryTableHelper 由 .js rename 为 .ts，本就无 @ts-nocheck；TcpBridge/Udp 已在 bridge-impl-types 移除）

#### Scenario: 协议解析测试全绿（行为未变）
- **WHEN** 运行 `npm test`
- **THEN** tests/protocol/{tcp-bridge,udp-bridge,command-builder,binary-table-helper}.test.ts 的全部测试通过（断言形状未变，证明类型化未误改协议逻辑）

### Requirement: 源文件行为逐字不变
4 个协议层源文件（`TcpBridge.ts`、`js/Udp.ts`、`js/CommandBuilder.ts`、`js/BinaryTableHelper.ts`）的可执行语句 MUST 逐字不动——只允许：移除 `// @ts-nocheck` 行（如有）、新增类型标注（interface/type/字段声明/参数与返回值类型）、把 `@typedef` 与 `@type {…}` 转 TS 等价物、在类型化成本过高的局部加 `// @ts-expect-error` 并注明原因、rename 文件扩展名、DOM 方法加 `if (!x) return` narrowing（运行时已隐式假设）。MUST NOT 改变任何变量赋值、表达式、控制流、字节布局、命令表数值、CSV 解析、scale/endian 计算。

#### Scenario: 4 个文件 git diff 去掉类型后逐字一致
- **WHEN** 对 4 个文件运行 `git diff`，去掉所有类型标注（interface/type/字段声明/`: T`/`as T`/`// @ts-expect-error`/narrowing 守卫）后
- **THEN** 可执行代码部分与重构前逐字一致（无任何逻辑改动）

### Requirement: import 路径统一（去 .js 后缀）
所有引用 `js/CommandBuilder` 或 `js/BinaryTableHelper` 的文件 MUST 使用无 `.js` 后缀的 import 路径（让 vite/tsx 自动解析 `.ts`）。

#### Scenario: 前端 JS import 路径无 .js 后缀
- **WHEN** grep `js/Command.js`、`js/ImageUpload.js`、`js/Telemeter.js`、`js/YC.js`、`main.js` 的 `BinaryTableHelper.js`
- **THEN** 无匹配（已改为 `./BinaryTableHelper` 或 `./js/BinaryTableHelper`，无 `.js` 后缀）

#### Scenario: 测试 import 路径无 .js 后缀
- **WHEN** grep `tests/protocol/{command-builder,binary-table-helper}.test.ts` 的 import 路径
- **THEN** 无 `.js` 后缀

#### Scenario: tsconfig include 反映 .ts
- **WHEN** 查看 `tsconfig.json` 的 include
- **THEN** 引用 `js/CommandBuilder.ts` 与 `js/BinaryTableHelper.ts`（不再是 `.js`）
