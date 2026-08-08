## Context

批 A 完成 8 个小文件 TS 化，本批是 5 个中等文件（500-1500 行）。

| 文件 | 行数 | 角色 |
|---|---|---|
| YC.js | 959 | YC 遥测数据处理 + YC 回放（类似 Infrared.ts 但更复杂） |
| ImageUpload.js | 949 | 0B00H 图像上传协议处理 + 上传回放 |
| DataRouter.js | 1059 | 数据链（SJL）路由 |
| CodeUpload.js | 1153 | 代码上传（CXSC 9000H / a000H）协议处理 |
| TurntableControl.js | 1355 | 转台控制 UI + 协议构造 |

依赖：5 个文件相互依赖较少（业务模块），但都依赖批 A 完成的模块（Client/StatusBar 等）与剩余 .js（Video/Command）。

约束（openspec/config.yaml）：测试 mock / 不改 index.html/style.css/JS 样式 / 遗留代码保留。

## Goals / Non-Goals

**Goals:**
- 5 个文件 rename `.ts` + 完整 TS 类型
- typecheck 0 错 / test 61/61 全绿

**Non-Goals:**
- 不改 main.js / index.html
- 不改批 C 大文件（Video/Command）的内容（但若其 import 这 5 个文件的导出形状变化导致错，由本批处理）
- 不改测试断言
- 不重构架构

## Decisions

### D1: 复用批 A 的设计模式

**决定**：批 A 的 D1-D7（批量 rename + 集中类型化、import 去后缀、DOM narrowing、事件 payload 用 unknown + 断言或 inline interface、跨 .js 边界 expect-error 注明、单 commit）全部沿用。

### D2: 用 background agent 并行处理

**决定**：5 个文件每个起一个 background agent，并行处理。每个 agent 负责一个文件的全流程（Read → 修类型 → typecheck → 验证 → 报告）。

**理由**：批 A 用 3 个 agent 处理 5 个文件加速明显。批 B 5 个文件每个 ~1000 行，并行更显著。Agent 之间不冲突（不同文件）。

**协调**：每个 agent 只跑 `npm run typecheck | grep <自己文件>`，避免互扰。最后我做全量验证。

### D3: 跨 .js 边界（Video/Command）类型缺失处理

**决定**：批 B 文件 import Video.js / Command.js 的导出（如 isSavingVideo、handle_X 等函数），TS 推断为宽松类型或参数数量不足。处理方式：
- 调用方少传参数 → 加 `// @ts-expect-error: X 来自 Command.js（change C 处理），实际接受 N 参数`
- 调用方传错类型 → 视情况断言或 expect-error

每个 expect-error MUST 注明具体原因（"X 来自 .js"）+ change C 处理。

### D4: 单 commit

**决定**：本 change 全部改动一个 commit。

## Risks / Trade-offs

- **[5 文件 ~5000 行类型化工作量超 spec 范围]** → 缓解：5 个 background agent 并行；每个 agent 独立验证自己文件 0 错
- **[跨 .js 边界 expect-error 大量引入]** → 缓解：D3 规则——每个注明原因 + change C 处理；目标是 ≤ 10 处（批 A 是 2 处，批 B 文件多预期更多）
- **[agent 之间 import 推断冲突]** → 缓解：每个 agent 独立处理自己文件；如果两个 agent 互相依赖对方的导出形状变化，最后我做全量验证时修
- **[DOM narrowing 大量引入 if 守卫]** → 缓解：用 `as` 断言（运行时已隐式假设），减少 if 守卫
- **[遗留代码（已注释、未启用分支）类型化成本]** → 缓解：保留代码 + 最低限度类型
