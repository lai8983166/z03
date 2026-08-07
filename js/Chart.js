/**
 * Chart.js - Canvas图表显示模块
 * 不依赖第三方库，实现实时多曲线显示
 */

// ==================== 全局变量 ====================
let canvas = null;
let ctx = null;
let chartFrameCounter = 0;
let needsRedraw = true;

// 图表配置
const ChartConfig = {
  padding: { top: 40, right: 120, bottom: 50, left: 70 },
  maxPoints: 500,
  backgroundColor: '#ffffff',
  gridColor: '#e0e0e0',
  axisColor: '#333333',
  textColor: '#666666',
  font: '12px Microsoft YaHei'
};

// 18条曲线配置
const CURVE_CONFIG = [
  { name: 'D_FYJ', offset: 6, scale: 0.001, checkBox: 'checkBox_D_FYJ', color: '#FF0000' },
  { name: 'D_FWJ', offset: 8, scale: 0.001, checkBox: 'checkBox_D_FWJ', color: '#00FF00' },
  { name: 'GS_FWJ', offset: 10, scale: 0.001, checkBox: 'checkBox_GS_FWJ', color: '#0000FF' },
  { name: 'GS_FYJ', offset: 12, scale: 0.001, checkBox: 'checkBox_GS_FYJ', color: '#FFFF00' },
  { name: 'GX_FYJ', offset: 14, scale: 0.001, checkBox: 'checkBox_GX_FYJ', color: '#FF00FF' },
  { name: 'GX_FWJ', offset: 16, scale: 0.001, checkBox: 'checkBox_GX_FWJ', color: '#00FFFF' },
  { name: 'GX_FYJSpeed', offset: 18, scale: 0.001, checkBox: 'checkBox_GX_FYJSpeed', color: '#FF8000' },
  { name: 'GX_FWJSpeed', offset: 20, scale: 0.001, checkBox: 'checkBox_GX_FWJSpeed', color: '#8000FF' },
  { name: 'GX_FYJ_AccSpeed', offset: 22, scale: 0.001, checkBox: 'checkBox_GX_FYJ_AccSpeed', color: '#0080FF' },
  { name: 'GX_FWJ_AccSpeed', offset: 24, scale: 0.001, checkBox: 'checkBox_GX_FWJ_AccSpeed', color: '#FF0080' },
  { name: 'KFJ_FWJ', offset: 26, scale: 0.001, checkBox: 'checkBox_KFJ_FWJ', color: '#80FF00' },
  { name: 'KFJ_FYJ', offset: 28, scale: 0.001, checkBox: 'checkBox_KFJ_FYJ', color: '#00FF80' },
  { name: 'TL_JSpeed', offset: 30, scale: 0.005, checkBox: 'checkBox_TL_JSpeed', color: '#800000' },
  { name: 'TL_FWJSpeed', offset: 32, scale: 0.002, checkBox: 'checkBox_TL_FWJSpeed', color: '#008000' },
  { name: 'TL_FYJSpeed', offset: 34, scale: 0.002, checkBox: 'checkBox_TL_FYJSpeed', color: '#000080' },
  { name: 'HW_FYJ', offset: 48, scale: 0.001, checkBox: 'checkBox_HW_FYJ', color: '#808000' },
  { name: 'HW_FWJ', offset: 50, scale: 0.001, checkBox: 'checkBox_HW_FWJ', color: '#800080' },
  { name: 'JG_FYJ', offset: 89, scale: 0.001, checkBox: 'checkBox_JG_FYJ', color: '#008080' },
  { name: 'JG_FWJ', offset: 91, scale: 0.001, checkBox: 'checkBox_JG_FWJ', color: '#FFD700' },
];

// 图表状态
const ChartState = {
  selectedCurves: new Set(),
  chartData: {},
  axisY: { min: -1, max: 1 } // Y轴范围（自动调整）
};

// ==================== 初始化 ====================
export function initializeChart() {
  const container = document.getElementById("widget_3");
  if (!container) {
    console.error("[Chart] widget_3 container not found");
    return;
  }

  // 创建Canvas
  canvas = document.createElement('canvas');
  canvas.width = container.clientWidth;
  canvas.height = container.clientHeight;
  canvas.style.width = '100%';
  canvas.style.height = '100%';
  container.appendChild(canvas);

  ctx = canvas.getContext('2d');

  // 初始化数据存储
  initChartData();

  // 绑定checkbox事件
  bindCheckboxEvents();

  // 响应窗口大小变化
  window.addEventListener('resize', onResize);

  // 启动渲染循环
  requestAnimationFrame(renderLoop);

  console.log("[Chart] Canvas initialized with", CURVE_CONFIG.length, "curves");
}

// 初始化数据存储
function initChartData() {
  for (const curve of CURVE_CONFIG) {
    ChartState.chartData[curve.name] = {
      x: new Float32Array(ChartConfig.maxPoints),
      y: new Float32Array(ChartConfig.maxPoints),
      count: 0,
      visible: false,
      color: curve.color
    };
  }
}

