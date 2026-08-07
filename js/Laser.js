/**
 *
 *
 *
 *  中间"激光图像组"的所有功能
 *    - 6x6 激光图像表格 (tableWidget_8)
 *    - 1Hz 显示激光按钮
 *    - 开始/停止保存按钮
 *    - 策略选择下拉框
 *    - 状态栏 (textBrowser_3)
 *    - 清空状态栏按钮
 *
 * Tab 1 "激光图像信息"标签页
 *    - 激光应答表格 (tableWidget_JGReply)
 *    - 回放设置
 *    - 回放图像控制
 */
import { Utils } from "../main.js";
import wsClient from "./Client.js";
import statusBar from "./StatusBar.js";

// 激光图像状态
const LaserState = {
  isSaving: false,
  isReplaying: false,
  isReplayPaused: true,
  currentFrame: 0,
  totalFrames: 0,
  strategy: 0,
  replayFrames: null,
  replayTimer: null,
  replayFps: 10,
};

// 导出激光数据保存状态，供 Telemeter.js 使用
export let isSavingJG = false;

// 1Hz 激光图像显示开关及上次刷新时间戳
export let isLaserDisplayEnabled = false;
export let lastLaserDisplayTime = 0;

/**
 * 受 1Hz显示激光 开关控制的激光图像刷新函数。
 * 仅当开关开启且距上次刷新已超过 1000ms 时才调用 updateLaserImage。
 * @param {Uint8Array} laserData - 108 字节的激光帧数据
 */
export function tryUpdateLaserImage1Hz(laserData) {
    const now = Date.now();
    if (!isLaserDisplayEnabled) {
        if (now - lastLaserDisplayTime >= 100) {
            lastLaserDisplayTime = now;
            updateLaserImage(laserData);
            return;
        }
    }
  
  if (now - lastLaserDisplayTime >= 350) {
    lastLaserDisplayTime = now;
    updateLaserImage(laserData);
  }
}

/**
 * 开始保存激光帧数据
 * 向服务端发送 REQUEST_SAVE_PATH 请求，由服务端弹出原生文件保存对话框选择路径，
 * 服务端选定路径后直接开始保存并回传 SAVE_STATUS 通知前端。
 */
export function startSavingJG() {
  statusBar.sendMessage("请在服务端窗口选择保存位置...", "black");
  const cmd = JSON.stringify({
    type: "REQUEST_SAVE_PATH",
    saveType: "jg",
    defaultName: "激光数据.dat",
    filter: "数据文件 (*.dat)|*.dat|所有文件 (*.*)|*.*",
  });
  wsClient.sendText(cmd);
  console.log("[Laser] 请求服务端弹出文件保存对话框");

  // 监听服务端回传的保存状态（一次性）
  const onStatus = (msg) => {
    if (msg.saveType !== "jg") return;
    wsClient.off("SAVE_STATUS", onStatus);
    if (msg.status === "started") {
      isSavingJG = true;
      LaserState.isSaving = true;
      statusBar.sendMessage(`正在保存激光数据 → ${msg.path}`, "black");
    } else if (msg.status === "cancelled") {
      statusBar.sendMessage("已取消保存", "gray");
    } else if (msg.status === "error") {
      statusBar.sendMessage(`保存失败: ${msg.msg}`, "red");
    }
  };
  wsClient.on("SAVE_STATUS", onStatus);
}

/**
 * 停止保存激光帧数据
 */
export function stopSavingJG() {
  isSavingJG = false;
  LaserState.isSaving = false;
  const cmd = JSON.stringify({
    type: "CONTROL_CMD",
    action: "STOP_SAVE_JG",
  });
  wsClient.sendText(cmd);
  statusBar.sendMessage("激光数据保存已停止");
  console.log("[Laser] 停止保存激光数据");
}

