## Context

| 模块 | 可测函数 | 难度 |
|---|---|---|
| Chart.ts | getChartFrameCounter / incrementChartFrameCounter / addChartDataPoint / setCurveVisible | 低-中（counter 不依赖 DOM；数据点管理依赖 ChartState.chartData 初始化） |
| Command.ts | loadCommand_SJCJ / loadCommand_SJCJ_F000H（export） | 中（async + 含 setTimeout sleep + 多次 sendUdp） |
| data.ts | normalizeSJCJExcelRow / normalizeHeixiaziExcelRow（闭包内） | 高（无法直接 import；本 change 不做） |

## Goals / Non-Goals

**Goals:**
- Chart.ts counter + 数据点管理测试
- Command.ts export loadCommand_* 测试（packet 字节布局正确性）
- 全 mock，不接触真实 IO/DOM
- typecheck 0 错 / 现有 120 测试仍全绿

**Non-Goals:**
- 不测 Chart.ts 的 canvas 渲染（drawGrid/drawAxes 等需 canvas mock，价值低）
- 不测 Command.ts 内部非 export 的 loadCommand_*（无法访问）
- 不测 data.ts normalize（闭包限制）
- 不改业务代码

## Decisions

### D1: Chart.ts counter 测试不依赖 DOM

**决定**：getChartFrameCounter / incrementChartFrameCounter 操作 module-level `chartFrameCounter`，不需要 ChartState.chartData 初始化。直接 import + 调用 + 验证。

**注意**：incrementChartFrameCounter 达 maxPoints 时重置 + 清空 chartData。如果 chartData 未初始化（{}），`Object.values({})` 是 []，for 循环不执行——安全。

### D2: Chart.ts addChartDataPoint/setCurveVisible 未初始化时不抛错

**决定**：未调 initializeChart 时 ChartState.chartData 是 {}（或 undefined）。addChartDataPoint("foo", 0, 1, 100) → `curve = chartData["foo"]` 是 undefined → console.warn + return。测试验证不抛错。

### D3: Command.ts loadCommand mock 策略

**决定**：
- vi.mock("./Client") 返回 `{ default: { sendUdp: vi.fn(), sendText: vi.fn() } }`
- vi.mock("./StatusBar") 等其他副作用 import
- 调用 loadCommand_SJCJ() → 验证 wsClient.sendUdp 被调用 + packet[0]=0x31 等

**async + setTimeout**：用 `vi.useFakeTimers()` + `vi.advanceTimersByTimeAsync(N)` 推进。

### D4: 单 commit

## Risks / Trade-offs

- **[Chart.ts chartData 初始化依赖 DOM canvas]** → 缓解：D2 测"未初始化时不抛错"，counter 部分独立测
- **[Command.ts loadCommand 内部 state 复杂]** → 缓解：选简单的 case 验证；不追求覆盖每个分支
- **[vi.mock hoisting]** → 缓解：vi.mock 在文件顶部
- **[fake timers 与 Promise 交互]** → 缓解：用 advanceTimersByTimeAsync 而非 runAllTimers