// 绑定checkbox事件
function bindCheckboxEvents() {
  for (const curve of CURVE_CONFIG) {
    const checkbox = document.getElementById(curve.checkBox);
    if (checkbox) {
      checkbox.addEventListener("change", function(e) {
        const isVisible = e.target.checked;
        ChartState.chartData[curve.name].visible = isVisible;

        if (isVisible) {
          ChartState.selectedCurves.add(curve.checkBox);
        } else {
          ChartState.selectedCurves.delete(curve.checkBox);
        }

        // 更新Y轴范围并重绘
        updateAxisYRange();
        needsRedraw = true;
      });
    }
  }
}

// 窗口大小变化处理
function onResize() {
  if (!canvas) return;

  const container = document.getElementById("widget_3");
  if (container) {
    canvas.width = container.clientWidth;
    canvas.height = container.clientHeight;
    needsRedraw = true;
  }
}

// ==================== 数据管理 ====================

/**
 * 添加数据点到图表
 * @param {string} curveName - 曲线名称
 * @param {number} x - X坐标（帧计数）
 * @param {number} y - Y坐标（数据值）
 * @param {number} maxPoints - 最大点数（通常500）
 */
export function addChartDataPoint(curveName, x, y, maxPoints) {
  const curve = ChartState.chartData[curveName];
  if (!curve) {
    console.warn(`[Chart] Unknown curve: ${curveName}`);
    return;
  }

  // 添加数据点
  const index = curve.count % maxPoints;
  curve.x[index] = x;
  curve.y[index] = y;
  curve.count++;

  // 达到maxPoints时重置（参考C++逻辑）
  if (curve.count === maxPoints - 1) {
    curve.count = 0;
  }

  // 标记需要重绘
  needsRedraw = true;
}

/**
 * 设置曲线可见性
 * @param {string} curveName - 曲线名称
 * @param {boolean} isVisible - 是否可见
 */
export function setCurveVisible(curveName, isVisible) {
  const curve = ChartState.chartData[curveName];
  if (curve) {
    curve.visible = isVisible;
    needsRedraw = true;
  }
}

/**
 * 更新Y轴范围（自动缩放）
 */
export function updateAxisYRange() {
  let min = Infinity;
  let max = -Infinity;

  // 遍历所有可见曲线
  for (const curve of Object.values(ChartState.chartData)) {
    if (!curve.visible || curve.count === 0) continue;

    for (let i = 0; i < curve.count; i++) {
      if (curve.y[i] < min) min = curve.y[i];
      if (curve.y[i] > max) max = curve.y[i];
    }
  }

  // 如果有数据，更新范围（保留10%边距）
  if (min !== Infinity && max !== -Infinity) {
    const margin = (max - min) * 0.1;
    ChartState.axisY.min = min - margin;
    ChartState.axisY.max = max + margin;
  } else {
    // 默认范围
    ChartState.axisY.min = -1;
    ChartState.axisY.max = 1;
  }
}

/**
 * 获取帧计数器
 */
export function getChartFrameCounter() {
  return chartFrameCounter;
}

/**
 * 增加帧计数器
 */
export function incrementChartFrameCounter() {
  chartFrameCounter++;
  if (chartFrameCounter >= ChartConfig.maxPoints) {
    chartFrameCounter = 0;
    // 清空所有曲线数据
    for (const curve of Object.values(ChartState.chartData)) {
      curve.count = 0;
    }
  }
}

// ==================== 渲染循环 ====================

function renderLoop() {
  if (!ctx || !canvas) return;

  if (needsRedraw) {
    // 清空画布
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 绘制背景
    ctx.fillStyle = ChartConfig.backgroundColor;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    // 计算绘图区域
    const plotArea = {
      x: ChartConfig.padding.left,
      y: ChartConfig.padding.top,
      width: canvas.width - ChartConfig.padding.left - ChartConfig.padding.right,
      height: canvas.height - ChartConfig.padding.top - ChartConfig.padding.bottom
    };

    // 绘制各层
    drawGrid(plotArea);
    drawAxes(plotArea);
    drawCurves(plotArea);
    drawLegend();

    needsRedraw = false;
  }

  requestAnimationFrame(renderLoop);
}

// ==================== 绘图函数 ====================

/**
 * 绘制网格
 */
function drawGrid(plotArea) {
  ctx.strokeStyle = ChartConfig.gridColor;
  ctx.lineWidth = 0.5;

  // 垂直网格线（10等分）
  for (let i = 0; i <= 10; i++) {
    const x = plotArea.x + (plotArea.width / 10) * i;
    ctx.beginPath();
    ctx.moveTo(x, plotArea.y);
    ctx.lineTo(x, plotArea.y + plotArea.height);
    ctx.stroke();
  }

  // 水平网格线（8等分）
  for (let i = 0; i <= 8; i++) {
    const y = plotArea.y + (plotArea.height / 8) * i;
    ctx.beginPath();
    ctx.moveTo(plotArea.x, y);
    ctx.lineTo(plotArea.x + plotArea.width, y);
    ctx.stroke();
  }
}

