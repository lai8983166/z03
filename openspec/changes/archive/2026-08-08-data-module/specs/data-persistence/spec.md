# Spec Delta: data-persistence

> 本 change 新增 data 模块（基础设施 + 4 类简单保存 + 帧写入接口）。SJCJ/Heixiazi 留 3b-3b。新文件完整类型（无 @ts-nocheck）。data 涉及大量 IO，无纯函数单测，行为靠 tsx 启动 + 人工触发保存对照。

## ADDED Requirements

### Requirement: data 模块导出 createData 工厂
项目 MUST 提供 `data.ts`，导出 `createData(opts)` 工厂（opts 含 `wsBus` 与 `dataDir`），返回 `DataController`：含 4 类简单保存的 start/stop（Video/JG/Blackbox/YC）、4 个 writeXxxFrame 帧写入接口、`showSaveFileDialog`、`writeRecvDataToCsv`。工厂内部（闭包）维护 PowerShell worker + 文件对话框目录记忆 + 各保存状态。

#### Scenario: createData 返回完整接口
- **WHEN** 调用 `createData({ wsBus, dataDir })`（不触发保存）
- **THEN** 返回对象含 `startSavingVideo`/`stopSavingVideo`/`startSavingJG`/`stopSavingJG`/`startSavingBlackbox`/`stopSavingBlackbox`/`startSavingYC`/`stopSavingYC`/`writeVideoFrame`/`writeJgFrame`/`writeBlackboxFrame`/`writeYcFrame`/`showSaveFileDialog`/`writeRecvDataToCsv`

### Requirement: 4 类简单保存的行为等价
`startSavingVideo(filePath)` 等 MUST 与重构前 server.ts 逐字等价：filePath 提供则用它（自动建目录），否则按 DATA_DIR + 时间戳生成文件名；创建 writeStream；置 isSavingXxx=true；broadcast `SAVE_STATUS` started。`stopSavingXxx()` MUST：isSavingXxx=false；stream.end+null；broadcast stopped + frameCount；frameCount 归零。错误 catch broadcast error。

#### Scenario: startSavingVideo 广播 started
- **WHEN** 调用 `data.startSavingVideo(filePath)` 成功
- **THEN** wsBus.broadcast 收到 `{type:"SAVE_STATUS", saveType:"video", status:"started", path: filename}`

### Requirement: writeXxxFrame 帧写入接口等价
`writeVideoFrame(frame)` MUST 封装原 `if (isSavingVideo && videoStream) { videoStream.write(frame); videoFrameCount++; }` 逻辑（JG/Blackbox/YC 同理）。供 connection handler 的 0xF0-0xF3 魔术字节分支与 video 的 onFrame16bit 回调调用。

#### Scenario: 未在保存时 writeVideoFrame 不报错
- **WHEN** isSavingVideo 为 false 时调 `data.writeVideoFrame(frame)`
- **THEN** 不抛错、不写文件（与原 `if (isSavingVideo && videoStream)` 短路一致）

### Requirement: video onFrame16bit 改用 data.writeVideoFrame
server.ts 创建 video 时，`onFrame16bit` 回调 MUST 改为 `(frame) => data.writeVideoFrame(frame)`（替代 3b-2 的 server.ts 闭包直接访问 isSavingVideo/videoStream）。运行时行为等价。

#### Scenario: video 帧通过 data.writeVideoFrame 写入
- **WHEN** video 解出一帧 16bit 且 isSavingVideo=true
- **THEN** 通过 data.writeVideoFrame 写入 videoStream（与重构前直接 videoStream.write 等价）

### Requirement: connection handler 帧写入改用 data.writeXxxFrame
server.ts 的 WS connection handler 中 0xF0/0xF1/0xF2/0xF3 魔术字节分支 MUST 改为调用 `data.writeVideoFrame`/`data.writeJgFrame`/`data.writeBlackboxFrame`/`data.writeYcFrame`（替代原内联 `if (isSavingXxx && xxxStream) {...}`）。

#### Scenario: 0xF0 魔术字节通过 data.writeVideoFrame
- **WHEN** connection handler 收到 `[0xF0, ...frameData]`
- **THEN** 调用 `data.writeVideoFrame(frameData)`（不再内联访问 isSavingVideo/videoStream）

### Requirement: control 的 save 调用改用 data.*
handleControlCommand 的 `START_SAVE_VIDEO`/`STOP_SAVE_VIDEO`/`START_SAVE_JG`/`STOP_SAVE_JG`/`START_SAVE_BLACKBOX`/`STOP_SAVE_BLACKBOX`/`START_SAVE_YC`/`STOP_SAVE_YC` 8 个 case MUST 改为调 `data.startSavingXxx`/`data.stopSavingXxx`。

#### Scenario: START_SAVE_VIDEO 调 data.startSavingVideo
- **WHEN** handleControlCommand 收到 `action: "START_SAVE_VIDEO"`
- **THEN** 调用 `data.startSavingVideo(data.filePath)`（而非裸 startSavingVideo）

### Requirement: data 完整 TS 类型（无 @ts-nocheck）
`data.ts` MUST 提供完整 TypeScript 类型（DataOptions / DataController interface + 函数签名），MUST NOT 使用 `// @ts-nocheck`。

#### Scenario: data 通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** node tsconfig（include data.ts）检查通过

### Requirement: SJCJ / Heixiazi 留 server.ts（3b-3b）
SJCJ 保存（startSavingSJCJ/stopSavingSJCJ/normalizeSJCJExcelRow + _sjcj* 状态）与 Heixiazi Excel（startSavingHeixiaziExcel/stopSavingHeixiaziExcel/normalizeHeixiaziExcelRow + _heixiaziExcel* 状态）MUST 留在 server.ts，不在本 change 迁移。它们对 `showSaveFileDialog` 的调用改为 `data.showSaveFileDialog`（基础设施已迁 data）。

#### Scenario: SJCJ/Heixiazi 仍在 server.ts
- **WHEN** grep server.ts 的 `function startSavingSJCJ`/`function startSavingHeixiaziExcel`
- **THEN** 仍能匹配（未迁出）
