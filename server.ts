import http from "http";
import WebSocket from "ws";
import path from "path";
import fs from "fs";
import { loadConfig } from "./config";
import { createWsBus } from "./ws-bus";
import { createVideo } from "./video";
import { createData } from "./data";
import { createControl } from "./control";
import { createTurntable } from "./turntable";
import { createBridges } from "./bridges";

// ==================== 配置 ====================
// 所有运行时参数集中在 config.json，由 config.js 的 loadConfig 读取并校验。
// 值校准自原硬编码（行为不变），结构模板见 config.example.json。
const cfg = loadConfig("./config.json");

const HTTP_PORT = cfg.http.port;
const WS_PORT = cfg.ws.port;
const WS_PORT_IMG = cfg.ws.portImg; // 图像上传专用 WebSocket 端口

// Bridge / 图像上传配置已迁 bridges 模块（cfg.bridges / cfg.imageUpload）

// ==================== HTTP 服务器====================
// 静态服务策略：
// - "/" 或 "/index.html" → ./dist/index.html（vite build 产物）
// - "/assets/*" → ./dist/assets/*（vite build 编译后的 JS/CSS 带 hash）
// - 其他（/csv/*、/node_modules/*、/style.css 等）→ 项目根（"." + url）
// 开发模式下（npm run dev），vite dev :5173 代理 /csv 到 :8080，行为等价。
const server = http.createServer((req, res) => {
  let filePath: string;
  if (req.url === "/" || req.url === "/index.html") {
    filePath = "./dist/index.html";
  } else if (req.url?.startsWith("/assets/")) {
    filePath = "./dist" + req.url;
  } else {
    filePath = "." + (req.url ?? "/");
  }

  const extname = String(path.extname(filePath)).toLowerCase();
  const mimeTypes: Record<string, string> = {
    ".html": "text/html",
    ".js": "text/javascript",
    ".css": "text/css",
    ".json": "application/json",
    ".png": "image/png",
    ".jpg": "image/jpg",
    ".csv": "text/csv",
  };

  const contentType = mimeTypes[extname] || "application/octet-stream";

  fs.readFile(filePath, (error, content) => {
    if (error) {
      if (error.code === "ENOENT") {
        res.writeHead(404);
        res.end("404 Not Found");
      } else {
        res.writeHead(500);
        res.end("Server Error: " + error.code);
      }
    } else {
      res.writeHead(200, { "Content-Type": contentType });
      res.end(content, "utf-8");
    }
  });
});

server.listen(HTTP_PORT, "0.0.0.0", () => {
  console.log(`\n🌐 HTTP Server: http://localhost:${HTTP_PORT}/`);
});

// ==================== WebSocket 服务器（由 ws-bus 创建）====================
const wsBus = createWsBus(WS_PORT, WS_PORT_IMG);
const { wss, wssImg, clients, imgClients } = wsBus;
wssImg.on("connection", (ws) => {
  console.log("\n✅ ImageUpload WebSocket client connected");
  imgClients.add(ws);

  ws.send(JSON.stringify({ type: "img_connected", message: "ImageUpload WS connected" }));

  ws.on("message", (message) => {
    // 所有来自前端的二进制消息直接转发到图像上传 UDP
    if (Buffer.isBuffer(message)) {
      // 尝试 JSON 解析（控制消息）
      try {
        const data = JSON.parse(message.toString());
        console.log("[IMG-WS] 收到 JSON 控制消息:", data.type);
        // 如有需要可在此处理图像上传专属控制消息
      } catch (e) {
        // 非 JSON → 二进制 UDP 数据包，直接转发
        console.log(`[IMG-WS] 转发二进制到图像上传UDP (${message.length} 字节)`);
        bridges.sendImageUpload(message);
      }
    }
  });

  ws.on("close", () => {
    console.log("🔌 ImageUpload WebSocket client disconnected");
    imgClients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("❌ ImageUpload WebSocket error:", err);
  });
});

// broadcastImg / broadcastBinary 由 ws-bus 提供（见 wsBus.broadcastImg / broadcastBinary）

