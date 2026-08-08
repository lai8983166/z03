/**
 * 视频流处理模块
 * - 接收 WebSocket 推送的帧数据
 * - 在 Canvas 上渲染图像
 * - 处理图像显示模式（直方图均衡、线性拉伸等）
 * - 计算分析区域统计信息
 */

import { Utils } from "../main";
import wsClient from "./Client";
import statusBar from "./StatusBar";
import { handle_YC_DATA } from "./Telemeter";

// ==================== 视频保存状态 ====================
export let isSavingVideo = false;

/**
 * 开始保存视频帧
 * 向服务端发送 REQUEST_SAVE_PATH 请求，由服务端弹出原生文件保存对话框选择路径，
 * 服务端选定路径后直接开始保存并回传 SAVE_STATUS 通知前端。
 */
export function startSavingVideo() {
  statusBar.sendMessage("请在服务端窗口选择保存位置...", "black");
  const cmd = JSON.stringify({
    type: "REQUEST_SAVE_PATH",
    saveType: "video",
    defaultName: "红外视频流.dat",
    filter: "数据文件 (*.dat)|*.dat|所有文件 (*.*)|*.*",
  });
  wsClient.sendText(cmd);
  console.log("[Video] 请求服务端弹出文件保存对话框");

  // 监听服务端回传的保存状态（一次性）
  const onStatus = (msg) => {
    if (msg.saveType !== "video") return;
    wsClient.off("SAVE_STATUS", onStatus);
    if (msg.status === "started") {
      isSavingVideo = true;
      statusBar.sendMessage(`正在保存视频流 → ${msg.path}`, "black");
    } else if (msg.status === "cancelled") {
      statusBar.sendMessage("已取消保存", "gray");
    } else if (msg.status === "error") {
      statusBar.sendMessage(`保存失败: ${msg.msg}`, "red");
    }
  };
  wsClient.on("SAVE_STATUS", onStatus);
}

/**
 * 停止保存视频帧
 */
export function stopSavingVideo() {
  isSavingVideo = false;
  const cmd = JSON.stringify({
    type: "CONTROL_CMD",
    action: "STOP_SAVE_VIDEO",
  });
  wsClient.sendText(cmd);
  statusBar.sendMessage("视频流保存已停止");
  console.log("[Video] 停止保存视频帧");
}

const SRC_SIZE = 128;
const DST_SIZE = 384;
const SCALE = 3; // 放大倍数

const REPLAY_16BIT = true;

let frameCount = 0;
let processedData = null;

// 图像帧统计（用于调试发送、接收、渲染数量是否一致）
export const frameStats = {
  sent: 0, // 发送的帧数
  received: 0, // 接收的帧数
  rendered: 0, // 渲染的帧数
  lastLogTime: 0,

  // 重置统计
  reset() {
    this.sent = 0;
    this.received = 0;
    this.rendered = 0;
    this.lastLogTime = Date.now();
    console.log("[帧统计] 统计已重置");
  },

  // 记录发送
  logSent() {
    this.sent++;
    //this.printIfNeeded();
  },

  // 记录接收
  logReceived() {
    this.received++;
    //this.printIfNeeded();
  },

  // 记录渲染
  logRendered() {
    this.rendered++;
    //this.printIfNeeded();
  },

  
  printIfNeeded() {
    const now = Date.now();
    const elapsed = now - this.lastLogTime;

    
    if (this.received % 100 === 0 || elapsed > 5000) {
      console.log(
        `[帧统计] 发送:${this.sent} | 接收:${this.received} | 渲染:${this.rendered}` +
          ` | 丢失率:${((1 - this.received / this.sent) * 100).toFixed(1)}%` +
          ` | 渲染率:${((this.rendered / this.received) * 100).toFixed(1)}%`,
      );
      this.lastLogTime = now;
    }
  },
};


const DisplayMode = {
  NORMAL: 0,
  BIT_0_7: 1, // 0-7位显示
  BIT_1_8: 2, // 1-8位显示
  BIT_2_9: 3, // 2-9位显示
  BIT_3_10: 4, // 3-10位显示
  BIT_4_11: 5, // 4-11位显示
  BIT_5_12: 6, // 5-12位显示
  BIT_6_13: 7, // 6-13位显示
  BIT_7_14: 8, // 7-14位显示
  BIT_8_15: 9, // 8-15位显示
  BIT_16: 10, // 16位显示
  HISTOGRAM_EQ: 11, // 直方图均衡
  LINEAR_STRETCH: 12, // 线性拉伸（分段线性）
};

// 状态
const VideoState = {
  isPlaying: false,
  displayMode: DisplayMode.NORMAL,
  linearMin: 0,
  linearMax: 16383,

  // 红框
  analysisRect: { x1: 0, y1: 0, x2: 383, y2: 383 },

  // 选中中心点（蓝框 11x11 区域）
  selectedCenter: { x: 192, y: 192 },

  // 统计信息
  stats: { max: 0, min: 0, avg: 0, std: 0 },

  // 帧计数
  frameCount: 0,
  // 用于平滑拉伸
  stretchLow: null,
  stretchHigh: null,
  stretchAlpha: 0.1,

  // 回放状态
  isReplaying: false,   // 是否在回放模式（已加载数据）
  isReplayPaused: true, // 是否暂停（true=暂停，false=播放中）
  replayData: null, // 回放文件的帧数据数组
  replayDataType: "video", // 回放文件的数据类型: "video" 或者是 "blackbox"
  replayCurrentFrame: 0, // 当前回放帧索引
  replayTotalFrames: 0, // 回放总帧数
  replayTimer: null, // 回放定时器
  replayFps: 25, // 回放帧率

  //目标框（绿框）状态
  targetBox: { x: null, y: null, visible: false },

  // 红框拖拽状态
  isDragging: false,
  dragStart: { x: 0, y: 0 },
  dragCurrent: { x: 0, y: 0 },
  isMouseDown: false,
  _rafPending: false,   // 防止拖拽时积攒多个 rAF 回调
};

// Canvas 引用
let canvas384 = null; // 384x384 红外图像
let ctx384 = null;
let canvas11x11 = null; // 11x11 放大区域
let ctx11x11 = null;
let responseLastUpdateAt = 0;

// 原始帧数据缓存
let currentFrame = null;

/**
 * 初始化视频显示
 */
