# Spec: data-persistence

> data 模块：基础设施 + 4 类简单保存（Video/JG/Blackbox/YC）+ 帧写入接口 + SJCJ 双 sheet + Heixiazi Excel 保存 + 数据接收接口。本 capability 在 data-module change 中建立（基础设施 + 4 类简单保存），并在 data-excel-module change 中扩展（SJCJ + Heixiazi）。最终调用方为 control 模块（control-module change 迁移后）。

## Requirements

### Requirement: data 模块导出 createData 工厂
项目 MUST 提供 `data.ts`，导出 `createData(opts)` 工厂（opts 含 `wsBus` 与 `dataDir`），返回 `DataController`：含 4 类简单保存的 start/stop（Video/JG/Blackbox/YC）、帧写入接口、`showSaveFileDialog`、`writeRecvDataToCsv`、SJCJ/Heixiazi Excel 保存接口、数据接收接口。工厂内部（闭包）维护 PowerShell worker + 文件对话框目录记忆 + 各保存状态。

#### Scenario: createData 返回完整接口
- **WHEN** 调用 `createData({ wsBus, dataDir })`（不触发保存）
- **THEN** 返回对象含 `startSavingVideo`/`stopSavingVideo`/`startSavingJG`/`stopSavingJG`/`startSavingBlackbox`/`stopSavingBlackbox`/`startSavingYC`/`stopSavingYC`/`writeVideoFrame`/`writeJgFrame`/`writeBlackboxFrame`/`writeYcFrame`/`showSaveFileDialog`/`writeRecvDataToCsv`/`startSavingSJCJ`/`stopSavingSJCJ`/`startSavingHeixiaziExcel`/`stopSavingHeixiaziExcel`/`appendSjcjBRow`/`appendSjcjARow`/`setHeixiaziHeader`

### Requirement: 4 类简单保存的行为等价
`startSavingVideo(filePath)` 等 MUST 与重构前逐字等价：filePath 提供则用它（自动建目录），否则按 DATA_DIR + 时间戳生成文件名；创建 writeStream；置 isSavingXxx=true；broadcast `SAVE_STATUS` started。`stopSavingXxx()` MUST：isSavingXxx=false；stream.end+null；broadcast stopped + frameCount；frameCount 归零。错误 catch broadcast error。

#### Scenario: startSavingVideo 广播 started
- **WHEN** 调用 `data.startSavingVideo(filePath)` 成功
- **THEN** wsBus.broadcast 收到 `{type:"SAVE_STATUS", saveType:"video", status:"started", path: filename}`

### Requirement: writeXxxFrame 帧写入接口等价
`writeVideoFrame(frame)` MUST 封装原 `if (isSavingVideo && videoStream) { videoStream.write(frame); videoFrameCount++; }` 逻辑（JG/Blackbox/YC 同理）。供 WS connection handler 的 0xF0-0xF3 魔术字节分支与 video 的 onFrame16bit 回调调用。

#### Scenario: 未在保存时 writeVideoFrame 不报错
- **WHEN** isSavingVideo 为 false 时调 `data.writeVideoFrame(frame)`
- **THEN** 不抛错、不写文件（与原 `if (isSavingVideo && videoStream)` 短路一致）

### Requirement: video onFrame16bit 改用 data.writeVideoFrame
server.ts 创建 video 时，`onFrame16bit` 回调 MUST 改为 `(frame) => data.writeVideoFrame(frame)`（替代 server.ts 闭包直接访问 isSavingVideo/videoStream）。运行时行为等价。

#### Scenario: video 帧通过 data.writeVideoFrame 写入
- **WHEN** video 解出一帧 16bit 且 isSavingVideo=true
- **THEN** 通过 data.writeVideoFrame 写入 videoStream（与重构前直接 videoStream.write 等价）

### Requirement: connection handler 帧写入改用 data.writeXxxFrame
WS connection handler 中 0xF0/0xF1/0xF2/0xF3 魔术字节分支 MUST 调用 `data.writeVideoFrame`/`data.writeJgFrame`/`data.writeBlackboxFrame`/`data.writeYcFrame`（替代原内联 `if (isSavingXxx && xxxStream) {...}`）。

