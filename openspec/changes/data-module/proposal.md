# Proposal: 3b-3a 提取 data 基础设施 + 4 类简单保存

## 背景：change 3b 拆 sub-sub

data 块（800 行 / 17 函数 / 25 状态）太大，3b-3 拆 2 个 sub-sub：

| sub-sub | 范围 | 状态 |
|---|---|---|
| **3b-3a（本 change）** | **基础设施 + Video/JG/Blackbox/YC 简单保存 + writeFrame 接口** | 进行中 |
| 3b-3b | SJCJ + Heixiazi Excel（复杂双 sheet）+ control 调用收尾 | 待启动 |

## Why

data 块是 server.ts 最大职责（800 行）。先提取基础设施（PowerShell 文件对话框 + Csv）+ 4 类结构相似的简单保存（Video/JG/Blackbox/YC，都是 start(filePath)/stop + writeStream + broadcast SAVE_STATUS 模式），把 server.ts 减约 400 行；复杂的 SJCJ/Heixiazi 留 3b-3b。

顺带把 3b-2 留在 server.ts 的 `isSavingVideo`/`videoStream`/`videoFrameCount` 迁入 data（逻辑上属数据保存），video 的 `onFrame16bit` 回调改为调 `data.writeVideoFrame`。

## What Changes

### 1. 新建 `data.ts`（完整 TS 类型，无 @ts-nocheck）
导出 `createData(opts)` 工厂（opts: `wsBus` + `dataDir`），返回 `DataController`：
- **基础设施**：`showSaveFileDialog(defaultName, filter, saveType)` / `writeRecvDataToCsv(buffer)`；内部含 `_ensurePsWorker`（PowerShell worker + 预热）/ `getSaveDialogInitialDir` / `rememberSaveDialogDir` + 状态（`_psWorker*` / `_saveDialog*` / `_psWorkerScript`）。SJCJ/Heixiazi（3b-3b）也复用 `showSaveFileDialog`。
- **4 类简单保存**：`startSavingVideo`/`stopSavingVideo`/`startSavingJG`/`stopSavingJG`/`startSavingBlackbox`/`stopSavingBlackbox`/`startSavingYC`/`stopSavingYC` + 各自状态（`isSavingVideo`/`videoStream`/`videoFrameCount` 等 4 组）。
- **帧写入接口**（供 connection handler 的 0xF0-0xF3 魔术字节分支 + video onFrame16bit 调用）：`writeVideoFrame(frame)` / `writeJgFrame` / `writeBlackboxFrame` / `writeYcFrame`——每个封装原 `if (isSavingXxx && xxxStream) { xxxStream.write(frame); xxxFrameCount++; }` 逻辑。

所有函数逐字搬迁自 server.ts（line 573-614 状态 + 709-970 4 保存 + 1055-1249 基础设施 + 1433+ Csv），不改运行行为。

### 2. server.ts 改用 data
- 顶部 `import { createData } from "./data";`；在 wsBus 之后、video 之前创建：`const data = createData({ wsBus, dataDir: cfg.dataDir });`（video 的 onFrame16bit 要用 data.writeVideoFrame）
- 移除：4 简单保存函数 + 基础设施函数 + 对应状态（`_psWorker*`/`_saveDialog*`/`isSavingVideo`/`videoStream`/... 等 4 组）+ `DATA_DIR` 声明（迁 data）+ PowerShell 预热调用
- **video 创建调整**（改 3b-2 的 onFrame16bit）：`onFrame16bit: (frame) => data.writeVideoFrame(frame)`（替代原 server.ts 闭包直接访问 isSavingVideo/videoStream）
- **connection handler 帧写入改**（0xF0-0xF3 分支）：`if (isSavingVideo && videoStream) {...}` → `data.writeVideoFrame(message.slice(1))`；JG/Blackbox/YC 同理
- **control 调用改**（handleControlCommand）：`startSavingVideo(data.filePath)` → `data.startSavingVideo(data.filePath)`；stop 同理；4 类共 8 个 case
- **writeRecvDataToCsv 调用**（如有）→ `data.writeRecvDataToCsv(...)`
- **SJCJ / Heixiazi 函数 + 状态留 server.ts**（3b-3b）；它们用 `showSaveFileDialog` 改调 `data.showSaveFileDialog`（基础设施已迁 data）

