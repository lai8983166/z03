/**
 *
 *
 *
 *
 *  Tab 2 "操作类命令"
 *    - 休眠、唤醒、自检按钮
 *    - 自检结果表格 (tableWidget_ZJJG)
 *    - 非均匀校正控制
 *    - 一次指令按钮组
 *    - 积分时间调整 (tableWidget_13, tableWidget_12)
 *    - 软件版本号 (tableWidget)
 *
 *  Tab 3 "参数装订"
 *    - 参数装订发送表格 (tableWidget_CSZD)
 *    - 参数装订接收表格 (tableWidget_CSZD_Recv)
 *    - 状态字控制（单选按钮、下拉框）
 *    - 加载/保存/装订按钮
 *
 *  Tab 4 "固定参数装订"
 *    - 固定参数表格 (tableWidget_GDCSZD)
 *    - 接收表格 (tableWidget_GDCSZD_Recv)
 *
 * Tab 5 "与被测产品通信"
 *    - 数据采集命令帧 (tableWidget_SJCJ_Send)
 *    - 数据采集应答帧 (tableWidget_SJCJ_SP)
 *    - 红外应答状态表格 (tableWidget_HWYD)
 *    - 激光工作状态表格 (tableWidget_JGGZZT)
 *    - 工作模式指令单选按钮组
 *    - LED 状态显示
 *
 *  Tab 7 "激光图像校正参数装订"
 *    - 激光参数装订表格 (tableWidget_JGCSZD)
 *    - 接收表格 (tableWidget_JGXC)
 *
 *  Tab 8 "红外图像检测参数装订"
 */
import { Utils, setLEDStatus } from "../main.js";
import PacketManager from "./BinaryTableHelper.js";
import wsClient from "./Client.js";
import statusBar from "./StatusBar.js";
import { triggerSJCJResolve } from "./ImageUpload.js";
import { setTargetBoxPosition as setVideoTargetBoxPosition } from "./Video.js";
import {
  addChartDataPoint,
  setCurveVisible,
  getChartFrameCounter,
  incrementChartFrameCounter,
  updateAxisYRange as updateChartYRange,
} from "./Chart.js";
import { updateLaserImage } from "./Laser.js";

const sendBuffer = new Uint8Array(1040);
let isSJCJRunning = false;
let resolveAck_SJCJ = null;
let isSJCJF000HRunning = false;
let isSavingBFrame = false;
let saveBFrameCount = 0;
const MAX_SAVE_FRAMES = 1000000;
let resolveAck_F000H_SJCJ = null;
let sjcjF000HUpdatePromise = Promise.resolve();

async function saveBinaryFile(bytes, filename) {
  const blob = new Blob([bytes], { type: "application/octet-stream" });

  if (typeof window.showSaveFilePicker === "function") {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
          {
            description: "DAT file",
            accept: { "application/octet-stream": [".dat"] },
          },
        ],
      });
      const writable = await handle.createWritable();
      await writable.write(blob);
      await writable.close();
      return;
    } catch (err) {
      if (err.name === "AbortError") throw err;
      console.warn("[CSZD3000H] showSaveFilePicker failed, fallback to download:", err);
    }
  }

  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.style.display = "none";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    document.body.removeChild(a);
  }, 1000);
}

// F000H 状态栏节流：每 2000ms 最多更新一次
const F000H_LOG_INTERVAL = 2000;
let _f000hLastSendLog = 0;
let _f000hLastRecvLog = 0;

/** 供 ImageUpload.js 注册 F000H 单次发送的 resolve 回调 */
export function setResolveAck_F000H_SJCJ(fn) { resolveAck_F000H_SJCJ = fn; }

// ---- 校准扫描用 B 帧原始数据回调 ----
let _bFrameRawCallback = null;
/** 注册每帧 B 帧数据回调，传 null 取消注册 */
export function setBFrameRawCallback(fn) { _bFrameRawCallback = fn; }
/** 获取 F000H 采集运行状态 */
export function getSJCJF000HRunning() { return isSJCJF000HRunning; }
/** 外部启动 F000H 采集（若未运行则启动） */
export function startSJCJF000H() {
  if (!isSJCJF000HRunning) {
    isSJCJF000HRunning = true;
    const btn = document.getElementById("pushButton_SJCJ_F000H_Send");
    if (btn) btn.innerText = "停止数据采集";
    loadCommand_SJCJ_F000H();
  }
}
/** 外部停止 F000H 采集 */
export function stopSJCJF000H() {
  isSJCJF000HRunning = false;
  const btn = document.getElementById("pushButton_SJCJ_F000H_Send");
  if (btn) btn.innerText = "开始数据采集";
}