export function initializeVideoStream() {
  // 获取 384x384 Canvas
  const container = document.getElementById("infrared-widget");
  if (container) {
    canvas384 = document.createElement("canvas");
    canvas384.width = 384;
    canvas384.height = 384;
    canvas384.style.cursor = "crosshair";
    container.appendChild(canvas384);
    ctx384 = canvas384.getContext("2d");

    canvas384.addEventListener("mousedown", onCanvasMouseDown);
    canvas384.addEventListener("mousemove", onCanvasMouseMove);
    canvas384.addEventListener("mouseup", onCanvasMouseUp);
    canvas384.addEventListener("mouseleave", onCanvasMouseLeave);
  }

  // 获取 11x11 区域 Canvas
  const container11 = document.getElementById("widget_2");
  if (container11) {
    canvas11x11 = document.createElement("canvas");
    canvas11x11.width = 220;
    canvas11x11.height = 220;
    container11.appendChild(canvas11x11);
    ctx11x11 = canvas11x11.getContext("2d");

    // 双击 11x11 画布重新定位中心
    canvas11x11.addEventListener("dblclick", (e) => {
      const rect = canvas11x11.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      const j = Math.floor(cx / 20);
      const i = Math.floor(cy / 20);
      shiftSelectedCenter(j, i);
    });
  }

  // 双击表格重新定位中心
  const table6 = document.getElementById("tableWidget_6");
  if (table6) {
    table6.addEventListener("dblclick", (e) => {
      const td = e.target.closest("td");
      if (!td) return;
      const tr = td.parentElement;
      const j = Array.from(tr.children).indexOf(td);
      const i = Array.from(tr.parentElement.children).indexOf(tr);
      if (j >= 0 && i >= 0) {
        shiftSelectedCenter(j, i);
      }
    });
  }

  function shiftSelectedCenter(j, i) {
    const dx128 = j - 5;
    const dy128 = i - 5;
    const SCALE = 3;
    VideoState.selectedCenter.x += dx128 * SCALE;
    VideoState.selectedCenter.y += dy128 * SCALE;
    VideoState.selectedCenter.x = Math.max(5, Math.min(378, VideoState.selectedCenter.x));
    VideoState.selectedCenter.y = Math.max(5, Math.min(378, VideoState.selectedCenter.y));
    
    if (VideoState.isReplaying && VideoState.isReplayPaused) {
      if (typeof renderFrameAt === 'function') {
        renderFrameAt(VideoState.replayCurrentFrame);
      }
    } else {
      update11x11Region();
    }
  }

  // 绑定显示模式切换
  const modeSelect = document.getElementById("comboBox_ImgShowMode");
  if (modeSelect) {
    modeSelect.addEventListener("change", (e) => {
      const index = e.target.selectedIndex;
      switch (index) {
        case 0:
          VideoState.displayMode = DisplayMode.BIT_0_7;
          break;
        case 1:
          VideoState.displayMode = DisplayMode.BIT_1_8;
          break;
        case 2:
          VideoState.displayMode = DisplayMode.BIT_2_9;
          break;
        case 3:
          VideoState.displayMode = DisplayMode.BIT_3_10;
          break;
        case 4:
          VideoState.displayMode = DisplayMode.BIT_4_11;
          break;
        case 5:
          VideoState.displayMode = DisplayMode.BIT_5_12;
          break;
        case 6:
          VideoState.displayMode = DisplayMode.BIT_6_13;
          break;
        case 7:
          VideoState.displayMode = DisplayMode.BIT_7_14;
          break;
        case 8:
          VideoState.displayMode = DisplayMode.BIT_8_15;
          break;
        case 9:
          VideoState.displayMode = DisplayMode.BIT_16;
          break;
        case 10:
          VideoState.displayMode = DisplayMode.LINEAR_STRETCH;
          break;
        case 11:
          VideoState.displayMode = DisplayMode.HISTOGRAM_EQ;
          break;
        default:
          VideoState.displayMode = DisplayMode.NORMAL;
          break;
      }
    });
  }

  // 绑定分段线性参数输入（change + input 双监听，保证实时响应）
  const minInput = document.getElementById("textEdit");
  const maxInput = document.getElementById("textEdit_2");
  if (minInput) {
    const onMinChange = (e) => {
      const v = parseInt(e.target.value);
      if (!isNaN(v)) VideoState.linearMin = Math.max(0, Math.min(16383, v));
    };
    minInput.addEventListener("change", onMinChange);
    minInput.addEventListener("input",  onMinChange);
  }
  if (maxInput) {
    const onMaxChange = (e) => {
      const v = parseInt(e.target.value);
      if (!isNaN(v)) VideoState.linearMax = Math.max(0, Math.min(16383, v));
    };
    maxInput.addEventListener("change", onMaxChange);
    maxInput.addEventListener("input",  onMaxChange);
  }

  // 初始化坐标输入框
  updateAnalysisRectInputs();

  // 绑定分析区域坐标输入框：输入后实时更新红框
  const rectX  = document.getElementById("textEdit_x");
  const rectY  = document.getElementById("textEdit_y");
  const rectX1 = document.getElementById("textEdit_x1");
  const rectY1 = document.getElementById("textEdit_y1");
  const onRectInputChange = () => {
    const x1 = Math.max(0, Math.min(383, parseInt(rectX  ? rectX.value  : 0) || 0));
    const y1 = Math.max(0, Math.min(383, parseInt(rectY  ? rectY.value  : 0) || 0));
    const x2 = Math.max(0, Math.min(383, parseInt(rectX1 ? rectX1.value : 383) || 383));
    const y2 = Math.max(0, Math.min(383, parseInt(rectY1 ? rectY1.value : 383) || 383));
    VideoState.analysisRect = { x1, y1, x2, y2 };
    drawAnalysisRect();
  };
  [rectX, rectY, rectX1, rectY1].forEach((el) => {
    if (el) {
      el.addEventListener("change", onRectInputChange);
      el.addEventListener("input",  onRectInputChange);
    }
  });

  console.log("[OK] 视频显示模块初始化完成");
}

export const set_CurrentFrame = (data) => {
  currentFrame = data;
};

/**
 * 处理接收到的视频帧（由 Client.js 调用）
 * @param {Uint8Array} frameData - 灰度图像数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 */
export function handleVideoFrame(frameData, width = 128, height = 128) {
  if (!ctx384) return;

  // 如果在回放模式，并且不是黑匣子正在绘制其图像时，忽略实时视频流
  if (VideoState.isReplaying && !window.isBlackboxDrawing) {
    return;
  }

  // 统计：记录接收到帧
  frameStats.logReceived();

  // 保存当前帧的独立拷贝，避免调用方复用 buffer 导致数据被下一帧覆写
  currentFrame = frameData.slice();
  VideoState.frameCount++;

  let processedData;

  switch (VideoState.displayMode) {
    case DisplayMode.BIT_0_7:
      // 0-7位显示: dst[i] = src[i] & 0xFF
      processedData = extractBits(frameData, 0);
      break;
    case DisplayMode.BIT_1_8:
      // 1-8位显示: dst[i] = (src[i] >> 1) & 0xFF
      processedData = extractBits(frameData, 1);
      break;
    case DisplayMode.BIT_2_9:
      // 2-9位显示: dst[i] = (src[i] >> 2) & 0xFF
      processedData = extractBits(frameData, 2);
      break;
    case DisplayMode.BIT_3_10:
      // 3-10位显示: dst[i] = (src[i] >> 3) & 0xFF
      processedData = extractBits(frameData, 3);
      break;
    case DisplayMode.BIT_4_11:
      // 4-11位显示: dst[i] = (src[i] >> 4) & 0xFF
      processedData = extractBits(frameData, 4);
      break;
    case DisplayMode.BIT_5_12:
      // 5-12位显示: dst[i] = (src[i] >> 5) & 0xFF
      processedData = extractBits(frameData, 5);
      break;
    case DisplayMode.BIT_6_13:
      // 6-13位显示: dst[i] = (src[i] >> 6) & 0xFF
      processedData = extractBits(frameData, 6);
      break;
    case DisplayMode.BIT_7_14:
      // 7-14位显示: dst[i] = (src[i] >> 7) & 0xFF
      processedData = extractBits(frameData, 7);
      break;
    case DisplayMode.BIT_8_15:
      // 8-15位显示: dst[i] = (src[i] >> 8) & 0xFF
      processedData = extractBits(frameData, 8);
      break;
    case DisplayMode.BIT_16:
      // 16位显示: dst[i] = (src[i] * 255) / 16383
      processedData = map16BitTo255(frameData);
      break;
    case DisplayMode.LINEAR_STRETCH:
      // 分段线性变换：使用用户设定的上下限做线性拉伸
      processedData = linearStretch(frameData, VideoState.linearMin, VideoState.linearMax);
      break;
    case DisplayMode.HISTOGRAM_EQ:
      // 直方图均衡化
      processedData = histogramEqualization(frameData);
      break;
    default:
      // 默认模式：直方图均衡
      processedData = histogramEqualization(frameData);
      break;
  }

  drawScaledImage(ctx384, processedData, width, height);

  drawAnalysisRect();
  drawSelectedRect();
  drawTargetBox(); //绘制绿框

  // 如果正在拖拽，绘制拖拽预览框
  if (VideoState.isDragging) {
    drawDragPreview();
  }

  update11x11Region(width, processedData);
  updateStatistics();
}

