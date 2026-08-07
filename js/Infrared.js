/**
 *
 *
 *
 *  左侧"红外图像组"的所有功能
 *    - 红外图像显示 (384x384 widget)
 *    - 图像显示模式切换 (comboBox_ImgShowMode)
 *    - 分段线性控制
 *    - 分析区域选择（红框）
 *    - 区域信息计算（蓝框）
 *    - 开始/停止保存按钮
 *
 *  Tab 0 "红外图像信息"标签页
 *    - 11x11 像素值表格 (tableWidget_6)
 *    - 11x11 区域图像显示
 *    - 回放设置（选择文件、开始回放、停止回放）
 *    - 回放图像控制（滑块、上一帧、下一帧）
 */

import { Utils, setLEDStatus } from "../main.js";
import wsClient from "./Client.js";
import statusBar from "./StatusBar.js";
import {
  loadReplayFile,
  startReplay,
  stopReplay,
  pauseReplay,
  resumeReplay,
  replayPreviousFrame,
  replayNextFrame,
  seekReplayFrame,
  getReplayState,
  startSavingVideo,
  stopSavingVideo,
} from "./Video.js";
import { startSavingBlackbox, stopSavingBlackbox } from "./Telemeter.js";
import {
  startSavingYC,
  stopSavingYC,
  loadYCReplayFile,
  startYCReplay,
  stopYCReplay,
  pauseYCReplay,
  resumeYCReplay,
  seekYCReplay,
  setYCReplayFps,
  replayPreviousYCFrame,
  replayNextYCFrame,
  onYCReplayStateChange,
  getYCReplayState,
} from "./YC.js";

// 红外图像状态
const InfraredState = {
  currentMode: 0,
  isSaving: false,
  isReplaying: false,
  currentFrame: 0,
  totalFrames: 0,
};

export function initializeInfraredTables() {
  //  11x11 像素表格数据
  Utils.loadCSVToTable("./csv/Product_Pic.csv", "tableWidget_6", 11, 11);

  // 设置中心点（5,5）颜色为橙色
  setTimeout(() => {
    const table = document.getElementById("tableWidget_6");
    if (table && table.rows[5] && table.rows[5].cells[5]) {
      table.rows[5].cells[5].style.backgroundColor = "orange";
      table.rows[5].cells[5].style.fontWeight = "bold";
    }
  }, 100);

  Utils.centerAlignTable("tableWidget_6");

  // 分析区域表格（设置只读）
  const table7 = document.getElementById("tableWidget_7");
  if (table7 && table7.rows.length >= 4) {
    for (let i = 0; i < 4; i++) {
      Utils.setTableCellReadonly("tableWidget_7", i, 0);
      Utils.setTableCellReadonly("tableWidget_7", i, 1);
    }
  }

  const textEdit1 = document.getElementById("textEdit");
  const textEdit2 = document.getElementById("textEdit_2");
  if (textEdit1) textEdit1.value = "0";
  if (textEdit2) textEdit2.value = "0";

  bindInfraredEvents();
}

function bindInfraredEvents() {
  // 图像显示模式切换
  const comboBox = document.getElementById("comboBox_ImgShowMode");
  if (comboBox) {
    comboBox.addEventListener("change", function (e) {
      InfraredState.currentMode = e.target.selectedIndex;
      console.log("切换显示模式:", e.target.value);
    });
  }

  // 开始保存
  const btnStartSave = document.getElementById("pushButton_Start_Save");
  if (btnStartSave) {
    btnStartSave.addEventListener("click", function () {
      console.log("开始保存红外图像");
      startSavingVideo();
    });
  }

  // 停止保存
  const btnEndSave = document.getElementById("pushButton_End_Save");
  if (btnEndSave) {
    btnEndSave.addEventListener("click", function () {
      console.log("停止保存红外图像");
      stopSavingVideo();
    });
  }

  // 开始保存黑匣子
  const btnStartBlackbox = document.getElementById("pushButton_Start_Save_Blackbox");
  if (btnStartBlackbox) {
    btnStartBlackbox.addEventListener("click", function () {
      console.log("开始保存黑匣子");
      startSavingBlackbox();
    });
  }

  // 停止保存黑匣子
  const btnEndBlackbox = document.getElementById("pushButton_End_Save_Blackbox");
  if (btnEndBlackbox) {
    btnEndBlackbox.addEventListener("click", function () {
      console.log("停止保存黑匣子");
      stopSavingBlackbox();
    });
  }

  // 开始保存YC
  const btnStartYC = document.getElementById("pushButton_Start_Save_YC");
  if (btnStartYC) {
    btnStartYC.addEventListener("click", function () {
      console.log("开始保存YC数据");
      startSavingYC();
    });
  }

  // 停止保存YC
  const btnEndYC = document.getElementById("pushButton_End_Save_YC");
  if (btnEndYC) {
    btnEndYC.addEventListener("click", function () {
      console.log("停止保存YC数据");
      stopSavingYC();
    });
  }

  bindReplayEvents();
}