### 3. 测试：无有意义单测
data 几乎全部涉及 IO（fs.createWriteStream / ExcelJS / PowerShell spawn / CSV 写），**无可独立单测的纯函数**（不像 video 的 convert16to8bit）。按 eric-writing-tests 的 Global Gate——IO 重的逻辑靠集成/人工验证，不强凑单测。本 change **不补单测**，行为不变靠：
- tsx 启动验证（server 启动不报错 + PowerShell 预热日志）
- **人工触发保存对照**（前端发 START_SAVE_VIDEO/JG/Blackbox/YC 命令，对照文件生成 + SAVE_STATUS 广播与重构前一致）——这是验证保存逻辑的唯一途径

### 不在本 change 范围
- ❌ SJCJ / Heixiazi Excel 保存（留 3b-3b）
- ❌ connection handler / handleControlCommand 整体提取（留 3b-4，本 change 只改其中的 data 相关调用）
- ❌ data 单测（IO 重，无纯函数可测）
- ❌ server.ts 整体移除 @ts-nocheck

## Capabilities

### New Capabilities
- `data-persistence`：数据保存模块——4 类简单流式保存（Video/JG/Blackbox/YC）+ 帧写入接口 + 基础设施（PowerShell 文件对话框 + CSV 写）。SJCJ/Heixiazi Excel 在 3b-3b 扩展进本模块。

### Modified Capabilities
- 无。

## Impact

### 新增文件
- `data.ts`（完整类型，无 @ts-nocheck）
- `openspec/specs/data-persistence/spec.md`

### 修改文件
- `server.ts`：移除 4 保存 + 基础设施 + 状态（约 400 行）；video onFrame16bit 改 data.writeVideoFrame；connection handler 4 处帧写入改 data.writeXxxFrame；control 8 个 case 改 data.*；SJCJ/Heixiazi 的 showSaveFileDialog 调用改 data.*
- `tsconfig.node.json`：include 加 `data.ts`

### 不变
- 所有保存行为（文件生成、SAVE_STATUS 广播、帧计数、PowerShell 对话框）
- SJCJ/Heixiazi 保存逻辑（留 server.ts）
- video 解码/广播（只 onFrame16bit 调用方式变，逻辑等价）
- `index.html`/`style.css`/前端 JS
- change 2/3b-1/3b-2 的 61 测试仍绿

### 验收
- `npm run typecheck` 通过（data.ts 无 @ts-nocheck 被检查）
- `npm test` 通过（61 旧测试，无新单测）
- `npm run dev:server`（tsx）启动，PowerShell 预热日志与重构前一致
- **人工触发保存对照**（前端 START_SAVE_VIDEO/JG/Blackbox/YC，文件生成 + SAVE_STATUS 与重构前一致）
- git 提交一次

### 风险与对策
- **无单测保护** → data IO 重无法单测；逐字搬迁 + tsx 启动 + 人工触发保存对照是唯一验证；搬迁时 git diff 逐函数审查。
- **状态搬迁漏引用** → 状态归 data 闭包；server.ts 残留引用靠 grep 复核（isSavingVideo/videoStream/jgStream 等不应再出现在 server.ts 业务代码）。
- **video onFrame16bit 改调用** → 从 server.ts 闭包改 data.writeVideoFrame，逻辑等价（data 内部相同 if + write + count）。
- **connection handler 帧写入改** → 4 处 if 块改 data.writeXxxFrame 调用，逻辑等价。
- **PowerShell worker 搬迁** → spawn + 预热逻辑逐字搬；tsx 启动日志"PowerShell 对话框工作进程已预热完毕"对照。