/**
 * YUV 受限范围 (16-235) 转全范围 (0-255)
 */
function yuvToFullRange(data) {
  const result = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    // 公式: out = (in - 16) * 255 / 219
    // 简化为: out = (in - 16) * 1.164
    let val = Math.round((data[i] - 16) * 1.164);
    if (val < 0) val = 0;
    if (val > 255) val = 255;
    result[i] = val;
  }

  return result;
}

function cvNormalizeMinMax(data) {
  let min = 255;
  let max = 0;
  // 找极值
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }

  // 如果已经是全范围，且不需要增强对比度，其实可以直接返回 data
  // 但为了模拟 cv::normalize(src, dst, 0, 255, NORM_MINMAX)，还是算一下
  // 尤其是当传输过来的数据因为压缩可能变成了 10-240 这种范围时

  const range = max - min;
  if (range === 0) return data; // 避免全黑/全白除零

  const out = new Uint8Array(data.length);
  const scale = 255.0 / range;

  for (let i = 0; i < data.length; i++) {
    out[i] = Math.round((data[i] - min) * scale);
  }
  return out;
}

/**
 * 自动拉伸（根据当前帧的 min/max 自动映射到 0-255）
 */
function autoStretch(data) {
  let min = 255,
    max = 0;

  // 找出当前帧的最小最大值
  for (let i = 0; i < data.length; i++) {
    if (data[i] < min) min = data[i];
    if (data[i] > max) max = data[i];
  }

  const range = max - min || 1;
  const result = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    result[i] = Math.round(((data[i] - min) / range) * 255);
  }

  return result;
}

function autoStretchPercentile(data, lowP = 0.02, highP = 0.98, gamma = 0.8) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;

  const total = data.length;
  const lowCount = total * lowP;
  const highCount = total * highP;

  let cum = 0;
  let low = 0;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= lowCount) {
      low = i;
      break;
    }
  }

  cum = 0;
  let high = 255;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= highCount) {
      high = i;
      break;
    }
  }

  const range = Math.max(1, high - low);
  const out = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    let v = (data[i] - low) / range;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    v = Math.pow(v, gamma);
    out[i] = Math.round(v * 255);
  }
  return out;
}

/*function convert16to8bit(frame16) {
    const pixelCount = SRC_HEIGHT * SRC_WIDTH;
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

}*/

// 预分配 drawScaledImage 所用的临时 Canvas 和 ImageData，避免每帧重复创建
let _scaledTempCanvas = null;
let _scaledTempCtx = null;
let _scaledImgData = null;
let _scaledImgPixels = null; // Uint32Array 视图，一次写入 RGBA 4字节
let _scaledW = 0;
let _scaledH = 0;

/**
 * 专门用于将小图放大绘制到大 Canvas
 */
export function drawScaledImage(ctx, data, w, h) {
  // 若尺寸变化则重新分配（正常情况下 128x128 只分配一次）
  if (w !== _scaledW || h !== _scaledH || !_scaledTempCanvas) {
    _scaledTempCanvas = document.createElement("canvas");
    _scaledTempCanvas.width = w;
    _scaledTempCanvas.height = h;
    _scaledTempCtx = _scaledTempCanvas.getContext("2d");
    _scaledImgData = _scaledTempCtx.createImageData(w, h);
    // Uint32Array 视图：小端序下每个元素对应 RGBA 四字节
    // 布局: 低字节=R, 次低=G, 次高=B, 高字节=A → uint32 = 0xAABBGGRR
    _scaledImgPixels = new Uint32Array(_scaledImgData.data.buffer);
    _scaledW = w;
    _scaledH = h;
  }

  // 一次32位写入代替4次 Uint8ClampedArray 赋值，跳过 clamp 边界检查
  const pixels = _scaledImgPixels;
  for (let i = 0; i < data.length; i++) {
    const val = data[i];
    pixels[i] = (255 << 24) | (val << 16) | (val << 8) | val; // A=255, B=G=R=val
  }

  _scaledTempCtx.putImageData(_scaledImgData, 0, 0);

  // 关闭平滑，实现像素化放大
  ctx.imageSmoothingEnabled = false;
  ctx.mozImageSmoothingEnabled = false;
  ctx.webkitImageSmoothingEnabled = false;

  // 拉伸绘制到 384x384
  ctx.drawImage(_scaledTempCanvas, 0, 0, w, h, 0, 0, DST_SIZE, DST_SIZE);
}

/**
 * 绘制灰度图像到 Canvas
 */
function drawGrayImage(ctx, data, width, height) {
  const imageData = ctx.createImageData(width, height);

  for (let i = 0; i < data.length; i++) {
    const gray = data[i];
    const offset = i * 4;
    imageData.data[offset] = gray; // R
    imageData.data[offset + 1] = gray; // G
    imageData.data[offset + 2] = gray; // B
    imageData.data[offset + 3] = 255; // A
  }

  ctx.putImageData(imageData, 0, 0);
}

/**
 * 直方图均衡化
 */
function histogramEqualization_16(data) {
  const histogram = new Array(256).fill(0);
  const result = new Uint8Array(data.length);

  // 统计直方图
  for (let i = 0; i < data.length; i++) {
    histogram[data[i]]++;
  }

  // 计算累积分布函数 (CDF)
  const cdf = new Array(256).fill(0);
  cdf[0] = histogram[0];
  for (let i = 1; i < 256; i++) {
    cdf[i] = cdf[i - 1] + histogram[i];
  }

  // 归一化 CDF
  const cdfMin = cdf.find((v) => v > 0);
  const scale = 255 / (data.length - cdfMin);

  // 映射像素值
  for (let i = 0; i < data.length; i++) {
    result[i] = Math.round((cdf[data[i]] - cdfMin) * scale);
  }

  return result;
}

export function histogramEqualization(data){
    const pixelCount=data.length/2;
    const dv=new DataView(data.buffer,data.byteOffset,data.byteLength);
    const histogram=new Uint32Array(65536);
    const  result=new Uint8Array(pixelCount);

    for(let i=0;i<pixelCount;i++){
      const val=dv.getUint16(i*2,true);
      histogram[val]++;
    }

    const cdf=new Uint32Array(65536);
    cdf[0]=histogram[0];
    for(let i=0;i<65536;i++){
      cdf[i]=cdf[i-1]+histogram[i];
    }

    let cdfMin=0;
    for(let i=0;i<65536;i++){
      if(cdf[i]>0){
        cdfMin=cdf[i];
        break;
      }
    }

    const scale=255/(pixelCount-cdfMin);
    for(let i=0;i<pixelCount;++i){
      const val=dv.getUint16(i*2,true);
      result[i]=Math.max(0,Math.min(255,Math.round((cdf[val]-cdfMin)*scale),));
    }

    return result;
}

