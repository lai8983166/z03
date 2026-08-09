## Why

批次 1 完成 control + DataHandler 路由测试（59 个，总数 61→120）。本 change 是批次 2/3，补业务模块的纯函数与协议构造测试：
- **Chart.ts** export 纯函数（counter / 数据点管理）
- **Command.ts** export `loadCommand_*`（协议命令构造，验证 packet 字节布局）

data.ts 的 normalize 是闭包内部函数，无法直接 import 测，留作未来（需要重构 data.ts 导出 normalize 或通过 createData 间接测，复杂度高）。

## What Changes

- 新增 `tests/chart.test.ts`：测 getChartFrameCounter / incrementChartFrameCounter（含达 maxPoints 重置）/ addChartDataPoint（chartData 未初始化时不抛错）/ setCurveVisible（同）
- 新增 `tests/command-load.test.ts`：测 `loadCommand_SJCJ` 和 `loadCommand_SJCJ_F000H`（mock wsClient.sendUdp，验证 packet[0..N] 字节布局正确）

## Capabilities

### New Capabilities
（无）

### Modified Capabilities
- `frontend-modules`: 加入"Chart.ts 纯函数 + Command.ts loadCommand_* 单测覆盖"约束

## Impact

- **新增测试**：~15-25 个（Chart ~5-8 + Command ~10-17）
- **代码**：不改动业务代码（仅加测试）
- **构建/CI**：`npm test` 从 120 增至 ~135-145
- **运行时**：零影响
- **mock 策略**：所有外部依赖（wsClient / DOM canvas）mock