const runSJCJF000HUpdate = async () => {
  const btn = document.getElementById("pushButton_SJCJ_F000H_Send");

  if (isSJCJF000HRunning) {
    isSJCJF000HRunning = false;
    statusBar.sendMessage("正在重新加载A帧参数...", "SJCJpdate");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  isSJCJF000HRunning = true;
  if (btn) btn.innerText = "停止数据采集";
  loadCommand_SJCJ_F000H();

  statusBar.successMessage("A帧参数已更新，数据采集已重启");
};

const requestSJCJF000HUpdate = () => {
  sjcjF000HUpdatePromise = sjcjF000HUpdatePromise
    .then(runSJCJF000HUpdate)
    .catch((err) => {
      console.error("[F000H] A帧更新失败:", err);
      statusBar.errorMessage?.("A帧更新失败");
    });
  return sjcjF000HUpdatePromise;
};

const adjustSJCJF000HPresetValue = async (row, delta) => {
  const table = document.getElementById("tableWidget_SJCJ_F000H_Send");
  const cell = table?.rows[row]?.cells[1];
  if (!cell) {
    console.warn(`[F000H] 预置角单元格不存在: row ${row}`);
    return;
  }

  const input = cell.querySelector("input, select");
  const currentValue = Number.parseFloat(
    input ? input.value.trim() : cell.textContent.trim(),
  );
  const nextValue = Number.isFinite(currentValue)
    ? currentValue + delta
    : delta;
  const displayValue = Number(nextValue.toFixed(1)).toString();

  if (input) {
    input.value = displayValue;
  } else {
    cell.textContent = displayValue;
  }

  await requestSJCJF000HUpdate();
};
let isSJCJ0010HRunning = false;
let resolveAck_0100H_SJCJ = null;

const editableCells_GDCSZD = [
  { row: 0, col: 1 },
  { row: 1, col: 1 },
  { row: 2, col: 1 },
  { row: 3, col: 1 },
  { row: 4, col: 1 },
  { row: 5, col: 1 },
  { row: 6, col: 1 },
  { row: 0, col: 3 },
  { row: 1, col: 3 },
  { row: 2, col: 3 },
  { row: 3, col: 3 },
  { row: 4, col: 3 },
  { row: 5, col: 3 },
  { row: 6, col: 3 },
  { row: 7, col: 3 },
];

const editableCells_CSZD = [
  { row: 3, col: 1 },
  { row: 4, col: 1 },
  { row: 6, col: 1 },
  { row: 7, col: 1 },
  { row: 8, col: 1 },
  { row: 10, col: 1 },
  { row: 11, col: 1 },
  { row: 12, col: 1 },
  { row: 13, col: 1 },
  { row: 14, col: 1 },
  { row: 15, col: 1 },
  { row: 16, col: 1 },
  { row: 17, col: 1 },
  { row: 18, col: 1 },
  { row: 19, col: 1 },
  { row: 20, col: 1 },
  { row: 21, col: 1 },
  { row: 22, col: 1 },
  { row: 23, col: 1 },
  { row: 24, col: 1 },
  { row: 25, col: 1 },
  { row: 26, col: 1 },
  { row: 27, col: 1 },
  { row: 28, col: 1 },
  { row: 29, col: 1 },
  { row: 30, col: 1 },
  { row: 31, col: 1 },
  { row: 32, col: 1 },
  { row: 33, col: 1 },
  { row: 34, col: 1 },
];
const editableCells_SJCSY = [
  { row: 0, col: 1 },

  { row: 2, col: 1 },
  { row: 3, col: 1 },
  { row: 4, col: 1 },
  { row: 5, col: 1 },
  { row: 6, col: 1 },
  { row: 7, col: 1 },
  { row: 8, col: 1 },
  { row: 9, col: 1 },
  { row: 10, col: 1 },
  { row: 11, col: 1 },
  { row: 12, col: 1 },
  { row: 13, col: 1 },
  { row: 14, col: 1 },
  { row: 15, col: 1 },
  { row: 16, col: 1 },
  { row: 17, col: 1 },
  { row: 18, col: 1 },
  { row: 19, col: 1 },
  { row: 20, col: 1 },
  { row: 21, col: 1 },
  { row: 22, col: 1 },
  { row: 23, col: 1 },
  { row: 24, col: 1 },
  { row: 25, col: 1 },
  { row: 26, col: 1 },
  { row: 27, col: 1 },
  { row: 28, col: 1 },
  { row: 29, col: 1 },
  { row: 30, col: 1 },
  { row: 31, col: 1 },
  { row: 32, col: 1 },
  { row: 33, col: 1 },
  { row: 34, col: 1 },
  { row: 35, col: 1 },
  { row: 36, col: 1 },
  { row: 37, col: 1 },
  { row: 42, col: 1 },
  { row: 43, col: 1 },
  { row: 45, col: 1 },
  { row: 46, col: 1 },
  { row: 47, col: 1 },
];
const editableCells_JGCSZD = () => {
  let i = 1;
  let arr = [];
  for (i; i <= 5; i += 2) {
    for (let j = 0; j < 37; ++j) {
      arr.push({ row: j, col: i });
    }
  }
  return arr;
};

/*const cellMap_CSZD = Utils.getEditableCellsAsPositionMap(
  "tableWidget_CSZD",
  editableCells_CSZD
);*/

export function initializeCommandTables() {
  // 参数装订表格初始化
  initializeCSZDTable();

  // 固定参数装订表格
  initializeGDCSZDTable();

  // 激光参数装订表格
  initializeJGCSZDTable();

  // 数据采集表格
  initializeSJCJTable();

  // 数据采集F000H表格
  initializeSJCJF000HTable();

  // 红外图像检测参数装订表格
  initializeIRDetectTable();

  initializeCSZD3000HTable();

  // 自检结果表格
  Utils.loadCSVToTable("./csv/ZJJG_Recv.csv", "tableWidget_ZJJG", 13, 4);
  Utils.centerAlignTable("tableWidget_ZJJG");

  // 积分时间表格
  Utils.loadCSVToTable("./csv/JFSJ_Send.csv", "tableWidget_13", 2, 2);
  Utils.loadCSVToTable("./csv/JFSJ_Recv.csv", "tableWidget_12", 2, 2);
  Utils.centerAlignTable("tableWidget_13");
  Utils.centerAlignTable("tableWidget_12");

  // 软件版本表格
  Utils.loadCSVToTable("./csv/App_Ver_Recv.csv", "tableWidget", 6, 4);
  Utils.centerAlignTable("tableWidget");
  // 操作类命令
  document.getElementById("pushButton_XM")?.addEventListener("click", () => {
    console.log("发送休眠指令");
    loadCommand_Shut();
  });

  document.getElementById("pushButton_Wake")?.addEventListener("click", () => {
    console.log("发送唤醒指令");
    loadCommand_Wake();
  });

  document.getElementById("pushButton_ZJ")?.addEventListener("click", () => {
    console.log("发送自检指令");
    loadCommand_SelfTest();
  });

  document
    .getElementById("pushButton_FJYJZ_2000H")
    ?.addEventListener("click", () => {
      console.log("pushButton_FJYJZ_2000H");
      loadCommand_FJYJZ_2000H();
    });

  document
    .getElementById("pushButton_FJYJZ_0020H")
    ?.addEventListener("click", () => {
      console.log("pushButton_FJYJZ_0020H");
      loadCommand_FJYJZJG_0020H();
    });

  document.getElementById("pushButton_QZJJG")?.addEventListener("click", () => {
    console.log("取自检结果");
    loadCommand_GetSelfTestResult();
  });

  // 非均匀校正 checkbox 互斥逻辑（同组只能选一个）
  const makeExclusive = (selector) => {
    const boxes = document.querySelectorAll(selector);
    boxes.forEach((box) => {
      box.addEventListener("change", () => {
        if (box.checked) {
          boxes.forEach((b) => { if (b !== box) b.checked = false; });
        } else {
          // 不允许全部取消勾选：若取消则保持当前勾选
          box.checked = true;
        }
      });
    });
  };
  makeExclusive(".fjyjz-jfdw");
  makeExclusive(".fjyjz-cmd");

  // 非均匀校正
  document.getElementById("pushButton_FJYJZ")?.addEventListener("click", () => {
    const jfdw = document.querySelector(".fjyjz-jfdw:checked")?.value;
    const command = document.querySelector(".fjyjz-cmd:checked")?.value;
    console.log("非均匀校正: 积分档位=", jfdw, "命令=", command);
    loadCommand_FJYJZ();
  });

  // 参数装订
  document.getElementById("pushButton_CSZD")?.addEventListener("click", () => {
    console.log("参数装订");
    loadCommand_CSZD();
  });

  document
    .getElementById("pushButton_Read_dat")
    ?.addEventListener("click", () => {
      console.log("加载已有参数装订");
    });

  document
    .getElementById("pushButton_Set_dat")
    ?.addEventListener("click", () => {
      console.log("保存装订参数");
    });

  document.getElementById("pushButton_MBKZ")?.addEventListener("click", () => {
    console.log("目标控制参数装订下传");
    loadCommand_MBKZ();
  });

  // 固定参数装订
  document
    .getElementById("pushButton_GDCSZD")
    ?.addEventListener("click", () => {
      console.log("固定参数装订");
      loadCommand_GDCSZD();
    });

  document
    .getElementById("pushButton_LoadGDCS")
    ?.addEventListener("click", () => {
      console.log("加载已有固定参数");
    });

  document
    .getElementById("pushButton_SaveGDCS")
    ?.addEventListener("click", () => {
      console.log("保存固定参数");
    });

  document
    .getElementById("pushButton_GDCSXC")
    ?.addEventListener("click", () => {
      console.log("固定参数装订下传");
      loadCommand_GDCSZDXC();
    });

  // 激光参数装订
  document
    .getElementById("pushButton_JGCSZD")
    ?.addEventListener("click", () => {
      console.log("激光参数装订");
      loadCommand_JGCSZD();
    });

  document
    .getElementById("pushButton_ReadJG_dat")
    ?.addEventListener("click", async () => {
      console.log("加载已有激光参数装订");
      await loadJGCSZDExcelToTable();
    });

  document
    .getElementById("pushButton_SetJG_dat")
    ?.addEventListener("click", async () => {
      console.log("保存激光装订参数");
      await saveJGCSZDTableToExcel();
    });

  document.getElementById("pushButton_JGXC")?.addEventListener("click", () => {
    loadCommand_JGCSZDXC();
    console.log("激光参数装订下传");
  });

  // 数据采集
  document.getElementById("pushButton")?.addEventListener("click", async () => {
    const btn = document.getElementById("pushButton");
    if (isSJCJRunning === true) {
      isSJCJRunning = false;

      btn.innerText = "开始数据采集";
      return;
    } else {
      isSJCJRunning = true;
      btn.innerText = "停止数据采集";
      loadCommand_SJCJ();
    }
  });

  document
    .getElementById("pushButton_Start_Save_CMD")
    ?.addEventListener("click", () => {
      console.log("开始保存命令帧");
      startSavingCMD();
    });

  document
    .getElementById("pushButton_End_Save_CMD")
    ?.addEventListener("click", () => {
      console.log("停止保存命令帧");
      stopSavingCMD();
    });

  // 位控复位
  document
    .getElementById("pushButton_ZTReset")
    ?.addEventListener("click", () => {
      console.log("位控复位");
    });

  // A帧更新
  document
    .getElementById("pushButton_WKUpdate")
    ?.addEventListener("click", async () => {
      const btn = document.getElementById("pushButton");

      // 无论当前是否运行，都强制重新启动
      if (isSJCJRunning) {
        // 当前正在运行：先停止
        isSJCJRunning = false;
        statusBar.sendMessage("正在重新加载A帧参数...", "SJCJpdate");

        // 等待一小段时间，确保旧循环退出
        await new Promise((resolve) => setTimeout(resolve, 100));
      }

      // 重新开始（无论之前是否运行）
      isSJCJRunning = true;
      btn.innerText = "停止数据采集";
      loadCommand_SJCJ();

      statusBar.successMessage("A帧参数已更新，数据采集已重启");
    });

  // 取从站软件版本号
  document.getElementById("pushButton_BBH")?.addEventListener("click", () => {
    console.log("取从站软件版本号");
    loadCommand_BBH();
  });

  // 一次指令
  document.getElementById("pushButton_27")?.addEventListener("click", () => {
    console.log("准备命令,要求导引头唤醒");
    loadCommand_Wake();
  });

  document.getElementById("pushButton_26")?.addEventListener("click", () => {
    console.log("中断性自检");
  });

  document.getElementById("pushButton_28")?.addEventListener("click", () => {
    console.log("停止中断性自检/停止准备/停止模拟发射,进入休眠状态");
  });

  document.getElementById("pushButton_25")?.addEventListener("click", () => {
    console.log("模拟发射");
  });

  document
    .getElementById("pushButton_IRDetect_Send")
    ?.addEventListener("click", () => {
      console.log("红外图像检测参数装订发送");
      loadCommand_IRDetectParam;
    });

  document
    .getElementById("pushButton_IRDetect_Request")
    ?.addEventListener("click", () => {
      console.log("红外图像检测参数装订下传请求");
      loadCommand_IRDetectParamRequest();
    });

  // 绑定F000H发送按钮
  document
    .getElementById("pushButton_SJCJ_F000H_Send")
    ?.addEventListener("click", () => {
      const btn = document.getElementById("pushButton_SJCJ_F000H_Send");

      if (isSJCJF000HRunning === true) {
        isSJCJF000HRunning = false;

        btn.innerText = "开始数据采集";
        return;
      } else {
        isSJCJF000HRunning = true;
        btn.innerText = "停止数据采集";
        loadCommand_SJCJ_F000H();
      }
    });

  document
    .getElementById("pushButton_SJCJ_0010H")
    ?.addEventListener("click", () => {
      const btn = document.getElementById("pushButton_SJCJ_0010H");

      if (isSavingBFrame) {
        isSavingBFrame = false;
        btn.innerText = "开始保存A/B帧";
        stopSavingCMD();
      } else {
        isSavingBFrame = true;
        saveBFrameCount = 0;
        btn.innerText = "停止保存A/B帧";
        startSavingBFrame();
      }
    });

    document
        .getElementById("pushButton_SJCJ_F000H_update")
        ?.addEventListener("click", () => {
            requestSJCJF000HUpdate();
        });

    document
        .getElementById("button_SJCJ_F000H_Preset_Up_1")
        ?.addEventListener("click", () => {
            adjustSJCJF000HPresetValue(25, 1);
        });
    document
        .getElementById("button_SJCJ_F000H_Preset_Up")
        ?.addEventListener("click", () => {
            adjustSJCJF000HPresetValue(25, 0.1);
        });
    document
        .getElementById("button_SJCJ_F000H_Preset_Down")
        ?.addEventListener("click", () => {
            adjustSJCJF000HPresetValue(25, -0.1);
        });
    document
        .getElementById("button_SJCJ_F000H_Preset_Down_1")
        ?.addEventListener("click", () => {
            adjustSJCJF000HPresetValue(25, -1);
        });
    document
        .getElementById("button_SJCJ_F000H_Preset_Left_1")
        ?.addEventListener("click", () => {
            adjustSJCJF000HPresetValue(26, 1);
        });
    document
        .getElementById("button_SJCJ_F000H_Preset_Left")
        ?.addEventListener("click", () => {
            adjustSJCJF000HPresetValue(26, 0.1);
        });
    document
        .getElementById("button_SJCJ_F000H_Preset_Right")
        ?.addEventListener("click", () => {
            adjustSJCJF000HPresetValue(26, -0.1);
        });
    document
        .getElementById("button_SJCJ_F000H_Preset_Right_1")
        ?.addEventListener("click", () => {
            adjustSJCJF000HPresetValue(26, -1);
        });
}

function initializeCSZDTable() {
  Utils.loadCSVToTable("./csv/CSZD.csv", "tableWidget_CSZD", 35, 2);
  Utils.centerAlignTable("tableWidget_CSZD");

  Utils.loadCSVToTable("./csv/CSZD_Recv.csv", "tableWidget_CSZD_Recv", 35, 2);
  Utils.centerAlignTable("tableWidget_CSZD_Recv");

  Utils.setEditableCells("tableWidget_CSZD", editableCells_CSZD);
  Utils.setEditableCells("tableWidget_GDCSZD", editableCells_GDCSZD);

  // 设置装订字单元格不可编辑（第5行第1列）
  setTimeout(() => {
    Utils.setTableCellReadonly("tableWidget_CSZD", 5, 1);
    Utils.setTableCellReadonly("tableWidget_CSZD_Recv", 5, 1);

    // 将下拉框移到表格单元格中
    Utils.setCellWidget("tableWidget_CSZD", 0, 1, "comboBox_GZMS");
    Utils.setCellWidget("tableWidget_CSZD", 1, 1, "comboBox_MBLX");
    Utils.setCellWidget("tableWidget_CSZD", 2, 1, "comboBox_CJBS");
    Utils.setCellWidget(
      "tableWidget_CSZD",
      9,
      1,
      "comboBox_LaserAmplifierGain",
    );

    // 接收表格的文本框
    Utils.setCellWidget("tableWidget_CSZD_Recv", 0, 1, "textEdit_GZMS");
    Utils.setCellWidget("tableWidget_CSZD_Recv", 1, 1, "textEdit_DJMBLX");
    Utils.setCellWidget("tableWidget_CSZD_Recv", 2, 1, "textEdit_HWCJBS");
  }, 200);
}

function initializeGDCSZDTable() {
  Utils.loadCSVToTable("./csv/GDCSZD_Send.csv", "tableWidget_GDCSZD", 8, 4);
  Utils.loadCSVToTable(
    "./csv/GDCSZD_Recv.csv",
    "tableWidget_GDCSZD_Recv",
    7,
    4,
  );
  Utils.centerAlignTable("tableWidget_GDCSZD");
  Utils.centerAlignTable("tableWidget_GDCSZD_Recv");
}

function initializeJGCSZDTable() {
  Utils.loadCSVToTable("./csv/JGCSZD_Send.csv", "tableWidget_JGCSZD", 36, 6);
  Utils.loadCSVToTable("./csv/JGCSZDXC_Recv.csv", "tableWidget_JGXC", 36, 4);
  Utils.centerAlignTable("tableWidget_JGCSZD");
  Utils.centerAlignTable("tableWidget_JGXC");

  Utils.setEditableCells("tableWidget_JGCSZD", editableCells_JGCSZD());
}

function initializeSJCJTable() {
  Utils.loadCSVToTable("./csv/SJCJ_Send.csv", "tableWidget_SJCJ_Send", 49, 2);
  Utils.centerAlignTable("tableWidget_SJCJ_Send");
  Utils.setEditableCells("tableWidget_SJCJ_Send", editableCells_SJCSY);

  Utils.loadCSVToTable("./csv/SJCJ_Recv.csv", "tableWidget_SJCJ_SP", 131, 2);
  Utils.centerAlignTable("tableWidget_SJCJ_SP");

  // 红外应答状态表格
  Utils.loadCSVToTable("./csv/HWYDZT_Recv.csv", "tableWidget_HWYD", 16, 2);
  Utils.centerAlignTable("tableWidget_HWYD");

  // 激光工作状态表格
  Utils.loadCSVToTable("./csv/JGGZZT_Recv.csv", "tableWidget_JGGZZT", 16, 2);
  Utils.centerAlignTable("tableWidget_JGGZZT");

  // 设置特定单元格不可编辑
  setTimeout(() => {
    Utils.setTableCellReadonly("tableWidget_SJCJ_Send", 38, 1); // 导引头抗干扰信息
    Utils.setTableCellReadonly("tableWidget_SJCJ_Send", 39, 1); // 红外位控
    Utils.setTableCellReadonly("tableWidget_SJCJ_Send", 41, 1); // 积分时间有效位
    Utils.setTableCellReadonly("tableWidget_SJCJ_Send", 44, 1); // 激光位控

    Utils.setCellWidget("tableWidget_SJCJ_Send", 1, 1, "checkBox_FXZL");
    Utils.setCellWidget(
      "tableWidget_SJCJ_Send",
      40,
      1,
      "comboBox_HWSearchMode",
    );
    Utils.setCellWidget("tableWidget_SJCJ_Send", 45, 1, "checkBox_YXYB");
    Utils.setCellWidget("tableWidget_HWYD", 2, 1, "label_led_HWCSZT");
    Utils.setCellWidget("tableWidget_HWYD", 4, 1, "label_led_HWJH");
    Utils.setCellWidget("tableWidget_HWYD", 5, 1, "label_led_HWGZ");
    Utils.setCellWidget("tableWidget_HWYD", 7, 1, "label_led_HWJYGZ");
    Utils.setCellWidget("tableWidget_HWYD", 8, 1, "label_led_HWDSMB");

    Utils.setCellWidget("tableWidget_JGGZZT", 2, 1, "label_led_JGCSZT");
    Utils.setCellWidget("tableWidget_JGGZZT", 4, 1, "label_led_JGJH");
    Utils.setCellWidget("tableWidget_JGGZZT", 5, 1, "label_led_JGGZ");
    Utils.setCellWidget("tableWidget_JGGZZT", 7, 1, "label_led_JGJYGZ");
    Utils.setCellWidget("tableWidget_JGGZZT", 8, 1, "label_led_JGDSMB");
  }, 200);
}

function initializeIRDetectTable() {
  // 发送表格 (28行 x 8列 = 224个单元格，但 MyTableFile 参数是70)
  Utils.loadCSVToTable(
    "./csv/IRDetectParam_Send.csv",
    "tableWidget_IRDetect_Send",
    28,
    8,
  );
  Utils.centerAlignTable("tableWidget_IRDetect_Send");
  Utils.stretchTableColumns("tableWidget_IRDetect_Send");

  // 接收表格
  Utils.loadCSVToTable(
    "./csv/IRDetectParam_Recv.csv",
    "tableWidget_IRDetect_Recv",
    28,
    8,
  );
  Utils.centerAlignTable("tableWidget_IRDetect_Recv");
  Utils.stretchTableColumns("tableWidget_IRDetect_Recv");

  // 设置接收表格为只读
  setTimeout(() => {
    const recvTable = document.getElementById("tableWidget_IRDetect_Recv");
    if (recvTable) {
      Array.from(recvTable.rows).forEach((row, rowIndex) => {
        Array.from(row.cells).forEach((cell, colIndex) => {
          Utils.setTableCellReadonly(
            "tableWidget_IRDetect_Recv",
            rowIndex,
            colIndex,
          );
        });
      });
    }
  }, 200);
}

function initializeSJCJF000HTable() {
  // 发送表格 - 28行 x 2列
  Utils.loadCSVToTable(
    "./csv/SJCJ_F000H_Send.csv",
    "tableWidget_SJCJ_F000H_Send",
    31,
    2,
  );
  Utils.centerAlignTable("tableWidget_SJCJ_F000H_Send");
  Utils.setEditableCells(
    "tableWidget_SJCJ_F000H_Send",
    editableCells_SJCJ_F000H_Send(),
  );

  // 接收表格 - 18行 x 4列
  Utils.loadCSVToTable(
    "./csv/SJCJ_F000H_Recv.csv",
    "tableWidget_SJCJ_F000H_Recv",
    18,
    4,
  );
  Utils.centerAlignTable("tableWidget_SJCJ_F000H_Recv");

  Utils.loadCSVToTable(
    "./csv/HWYDZT_F000H_Recv.csv",
    "tableWidget_HWYDZT_F000H_Recv",
    36,
    2,
  );
  Utils.centerAlignTable("tableWidget_HWYDZT_F000H_Recv");

  Utils.loadCSVToTable(
    "./csv/JGGZZT_F000H_Recv.csv",
    "tableWidget_JGGZZT_F000H_Recv",
    36,
    2,
  );
  Utils.centerAlignTable("tableWidget_JGGZZT_F000H_Recv");
  // 将下拉框嵌入接收表格的相应行
  /*setTimeout(() => {
    Utils.setCellWidget(
      "tableWidget_SJCJ_F000H_Recv",
      23,
      1,
      "comboBox_TargetStatus"
    );
    Utils.setCellWidget(
      "tableWidget_SJCJ_F000H_Recv",
      24,
      1,
      "comboBox_CompositeCommand"
    );
  }, 200);*/
}

const CSZD3000H_FIELDS = Object.freeze({
  laserAmplifierGain: "激光放大器增益",
  laserBlindZone: "激光接收盲区",
  confidence: "置信度参数",
  validFlag0: "参数有效标志 0",
  validFlag1: "参数有效标志 1",
  aimingPointMode: "瞄准点选择模式",
  trackingEntryMode: "跟踪转入模式",
});
const CSZD3000H_LAYOUT = Object.freeze({
  mainPayloadBytes: 102,
  matrixBytes: 7 * 7 * 2,
  // 主参数中“置信度参数”结束后的字节偏移。
  matrixInsertOffset: 68,
});

// 3000H 的界面分组只描述“哪个项目对应哪些字段”，不参与协议布局。
// checkbox 的顺序必须与有效标志 bit 顺序保持一致。
const CSZD3000H_PROJECTS = Object.freeze([
  {
    label: "红外视场校正",
    flag: 0,
    checkboxId: "checkbox_CSYXBZ0_IRFOV",
    fields: ["红外方位视场校正", "红外俯仰视场校正"],
  },
  {
    label: "激光视场",
    flag: 0,
    checkboxId: "checkbox_CSYXBZ0_LASERFOV",
    fields: ["激光发射方位视场", "激光发射俯仰视场", "激光接收视场"],
  },
  {
    label: "激光光轴",
    flag: 0,
    checkboxId: "checkbox_CSYXBZ0_LASERAXIS",
    fields: ["激光光轴方位偏差角", "激光光轴俯仰偏差角"],
  },
  {
    label: "激光发射参数",
    flag: 0,
    checkboxId: "checkbox_CSYXBZ0_LASEREMIT",
    fields: [
      "激光发射重频",
      "激光探测器高压",
      "激光放大器增益",
      "激光比较电平",
    ],
  },
  {
    label: "激光接收参数",
    flag: 0,
    checkboxId: "checkbox_CSYXBZ0_LASERRECV",
    fields: ["激光接收周期", "激光接收盲区"],
  },
  {
    label: "红外目标面积",
    flag: 0,
    checkboxId: "checkbox_CSYXBZ0_IRAREA",
    fields: ["红外目标面积下限", "红外目标面积上限"],
  },
  {
    label: "红外目标排序",
    flag: 0,
    checkboxId: "checkbox_CSYXBZ0_IRSORT",
    fields: ["红外目标排序方式"],
  },
  {
    label: "GPOL",
    flag: 1,
    checkboxId: "checkbox_GPOLCSYX",
    fields: ["GPOL 参数"],
  },
  {
    label: "倍率",
    flag: 1,
    checkboxId: "checkbox_BLCSYX",
    fields: ["倍率参数"],
  },
  {
    label: "结构",
    flag: 1,
    checkboxId: "checkbox_JGCSYX",
    fields: ["结构参数"],
  },
  {
    label: "融合",
    flag: 1,
    checkboxId: "checkbox_RHCSYX",
    fields: ["融合系数 α", "融合系数 β", "融合系数 γ"],
  },
  {
    label: "分割",
    flag: 1,
    checkboxId: "checkbox_FGCSYX",
    fields: ["分割系数参数", "分割下限参数"],
  },
  {
    label: "关联",
    flag: 1,
    checkboxId: "checkbox_GLCSYX",
    fields: [
      "关联参数 X",
      "关联参数 Y",
      "关联参数 G",
      "关联参数 A",
      "关联参数 W",
      "关联参数 H",
      "关联参数 La",
      "关联参数 Lb",
      "关联参数 Lc",
    ],
  },
  {
    label: "置信度",
    flag: 1,
    checkboxId: "checkbox_ZXDCSYX",
    fields: ["置信度参数"],
  },
  {
    label: "卷积核",
    flag: 1,
    checkboxId: "checkbox_JJHCSYX",
    matrix: true,
  },
  {
    label: "红外目标辐射强度",
    flag: 1,
    checkboxId: "checkbox_CSYXBZ1_IRRADIANCE",
    fields: ["红外目标辐射强度"],
  },
  {
    label: "尺寸",
    flag: 1,
    checkboxId: "checkbox_CSYXBZ1_SIZE",
    fields: ["尺寸下限系数", "尺寸上限系数"],
  },
  {
    label: "灰度",
    flag: 1,
    checkboxId: "checkbox_CSYXBZ1_GRAY",
    fields: ["灰度下限系数", "灰度上限系数"],
  },
  {
    label: "前发偏差阈值",
    flag: 1,
    checkboxId: "checkbox_CSYXBZ1_FORWARDOFFSET",
    fields: ["前发方位偏差阈值", "前发俯仰偏差阈值"],
  },
  {
    label: "预置精度",
    flag: 1,
    checkboxId: "checkbox_CSYXBZ1_PRESET",
    fields: ["预置精度阈值"],
  },
  {
    label: "瞄准点模式",
    flag: 1,
    checkboxId: "checkbox_CSYXBZ1_AIMMODE",
    fields: ["瞄准点选择模式"],
  },
  {
    label: "跟踪转入模式",
    flag: 1,
    checkboxId: "checkbox_CSYXBZ1_TRACKMODE",
    fields: ["跟踪转入模式"],
  },
]);

/**
 * 生成协议线上的 3000H 载荷：
 * 主参数前段（截至置信度参数） + 卷积核 + 主参数后段。
 */
function buildCSZD3000HWirePayload(mainPayload, matrixPayload) {
  const { mainPayloadBytes, matrixBytes, matrixInsertOffset } =
    CSZD3000H_LAYOUT;

  if (mainPayload.length !== mainPayloadBytes) {
    throw new Error(
      `3000H 主参数长度异常：期望 ${mainPayloadBytes}，实际 ${mainPayload.length}`,
    );
  }
  if (matrixPayload.length !== matrixBytes) {
    throw new Error(
      `3000H 卷积核长度异常：期望 ${matrixBytes}，实际 ${matrixPayload.length}`,
    );
  }

  const wirePayload = new Uint8Array(mainPayload.length + matrixPayload.length);
  wirePayload.set(mainPayload.subarray(0, matrixInsertOffset), 0);
  wirePayload.set(matrixPayload, matrixInsertOffset);
  wirePayload.set(
    mainPayload.subarray(matrixInsertOffset),
    matrixInsertOffset + matrixPayload.length,
  );
  return wirePayload;
}

/**
 * 下传报文采用协议线布局，但现有接收 helper 的内部布局仍是
 * “完整主参数 + 卷积核”。解析前先恢复为 helper 所需顺序。
 */
function restoreCSZD3000HHelperLayout(wireData) {
  const source =
    wireData instanceof Uint8Array ? wireData : new Uint8Array(wireData);
  const { mainPayloadBytes, matrixBytes, matrixInsertOffset } =
    CSZD3000H_LAYOUT;
  const expectedBytes = mainPayloadBytes + matrixBytes;

  if (source.length < expectedBytes) {
    console.error(
      `[CSZD3000H] 下传载荷长度不足：期望至少 ${expectedBytes}，实际 ${source.length}`,
    );
    return null;
  }

  const helperData = new Uint8Array(expectedBytes);
  const matrixEnd = matrixInsertOffset + matrixBytes;
  const mainSuffixBytes = mainPayloadBytes - matrixInsertOffset;

  helperData.set(source.subarray(0, matrixInsertOffset), 0);
  helperData.set(
    source.subarray(matrixEnd, matrixEnd + mainSuffixBytes),
    matrixInsertOffset,
  );
  helperData.set(
    source.subarray(matrixInsertOffset, matrixEnd),
    mainPayloadBytes,
  );
  return helperData;
}
const CSZD3000H_VALID_FLAG0_CHECKBOXES = [
  "checkbox_CSYXBZ0_IRFOV",
  "checkbox_CSYXBZ0_LASERFOV",
  "checkbox_CSYXBZ0_LASERAXIS",
  "checkbox_CSYXBZ0_LASEREMIT",
  "checkbox_CSYXBZ0_LASERRECV",
  "checkbox_CSYXBZ0_IRAREA",
  "checkbox_CSYXBZ0_IRSORT",
];
const CSZD3000H_VALID_FLAG1_CHECKBOXES = [
  "checkbox_GPOLCSYX",
  "checkbox_BLCSYX",
  "checkbox_JGCSYX",
  "checkbox_RHCSYX",
  "checkbox_FGCSYX",
  "checkbox_GLCSYX",
  "checkbox_ZXDCSYX",
  "checkbox_JJHCSYX",
  "checkbox_CSYXBZ1_IRRADIANCE",
  "checkbox_CSYXBZ1_SIZE",
  "checkbox_CSYXBZ1_GRAY",
  "checkbox_CSYXBZ1_FORWARDOFFSET",
  "checkbox_CSYXBZ1_PRESET",
  "checkbox_CSYXBZ1_AIMMODE",
  "checkbox_CSYXBZ1_TRACKMODE",
];
const CSZD3000H_VALID_FLAG_SELECT_ALL = Object.freeze([
  {
    selectAllId: "checkbox_CSYXBZ0_SELECT_ALL",
    checkboxIds: CSZD3000H_VALID_FLAG0_CHECKBOXES,
  },
  {
    selectAllId: "checkbox_CSYXBZ1_SELECT_ALL",
    checkboxIds: CSZD3000H_VALID_FLAG1_CHECKBOXES,
  },
]);

function updateCSZD3000HSelectAllState(selectAllId, checkboxIds) {
  const selectAll = document.getElementById(selectAllId);
  if (!selectAll) return;

  const checkboxes = checkboxIds
    .map((checkboxId) => document.getElementById(checkboxId))
    .filter(Boolean);
  const checkedCount = checkboxes.filter((checkbox) => checkbox.checked).length;
  selectAll.checked = checkboxes.length > 0 && checkedCount === checkboxes.length;
  selectAll.indeterminate = checkedCount > 0 && checkedCount < checkboxes.length;
}

function setupCSZD3000HSelectAllCheckboxes() {
  CSZD3000H_VALID_FLAG_SELECT_ALL.forEach(({ selectAllId, checkboxIds }) => {
    const selectAll = document.getElementById(selectAllId);
    if (!selectAll) return;

    selectAll.addEventListener("change", () => {
      checkboxIds.forEach((checkboxId) => {
        const checkbox = document.getElementById(checkboxId);
        if (checkbox) checkbox.checked = selectAll.checked;
      });
      selectAll.indeterminate = false;
    });

    checkboxIds.forEach((checkboxId) => {
      document.getElementById(checkboxId)?.addEventListener("change", () => {
        updateCSZD3000HSelectAllState(selectAllId, checkboxIds);
      });
    });
    updateCSZD3000HSelectAllState(selectAllId, checkboxIds);
  });
}

function createCSZD3000HSelect(fieldName, direction) {
  if (direction !== "send") return null;

  const select = document.createElement("select");
  select.dataset.cszdDirection = direction;
  select.dataset.cszdField = fieldName;

  if (fieldName === CSZD3000H_FIELDS.laserAmplifierGain) {
    select.id = "comboBox_JGFDQZY_3000H";
    ["0:1倍", "1:0.8倍", "2:0.6倍", "3:0.4倍"].forEach((text) => {
      const option = document.createElement("option");
      option.value = text;
      option.textContent = text;
      select.appendChild(option);
    });
  } else if (fieldName === CSZD3000H_FIELDS.aimingPointMode) {
    select.id = "comboBox_MZDXZMS_3000H";
    [["0", "热力模式"], ["1", "运动模式"]].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    });
  } else if (fieldName === CSZD3000H_FIELDS.trackingEntryMode) {
    select.id = "comboBox_GZZRMS_3000H";
    [["0", "默认模式"], ["1", "惯性抗云模式"]].forEach(([value, text]) => {
      const option = document.createElement("option");
      option.value = value;
      option.textContent = text;
      select.appendChild(option);
    });
  } else {
    return null;
  }

  return select;
}

