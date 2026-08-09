# Tasks: add-business-tests（批次 2/3 业务模块测试）

> 全局约定：测试 mock；不改业务代码；不动 index.html/style.css。本 change 补 Chart.ts + Command.ts 业务测试。

## 1. Chart.ts 纯函数测试（skill: eric-writing-tests）

- [x] 1.1 创建 `tests/chart.test.ts`
- [x] 1.2 getChartFrameCounter 初始值
- [x] 1.3 incrementChartFrameCounter 递增
- [x] 1.4 incrementChartFrameCounter 达 maxPoints 重置（验证 getChartFrameCounter 返回 0）
- [x] 1.5 addChartDataPoint 未初始化时不抛错（console.warn）
- [x] 1.6 setCurveVisible 未初始化时不抛错

## 2. Command.ts loadCommand_* 测试（skill: eric-writing-tests）

- [x] 2.1 创建 `tests/command-load.test.ts`，vi.mock Client/StatusBar/etc.
- [x] 2.2 loadCommand_SJCJ：mock wsClient.sendUdp，验证 packet[0]=0x31、packet[1]=0x02、调用次数
- [x] 2.3 loadCommand_SJCJ_F000H：同上，验证 packet 字节布局
- [x] 2.4 用 vi.useFakeTimers 处理 async + setTimeout

## 3. 验证 + 提交

- [x] 3.1 `npm run typecheck` 0 错
- [x] 3.2 `npm test` 通过（120 + ~15-25 新增）
- [x] 3.3 grep 复核无 `as any`
- [x] 3.4 `git commit` + `git push`
