# Spec Delta: protocol-regression-tests（DataHandler 路由测试）

> 本 change 给 protocol-regression-tests capability 加入 DataHandler.handleRS485 的路由测试覆盖。

## MODIFIED Requirements

### Requirement: 协议层纯逻辑测试覆盖
项目 MUST 为协议层的纯逻辑提供回归测试，至少覆盖：`CommandBuilder.buildPacket`/`bufferToHex`；`BinaryTableHelper.parseLocData`/`setValue`/`getValue`/`getValueByName`/`setValueByName`/`getIndexByName`/`formatFloat`/`getAllValues`/`copyTo`/`loadBufferFromNet`；`TcpBridge.handleData` 的各 AR(0x54/0x32/0x4A) 与命令字路由、短包/非法头、`localPort==30042` 的 YC 分支、heixiazi 分支、6000H 代码上传分支；`UdpBridge._handleMessage` 的命令表路由；**`DataHandler.handleRS485` 的 flag 路由（case 0/1/2/3/5/9/10/15/16/17/19/20/21/22/23/24/25/27/30/40/41/42/44 等）**。

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

#### Scenario: DataHandler.handleRS485 按 flag 路由调对应 handler
- **WHEN** mock 所有 handler imports，调用 `handleRS485(flag, name, Buffer)`（flag 取 0/1/2/.../44）
- **THEN** 对应的 mock handler 被以预期参数调用（如 flag=0 → handle_FJYJZ_2000H(data)）

#### Scenario: DataHandler.handleRS485 含 data[0] 分支的 case 覆盖
- **WHEN** 调用 `handleRS485(19, name, Buffer.from([0x15, ...]))` 或 `Buffer.from([0x40, ...]))`
- **THEN** 对应 0x15 / 0x40 分支的 mock handler 被调用

#### Scenario: DataHandler.handleRS485 未知 flag 走 default
- **WHEN** 调用 `handleRS485(999, name, Buffer)`（无对应 case）
- **THEN** 不抛错，console.warn 被调用