function createCSZD3000HFieldControl(fieldName, direction, fieldIndex) {
  if (direction === "recv") {
    const value = document.createElement("span");
    value.className = "cszd3000h-recv-value";
    value.dataset.cszdDirection = direction;
    value.dataset.cszdField = fieldName;
    value.textContent = "0";
    return value;
  }

  const specialSelect = createCSZD3000HSelect(fieldName, direction);
  if (specialSelect) return specialSelect;

  const input = document.createElement("input");
  input.type = "number";
  input.step = "any";
  input.id = `cszd3000h_send_field_${fieldIndex}`;
  input.dataset.cszdDirection = direction;
  input.dataset.cszdField = fieldName;
  if (fieldName === CSZD3000H_FIELDS.laserBlindZone) {
    input.id = "input_JGMQ_3000H";
    input.min = "80";
    input.max = "2630";
    input.step = "10";
  }
  return input;
}

function createCSZD3000HFieldList(fieldNames, direction, fieldIndexRef) {
  const list = document.createElement("div");
  list.className = "cszd3000h-field-list";

  fieldNames.forEach((fieldName) => {
    const row = document.createElement("div");
    row.className = "cszd3000h-field-row";
    const label = document.createElement("span");
    label.className = "cszd3000h-field-label";
    label.textContent = fieldName;
    label.title = fieldName;
    const control = createCSZD3000HFieldControl(
      fieldName,
      direction,
      fieldIndexRef.value++,
    );
    row.append(label, control);
    list.appendChild(row);
  });

  return list;
}

function createCSZD3000HMatrix(direction) {
  const matrix = document.createElement("table");
  matrix.className = "cszd3000h-matrix table-fixed";
  const firstIndex = direction === "send" ? 1 : 48;

  for (let rowIndex = 0; rowIndex < 7; rowIndex++) {
    const row = document.createElement("tr");
    for (let colIndex = 0; colIndex < 7; colIndex++) {
      const cell = document.createElement("td");
      const helperIndex = firstIndex + rowIndex * 7 + colIndex;
      const control =
        direction === "send"
          ? document.createElement("input")
          : document.createElement("span");

      if (direction === "send") {
        control.type = "number";
        control.step = "any";
        control.value = "0";
        control.dataset.cszdDirection = direction;
        control.dataset.cszdHelper = "CSZD_Send_3000H_JJHCS";
        control.dataset.cszdIndex = String(helperIndex);
      } else {
        control.className = "cszd3000h-recv-value";
        control.dataset.cszdDirection = direction;
        control.dataset.cszdHelper = "CSZD_Recv_3000H";
        control.dataset.cszdIndex = String(helperIndex);
        control.textContent = "0";
      }
      cell.appendChild(control);
      row.appendChild(cell);
    }
    matrix.appendChild(row);
  }
  return matrix;
}

function renderCSZD3000HProjectTable() {
  const container = document.getElementById("cszd3000h-project-table-container");
  if (!container) return;

  container.replaceChildren();
  const fieldIndexRef = { value: 0 };

  const appendHeader = (table) => {
    const header = document.createElement("thead");
    const row = document.createElement("tr");
    ["装订项目", "装订参数", "下传参数"].forEach((text) => {
      const cell = document.createElement("th");
      cell.textContent = text;
      row.appendChild(cell);
    });
    header.appendChild(row);
    table.appendChild(header);
  };

  const createProjectRow = (project) => {
    const row = document.createElement("tr");
    row.className = "cszd3000h-project-row";

    const projectCell = document.createElement("td");
    projectCell.className = "cszd3000h-project-column";
    const projectLabel = document.createElement("label");
    projectLabel.className = "cszd3000h-project-label";
    projectLabel.title = project.label;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = project.checkboxId;
    projectLabel.append(checkbox, document.createTextNode(project.label));
    projectCell.appendChild(projectLabel);

    const sendCell = document.createElement("td");
    sendCell.className = "cszd3000h-send-column";
    sendCell.appendChild(
      createCSZD3000HFieldList(project.fields, "send", fieldIndexRef),
    );

    const recvCell = document.createElement("td");
    recvCell.className = "cszd3000h-recv-column";
    recvCell.appendChild(
      createCSZD3000HFieldList(project.fields, "recv", fieldIndexRef),
    );

    row.append(projectCell, sendCell, recvCell);
    return row;
  };

  const distributeProjects = (projects, laneCount) => {
    const lanes = Array.from({ length: laneCount }, () => ({
      weight: 0,
      projects: [],
    }));
    projects
      .map((project, order) => ({ project, order }))
      .sort(
        (a, b) =>
          (b.project.fields?.length ?? 1) -
          (a.project.fields?.length ?? 1),
      )
      .forEach(({ project, order }) => {
        const lane = lanes.reduce((best, current) =>
          current.weight < best.weight ? current : best,
        );
        lane.projects.push({ project, order });
        lane.weight += Math.max(1, project.fields?.length ?? 1);
      });
    lanes.forEach((lane) => {
      lane.projects.sort((a, b) => a.order - b.order);
      lane.projects = lane.projects.map(({ project }) => project);
    });
    return lanes;
  };

  const createSection = (flag, title, laneCount) => {
    const section = document.createElement("section");
    section.className = `cszd3000h-project-section cszd3000h-flag-${flag}`;
    const titleNode = document.createElement("div");
    titleNode.className = "cszd3000h-section-title";
    titleNode.textContent = title;
    section.appendChild(titleNode);

    const lanesWrapper = document.createElement("div");
    lanesWrapper.className = "cszd3000h-table-lanes";
    lanesWrapper.style.setProperty("--cszd-lane-count", String(laneCount));
    const projects = CSZD3000H_PROJECTS.filter(
      (project) => project.flag === flag && !project.matrix,
    );
    distributeProjects(projects, laneCount).forEach((lane) => {
      const table = document.createElement("table");
      table.className = "cszd3000h-lane-table";
      appendHeader(table);
      const body = document.createElement("tbody");
      lane.projects.forEach((project) => {
        body.appendChild(createProjectRow(project));
      });
      table.appendChild(body);
      lanesWrapper.appendChild(table);
    });
    section.appendChild(lanesWrapper);
    return section;
  };

  container.appendChild(createSection(0, "参数有效标志0项目", 2));
  container.appendChild(createSection(1, "参数有效标志1项目", 4));

  const matrixProject = CSZD3000H_PROJECTS.find((project) => project.matrix);
  if (matrixProject) {
    const matrixSection = document.createElement("section");
    matrixSection.className = "cszd3000h-matrix-section";
    const matrixTitle = document.createElement("div");
    matrixTitle.className = "cszd3000h-section-title";
    matrixTitle.textContent = "卷积核项目";
    matrixSection.appendChild(matrixTitle);

    const matrixTable = document.createElement("table");
    matrixTable.className = "cszd3000h-lane-table cszd3000h-matrix-table";
    appendHeader(matrixTable);
    const matrixBody = document.createElement("tbody");
    const matrixRow = document.createElement("tr");
    matrixRow.className = "cszd3000h-project-row";
    const projectCell = document.createElement("td");
    projectCell.className = "cszd3000h-project-column";
    const projectLabel = document.createElement("label");
    projectLabel.className = "cszd3000h-project-label";
    projectLabel.title = matrixProject.label;
    const checkbox = document.createElement("input");
    checkbox.type = "checkbox";
    checkbox.id = matrixProject.checkboxId;
    projectLabel.append(checkbox, document.createTextNode(matrixProject.label));
    projectCell.append(projectLabel);

    const sendCell = document.createElement("td");
    sendCell.className = "cszd3000h-send-column";
    sendCell.appendChild(createCSZD3000HMatrix("send"));
    const recvCell = document.createElement("td");
    recvCell.className = "cszd3000h-recv-column";
    recvCell.appendChild(createCSZD3000HMatrix("recv"));
    matrixRow.append(projectCell, sendCell, recvCell);
    matrixBody.appendChild(matrixRow);
    matrixTable.appendChild(matrixBody);
    matrixSection.appendChild(matrixTable);
    container.appendChild(matrixSection);
  }
}

function setCSZD3000HSendFieldValue(fieldName, value) {
  document
    .querySelectorAll('[data-cszd-direction="send"][data-cszd-field]')
    .forEach((control) => {
      if (control.dataset.cszdField !== fieldName) return;
      if (fieldName === CSZD3000H_FIELDS.laserAmplifierGain) {
        const gainIndex = Number(value);
        const gainLabels = ["1", "0.8", "0.6", "0.4"];
        control.value = Number.isFinite(gainIndex)
          ? `${gainIndex}:${gainLabels[gainIndex] ?? "1"}倍`
          : "0:1倍";
      } else {
        control.value = value;
      }
    });
}

function parseCSZD3000HValueMap(csvText) {
  const values = new Map();
  csvText
    .trim()
    .split(/\r?\n/)
    .forEach((line) => {
      const columns = line.split(",");
      for (let col = 0; col + 1 < columns.length; col += 2) {
        const name = columns[col]?.trim();
        const value = columns[col + 1]?.trim();
        if (name && value !== undefined) values.set(name, value);
      }
    });
  return values;
}

async function loadCSZD3000HSendDefaults() {
  try {
    const [mainResponse, matrixResponse] = await Promise.all([
      fetch("./csv/CSZD_Send_3000H.csv"),
      fetch("./csv/CSZD_Send_3000H_JJHCS.csv"),
    ]);
    if (!mainResponse.ok || !matrixResponse.ok) return;

    const mainValues = parseCSZD3000HValueMap(await mainResponse.text());
    mainValues.forEach((value, fieldName) => {
      setCSZD3000HSendFieldValue(fieldName, value);
    });

    const matrixValues = (await matrixResponse.text())
      .trim()
      .split(/\r?\n/)
      .flatMap((line) => line.split(",").slice(1).map((value) => value.trim()));
    document
      .querySelectorAll(
        '[data-cszd-direction="send"][data-cszd-helper="CSZD_Send_3000H_JJHCS"]',
      )
      .forEach((control, index) => {
        if (matrixValues[index] !== undefined) control.value = matrixValues[index];
      });
  } catch (error) {
    console.warn("[CSZD3000H] 装订参数默认值加载失败：", error);
  }
}

function syncCSZD3000HFormToHelpers(helper, matrixHelper) {
  const specialFields = new Set([
    CSZD3000H_FIELDS.laserBlindZone,
    CSZD3000H_FIELDS.laserAmplifierGain,
    CSZD3000H_FIELDS.aimingPointMode,
    CSZD3000H_FIELDS.trackingEntryMode,
  ]);
  let success = true;

  document
    .querySelectorAll('[data-cszd-direction="send"][data-cszd-field]')
    .forEach((control) => {
      const fieldName = control.dataset.cszdField;
      if (specialFields.has(fieldName) || control.value.trim() === "") return;
      if (!helper.setValueByName(fieldName, control.value)) success = false;
    });

  document
    .querySelectorAll(
      '[data-cszd-direction="send"][data-cszd-helper="CSZD_Send_3000H_JJHCS"]',
    )
    .forEach((control) => {
      if (control.value.trim() === "") return;
      if (!matrixHelper.setValue(Number(control.dataset.cszdIndex), control.value)) {
        success = false;
      }
    });
  return success;
}

function renderCSZD3000HFormFromHelper(helper, matrixHelper) {
  document
    .querySelectorAll('[data-cszd-direction="recv"][data-cszd-field]')
    .forEach((control) => {
      const value = helper.getValueByName(control.dataset.cszdField);
      if (value !== "ERR") control.textContent = value;
    });

  document
    .querySelectorAll(
      '[data-cszd-direction="recv"][data-cszd-helper="CSZD_Recv_3000H"]',
    )
    .forEach((control) => {
      control.textContent = matrixHelper.getValue(
        Number(control.dataset.cszdIndex),
      );
    });
}

function initializeCSZD3000HTable() {
  renderCSZD3000HProjectTable();
  setupCSZD3000HSelectAllCheckboxes();
  void loadCSZD3000HSendDefaults();

  document
    .getElementById("pushbutton_CSZD_Send_3000H")
    ?.addEventListener("click", () => {
      console.log("参数装订3000H");
      loadCommand_CSZD_3000H();
    });
  document
    .getElementById("pushbutton_CSZD_3000H_GenerateDat")
    ?.addEventListener("click", () => {
      console.log("generate CSZD 3000H dat");
      generateCSZD3000HDat();
    });
  document
    .getElementById("pushbutton_CSZD_Send_4000H")
    ?.addEventListener("click", () => {
      console.log("参数装订下传4000H");
      loadCommand_CSZD_4000H();
    });
}

function editableCells_SJCJ_F000H_Send() {
  // 返回可编辑单元格的{row, col}对象数组
  // 所有数据单元格（第二列）都可编辑
  const cells = [];
  for (let i = 0; i < 31; i++) {
    cells.push({ row: i, col: 1 });
  }
  return cells;
}

//参数装订 0100H
const loadCommand_CSZD = () => {
  const helper = PacketManager.get("CSZD");
  if (!helper) {
    console.error("CSZD helper 未初始化");
    return;
  }

  helper.updateAllFromTable("tableWidget_CSZD");

  const gzmsMap = {
    "00H 默认模式": 0x00,
    "11H 红外独立制导": 0x11,
    "22H 激光独立制导": 0x22,
    "33H 复合制导": 0x33,
  };
  const gzms = document.getElementById("comboBox_GZMS")?.value || "默认模式";
  helper.setValue(1, gzmsMap[gzms] ?? 0x00);

  const mblxMap = {
    "00H: 未知": 0x00,
    "11H: 飞机": 0x11,
    "22H: 地空导弹": 0x22,
    "33H: 空空导弹": 0x33,
    "44H: 巡航导弹": 0x44,
  };
  const mblx = document.getElementById("comboBox_MBLX")?.value || "未知";
  helper.setValue(2, mblxMap[mblx] ?? 0x00);

  const cjbsMap = {
    "00H: 未知": 0x00,
    "11H：天空": 0x11,
    "22H：地物": 0x22,
    "33H：海面": 0x33,
    "44H：临边（天空+地物）": 0x44,
    "55H：海空": 0x55,
    "66H：地海": 0x66,
  };
  const cjbs = document.getElementById("comboBox_CJBS")?.value || "未知";
  helper.setValue(3, cjbsMap[cjbs] ?? 0x00);

  // ==================== 特殊处理：状态字====================
  let ztzLow = 0;
  if (document.getElementById("radioButton_YJ")?.checked) ztzLow |= 0b11;
  if (document.getElementById("radioButton_YQF")?.checked) ztzLow |= 0b1100;
  if (document.getElementById("radioButton_GR")?.checked) ztzLow |= 0b110000;
  if (document.getElementById("radioButton_ZHL")?.checked) ztzLow |= 0b01000000;
  if (document.getElementById("radioButton_YHL")?.checked) ztzLow |= 0b10000000;

  let ztzHigh = 0;
  if (document.getElementById("radioButton_YG")?.checked) ztzHigh |= 0b01;
  if (document.getElementById("radioButton_WZ")?.checked) ztzHigh |= 0b10;

  helper.setValue(6, ztzLow | (ztzHigh << 8));

  //处理激光放大器增益
  const LaserAmplifierGainMap = {
    "0 1倍": 0,
    "1 0.8倍": 1,
    "2 0.6倍": 2,
    "3 0.4倍": 3,
  };
  const LaserAmplifierGain =
    document.getElementById("comboBox_LaserAmplifierGain")?.value || "0 1倍";
  helper.setValue(10, LaserAmplifierGainMap[LaserAmplifierGain] ?? 0);

  // ==================== 组装发送包 ====================
  // 包头 (固定 16 字节)
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x2c;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x01;

  // 直接从 Helper 获取完整的二进制数据
  const payload = helper.getBufferForSend();
  sendBuffer.set(payload, 16);

  const totalLength = 16 + payload.length;
  const packet = sendBuffer.subarray(0, totalLength);

  console.log("参数装订 - 发送数据包:");
  console.log("   总长度:", totalLength, "字节");
  console.log(
    "   包头:",
    Array.from(packet.subarray(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" "),
  );
  console.log(
    "   载荷:",
    Array.from(payload.subarray(0, 20))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ") + "...",
  );

  statusBar.sendMessage("参数装订", "0100H");

  //直接发送 Uint8Array
  wsClient.sendUdp(packet);

  console.log("已发送参数装订命令");
};

export const handle_CSZD_Recv_0100H = (data) => {
  console.log("[DataHandler] 参数装订应答");
  statusBar.receiveMessage("参数装订应答", "0100H");

  if (!data || data.length < 1) {
    console.error("应答数据为空");
    return;
  }

  const result = data[0];

  if (result === 0x0f) {
    console.log("  装订成功");
    statusBar.successMessage("参数装订成功");
  } else {
    console.warn("  装订失败, code:", result.toString(16));
  }
};

//目标控制参数装订下传 0200H
const loadCommand_MBKZ = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x02; //0200H
  sendBuffer[16] = 0x55;
  wsClient.sendUdp(sendBuffer);
  console.log("已发送目标控制参数装订下传命令");
  statusBar.sendMessage("目标控制参数装订下传", "0200H");
};

