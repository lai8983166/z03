# Proposal: 3b-3b 提取 SJCJ + Heixiazi Excel 保存

## 背景：change 3b-3 第 2 个 sub-sub

3b-3a 已提取基础设施 + 4 类简单保存。本 change（3b-3b）把剩余的 SJCJ + Heixiazi Excel 保存（复杂双 sheet / 表头 / 行缓存，ExcelJS async 写）扩展进 data.ts。完成后 data 块全部迁出 server.ts。

| sub-sub | 范围 | 状态 |
|---|---|---|
| 3b-3a | 基础设施 + Video/JG/Blackbox/YC | ✅ |
| **3b-3b（本 change）** | **SJCJ + Heixiazi Excel** | 进行中 |

## Why

SJCJ（数据采集 A/B 帧双 sheet）+ Heixiazi（黑匣子遥测 Excel）是 data 块剩余部分（~180 行 + 状态）。迁出后 server.ts 的 data 职责全部归 data.ts，server.ts 只剩 control（3b-4）+ bridges/turntable（3b-5）+ 入口装配。

## What Changes

### 1. 扩展 data.ts（加 SJCJ/Heixiazi + 数据接收接口）
data.ts 顶部加 `import ExcelJS from "exceljs";`。createData 闭包内加：
- **状态**：`isSavingSJCJ`/`_sjcjARows`/`_sjcjBRows`/`_sjcjHeaderA`/`_sjcjHeaderB`/`_sjcjFilename` + `isSavingHeixiaziExcel`/`_heixiaziExcelRows`/`_heixiaziExcelHeader`/`_heixiaziExcelFilename`
- **SJCJ**：`startSavingSJCJ(dynamicHeaderB, dynamicHeaderA)` / `async stopSavingSJCJ()`（ExcelJS 双 sheet 写）/ `normalizeSJCJExcelRow(row)`（内部）
- **Heixiazi**：`startSavingHeixiaziExcel(filePath)` / `async stopSavingHeixiaziExcel()`（ExcelJS 单 sheet 写）/ `normalizeHeixiaziExcelRow(row)`（内部）
- **数据接收接口**（解耦 control 的数据接收分支）：
  - `appendSjcjBRow(row)`：封装原 `if (isSavingSJCJ) _sjcjBRows.push(normalizeSJCJExcelRow(row))`
  - `appendSjcjARow(row)`：同 A 帧
  - `setHeixiaziHeader(header)`：封装原 `if (isSavingHeixiaziExcel && data.header) _heixiaziExcelHeader = data.header`

DataController interface 加：`startSavingSJCJ`/`stopSavingSJCJ`/`startSavingHeixiaziExcel`/`stopSavingHeixiaziExcel`/`appendSjcjBRow`/`appendSjcjARow`/`setHeixiaziHeader`。所有函数逐字搬迁自 server.ts（line 584-760），不改运行行为。

### 2. server.ts 改用 data
- 移除 SJCJ/Heixiazi 函数（normalizeSJCJExcelRow/startSavingSJCJ/stopSavingSJCJ/startSavingHeixiaziExcel/normalizeHeixiaziExcelRow/stopSavingHeixiaziExcel）+ 状态（isSavingSJCJ/_sjcj*/isSavingHeixiaziExcel/_heixiaziExcel*）
- handleJsonControlMessage 的数据接收分支改：
  - `SAVE_B_FRAME_ROW`：`if (isSavingSJCJ) _sjcjBRows.push(normalizeSJCJExcelRow(data.row))` → `data.appendSjcjBRow(data.row)`
  - `SAVE_A_FRAME_ROW`：→ `data.appendSjcjARow(data.row)`
  - `HEIXIAZI_EXCEL_HEADER`：`if (isSavingHeixiaziExcel && data.header) _heixiaziExcelHeader = data.header` → `data.setHeixiaziHeader(data.header)`
  - `REQUEST_SAVE_PATH` heixiazi_excel 分支：`startSavingHeixiaziExcel(filePath)` → `data.startSavingHeixiaziExcel(filePath)`
- handleControlCommand 改：
  - `START_SAVE_SJCJ`：`startSavingSJCJ(data.header, data.headerA)` → `data.startSavingSJCJ(data.header, data.headerA)`
  - `STOP_SAVE_SJCJ`：`stopSavingSJCJ()` → `data.stopSavingSJCJ()`
  - `STOP_SAVE_HEIXIAZI_EXCEL`：`stopSavingHeixiaziExcel()` → `data.stopSavingHeixiaziExcel()`

### 3. 测试：无单测（同 3b-3a）
SJCJ/Heixiazi 涉及 ExcelJS async + IO（wb.xlsx.writeFile），无可独立单测的纯函数（normalizeSjcJExcelRow/normalizeHeixiaziExcelRow 是纯函数但价值低——只是 CSV/数字转换）。按 eric-writing-tests Global Gate，不补单测，靠 tsx 启动 + 人工触发保存对照。

### 不在本 change 范围
- ❌ control（handleJsonControlMessage/handleControlCommand）整体提取（留 3b-4，本 change 只改其中的 SJCJ/Heixiazi 调用）
- ❌ server.ts 整体移除 @ts-nocheck

## Capabilities

### New Capabilities
- 无（SJCJ/Heixiazi 是 `data-persistence` capability 的扩展，3b-3a 已建）

### Modified Capabilities
- `data-persistence`：扩展含 SJCJ 双 sheet + Heixiazi Excel + 数据接收接口（appendSjcj*/setHeixiaziHeader）。

## Impact

### 修改文件
- `data.ts`：加 ExcelJS import + SJCJ/Heixiazi 函数/状态 + 数据接收接口 + DataController 扩展
- `server.ts`：移除 SJCJ/Heixiazi 函数 + 状态（~180 行）；handleJsonControlMessage 3 个数据接收分支 + 1 个 heixiazi_excel 分支改 data.*；handleControlCommand 3 个 case 改 data.*

### 不变
- Excel 写逻辑（双 sheet / 表头 / 行缓存 / normalize）
- SAVE_STATUS 广播
- 数据接收行为（appendSjcj*/setHeixiaziHeader 封装原 if + push/header 赋值）
- `index.html`/`style.css`/前端 JS
- 61 测试仍绿

### 验收
- `npm run typecheck` 通过（data.ts 加 ExcelJS 后类型仍干净）
- `npm test` 通过（61 旧，无新单测）
- `npm run dev:server`（tsx）启动正常
- **人工触发 SJCJ/Heixiazi 保存对照**（前端 START_SAVE_SJCJ + 发 A/B 帧行 + STOP；START heixiazi_excel + 发 header + STOP，对照 xlsx 生成）
- git 提交一次

### 风险与对策
- **ExcelJS async 搬迁** → 逐字搬（wb.xlsx.writeFile 保留）；tsx 启动 + 人工触发对照。
- **数据接收接口等价** → appendSjcj*/setHeixiaziHeader 封装原 if + push/header，逻辑等价。
- **无单测** → IO 重，靠人工触发保存对照（唯一验证途径）。
- **状态搬迁漏引用** → grep 复核 server.ts 无 isSavingSJCJ/_sjcj*/isSavingHeixiaziExcel/_heixiaziExcel* 业务引用。
