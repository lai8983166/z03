# Spec Delta: data-persistence（SJCJ + Heixiazi 扩展）

> 本 change 扩展 data-persistence capability：加 SJCJ 双 sheet + Heixiazi Excel 保存 + 数据接收接口。data 块全部迁出 server.ts。

## MODIFIED Requirements

### Requirement: data 模块含 SJCJ + Heixiazi Excel 保存
`createData` 返回的 DataController MUST 额外含：`startSavingSJCJ(dynamicHeaderB, dynamicHeaderA)` / `stopSavingSJCJ()`（async，ExcelJS 双 sheet 写 A帧/B帧）/ `startSavingHeixiaziExcel(filePath)` / `stopSavingHeixiaziExcel()`（async，ExcelJS 单 sheet 写）+ 数据接收接口 `appendSjcjBRow(row)` / `appendSjcjARow(row)` / `setHeixiaziHeader(header)`。SJCJ/Heixiazi 内部 normalize（normalizeSJCJExcelRow/normalizeHeixiaziExcelRow）为模块私有，不暴露。

#### Scenario: startSavingSJCJ 设置表头 + 清缓存 + broadcast
- **WHEN** 调用 `data.startSavingSJCJ(dynamicHeaderB, dynamicHeaderA)`
- **THEN** _sjcjFilename 按 DATA_DIR+时间戳生成 .xlsx；_sjcjHeaderA/B 按传入解析；_sjcjARows/BRows 清空；isSavingSJCJ=true；broadcast SAVE_STATUS started（pathA/pathB 同 filename）

#### Scenario: stopSavingSJCJ 写双 sheet xlsx
- **WHEN** 调用 `await data.stopSavingSJCJ()`（已 start）
- **THEN** ExcelJS Workbook 含 "A帧"/"B帧" 两 sheet，各加表头 + normalize 后的行；写 xlsx；broadcast SAVE_STATUS stopped

#### Scenario: stopSavingHeixiaziExcel 写单 sheet xlsx
- **WHEN** 调用 `await data.stopSavingHeixiaziExcel()`（已 start + setHeixiaziHeader）
- **THEN** ExcelJS Workbook 含 "黑匣子遥测数据" sheet，加 header + normalize 行；写 xlsx；broadcast stopped

### Requirement: 数据接收接口等价
`appendSjcjBRow(row)` MUST 封装原 `if (isSavingSJCJ) _sjcjBRows.push(normalizeSJCJExcelRow(row))`；`appendSjcjARow(row)` 同 A 帧；`setHeixiaziHeader(header)` MUST 封装原 `if (isSavingHeixiaziExcel && header) _heixiaziExcelHeader = header`。

#### Scenario: 未在保存时 appendSjcjBRow 不报错
- **WHEN** isSavingSJCJ=false 时调 `data.appendSjcjBRow(row)`
- **THEN** 不抛错、不 push（与原 if 短路一致）

#### Scenario: setHeixiaziHeader 仅在保存中生效
- **WHEN** isSavingHeixiaziExcel=true 且 header 非空时调 `data.setHeixiaziHeader(header)`
- **THEN** _heixiaziExcelHeader = header；若 isSavingHeixiaziExcel=false 则不赋值（与原 if 一致）

### Requirement: server.ts 的 SJCJ/Heixiazi 调用改 data.*
handleJsonControlMessage 的 `SAVE_B_FRAME_ROW`/`SAVE_A_FRAME_ROW`/`HEIXIAZI_EXCEL_HEADER`/`REQUEST_SAVE_PATH`(heixiazi_excel) 分支 MUST 改用 `data.appendSjcjBRow`/`data.appendSjcjARow`/`data.setHeixiaziHeader`/`data.startSavingHeixiaziExcel`。handleControlCommand 的 `START_SAVE_SJCJ`/`STOP_SAVE_SJCJ`/`STOP_SAVE_HEIXIAZI_EXCEL` MUST 改用 `data.startSavingSJCJ`/`data.stopSavingSJCJ`/`data.stopSavingHeixiaziExcel`。

#### Scenario: SAVE_B_FRAME_ROW 走 data.appendSjcjBRow
- **WHEN** handleJsonControlMessage 收到 `type: "SAVE_B_FRAME_ROW"`
- **THEN** 调 `data.appendSjcjBRow(data.row)`（不再内联访问 isSavingSJCJ/_sjcjBRows/normalizeSJCJExcelRow）

#### Scenario: server.ts 无 SJCJ/Heixiazi 函数定义残留
- **WHEN** grep server.ts `function startSavingSJCJ`/`function startSavingHeixiaziExcel`/`function normalizeSJCJExcelRow`
- **THEN** 无匹配（已迁 data）；无 isSavingSJCJ/_sjcj*/isSavingHeixiaziExcel/_heixiaziExcel* 业务引用（注释除外）