/**
 *
 * @param {Uint8Array} data 目标控制参数装订下传应答0200H
 * @returns
 */
export const handle_CSZD_Recv_0200H = (data) => {
  console.log("[DataHandler] 目标控制参数装订下传应答");
  statusBar.receiveMessage("目标控制参数装订下传应答", "0200H");

  if (!data || data.length < 44) {
    console.error("应答数据长度不足，实际:", data?.length);
    statusBar.errorMessage("参数装订下传数据长度不足");
    return;
  }

  const helper = PacketManager.get("CSZD_Recv");
  if (!helper) {
    console.error("CSZD_Recv helper 未初始化");
    statusBar.errorMessage("CSZD_Recv helper 未初始化");
    return;
  }

  helper.loadBufferFromNet(data);
  console.log("已加载数据到内存");

  updateCSZDRecvSpecialFields(data, helper);
  updateCSZDRecvFromHelper(helper);
};

/**
 * 从 Helper 更新接收表格（使用正确的索引-行号映射）
 */
function updateCSZDRecvFromHelper(helper) {
  // 需要跳过的索引（特殊处理的字段）
  const skipIndexes = new Set([
    1,
    2,
    3, // 工作模式、目标类型、场景标识（枚举值）
    6, // 状态字（已在 tableWidget_2 中显示）
    9,
    10, // RES 类型
    11, // 激光比较电平阈值（需要缩放）
  ]);

  helper.metaData.forEach((item, index) => {
    // 跳过特殊字段和 RES 类型
    if (skipIndexes.has(index)) return;
    if (item.type === "RES" || item.type === "NOTUSE") return;

    const value = helper.getValue(index);
    if (value !== null && value !== undefined && value !== "") {
      Utils.setTableCellText(
        "tableWidget_CSZD_Recv",
        item.row,
        item.col,
        value,
      );
    }
  });

  console.log("已更新数值字段到接收表格");
}

/**
 * 更新接收表格的特殊字段（枚举值映射为文本）
 * @param {Uint8Array} data - 原始数据
 * @param {BinaryTableHelper} helper - Helper 实例
 */
function updateCSZDRecvSpecialFields(data, helper) {
  const gzmsValue = data[0];
  const gzmsText =
    {
      0x00: "00H 默认模式",
      0x11: "11H 红外独立制导",
      0x22: "22H 激光独立制导",
      0x33: "33H 复合制导",
    }[gzmsValue] || `N/A (0x${gzmsValue.toString(16)})`;

  Utils.setTableCellText("tableWidget_CSZD_Recv", 0, 1, gzmsText);

  const textEdit_GZMS = document.getElementById("textEdit_GZMS");
  if (textEdit_GZMS) textEdit_GZMS.value = gzmsText;

  const mblxValue = data[1];
  const mblxText =
    {
      0x00: "00H 未知",
      0x11: "11H 飞机",
      0x22: "22H 地空导弹",
      0x33: "33H 空空导弹",
      0x44: "44H 巡航导弹",
    }[mblxValue] || `N/A (0x${mblxValue.toString(16)})`;

  Utils.setTableCellText("tableWidget_CSZD_Recv", 1, 1, mblxText);

  const textEdit_DJMBLX = document.getElementById("textEdit_DJMBLX");
  if (textEdit_DJMBLX) textEdit_DJMBLX.value = mblxText;

  const cjbsValue = data[2];
  const cjbsText =
    {
      0x00: "00H 未知",
      0x11: "11H 天空",
      0x22: "22H 地物",
      0x33: "33H 海面",
      0x44: "44H 临边（天空+地物）",
      0x55: "55H 海空",
      0x66: "66H 地海",
    }[cjbsValue] || `N/A (0x${cjbsValue.toString(16)})`;

  Utils.setTableCellText("tableWidget_CSZD_Recv", 2, 1, cjbsText);

  const textEdit_HWCJBS = document.getElementById("textEdit_HWCJBS");
  if (textEdit_HWCJBS) textEdit_HWCJBS.value = cjbsText;

  const ztzLow = data[6]; // 低字节
  const ztzHigh = data[7]; // 高字节
  const ztz = (ztzHigh << 8) | ztzLow;

  Utils.setTableCellText(
    "tableWidget_CSZD_Recv",
    5,
    1,
    `0x${ztz.toString(16).padStart(4, "0").toUpperCase()}`,
  );

  const table2 = document.getElementById("tableWidget_2");
  if (!table2) {
    console.warn("tableWidget_2 未找到");
    return;
  }

  const yjjbs = ztzLow & 0b11;
  const yjjText = yjjbs === 0b00 ? "近界" : yjjbs === 0b11 ? "远界" : "N/A";
  Utils.setTableCellText("tableWidget_2", 0, 1, yjjText);

  const ywqf = (ztzLow >> 2) & 0b11;
  const qfText = ywqf === 0b00 ? "无前发" : ywqf === 0b11 ? "有前发" : "N/A";
  Utils.setTableCellText("tableWidget_2", 1, 1, qfText);

  const ywgr = (ztzLow >> 4) & 0b11;
  const grText = ywgr === 0b00 ? "无干扰" : ywgr === 0b11 ? "有干扰" : "N/A";
  Utils.setTableCellText("tableWidget_2", 2, 1, grText);

  const hl = (ztzLow >> 6) & 0b11;
  const hlText =
    hl === 0b00
      ? "零航路"
      : hl === 0b01
        ? "左航路"
        : hl === 0b10
          ? "右航路"
          : "N/A";
  Utils.setTableCellText("tableWidget_2", 3, 1, hlText);

  const ygwz = ztzHigh & 0b11;
  const ygwzText =
    ygwz === 0b00
      ? "未知"
      : ygwz === 0b01
        ? "迎攻"
        : ygwz === 0b10
          ? "尾追"
          : "N/A";
  Utils.setTableCellText("tableWidget_2", 4, 1, ygwzText);

  const gainValue = data[14];
  const gainText =
    {
      0: "1倍",
      1: "0.8倍",
      2: "0.6倍",
      3: "0.4倍",
    }[gainValue] || `N/A (${gainValue})`;

  Utils.setTableCellText("tableWidget_CSZD_Recv", 9, 1, gainText);

  const gyRaw = data[12] | (data[13] << 8);
  const gyValue = gyRaw / 27.3;

  Utils.setTableCellText("tableWidget_CSZD_Recv", 8, 1, gyValue.toFixed(5));

  const thresholdRaw = data[16] | (data[17] << 8);
  const thresholdValue = thresholdRaw / 19859.0909;

  Utils.setTableCellText(
    "tableWidget_CSZD_Recv",
    11,
    1,
    thresholdValue.toFixed(6),
  );

  console.log("特殊字段已更新");
}

//固定参数装订命令0300H
const loadCommand_GDCSZD = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x1c;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x03; //0300H

  const helper = PacketManager.get("GDCSZD_Send");
  if (!helper) {
    console.error("GDCSZD_Send helper 未初始化");
    return;
  }
  helper.updateAllFromTable("tableWidget_GDCSZD");
  const payload = helper.getBufferForSend();
  sendBuffer.set(payload, 16);

  const totalLength = 16 + payload.length;
  const packet = sendBuffer.subarray(0, totalLength);

  console.log("固定参数装订 - 发送数据包:");
  console.log("   总长度:", totalLength, "字节");
  console.log(
    "   包头:",
    Array.from(packet.subarray(0, 16))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" "),
  );
  console.log(
    "   载荷:",
    Array.from(payload.subarray(0, 20))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ") + "...",
  );

  statusBar.sendMessage("固定参数装订", "0300H");
  wsClient.sendUdp(packet);
  console.log("已发送固定参数装订命令");
};

/**
 *
 * @param {Uint8Array} data 固定参数装订应答0300H
 * @returns
 */
export const handle_GDCSZD_Recv_0300H = (data) => {
  console.log("[DataHandler] 固定参数装订应答");

  if (!data || data.length < 1) {
    console.error("应答数据为空");
    return;
  }

  const result = data[0];

  if (result === 0x0f) {
    console.log(" 固定参数装订成功");
    statusBar.successMessage("固定参数装订成功");
  } else {
    console.warn("  装订失败, code:", result.toString(16));
  }
};

//固定参数装订下传0400H
const loadCommand_GDCSZDXC = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x04; //0400H
  sendBuffer[16] = 0x55;
  wsClient.sendUdp(sendBuffer);
  console.log("已发送固定参数装订下传命令");
  statusBar.sendMessage("固定参数装订下传", "0400H");
};
/**
 *
 * @param {Uint8Array} data 固定参数装订下传应答0400H
 * @returns
 */
export const handle_GDCSZDXC_Recv_0400H = (data) => {
  console.log("[DataHandler] 固定参数装订下传应答");
  statusBar.receiveMessage("固定参数装订下传应答", "0400H");

  if (!data || data.length < 30) {
    console.error("应答数据长度不足，实际:", data?.length);
    statusBar.errorMessage("固定参数装订下传数据长度不足");
    return;
  }

  const helper = PacketManager.get("GDCSZD_Recv");
  if (!helper) {
    console.error("GDCSZD_Recv helper 未初始化");
    statusBar.errorMessage("GDCSZD_Recv helper 未初始化");
    return;
  }

  helper.loadBufferFromNet(data);
  console.log("已加载数据到内存");
  helper.updateAllToTable("tableWidget_GDCSZD_Recv");
};

//休眠
const loadCommand_Shut = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x32; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x10; //1000H
  sendBuffer[16] = 0x03;

  const sleep_hongwai=document.getElementById("sleep-hongwai");
  if(sleep_hongwai.value=="红外休眠"){
    sendBuffer[16]|=(0x03);
  }else{
    sendBuffer[16]&=(0xfc);
  }
  const sleep_jg=document.getElementById("sleep-jg");
  if(sleep_jg.value=="激光休眠"){
    sendBuffer[16]|=(0x03<<2);
  }else{
    sendBuffer[16]&=0xf3;
  }
  const sleep_sjl=document.getElementById("sleep-sjl");
  if(sleep_sjl.value=="数据链休眠"){
    sendBuffer[16]|=(0x03<<4);
  }else{
    sendBuffer[16]&=0xc0;
  }
  wsClient.sendUdp(sendBuffer);
  console.log("已发送休眠命令");
  statusBar.sendMessage("休眠", "1000H");
};

/**
 * 休眠应答1000H
 */
export const handle_Shut_0004H = (data) => {
  console.log("休眠应答：", data[0]);
    if (data[0] == 0x03) {
        console.log("[DataHandler] 休眠应答 - 成功");
        statusBar.receiveMessage("休眠应答：红外休眠", "1000H");
    } else if (data[0] == 0x0f) {
        //console.log("休眠应答 - 失败");
        statusBar.receiveMessage("休眠应答：红外，激光休眠", "1000H");
    } else if (data[0] == 0x0c) {
        //console.log("休眠应答 - 失败");
        statusBar.receiveMessage("休眠应答：激光休眠", "1000H");
    } else if (data[0] == 0x3f) {
        //console.log("休眠应答 - 失败");
        statusBar.receiveMessage("休眠应答：红外激光数据链休眠", "1000H");
    }
};

//唤醒
const loadCommand_Wake = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x32; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x20; //2000H
  sendBuffer[16] = 0x03;

  const wake_hongwai=document.getElementById("wake-hongwai");
  if(wake_hongwai.value=="红外唤醒"){
    sendBuffer[16]|=(0x03);
  }/*else{
    sendBuffer[16]&=(0xfc);
  }*/
  const wake_jg=document.getElementById("wake-jg");
  if(wake_jg.value=="激光唤醒"){
    sendBuffer[16]|=(0x03<<2);
  }/*else{
    sendBuffer[16]&=0xf3;
  }*/
  const wake_sjl=document.getElementById("wake-sjl");
  if(wake_sjl.value=="数据链唤醒"){
    sendBuffer[16]|=(0x03<<4);
  }/*else{
    sendBuffer[16]&=0xc0;
  }*/
  wsClient.sendUdp(sendBuffer);
  console.log("已发送唤醒命令");
  statusBar.sendMessage("唤醒", "2000H");
};

/**
 * 唤醒应答 2000H
 */
export const handle_Wake_0001H = (data) => {
  console.log("唤醒应答：", data[0]);
  

    if (data[0] == 0x03) {
        //console.log("[DataHandler] 休眠应答 - 成功");
        statusBar.receiveMessage("唤醒应答：红外唤醒", "2000H");
    } else if (data[0] == 0x0f) {
        //console.log("休眠应答 - 失败");
        statusBar.receiveMessage("唤醒应答红外，激光唤醒", "1000H");
    } else if (data[0] == 0x0c) {
        //console.log("休眠应答 - 失败");
        statusBar.receiveMessage("唤醒应答：激光唤醒", "1000H");
    } else if (data[0] == 0x3f) {
        //console.log("休眠应答 - 失败");
        statusBar.receiveMessage("唤醒应答：红外激光数据链唤醒", "1000H");
    }
};

//软件版本号
const loadCommand_BBH = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x04;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x32; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x20;
  sendBuffer[15] = 0x00; //0020H

  wsClient.sendUdp(sendBuffer);
  console.log("已发送软件版本号查询命令");
  statusBar.sendMessage("软件版本号查询", "0020H");
};

export const handle_BBH_0030H = (data) => {
  console.log("[DataHandler] 收到软件版本号应答");
  console.log("软件版本号应答：", data);
  statusBar.receiveMessage("软件版本号应答", "0020H");

  // 每次12字节 (8字节版本 + 4字节校验) = 72字节
  if (!data || data.length < 72) {
    console.error("软件版本数据长度不足，期望至少 72字节，实际:", data?.length);
    return;
  }

  const tableId = "tableWidget";
  const decoder = new TextDecoder("utf-8");
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);

  for (let i = 0; i < 6; i++) {
    const offset = i * 12;

    // 软件版本 (前 8 字节)
    let versionBytes = data.subarray(offset, offset + 8);

    let versionStr = "";
    const nullIndex = versionBytes.indexOf(0x00);
    if (nullIndex !== -1) {
      versionStr = decoder.decode(versionBytes.subarray(0, nullIndex));
    } else {
      versionStr = decoder.decode(versionBytes);
    }

    // 解析软件校验 (后 4 字节)
    const checksum = view.getUint32(offset + 8, true);
    const checksumStr = checksum.toString(16).toUpperCase();

    let versionStr_row = 0;
    let versionStr_col = 0;
    let checksumStr_row = 0;
        let checksumStr_col = 0;
      if (i == 0) {
          versionStr_row = i;
          versionStr_col = 1;
          checksumStr_row = i + 1;
          checksumStr_col = 1;
      }
    else if (i ==1 ) {
      versionStr_row = 2;
      versionStr_col = 1;
      checksumStr_row = 3;
      checksumStr_col = 1;
    } else if (i == 2) {
      versionStr_row = 4;
      versionStr_col = 1;
      checksumStr_row = 5;
      checksumStr_col = 1;
    } else if (i == 3) {
      versionStr_row = 0;
      versionStr_col = 3;
      checksumStr_row = 1;
      checksumStr_col = 3;
    } else if (i == 4) {
      versionStr_row = 2;
      versionStr_col = 3;
      checksumStr_row = 3;
      checksumStr_col = 3;
    } else if (i == 5) {
      versionStr_row = 4;
      versionStr_col = 3;
      checksumStr_row = 5;
      checksumStr_col = 3;
    }
    Utils.setTableCellText(tableId, versionStr_row, versionStr_col, versionStr);
    Utils.setTableCellText(
      tableId,
      checksumStr_row,
      checksumStr_col,
      checksumStr,
    );

    console.log(`软件版本 ${i + 1}:`, versionStr, `校验: 0x${checksumStr}`);
  }

  console.log("软件版本号已更新");
};

//自检
const loadCommand_SelfTest = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x04;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x32; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x01;
  sendBuffer[15] = 0x00; //0001H

  wsClient.sendUdp(sendBuffer);
  console.log("已发送自检命令");
  statusBar.sendMessage("自检", "0001H");
};

/**
 * 自检命令回复
 */
export const handle_SelfTest_0002H = () => {
  console.log("[DataHandler] 收到自检命令回复");
  statusBar.receiveMessage("自检命令回复", "0001H");
};

//取自检结果0010H
const loadCommand_GetSelfTestResult = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x04;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x32; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x10;
  sendBuffer[15] = 0x00; //0010H

  wsClient.sendUdp(sendBuffer);
  console.log("已发送取自检结果命令");
  statusBar.sendMessage("取自检结果", "0010H");
};
/**
 * 取自检结果回复
 */
export const handle_GetSelfTestResult_0010H = (data) => {
  console.log("[DataHandler] 收到自检结果回复 (0010H)");
  statusBar.receiveMessage("收到自检结果回复", "0010H");

  const lastHexString = Array.from(data)
    .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");
  console.log(lastHexString);

  // 需要至少 10 个字节来解析所有标志位
  if (!data || data.length < 10) {
    console.error("自检结果数据长度不足，实际:", data?.length);
    statusBar.errorMessage("自检数据不足");
    return;
  }

  const tableId = "tableWidget_ZJJG";

  const setStatus = (index, status) => {
    let row, col;
    if (index <= 13) {
      row = index - 1;
      col = 1; // 第 2 列 (索引 1)
    } else {
      row = index - 14;
      col = 3; // 第 4 列 (索引 3)
    }

    Utils.setTableCellText(tableId, row, col, status);
  };

  const checkBit = (data, bitPos, index) => {
    const check = (data >> bitPos) & 1;
    if (check == 0) {
      setStatus(index, "正常");
    } else if (check == 1) {
      setStatus(index, "异常");
    }
  };

  for (let i = 0; i < 3; ++i) {
    if(i==2&&((data[0]>>2)&1)==0){
      setStatus(3, "未到位");
    }else if(i==2&&((data[0]>>2)&1)==1){
      setStatus(3, "到位");
    }else{checkBit(data[0], i, i + 1);}
    
  }
  for (let i = 0; i < 6; ++i) {
    checkBit(data[2], i, i + 5);
  }
  for (let i = 0; i < 2; ++i) {
    checkBit(data[4], i, i + 12);
  }
  for (let i = 0; i < 4; ++i) {
    checkBit(data[6], i, i + 15);
  }
  for (let i = 0; i < 1; ++i) {
    checkBit(data[8], i, i + 20);
  }
  /*
  const get2BitStatus = (val) => {
    if (val === 0x00) return "异常";
    if (val === 0x03) return "正常";
    return "N/A";
  };

  //(按位与结果等于掩码为正常)
  const get1BitStatus = (byteVal, bitMask) => {
    return (byteVal & bitMask) === bitMask ? "正常" : "异常";
  };

  // 红外自检结果
  for (let i = 0; i < 3; i++) {
    const val = (data[0] >> (2 * i)) & 0x03;
    setStatus(i + 1, get2BitStatus(val));
  }

  // 激光自检结果
  setStatus(5, get2BitStatus(data[1] & 0x03));

  // Items 6, 7, 8, 9 (Single bits: bit 2, 3, 4, 5)
  // 对应掩码: 4, 8, 16, 32
  for (let i = 0; i < 4; i++) {
    const mask = 1 << (i + 2); // 相当于 C++ pow(2, i+2)
    setStatus(i + 1 + 5, get1BitStatus(data[1], mask));
  }

  // Item 10 (bits 6-7)
  setStatus(10, get2BitStatus((data[1] >> 6) & 0x03));

  //  伺服自检结果
  for (let i = 0; i < 2; i++) {
    const val = (data[2] >> (2 * i)) & 0x03;
    setStatus(i + 1 + 10, get2BitStatus(val));
  }

  // 一体化信号处理自检结果
  for (let i = 0; i < 4; i++) {
    const val = (data[3] >> (2 * i)) & 0x03;
    setStatus(i + 1 + 13, get2BitStatus(val));
  }

  // Byte 4 对应 Index 18 (bits 0-1)
    setStatus(18, get2BitStatus(data[4] & 0x03));
    */

  console.log("自检结果已更新到表格");
};

