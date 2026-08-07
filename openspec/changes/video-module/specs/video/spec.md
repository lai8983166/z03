# Spec Delta: video

> 本 change 新增 video 模块：RTSP/ffmpeg 红外 + 二值化视频流。遗留代码（ffmpeg 当前不用），保留 + TS 化 + 调用关系不变。新文件完整类型（无 @ts-nocheck）。

## ADDED Requirements

### Requirement: video 模块导出 createVideo 工厂
项目 MUST 提供 `video.ts`，导出 `createVideo(opts)` 工厂，返回含 `startVideoStream`/`stopVideoStream`/`startBinarizedVideoStream`/`stopBinarizedVideoStream`/`restartBinarizedVideoStream` 的控制接口。`opts` MUST 包含 config（rtspUrl/binarizedRtspUrl/ffmpegPath/srcWidth/srcHeight/bytesPerPixel16bit）、`wsBus`、可选 `onFrame16bit` 回调。

#### Scenario: createVideo 返回 5 个控制方法
- **WHEN** 调用 `createVideo({...})`（不启动流）
- **THEN** 返回对象含 `startVideoStream`/`stopVideoStream`/`startBinarizedVideoStream`/`stopBinarizedVideoStream`/`restartBinarizedVideoStream` 五个函数

### Requirement: 红外视频流解码 + 16→8bit 归一化 + 帧广播
`startVideoStream` MUST spawn ffmpeg（命令、参数、RTSP_URL、`scale=128:128:...,format=gray16le`、`-r 50` 等与重构前逐字一致），从 stdout 按帧大小（srcWidth × srcHeight × 2 字节）切片，每帧：若提供 `onFrame16bit` 回调 MUST 调用之（传入 16bit 帧 Buffer），然后经 `convert16to8bit` 归一化为 8bit，由 `broadcastVideoFrame` 加 `[0x01][W LE][H LE]` 包头广播到 `wsBus.clients`。ffmpeg 退出时 MUST 按现有重试逻辑（`shouldRetry`）重连。

#### Scenario: 16bit 帧归一化为 8bit
- **WHEN** `convert16to8bit` 接收一个已知 min/max 的 16bit 帧 Buffer
- **THEN** 输出 8bit Buffer，每像素 = round((val - min) * 255 / (max - min))；range===0 时填充 128

#### Scenario: 视频帧包头格式
- **WHEN** `broadcastVideoFrame(frame, 128, 128)` 向一个 OPEN 的 mock client 广播
- **THEN** client.send 收到 Buffer，`[0]=0x01`、`[1-2]`=128 小端、`[3-4]`=128 小端、`[5..]`=frame

### Requirement: 二值化视频流
`startBinarizedVideoStream` MUST spawn ffmpeg（BINARIZED_RTSP_URL、`format=gray`、`-r 50` 等与重构前一致），stdout 按帧切片，可选反转（`binarizedInvert`），由 `broadcastBinarizedVideoFrame` 加 `[0x02][W LE][H LE]` 包头广播到 `wsBus.clients`。重试逻辑与重构前一致。

#### Scenario: 二值化帧包头
- **WHEN** `broadcastBinarizedVideoFrame(frame, 128, 128)` 广播
- **THEN** client.send 收到 Buffer，`[0]=0x02`、`[1-4]`=宽高小端、`[5..]`=frame

### Requirement: video 完整 TS 类型（无 @ts-nocheck）
`video.ts` MUST 提供完整 TypeScript 类型（createVideo opts interface、返回接口、纯函数参数/返回值），MUST NOT 使用 `// @ts-nocheck`。

#### Scenario: video 通过 typecheck
- **WHEN** 运行 `npm run typecheck`
- **THEN** node tsconfig（include video.ts）检查通过

### Requirement: video 调用关系不变（遗留）
server.ts MUST 在启动时仍调用 `video.startVideoStream()`（维持"server 启动自动 spawn ffmpeg"的现状），SIGINT MUST 调用 `video.stopVideoStream()` 与 `video.stopBinarizedVideoStream()`。**不得新增或断开**现有 video 调用（遗留代码不接入不断开）。

#### Scenario: server 启动仍自动 startVideoStream
- **WHEN** `npm run dev:server` 启动
- **THEN** 日志含"准备启动 RTSP 视频流监听"，与重构前一致（ffmpeg 仍被 spawn，行为不变）
