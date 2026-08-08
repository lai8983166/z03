# Tasks: 3b-2 video 模块

> 全局约定：每 change 提交一次 git；测试 mock；不改 HTML/CSS/JS 样式；**遗留代码（ffmpeg）保留 + 调用关系不变**。本 change 关键纪律：**ffmpeg 命令/帧布局/归一化算法逐字搬迁，onFrame16bit 回调封装原 if 逻辑等价**。

## 1. 创建 video.ts（skill: eric-backend）

- [ ] 1.1 新建 `video.ts`：导出 `createVideo(opts)` 工厂 + 纯函数 `convert16to8bit` + `buildVideoFramePacket`/`buildBinarizedFramePacket`（包头构造，便于单测）；opts interface（config + wsBus + onFrame16bit?）；返回接口（startVideoStream/stopVideoStream/startBinarizedVideoStream/stopBinarizedVideoStream/restartBinarizedVideoStream）。**完整 TS 类型，无 @ts-nocheck**。
- [ ] 1.2 ffmpeg 命令、frameSize 计算、stdout 帧切片、16→8bit 归一化、重试逻辑、包头格式——全部**逐字搬迁**自 server.ts line 559-721/1611-1753，不改运行行为。
- [ ] 1.3 `tsconfig.node.json` include 加 `video.ts`
- [ ] 1.4 `npx tsc -p tsconfig.node.json --noEmit` 通过（video.ts 类型干净）

## 2. server.ts 改用 video（skill: eric-backend）

- [ ] 2.1 server.ts 顶部 `import { createVideo } from "./video";`
- [ ] 2.2 移除 server.ts 的 video 函数定义（startVideoStream/stopVideoStream/convert16to8bit/broadcastVideoFrame + 二值化 4 函数）+ video 专属状态（ffmpegProcess/isStreamingVideo/shouldRetry/isConnecting + ffmpegBinarizedProcess/isStreamingBinarizedVideo/shouldRetryBinarized/isConnectingBinarized/binarizedInvert/binarizedThreshold + BINARIZED_RTSP_URL 常量）
- [ ] 2.3 创建 video 实例（在 cfg 加载 + wsBus 创建后）：
  ```ts
  const video = createVideo({
    rtspUrl: cfg.video.rtspUrl, binarizedRtspUrl: cfg.video.binarizedRtspUrl,
    ffmpegPath: cfg.video.ffmpegPath, srcWidth: cfg.video.srcWidth,
    srcHeight: cfg.video.srcHeight, bytesPerPixel16bit: cfg.video.bytesPerPixel16bit,
    wsBus,
    onFrame16bit: (frame) => {
      if (isSavingVideo && videoStream) { videoStream.write(frame); videoFrameCount++; }
    },
  });
  ```
- [ ] 2.4 启动调用 `startVideoStream()` → `video.startVideoStream()`；SIGINT `stopVideoStream()`/`stopBinarizedVideoStream()` → `video.stopVideoStream()`/`video.stopBinarizedVideoStream()`；`restartBinarizedVideoStream()`（若 WS 消息触发）→ `video.restartBinarizedVideoStream()`
- [ ] 2.5 **isSavingVideo/videoStream/videoFrameCount 留 server.ts**（onFrame16bit 闭包用，3b-3 迁）
- [ ] 2.6 grep 复核：server.ts 无残留 `function startVideoStream`/`function convert16to8bit`/`broadcastVideoFrame(`/`broadcastBinarizedVideoFrame(` 裸定义/调用（都已迁 video 或改 video.*）

## 3. video 单测（skill: eric-writing-tests）

- [ ] 3.1 `tests/video.test.ts`：测 `convert16to8bit`（构造已知 min/max 16bit Buffer → 8bit 归一化；range===0 填 128）；测 `buildVideoFramePacket`/`buildBinarizedFramePacket`（包头 `[0x01]`/`[0x02]` + 宽高小端 + data）；可选：mock wsBus.clients 测 broadcastVideoFrame 发送。**不调 createVideo（避免 spawn ffmpeg）**，全程零子进程/网络。
- [ ] 3.2 `npm test` 通过（56 旧 + video 新测试）

## 4. 验收与提交（skill: eric-quality-control + eric-review）

- [ ] 4.1 `npm run typecheck` 通过（video.ts 无 @ts-nocheck 被检查）
- [ ] 4.2 `npm test` 通过
- [ ] 4.3 `npm run dev:server`（tsx）启动，日志"准备启动 RTSP 视频流监听"与重构前一致（ffmpeg 仍 spawn，遗留调用关系不变）
- [ ] 4.4 grep 复核：server.ts 无残留 video 函数定义；video.ts 无 @ts-nocheck
- [ ] 4.5 复核约束：index.html/style.css/JS 样式未动；isSavingVideo/videoStream/videoFrameCount 仍在 server.ts；ffmpeg 调用关系未变
- [ ] 4.6 eric-review 自查（重点：ffmpeg 命令是否逐字搬、onFrame16bit 回调是否等价、video 类型是否完整、遗留是否维持现状）
- [ ] 4.7 `git commit`（本 change 一次提交）