//非均匀校正0020H
const loadCommand_FJYJZ = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x70; //7000H
  const combox_JFDWD47 = document.querySelector(".fjyjz-jfdw:checked");
  const comboBox_FJYJZCommand = document.querySelector(".fjyjz-cmd:checked");
  // 从选中的 checkbox 的 value 属性读取对应十六进制值
  const value_FJYJZ_D47 = combox_JFDWD47 ? parseInt(combox_JFDWD47.value, 16) : 0x00;
  const value_FJYJZ_cmd = comboBox_FJYJZCommand ? parseInt(comboBox_FJYJZCommand.value, 16) : 0x01;
  // 两点校正烧写命令警告
  if (value_FJYJZ_cmd >= 0x10) {
    statusBar.receiveMessage("Warning！!!!两点校正烧写中，请暂停任何操作10秒！");
  }
  // 关键：将命令值与积分档位进行位或运算
  console.log("value_FJYJZ_D47:::", value_FJYJZ_D47);
  const value_FJYJZ = value_FJYJZ_cmd | (value_FJYJZ_D47 << 6);
  sendBuffer[16] = value_FJYJZ & 0xff;
  wsClient.sendUdp(sendBuffer);

  console.log("已发送非均匀校正命令");
  statusBar.sendMessage("非均匀校正", "7000H");
};

/**
 * 非均匀校正应答7000H
 */
export const handle_FJYJZ_Recv_0020H = (data) => {
  console.log("[DataHandler] 非均匀校正应答");
  if (data[0] == 0x0f) {
    console.log("非均匀应答：正常");
    statusBar.receiveMessage("非均匀应答：正常", "7000H");
  } else {
    console.log("非均匀应答：正常");
    statusBar.receiveMessage("非均匀应答：故障", "7000H");
  }
};

//激光参数装订0500H
const JGCSZD_TABLE_ID = "tableWidget_JGCSZD";
const JGCSZD_PIXEL_COUNT = 36;
const JGCSZD_SLOPE_COL = 1;
const JGCSZD_OFFSET_COL = 3;
const JGCSZD_STATUS_COL = 5;

function setJGCSZDStatus(message) {
  const statusEl = document.getElementById("textBrowser_JGCSZD");
  if (statusEl) statusEl.textContent = message;
}

function parseJGCSZDNumber(value) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (value && typeof value === "object") {
    if ("result" in value) return parseJGCSZDNumber(value.result);
    if ("text" in value) return parseJGCSZDNumber(value.text);
    if (Array.isArray(value.richText)) {
      return parseJGCSZDNumber(value.richText.map((item) => item.text ?? "").join(""));
    }
  }
  const text = String(value ?? "").trim();
  if (text === "") return null;
  const num = Number(text);
  return Number.isFinite(num) ? num : null;
}

function parseJGCSZDDelimitedRows(text) {
  return text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.split(/[,\t]/));
}

function normalizeJGCSZDRows(rawRows) {
  const rows = [];
  for (const row of rawRows) {
    if (!row || row.length < 2) continue;
    const slope = parseJGCSZDNumber(row[0]);
    const offset = parseJGCSZDNumber(row[1]);
    if (slope === null || offset === null) continue;
    rows.push([slope, offset]);
    if (rows.length >= JGCSZD_PIXEL_COUNT) break;
  }
  return rows;
}

function chooseJGCSZDFile() {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv";
    input.style.display = "none";
    input.addEventListener("change", () => resolve(input.files?.[0] ?? null), { once: true });
    input.addEventListener("cancel", () => resolve(null), { once: true });
    document.body.appendChild(input);
    input.click();
    setTimeout(() => {
      try {
        document.body.removeChild(input);
      } catch (_) {}
    }, 10000);
  });
}

async function readJGCSZDWorkbookRows(file) {
  const ext = file.name.split(".").pop()?.toLowerCase();
  if (ext === "csv") {
    const text = await file.text();
    return normalizeJGCSZDRows(parseJGCSZDDelimitedRows(text));
  }

  const Excel = globalThis.ExcelJS;
  if (!Excel) {
    throw new Error("ExcelJS 未加载，无法读取 Excel 文件");
  }

  const wb = new Excel.Workbook();
  await wb.xlsx.load(await file.arrayBuffer());
  const ws = wb.worksheets[0];
  if (!ws) return [];

  const rawRows = [];
  ws.eachRow((row) => {
    rawRows.push([row.getCell(1).value, row.getCell(2).value]);
  });
  return normalizeJGCSZDRows(rawRows);
}

async function loadJGCSZDExcelToTable() {
  try {
    const file = await chooseJGCSZDFile();
    if (!file) return;

    const rows = await readJGCSZDWorkbookRows(file);
    if (rows.length === 0) {
      setJGCSZDStatus("未读取到有效的激光参数装订数据");
      return;
    }

    for (let i = 0; i < rows.length; i++) {
      Utils.setTableCellText(JGCSZD_TABLE_ID, i, JGCSZD_SLOPE_COL, rows[i][0]);
      Utils.setTableCellText(JGCSZD_TABLE_ID, i, JGCSZD_OFFSET_COL, rows[i][1]);
    }
    setJGCSZDStatus(`已加载 ${rows.length} 行激光参数装订数据: ${file.name}`);
  } catch (err) {
    console.error("[JGCSZD] 加载 Excel 失败:", err);
    setJGCSZDStatus(`加载激光参数装订失败: ${err.message}`);
  }
}

function getJGCSZDTableRows() {
  const rows = [];
  for (let i = 0; i < JGCSZD_PIXEL_COUNT; i++) {
    const slope = parseJGCSZDNumber(Utils.getTableCellText(JGCSZD_TABLE_ID, i, JGCSZD_SLOPE_COL));
    const offset = parseJGCSZDNumber(Utils.getTableCellText(JGCSZD_TABLE_ID, i, JGCSZD_OFFSET_COL));
    rows.push([slope ?? 0, offset ?? 0]);
  }
  return rows;
}

async function writeJGCSZDWorkbook(rows) {
  const Excel = globalThis.ExcelJS;
  if (!Excel) {
    throw new Error("ExcelJS 未加载，无法保存 Excel 文件");
  }

  const wb = new Excel.Workbook();
  const ws = wb.addWorksheet("JGCSZD");
  ws.columns = [{ width: 18 }, { width: 18 }];
  for (const row of rows) ws.addRow(row);
  return await wb.xlsx.writeBuffer();
}

async function saveJGCSZDTableToExcel() {
  try {
    const rows = getJGCSZDTableRows();
    const buffer = await writeJGCSZDWorkbook(rows);
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const filename = "JGCSZD_Params.xlsx";

    if (typeof window.showSaveFilePicker === "function") {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName: filename,
          types: [
            {
              description: "Excel 文件",
              accept: { "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"] },
            },
          ],
        });
        const writable = await handle.createWritable();
        await writable.write(blob);
        await writable.close();
        setJGCSZDStatus(`已保存 ${rows.length} 行激光参数装订数据`);
        return;
      } catch (err) {
        if (err.name === "AbortError") return;
        console.warn("[JGCSZD] showSaveFilePicker 失败，降级为下载:", err);
      }
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      document.body.removeChild(a);
    }, 1000);
    setJGCSZDStatus(`已导出 ${rows.length} 行激光参数装订数据`);
  } catch (err) {
    console.error("[JGCSZD] 保存 Excel 失败:", err);
    setJGCSZDStatus(`保存激光参数装订失败: ${err.message}`);
  }
}

const loadCommand_JGCSZD = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;

  sendBuffer[6] = 0x99;
  sendBuffer[7] = 0x00;
  // 保留位
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;

  sendBuffer[12] = 0x54;
  sendBuffer[13] = 0x52;
  // 5000H
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x50;

  // (144字节 = 36像素 * (2字节斜率 + 2字节常量))
  const helper = PacketManager.get("JGCSZD_Send");
  if (!helper) {
    console.error("JGCSZD_Send helper 未初始化");
    return;
  }

  helper.updateAllFromTable(JGCSZD_TABLE_ID);

  //const calibData = new Uint8Array(helper.buffer);
  //sendBuffer.set(calibData.subarray(0, 144), 16);

  const payload = helper.getBufferForSend();
  sendBuffer.set(payload, 16);

  let pixelStatus = new Uint8Array(5).fill(0);

  // DataView 用于操作 sendBuffer 中的数值 (置 0 操作)
  let view = new DataView(sendBuffer.buffer);

  for (let i = 0; i < JGCSZD_PIXEL_COUNT; i++) {
    const statusText = Utils.getTableCellText(JGCSZD_TABLE_ID, i, JGCSZD_STATUS_COL);
    const isNormal = statusText.trim() === "1";

    // 定位位操作 (byte_index = i/8, bit_index = 7 - i%8)
    const byteIndex = Math.floor(i / 8);
    const bitIndex = 7 - (i % 8);

    if (isNormal) {
      // 正常：置位
      pixelStatus[byteIndex] |= 1 << bitIndex;
    } else {
      // 异常：位保持 0 (因为初始化是0)

      // 强行将对应的斜率和常量置为 0
      // 内存偏移 = 16 + i * 4
      const offset = 16 + i * 4;

      // 斜率 (2字节) 设为 0
      view.setInt16(offset, 0, true);
      // 常量 (2字节) 设为 0
      view.setInt16(offset + 2, 0, true);
    }
  }

  //5 字节状态追加到数据末尾
  sendBuffer.set(pixelStatus, 16 + 144);

  console.log("激光参数装订 - 发送数据包:");
  console.log(`   总长度: ${sendBuffer.length} 字节`);
  console.log(
    `   状态字(Hex): ${Array.from(pixelStatus)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ")}`,
  );

  wsClient.sendUdp(sendBuffer);
  statusBar.sendMessage("激光参数装订", "0500H");
};
/**
 * 激光参数装订应答5000H
 */
export const handle_JGCSZD_Recv_0500H = (data) => {
  console.log("[DataHandler] 激光参数装订应答");
  if (data[0] == 0x0f) {
    console.log("激光参数装订 正常");
    statusBar.receiveMessage("激光参数装订：正常", "5000H");
  } else {
    console.log("激光参数装订 故障");
    statusBar.receiveMessage("激光参数装订：故障", "5000H");
  }
};

const loadCommand_JGCSZDXC = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;

  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  // 保留位
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;

  sendBuffer[12] = 0x54;
  sendBuffer[13] = 0x52;
  // 0500H
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x60; //6000H

  sendBuffer[16] = 0x55;
  wsClient.sendUdp(sendBuffer);
  console.log("已发送激光参数装订下传命令");
  statusBar.sendMessage("激光参数装订下传", "6000H");
};

/**
 * 激光参数装订下传应答
 */
export const handle_JGCSZDXC_Recv_0600H = (data) => {
  console.log("[DataHandler] 激光参数装订下传应答");
  statusBar.receiveMessage("激光参数装订下传应答", "6000H");

  if (!data || data.length < 10) {
    console.error("激光参数装订下传数据长度不足，实际:", data?.length);
    return;
  }

  const helper = PacketManager.get("JGCSZDXC_Recv");
  if (!helper) {
    console.error("JGCSZDXC_Recv helper 未初始化");
    statusBar.errorMessage("JGCSZDXC_Recv helper 未初始化");
    return;
  }

  helper.loadBufferFromNet(data);
  console.log("已加载数据到内存");
  helper.updateAllToTable("tableWidget_JGXC");
};

const loadCommand_IRDetectParam = () => {
  const helper = PacketManager.get("IRDetectParam_Send");
  if (!helper) {
    console.error("IRDetectParam_Send helper 未初始化");
    return;
  }

  // 1. 将界面上的数据更新到 Helper 的内存 Buffer 中
  helper.updateAllFromTable("tableWidget_IRDetect_Send");

  // 2. 准备协议头
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  // 帧长度 0x90 = 144字节
  sendBuffer[6] = 0x90;
  sendBuffer[7] = 0x00;
  // 保留位
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  // 指令
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x07; // 0700H

  // 3. 处理 ValidFlag (参数有效标志)
  // C++: this->m_Table_IRDetect_Send->readDataIndex((uchar*)&validFlag, 1);
  // 假设 _loc.csv 中索引 1 定义为 ValidFlag (UINT16)

  // 将 validFlag 写入发送缓冲区的 16 字节处
  helper.copyTo(sendBuffer, 16, 1, 1);

  // 获取 ValidFlag 的数值用于逻辑判断
  // 我们直接读取 sendBuffer 中的值，或者用 helper getUint16
  const validFlag = sendBuffer[16] | (sendBuffer[17] << 8);

  // 4. 根据标志位拷贝数据
  let offset = 18; // 起始偏移 = Header(16) + ValidFlag(2)

  // 定义参数配置 (参考 C++ IRDetectParamFlag)
  const params = [
    { name: "滤波参数", mask: 0x0001, start: 2, end: 2 },
    { name: "倍数参数", mask: 0x0002, start: 3, end: 3 },
    { name: "形态学参数", mask: 0x0004, start: 4, end: 4 },
    { name: "融合系数", mask: 0x0008, start: 5, end: 7 },
    { name: "分割参数", mask: 0x0010, start: 8, end: 9 },
    { name: "航迹关联", mask: 0x0020, start: 10, end: 18 },
    { name: "置信度参数", mask: 0x0040, start: 19, end: 19 },
    { name: "卷积参数", mask: 0x0080, start: 20, end: 68 },
  ];

  console.log(`[IRDetect] ValidFlag: 0x${validFlag.toString(16)}`);

  params.forEach((p) => {
    if ((validFlag & p.mask) !== 0) {
      const count = p.end - p.start + 1;

      // 使用 Helper 的 buffer 拷贝功能
      helper.copyTo(sendBuffer, offset, p.start, count);

      console.log(`   装订: ${p.name} (Idx: ${p.start}-${p.end})`);

      // 更新偏移: UINT16 * count (每个参数2字节)
      offset += count * 2;
    }
  });

  // 5. 剩余部分补 0 (C++ memset 了整个 buffer，sendBuffer 是重用的，所以需要清零剩余部分)
  // C++ 包总长 16+144 = 160。上面的逻辑只是写入了有效数据，后面的旧数据需要清除吗？
  // C++ 中 memset(ptr, 0, PACKET_TOTAL_LENGTH);
  // 我们这里最好将 offset 到 160 之间的字节清零
  const totalPacketLen = 160;
  if (offset < totalPacketLen) {
    sendBuffer.fill(0, offset, totalPacketLen);
  }

  // 6. 发送
  // 注意：C++ 似乎发送的是固定长度结构体?
  // ptr[6] = 0x90 (144) 指的是数据长度。总包长应该是 16 + 144 = 160。

  const packet = sendBuffer.subarray(0, totalPacketLen);

  wsClient.sendUdp(packet);

  console.log("已发送红外检测参数装订指令 (0700H)");
  statusBar.sendMessage("红外检测参数装订", "0700H");
};
/**
 * 红外检测参数装订应答0700H
 */
export const handle_IRDetectParam_Recv_0700H = (data) => {
  console.log("[DataHandler] 红外检测参数装订应答");
  if (data[0] == 0x0f) {
    console.log("红外检测参数装订 正常");
    statusBar.receiveMessage("红外检测参数装订：正常", "0700H");
  } else {
    console.log("红外检测参数装订 故障");
    statusBar.receiveMessage("红外检测参数装订：故障", "0700H");
  }
};

const loadCommand_IRDetectParamRequest = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;

  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  // 保留位
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;

  sendBuffer[12] = 0x54;
  sendBuffer[13] = 0x52;

  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x08; //0800H

  sendBuffer[16] = 0x55;
  wsClient.sendUdp(sendBuffer);
  console.log("已发送红外检测参数装订下传命令");
  statusBar.sendMessage("红外检测参数装订下传", "0800H");
};
/**
 * 红外检测参数装订下传应答0800H
 */
export const handle_IRDetectParamRequest_Recv_0800H = (data) => {
  console.log("[DataHandler] 红外检测参数装订下传应答");
  statusBar.receiveMessage("红外检测参数装订下传应答", "0800H");

  const helper = PacketManager.get("IRDetectParam_Recv");
  if (!helper) {
    console.error("IRDetectParam_Recv helper 未初始化");
    statusBar.errorMessage("IRDetectParam_Recv helper 未初始化");
    return;
  }

  const validFlag = data[0] | (data[1] << 8);

  console.log(`[IRDetect Recv] ValidFlag: 0x${validFlag.toString(16)}`);

  helper.loadBufferFromNet(data);
  console.log("已加载数据到内存");
  /*
  const params = [
    { name: "滤波参数", mask: 0x0001, start: 2, end: 2 },
    { name: "倍数参数", mask: 0x0002, start: 3, end: 3 },
    { name: "形态学参数", mask: 0x0004, start: 4, end: 4 },
    { name: "融合系数", mask: 0x0008, start: 5, end: 7 },
    { name: "分割参数", mask: 0x0010, start: 8, end: 9 },
    { name: "航迹关联", mask: 0x0020, start: 10, end: 18 },
    { name: "置信度参数", mask: 0x0040, start: 19, end: 19 },
    { name: "卷积参数", mask: 0x0080, start: 20, end: 68 },
  ];

  let offset = 2; // 起始偏移：跳过 ValidFlag (2字节)

  params.forEach((p) => {
    // 判断该位是否有值
    if ((validFlag & p.mask) !== 0) {
      const count = p.end - p.start + 1;

      helper.copyFrom(data, offset, p.start, count);

      console.log(`  接收并更新: ${p.name} (Idx: ${p.start}-${p.end})`);

      // 更新偏移: count * 2 (假设每个参数是 UINT16 / 2字节)
      offset += count * 2;
    }
  });*/

  helper.updateAllToTable("tableWidget_IRDetect_Recv");

  console.log("参数下传完成，已更新到接收表格");
  statusBar.sendMessage("红外参数下传解析完成", "0800H");
};

