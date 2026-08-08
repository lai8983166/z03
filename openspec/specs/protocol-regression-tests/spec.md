# Spec: protocol-regression-tests

> 协议层回归测试套件 + JSDoc 类型注解，锁住已联调通过的协议解析行为，为后续 .ts 迁移提供安全网。本 capability 在 protocol-layer-ts change 中建立，文件保持 `.js`，行为绝对不变。

## Requirements

### Requirement: 协议层纯逻辑测试覆盖
项目 MUST 为协议层的纯逻辑提供回归测试，至少覆盖：`CommandBuilder.buildPacket`/`bufferToHex`；`BinaryTableHelper.parseLocData`/`setValue`/`getValue`/`getValueByName`/`setValueByName`/`getIndexByName`/`formatFloat`/`getAllValues`/`copyTo`/`loadBufferFromNet`；`TcpBridge.handleData` 的各 AR(0x54/0x32/0x4A) 与命令字路由、短包/非法头、`localPort==30042` 的 YC 分支、heixiazi 分支、6000H 代码上传分支；`UdpBridge._handleMessage` 的命令表路由。

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

### Requirement: 协议层 JSDoc 类型注解
`TcpBridge.js`、`js/Udp.js`、`js/CommandBuilder.js`、`js/BinaryTableHelper.js`（迁 .ts 后文件名对应变化）MUST 添加 JSDoc 类型注解（`@param`/`@returns`/`@typedef`/`@type`），使 `tsc --noEmit`（基线的 `allowJs` 配置）能识别字段、参数、返回值类型。

#### Scenario: tsc 识别 JSDoc 类型
- **WHEN** 运行 `npm run typecheck`
- **THEN** 命令以退出码 0 通过（JSDoc 注解不引入类型错误）

### Requirement: 源文件行为逐字不变
4 个协议层源文件的可执行语句 MUST 逐字不动——只允许增加注释与 JSDoc 注解（`@param`/`@returns`/`@typedef`/`@type` 等），MUST NOT 改变任何变量赋值、表达式、控制流、字节布局、命令表数值。

#### Scenario: 4 个源文件只增加注释
- **WHEN** 对 4 个源文件运行 `git diff`，去掉所有以 `//` 或 `/* */` 包裹的注解后
- **THEN** 可执行代码部分与重构前逐字一致（无任何逻辑改动）
