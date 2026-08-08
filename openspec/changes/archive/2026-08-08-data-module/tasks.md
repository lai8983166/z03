# Tasks: 3b-3a data 基础设施 + 4 类简单保存

> 全局约定：每 change 提交一次 git；不改 HTML/CSS/JS 样式；遗留代码不接入。本 change 关键纪律：**保存逻辑（文件名生成/writeStream/SAVE_STATUS 格式/PowerShell 协议）逐字搬迁，writeXxxFrame 封装原 if 逻辑等价**。data IO 重无单测，靠 tsx + 人工对照。

## 1. 创建 data.ts（skill: eric-backend）

- [ ] 1.1 新建 `data.ts`：导出 `createData(opts)` 工厂（opts: wsBus + dataDir）+ `DataOptions`/`DataController` interface。**完整 TS 类型，无 @ts-nocheck**。
- [ ] 1.2 基础设施逐字搬迁：`_psWorkerScript`（const 模板）+ `_psWorker*`/`_saveDialog*` 状态 + `_ensurePsWorker`（spawn powershell + READY 握手 + stdin/stdout，**含构造时预热**）+ `getSaveDialogInitialDir`/`rememberSaveDialogDir`/`showSaveFileDialog` + `writeRecvDataToCsv`。
- [ ] 1.3 4 类简单保存逐字搬迁：`startSavingVideo`/`stopSavingVideo`/`startSavingJG`/`stopSavingJG`/`startSavingBlackbox`/`stopSavingBlackbox`/`startSavingYC`/`stopSavingYC` + 各自状态（isSavingVideo/videoStream/videoFrameCount 等 4 组）+ cmdSendStream/cmdRecvStream（死，保留注释）。文件名生成、writeStream、SAVE_STATUS 格式全保留。
- [ ] 1.4 writeXxxFrame 接口：`writeVideoFrame(frame)`/`writeJgFrame`/`writeBlackboxFrame`/`writeYcFrame`——每个封装原 `if (isSavingXxx && xxxStream) { xxxStream.write(frame); xxxFrameCount++; }`。
- [ ] 1.5 DataController 返回上述公开方法；`tsconfig.node.json` include 加 `data.ts`；`npx tsc -p tsconfig.node.json --noEmit` 通过。

## 2. server.ts 改用 data（skill: eric-backend）

- [ ] 2.1 顶部 `import { createData } from "./data";`
- [ ] 2.2 在 wsBus 之后、video 之前创建：`const data = createData({ wsBus, dataDir: path.join(__dirname, cfg.dataDir) });`（含 DATA_DIR 计算 + 建目录，原 server.ts line 611-614 逻辑迁 data 内部或保留 server.ts 传值）
- [ ] 2.3 移除 server.ts：4 简单保存函数（startSavingVideo 等 8 个）+ 基础设施函数（_ensurePsWorker/showSaveFileDialog/getSaveDialogInitialDir/rememberSaveDialogDir/writeRecvDataToCsv）+ 状态（isSavingVideo/videoStream/videoFrameCount + JG/Blackbox/YC 组 + _psWorker*/_saveDialog*/_psWorkerScript + DATA_DIR + 启动预热调用 `_ensurePsWorker();`）
- [ ] 2.4 video 创建调整（改 3b-2 的 onFrame16bit）：`onFrame16bit: (frame) => data.writeVideoFrame(frame)`（替代原闭包访问 isSavingVideo/videoStream）。确认 data 在 video 前创建。
- [ ] 2.5 connection handler 帧写入改（0xF0-0xF3 分支）：`if (isSavingVideo && videoStream) {...}` → `data.writeVideoFrame(message.slice(1))`；0xF1 → `data.writeJgFrame`；0xF2 → `data.writeBlackboxFrame`；0xF3 → `data.writeYcFrame`。**只改调用，业务逐字不动**。
- [ ] 2.6 handleControlCommand 的 8 个 save case 改 `data.startSavingXxx(data.filePath)`/`data.stopSavingXxx()`（Video/JG/Blackbox/YC）
- [ ] 2.7 SJCJ/Heixiazi 的 `showSaveFileDialog(...)` 调用改 `data.showSaveFileDialog(...)`（基础设施已迁 data，SJCJ/Heixiazi 函数本身留 server.ts）
- [ ] 2.8 writeRecvDataToCsv 的调用点（如有）改 `data.writeRecvDataToCsv(...)`
- [ ] 2.9 grep 复核：server.ts 无残留 `function startSavingVideo`/`function _ensurePsWorker`/`function showSaveFileDialog` 等定义；无残留 `isSavingVideo`/`videoStream`/`jgStream`/`blackboxStream`/`ycStream`/`_psWorker` 业务引用（SJCJ/Heixiazi 状态保留）

## 3. 验收与提交（skill: eric-quality-control + eric-review）

- [ ] 3.1 `npm run typecheck` 通过（data.ts 无 @ts-nocheck 被检查）
- [ ] 3.2 `npm test` 通过（61 旧测试，无新单测——data IO 重无可测纯函数）
- [ ] 3.3 `npm run dev:server`（tsx）启动：日志含"PowerShell 对话框工作进程已预热完毕"（与重构前一致，证明 PowerShell worker 搬迁 OK）
- [ ] 3.4 grep 复核：server.ts 无残留 data 函数定义；data.ts 无 @ts-nocheck
- [ ] 3.5 **人工触发保存对照**（前端 START_SAVE_VIDEO/JG/Blackbox/YC，文件生成 + SAVE_STATUS 广播与重构前一致）——这是验证保存逻辑的唯一途径（无单测）
- [ ] 3.6 复核约束：index.html/style.css/JS 样式未动；SJCJ/Heixiazi 仍在 server.ts；遗留代码（ffmpeg）未变
- [ ] 3.7 eric-review 自查（重点：保存逻辑逐字搬、writeXxxFrame 等价、状态搬迁无漏引、PowerShell worker 行为、调用点全改）
- [ ] 3.8 `git commit`（本 change 一次提交）