let udpReady = false;
wss.on("connection", (ws) => {
  console.log("\n✅ WebSocket client connected");
  clients.add(ws);

  ws.send(
    JSON.stringify({
      type: "connected",
      message: "WebSocket connected to UDP bridge",
    }),
  );

  // 如果 UDP 已经就绪，立即通知新客户端
  if (udpReady) {
    console.log("   UDP 已就绪，立即通知客户端");
    ws.send(
      JSON.stringify({
        type: "udp_ready",
        message: "UDP connection established",
      }),
    );
  }

  // 接收前端消息
  ws.on("message", (message) => {
    // 根据消息类型初步分流

    //console.log(mes);
    let messageStr = null;
    let messageBuffer = null;

    //console.log("message:::",message.mes_type);

    /*if (mes.type==="udp") {
      
      messageBuffer = mes.data;

        console.log("mes.data:::", typeof mes.data);
        console.log("mes:::", mes);
      
        
        bridges.sendToBridge1(messageBuffer);
      

    } else if (typeof mes.type === "string") {
        // 文本消息：期望是 JSON 控制命令
        let mes = message.toString();
        mes = JSON.parse(mes);
        messageStr = mes.action;

      // 空消息检查
      if (!messageStr || messageStr.trim().length === 0) {
        console.warn("⚠️ 收到空文本消息，忽略");
        return;
      }

      // 尝试解析 JSON
      try {
        const data = mes;
        console.log("📨 [WebSocket] JSON 消息:", data.type);

        // 处理各类控制消息
        control.handleJsonControlMessage(data, ws);

      } catch (e) {
        // 真正的异常：格式错误的 JSON
        console.error("❌ JSON 解析失败:", e.message);
        console.error("   消息内容:", messageStr.substring(0, 100));
        // 格式错误的 JSON 不转发到 UDP
      }

    } else {
        console.log(`server 转发数据 (${message.length} 字节)`);
        console.log(
            `   数据: ${message.slice(0, 32).toString("hex")}${message.length > 32 ? "..." : ""
            }`,
        );

        bridges.sendToBridge1(message);
    }*/
    // 优先检测视频帧保存魔术字节 (0xF0 前缀，非JSON)
    if (Buffer.isBuffer(message) && message.length > 1 && message[0] === 0xf0) {
      data.writeVideoFrame(message.slice(1));
      return;
    }

    // 检测激光帧保存魔术字节 (0xF1 前缀)
    if (Buffer.isBuffer(message) && message.length > 1 && message[0] === 0xf1) {
      data.writeJgFrame(message.slice(1));
      return;
    }

    // 检测黑匣子帧保存魔术字节 (0xF2 前缀)
    if (Buffer.isBuffer(message) && message.length > 1 && message[0] === 0xf2) {
      data.writeBlackboxFrame(message.slice(1));
      return;
    }

    // 检测YC数据保存魔术字节 (0xF3 前缀)
    if (Buffer.isBuffer(message) && message.length > 1 && message[0] === 0xf3) {
      data.writeYcFrame(message.slice(1));
      return;
    }

    try {
      const data = JSON.parse(message.toString());
      console.log("[MSG] [WebSocket] 文本消息:", data.type);

      // 处理控制消息（如 ping/pong）
      control.handleJsonControlMessage(data, ws);
    } catch (e) {
      //console.log(`server 转发数据 (${message.length} 字节)`);
      /*console.log(
        `   数据: ${message.toString("hex")}${
          message.length > 32 ? "..." : ""
        }`,
      );*/

      bridges.sendToBridge1(message as Buffer);
    }
  });

  ws.on("close", () => {
    console.log("🔌 WebSocket client disconnected");
    clients.delete(ws);
  });

  ws.on("error", (err) => {
    console.error("❌ WebSocket error:", err);
  });
});

// ==================== Bridge 配置 + 事件监听 + 初始化 ====================

// --- 3 路 Bridge 装配（由 bridges 模块管理）---
const bridges = createBridges({
  wsBus,
  bridges: cfg.bridges,
  onBridge1Ready: () => { udpReady = true; },
});

// ==================== 转台串口（由 turntable 模块管理）====================
const turntable = createTurntable({
  wsBus,
  serialPort: cfg.turntable.serialPort,
  baudRate: cfg.turntable.baudRate,
});
turntable.init();

// broadcast 由 ws-bus 提供（见 wsBus.broadcast）

// ====================关闭 ====================
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  bridges.close();
  turntable.close();
  wsBus.close();
  server.close();
  process.exit(0);
});

console.log("\n📋 Server ready. Press Ctrl+C to stop.\n");

// ==================== RTSP 视频流配置 ====================
//const RTSP_URL = "rtsp://localhost:8554/live";
const RTSP_URL = cfg.video.rtspUrl;
const SRC_WIDTH = cfg.video.srcWidth; // 原始分辨率
const SRC_HEIGHT = cfg.video.srcHeight;
const BYTES_PER_PIXEL_16BIT = cfg.video.bytesPerPixel16bit;
const FRAME_SIZE_16BIT = SRC_HEIGHT * SRC_WIDTH * BYTES_PER_PIXEL_16BIT;
const FRAME_SIZE_8BIT = SRC_HEIGHT * SRC_WIDTH;
// ==================== 数据保存 + RTSP 视频流（由 data / video 模块管理）====================
const DATA_DIR = path.join(__dirname, cfg.dataDir);
if (!fs.existsSync(DATA_DIR)) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
}
const data = createData({ wsBus, dataDir: DATA_DIR });

