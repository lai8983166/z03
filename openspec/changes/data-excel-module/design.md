# Design: 3b-3b SJCJ + Heixiazi Excel

## Context

3b-3a 已提取 data 基础设施 + 4 简单保存。本 change 把 SJCJ（数据采集 A/B 帧双 sheet）+ Heixiazi（黑匣子遥测 Excel）扩展进 data.ts。两者都用 ExcelJS async 写 xlsx，含表头/行缓存状态。

SJCJ 额外有"数据接收"耦合：handleJsonControlMessage 的 SAVE_B_FRAME_ROW/SAVE_A_FRAME_ROW 分支接收前端发来的行，push 到 _sjcjBRows/_sjcjARows。Heixiazi 有 HEIXIAZI_EXCEL_HEADER 分支设表头。

## Goals / Non-Goals

**Goals**
- data.ts 加 SJCJ/Heixiazi（ExcelJS）+ 数据接收接口（appendSjcj*/setHeixiaziHeader）。
- server.ts 移除 SJCJ/Heixiazi 函数/状态；调用点改 data.*。
- data 块全部迁出 server.ts。
- 行为不变。

**Non-Goals**
- 不提取 control（3b-4）。
- 不补单测（ExcelJS IO，同 3b-3a）。
- 不改 Excel 写逻辑（双 sheet/表头/normalize/行缓存全保留）。

## Decisions

### D1. SJCJ/Heixiazi 加入 createData（ExcelJS import）
data.ts 顶部加 `import ExcelJS from "exceljs";`。SJCJ/Heixiazi 函数 + 状态加入 createData 闭包。normalizeSJCJExcelRow/normalizeHeixiaziExcelRow 为闭包内私有（数据接收 + stop 时用）。DataController interface 加 startSavingSJCJ/stopSavingSJCJ/startSavingHeixiaziExcel/stopSavingHeixiaziExcel。

### D2. 数据接收接口解耦 control
SJCJ 数据接收（原 server.ts handleJsonControlMessage 的 SAVE_B_FRAME_ROW/SAVE_A_FRAME_ROW 内联 `if (isSavingSJCJ) _sjcj*Rows.push(normalizeSJCJExcelRow(row))`）+ Heixiazi header（HEIXIAZI_EXCEL_HEADER 内联 `if (isSavingHeixiaziExcel && header) _heixiaziExcelHeader = header`）提取为 data 接口：
- `appendSjcjBRow(row)` / `appendSjcjARow(row)`：封装 if + normalize + push
- `setHeixiaziHeader(header)`：封装 if + 赋值
control 改调这些接口。逻辑逐字等价。

### D3. control 调用改 data.*
handleJsonControlMessage 4 分支（SAVE_B_FRAME_ROW/SAVE_A_FRAME_ROW/HEIXIAZI_EXCEL_HEADER/REQUEST_SAVE_PATH heixiazi_excel）+ handleControlCommand 3 case（START_SAVE_SJCJ/STOP_SAVE_SJCJ/STOP_SAVE_HEIXIAZI_EXCEL）改 data.*。

### D4. 无单测（同 3b-3a）
SJCJ/Heixiazi 涉及 ExcelJS async（wb.xlsx.writeFile）+ IO，无可独立单测的有价值纯函数（normalize 只是 CSV/数字转换）。靠 tsx 启动 + 人工触发 SJCJ/Heixiazi 保存对照。

## Risks / Trade-offs

- **ExcelJS async 搬迁** → 逐字搬（Workbook/addWorksheet/addRow/writeFile 全保留）；人工触发对照。
- **数据接收接口等价** → appendSjcj*/setHeixiaziHeader 封装原 if，等价。
- **无单测** → IO 重，人工对照唯一途径。
- **状态搬迁漏引用** → grep 复核 server.ts 无 isSavingSJCJ/_sjcj*/isSavingHeixiaziExcel/_heixiaziExcel* 业务引用。

## Migration Plan

- 顺序：data.ts 扩展（ExcelJS import + SJCJ/Heixiazi + 接口）→ server.ts 改（移函数/状态 + 调用点改）→ typecheck + test + tsx → commit。
- 回滚：`git revert`。