/**
 * 位提取显示 - 从16位数据中提取特定位段
 * @param {Uint8Array} data - 输入数据（16位）
 * @param {number} shiftBits - 提取位数
 */
function extractBits(data, shiftBits) {
  /*const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    result[i] = (data[i] >> shiftBits) & 0xff;
  }
  return result;*/

  const result = new Uint8Array((data.length) / 2);
    for (let i = 0; i < result.length; i++) {
        result[i] = ((data[i * 2] >> shiftBits) & 0xFF)||((data[i * 2 + 1] << (8 - shiftBits))&0xFF);
    }
    return result;
}

/**
 * 16位线性映射到0-255
 * @param {Uint8Array} data - 输入数据（8位）
 */
function map16BitTo255(data) {
  const result = new Uint8Array(data.length);
  for (let i = 0; i < data.length; i++) {
    // 线性映射: (value * 255) / 16383
    const val = (data[i] * 255) / 16383;
    result[i] = Math.max(0, Math.min(255, Math.round(val)));
  }
  return result;
}

/**
 * 线性拉伸
 */
/**
 * 三段式分段线性拉伸（适配14位原始红外数据）
 *
 * 分段规则：
 *   [0,   lo)  → 输出 0          （暗部截断）
 *   [lo,  hi]  → 输出 0~255      （主体线性拉伸）
 *   (hi, 16383] → 输出 255       （亮部截断）
 *
 * @param {Uint8Array|Uint16Array} data  输入数据（原始14位值，每个元素0~16383）
 * @param {number} lo  下限（0~16383）
 * @param {number} hi  上限（0~16383）
 * @returns {Uint8Array}  输出 8 位灰度数组
 */
function linearStretch(data, lo, hi) {
  const pixelCount = data.length / 2;
  const result = new Uint8Array(pixelCount);
  const dv = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const range = (hi > lo) ? (hi - lo) : 1;

  for (let i = 0; i < pixelCount; i++) {
    const raw = dv.getUint16(i * 2, true); // 小端读取16bit原始值
    const v = raw < lo ? lo : raw > hi ? hi : raw;
    result[i] = Math.min(255, ((v - lo) / range) * 256);
  }

  return result;
}

/**
 * 绘制分析区域（红框）
 */
function drawAnalysisRect() {
  if (!ctx384) return;

  const { x1, y1, x2, y2 } = VideoState.analysisRect;
  ctx384.strokeStyle = "red";
  ctx384.lineWidth = 2;
  ctx384.strokeRect(x1, y1, x2 - x1, y2 - y1);
}

/**
 * 绘制选中区域（蓝框 11x11）
 */
function drawSelectedRect() {
  if (!ctx384) return;

  const { x, y } = VideoState.selectedCenter;
  const halfSize = 5;

  ctx384.strokeStyle = "blue";
  ctx384.lineWidth = 1;
  ctx384.strokeRect(x - halfSize, y - halfSize, 11, 11);
}

/**
 * 绘制目标框（绿框 20x20）
 */
function drawTargetBox() {
  if (!ctx384 || !VideoState.targetBox.visible) return;

  const { x, y } = VideoState.targetBox;
  if (x === null || y === null) return;

  const boxSize = 20;
  const halfSize = boxSize / 2;

  // 计算左上角坐标
  const boxX = x - halfSize;
  const boxY = y - halfSize;

  // 边界限制
  const maxX = DST_SIZE - boxSize;
  const maxY = DST_SIZE - boxSize;
  const clampedX = Math.max(0, Math.min(maxX, boxX));
  const clampedY = Math.max(0, Math.min(maxY, boxY));

  ctx384.strokeStyle = "#00ff00";
  ctx384.lineWidth = 2;
  ctx384.strokeRect(clampedX, clampedY, boxSize, boxSize);
}

/**
 * Canvas 鼠标按下 - 开始拖拽
 */
function onCanvasMouseDown(e) {
  const rect = canvas384.getBoundingClientRect();
  const x = Math.floor(e.clientX - rect.left);
  const y = Math.floor(e.clientY - rect.top);

  // 记录鼠标按下状态和起始点
  VideoState.isMouseDown = true;
  VideoState.dragStart = { x, y };
  VideoState.dragCurrent = { x, y };
  VideoState.isDragging = false;
}

/**
 * Canvas 鼠标移动 - 拖拽中或更新蓝框位置
 */
function onCanvasMouseMove(e) {
  const rect = canvas384.getBoundingClientRect();
  const x = Math.floor(e.clientX - rect.left);
  const y = Math.floor(e.clientY - rect.top);

  // 如果鼠标按下，检查是否开始拖拽
  if (VideoState.isMouseDown) {
    VideoState.dragCurrent = { x, y };

    // 计算移动距离
    const dx = x - VideoState.dragStart.x;
    const dy = y - VideoState.dragStart.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    // 如果移动超过 5 像素，才算拖拽
    if (distance > 5) {
      VideoState.isDragging = true;
    }

    if (VideoState.isDragging) {
      // 拖拽中：触发重新绘制以显示预览框
      if (!VideoState.isReplaying && currentFrame) {
        // 用 .slice() 做真正的数据拷贝，避免 rAF 回调执行时 currentFrame 已被新帧覆写
        const frameSnapshot = currentFrame.slice();
        // 在 rAF 外完成耗时的像素转换，避免回调里操作已被覆写的 buffer
        let processedSnapshot;
        switch (VideoState.displayMode) {
          case DisplayMode.BIT_0_7:  processedSnapshot = extractBits(frameSnapshot, 0); break;
          case DisplayMode.BIT_1_8:  processedSnapshot = extractBits(frameSnapshot, 1); break;
          case DisplayMode.BIT_2_9:  processedSnapshot = extractBits(frameSnapshot, 2); break;
          case DisplayMode.BIT_3_10: processedSnapshot = extractBits(frameSnapshot, 3); break;
          case DisplayMode.BIT_4_11: processedSnapshot = extractBits(frameSnapshot, 4); break;
          case DisplayMode.BIT_5_12: processedSnapshot = extractBits(frameSnapshot, 5); break;
          case DisplayMode.BIT_6_13: processedSnapshot = extractBits(frameSnapshot, 6); break;
          case DisplayMode.BIT_7_14: processedSnapshot = extractBits(frameSnapshot, 7); break;
          case DisplayMode.BIT_8_15: processedSnapshot = extractBits(frameSnapshot, 8); break;
          case DisplayMode.BIT_16:   processedSnapshot = map16BitTo255(frameSnapshot); break;
          case DisplayMode.LINEAR_STRETCH: processedSnapshot = linearStretch(frameSnapshot, VideoState.linearMin, VideoState.linearMax); break;
          case DisplayMode.HISTOGRAM_EQ:   processedSnapshot = histogramEqualization(frameSnapshot); break;
          default: processedSnapshot = histogramEqualization(frameSnapshot); break;
        }
        // 用 flag 防止同一帧内积攒多个 rAF 回调
        if (!VideoState._rafPending) {
          VideoState._rafPending = true;
          requestAnimationFrame(() => {
            VideoState._rafPending = false;
            drawScaledImage(ctx384, processedSnapshot, SRC_SIZE, SRC_SIZE);
            drawAnalysisRect();
            drawSelectedRect();
            drawTargetBox();
            drawDragPreview();
          });
        }
      }
    }
  } else {
    // 鼠标没按下：只更新坐标显示和 11x11 预览，不移动蓝框
    const coordDisplay = document.getElementById("textBrowser_2");
    if (coordDisplay) {
      coordDisplay.textContent = `x=${Math.floor(x / 3)}, y=${Math.floor(y / 3)}`;
    }

    // 立即更新 11x11 区域（跟随鼠标预览）
    update11x11Region();
  }
}