export const loadCommand_SJCJ = async () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;

  sendBuffer[6] = 0x6c;
  sendBuffer[7] = 0x00;
  // 保留位
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;

  sendBuffer[12] = 0x54;
  sendBuffer[13] = 0x52;

  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x10; //1000H

  // 复制包头到发送缓冲区前16字节
  let sendSJCJBuffer = new Uint8Array(1040);
  sendSJCJBuffer.set(sendBuffer.subarray(0, 16), 0);

  const helper = PacketManager.get("SJCJ_Send");
  helper.updateAllFromTable("tableWidget_SJCJ_Send");

  const payload = helper.getBufferForSend();
  sendSJCJBuffer.set(payload, 16);

  // --- 飞行指令 (ptr[18]) ---
  const cb_FXZL = document.getElementById("checkBox_FXZL");
  sendSJCJBuffer[18] = cb_FXZL?.checked ? 0xff : 0x00;

  // --- 跟踪工作模式 (ptr[19]) ---
  let g_GZMS = 0x00;
  if (document.getElementById("radioButton_initial_state")?.checked)
    g_GZMS = 0x00;
  if (document.getElementById("radioButton_GZYZ")?.checked) g_GZMS = 0x11;
  if (document.getElementById("radioButton_HWYXJH")?.checked) g_GZMS = 0x21;
  if (document.getElementById("radioButton_JGYXJH")?.checked) g_GZMS = 0x22;
  if (document.getElementById("radioButton_HWYDJH")?.checked) g_GZMS = 0x23;
  if (document.getElementById("radioButton_JGYDJH")?.checked) g_GZMS = 0x24;
  if (document.getElementById("radioButton_FHJH")?.checked) g_GZMS = 0x25;
  if (document.getElementById("radioButton_MBSS")?.checked) g_GZMS = 0x12;
  sendSJCJBuffer[19] = g_GZMS;

  // --- 导引头抗干扰信息 (ptr[106], ptr[107]) ---
  let g_DYTKGRD = 0;

  // 辅助函数：获取下拉框索引
  const getComboIndex = (id) => document.getElementById(id)?.selectedIndex ?? 0;

  // bit 0-1
  let temp_dyt0 = getComboIndex("comboBox_DYTKGRD01");
  if (temp_dyt0 > 2) temp_dyt0 = 0; // default 00
  g_DYTKGRD |= temp_dyt0 & 0x03;

  // bit 2-3
  let temp_dyt1 = getComboIndex("comboBox_DYTKGRD23");
  if (temp_dyt1 > 2) temp_dyt1 = 0;
  g_DYTKGRD |= (temp_dyt1 & 0x03) << 2;

  // bit 4-5
  let temp_dyt2 = getComboIndex("comboBox_DYTKGRD45");
  if (temp_dyt2 > 2) temp_dyt2 = 0;
  g_DYTKGRD |= (temp_dyt2 & 0x03) << 4;

  // bit 6-7
  let temp_dyt3 = getComboIndex("comboBox_DYTKGRD67");
  if (temp_dyt3 > 2) temp_dyt3 = 0;
  g_DYTKGRD |= (temp_dyt3 & 0x03) << 6;

  sendSJCJBuffer[106] = g_DYTKGRD & 0xff;
  sendSJCJBuffer[107] = 0x00;

  // --- 红外位控指令 (ptr[108]) ---
  let g_HWWK = 0;
  // C++ 代码中这部分被注释掉了，我们也保留注释或默认 0
  sendSJCJBuffer[108] = g_HWWK;

  // --- 红外搜索模式 (ptr[109]) ---
  const hwSearchModeIndex = getComboIndex("comboBox_HWSearchMode");
  const hwSearchMap = [
    0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa,
  ];
  sendSJCJBuffer[109] = hwSearchMap[hwSearchModeIndex] || 0x00;

  // --- 积分时间控制 (ptr[110]) ---
  // C++: tempIndex + 1 = 110
  if (document.getElementById("checkBox_JFSJKZD7")?.checked) {
    const jfsjIndex = getComboIndex("comboBox_JFSJKZ");
    const jfsjMap = [0x81, 0x82, 0x84, 0x88, 0x90, 0xa0, 0xc0];
    sendSJCJBuffer[110] = jfsjMap[jfsjIndex] || 0x00;
  } else {
    sendSJCJBuffer[110] = 0x00;
  }

  // --- 激光位控 (ptr[116]) ---
  let g_JGWK = 0;
  if (document.getElementById("radioButton_FSJSBKQ")?.checked) g_JGWK = 0x00;
  if (document.getElementById("radioButton_JGFS")?.checked) g_JGWK = 0x11;
  if (document.getElementById("radioButton_JGJS")?.checked) g_JGWK = 0x22;
  if (document.getElementById("radioButton_FSJSZCKQ")?.checked) g_JGWK = 0x33;
  sendSJCJBuffer[116] = g_JGWK;

  // --- 表格索引 43, 44 对应的数据 (ptr[111]..ptr[114]?) ---
  // C++: readDataIndex(&ptr[tempIndex+2], 43, 2) -> ptr[111], count 2 (words?)
  // 这一步 helper.updateAllFromTable 应该已经处理了，只要 helper 的定义没问题
  // C++ 中显式调了一次，可能是为了覆盖之前的逻辑？或者仅仅是按顺序填充
  // 在 JS 中，helper 已经把整个表格数据 map 到底层 buffer 了，如果 43/44 行有数据，就已经在里面了。

  // --- 激光制导/红外制导有效位 (ptr[117]) ---
  // C++: checkBox_YXYB
  sendSJCJBuffer[117] = document.getElementById("checkBox_YXYB")?.checked
    ? 0x11
    : 0x00;

  sendSJCJBuffer[118] = 0x00;
  sendSJCJBuffer[119] = 0x00;

  //console.log("开始数据采集循环发送...");
  while (isSJCJRunning) {
    wsClient.sendUdp(sendSJCJBuffer);
    //statusBar.sendMessage("正在进行数据采集...", "1000H");
    await new Promise((resolve) => {
      resolveAck_SJCJ = resolve;
    });
  }

  //console.log(" 数据采集循环停止");
  statusBar.sendMessage("数据采集停止");
};

/**
 * 数据采集应答010203H
 */
export const handle_SJCJ_Recv_010203H = () => {
  //console.log("[DataHandler] 数据采集应答");
  statusBar.receiveMessage("数据采集应答", "010203H");

  // 解除等待，继续下一次发送
  if (resolveAck_SJCJ) {
    resolveAck_SJCJ();
    resolveAck_SJCJ = null;
  }
};
/**
 * 数据采集应答 1000H 处理函数
 * @param {Uint8Array} data -
 */
export const handle_SJCJ_Recv_1000H = (data) => {
  // ==========================================
  // 1. 更新表格数据 tableWidget_SJCJ_SP
  // ==========================================
  const helper = PacketManager.get("SJCJ_Recv");

  helper.loadBufferFromNet(data);
  helper.updateAllToTable("tableWidget_SJCJ_SP");

  // ==========================================
  // 2. 更新跟踪模式显示 (tableWidget_SJCJ_SP item(2,1) 和 item(3,1))
  // ==========================================
  const trackModeMap = {
    0x00: "00H 红外单模跟踪",
    0x11: "11H 激光单模跟踪",
    0x22: "22H 红外电视复合跟踪",
    0x33: "33H 激光电视复合跟踪",
    0x44: "44H 光轴实际方位角",
  };

  const trackMode = trackModeMap[data[4]] || "N/A";
  Utils.setTableCellText("tableWidget_SJCJ_SP", 2, 1, trackMode);

  // 跟踪信息来源
  const sourceMap = {
    0x00: "00H 关",
    0x11: "11H 红外",
    0x22: "22JG电视",
    0x33: "33H 混合",
    0x44: "44H 电视其他",
    0x55: "55H 激光其他",
  };
  const source = sourceMap[data[5]] || "N/A";
  Utils.setTableCellText("tableWidget_SJCJ_SP", 3, 1, source);

  // ==========================================
  // 3. 更新红外应答状态 (表格 m_Table_HWYD_Recv)
  // ==========================================
  const temp_HWYD = data[65]; // 第65字节为红外应答

  const hwydHelper = PacketManager.get("HWYDZT_Recv");
  Utils.setTableCellText("tableWidget_HWYD", 1, 1, temp_HWYD & 1 ? 1 : 0);
  Utils.setTableCellText("tableWidget_HWYD", 2, 1, temp_HWYD & 2 ? 1 : 0);
  /*Utils.setTableCellText(
    "tableWidget_HWYD",
    3,
    1,
    temp_HWYD & 4 ? "红外初始状态好" : "红外初始状态不好",
  );*/

  Utils.setTableCellText("tableWidget_HWYD", 4, 1, temp_HWYD & 8 ? 1 : 0);
  /*Utils.setTableCellText(
    "tableWidget_HWYD",
    5,
    1,
    temp_HWYD & 16 ? "红外截获好" : "红外截获不好",
  );*/
  /*Utils.setTableCellText(
    "tableWidget_HWYD",
    6,
    1,
    temp_HWYD & 32 ? "红外跟踪好" : "红外跟踪不好",
  );*/
  Utils.setTableCellText("tableWidget_HWYD", 7, 1, temp_HWYD & 64 ? 1 : 0);
  /*Utils.setTableCellText(
    "tableWidget_HWYD",
    8,
    1,
    temp_HWYD & 128 ? " 红外记忆跟踪好" : "红外记忆跟踪不好",
  );*/

  // 更新LED指示灯
  setLEDStatus("label_led_HWCSZT", (temp_HWYD & 4) !== 0);
  setLEDStatus("label_led_HWJH", (temp_HWYD & 16) !== 0);
  setLEDStatus("label_led_HWGZ", (temp_HWYD & 32) !== 0);
  setLEDStatus("label_led_HWJYGZ", (temp_HWYD & 128) !== 0);

  // 第66字节继续红外状态
  const temp_HWYD2 = data[66];
  /*Utils.setTableCellText(
    "tableWidget_HWYD",
    9,
    1,
    temp_HWYD2 & 1 ? "红外丢失目标" : "红外未丢失目标",
  );*/
  setLEDStatus("label_led_HWDSMB", (temp_HWYD2 & 1) !== 0);
  Utils.setTableCellText("tableWidget_HWYD", 10, 1, temp_HWYD2 & 2 ? 1 : 0);
  Utils.setTableCellText("tableWidget_HWYD", 11, 1, temp_HWYD2 & 4 ? 1 : 0);
  // ==========================================
  // 4. 更新激光工作状态 (表格 m_Table_JGGZ_Recv)
  // ==========================================
  const temp_JGGZ = data[87]; // 第87字节为激光工作状态

  const jggzHelper = PacketManager.get("JGGZZT_Recv");
  Utils.setTableCellText("tableWidget_JGGZZT", 1, 1, temp_JGGZ & 1 ? 1 : 0);
  Utils.setTableCellText("tableWidget_JGGZZT", 2, 1, temp_JGGZ & 2 ? 1 : 0);
  /*Utils.setTableCellText(
    "tableWidget_JGGZZT",
    3,
    1,
    temp_JGGZ & 4 ? "     初始状态好" : "     初始状态不好",
  );*/
  Utils.setTableCellText("tableWidget_JGGZZT", 4, 1, temp_JGGZ & 8 ? 1 : 0);
  /*Utils.setTableCellText(
    "tableWidget_JGGZZT",
    5,
    1,
    temp_JGGZ & 16 ? "截获好" : "截获不好",
  );*/
  /*Utils.setTableCellText(
    "tableWidget_JGGZZT",
    6,
    1,
    temp_JGGZ & 32 ? "     激光跟踪好" : "     跟踪不好",
  );*/
  Utils.setTableCellText("tableWidget_JGGZZT", 7, 1, temp_JGGZ & 64 ? 1 : 0);
  /*Utils.setTableCellText(
    "tableWidget_JGGZZT",
    8,
    1,
    temp_JGGZ & 128 ? "     激光记忆跟踪好" : "     激光记忆跟踪不好",
  );*/

  // 更新激光LED指示灯
  setLEDStatus("label_led_JGCSZT", (temp_JGGZ & 4) !== 0);
  setLEDStatus("label_led_JGJH", (temp_JGGZ & 16) !== 0);
  setLEDStatus("label_led_JGGZ", (temp_JGGZ & 32) !== 0);
  setLEDStatus("label_led_JGJYGZ", (temp_JGGZ & 128) !== 0);

  // 第88字节继续激光状态
  const temp_JGGZ2 = data[88];
  /*Utils.setTableCellText(
    "tableWidget_JGGZZT",
    9,
    1,
    temp_JGGZ2 & 1 ? "     激光丢失目标" : "     激光未丢失目标",
  );*/
  setLEDStatus("label_led_JGDSMB", (temp_JGGZ2 & 1) !== 0);
  Utils.setTableCellText("tableWidget_JGGZZT", 10, 1, temp_JGGZ2 & 2 ? 1 : 0);
  Utils.setTableCellText("tableWidget_JGGZZT", 11, 1, temp_JGGZ2 & 4 ? 1 : 0);
  Utils.setTableCellText("tableWidget_JGGZZT", 12, 1, temp_JGGZ2 & 8 ? 1 : 0);
  Utils.setTableCellText("tableWidget_JGGZZT", 13, 1, temp_JGGZ2 & 16 ? 1 : 0);
  Utils.setTableCellText("tableWidget_JGGZZT", 14, 1, temp_JGGZ2 & 32 ? 1 : 0);
  Utils.setTableCellText("tableWidget_JGGZZT", 15, 1, temp_JGGZ2 & 64 ? 1 : 0);
  Utils.setTableCellText("tableWidget_JGGZZT", 15, 1, temp_JGGZ2 & 128 ? 1 : 0);

  // ==========================================
  // 5. 更新稳定/框架状态 (第86字节)
  // ==========================================
  const temp_WKCG = data[86];
  setLEDStatus("label_led_WKZT", (temp_WKCG & 0x0f) === 0x0f);
  setLEDStatus("label_led_CGZT", ((temp_WKCG >> 4) & 0x0f) === 0x0f);

  // ==========================================
  // 6. 更新图表曲线 (已移至 F000H 帧处理)
  // ==========================================
  // updateChart_SJCJ(data);

  // ==========================================
  //  计算并更新目标框位置（绿框）
  // ==========================================
  updateTargetBox(data);

  // ==========================================
  // 提取激光图像数据 (recvData[104-211] = 108字节)
  // ==========================================
  //const laserImgData = data.subarray(104, 212);
  //updateLaserImage(laserImgData);
  // 保存激光图像数据
  // saveLaserImage(laserImgData);

  //statusBar.receiveMessage("数据采集应答", "1000H");

  // ==========================================
  //  解除等待，继续下一次发送
  // ==========================================
  if (resolveAck_SJCJ) {
    resolveAck_SJCJ();
    resolveAck_SJCJ = null;
  }
  triggerSJCJResolve();
};

/**
 * 更新图表曲线
 * @param {Uint8Array} recvData - 接收数据
 */
const updateChart_SJCJ = () => {
  const helper = PacketManager.get("SJCJ_F000H_Recv");
  if (!helper) return;

  const chartFrameCounter = getChartFrameCounter();
  const maxPoints = 500;

  // 曲线配置与 B 帧参数的映射关系
  const curves = [
    { name: "D_FYJ", paramName: "弹体系目标俯仰角", checkBox: "checkBox_D_FYJ" },
    { name: "D_FWJ", paramName: "弹体系目标方位角", checkBox: "checkBox_D_FWJ" },
    { name: "GS_FWJ", paramName: "惯性系目标方位角", checkBox: "checkBox_GS_FWJ" },
    { name: "GS_FYJ", paramName: "惯性系目标俯仰角", checkBox: "checkBox_GS_FYJ" },
    { name: "GX_FYJ", paramName: "光轴指向俯仰角", checkBox: "checkBox_GX_FYJ" },
    { name: "GX_FWJ", paramName: "光轴指向方位角", checkBox: "checkBox_GX_FWJ" },
    { name: "GX_FYJSpeed", paramName: "", checkBox: "checkBox_GX_FYJSpeed" }, // 不在F000H帧中
    { name: "GX_FWJSpeed", paramName: "", checkBox: "checkBox_GX_FWJSpeed" }, // 不在F000H帧中
    { name: "GX_FYJ_AccSpeed", paramName: "", checkBox: "checkBox_GX_FYJ_AccSpeed" }, // 不在F000H帧中
    { name: "GX_FWJ_AccSpeed", paramName: "", checkBox: "checkBox_GX_FWJ_AccSpeed" }, // 不在F000H帧中
    { name: "KFJ_FWJ", paramName: "快反镜方位角", checkBox: "checkBox_KFJ_FWJ" },
    { name: "KFJ_FYJ", paramName: "快反镜俯仰角", checkBox: "checkBox_KFJ_FYJ" },
    { name: "TL_JSpeed", paramName: "", checkBox: "checkBox_TL_JSpeed" }, // 不在F000H帧中
    { name: "TL_FWJSpeed", paramName: "", checkBox: "checkBox_TL_FWJSpeed" }, // 不在F000H帧中
    { name: "TL_FYJSpeed", paramName: "", checkBox: "checkBox_TL_FYJSpeed" }, // 不在F000H帧中
    { name: "HW_FYJ", paramName: "红外光轴系目标俯仰角", checkBox: "checkBox_HW_FYJ" },
    { name: "HW_FWJ", paramName: "红外光轴系目标方位角", checkBox: "checkBox_HW_FWJ" },
    { name: "JG_FYJ", paramName: "激光目标光轴系俯仰角", checkBox: "checkBox_JG_FYJ" },
    { name: "JG_FWJ", paramName: "激光目标光轴系方位角", checkBox: "checkBox_JG_FWJ" },
  ];

  // 更新每条曲线
  for (const curve of curves) {
    let value = 0;
    if (curve.paramName) {
      value = helper.getValue(curve.paramName) || 0;
    }

    // 添加数据点到图表
    addChartDataPoint(curve.name, chartFrameCounter, value, maxPoints);

    // 根据checkbox显示/隐藏曲线
    const isVisible = document.getElementById(curve.checkBox)?.checked ?? false;
    setCurveVisible(curve.name, isVisible);
  }

  // 更新Y轴范围
  updateChartYRange();

  // 递增帧计数器
  incrementChartFrameCounter();
};

/**
 * 更新目标框位置（绿框）
 * @param {Uint8Array} recvData - 接收数据
 */