export function initializeLaserTables() {
  // 6x6 激光图像表格
  const table6x6 = document.getElementById("tableWidget_8");
  Utils.centerAlignTable("tableWidget_8");

  // 激光应答表格
  const tableJGReply = document.getElementById("tableWidget_JGReply");
  Utils.centerAlignTable("tableWidget_JGReply");

  document
    .getElementById("pushButton_19")
    ?.addEventListener("click", function () {
      isLaserDisplayEnabled = !isLaserDisplayEnabled;
      lastLaserDisplayTime = 0; // 重置时间戳，使下次立即刷新
      if (isLaserDisplayEnabled) {
        this.classList.add("active");
          statusBar.sendMessage("3Hz 激光图像显示已开启", "black");

        console.log("[Laser] 1Hz 显示激光 已开启");
      } else {
        this.classList.remove("active");
        statusBar.sendMessage("3Hz 激光图像显示已关闭", "gray");
        console.log("[Laser] 1Hz 显示激光 已关闭");
      }
    });

  document
    .getElementById("pushButton_Start_JGSave")
    ?.addEventListener("click", function () {
      startSavingJG();
    });

  document
    .getElementById("pushButton_End_JGSave")
    ?.addEventListener("click", function () {
      stopSavingJG();
    });

  document.getElementById("comboBox")?.addEventListener("change", function (e) {
    LaserState.strategy = e.target.selectedIndex + 1;
    console.log("选择策略:", LaserState.strategy);
  });

  document
    .getElementById("pushButton_Replydat")
    ?.addEventListener("click", function () {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".dat,.bin";
      input.onchange = async (e) => {
        const file = e.target.files?.[0];
        if (!file) return;

        stopLaserReplay();
        setLaserReplayMessage(`正在加载: ${file.name}`);
        console.log("选择激光回放文件:", file.name);

        try {
          const frames = await loadLaserReplayFile(file);
          LaserState.replayFrames = frames;
          LaserState.totalFrames = frames.length;
          LaserState.currentFrame = 0;
          renderLaserFrameAt(0);
          updateLaserFrameDisplay();
          setLaserReplayMessage(`已选择: ${file.name} (${frames.length} 帧)`);
          console.log(`[Laser] 文件加载成功，共 ${frames.length} 帧`);
        } catch (err) {
          LaserState.replayFrames = null;
          LaserState.totalFrames = 0;
          LaserState.currentFrame = 0;
          updateLaserFrameDisplay();
          setLaserReplayMessage(`加载失败: ${err.message}`);
          console.error("[Laser] 文件加载失败:", err);
        }
      };
      input.click();
    });

  document
    .getElementById("pushButton_StartReplay_JG")
    ?.addEventListener("click", function () {
      if (!LaserState.isReplaying) {
        if (!LaserState.replayFrames || LaserState.replayFrames.length === 0) {
          alert("请先选择激光回放文件！");
          return;
        }
        startLaserReplay(LaserState.replayFrames);
        return;
      }

      if (LaserState.isReplayPaused) {
        resumeLaserReplay();
      } else {
        pauseLaserReplay();
      }
    });

  document
    .getElementById("pushButton_EndReplay_JG")
    ?.addEventListener("click", function () {
      stopLaserReplay();
    });

  document
    .getElementById("pushButton_Previous_Frame_JG")
    ?.addEventListener("click", function () {
      replayPreviousLaserFrame();
    });

  document
    .getElementById("pushButton_Next_Frame_JG")
    ?.addEventListener("click", function () {
      replayNextLaserFrame();
    });

  document
    .getElementById("horizontalSlider_JG")
    ?.addEventListener("input", function (e) {
      if (LaserState.totalFrames <= 0) return;

      const percentage = Number(e.target.value) / 100;
      const frameIndex = Math.round(percentage * (LaserState.totalFrames - 1));
      seekLaserReplayFrame(frameIndex);
    });

    document
        .getElementById("pushButton_JGQL")
        ?.addEventListener("click", () => {
            const table = document.getElementById("tableWidget_8");
            for (let i = 0; i < 6; i++) {
                for (let j = 0; j < 6; j++) {
                    
                    const pulseWidth = 0;
                   

                    // 计算显示值
                    const distanceValue = 0;

                    // 更新单元格
                    const cell = table.rows[i]?.cells[j];
                    if (cell) {
                        cell.style.whiteSpace = "pre-wrap";
                        cell.textContent = `${distanceValue}\n${pulseWidth}`;

                        // 设置背景色（取反，0是白色）
                        const gray = 255 - pulseWidth;
                        cell.style.backgroundColor = `rgb(${gray}, ${gray}, ${gray})`;
                        cell.style.color = gray < 128 ? "white" : "black";
                    }
                }
            }
        }
            
        );
  updateLaserFrameDisplay();
}

