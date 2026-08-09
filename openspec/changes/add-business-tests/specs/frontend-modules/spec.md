# Spec Delta: frontend-modules（业务模块纯函数测试）

> 本 change 给 frontend-modules capability 加入 Chart.ts 纯函数与 Command.ts export loadCommand_* 的单测覆盖。

## ADDED Requirements

### Requirement: 业务模块纯函数测试覆盖
项目 MUST 为前端业务模块的纯函数与协议构造函数提供单测覆盖，至少覆盖：
- `Chart.getChartFrameCounter` / `incrementChartFrameCounter`（含达 maxPoints 重置边界）
- `Chart.addChartDataPoint` / `setCurveVisible`（chartData 未初始化时不抛错）
- `Command.loadCommand_SJCJ` / `loadCommand_SJCJ_F000H`（packet 字节布局正确性，mock wsClient）

#### Scenario: Chart counter 递增 + 重置
- **WHEN** 调用 incrementChartFrameCounter 多次，最后一次达到 maxPoints
- **THEN** getChartFrameCounter 返回 0（重置）

#### Scenario: Chart addChartDataPoint 未初始化时不抛错
- **WHEN** 未调 initializeChart 时调 addChartDataPoint("foo", 0, 1, 100)
- **THEN** 不抛错，console.warn 被调用

#### Scenario: Command.loadCommand_SJCJ 构造 packet 字节布局正确
- **WHEN** mock wsClient.sendUdp，调用 loadCommand_SJCJ()
- **THEN** wsClient.sendUdp 被调用，packet[0]=0x31、packet[1]=0x02 等字节正确
