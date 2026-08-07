import { spawn, type ChildProcess } from "child_process";
import type { WsBus } from "./ws-bus";

/**
 * video 模块：RTSP/ffmpeg 视频流（红外 gray16le + 二值化 gray）。
 *
 * 遗留模块（ffmpeg 当前不用，但 server 启动仍自动 startVideoStream，
 * 维持现状——不接入也不断开）。
 *
 * 与控制层的耦合（binarizedInvert / isStreamingBinarized 由 server.ts 的
 * handleJsonControlMessage 管理）通过 getter 注入，video 只读。
 */

export interface VideoOptions {
  rtspUrl: string;
  binarizedRtspUrl: string;
  ffmpegPath: string;
  srcWidth: number;
  srcHeight: number;
  bytesPerPixel16bit: number;
  wsBus: WsBus;
  /** 红外 16bit 帧就绪回调（server.ts 注入，封装数据保存逻辑） */
  onFrame16bit?: (frame: Buffer) => void;
  /** 二值化反转参数（由控制层管理，video 只读） */
  getBinarizedInvert?: () => boolean;
  /** 二值化"应运行"标志（由控制层管理，video restart 只读） */
  getIsStreamingBinarized?: () => boolean;
}

export interface VideoController {
  startVideoStream(): void;
  stopVideoStream(): void;
  startBinarizedVideoStream(): void;
  stopBinarizedVideoStream(): void;
  restartBinarizedVideoStream(): void;
}

/**
 * 16bit 灰度帧归一化为 8bit（逐字搬迁自原 server.ts convert16to8bit）。
 * 纯函数，便于单测。
 */
export function convert16to8bit(frame16: Buffer, pixelCount: number): Buffer {
  const frame8 = Buffer.alloc(pixelCount);
  let min = 65535;
  let max = 0;
  for (let i = 0; i < pixelCount; i++) {
    const val = frame16.readUInt16LE(i * 2);
    if (val < min) min = val;
    if (val > max) max = val;
  }
  const range = max - min;
  if (range === 0) {
    frame8.fill(128);
  } else {
    const scale = 255 / range;
    for (let i = 0; i < pixelCount; i++) {
      const val = frame16.readUInt16LE(i * 2);
      frame8[i] = Math.round((val - min) * scale);
    }
  }
  return frame8;
}

/** 构造红外帧包头 [0x01][W LE][H LE] + data（纯函数，便于单测） */
export function buildVideoFramePacket(frameData: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(5);
  header[0] = 0x01;
  header.writeUInt16LE(width, 1);
  header.writeUInt16LE(height, 3);
  return Buffer.concat([header, frameData]);
}

/** 构造二值化帧包头 [0x02][W LE][H LE] + data（纯函数，便于单测） */
export function buildBinarizedFramePacket(frameData: Buffer, width: number, height: number): Buffer {
  const header = Buffer.alloc(5);
  header[0] = 0x02;
  header.writeUInt16LE(width, 1);
  header.writeUInt16LE(height, 3);
  return Buffer.concat([header, frameData]);
}

