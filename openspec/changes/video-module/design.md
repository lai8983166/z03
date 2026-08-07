# Design: 3b-2 video 模块

## Context

server.ts 的 video 块（line 559-721 红外 + line 1611-1753 二值化）含 8 个函数 + 多个状态变量，负责 RTSP→ffmpeg 解码、16→8bit 归一化、帧广播、重连。是**遗留代码**（ffmpeg 当前不用，但 server 启动仍自动 spawn）。

video 与 data 保存耦合：`startVideoStream` 的 stdout handler 内联 `if (isSavingVideo && videoStream) { videoStream.write(frame16bit); videoFrameCount++; }`（line 592-595）。

## Goals / Non-Goals

**Goals**
- 提取 video 为 `video.ts`（完整类型，无 @ts-nocheck）。
- onFrame16bit 回调解耦 data 保存（行为等价）。
- 调用关系不变（遗留不接入不断开）。
- convert16to8bit / 包头构造纯函数单测。

**Non-Goals**
- 不迁 isSavingVideo/videoStream/videoFrameCount（留 3b-3 data）。
- 不改 ffmpeg 命令/帧布局/归一化算法/重试逻辑。
- 不测 ffmpeg spawn（碰子进程）。
- 不整体移除 server.ts @ts-nocheck。

## Decisions

### D1. createVideo 工厂（闭包维护状态）
video 状态（ffmpegProcess/isStreamingVideo/shouldRetry/isConnecting + 二值化对应 + binarizedInvert/binarizedThreshold）由 createVideo 闭包维护，不暴露（只暴露 5 个控制方法）。避免全局状态污染。

### D2. onFrame16bit 回调解耦 data 保存（行为等价）
原 stdout handler 内联：
```
if (isSavingVideo && videoStream) { videoStream.write(frame16bit); videoFrameCount++; }
```
改为：
```
if (onFrame16bit) onFrame16bit(frame16bit);
```
server.ts 注入的回调闭包封装**完全相同**的 if 逻辑（访问 server.ts 的 isSavingVideo/videoStream/videoFrameCount）。每帧调一次回调（50fps，函数调用开销可忽略）。行为逐字等价。

### D3. broadcastVideoFrame / broadcastBinarizedVideoFrame 用 wsBus.clients
两个广播函数遍历 `wsBus.clients`（OPEN 才 send）。包头格式保留（`[0x01]`/`[0x02]` + 宽高小端 + data）。与原 server.ts line 680-702/1725-1740 逐字等价。

### D4. ffmpeg 命令逐字搬迁
红外 ffmpeg 参数（`-rtsp_transport tcp`/`-probesize 32`/`-analyzeduration 0`/`-fflags nobuffer`/`-flags low_delay`/`-i RTSP_URL`/`-vf scale=128:128:...,format=gray16le`/`-f rawvideo`/`-pix_fmt gray16le`/`-r 50`/`-`）与二值化参数（`format=gray` 等）**逐字搬迁**到 video.ts。frameSize 计算（srcWidth × srcHeight × bytesPerPixel）保留。

### D5. isSavingVideo/videoStream/videoFrameCount 留 server.ts
这 3 个状态由 onFrame16bit 回调闭包访问，留在 server.ts（@ts-nocheck 下为 any）。3b-3 data 提取时连同其他保存状态（isSavingJG/blackbox/YC 等）一并迁移。

### D6. 测试只测纯函数
- `convert16to8bit(frame16)`：构造已知 min/max 的 16bit Buffer，断言 8bit 归一化；range===0 填 128。
- `broadcastVideoFrame`/`broadcastBinarizedVideoFrame`：mock wsBus.clients（参考 ws-bus 测试），断言发送 Buffer 的包头与 data。
- createVideo / startVideoStream（ffmpeg spawn）**不测**（碰子进程，违反隔离；且是遗留，行为靠 tsx 启动日志对照）。

## Risks / Trade-offs

- **回调等价性** → onFrame16bit 闭包封装原 if 逻辑逐字等价；行为不变。
- **ffmpeg 搬迁** → 命令逐字搬，tsx 启动日志对照（"准备启动 RTSP" + ffmpeg 重试）。
- **遗留不接入不断开** → server 启动仍 video.startVideoStream，SIGINT 仍 video.stop*；不改调用关系。
- **video 类型** → createVideo opts 接口清晰，typecheck 验证。
- **纯函数单测覆盖度** → convert16to8bit + 包头构造覆盖核心纯逻辑；ffmpeg 部分靠 tsx 启动 + 人工对照。

## Migration Plan

- 开发工具 change，无部署迁移。
- 顺序：创建 video.ts（含 createVideo + 纯函数 + 类型）→ tsconfig include → server.ts 改用 video（移 video 函数/状态 + 创建实例 + onFrame16bit + 调用改 video.*）→ video 测试 → typecheck + test + tsx 启动对照 → git commit。
- 回滚：`git revert`。