const LASER_REPLAY_FRAME_SIZE = 108;

function setLaserReplayMessage(message) {
  const browser = document.getElementById("textBrowser_5");
  if (browser) browser.textContent = message;
}

export async function loadLaserReplayFile(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const raw = new Uint8Array(e.target.result);
        if (raw.length < LASER_REPLAY_FRAME_SIZE) {
          reject(new Error("文件长度不足 1 帧激光数据"));
          return;
        }

        const totalFrames = Math.floor(raw.length / LASER_REPLAY_FRAME_SIZE);
        if (totalFrames <= 0) {
          reject(new Error("未解析到有效激光帧"));
          return;
        }

        const frames = [];
        for (let i = 0; i < totalFrames; i++) {
          const start = i * LASER_REPLAY_FRAME_SIZE;
          frames.push(raw.slice(start, start + LASER_REPLAY_FRAME_SIZE));
        }

        const trailingBytes = raw.length % LASER_REPLAY_FRAME_SIZE;
        if (trailingBytes > 0) {
          console.warn(`[Laser] 文件尾部忽略 ${trailingBytes} 字节`);
        }

        resolve(frames);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error("激光回放文件读取失败"));
    reader.readAsArrayBuffer(file);
  });
}

function startLaserReplay(frames) {
  if (!frames || frames.length === 0) return;

  clearLaserReplayTimer();
  LaserState.isReplaying = true;
  LaserState.isReplayPaused = false;
  LaserState.replayFrames = frames;
  LaserState.totalFrames = frames.length;
  LaserState.currentFrame = 0;
  renderLaserReplayFrame();
  scheduleLaserReplayTimer();
  updateLaserFrameDisplay();
  console.log(`[Laser] 开始回放，总帧数: ${frames.length}`);
}

function resumeLaserReplay() {
  if (!LaserState.replayFrames || LaserState.replayFrames.length === 0) return;
  LaserState.isReplaying = true;
  LaserState.isReplayPaused = false;
  scheduleLaserReplayTimer();
  updateLaserFrameDisplay();
  console.log("[Laser] 继续回放");
}

function pauseLaserReplay() {
  if (!LaserState.isReplaying) return;
  clearLaserReplayTimer();
  LaserState.isReplayPaused = true;
  updateLaserFrameDisplay();
  console.log("[Laser] 暂停回放");
}

function stopLaserReplay() {
  clearLaserReplayTimer();
  LaserState.isReplaying = false;
  LaserState.isReplayPaused = true;
  LaserState.currentFrame = 0;
  updateLaserFrameDisplay();
  console.log("[Laser] 停止回放");
}

function scheduleLaserReplayTimer() {
  clearLaserReplayTimer();
  LaserState.replayTimer = setInterval(
    renderLaserReplayFrame,
    1000 / LaserState.replayFps,
  );
}

function clearLaserReplayTimer() {
  if (LaserState.replayTimer) {
    clearInterval(LaserState.replayTimer);
    LaserState.replayTimer = null;
  }
}

function clampLaserReplayIndex(index) {
  if (LaserState.totalFrames <= 0) return 0;
  return Math.max(0, Math.min(Number(index) || 0, LaserState.totalFrames - 1));
}

function renderLaserFrameAt(index) {
  if (!LaserState.replayFrames || LaserState.replayFrames.length === 0) return;
  const frameIndex = clampLaserReplayIndex(index);
  updateLaserImage(LaserState.replayFrames[frameIndex], "tableWidget_JGReply");
}

function renderLaserReplayFrame() {
  if (!LaserState.replayFrames || LaserState.replayFrames.length === 0) return;

  if (LaserState.currentFrame >= LaserState.totalFrames) {
    LaserState.currentFrame = 0;
  }

  renderLaserFrameAt(LaserState.currentFrame);
  LaserState.currentFrame = clampLaserReplayIndex(LaserState.currentFrame + 1);
  updateLaserFrameDisplay();
}