/** 创建 video 控制器（闭包维护 ffmpeg 进程与重试状态） */
export function createVideo(opts: VideoOptions): VideoController {
  const {
    rtspUrl,
    binarizedRtspUrl,
    ffmpegPath,
    srcWidth,
    srcHeight,
    bytesPerPixel16bit,
    wsBus,
    onFrame16bit,
  } = opts;

  const pixelCount = srcWidth * srcHeight;
  const frameSize16bit = pixelCount * bytesPerPixel16bit;
  const binarizedFrameSize = pixelCount; // gray = 1 字节/像素

  // 红外流状态
  let ffmpegProcess: ChildProcess | null = null;
  let isConnecting = false;
  let shouldRetry = false;

  // 二值化流状态
  let ffmpegBinarizedProcess: ChildProcess | null = null;
  let isConnectingBinarized = false;
  let shouldRetryBinarized = false;

  function broadcastVideoFrame(frameData: Buffer, width: number, height: number): void {
    wsBus.broadcastBinary(buildVideoFramePacket(frameData, width, height));
  }

  function broadcastBinarizedVideoFrame(frameData: Buffer, width: number, height: number): void {
    wsBus.broadcastBinary(buildBinarizedFramePacket(frameData, width, height));
  }

  function startVideoStream(): void {
    if (ffmpegProcess) return;

    if (!isConnecting) {
      console.log("🎬 正在等待/连接 RTSP 视频流...");
      isConnecting = true;
    }
    shouldRetry = true;

    ffmpegProcess = spawn(ffmpegPath, [
      "-rtsp_transport", "tcp",
      "-probesize", "32",
      "-analyzeduration", "0",
      "-fflags", "nobuffer",
      "-flags", "low_delay",
      "-i", rtspUrl,
      "-vf", "scale=128:128:in_range=full:out_range=full,format=gray16le",
      "-f", "rawvideo",
      "-pix_fmt", "gray16le",
      "-r", "50",
      "-",
    ]);

    let frameBuffer = Buffer.alloc(0);

    ffmpegProcess.stdout!.on("data", (data: Buffer) => {
      frameBuffer = Buffer.concat([frameBuffer, data]);
      while (frameBuffer.length >= frameSize16bit) {
        const frame16bit = frameBuffer.subarray(0, frameSize16bit);
        frameBuffer = frameBuffer.subarray(frameSize16bit);
        if (onFrame16bit) onFrame16bit(frame16bit);
        const frame8bit = convert16to8bit(frame16bit, pixelCount);
        broadcastVideoFrame(frame8bit, srcWidth, srcHeight);
      }
    });

    ffmpegProcess.stdout!.once("data", () => {
      console.log(" RTSP 视频流已连接！画面传输中...");
      isConnecting = false;
    });

    ffmpegProcess.stderr!.on("data", (data: Buffer) => {
      const msg = data.toString();
      if (!isConnecting && (msg.includes("Error") || msg.includes("error"))) {
        // 静默（原逻辑保留）
      }
    });

    ffmpegProcess.on("close", () => {
      ffmpegProcess = null;
      if (shouldRetry) {
        setTimeout(() => startVideoStream(), 100);
      } else {
        console.log("🛑 FFmpeg 已手动停止，不再重连。");
        isConnecting = false;
      }
    });

    ffmpegProcess.on("error", () => {
      if (shouldRetry) {
        setTimeout(() => startVideoStream(), 1000);
      }
    });
  }

  function stopVideoStream(): void {
    shouldRetry = false;
    isConnecting = false;
    if (ffmpegProcess) {
      ffmpegProcess.kill("SIGTERM");
      ffmpegProcess = null;
      console.log("🛑 视频流已停止");
    }
  }

  function startBinarizedVideoStream(): void {
    if (ffmpegBinarizedProcess) return;

    if (!isConnectingBinarized) {
      console.log("🎬 正在启动二值化 RTSP 视频流...");
      isConnectingBinarized = true;
    }
    shouldRetryBinarized = true;

    ffmpegBinarizedProcess = spawn(ffmpegPath, [
      "-rtsp_transport", "tcp",
      "-probesize", "32",
      "-analyzeduration", "0",
      "-fflags", "nobuffer",
      "-flags", "low_delay",
      "-i", binarizedRtspUrl,
      "-vf", "scale=128:128:in_range=full:out_range=full,format=gray",
      "-f", "rawvideo",
      "-pix_fmt", "gray",
      "-r", "50",
      "-",
    ]);

    let frameBuffer = Buffer.alloc(0);

    ffmpegBinarizedProcess.stdout!.on("data", (data: Buffer) => {
      frameBuffer = Buffer.concat([frameBuffer, data]);
      while (frameBuffer.length >= binarizedFrameSize) {
        const frame = frameBuffer.subarray(0, binarizedFrameSize);
        frameBuffer = frameBuffer.subarray(binarizedFrameSize);

        let processedFrame = frame;
        if (opts.getBinarizedInvert?.()) {
          processedFrame = Buffer.alloc(binarizedFrameSize);
          for (let i = 0; i < binarizedFrameSize; i++) {
            processedFrame[i] = frame[i] === 0 ? 255 : 0;
          }
        }
        broadcastBinarizedVideoFrame(processedFrame, srcWidth, srcHeight);
      }
    });

    ffmpegBinarizedProcess.stdout!.once("data", () => {
      console.log("✅ 二值化 RTSP 视频流已连接！");
      isConnectingBinarized = false;
    });

    ffmpegBinarizedProcess.stderr!.on("data", (data: Buffer) => {
      const msg = data.toString();
      console.log(`[FFmpeg 二值化流] ${msg.trim()}`);
    });

    ffmpegBinarizedProcess.on("close", () => {
      ffmpegBinarizedProcess = null;
      if (shouldRetryBinarized) {
        setTimeout(() => startBinarizedVideoStream(), 100);
      } else {
        console.log("🛑 二值化 FFmpeg 已手动停止，不再重连。");
        isConnectingBinarized = false;
      }
    });

    ffmpegBinarizedProcess.on("error", () => {
      if (shouldRetryBinarized) {
        // 原代码此处注释保留（不重试）
      }
    });
  }

  function stopBinarizedVideoStream(): void {
    shouldRetryBinarized = false;
    isConnectingBinarized = false;
    if (ffmpegBinarizedProcess) {
      ffmpegBinarizedProcess.kill("SIGTERM");
      ffmpegBinarizedProcess = null;
      console.log("🛑 二值化视频流已停止");
    }
  }

  function restartBinarizedVideoStream(): void {
    const wasRunning = ffmpegBinarizedProcess !== null;
    stopBinarizedVideoStream();
    setTimeout(() => {
      if (wasRunning || opts.getIsStreamingBinarized?.()) {
        startBinarizedVideoStream();
      }
    }, 200);
  }

  return {
    startVideoStream,
    stopVideoStream,
    startBinarizedVideoStream,
    stopBinarizedVideoStream,
    restartBinarizedVideoStream,
  };
}