/**
 * Canvas 鼠标释放 - 结束拖拽并更新红框位置
 */
function onCanvasMouseUp(e) {
  // 重置鼠标按下状态
  VideoState.isMouseDown = false;

  // 如果不是拖拽状态：视为点击，更新蓝框位置
  if (!VideoState.isDragging) {
    const rect = canvas384.getBoundingClientRect();
    const x = Math.floor(e.clientX - rect.left);
    const y = Math.floor(e.clientY - rect.top);
    VideoState.selectedCenter.x = Math.max(5, Math.min(378, x));
    VideoState.selectedCenter.y = Math.max(5, Math.min(378, y));
    update11x11Region();
    return;
  }

  // 结束拖拽
  VideoState.isDragging = false;

  const { dragStart, dragCurrent } = VideoState;
  const x1 = Math.min(dragStart.x, dragCurrent.x);
  const y1 = Math.min(dragStart.y, dragCurrent.y);
  const x2 = Math.max(dragStart.x, dragCurrent.x);
  const y2 = Math.max(dragStart.y, dragCurrent.y);

  // 确保最小尺寸为1
  const width = Math.max(1, x2 - x1);
  const height = Math.max(1, y2 - y1);

  // 更新红框位置
  VideoState.analysisRect = {
    x1: x1,
    y1: y1,
    x2: x1 + width,
    y2: y1 + height,
  };

  // 更新坐标输入框（384坐标系）
  updateAnalysisRectInputs();
}

/**
 * Canvas 鼠标离开 - 仅终止拖拽状态，不更新蓝框位置
 */
function onCanvasMouseLeave() {
  VideoState.isMouseDown = false;
  VideoState.isDragging  = false;
}

/**
 * 绘制拖拽预览框
 */
function drawDragPreview() {
  if (!VideoState.isDragging || !ctx384) return;

  const { dragStart, dragCurrent } = VideoState;
  const x = Math.min(dragStart.x, dragCurrent.x);
  const y = Math.min(dragStart.y, dragCurrent.y);
  const width = Math.abs(dragCurrent.x - dragStart.x);
  const height = Math.abs(dragCurrent.y - dragStart.y);

  // 绘制半透明预览框
  ctx384.strokeStyle = "yellow";
  ctx384.lineWidth = 2;
  ctx384.setLineDash([5, 5]); // 虚线效果
  ctx384.strokeRect(x, y, width, height);
  ctx384.setLineDash([]); // 重置为实线

  // 填充半透明背景
  ctx384.fillStyle = "rgba(255, 255, 0, 0.1)";
  ctx384.fillRect(x, y, width, height);
}

/**
 * 更新分析区域坐标输入框
 */
function updateAnalysisRectInputs() {
  const { x1, y1, x2, y2 } = VideoState.analysisRect;

  // 左上角坐标（384坐标系）
  const textEditX = document.getElementById("textEdit_x");
  const textEditY = document.getElementById("textEdit_y");
  if (textEditX) textEditX.value = x1;
  if (textEditY) textEditY.value = y1;

  // 右下角坐标（384坐标系）
  const textEditX1 = document.getElementById("textEdit_x1");
  const textEditY1 = document.getElementById("textEdit_y1");
  if (textEditX1) textEditX1.value = x2;
  if (textEditY1) textEditY1.value = y2;
}

function computePercentileRange(data, lowP = 0.02, highP = 0.98) {
  const hist = new Uint32Array(256);
  for (let i = 0; i < data.length; i++) hist[data[i]]++;

  const total = data.length;
  const lowCount = total * lowP;
  const highCount = total * highP;

  let cum = 0;
  let low = 0;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= lowCount) {
      low = i;
      break;
    }
  }

  cum = 0;
  let high = 255;
  for (let i = 0; i < 256; i++) {
    cum += hist[i];
    if (cum >= highCount) {
      high = i;
      break;
    }
  }

  return { low, high };
}

function applyRangeStretch(data, low, high, gamma = 0.8) {
  const range = Math.max(1, high - low);
  const out = new Uint8Array(data.length);

  for (let i = 0; i < data.length; i++) {
    let v = (data[i] - low) / range;
    if (v < 0) v = 0;
    if (v > 1) v = 1;
    v = Math.pow(v, gamma);
    out[i] = Math.round(v * 255);
  }
  return out;
}

/**
 * 更新 11x11 区域显示
 * 坐标需要从 384 坐标系换算到 128 坐标系
 */
