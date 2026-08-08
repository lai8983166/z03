## Context

前端 14 个 JS 文件分布在 `js/` 下（13 个）+ 根目录 main.js（1 个，是 index.html 入口）。本 change 范围限定为 `js/` 下 8 个 <500 行的小文件：

| 文件 | 行数 | 角色 |
|---|---|---|
| Client.js | 179 | 主 WS 客户端，连后端 8081；路由消息到 DataHandler/Video/Telemeter/YC |
| ImageUploadClient.js | 139 | 图像上传 WS 客户端，连后端 8082 |
| StatusBar.js | 96 | LED 状态指示灯（singleTon） |
| Chart.js | 449 | echarts 图表初始化 |
| Infrared.js | 441 | 红外参数表格初始化 + setLEDStatus |
| Laser.js | 495 | 激光表格 + 激光图像刷新（1Hz） |
| DataHandler.js | 277 | rs485 事件路由分发到各业务处理 |
| Telemeter.js | 309 | 遥测数据 YC 处理 |

依赖关系（部分）：
- 小文件互引：Client → DataHandler；Infrared/Laser → Client；Telemeter → Laser
- 引大文件（本 change 外）：Client → Video/YC；DataHandler → Command/ImageUpload；Telemeter → Video
- 引 main.js：Infrared/Laser/Telemeter/Client → main.js（Utils/setLEDStatus）

约束（openspec/config.yaml）：测试 mock / 不改 index.html/style.css/JS 样式代码 / 遗留代码保留。

## Goals / Non-Goals

**Goals:**
- 8 个文件 rename 为 `.ts` + 完整 TS 类型
- 全项目 import 路径更新（去 `.js` 后缀，让 vite/tsx 自动解析剩余 .js 与新 .ts）
- tsconfig include 反映新结构
- typecheck 0 错 / test 61/61 全绿

**Non-Goals:**
- **不**改 main.js（保留 .js；index.html 入口不变；留最后单独决策）
- **不**改 index.html
- **不**改大文件（Video/Command 等）的内容（但其 import 这 8 个的路径要更新）
- **不**改测试断言（如有测试需要改 import 路径，仅改路径不改断言）
- **不**重构架构、不提取公共模块、不消除重复
- **不**加 strict 逃生舱（除非真实需要）

## Decisions

### D1: 批量 rename + 集中类型化

**决定**：一次性 git mv 8 个 .js → .ts，再逐个文件加类型。

**理由**：8 个文件互引，一次 rename 比逐个 rename + 更新路径效率高；类型化可以逐文件做（typecheck 引导）。

### D2: import 路径全项目统一去 `.js` 后缀

**决定**：所有 `import ... from "./X.js"` 改为 `from "./X"`（无后缀）。

**理由**：
- vite/tsx 默认 resolve.extensions 含 .ts 与 .js，无后缀能自动解析
- 混用 .js/.ts 后缀容易混乱；统一无后缀最干净
- 已在 protocol-tools-ts 验证可行（js/Command.js 等 5 个前端 JS 已无后缀 import BinaryTableHelper）

**例外**：node_modules 引用（如 `exceljs`、`echarts`）保留原样（无相对路径，不需要去后缀）。

### D3: DOM 操作用 narrowing + `as` 断言

**决定**：document.getElementById 返回 `HTMLElement | null`，访问 `.value`/`.checked`/`addEventListener` 等成员时：
- 优先 `as HTMLInputElement` / `as HTMLSelectElement` / `as HTMLCanvasElement` 等精确断言
- 配合 `if (!el) return` 守卫处理 null

**理由**：前端 JS 大量使用 `document.getElementById("xxx").value` 等模式，TS strict 下需要 narrowing。运行时已经隐式假设元素类型，TS 断言只是显式化。

### D4: 事件 payload 用 inline 类型或 `unknown` + narrow

**决定**：WS 消息回调、自定义事件回调的 payload，形状多样且无文档，统一用：
- 形状明确时定义 inline interface（如 `{ type: string; data?: string; flag?: number }`）
- 形状不明时用 `unknown` + 使用处 narrowing，或 `Record<string, unknown>`

**理由**：前端消息大多来自后端 broadcast，形状跟后端 ws-bus 的 broadcast 一致。不引入跨文件共享 interface（避免提前抽象），inline 即可。

### D5: 第三方库类型——echarts / exceljs

**决定**：
- `echarts`：检查是否装了 `@types/echarts` 或 echarts 自带类型；若无，临时 `// @ts-expect-error: echarts 未装类型` 注明（D6 例外）
- `exceljs`：项目已装 exceljs@4.4.0，package.json 显示有 types 字段，应自带类型

**理由**：先看实际报错，再决定是否装 @types/echarts。本 change 范围尽量不引入新依赖。

### D6: 逃生舱使用规则

**决定**：与 strict-mode / bridge-impl-types 一致——**不主动引入** `// @ts-expect-error` 或 `as any`。仅在以下情形允许并注明原因：
- 第三方库类型缺失（echarts 等）
- DOM API 与运行时行为不一致（罕见）

**目标**：保持 @ts-expect-error ≤ 之前 strict-mode 引入的 2 处（ws _socket）；本 change 引入的新增数尽量为 0 或个位数（每个注明原因）。

### D7: 单 commit

**决定**：本 change 全部改动一个 commit。

## Risks / Trade-offs

- **[前端 JS 改 import 后浏览器加载失败]** → 缓解：vite 默认 resolve.extensions 含 .ts 与 .js，无后缀 import 等价；npm test 通过证明 import 解析正确
- **[8 个文件类型化工作量超 spec 范围]** → 缓解：每个文件独立类型化、独立跑 typecheck，发现错就修；如某文件类型化成本过高（如 Chart 的 echarts 类型），临时 `// @ts-expect-error` 注明
- **[DOM narrowing 引入大量 if 守卫，破坏代码结构]** → 缓解：用 `as` 断言减少 if（运行时已隐式假设元素存在）；守卫只用在原本就有 null 检查的位置
- **[main.js 仍是 .js，前端入口未 TS 化]** → 缓解：本 change 目标不含 main.js；后续单独决策（需要解决 index.html 改动约束）
- **[遗留代码（已注释、未启用分支）类型化成本]** → 缓解：保留代码 + 最低限度类型（如 unknown 或 // @ts-expect-error 注明"遗留调试代码"）
- **[测试代码意外受影响]** → 缓解：测试只 import 协议层（已 .ts），不直接 import 这 8 个文件；如确有影响，仅改测试 import 路径