// video 模块封装红外 + 二值化两条 ffmpeg 流；onFrame16bit 通过 data.writeVideoFrame
// 写入视频帧（isSavingVideo/videoStream 已迁 data 模块）。
const video = createVideo({
  rtspUrl: cfg.video.rtspUrl,
  binarizedRtspUrl: cfg.video.binarizedRtspUrl,
  ffmpegPath: cfg.video.ffmpegPath,
  srcWidth: cfg.video.srcWidth,
  srcHeight: cfg.video.srcHeight,
  bytesPerPixel16bit: cfg.video.bytesPerPixel16bit,
  wsBus,
  onFrame16bit: (frame) => data.writeVideoFrame(frame),
  getBinarizedInvert: () => binarizedInvert,
  getIsStreamingBinarized: () => isStreamingBinarizedVideo,
});

const control = createControl({
  wsBus,
  data,
  video,
  turntable: {
    send: (buf) => turntable.send(buf),
    setPort: (port) => turntable.setPort(port),
  },
  binarized: {
    getInvert: () => binarizedInvert,
    setInvert: (v) => { binarizedInvert = v; },
    getThreshold: () => binarizedThreshold,
    setThreshold: (v) => { binarizedThreshold = v; },
    getIsStreaming: () => isStreamingBinarizedVideo,
    setIsStreaming: (v) => { isStreamingBinarizedVideo = v; },
  },
});

// 服务器启动后自动启动视频流（当前注释，维持遗留"不接入"现状）
console.log("\n🎥 准备启动 RTSP 视频流监听...");
/*setTimeout(() => {
  video.startVideoStream();
}, 2000);*/

// 关闭时停止视频流
process.on("SIGINT", () => {
  console.log("\n🛑 Shutting down...");
  video.stopVideoStream();
  bridges.close();
  turntable.close();
  wsBus.close();
  server.close();
  process.exit(0);
});

// ==================== 数据保存（全部由 data 模块管理）====================
// SJCJ / Heixiazi / Video / JG / Blackbox / YC 保存 + 基础设施已迁 data 模块。
// DATA_DIR 与保存目录创建已提前到 data 模块创建处（见上方 video/data 创建块）

// SJCJ 函数（normalizeSJCJExcelRow / startSavingSJCJ / stopSavingSJCJ）已迁 data 模块

/**
 * 启动视频流保存
 * @param {string} [filePath] - 前端指定的保存路径（含文件名），不传则自动生成
 */
// startSavingVideo / stopSavingVideo 已迁 data 模块

// startSavingJG / stopSavingJG 已迁 data 模块

// startSavingBlackbox / stopSavingBlackbox 已迁 data 模块

// startSavingYC / stopSavingYC 已迁 data 模块

// Heixiazi 函数（startSavingHeixiaziExcel / normalizeHeixiaziExcelRow / stopSavingHeixiaziExcel）已迁 data 模块

/**
 * 调用 PowerShell 弹出系统原生的文件保存对话框
 * 使用常驻预热 PowerShell 进程弹出文件保存对话框，避免每次冷启动的 1-2s 延迟。
 * @param {string} defaultName - 默认文件名
 * @param {string} filter      - 文件类型过滤（WinForms 格式）
 * @returns {Promise<string|null>} 用户选择的路径，取消时返回 null
 */

// PowerShell worker + 文件对话框状态已迁 data 模块

// _psWorkerScript（PowerShell 对话框脚本）已迁 data 模块

// _ensurePsWorker + 启动预热已迁 data 模块（createData 构造时预热）

// getSaveDialogInitialDir / rememberSaveDialogDir / showSaveFileDialog 已迁 data 模块

/**
 * 处理 JSON 控制消息
 * @param {Object} data - 解析后的 JSON 数据
 * @param {WebSocket} ws - WebSocket 连接对象
 */
// handleJsonControlMessage 已迁 control 模块

/**
 * 处理具体的控制命令
 * @param {Object} data - 控制命令数据
 */
// handleControlCommand 已迁 control 模块

/**
 * 将二进制 buffer 格式化为 CSV 行并写入
 * (这里需要实现类似于 PacketManager 的解码逻辑，或者简化处理直接存 Hex?)
 * 根据 C++ 代码逻辑，它是写入 "解析后的数值"。
 * 如果我们在后端没有完整的 BinaryTableHelper 逻辑，
 * 最好的办法是：前端解析好 CSV 字符串发给后端存 (方案A)，
 * 或者后端只存 Hex 以后再处理 (方案B)。
 *
 * 鉴于前端已有 helper.updateAllToTable 解析逻辑，
 * 我们可以仅在后端做原始数据转存：
 */
// writeRecvDataToCsv 已迁 data 模块

// ==================== 二值化流状态（进程由 video 模块管理）====================
// isStreamingBinarizedVideo / binarizedThreshold / binarizedInvert 由 control 层
// （handleJsonControlMessage / handleControlCommand）管理；video 通过 getter 读。
let isStreamingBinarizedVideo = false;
let binarizedThreshold = 128; // 二值化阈值
let binarizedInvert = false; // 是否反转

// 二值化视频流函数（startBinarizedVideoStream / stopBinarizedVideoStream /
// broadcastBinarizedVideoFrame / restartBinarizedVideoStream）已迁 video 模块。

// 监听来自前端的二值化参数设置消息
// 在 ws.on("message") 中添加对二值化参数的处理