const updateTargetBox = (recvData) => {
  // 目标方位角和俯仰角
  const view = new DataView(
    recvData.buffer,
    recvData.byteOffset,
    recvData.byteLength,
  );

  const GZXMBFWJ_Temp = view.getInt16(50, true); // 第50-51字节
  const GZXMBFYJ_Temp = view.getInt16(48, true); // 第48-49字节

  const GZXMBFWJ = GZXMBFWJ_Temp * 0.0001;
  const GZXMBFYJ = GZXMBFYJ_Temp * 0.0001;

  // 从固定参数表格获取视场角参数
  const HWFW = -2; // 红外方位
  const HWFY = 2; // 红外俯仰

  const HWFWSCJZ1 = parseFloat(HWFW) || 0;
  const HWFYSCJZ1 = parseFloat(HWFY) || 0;

  // 计算目标框位置（C++ 代码逻辑）
  // temp2 = 64 - (GZXMBFWJ / (HWFWSCJZ1 + 0.000001)) * 128;
  // temp2 = temp2 * 3;
  //let x = 64 - (GZXMBFWJ / (HWFWSCJZ1 + 0.000001)) * 64;
  let x = 64 + (GZXMBFWJ / (HWFYSCJZ1 * 2)) * 128;
  x = x * 3;

  //let y = 64 - (GZXMBFYJ / (HWFYSCJZ1 + 0.000001)) * 64;
  let y = 64 - (GZXMBFYJ / (HWFYSCJZ1 * 2)) * 128;
  y = y * 3;

  x = Math.max(0, x);
  y = Math.max(0, y);

  //  修改：调用 Video.js 的函数设置绿框位置
  setVideoTargetBoxPosition(x, y);
};

// ==========================================
// 辅助函数
// ==========================================

/**
 * 开始保存命令帧
 * 前端只负责发送“开始录制”的信号给后端
 */
const startSavingCMD = () => {
  console.log(" 发送指令：请求后端开始保存文件...");

  // 通过 WebSocket 发送控制指令
  // 这里假设 wsClient.send 只能发 Buffer，我们需要发 JSON 文本
  // 如果 wsClient 封装了 JSON 发送最好，如果没有，可以这样：
  const cmd = JSON.stringify({
    type: "CONTROL_CMD",
    action: "START_SAVE_SJCJ", // 自定义协议：开始保存数据采集
  });

  // 通过 WebSocket 发送给 server.js
  wsClient.sendText(cmd);

  statusBar.sendMessage("正在请求后端录制数据...", "black");
};

const SJCJ_F000H_SAVE_SPECIAL_FIELDS = new Set([24, 25]);

const getSJCJF000HSaveFieldNames = () => {
  const helper = PacketManager.get("SJCJ_F000H_Send");
  const table = document.getElementById("tableWidget_SJCJ_F000H_Send");
  if (!helper) return ["时间"];

  const fieldNames = ["时间"];
  const sortedKeys = Array.from(helper.metaData.keys()).sort((a, b) => a - b);
  for (const key of sortedKeys) {
    const item = helper.metaData.get(key);
    if (!item) continue;

    const isSpecialSavedField = SJCJ_F000H_SAVE_SPECIAL_FIELDS.has(key);
    if (
      (item.type === "RES" || item.type === "NOTUSE") &&
      !isSpecialSavedField
    ) {
      continue;
    }

    let name = `字段${key}`;
    const row = table?.rows[item.row];
    if (row?.cells[item.col - 1]) {
      name = row.cells[item.col - 1].textContent.trim() || name;
    }
    fieldNames.push(name);
  }

  return fieldNames;
};

const getSJCJF000HSaveRowValues = (
  helper,
  targetStatusWord,
  compositeCommandWord,
) => {
  const rowValues = [new Date().toISOString()];
  const sortedKeys = Array.from(helper.metaData.keys()).sort((a, b) => a - b);
  for (const key of sortedKeys) {
    const item = helper.metaData.get(key);
    if (!item) continue;

    if (key === 24) {
      rowValues.push(targetStatusWord);
      continue;
    }
    if (key === 25) {
      rowValues.push(compositeCommandWord);
      continue;
    }
    if (item.type === "RES" || item.type === "NOTUSE") {
      continue;
    }

    rowValues.push(helper.getValue(key));
  }
  return rowValues;
};

/**
 * 开始保存B帧
 */
const startSavingBFrame = () => {
  console.log("发送指令：请求后端开始保存B帧文件...");
  // 从 DOM 表格第一列读取字段名作为 CSV 表头
  const tableB = document.getElementById("tableWidget_SJCJ_F000H_Recv");
  let fieldNamesB = ["时间"];
  const fieldNamesA = getSJCJF000HSaveFieldNames();
  if (tableB) {
    // 先写完左列字段名，再写右列字段名
    for (let i = 0; i < tableB.rows.length; i++) {
      const row = tableB.rows[i];
      if (row.cells.length > 0) {
        fieldNamesB.push(row.cells[0].textContent.trim());
      }
    }
    for (let i = 0; i < tableB.rows.length; i++) {
      const row = tableB.rows[i];
      if (row.cells.length > 2) {
        fieldNamesB.push(row.cells[2].textContent.trim());
      }
    }
  }
  // 追加红外应答状态表格列名
  const irTable = document.getElementById("tableWidget_HWYDZT_F000H_Recv");
  if (irTable) {
    for (let i = 0; i < irTable.rows.length; i++) {
      const row = irTable.rows[i];
      if (row.cells.length > 0) {
        fieldNamesB.push(row.cells[0].textContent.trim());
      }
    }
  }
  // 追加激光工作状态表格列名
  const laserTable = document.getElementById("tableWidget_JGGZZT_F000H_Recv");
  if (laserTable) {
    for (let i = 0; i < laserTable.rows.length; i++) {
      const row = laserTable.rows[i];
      if (row.cells.length > 0) {
        fieldNamesB.push(row.cells[0].textContent.trim());
      }
    }
  }
  const cmd = JSON.stringify({
    type: "CONTROL_CMD",
    action: "START_SAVE_SJCJ",
    header: fieldNamesB.join(",") + "\n",
    headerA: fieldNamesA.join(",") + "\n",
  });
  wsClient.sendText(cmd);
  statusBar.sendMessage("正在请求后端录制A/B帧（分文件）...", "black");
};

/**
 * 停止保存命令帧
 */
const stopSavingCMD = () => {
  console.log("发送指令：请求后端停止保存...");

  const cmd = JSON.stringify({
    type: "CONTROL_CMD",
    action: "STOP_SAVE_SJCJ",
  });

  wsClient.sendText(cmd);

  statusBar.sendMessage("已发送停止录制请求");
};

//=================================================
// F000H 新协议数据采集相关
//=========================================

// 解析二进制字符串选项
// 输入格式如 "000b未知"、"1b控制"、"00b发射接收均不开启"
const parseBinaryOption = (str) => {
  const match = str.match(/^([01]+)b/);
  if (match) {
    return parseInt(match[1], 2);
  }
  return 0;
};

export const loadCommand_SJCJ_F000H = async () => {
  
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x80; // 80字节 (0x0040) 60+4
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00; //  (1000H)
    sendBuffer[15] = 0x10;

    const helper = PacketManager.get("SJCJ_F000H_Send");
    if (!helper) {
      console.error("[F000H] SJCJ_F000H_Send helper 未初始化");
      statusBar.sendMessage(
        "SJCJ_F000H_Send helper 未初始化",
        "F000H",
        "error",
      );
      return;
    }

    helper.updateAllFromTable("tableWidget_SJCJ_F000H_Send");
    /*const cur1 = helper.getValue(26);
        helper.setValue(26, cur1 * (Math.PI / 180));
        console.log("26!!!!", helper.getValue(26));
        const cur2 = helper.getValue(27);
        helper.setValue(27, cur2 * (Math.PI / 180));
        console.log("27!!!!", helper.getValue(27));*/

    // 组装目标状态字（索引24，数组索引23）
    // 位分布：
    // 位 0-2: 打击目标类型 (3位)
    // 位 3-5: 红外场景标识 (3位)
    // 位 6: 前发1标识 (1位)
    // 位 7: 前发2标识 (1位)
    // 位 8: 云干扰标识 (1位)
    // 位 9-10: 目标尺寸标识 (2位)
    // 位 11: 前向/后向 (1位)
    let targetStatusWord = 0;

    const djlxl = document.getElementById("comboBox_DJMBLX");
    if (djlxl) {
      const val = parseBinaryOption(djlxl.value);
      targetStatusWord |= (val & 0x7) << 0; // 位 0-2
    }

    const hwqj = document.getElementById("comboBox_HWQJBS");
    if (hwqj) {
      const val = parseBinaryOption(hwqj.value);
      targetStatusWord |= (val & 0x7) << 3; // 位 3-5
    }

    const qf1 = document.getElementById("comboBox_QF1BS");
    if (qf1) {
      const val = qf1.checked ? 1 : 0;
      targetStatusWord |= (val & 0x1) << 6; // 位 6
    }

    const qf2 = document.getElementById("comboBox_QF2BS");
    if (qf2) {
      const val = qf2.checked ? 1 : 0;
      targetStatusWord |= (val & 0x1) << 7; // 位 7
    }

    const ych = document.getElementById("comboBox_YCHBS");
    if (ych) {
      const val = ych.checked ? 1 : 0;
      targetStatusWord |= (val & 0x1) << 8; // 位 8
    }

    const mbcc = document.getElementById("comboBox_MBCCBS");
    if (mbcc) {
      const val = parseBinaryOption(mbcc.value);
      targetStatusWord |= (val & 0x3) << 9; // 位 9-10
    }

    const qfhf = document.getElementById("comboBox_QFHF");
    if (qfhf) {
      const val = qfhf.checked ? 1 : 0;
      targetStatusWord |= (val & 0x1) << 11; // 位 11
    }

    console.log(
      "[F000H] 目标状态字: 0x" + targetStatusWord.toString(16).padStart(4, "0"),
    );

    //  组装复合指令字（索引25，数组索引24）
    // 位分布：
    // 位 0: 休眠指令 (1位)
    // 位 1: 唤醒指令 (1位)
    // 位 2: 雷达信息有效指令 (1位)
    // 位 3: 红外截获控制 (1位)
    // 位 4-5: 激光发射接收控制 (2位)
    // 位 6-8: 搜索指令 (3位)
    // 位 9: 预置测试指令 (1位)
    // 位 10: 遥测有效指令 (1位)
    // 位 11: 允许输出引爆信号指令 (1位)
    // 位 12: 分离脱落信号 (1位)
    let compositeCommandWord = 0;

    const xmzl = document.getElementById("comboBox_XMZL");
    if (xmzl) {
      const val = xmzl.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 0; // 位 0
    }

    const hxzl = document.getElementById("comboBox_HXZL");
    if (hxzl) {
      const val = hxzl.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 1; // 位 1
    }

    const ldxx = document.getElementById("comboBox_LDXXYX");
    if (ldxx) {
      const val = ldxx.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 2; // 位 2
    }

    const hwjh = document.getElementById("comboBox_HWJHKZ");
    if (hwjh) {
      const val = hwjh.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 3; // 位 3
    }

    const jgfs = document.getElementById("comboBox_JGFSJKZ");
    if (jgfs) {
      const val = parseBinaryOption(jgfs.value);
      compositeCommandWord |= (val & 0x3) << 4; // 位 4-5
    }

    const sszl = document.getElementById("comboBox_SSZL");
    if (sszl) {
      const val = parseBinaryOption(sszl.value);
      compositeCommandWord |= (val & 0x7) << 6; // 位 6-8
    }

    const yzcs = document.getElementById("comboBox_YZCSZL");
    if (yzcs) {
      const val = yzcs.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 9; // 位 9
    }

    const ycyx = document.getElementById("comboBox_YCYXZL");
    if (ycyx) {
      const val = ycyx.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 10; // 位 10
    }

    const yxsc = document.getElementById("comboBox_YXSCYBXHZL");
    if (yxsc) {
      const val = yxsc.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 11; // 位 11
    }

    const fltl = document.getElementById("comboBox_FLTLXH");
    if (fltl) {
      const val = fltl.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 12; // 位 12
    }

    const zhxh = document.getElementById("comboBox_ZHXH");
    if (zhxh) {
      const val = zhxh.checked ? 1 : 0;
      compositeCommandWord |= (val & 0x1) << 13; // 位 13
    }

    console.log(
      "[F000H] 复合指令字: 0x" +
        compositeCommandWord.toString(16).padStart(4, "0"),
    );

    const payload = helper.getBufferForSend();
    sendBuffer.set(payload, 16); // 从第16字节开始放置数据

    //  直接写入目标状态字和复合指令字到sendBuffer
    // 目标状态字（索引24，RES+2），使用修正后的偏移量60
    const targetStatusOffset = 16 + 88; // 60
    sendBuffer[targetStatusOffset] = targetStatusWord & 0xff; // 低字节
    sendBuffer[targetStatusOffset + 1] = (targetStatusWord >> 8) & 0xff; // 高字节

    // 复合指令字（索引25，RES+2），使用修正后的偏移量62
    const compositeCommandOffset = 16 + 90; // 62
    sendBuffer[compositeCommandOffset] = compositeCommandWord & 0xff; // 低字节

    sendBuffer[compositeCommandOffset + 1] = (compositeCommandWord >> 8) & 0xff; // 高字节

    /*console.log(
      "[F000H] 直接写入 - 目标状态字 offset " +
        targetStatusOffset +
        ": 0x" +
        (
          sendBuffer[targetStatusOffset + 1] * 256 +
          sendBuffer[targetStatusOffset]
        )
          .toString(16)
          .padStart(4, "0") +
        ", 复合指令字 offset " +
        compositeCommandOffset +
        ": 0x" +
        (
          sendBuffer[compositeCommandOffset + 1] * 256 +
          sendBuffer[compositeCommandOffset]
        )
          .toString(16)
          .padStart(4, "0"),
    );*/

    /*console.log(
      "[F000H] 发送F000H数据采集命令完成，目标状态字: 0x" +
        targetStatusWord.toString(16).padStart(4, "0") +
        ", 复合指令字: 0x" +
        compositeCommandWord.toString(16).padStart(4, "0"),
    );*/
    statusBar.sendMessage("F000H数据采集命令已发送", "F000H");
    /*console.log(
        .map((b) => b.toString(16).padStart(2, "0"))
        .join(" "),
    );*/

    // 在进入循环前，把 A 帧报文快照到局部 buffer，
    // 避免其他指令修改全局 sendBuffer 后被循环反复重发
    // sendBuffer[6] = 0x6c = 108（数据部分长度），加上16字节头 = 124字节
    const f000hSendLength = 16 + 124; // 报文总长度124字节
    const f000hLocalBuffer = sendBuffer.slice(0, f000hSendLength);

    while (isSJCJF000HRunning) {
        wsClient.sendUdp(f000hLocalBuffer);

        // 每发送一帧 A 帧，若正在保存则主动追加一行
        if (isSavingBFrame) {
          // 从实际发送的字节缓冲区解析字段值，确保与发出去的数据一致
          const helperA = PacketManager.get("SJCJ_F000H_Send");
          const payloadA = f000hLocalBuffer.slice(16); // 去掉16字节包头
          helperA.loadBufferFromNet(payloadA);
          const rowValuesA = getSJCJF000HSaveRowValues(
            helperA,
            targetStatusWord,
            compositeCommandWord,
          );
          wsClient.sendText(JSON.stringify({ type: "SAVE_A_FRAME_ROW", row: rowValuesA.join(",") }));
        }

        /*await new Promise((resolve) => {
            resolveAck_F000H_SJCJ = resolve;
        });*/

        await new Promise((resolve) => setTimeout(resolve, 50));
    /*if (isSJCJ0010HRunning) {
            isSJCJ0010HRunning = false;
            await new Promise((resolve) => {
                resolveAck_0100H_SJCJ = resolve;
            });
            isSJCJ0010HRunning = true;
            loadCommand_SJCJ_0010H()*/
  }
};

/*export const handle_SJCJ_0100H = () => {

        statusBar.addMessage("数据采集A帧0100H：正常");
        if (resolveAck_0100H_SJCJ) {
            resolveAck_0100H_SJCJ();
            resolveAck_0100H_SJCJ = null;

        }

    };

    const loadCommand_SJCJ_0010H = async () => {
        while (isSJCJ0010HRunning) {
            sendBuffer[0] = 0x31;
            sendBuffer[1] = 0x02;
            sendBuffer[2] = 0x01;
            sendBuffer[3] = 0x50;
            sendBuffer[4] = 0x00;
            sendBuffer[5] = 0x00;
            sendBuffer[6] = 0x40; // 64字节 (0x0040) 60+4
            sendBuffer[7] = 0x00;
            sendBuffer[8] = 0x00;
            sendBuffer[9] = 0x00;
            sendBuffer[10] = 0x00;
            sendBuffer[11] = 0x00;
            sendBuffer[12] = 0x54; // AR_DYT
            sendBuffer[13] = 0x52; // AT_JK
            sendBuffer[14] = 0x10; //  (0010H)
            sendBuffer[15] = 0x00;
            wsClient.sendUdp(sendBuffer);
            await new Promise(resolve => setTimeout(resolve, 10));
        }
    };*/

export const handle_SJCJ_Recv_F000H = (data) => {
  //console.log("[F000H] 数据采集命令应答");
  {
    const _now = Date.now();
    if (_now - _f000hLastRecvLog >= F000H_LOG_INTERVAL) {
      statusBar.receiveMessage("数据采集命令应答", "F000H");
      _f000hLastRecvLog = _now;
    }
  }
  /*console.log(
    Array.from(data)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" "),
  );*/

  const helper = PacketManager.get("SJCJ_F000H_Recv");

  helper.loadBufferFromNet(data);
  helper.updateAllToTable("tableWidget_SJCJ_F000H_Recv");

  // 先更新红外应答状态和激光工作状态表格，保证保存B帧时读到最新值
  updateStatusTables_F000H(helper);

  // 如果处于保存状态，就从 DOM 表格第二列读取当前值并发送给服务端
  if (isSavingBFrame) {
    if (saveBFrameCount < MAX_SAVE_FRAMES) {
      const nowStr = new Date().toISOString();
      const saveTable = document.getElementById("tableWidget_SJCJ_F000H_Recv");
      let rowValues = [nowStr];
      if (saveTable) {
        // 先写完左列值，再写右列值
        for (let i = 0; i < saveTable.rows.length; i++) {
          const tr = saveTable.rows[i];
          if (tr.cells.length > 1) {
            const cell = tr.cells[1];
            const input = cell.querySelector("input, select");
            rowValues.push(
              input ? input.value.trim() : cell.textContent.trim(),
            );
          }
        }
        for (let i = 0; i < saveTable.rows.length; i++) {
          const tr = saveTable.rows[i];
          if (tr.cells.length > 3) {
            const cell = tr.cells[3];
            const input = cell.querySelector("input, select");
            rowValues.push(
              input ? input.value.trim() : cell.textContent.trim(),
            );
          }
        }
      }
      // 追加红外应答状态表格数据（tableWidget_HWYDZT_F000H_Recv 第二列）
      const irTable = document.getElementById("tableWidget_HWYDZT_F000H_Recv");
      if (irTable) {
        for (let i = 0; i < irTable.rows.length; i++) {
          const row = irTable.rows[i];
          if (row.cells.length > 1) {
            const cell = row.cells[1];
            const input = cell.querySelector("input");
            rowValues.push(input ? input.value.trim() : cell.textContent.trim());
          }
        }
      }
      // 追加激光工作状态表格数据（tableWidget_JGGZZT_F000H_Recv 第二列）
      const laserTable = document.getElementById("tableWidget_JGGZZT_F000H_Recv");
      if (laserTable) {
        for (let i = 0; i < laserTable.rows.length; i++) {
          const row = laserTable.rows[i];
          if (row.cells.length > 1) {
            const cell = row.cells[1];
            const input = cell.querySelector("input");
            rowValues.push(input ? input.value.trim() : cell.textContent.trim());
          }
        }
      }
      wsClient.sendText(
        JSON.stringify({
          type: "SAVE_B_FRAME_ROW",
          row: rowValues.join(","),
        }),
      );

      // A 帧已在发送时主动保存，此处不再重复快照
      saveBFrameCount++;
    } else {
      isSavingBFrame = false;
      const btn = document.getElementById("pushButton_SJCJ_0010H");
      if (btn) btn.innerText = "开始保存A/B帧";
      stopSavingCMD();
      statusBar.sendMessage("B帧保存已满1000000帧，自动停止", "orange");
    }
  }

  updateTargetBox_F000h(data);
  triggerSJCJResolve();

  // 更新图表曲线
  updateChart_SJCJ();

  // 校准扫描：触发 B 帧原始数据回调
  if (_bFrameRawCallback) _bFrameRawCallback(data);

  if (resolveAck_F000H_SJCJ) {
    resolveAck_F000H_SJCJ();
    resolveAck_F000H_SJCJ = null;
  }
  //const laserImgData = data.subarray(72, 181);
  //console.log(laserImgData);
  //updateLaserImage(laserImgData);
};