function update11x11Region(SRC_SIZE=128, processedFrame=null) {
  if (!currentFrame || !ctx11x11) return;
  /*const HexString = Array.from(currentFrame)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");*/
  //console.log("currentFrame", currentFrame);

  frameCount += 1;

  // 点击的是 384 坐标系，换算到 128 坐标系
  const dataX = Math.floor(VideoState.selectedCenter.x / (384/SRC_SIZE));
  const dataY = Math.floor(VideoState.selectedCenter.y / (384/SRC_SIZE));

  //const dataX = 0;
  //const dataY = 0;

  const pixelValues = [];
  const pixelValues_5X5 = [];

  // 提取 11x11 区域像素（基于 128x128 数据）
  for (let dy = -5; dy <= 5; dy++) {
    for (let dx = -5; dx <= 5; dx++) {
      const px = dataX + dx;
      const py = dataY + dy;

      if (px >= 0 && px < SRC_SIZE  && py >= 0 && py < SRC_SIZE ) {
        const idx = py * SRC_SIZE * 2 + px * 2;
        pixelValues.push(currentFrame[idx] + currentFrame[idx + 1] * 256);
        //console.log(pixelValues);
      } else {
        pixelValues.push(NaN); // 越界补0
      }
      // const idx = py * SRC_SIZE*2 + px * 2;
      // pixelValues.push(currentFrame[idx] + currentFrame[idx+1]*256 || 0);
    }
  }

  for (let dy = -2; dy <= 2; dy++) {
    for (let dx = -2; dx <= 2; dx++) {
      const px = dataX + dx * 2;
      const py = dataY + dy;

      /*if (px >= 0 && px < SRC_SIZE && py >= 0 && py < SRC_SIZE) {
                const idx = py * SRC_SIZE + px;
                pixelValues_5X5.push(currentFrame[idx] || 0);
            } else {
                pixelValues_5X5.push(0); 
            }*/

      const idx = py * SRC_SIZE * 2 + px * 2;
      pixelValues_5X5.push(
        currentFrame[idx] + currentFrame[idx + 1] * 256 || 0,
      );
    }
  }

  if (frameCount == 100) {
    let Y = 0;
    for (let i = 0; i < 6; ++i) {
      Y += pixelValues_5X5[i];
    }
    //console.log("Y:::", Y);
    for (let i = 19; i < 25; ++i) {
      Y += pixelValues_5X5[i];
    }
    //console.log("Y:::", Y);
    Y += pixelValues_5X5[9];
    Y += pixelValues_5X5[10];
    Y += pixelValues_5X5[15];
    Y += pixelValues_5X5[16];
    Y /= 16;
    //console.log("Y:::", Y);
    let W = pixelValues_5X5[12] - Y;
    //console.log("W:::", W);
    let W_d = 0;
    for (let i = 6; i < 9; ++i) {
      W_d += pixelValues_5X5[i];
    }
    for (let i = 11; i < 14; ++i) {
      W_d += pixelValues_5X5[i];
    }
    for (let i = 16; i < 19; ++i) {
      W_d += pixelValues_5X5[i];
    }
    //console.log("W_d:::", W_d);
    W_d -= 9 * Y;
    W /= W_d;
    //console.log("W:::", W);
    document.getElementById("textBrowser").innerText = W;
    frameCount = 0;
  }

  // 绘制放大的 11x11 图像
  const cellSize = 20;

  // 若没有传入已处理帧，按当前 displayMode 重新转换
  let frame8 = processedFrame;
  if (!frame8) {
    switch (VideoState.displayMode) {
      case DisplayMode.BIT_0_7:  frame8 = extractBits(currentFrame, 0); break;
      case DisplayMode.BIT_1_8:  frame8 = extractBits(currentFrame, 1); break;
      case DisplayMode.BIT_2_9:  frame8 = extractBits(currentFrame, 2); break;
      case DisplayMode.BIT_3_10: frame8 = extractBits(currentFrame, 3); break;
      case DisplayMode.BIT_4_11: frame8 = extractBits(currentFrame, 4); break;
      case DisplayMode.BIT_5_12: frame8 = extractBits(currentFrame, 5); break;
      case DisplayMode.BIT_6_13: frame8 = extractBits(currentFrame, 6); break;
      case DisplayMode.BIT_7_14: frame8 = extractBits(currentFrame, 7); break;
      case DisplayMode.BIT_8_15: frame8 = extractBits(currentFrame, 8); break;
      case DisplayMode.BIT_16:   frame8 = map16BitTo255(currentFrame); break;
      case DisplayMode.LINEAR_STRETCH: frame8 = linearStretch(currentFrame, VideoState.linearMin, VideoState.linearMax); break;
      case DisplayMode.HISTOGRAM_EQ:   frame8 = histogramEqualization(currentFrame); break;
      default: frame8 = histogramEqualization(currentFrame); break;
    }
  }

  // 响应度每秒更新一次：中心像素灰度 - 11x11 区域去掉中心 3x3 后的平均灰度。
  const now = performance.now();
  if (now - responseLastUpdateAt >= 1000) {
    const centerGray = pixelValues[60]; // 11x11 的中心位置（第6行第6列）
    let backgroundSum = 0;
    let backgroundCount = 0;

    for (let row = 0; row < 11; row++) {
      for (let col = 0; col < 11; col++) {
        // 排除中心 3x3（dx、dy 均在 -1..1）。
        if (row >= 4 && row <= 6 && col >= 4 && col <= 6) continue;

        const gray = pixelValues[row * 11 + col];
        if (Number.isFinite(gray)) {
          backgroundSum += gray;
          backgroundCount++;
        }
      }
    }

    const response = Number.isFinite(centerGray) && backgroundCount > 0
      ? centerGray - backgroundSum / backgroundCount
      : 0;
    const responseElement = document.getElementById("textBrowser_Response");
    if (responseElement) responseElement.textContent = response.toFixed(2);
    responseLastUpdateAt = now;
  }

  // 清空整个画布
  ctx11x11.clearRect(0, 0, 220, 220);

  for (let i = 0; i < 11; i++) {
    for (let j = 0; j < 11; j++) {
      const px = dataX + (j - 5);
      const py = dataY + (i - 5);
      let val = 0;
      if (px >= 0 && px < SRC_SIZE && py >= 0 && py < SRC_SIZE) {
        val = frame8[py * SRC_SIZE + px];
      }
      ctx11x11.fillStyle = `rgb(${val}, ${val}, ${val})`;
      ctx11x11.fillRect(j * cellSize, i * cellSize, cellSize, cellSize);
    }
  }

  // 更新中心点坐标到表格的外边
  const labelRow = document.getElementById("label_row");
  const labelCol = document.getElementById("label_col");
  if (labelRow) labelRow.textContent = `行:${dataY + 1}`;
  if (labelCol) labelCol.textContent = `列:${dataX + 1}`;

  // 更新像素值表格
  const table = document.getElementById("tableWidget_6");
  if (table) {
    for (let i = 0; i < 11; i++) {
      for (let j = 0; j < 11; j++) {
        const val = pixelValues[i * 11 + j];
        if (table.rows[i] && table.rows[i].cells[j]) {
          table.rows[i].cells[j].textContent = val;
        }
      }
    }
  }
}

/**
 * 计算并更新统计信息
 * 注意：坐标需要换算
 */
function updateStatistics() {
  if (!currentFrame) return;

  // 将 384 坐标系的红框换算到 128 坐标系
  const x1 = Math.floor(VideoState.analysisRect.x1 / SCALE);
  const y1 = Math.floor(VideoState.analysisRect.y1 / SCALE);
  const x2 = Math.floor(VideoState.analysisRect.x2 / SCALE);
  const y2 = Math.floor(VideoState.analysisRect.y2 / SCALE);

  let sum = 0,
    sumSq = 0,
    count = 0;
  let max = 0,
    min = 255;

  for (let y = y1; y <= y2; y++) {
    for (let x = x1; x <= x2; x++) {
      if (x >= 0 && x < SRC_SIZE && y >= 0 && y < SRC_SIZE) {
        const idx = y * SRC_SIZE * 2 + x * 2;
        const val = currentFrame[idx] + currentFrame[idx + 1] * 256;

        sum += val;
        sumSq += val * val;
        count++;

        if (val > max) max = val;
        if (val < min) min = val;
      }
    }
  }

  if (count > 0) {
    const avg = sum / count;
    const variance = sumSq / count - avg * avg;
    const std = Math.sqrt(variance);

    VideoState.stats = { max, min, avg, std };

    Utils.setTableCellText("tableWidget_7", 0, 1, max.toString());
    Utils.setTableCellText("tableWidget_7", 1, 1, min.toString());
    Utils.setTableCellText("tableWidget_7", 2, 1, avg.toFixed(2));
    Utils.setTableCellText("tableWidget_7", 3, 1, std.toFixed(2));
  }
}

/**
 * 开始视频流
 */
export function startVideoStream(wsClient) {
  if (wsClient && wsClient.ws) {
    wsClient.ws.send(JSON.stringify({ type: "start_video" }));
    VideoState.isPlaying = true;
    console.log("[VIDEO] 请求开始视频流");
  }
}

/**
 * 停止视频流
 */
export function stopVideoStream(wsClient) {
  if (wsClient && wsClient.ws) {
    wsClient.ws.send(JSON.stringify({ type: "stop_video" }));
    VideoState.isPlaying = false;
    console.log("[STOP] 请求停止视频流");
  }
}

// ==================== 回放功能 ====================

export function convert16to8bit(frame16, src_size = 128) {
  const pixelCount = src_size * src_size;
  const frame8 = new Uint8Array(pixelCount);
  const dv = new DataView(
    frame16.buffer,
    frame16.byteoffset,
    frame16.byteLength,
  );

  let min = 65535;
  let max = 0;
  for (let i = 0; i < pixelCount; i++) {
    const val = dv.getUint16(i * 2, true);
    if (val < min) min = val;
    if (val > max) max = val;
  }

  const range = max - min;
  if (range === 0) {
    frame8.fill(128);
  } else {
    const scale = 255 / range;
    for (let i = 0; i < pixelCount; i++) {
      const val = dv.getUint16(i * 2, true);
      frame8[i] = Math.round((val - min) * scale);
    }
  }
  return frame8;
}