#### Scenario: 0xF0 魔术字节通过 data.writeVideoFrame
- **WHEN** connection handler 收到 `[0xF0, ...frameData]`
- **THEN** 调用 `data.writeVideoFrame(frameData)`（不再内联访问 isSavingVideo/videoStream）

### Requirement: control 的 save 调用改用 data.*
control 模块（迁移前在 server.ts 的 handleControlCommand，迁移后在 control.ts）的 `START_SAVE_VIDEO`/`STOP_SAVE_VIDEO`/`START_SAVE_JG`/`STOP_SAVE_JG`/`START_SAVE_BLACKBOX`/`STOP_SAVE_BLACKBOX`/`START_SAVE_YC`/`STOP_SAVE_YC` 8 个 case MUST 改为调 `data.startSavingXxx`/`data.stopSavingXxx`（control.ts 中走 `opts.data.*`）。

#### Scenario: START_SAVE_VIDEO 走 opts.data.startSavingVideo
- **WHEN** control.handleControlCommand 收到 `action: "START_SAVE_VIDEO"`
- **THEN** 调用 `opts.data.startSavingVideo(opts.data.filePath)`（而非裸 startSavingVideo）

### Requirement: data 模块含 SJCJ + Heixiazi Excel 保存
`createData` 返回的 DataController MUST 含：`startSavingSJCJ(dynamicHeaderB, dynamicHeaderA)` / `stopSavingSJCJ()`（async，ExcelJS 双 sheet 写 A帧/B帧）/ `startSavingHeixiaziExcel(filePath)` / `stopSavingHeixiaziExcel()`（async，ExcelJS 单 sheet 写）。SJCJ/Heixiazi 内部 normalize（normalizeSJCJExcelRow/normalizeHeixiaziExcelRow）为模块私有，不暴露。

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

### Requirement: control 的 SJCJ/Heixiazi 调用走 data.*
control 模块（迁移前在 server.ts 的 handleJsonControlMessage，迁移后在 control.ts）的 `SAVE_B_FRAME_ROW`/`SAVE_A_FRAME_ROW`/`HEIXIAZI_EXCEL_HEADER`/`REQUEST_SAVE_PATH`(heixiazi_excel) 分支 MUST 改用 `data.appendSjcjBRow`/`data.appendSjcjARow`/`data.setHeixiaziHeader`/`data.startSavingHeixiaziExcel`。handleControlCommand 的 `START_SAVE_SJCJ`/`STOP_SAVE_SJCJ`/`STOP_SAVE_HEIXIAZI_EXCEL` MUST 改用 `data.startSavingSJCJ`/`data.stopSavingSJCJ`/`data.stopSavingHeixiaziExcel`。

#### Scenario: SAVE_B_FRAME_ROW 走 opts.data.appendSjcjBRow
- **WHEN** control.handleJsonControlMessage 收到 `type: "SAVE_B_FRAME_ROW"`
- **THEN** 调 `opts.data.appendSjcjBRow(msg.row)`（不再内联访问 isSavingSJCJ/_sjcjBRows/normalizeSJCJExcelRow）

#### Scenario: server.ts 无 SJCJ/Heixiazi 函数定义残留
- **WHEN** grep server.ts `function startSavingSJCJ`/`function startSavingHeixiaziExcel`/`function normalizeSJCJExcelRow`
- **THEN** 无匹配（已迁 data）；无 isSavingSJCJ/_sjcj*/isSavingHeixiaziExcel/_heixiaziExcel* 业务引用（注释除外）

### Requirement: data 完整 TS 类型（无 @ts-nocheck）
`data.ts` MUST 提供完整 TypeScript 类型（DataOptions / DataController interface + 函数签名），MUST NOT 使用 `// @ts-nocheck`。

#### Scenario: data 通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** node tsconfig（include data.ts）检查通过
