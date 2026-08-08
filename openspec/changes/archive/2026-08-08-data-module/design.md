# Design: 3b-3a data 基础设施 + 4 类简单保存

## Context

server.ts 的 data 块（line 573-1447，~800 行）是最大职责。本 change（3b-3a）提取其中**基础设施 + 4 类结构相似的简单保存**（Video/JG/Blackbox/YC），复杂的 SJCJ/Heixiazi Excel 留 3b-3b。

简单保存模式（Video/JG/Blackbox/YC 一致）：`start(filePath)` 自动建目录或按 DATA_DIR+时间戳生成文件名 → 创建 writeStream → 置 isSavingXxx=true → broadcast SAVE_STATUS started；`stop()` 置 false → stream.end+null → broadcast stopped+frameCount。帧写入由调用方（connection handler 的 0xF0-0xF3 / video 的 onFrame16bit）触发。

基础设施：PowerShell 常驻 worker（_ensurePsWorker，spawn powershell.exe + READY 握手 + stdin/stdout 通信）+ 文件对话框（showSaveFileDialog，Promise + 等待 READY + 目录记忆）+ writeRecvDataToCsv。

## Goals / Non-Goals

**Goals**
- 提取 data.ts：createData 工厂（基础设施 + 4 保存 + writeXxxFrame 接口），完整类型（无 @ts-nocheck）。
- server.ts 减约 400 行；video onFrame16bit / connection handler 帧写入 / control save 调用改 data.*。
- 把 3b-2 留 server.ts 的 isSavingVideo/videoStream/videoFrameCount 迁入 data（逻辑归属）。
- 行为绝对不变。

**Non-Goals**
- 不迁 SJCJ/Heixiazi（3b-3b）。
- 不整体提取 connection handler / handleControlCommand（3b-4）。
- 不补 data 单测（IO 重，无纯函数——见 D6）。
- 不改任何保存逻辑（文件名生成、writeStream、SAVE_STATUS 格式、PowerShell 协议全保留）。

## Decisions

### D1. createData 工厂（闭包维护所有 data 状态）
所有 data 状态（PowerShell worker `_psWorker*`/`_saveDialog*` + 4 组保存状态 `isSavingVideo`/`videoStream`/`videoFrameCount`/... + `_psWorkerScript`）由 createData 闭包维护，不暴露（只暴露 DataController 接口方法）。DATA_DIR 由 opts.dataDir 传入（server.ts 的 `path.join(__dirname, cfg.dataDir)` 计算后传入，data 内部用 opts.dataDir）。

### D2. writeXxxFrame 接口封装帧写入
原 connection handler 内联 `if (isSavingXxx && xxxStream) { xxxStream.write(frame); xxxFrameCount++; }`（4 处，0xF0-0xF3）+ video onFrame16bit 内联同样模式。提取为 `data.writeVideoFrame(frame)`/`writeJgFrame`/`writeBlackboxFrame`/`writeYcFrame`——每个封装相同 if 逻辑。调用方（connection handler + video onFrame16bit）改调 data.writeXxxFrame。行为逐字等价。

### D3. video onFrame16bit 改 data.writeVideoFrame（调整 3b-2）
3b-2 的 server.ts `onFrame16bit: (frame) => { if (isSavingVideo && videoStream) {...} }` 改为 `onFrame16bit: (frame) => data.writeVideoFrame(frame)`。因为 isSavingVideo/videoStream/videoFrameCount 迁入 data（D1），server.ts 闭包不再持有它们。data 实例必须在 video 之前创建：`const data = createData({...}); const video = createVideo({ ..., onFrame16bit: (frame) => data.writeVideoFrame(frame) });`。

### D4. PowerShell worker + 文件对话框 + Csv 迁 data（基础设施）
_ensurePsWorker（含 _psWorkerScript + spawn + READY 握手 + stdin/stdout + 预热）/ getSaveDialogInitialDir / rememberSaveDialogDir / showSaveFileDialog / writeRecvDataToCsv 全迁 data.ts。server.ts 启动时的 `_ensurePsWorker()` 预热调用由 createData 内部完成（构造时预热）。SJCJ/Heixiazi（留 server.ts）的 showSaveFileDialog 调用改 `data.showSaveFileDialog`。

### D5. SJCJ / Heixiazi 留 server.ts（3b-3b）
SJCJ（startSavingSJCJ/stopSavingSJCJ/normalizeSJCJExcelRow + _sjcj* 状态）与 Heixiazi Excel（startSavingHeixiaziExcel/stopSavingHeixiaziExcel/normalizeHeixiaziExcelRow + _heixiaziExcel* 状态）逻辑复杂（双 sheet 表头/行缓存/ExcelJS），留 3b-3b 提取。本 change 只改它们对 showSaveFileDialog 的调用（→ data.showSaveFileDialog）。

### D6. 无单测（IO 重，按 eric-writing-tests Global Gate）
data 几乎全部涉及 IO（fs.createWriteStream / ExcelJS / PowerShell spawn / CSV 写），无可独立单测的纯函数（不像 video 的 convert16to8bit）。按 eric-writing-tests Global Gate——"IO 重的行为靠集成/人工验证，不强凑单测"。本 change 不补单测，行为不变靠：tsx 启动（PowerShell 预热日志）+ **人工触发保存对照**（前端 START_SAVE_VIDEO/JG/Blackbox/YC，文件生成 + SAVE_STATUS 与重构前一致）。

## Risks / Trade-offs

- **无单测保护** → data IO 重无法单测；逐字搬迁 + git diff 逐函数审查 + tsx 启动 + 人工触发保存对照（唯一验证保存逻辑途径）。
- **状态搬迁漏引用** → 状态归 data 闭包；grep 复核 server.ts 无 isSavingVideo/videoStream/jgStream/blackboxStream/ycStream/_psWorker 残留业务引用。
- **video onFrame16bit 改调用** → data.writeVideoFrame 封装相同逻辑，等价。
- **connection handler 4 处 + control 8 case 改** → 机械替换，grep 复核。
- **PowerShell worker 搬迁** → spawn + 预热逐字搬；tsx 启动日志"PowerShell 对话框工作进程已预热完毕"对照。
- **data 实例化顺序** → data 必须在 video 前（onFrame16bit 用 data）；server.ts 调整创建顺序。

## Migration Plan

- 开发工具 change，无部署迁移。
- 顺序：创建 data.ts（含 createData + 全部函数/状态逐字搬迁）→ tsconfig include → server.ts 改用 data（移函数/状态 + 调 data 实例 + 改 video onFrame16bit + 改 connection handler 4 处 + 改 control 8 case + SJCJ/Heixiazi showSaveFileDialog 改）→ typecheck + test + tsx 启动 → git commit。
- 回滚：`git revert`。