function seekLaserReplayFrame(frameIndex) {
  if (!LaserState.replayFrames || LaserState.replayFrames.length === 0) return;
  LaserState.currentFrame = clampLaserReplayIndex(frameIndex);
  renderLaserFrameAt(LaserState.currentFrame);
  updateLaserFrameDisplay();
}

function replayPreviousLaserFrame() {
  if (!LaserState.replayFrames || !LaserState.isReplayPaused) return;
  LaserState.currentFrame = clampLaserReplayIndex(LaserState.currentFrame - 1);
  renderLaserFrameAt(LaserState.currentFrame);
  updateLaserFrameDisplay();
}

function replayNextLaserFrame() {
  if (!LaserState.replayFrames || !LaserState.isReplayPaused) return;
  LaserState.currentFrame = clampLaserReplayIndex(LaserState.currentFrame + 1);
  renderLaserFrameAt(LaserState.currentFrame);
  updateLaserFrameDisplay();
}

function updateLaserFrameDisplay() {
  const currentFrameInput = document.getElementById("textEdit_CurrentFrame_JG");
  const totalFrameInput = document.getElementById("textEdit_TotalFrame_JG");
  const startButton = document.getElementById("pushButton_StartReplay_JG");
  const prevButton = document.getElementById("pushButton_Previous_Frame_JG");
  const nextButton = document.getElementById("pushButton_Next_Frame_JG");

  if (currentFrameInput) currentFrameInput.value = LaserState.currentFrame;
  if (totalFrameInput) totalFrameInput.value = LaserState.totalFrames;

  const slider = document.getElementById("horizontalSlider_JG");
  if (slider) {
    slider.disabled = LaserState.totalFrames <= 0;
    slider.value =
      LaserState.totalFrames > 0
        ? (LaserState.currentFrame / Math.max(1, LaserState.totalFrames - 1)) *
          100
        : 0;
  }

  const canStep =
    LaserState.replayFrames &&
    LaserState.replayFrames.length > 0 &&
    LaserState.isReplayPaused;
  if (prevButton) prevButton.disabled = !canStep;
  if (nextButton) nextButton.disabled = !canStep;

  if (startButton) {
    startButton.textContent = LaserState.isReplaying
      ? (LaserState.isReplayPaused ? "继续回放" : "暂停回放")
      : "开始回放";
  }
}

/**
 * 更新激光 6x6 图像表格
 * @param {Uint8Array} laserData - 108 字节激光数据 (6x6x3)
 * @param {string} tableId - 目标 6x6 表格 ID
 */
export function updateLaserImage(laserData, tableId = "tableWidget_8") {
    //console.log("JGGGGGGGGG");
  const table = document.getElementById(tableId);
  if (!table || !laserData || laserData.length < LASER_REPLAY_FRAME_SIZE) {
    console.error(`[Laser] 激光图像数据无效或表格不存在: ${tableId}`);
    return;
  }
  

  for (let i = 0; i < 6; i++) {
    for (let j = 0; j < 6; j++) {
      const offset =  3 * j + 18 * i; 

      // 读取 3 字节数据
      const byte0 = laserData[offset];
      const byte1 = laserData[offset + 1];
      const byte2 = laserData[offset + 2];

      // 解析脉冲宽度 (1字节) 和距离 (2字节)
      const pulseWidth = byte2; // 第3个字节
      const distance = (byte0 ) | (byte1<<8) // 前2个字节组合

      // 计算显示值
        let distanceValue = (distance * 0.15).toFixed(2);
        if (distanceValue > 1500) {
            distanceValue = 1500;
        } else if (distanceValue < 0) {
            distanceValue = 0;
        }

      // 更新单元格
      const cell = table.rows[i]?.cells[j];
      if (cell) {
        cell.style.whiteSpace = "pre-wrap";
        cell.textContent = `${distanceValue}\n${pulseWidth}`;

        // 设置背景色（取反，0是白色）
        const gray = 255 - pulseWidth;
        cell.style.backgroundColor = `rgb(${gray}, ${gray}, ${gray})`;
        cell.style.color = gray < 128 ? "white" : "black";
      }
    }
  }
}
