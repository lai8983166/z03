# Tasks: 3b-3b SJCJ + Heixiazi Excel

> 全局约定：每 change 提交一次 git；不改 HTML/CSS/JS 样式。本 change 关键纪律：**Excel 写逻辑（双 sheet/表头/normalize/行缓存）逐字搬迁，数据接收接口封装原 if 等价**。无单测（ExcelJS IO），靠 tsx + 人工对照。

## 1. 扩展 data.ts（skill: eric-backend）

- [ ] 1.1 data.ts 顶部加 `import ExcelJS from "exceljs";`
- [ ] 1.2 createData 闭包加 SJCJ/Heixiazi 状态（isSavingSJCJ/_sjcjARows/_sjcjBRows/_sjcjHeaderA/_sjcjHeaderB/_sjcjFilename + isSavingHeixiaziExcel/_heixiaziExcelRows/_heixiaziExcelHeader/_heixiaziExcelFilename）
- [ ] 1.3 加 SJCJ 函数（逐字搬迁自 server.ts line 584-671）：normalizeSJCJExcelRow（内部）/ startSavingSJCJ / async stopSavingSJCJ（ExcelJS 双 sheet A帧/B帧 写 xlsx）
- [ ] 1.4 加 Heixiazi 函数（逐字搬迁 line 691-760）：startSavingHeixiaziExcel / normalizeHeixiaziExcelRow（内部）/ async stopSavingHeixiaziExcel（ExcelJS 单 sheet 写）
- [ ] 1.5 加数据接收接口：appendSjcjBRow(row)（封装 `if (isSavingSJCJ) _sjcjBRows.push(normalizeSJCJExcelRow(row))`）/ appendSjcjARow(row) / setHeixiaziHeader(header)（封装 `if (isSavingHeixiaziExcel && header) _heixiaziExcelHeader = header`）
- [ ] 1.6 DataController interface 加 startSavingSJCJ/stopSavingSJCJ/startSavingHeixiaziExcel/stopSavingHeixiaziExcel/appendSjcjBRow/appendSjcjARow/setHeixiaziHeader；return 加这些方法
- [ ] 1.7 `npx tsc -p tsconfig.node.json --noEmit` 通过（data.ts 加 ExcelJS 后类型干净）

## 2. server.ts 改用 data（skill: eric-backend）

- [ ] 2.1 移除 server.ts SJCJ/Heixiazi 函数（normalizeSJCJExcelRow/startSavingSJCJ/stopSavingSJCJ/startSavingHeixiaziExcel/normalizeHeixiaziExcelRow/stopSavingHeixiaziExcel）+ 状态（isSavingSJCJ/_sjcj*/isSavingHeixiaziExcel/_heixiaziExcel*）
- [ ] 2.2 handleJsonControlMessage 数据接收分支改：
  - `SAVE_B_FRAME_ROW`：`if (isSavingSJCJ) _sjcjBRows.push(normalizeSJCJExcelRow(data.row))` → `data.appendSjcjBRow(data.row)`
  - `SAVE_A_FRAME_ROW`：→ `data.appendSjcjARow(data.row)`
  - `HEIXIAZI_EXCEL_HEADER`：`if (isSavingHeixiaziExcel && data.header) _heixiaziExcelHeader = data.header` → `data.setHeixiaziHeader(data.header)`
  - `REQUEST_SAVE_PATH` heixiazi_excel 分支：`startSavingHeixiaziExcel(filePath)` → `data.startSavingHeixiaziExcel(filePath)`
- [ ] 2.3 handleControlCommand 改：
  - `START_SAVE_SJCJ`：`startSavingSJCJ(data.header, data.headerA)` → `data.startSavingSJCJ(data.header, data.headerA)`
  - `STOP_SAVE_SJCJ`：`stopSavingSJCJ()` → `data.stopSavingSJCJ()`
  - `STOP_SAVE_HEIXIAZI_EXCEL`：`stopSavingHeixiaziExcel()` → `data.stopSavingHeixiaziExcel()`
- [ ] 2.4 grep 复核：server.ts 无 `function startSavingSJCJ`/`function startSavingHeixiaziExcel`/`function normalizeSJCJExcelRow` 定义；无 isSavingSJCJ/_sjcj*/isSavingHeixiaziExcel/_heixiaziExcel* 业务引用（注释除外）

## 3. 验收与提交（skill: eric-quality-control + eric-review）

- [ ] 3.1 `npm run typecheck` 通过（data.ts 加 ExcelJS 后类型仍干净）
- [ ] 3.2 `npm test` 通过（61 旧，无新单测）
- [ ] 3.3 `npm run dev:server`（tsx）启动正常
- [ ] 3.4 grep 复核 server.ts 无 SJCJ/Heixiazi 函数/状态残留
- [ ] 3.5 **人工触发 SJCJ/Heixiazi 保存对照**（前端 START_SAVE_SJCJ + 发 A/B 帧行 + STOP；heixiazi_excel START + 发 header + STOP，对照 xlsx 生成）——唯一验证途径
- [ ] 3.6 复核约束：index.html/style.css/JS 样式未动；Excel 写逻辑逐字搬
- [ ] 3.7 eric-review 自查（重点：Excel 写逐字搬、数据接收接口等价、状态搬迁无漏引）
- [ ] 3.8 `git commit`