// 回放事件
function bindReplayEvents() {
  // [STAR] 用于存储加载的回放数据
  let loadedFrames = null;
  let replayLoadSerial = 0;

  // 选择回风/红外回放文件
  const btnSelectFile = document.getElementById("pushButton_20");
  if (btnSelectFile) {
    btnSelectFile.addEventListener("click", async function () {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".dat,.bin";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
          await loadAndSetReplayFile(file, "video");
        }
      };
      // 清空旧值，避免文件选择器对重复选择同一路径时不触发 change。
      input.value = "";
      input.click();
    });
  }

  // 选择黑匣子回放文件
  const btnSelectBlackboxFile = document.getElementById("pushButton_Select_Blackbox_Replay");
  if (btnSelectBlackboxFile) {
    btnSelectBlackboxFile.addEventListener("click", async function () {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".dat";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (file) {
          await loadAndSetReplayFile(file, "blackbox");
        }
      };
      input.value = "";
      input.click();
    });
  }

  async function loadAndSetReplayFile(file, type) {
    const loadSerial = ++replayLoadSerial;
    const browser = document.getElementById("textBrowser_4");

    // 选新文件时先结束旧回放，否则开始按钮仍会进入旧回放的暂停/继续分支。
    stopReplay();
    loadedFrames = null;
    if (btnStartReplay) {
      btnStartReplay.textContent = "开始回放";
    }
    updateFrameStepButtons();

    if (browser) {
      browser.textContent = `正在加载: ${file.name}`;
    }
    console.log(`选择${type === "blackbox" ? "黑匣子" : "红外图像"}回放文件:`, file.name);

    try {
      const frames = await loadReplayFile(file, type);
      // 若用户在读取大文件期间又选择了新文件，丢弃较早的读取结果。
      if (loadSerial !== replayLoadSerial) return;
      loadedFrames = frames;
      console.log(`[OK] 文件加载成功，共 ${loadedFrames.length} 帧`);
      if (browser) {
        browser.textContent = `已选择: ${file.name} (${loadedFrames.length} 帧, 模式: ${type})`;
      }
    } catch (err) {
      if (loadSerial !== replayLoadSerial) return;
      console.error("[ERROR] 文件加载失败:", err);
      if (browser) {
        browser.textContent = `加载失败: ${err.message}`;
      }
    }
  }

  const btnStartReplay = document.getElementById("pushButton_21");
  if (btnStartReplay) {
    btnStartReplay.addEventListener("click", function () {
      const state = getReplayState();

      if (!state.isReplaying) {
        // 尚未开始 → 加载数据并直接开始播放
        if (!loadedFrames || loadedFrames.length === 0) {
          alert("请先选择回放文件！");
          return;
        }
        startReplay(loadedFrames);   // 初始化并显示第一帧（暂停态）
        resumeReplay();              // 立即开始自动播放
        InfraredState.isReplaying = true;
        btnStartReplay.textContent = "暂停回放";
        updateFrameStepButtons();
        return;
      }

      if (state.isReplayPaused) {
        // 当前暂停 → 恢复播放
        resumeReplay();
        btnStartReplay.textContent = "暂停回放";
        updateFrameStepButtons();
      } else {
        // 当前播放中 → 暂停
        pauseReplay();
        btnStartReplay.textContent = "开始回放";
        updateFrameStepButtons();
      }
    });
  }
  // Stop button removed - stop action handled via play/pause toggle

  const btnPrev = document.getElementById("pushButton_Previous_Frame");
  if (btnPrev) {
    btnPrev.disabled = true;
    btnPrev.addEventListener("click", function () {
      replayPreviousFrame();
    });
  }

  const btnNext = document.getElementById("pushButton_Next_Frame");
  if (btnNext) {
    btnNext.disabled = true;
    btnNext.addEventListener("click", function () {
      replayNextFrame();
    });
  }

  const slider = document.getElementById("horizontalSlider");
  if (slider) {
    slider.addEventListener("input", function (e) {
      const replayState = getReplayState();
      if (replayState.totalFrames > 0) {
        const percentage = e.target.value / 100;
        const frameIndex = Math.floor(percentage * replayState.totalFrames);
        seekReplayFrame(frameIndex);
      }
    });
  }

  // 根据当前回放/暂停状态更新上一帧/下一帧按钮的可用性
  function updateFrameStepButtons() {
    const state = getReplayState();
    const canStep = state.isReplaying && state.isReplayPaused;
    if (btnPrev) btnPrev.disabled = !canStep;
    if (btnNext) btnNext.disabled = !canStep;
  }

  // ---- YC replay ----
  let loadedYCFrames = null;
  const ycSlider = document.getElementById("ycReplaySlider");
  const ycCurrentFrame = document.getElementById("textEdit_YC_CurrentFrame");
  const ycTotalFrame = document.getElementById("textEdit_YC_TotalFrame");
  const ycBrowser = document.getElementById("textBrowser_YC_Replay");
  const btnPrevYC = document.getElementById("pushButton_Previous_YC_Frame");
  const btnNextYC = document.getElementById("pushButton_Next_YC_Frame");
  const ycReplayFpsInput = document.getElementById("input_YC_Replay_Fps");

  function getYCReplayFpsFromInput() {
    const value = Number(ycReplayFpsInput ? ycReplayFpsInput.value : 200);
    if (!Number.isFinite(value) || value <= 0) return 200;
    return Math.max(1, Math.min(value, 200));
  }

  function updateYCReplayUI(state = getYCReplayState()) {
    const total = state.totalFrames || (loadedYCFrames ? loadedYCFrames.length : 0);
    const btnStartYCReplay = document.getElementById("pushButton_Start_YC_Replay");
    if (ycReplayFpsInput && document.activeElement !== ycReplayFpsInput) {
      ycReplayFpsInput.value = state.fps || getYCReplayFpsFromInput();
    }
    if (ycCurrentFrame) ycCurrentFrame.value = state.isReplaying ? state.currentFrame : 0;
    if (ycTotalFrame) ycTotalFrame.value = total;
    if (ycSlider) {
      ycSlider.max = total > 0 ? total : 0;
      ycSlider.value = state.isReplaying ? Math.min(state.currentFrame, total) : 0;
      ycSlider.disabled = total === 0;
    }
    const canStep = state.isReplaying && state.isPaused;
    if (btnPrevYC) btnPrevYC.disabled = !canStep;
    if (btnNextYC) btnNextYC.disabled = !canStep;
    if (btnStartYCReplay) {
      btnStartYCReplay.textContent = state.isReplaying
        ? (state.isPaused ? "继续YC回放" : "暂停YC回放")
        : "开始YC回放";
    }
  }

  if (ycReplayFpsInput) {
    setYCReplayFps(getYCReplayFpsFromInput());
  }
  onYCReplayStateChange(updateYCReplayUI);

  // 选择 YC 回放文件
  const btnSelectYCFile = document.getElementById("pushButton_Select_YC_Replay");
  if (btnSelectYCFile) {
    btnSelectYCFile.addEventListener("click", async function () {
      const input = document.createElement("input");
      input.type = "file";
      input.accept = ".dat,.bin";
      input.onchange = async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        stopYCReplay();
        if (ycBrowser) ycBrowser.textContent = `正在加载YC: ${file.name}`;
        try {
          loadedYCFrames = await loadYCReplayFile(file);
          console.log(`[OK] YC文件加载成功，共 ${loadedYCFrames.length} 帧`);
          if (ycBrowser) ycBrowser.textContent = `已选择YC: ${file.name} (${loadedYCFrames.length} 帧)`;
          updateYCReplayUI();
        } catch (err) {
          loadedYCFrames = null;
          console.error("[ERROR] YC文件加载失败:", err);
          if (ycBrowser) ycBrowser.textContent = `YC加载失败: ${err.message}`;
          updateYCReplayUI();
        }
      };
      input.click();
    });
  }

  // 开始/暂停/继续 YC 回放
  const btnStartYCReplay = document.getElementById("pushButton_Start_YC_Replay");
  if (btnStartYCReplay) {
    btnStartYCReplay.addEventListener("click", function () {
      const state = getYCReplayState();

      if (!state.isReplaying) {
        if (!loadedYCFrames || loadedYCFrames.length === 0) {
          alert("请先选择YC回放文件！");
          return;
        }
        startYCReplay(loadedYCFrames, getYCReplayFpsFromInput());
        btnStartYCReplay.textContent = "暂停YC回放";
        return;
      }

      if (state.isPaused) {
        resumeYCReplay();
        btnStartYCReplay.textContent = "暂停YC回放";
      } else {
        pauseYCReplay();
        btnStartYCReplay.textContent = "继续YC回放";
      }
    });
  }

  if (ycSlider) {
    ycSlider.addEventListener("input", function (e) {
      const frameIndex = Number(e.target.value) || 0;
      const state = getYCReplayState();
      if (!state.isReplaying && loadedYCFrames && loadedYCFrames.length > 0) {
        startYCReplay(loadedYCFrames, getYCReplayFpsFromInput());
        pauseYCReplay();
        if (btnStartYCReplay) btnStartYCReplay.textContent = "继续YC回放";
      } else if (!state.isPaused) {
        pauseYCReplay();
        if (btnStartYCReplay) btnStartYCReplay.textContent = "继续YC回放";
      }
      seekYCReplay(frameIndex);
    });
  }

  if (ycReplayFpsInput) {
    ycReplayFpsInput.addEventListener("change", function () {
      const fps = setYCReplayFps(getYCReplayFpsFromInput());
      ycReplayFpsInput.value = fps;
    });
  }

  if (btnPrevYC) {
    btnPrevYC.disabled = true;
    btnPrevYC.addEventListener("click", replayPreviousYCFrame);
  }

  if (btnNextYC) {
    btnNextYC.disabled = true;
    btnNextYC.addEventListener("click", replayNextYCFrame);
  }

  updateYCReplayUI();
}
