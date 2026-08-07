# Proposal: 3b-2 提取 video 模块（RTSP/ffmpeg 红外 + 二值化）

## 背景：change 3b 第 2 个 sub-change

承接 3b-1（ws-bus）。本 change 提取 video 块（server.ts line 559-721 红外 + line 1611-1753 二值化，共 ~8 函数 + 状态）为独立 `video.ts` 模块。

| sub-change | 范围 | 状态 |
|---|---|---|
| 3b-1 | ws-bus 传输基础设施 | ✅ |
| **3b-2（本 change）** | **video（RTSP/ffmpeg 红外 + 二值化）** | 进行中 |
| 3b-3 | data（Excel 保存 + PowerShell + 文件对话框） | 待启动 |
| 3b-4 | control（消息路由 + WS connection 业务搬迁） | 待启动 |
| 3b-5 | bridges/turntable + server.ts @ts-nocheck 收尾 | 待启动 |

## 关键约束：遗留代码

video（RTSP/ffmpeg）是**遗留代码**（用户明确"现在不需要 ffmpeg 了"）。按全局约定：**保留 + TS 化 + 调用关系不变**——提取为 `video.ts`、补类型、移除该部分 @ts-nocheck，但 **server 启动仍自动 `startVideoStream`**（不接入也不断开，维持现状）。

## Why

1. server.ts 减约 250 行（video 是最大职责块之一）。
2. video 独立 TS 类型（无 @ts-nocheck），继续还类型债。
3. video 与 data 保存的耦合（`isSavingVideo`/`videoStream`/`videoFrameCount`）通过回调注入显式化，为 3b-3 data 提取铺路。

## What Changes

### 1. 新建 `video.ts`（完整 TS 类型，无 @ts-nocheck）
导出 `createVideo(opts)` 工厂，返回 video 控制接口。`opts` 含：
- config：`rtspUrl` / `binarizedRtspUrl` / `ffmpegPath` / `srcWidth` / `srcHeight` / `bytesPerPixel16bit`
- `wsBus`：用于 `broadcastVideoFrame`/`broadcastBinarizedVideoFrame`（遍历 `wsBus.clients` 发送带 `[0x01]`/`[0x02]` 包头的帧）
- `onFrame16bit?: (frame: Buffer) => void`：红外 16bit 帧就绪回调（**解耦数据保存**——server.ts 注入，封装原 `if (isSavingVideo && videoStream) {...}` 逻辑）

工厂内部维护状态（闭包）：`ffmpegProcess`/`isStreamingVideo`/`shouldRetry`/`isConnecting` + 二值化对应 + `binarizedInvert`/`binarizedThreshold`。

返回：`startVideoStream` / `stopVideoStream` / `startBinarizedVideoStream` / `stopBinarizedVideoStream` / `restartBinarizedVideoStream`。

ffmpeg 命令、帧布局、`convert16to8bit` 归一化、重试逻辑、包头格式（`[0x01][W:2][H:2][data]` / `[0x02]...`）—— 全部**逐字搬迁**，不改运行行为。

### 2. server.ts 改用 video 模块
- 顶部 `import { createVideo } from "./video";`
- 移除 video 函数定义（`startVideoStream`/`stopVideoStream`/`convert16to8bit`/`broadcastVideoFrame`/`startBinarizedVideoStream`/`stopBinarizedVideoStream`/`restartBinarizedVideoStream`/`broadcastBinarizedVideoFrame`）+ video 专属状态（`ffmpegProcess`/`isStreamingVideo`/`shouldRetry`/`isConnecting` + 二值化对应 + `binarizedInvert`/`binarizedThreshold`/`BINARIZED_RTSP_URL`）
- 创建 video 实例：
  ```ts
  const video = createVideo({
    rtspUrl: cfg.video.rtspUrl,
    binarizedRtspUrl: cfg.video.binarizedRtspUrl,
    ffmpegPath: cfg.video.ffmpegPath,
    srcWidth: cfg.video.srcWidth,
    srcHeight: cfg.video.srcHeight,
    bytesPerPixel16bit: cfg.video.bytesPerPixel16bit,
    wsBus,
    onFrame16bit: (frame) => {
      // 原 startVideoStream stdout handler 内联逻辑（行为等价）
      if (isSavingVideo && videoStream) {
        videoStream.write(frame);
        videoFrameCount++;
      }
    },
  });
  ```
