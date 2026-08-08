## Context

| 文件 | 行数 | 角色 | 预估错 |
|---|---|---|---|
| Video.js | 1804 | RTSP/红外视频流处理 + 二值化 + 视频回放；与 video.ts 后端模块（已 .ts）对应 | 中等 |
| Command.js | 4557 | 协议命令构造 + 处理（CSZD/JGCSZD/IRDetectParam/SJCJ/FJYJZ 等数十个 case） | 高（最大） |

约束：测试 mock / 不改 index.html/style.css/JS 样式 / 遗留代码保留 / 不修业务 bug。

## Goals / Non-Goals

**Goals:**
- 2 文件 rename `.ts` + 完整 TS 类型
- typecheck 0 错 / test 61/61

**Non-Goals:**
- 不改 main.js / index.html
- 不改其他 .ts 文件内容（若跨文件推断失配，由本批最小处理）
- 不修业务 bug（与 CodeUpload 的 `==` 修复不同——本次仅类型化）
- 不重构、不拆模块（Command.js 4557 行保留为单文件）
- 不加新依赖

## Decisions

### D1: 复用前几批设计模式
沿用批 A/B 的 D1-D7（批量 rename、import 去后缀已完成、DOM narrowing、事件 payload interface、跨 .js 边界 expect-error 注明、单 commit）。

### D2: 2 个 background agent 并行
Video / Command 各起一个 agent，独立处理。

### D3: Command.js 4557 行处理策略
- 不要求 agent 一次性修完——可分阶段（先 export 函数签名，再 DOM narrowing，再事件 payload）
- agent 应在每次 Edit 后跑 typecheck 验证
- 如 agent 报告工作量超 spec 范围，主流程接管剩余

### D4: 跨 .js 边界 expect-error
本批后全前端 .ts 化（除 main.js），跨边界 expect-error 应大幅减少。仅在 main.js 跨界处使用 + 注明 change D。

### D5: 单 commit
本 change 一个 commit。

## Risks / Trade-offs

- **[Command.js 太大，agent 工作量超 spec]** → 缓解：agent 独立验证；如 timeout 或质量低，主流程接管
- **[跨文件 import 推断失配]** → 缓解：agent 完成后全量 typecheck；修剩余
- **[DOM 类型大量引入 if 守卫]** → 缓解：用 `as` 断言（运行时已假设）
- **[遗留调试代码（注释 base64/HexString 等）类型化成本]** → 缓解：保留 + 最低限度类型