/**
 * 更新红外应答状态和激光工作状态表格
 * @param {BinaryTableHelper} helper - F000H接收helper
 */
const updateStatusTables_F000H = (helper) => {
  // 读取红外应答状态字（索引6）
  const irResponseStatus = helper.getValue(6);
  const irStatusValue = parseInt(irResponseStatus) || 0;

  // 红外应答状态的位偏移: 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, a, d（共12个字段）
  const irBitOffsets = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 13];

  // 更新红外应答状态表格
  const irTable = document.getElementById("tableWidget_HWYDZT_F000H_Recv");
  if (irTable) {
    for (let i = 0; i < irBitOffsets.length; i++) {
      const startBit = irBitOffsets[i];
      const endBit = i < irBitOffsets.length - 1 ? irBitOffsets[i + 1] : 16;
      const bitWidth = endBit - startBit;
      const bitValue = (irStatusValue >> startBit) & ((1 << bitWidth) - 1);

      const row = irTable.rows[i];
      if (row && row.cells[1]) {
        const cell = row.cells[1];
        const input = cell.querySelector("input");
        if (input) {
          input.value = bitValue.toString();
        } else {
          cell.textContent = bitValue.toString();
        }
      }
    }
  }

  // 读取激光工作状态标志字（索引7）
  const laserWorkStatus = helper.getValue(7);
  const laserStatusValue = parseInt(laserWorkStatus) || 0;

  // 激光工作状态的位偏移: 0, 1,2, 3, 4, 5, 6, 7, 8（共9个字段）
  const laserBitOffsets = [0, 1,2, 3, 4, 5, 6, 7, 8];

  // 更新激光工作状态表格
  const laserTable = document.getElementById("tableWidget_JGGZZT_F000H_Recv");
  if (laserTable) {
    for (let i = 0; i < laserBitOffsets.length; i++) {
      const startBit = laserBitOffsets[i];
      const endBit =
        i < laserBitOffsets.length - 1 ? laserBitOffsets[i + 1] : 16;
      const bitWidth = endBit - startBit;
      const bitValue = (laserStatusValue >> startBit) & ((1 << bitWidth) - 1);

      const row = laserTable.rows[i];
      if (row && row.cells[1]) {
        const cell = row.cells[1];
        const input = cell.querySelector("input");
        if (input) {
          input.value = bitValue.toString();
        } else {
          cell.textContent = bitValue.toString();
        }
      }
    }
  }

  console.log(
    `[F000H] 红外应答状态: 0x${irStatusValue.toString(16).padStart(4, "0")}, 激光工作状态: 0x${laserStatusValue.toString(16).padStart(4, "0")}`,
  );
};

/**
 * 更新目标框位置F000H（绿框）
 * @param {Uint8Array} recvData - 接收数据
 */
const updateTargetBox_F000h = (recvData) => {
  // 目标方位角和俯仰角
  const view = new DataView(
    recvData.buffer,
    recvData.byteOffset,
    recvData.byteLength,
  );
  console.log(
    Array.from(recvData)
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" "),
  );
  const GZXMBFWJ_Temp = view.getFloat32(48, true);
  const GZXMBFYJ_Temp = view.getFloat32(52, true);
  console.log("GZXMBFWJ_Temp_F000H", GZXMBFWJ_Temp);
  console.log("GZXMBFYJ_Temp_F000H", GZXMBFYJ_Temp);

  const GZXMBFWJ = (GZXMBFWJ_Temp  * 180) / Math.PI;
  const GZXMBFYJ = (GZXMBFYJ_Temp  * 180) / Math.PI;

  console.log("GZXMBFWJ_Temp_F000H", GZXMBFWJ);
  console.log("GZXMBFYJ_Temp_F000H", GZXMBFYJ);

  // 从固定参数表格获取视场角参数
  const HWFW = -2; // 红外方位
  const HWFY = -2; // 红外俯仰

  const HWFWSCJZ1 = parseFloat(HWFW) || 0;
  const HWFYSCJZ1 = parseFloat(HWFY) || 0;

  // temp2 = 64 - (GZXMBFWJ / (HWFWSCJZ1 + 0.000001)) * 128;
  // temp2 = temp2 * 3;
  //let x = 64 - (GZXMBFWJ / (HWFWSCJZ1 + 0.000001)) * 64;
  let x = 64 +(GZXMBFWJ / (HWFYSCJZ1 * 2)) * 128;
  x = x * 3;

  //let y = 64 - (GZXMBFYJ / (HWFYSCJZ1 + 0.000001)) * 64;
  let y = 64 + (GZXMBFYJ / (HWFYSCJZ1 * 2)) * 128;
  y = y * 3;

  x = Math.max(0, x);
  y = Math.max(0, y);
  console.log("x:",x,"y:",y);

  setVideoTargetBoxPosition(y, x);
};

function updateCSZD3000HBlindZoneForSend(helper) {
  const blindZoneInput = document.getElementById("input_JGMQ_3000H");
  const blindZoneUiValue = parseFloat(blindZoneInput?.value);
  const safeBlindZone = Number.isFinite(blindZoneUiValue)
    ? blindZoneUiValue
    : 80;
  // 协议值 = (界面显示的激光盲区 - 80) / 10。
  const blindZoneRaw = Math.max(
    0,
    Math.min(0xff, Math.trunc((safeBlindZone - 80) / 10)),
  );
  if (!helper.setValueByName(CSZD3000H_FIELDS.laserBlindZone, blindZoneRaw)) {
    console.warn(
      `[CSZD3000H] 无法写入字段：${CSZD3000H_FIELDS.laserBlindZone}`,
    );
  }
  if (blindZoneInput) {
    blindZoneInput.value = String(blindZoneRaw * 10 + 80);
  }
}

function renderCSZD3000HRecvBlindZone() {
  const valueCell = Array.from(
    document.querySelectorAll('[data-cszd-direction="recv"][data-cszd-field]'),
  ).find(
    (control) => control.dataset.cszdField === CSZD3000H_FIELDS.laserBlindZone,
  );
  if (!valueCell) {
    console.warn(
      `[CSZD3000H] 接收界面未找到字段：${CSZD3000H_FIELDS.laserBlindZone}`,
    );
    return;
  }

  const rawValue = Number(valueCell.textContent.trim());
  if (!Number.isFinite(rawValue)) {
    console.warn(
      `[CSZD3000H] 激光接收盲区原始值无效：${valueCell.textContent}`,
    );
    return;
  }

  const displayValue = rawValue * 10 + 80;
  valueCell.textContent = String(displayValue);
  valueCell.dataset.rawValue = String(rawValue);
  valueCell.title = `协议原始值：${rawValue}`;
  console.log(
    `[CSZD3000H] 激光接收盲区：协议原始值=${rawValue}，界面显示值=${displayValue}`,
  );
}

function getCSZD3000HFlagFromCheckboxes(checkboxIds) {
  return checkboxIds.reduce((value, checkboxId, bit) => {
    return document.getElementById(checkboxId)?.checked
      ? value | (1 << bit)
      : value;
  }, 0);
}

function updateCSZD3000HFlagTableCell(fieldName, value) {
  // 有效标志不再作为可编辑字段显示；这里保留函数名，便于维持调用链。
}

function updateCSZD3000HValidFlagsForSend(helper) {
  const flag0 = getCSZD3000HFlagFromCheckboxes(
    CSZD3000H_VALID_FLAG0_CHECKBOXES,
  );
  const flag1 = getCSZD3000HFlagFromCheckboxes(
    CSZD3000H_VALID_FLAG1_CHECKBOXES,
  );

  for (const [fieldName, value] of [
    [CSZD3000H_FIELDS.validFlag0, flag0],
    [CSZD3000H_FIELDS.validFlag1, flag1],
  ]) {
    if (!helper.setValueByName(fieldName, value)) {
      console.warn(`[CSZD3000H] 无法写入字段：${fieldName}`);
    }
    updateCSZD3000HFlagTableCell(fieldName, value);
  }
}

function updateCSZD3000HCheckboxesFromValue(checkboxIds, value) {
  checkboxIds.forEach((checkboxId, bit) => {
    const checkbox = document.getElementById(checkboxId);
    if (checkbox) checkbox.checked = (value & (1 << bit)) !== 0;
  });
}

function updateCSZD3000HValidFlagsFromRecv(helper) {
  const flag0 =
    Number(helper.getValueByName(CSZD3000H_FIELDS.validFlag0)) || 0;
  const flag1 =
    Number(helper.getValueByName(CSZD3000H_FIELDS.validFlag1)) || 0;
  updateCSZD3000HCheckboxesFromValue(
    CSZD3000H_VALID_FLAG0_CHECKBOXES,
    flag0,
  );
  updateCSZD3000HCheckboxesFromValue(
    CSZD3000H_VALID_FLAG1_CHECKBOXES,
    flag1,
  );
  CSZD3000H_VALID_FLAG_SELECT_ALL.forEach(({ selectAllId, checkboxIds }) => {
    updateCSZD3000HSelectAllState(selectAllId, checkboxIds);
  });
}

function updateCSZD3000HModesForSend(helper) {
  const aimingPointMode =
    Number(document.getElementById("comboBox_MZDXZMS_3000H")?.value) || 0;
  const trackingEntryMode =
    Number(document.getElementById("comboBox_GZZRMS_3000H")?.value) || 0;

  helper.setValueByName(CSZD3000H_FIELDS.aimingPointMode, aimingPointMode);
  helper.setValueByName(CSZD3000H_FIELDS.trackingEntryMode, trackingEntryMode);
}

function updateCSZD3000HModesFromRecv(helper) {
  const aimingPointMode = Number(
    helper.getValueByName(CSZD3000H_FIELDS.aimingPointMode),
  );
  const trackingEntryMode = Number(
    helper.getValueByName(CSZD3000H_FIELDS.trackingEntryMode),
  );
  const aimingPointSelect = document.getElementById(
    "comboBox_MZDXZMS_3000H",
  );
  const trackingEntrySelect = document.getElementById(
    "comboBox_GZZRMS_3000H",
  );

  if (aimingPointSelect) {
    aimingPointSelect.value = aimingPointMode === 1 ? "1" : "0";
  }
  if (trackingEntrySelect) {
    trackingEntrySelect.value = trackingEntryMode === 1 ? "1" : "0";
  }
}

const loadCommand_CSZD_3000H = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00; // 5-6 为有效载荷长度，稍后按当前协议动态填写
  sendBuffer[6] = 0x00;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x30; //3000H
  const helper_1 = PacketManager.get("CSZD_Send_3000H");
  const helper_2 = PacketManager.get("CSZD_Send_3000H_JJHCS");
  if (!helper_1 || !helper_2) {
    console.error("CSZD_3000H helper 未初始化");
    return;
  }

  syncCSZD3000HFormToHelpers(helper_1, helper_2);
  updateCSZD3000HBlindZoneForSend(helper_1);

  const LaserAmplifierGainMap = {
    "0:1倍": 0,
    "1:0.8倍": 1,
    "2:0.6倍": 2,
    "3:0.4倍": 3,
  };
  const LaserAmplifierGain =
    document.getElementById("comboBox_JGFDQZY_3000H")?.value || "0:1倍";
  helper_1.setValueByName(
    CSZD3000H_FIELDS.laserAmplifierGain,
    LaserAmplifierGainMap[LaserAmplifierGain] ?? 0,
  );
  updateCSZD3000HValidFlagsForSend(helper_1);
  updateCSZD3000HModesForSend(helper_1);

  const payload1 = helper_1.getBufferForSend();
  const payload2 = helper_2.getBufferForSend();
  const confidenceMeta = helper_1.getMetaByName(CSZD3000H_FIELDS.confidence);
  const confidenceEndOffset = confidenceMeta
    ? confidenceMeta.offset + confidenceMeta.byteWidth
    : -1;
  if (confidenceEndOffset !== CSZD3000H_LAYOUT.matrixInsertOffset) {
    console.error(
      `[CSZD3000H] 置信度参数结束偏移异常：期望 ${CSZD3000H_LAYOUT.matrixInsertOffset}，实际 ${confidenceEndOffset}`,
    );
    return;
  }

  let wirePayload;
  try {
    wirePayload = buildCSZD3000HWirePayload(payload1, payload2);
  } catch (err) {
    console.error("[CSZD3000H] 载荷组帧失败:", err);
    statusBar.errorMessage(`参数装订组帧失败: ${err.message}`);
    return;
  }

  const payloadLength = wirePayload.length + 4;
  sendBuffer[5] = (payloadLength >> 8) & 0xff;
  sendBuffer[6] = payloadLength & 0xff;
  sendBuffer.set(wirePayload, 16);

  const totalLength = 16 + wirePayload.length;
  const packet = sendBuffer.subarray(0, totalLength);

  console.log("固定参数装订 - 发送数据包:");
  console.log("   总长度:", totalLength, "字节");
  
  console.log(
    "   载荷:",
    Array.from(packet )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" ") 
  );

  statusBar.sendMessage("固定参数装订", "3000H");
  wsClient.sendUdp(packet);
};

function captureCommandPacket(loadCommand, label) {
  const originalSendUdp = wsClient.sendUdp;
  const originalSendMessage = statusBar.sendMessage;
  let packet = null;

  wsClient.sendUdp = (data) => {
    packet = new Uint8Array(data);
  };
  statusBar.sendMessage = () => {};

  try {
    loadCommand();
  } finally {
    wsClient.sendUdp = originalSendUdp;
    statusBar.sendMessage = originalSendMessage;
  }

  if (!packet) {
    throw new Error(`${label} packet was not generated`);
  }
  return packet;
}

async function generateCSZD3000HDat() {
  try {
    const cszdPacket = captureCommandPacket(loadCommand_CSZD_3000H, "CSZD_3000H");
    const jgcszdPacket = captureCommandPacket(loadCommand_JGCSZD, "JGCSZD");
    // 3000H 参数载荷长度由当前 _loc.csv 定义动态决定。
    const cszdData = cszdPacket.subarray(16);
    const jgcszdData = jgcszdPacket.subarray(16, 16 + 144);
    const merged = new Uint8Array(cszdData.length + jgcszdData.length);
    merged.set(cszdData, 0);
    merged.set(jgcszdData, cszdData.length);

    const now = new Date();
    const ts = now.toISOString().replace(/T/, "_").replace(/:/g, "-").replace(/\..+/, "");
    const filename = `cszd_3000h_${ts}.dat`;
    await saveBinaryFile(merged, filename);
    statusBar.successMessage(`generated ${filename}, ${merged.length} bytes`);
  } catch (err) {
    if (err.name === "AbortError") return;
    console.error("[CSZD3000H] generate dat failed:", err);
    statusBar.errorMessage(`generate dat failed: ${err.message}`);
  }
}

export const handle_CSZD_Recv_3000H = (data) => {
  console.log("[DataHandler] 参数装订应答");
  statusBar.receiveMessage("参数装订应答", "3000H");

  if (!data || data.length < 1) {
    console.error("应答数据为空");
    return;
  }

  const result = data[0];

  if (result === 0x0f) {
    console.log("  装订成功");
    statusBar.successMessage("参数装订成功");
  } else {
    console.warn("  装订失败, code:", result.toString(16));
  }
};

const loadCommand_CSZD_4000H = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x40; //4000H
  sendBuffer[16] = 0x55;
  wsClient.sendUdp(sendBuffer);
  console.log("已发送目标控制参数装订下传命令");
  statusBar.sendMessage("目标控制参数装订下传", "4000H");
};

export const handle_CSZD_Recv_4000H = (data) => {
console.log(Array.from(data )
      .map((b) => b.toString(16).padStart(2, "0"))
      .join(" "));
  console.log("[DataHandler] 参数装订下传应答");
  statusBar.receiveMessage("参数装订下传应答", "4000H");

  if (!data || data.length < 1) {
    console.error("应答数据为空");
    return;
  }

  const helper_1 = PacketManager.get("CSZD_Recv_3000H");
  ///const helper_2 = PacketManager.get("CSZD_Recv_3000H_JJHCS");
  if (!helper_1) {
    return;
  }

  const helperData = restoreCSZD3000HHelperLayout(data);
  if (!helperData) return;

  helper_1.loadBufferFromNet(helperData);
  const helper_2 = helper_1;
  console.log("已加载数据到内存");

  renderCSZD3000HFormFromHelper(helper_1, helper_2);
  // 紧跟通用字段刷新执行，确保协议原始值 1 在界面中显示为 90。
  renderCSZD3000HRecvBlindZone();
  updateCSZD3000HValidFlagsFromRecv(helper_1);
  updateCSZD3000HModesFromRecv(helper_1);

  //updateCSZDRecvSpecialFields(data, helper);
  //updateCSZDRecvFromHelper(helper);
};

const loadCommand_FJYJZ_2000H = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x05;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x20; //2000H
  sendBuffer[16] = 0x00;

  const FJYJZ_checked = document.getElementById("select_FJYJZ_20000H")?.checked;
  if (FJYJZ_checked) {
    sendBuffer[16] = 0xff;
  }
    wsClient.sendUdp(sendBuffer);
    statusBar.sendMessage("非均匀校正2000H", "2000h");
};

export const handle_FJYJZ_2000H = (data) => {
  if (data[0] == 0x0f) {
    statusBar.addMessage("非均匀校正应答2000H:正常");
  } else if (data[0] == 0xff) {
    statusBar.addMessage("非均匀校正应答2000H：故障");
  }
};

const loadCommand_FJYJZJG_0020H = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x04;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x54; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x20;
  sendBuffer[15] = 0x00; //0020H

  wsClient.sendUdp(sendBuffer);
};

export const handle_FJYJZJG_0020H = (data) => {
  if (data[0] == 0x0f) {
    statusBar.addMessage("非均匀校正结果应答0020H:正常");
  } else if (data[0] == 0xff) {
    statusBar.addMessage("非均匀校正结果应答0020H：故障");
  }
};