/**
 * 绘制坐标轴
 */
function drawAxes(plotArea) {
  ctx.strokeStyle = ChartConfig.axisColor;
  ctx.lineWidth = 2;
  ctx.font = ChartConfig.font;
  ctx.fillStyle = ChartConfig.textColor;

  // X轴
  ctx.beginPath();
  ctx.moveTo(plotArea.x, plotArea.y + plotArea.height);
  ctx.lineTo(plotArea.x + plotArea.width, plotArea.y + plotArea.height);
  ctx.stroke();

  // Y轴
  ctx.beginPath();
  ctx.moveTo(plotArea.x, plotArea.y);
  ctx.lineTo(plotArea.x, plotArea.y + plotArea.height);
  ctx.stroke();

  // X轴标签
  ctx.textAlign = 'center';
  ctx.fillText('帧数', plotArea.x + plotArea.width / 2, canvas.height - 15);

  // Y轴标签
  ctx.save();
  ctx.translate(20, plotArea.y + plotArea.height / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.fillText('角度/角速度', 0, 0);
  ctx.restore();

  // Y轴刻度值
  drawYAxisLabels(plotArea);

  // X轴刻度值
  drawXAxisLabels(plotArea);
}

/**
 * 绘制Y轴刻度值
 */
function drawYAxisLabels(plotArea) {
  const yMin = ChartState.axisY.min;
  const yMax = ChartState.axisY.max;
  const yRange = yMax - yMin;

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';

  for (let i = 0; i <= 8; i++) {
    const value = yMin + (yRange / 8) * i;
    const y = plotArea.y + plotArea.height - (plotArea.height / 8) * i;
    ctx.fillText(value.toFixed(2), plotArea.x - 10, y);
  }
}

/**
 * 绘制X轴刻度值
 */
function drawXAxisLabels(plotArea) {
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  for (let i = 0; i <= 10; i++) {
    const value = Math.round((ChartConfig.maxPoints / 10) * i);
    const x = plotArea.x + (plotArea.width / 10) * i;
    ctx.fillText(value.toString(), x, plotArea.y + plotArea.height + 10);
  }
}

/**
 * 绘制曲线
 */
function drawCurves(plotArea) {
  for (const curve of Object.values(ChartState.chartData)) {
    if (!curve.visible || curve.count === 0) continue;

    ctx.beginPath();
    ctx.strokeStyle = curve.color;
    ctx.lineWidth = 1.5;

    // 绘制所有数据点
    for (let i = 0; i < curve.count; i++) {
      const pos = dataToPixel(curve.x[i], curve.y[i], plotArea);

      if (i === 0) {
        ctx.moveTo(pos.x, pos.y);
      } else {
        ctx.lineTo(pos.x, pos.y);
      }
    }

    ctx.stroke();
  }
}

/**
 * 绘制图例
 */
function drawLegend() {
  let y = ChartConfig.padding.top;

  ctx.font = ChartConfig.font;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';

  for (const curve of CURVE_CONFIG) {
    const data = ChartState.chartData[curve.name];
    if (!data.visible) continue;

    // 绘制颜色块
    ctx.fillStyle = curve.color;
    ctx.fillRect(canvas.width - ChartConfig.padding.right + 10, y - 6, 12, 12);

    // 绘制文字
    ctx.fillStyle = ChartConfig.textColor;
    ctx.fillText(curve.name, canvas.width - ChartConfig.padding.right + 28, y);

    y += 20;
  }
}

/**
 * 坐标转换：数据空间 -> 像素空间
 * @param {number} x - X坐标（帧计数）
 * @param {number} y - Y坐标（数据值）
 * @param {object} plotArea - 绘图区域
 * @returns {object} - 像素坐标 {x, y}
 */
function dataToPixel(x, y, plotArea) {
  // X轴：帧计数 -> 像素
  const px = plotArea.x + (x / ChartConfig.maxPoints) * plotArea.width;

  // Y轴：数据值 -> 像素（自动缩放）
  const yMin = ChartState.axisY.min;
  const yMax = ChartState.axisY.max;
  const yRange = yMax - yMin;

  const py = plotArea.y + plotArea.height - ((y - yMin) / yRange) * plotArea.height;

  return { x: px, y: py };
}

// ==================== 更新函数 ====================

/**
 * 更新图表（供checkbox事件调用）
 */
function updateChart() {
  updateAxisYRange();
  needsRedraw = true;
}

/**
 * 添加数据（兼容旧接口）
 */
function addChartData(curveName, value) {
  const frameCounter = getChartFrameCounter();
  addChartDataPoint(curveName, frameCounter, value, ChartConfig.maxPoints);
}