/**
 * 读取 .dat 文件并解析为帧数据
 * @param {File} file - 用户选择的文件对象
 * @param {string} type - 回放文件类型 ("video" 或 "blackbox")
 * @returns {Promise<Array<Uint8Array>>} - 返回帧数据数组
 */
export async function loadReplayFile(file, type = "video") {
  VideoState.replayDataType = type;
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = function (e) {
      try {
        const arrayBuffer = e.target.result;
        const uint8Array = new Uint8Array(arrayBuffer);

        const FRAME_SIZE = type === "blackbox" 
          ? 40960 
          : (REPLAY_16BIT ? SRC_SIZE * SRC_SIZE * 2 : SRC_SIZE * SRC_SIZE);
          
        const totalFrames = Math.floor(uint8Array.length / FRAME_SIZE);

        console.log(
          `[FILE] 文件大小: ${uint8Array.length} 字节, 每帧: ${FRAME_SIZE} 字节, 帧数: ${totalFrames}`,
        );

        const frames = [];
        for (let i = 0; i < totalFrames; i++) {
          const start = i * FRAME_SIZE;
          const end = start + FRAME_SIZE;
          const frameData = uint8Array.slice(start, end);
          frames.push(frameData);
        }

        resolve(frames);
      } catch (err) {
        reject(err);
      }
    };

    reader.onerror = function () {
      reject(new Error("文件读取失败"));
    };

    reader.readAsArrayBuffer(file);
  });
}

/**
 * 开始回放
 * @param {Array<Uint8Array>} frames - 帧数据数组
 */
export function startReplay(frames) {
  if (!frames || frames.length === 0) {
    console.error("[ERROR] 回放数据为空");
    return;
  }

  // 停止之前的回放
  stopReplay();

  // 设置回放状态（初始暂停）
  VideoState.isReplaying = true;
  VideoState.isReplayPaused = true;
  VideoState.replayData = frames;
  VideoState.replayTotalFrames = frames.length;
  VideoState.replayCurrentFrame = 0;

  if (VideoState.replayDataType === "blackbox") {
    window.isBlackboxReplaying = true;
  }

  console.log(`[VIDEO] 加载回放，总帧数: ${VideoState.replayTotalFrames}`);

  // 渲染第一帧作为静止预览（不推进索引）
  renderFrameAt(0);

  // 更新 UI
  updateReplayUI();
}

/**
 * 恢复（继续）回放
 */
export function resumeReplay() {
  if (!VideoState.isReplaying || !VideoState.replayData) return;
  if (!VideoState.isReplayPaused) return;

  VideoState.isReplayPaused = false;
  const intervalMs = 1000 / VideoState.replayFps;
  VideoState.replayTimer = setInterval(() => {
    renderReplayFrame();
  }, intervalMs);

  console.log("[VIDEO] 继续回放");
  updateReplayUI();
}

/**
 * 暂停回放
 */
export function pauseReplay() {
  if (!VideoState.isReplaying || VideoState.isReplayPaused) return;

  if (VideoState.replayTimer) {
    clearInterval(VideoState.replayTimer);
    VideoState.replayTimer = null;
  }
  VideoState.isReplayPaused = true;

  console.log("[VIDEO] 暂停回放");
  updateReplayUI();
}

/**
 * 停止回放
 */
export function stopReplay() {
  if (VideoState.replayTimer) {
    clearInterval(VideoState.replayTimer);
    VideoState.replayTimer = null;
  }

  VideoState.isReplaying = false;
  VideoState.isReplayPaused = true;
  VideoState.replayData = null;
  VideoState.replayCurrentFrame = 0;
  VideoState.replayTotalFrames = 0;
  window.isBlackboxReplaying = false;

  console.log("[STOP] 停止回放，恢复实时视频流");

  // 更新 UI
  updateReplayUI();
}

/**
 * 渲染指定帧（不推进索引）
 */
function renderFrameAt(index) {
  if (!VideoState.replayData) return;
  index = Math.max(0, Math.min(index, VideoState.replayTotalFrames - 1));

  let frameData = VideoState.replayData[index];

  if (VideoState.replayDataType === "blackbox") {
    // 渲染黑匣子帧
    window.isBlackboxDrawing = true;
    handle_YC_DATA(frameData);
    window.isBlackboxDrawing = false;
    return; // handle_YC_DATA 内部会调用 handleVideoFrame 并在其中进行显示及 UI 更新
  }

  let processedData;

  switch (VideoState.displayMode) {
    case DisplayMode.BIT_0_7:   processedData = frameData; break;
    case DisplayMode.BIT_1_8:   processedData = extractBits(frameData, 1); break;
    case DisplayMode.BIT_2_9:   processedData = extractBits(frameData, 2); break;
    case DisplayMode.BIT_3_10:  processedData = extractBits(frameData, 3); break;
    case DisplayMode.BIT_4_11:  processedData = extractBits(frameData, 4); break;
    case DisplayMode.BIT_5_12:  processedData = extractBits(frameData, 5); break;
    case DisplayMode.BIT_6_13:  processedData = extractBits(frameData, 6); break;
    case DisplayMode.BIT_7_14:  processedData = extractBits(frameData, 7); break;
    case DisplayMode.BIT_8_15:  processedData = extractBits(frameData, 8); break;
    case DisplayMode.BIT_16:    processedData = map16BitTo255(frameData); break;
    case DisplayMode.LINEAR_STRETCH:
      processedData = linearStretch(frameData, VideoState.linearMin, VideoState.linearMax); break;
    case DisplayMode.HISTOGRAM_EQ:
      processedData = histogramEqualization(frameData); break;
    default:
      processedData = histogramEqualization(frameData); break;
  }

  drawScaledImage(ctx384, processedData, SRC_SIZE, SRC_SIZE);
  currentFrame = frameData;
  drawAnalysisRect();
  drawSelectedRect();
  drawTargetBox();
  update11x11Region(SRC_SIZE, processedData);
  updateStatistics();
}

/**
 * 渲染当前回放帧（自动播放用，渲染后推进索引）
 */
function renderReplayFrame() {
  if (!VideoState.isReplaying || !VideoState.replayData) {
    return;
  }

  if (VideoState.replayCurrentFrame >= VideoState.replayTotalFrames) {
    VideoState.replayCurrentFrame = 0; // 循环
  }

  renderFrameAt(VideoState.replayCurrentFrame);

  // 推进帧索引（仅自动播放调用此函数）
  VideoState.replayCurrentFrame++;

  // 更新 UI
  updateReplayUI();
}

/**
 * 回放：跳转到指定帧
 * @param {number} frameIndex - 帧索引
 */
export function seekReplayFrame(frameIndex) {
  if (!VideoState.isReplaying || !VideoState.replayData) {
    return;
  }

  frameIndex = Math.max(
    0,
    Math.min(frameIndex, VideoState.replayTotalFrames - 1),
  );
  VideoState.replayCurrentFrame = frameIndex;

  renderFrameAt(frameIndex);
  updateReplayUI();
}

/**
 * 回放：上一帧
 */