- `startVideoStream()` 调用 → `video.startVideoStream()`；SIGINT 的 `stopVideoStream()`/`stopBinarizedVideoStream()` → `video.*`；`restartBinarizedVideoStream()`（若被 WS 消息触发）→ `video.restartBinarizedVideoStream()`
- **`isSavingVideo`/`videoStream`/`videoFrameCount` 留 server.ts**（`onFrame16bit` 闭包用，3b-3 data 提取时再迁走）
- server.ts 仍 @ts-nocheck（其他部分未拆）

### 3. video 单测
`tests/video.test.ts`：测**纯函数**，不测 ffmpeg spawn（碰子进程，违反隔离）：
- `convert16to8bit`：构造 16bit 帧Buffer（已知 min/max）→ 验证 8bit 归一化结果；range===0 分支（填 128）
- `broadcastVideoFrame`/`broadcastBinarizedVideoFrame` 包头构造：mock wsBus.clients（参考 ws-bus 测试），验证发送的 Buffer 是 `[0x01][W LE][H LE][data]` / `[0x02]...`

createVideo 工厂本身不测（它会 spawn ffmpeg）。

### 不在本 change 范围
- ❌ `isSavingVideo`/`videoStream`/`videoFrameCount` 迁移（留 3b-3 data）
- ❌ connection handler 的 0xF0 视频保存魔术字节分支（留 3b-4）
- ❌ 其他模块（data/control/bridges/turntable）
- ❌ server.ts 整体移除 @ts-nocheck

## Capabilities

### New Capabilities
- `video`：RTSP/ffmpeg 视频流模块——红外流（gray16le 解码 + 16→8bit 归一化 + 帧广播）+ 二值化流（gray 解码 + 可选反转 + 帧广播）+ 重试逻辑。遗留模块，调用关系维持现状。

### Modified Capabilities
- 无。

## Impact

### 新增文件
- `video.ts`（完整类型，无 @ts-nocheck）
- `tests/video.test.ts`
- `openspec/specs/video/spec.md`

### 修改文件
- `server.ts`：移除 video 函数/状态 + 创建 video 实例 + 调用改 video.* + onFrame16bit 注入。其余逐字不动。
- `tsconfig.node.json`：include 加 `video.ts`

### 不变
- ffmpeg 命令、帧布局、归一化算法、重试逻辑、包头格式
- 调用关系：server 启动仍自动 `startVideoStream`（遗留不接入不断开）
- `index.html`/`style.css`/前端 JS
- change 2 的 50 + 3b-1 的 6 测试仍绿

### 验收
- `npm run typecheck` 通过（video.ts 无 @ts-nocheck 被检查）
- `npm test` 通过（56 旧 + video 新测试）
- `npm run dev:server`（tsx）启动，"准备启动 RTSP 视频流监听" 日志与重构前一致
- 浏览器人工对照（视频帧广播行为；如硬件无 RTSP，ffmpeg 重试日志与重构前一致）
- git 提交一次

### 风险与对策
- **video 与 data 耦合** → onFrame16bit 回调注入，封装原 `if (isSavingVideo&&videoStream)` 逻辑，行为等价。
- **ffmpeg 逻辑搬迁** → 逐字搬迁（命令/参数/重试/帧布局全保留），tsx 启动日志对照。
- **遗留行为不变** → server 启动仍 startVideoStream（不接入不断开）；convert16to8bit/broadcastVideoFrame 单测锁住纯逻辑。
- **video.ts 类型不完整** → 接口清晰（createVideo opts + 返回接口），typecheck 验证。