export function replayPreviousFrame() {
  if (!VideoState.isReplaying || !VideoState.replayData) return;
  if (!VideoState.isReplayPaused) return; // 仅暂停时可用

  VideoState.replayCurrentFrame = Math.max(0, VideoState.replayCurrentFrame - 1);
  renderFrameAt(VideoState.replayCurrentFrame);
  updateReplayUI();
}

/**
 * 回放：下一帧
 */
export function replayNextFrame() {
  if (!VideoState.isReplaying || !VideoState.replayData) return;
  if (!VideoState.isReplayPaused) return; // 仅暂停时可用

  VideoState.replayCurrentFrame = Math.min(
    VideoState.replayTotalFrames - 1,
    VideoState.replayCurrentFrame + 1,
  );
  renderFrameAt(VideoState.replayCurrentFrame);
  updateReplayUI();
}

/**
 * 更新回放 UI（帧数显示、滑块等）
 */
function updateReplayUI() {
  const currentFrameInput = document.getElementById("textEdit_CurrentFrame");
  const totalFrameInput = document.getElementById("textEdit_TotalFrame");
  const slider = document.getElementById("horizontalSlider");

  if (VideoState.isReplaying) {
    // 回放模式：显示回放帧数
    if (currentFrameInput)
      currentFrameInput.value = VideoState.replayCurrentFrame;
    if (totalFrameInput) totalFrameInput.value = VideoState.replayTotalFrames;

    if (slider && VideoState.replayTotalFrames > 0) {
      slider.value =
        (VideoState.replayCurrentFrame / VideoState.replayTotalFrames) * 100;
    }
  } else {
    // 非回放模式：清空或显示实时流计数
    // 可以选择保持最后的帧数显示或清零
    if (currentFrameInput) currentFrameInput.value = 0;
    if (totalFrameInput) totalFrameInput.value = 0;
    if (slider) slider.value = 0;
  }
}

/**
 * 获取回放状态（供外部查询）
 */
export function getReplayState() {
  return {
    isReplaying: VideoState.isReplaying,
    isReplayPaused: VideoState.isReplayPaused,
    currentFrame: VideoState.replayCurrentFrame,
    totalFrames: VideoState.replayTotalFrames,
  };
}

/**
 * [STAR] 新增：设置目标框（绿框）位置
 * @param {number} x - 目标框中心X坐标
 * @param {number} y - 目标框中心Y坐标
 */
export function setTargetBoxPosition(x, y) {
  VideoState.targetBox.x = Math.max(0, Math.min(DST_SIZE, x));
  VideoState.targetBox.y = Math.max(0, Math.min(DST_SIZE, y));
  VideoState.targetBox.visible = true;
}

// ==================== 二值化视频流处理 ====================

// 二值化视频流状态
const BinarizedVideoState = {
  isPlaying: false,
  enableClientBinarization: false, // 是否启用前端二值化处理
  threshold: 128,
  invert: false,
};

// 二值化 Canvas 引用
let canvasBinarized = null;
let ctxBinarized = null;

// 警告标志
let binarizedWarningPrinted = false;

/**
 * 初始化二值化视频流显示
 */
export function initializeBinarizedStream() {
  // 获取二值化图像容器
  const container = document.getElementById("binarized-widget");
  if (container) {
    canvasBinarized = document.createElement("canvas");
    canvasBinarized.width = DST_SIZE;
    canvasBinarized.height = DST_SIZE;
    canvasBinarized.style.cursor = "crosshair";
    container.appendChild(canvasBinarized);
    ctxBinarized = canvasBinarized.getContext("2d");
    console.log("[OK] 二值化视频流 Canvas 初始化完成");
  }

  // 绑定开始按钮
  const startBtn = document.getElementById("pushButton_Start_Binarized");
  if (startBtn) {
    startBtn.addEventListener("click", () => {
      startBinarizedStream();
    });
  }

  // 绑定停止按钮
  const stopBtn = document.getElementById("pushButton_Stop_Binarized");
  if (stopBtn) {
    stopBtn.addEventListener("click", () => {
      stopBinarizedStream();
    });
  }

  // 绑定前端二值化处理开关
  const enableCheckbox = document.getElementById(
    "checkBox_Enable_Client_Binarization",
  );
  const paramsContainer = document.getElementById("binarized-params-container");
  if (enableCheckbox) {
    enableCheckbox.addEventListener("change", (e) => {
      BinarizedVideoState.enableClientBinarization = e.target.checked;

      // 显示/隐藏参数设置区域
      if (paramsContainer) {
        paramsContainer.style.display = e.target.checked ? "block" : "none";
      }
    });
  }

  // 绑定阈值滑块
  const thresholdSlider = document.getElementById("slider_Binarized_Threshold");
  const thresholdInput = document.getElementById("input_Binarized_Threshold");
  if (thresholdSlider && thresholdInput) {
    // 滑块变化时更新数字输入框（前端处理，无需发送到服务器）
    thresholdSlider.addEventListener("input", (e) => {
      const value = parseInt(e.target.value);
      thresholdInput.value = value;
      BinarizedVideoState.threshold = value;
    });

    // 数字输入框变化时更新滑块
    thresholdInput.addEventListener("change", (e) => {
      const value = Math.max(0, Math.min(255, parseInt(e.target.value) || 128));
      thresholdInput.value = value;
      thresholdSlider.value = value;
      BinarizedVideoState.threshold = value;
    });
  }

  // 绑定反转复选框
  const invertCheckbox = document.getElementById("checkBox_Binarized_Invert");
  if (invertCheckbox) {
    invertCheckbox.addEventListener("change", (e) => {
      BinarizedVideoState.invert = e.target.checked;
    });
  }
}

/**
 * 处理接收到的二值化视频帧（在前端进行二值化处理）
 * @param {Uint8Array} frameData - 原始灰度图像数据
 * @param {number} width - 图像宽度
 * @param {number} height - 图像高度
 */
export function handleBinarizedFrame(frameData, width = 128, height = 128) {
  if (!ctxBinarized) {
    // 第一次调用时打印警告
    if (!binarizedWarningPrinted) {
      console.error(
        "❌ 二值化 Canvas 未初始化！请检查 initializeBinarizedStream() 是否被调用",
      );
      binarizedWarningPrinted = true;
    }
    return;
  }

  // 根据标志决定是否进行前端二值化处理
  let displayData = frameData;

  if (BinarizedVideoState.enableClientBinarization) {
    // 在前端进行二值化处理
    const threshold = BinarizedVideoState.threshold;
    displayData = new Uint8Array(frameData.length);

    for (let i = 0; i < frameData.length; i++) {
      let value = frameData[i] < threshold ? 0 : 255;

      // 应用反转（如果需要）
      if (BinarizedVideoState.invert) {
        value = value === 0 ? 255 : 0;
      }

      displayData[i] = value;
    }
  }

  drawScaledImage(ctxBinarized, displayData, width, height);
}

/**
 * 启动二值化视频流
 */
function startBinarizedStream() {
  if (window.wsClient && window.wsClient.ws) {
    window.wsClient.ws.send(
      JSON.stringify({ type: "CONTROL_CMD", action: "START_BINARIZED_STREAM" }),
    );
    BinarizedVideoState.isPlaying = true;
  }
}

/**
 * 停止二值化视频流
 */
function stopBinarizedStream() {
  if (window.wsClient && window.wsClient.ws) {
    window.wsClient.ws.send(
      JSON.stringify({ type: "CONTROL_CMD", action: "STOP_BINARIZED_STREAM" }),
    );
    BinarizedVideoState.isPlaying = false;
  }
}
