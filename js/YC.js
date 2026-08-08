import { Utils, setLEDStatus } from "../main.js";
import PacketManager from "./BinaryTableHelper";
import {
  handleVideoFrame,
  convert16to8bit,
  set_CurrentFrame,
  drawScaledImage,
  histogramEqualization,
} from "./Video.js";
import { updateLaserImage } from "./Laser.js";

// wsClient 和 statusBar 通过延迟动态 import 获取，避免与 Client.js 的循环依赖
let _wsClient = null;
let _statusBar = null;
// 二值图 canvas 上下文
let ctxBinary = null;

async function getWsClient() {
  if (!_wsClient) _wsClient = (await import("./Client.js")).default;
  return _wsClient;
}
async function getStatusBar() {
  if (!_statusBar) _statusBar = (await import("./StatusBar.js")).default;
  return _statusBar;
}

// YC 专属 canvas（384×384，位于 tab-17 遥测页）
let ycCanvas = null;
let ycCtx = null;

function initYCCanvas() {
  const container = document.getElementById("yc-image-widget");
  if (!container || ycCanvas) return;
  ycCanvas = document.createElement("canvas");
  ycCanvas.width = 384;
  ycCanvas.height = 384;
  container.appendChild(ycCanvas);
  ycCtx = ycCanvas.getContext("2d");

  // 初始化YC二值图 canvas
  const binaryContainer = document.getElementById("yc-binary-widget");
  if (binaryContainer) {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 384;
    binaryContainer.appendChild(canvas);
    ctxBinary = canvas.getContext("2d");
  }
}

function renderYCImage(frameData, width, height) {
  if (!ycCtx) return;
  const processed = histogramEqualization(frameData);
  drawScaledImage(ycCtx, processed, width, height);
}

const TOTAL_PACKET_11H = 16;
const TOTAL_PACKET_22H = 4;
const TOTAL_PACKET_33H = 0;
const TOTAL_PACKET_44H = 0;

let packet_count_11H = 0;
let packet_count_22H = 0;
let packet_count_33H = 0;
let packet_count_44H = 0;

let packet_half_count=0;

let buffer_11H = new Uint8Array(32768);
let offset_11H = 0;
let buffer_22H = new Uint8Array(8192);
let offset_22H = 0;

let buffer_per=new Uint8Array(2210);
let head_data=new Uint8Array(1);
head_data[0]=0x76;
let state_data=new Uint8Array(3);
//let state=0x11;
let sign_half=0;
let flag_zero_packet=false;

// YC录制状态
export let isSavingYC = false;

export let isSavingYCExcel = false;
let ycExcelRows = [];
let ycExcelHeader = null;
let ycExcelSaveHandle = null;
let ycExcelFallbackFilename = "YC_Telemetry.xlsx";

// YC回放状态
let ycReplayFrames = null;
let ycReplayIndex = 0;
let ycReplayTimer = null;
let ycReplayPaused = true;
let ycReplayFps = 25;
export let isYCReplaying = false;
const ycReplayListeners = new Set();

function normalizeYCReplayFps(fps) {
    const value = Number(fps);
    if (!Number.isFinite(value) || value <= 0) return 25;
    return Math.max(1, Math.min(value, 200));
}

function clampYCReplayIndex(index) {
    const total = ycReplayFrames ? ycReplayFrames.length : 0;
    if (total === 0) return 0;
    return Math.max(0, Math.min(index, total - 1));
}

function notifyYCReplayState() {
    const state = getYCReplayState();
    ycReplayListeners.forEach((listener) => {
        try {
            listener(state);
        } catch (err) {
            console.error("[YC] replay state listener failed:", err);
        }
    });
}

function scheduleYCReplayTimer() {
    if (ycReplayTimer) {
        clearInterval(ycReplayTimer);
        ycReplayTimer = null;
    }
    ycReplayTimer = setInterval(() => {
        if (ycReplayPaused) return;
        if (ycReplayIndex >= ycReplayFrames.length) {
            stopYCReplay();
            return;
        }
        replayYCFrame(ycReplayFrames[ycReplayIndex]);
        ycReplayIndex++;
        notifyYCReplayState();
    }, 1000 / ycReplayFps);
}





export function initializeYC() {
    Utils.loadCSVToTable("./csv/LVDS_YC_Recv.csv", "tableWidget_LVDS_YC", 47, 4);
    Utils.centerAlignTable("tableWidget_LVDS_YC");
    Utils.centerAlignTable("tableWidget_YC_JG");
    set_YC_table();
    initYCCanvas();
    bindYCExcelSaveEventsClean();
}

const set_YC_table = () => {
    Utils.setTableCellText("tableWidget_LVDS_YC_ZTZ", 0, 0, "同步/制冷到位状态");
    Utils.setTableCellText("tableWidget_LVDS_YC_ZTZ", 1, 0, "AD/测温二极管自检结果");
    Utils.setTableCellText("tableWidget_LVDS_YC_ZTZ", 2, 0, "红外积分时间档位");
    Utils.setTableCellText("tableWidget_LVDS_YC_ZTZ", 3, 0, "激光发射温控出光状态");
    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 0, 0, "解锁响应");
    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 1, 0, "有无回波");
    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 2, 0, "GIF信息引爆来源");
    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 3, 0, "自毁响应");
    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 4, 0, "备用");
}

export const handle_YC_half=(data)=>{
    packet_half_count+=1;
    if(packet_half_count==2){
        packet_half_count=0;
    }
}

export const handle_YC = (data) => {
    //console.log(data);
    let data_=new Uint8Array(data);
    if(data_[0]==0x76){
        //let data_=new Uint8Array(data);
    //data=data_.subarray(2);
        //const image_data = data.subarray(2, 1105);
        //state=data[0];
        
        data=data_.subarray(3);
        //head_data=data_.subarray(0,3);
        buffer_per.set(data,0);
        sign_half+=1;
    
    }
    //接收到上半包，sign_half=0,说明当前收到的上半包为一个整包的第一包，合法，
    // 接收到上半包，sign_half=1,说明当前收到的上半包之前收到了另一个上半包，不合法
    //接收到下半包，sign_half=1,说明当前收到的下半包之前接收到的是一个上半包，合法
    //接收到下半包，sign_half=0，说明当前接收到的下半包之前没有接收到上半包，不合法
    else{
        //console.log(data);
        
        //let data_=new Uint8Array(data);
        //data=data_.subarray(3);
        buffer_per.set(data,1102);
        //console.log(buffer_per[2]);
        let state=buffer_per[0]|(buffer_per[1]<<8);
        let frame_count=buffer_per[2];

        //state_data=buffer_per.subarray(0,3);
        
            let image_data=buffer_per.subarray(3,2051);
        //console.log(buffer_per);
        
        switch (state) {
        case 0x11:
            handle_YC_11H(image_data,frame_count);

            break;
        case 0x22:
            handle_YC_22H(image_data,frame_count);
            break;
        case 0x33:
            handle_YC_33H(image_data);
            break;
        case 0x44:
            handle_YC_44H(image_data);
            break;

    }

        // 录制：将每个完整的 buffer_per（2304字节）发给服务端保存
        if (isSavingYC) {
            const packet = new Uint8Array(1 + 2304);
            packet[0] = 0xf3;
            packet.set(head_data, 1);
            //packet.set(state_data, 4);
            packet.set(buffer_per, 2);
            //把packet后面的元素填满5
            for (let i = 2 + buffer_per.length; i < packet.length; i++) {
                packet[i] = 5;
            }
            getWsClient().then(ws => ws.sendUdp(packet));
        }

        const table_data = buffer_per.subarray(2051);
        const helper = PacketManager.get("LVDS_YC_Recv");
        helper.loadBufferFromNet(table_data);
        helper.updateAllToTable("tableWidget_LVDS_YC");
        const statusValues = updateYCStatusTables(table_data);
        appendYCExcelRowClean(helper);
    }
    
    
    
}

function decodeYCStatusWords(table_data) {
    const ztz = table_data[112] ?? 0;
    const zlz = table_data[111] ?? 0;
    return [
        ztz & 0x03,
        (ztz >> 2) & 0x03,
        (ztz >> 4) & 0x03,
        (ztz >> 6) & 0x03,
        zlz & 0x01,
        (zlz >> 1) & 0x01,
        (zlz >> 2) & 0x01,
        (zlz >> 3) & 0x01,
    ];
}

function updateYCStatusTables(table_data) {
    const [zt_tb_zl, zt_ad_cw, zt_hwzlt, zt_jgq_wk,
        zlz_jsxy, zlz_ywhb, zlz_gif_ybly, zlz_zhxy] = decodeYCStatusWords(table_data);

    Utils.setTableCellText("tableWidget_LVDS_YC_ZTZ", 0, 1, zt_tb_zl);
    Utils.setTableCellText("tableWidget_LVDS_YC_ZTZ", 1, 1, zt_ad_cw);
    Utils.setTableCellText("tableWidget_LVDS_YC_ZTZ", 2, 1, zt_hwzlt);
    Utils.setTableCellText("tableWidget_LVDS_YC_ZTZ", 3, 1, zt_jgq_wk);

    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 0, 1, zlz_jsxy);
    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 1, 1, zlz_ywhb);
    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 2, 1, zlz_gif_ybly);
    Utils.setTableCellText("tableWidget_LVDS_YC_ZLSTATE", 3, 1, zlz_zhxy);

    return [zt_tb_zl, zt_ad_cw, zt_hwzlt, zt_jgq_wk,
        zlz_jsxy, zlz_ywhb, zlz_gif_ybly, zlz_zhxy];
}

export const handle_YC_11H = (data,packetCount) => {
    if (packetCount !== packet_count_11H) { return; }

    packet_count_11H += 1;

    buffer_11H.set(data,offset_11H);
    offset_11H += 2048;
    
    if (packet_count_11H == 16) {
        packet_count_11H = 0;
        offset_11H = 0;
        //set_CurrentFrame(buffer_11H);
        //console.log(buffer_11H);
        //handleVideoFrame(buffer_11H, 128, 128);
        renderYCImage(buffer_11H, 128, 128);

        if (ctxBinary) {
    const SRC_W = 128, SRC_H = 128;
    const DST_W = 384, DST_H = 384;
    const imgData = ctxBinary.createImageData(DST_W, DST_H);
    const pixels = imgData.data;
    const scaleX = SRC_W / DST_W, scaleY = SRC_H / DST_H;
    for (let dy = 0; dy < DST_H; dy++) {
      const sy = Math.floor(dy * scaleY);
      for (let dx = 0; dx < DST_W; dx++) {
        const sx = Math.floor(dx * scaleX);
        const pixIdx = sy * SRC_W + sx;           // 像素索引（0-based）
        
        const lo = buffer_11H[pixIdx * 2];         // 低字节
        const bit0 = lo & 0x01;                    // 最低位
        const val = bit0 ? 255 : 0;                // 1→白，0→黑
        const out = (dy * DST_W + dx) * 4;
        pixels[out]     = val;
        pixels[out + 1] = val;
        pixels[out + 2] = val;
        pixels[out + 3] = 255;
      }
    }
    ctxBinary.putImageData(imgData, 0, 0);
  }
    }

}

export const handle_YC_22H = (data,packetCount) => {
    if (packetCount !== packet_count_22H ) { return; }

    packet_count_22H += 1;

    buffer_22H.set(data,offset_22H);
    offset_22H += 2048;
    if (packet_count_22H == 4) {
        console.log(buffer_22H);
        packet_count_22H = 0;
        offset_22H = 0;
        //set_CurrentFrame(buffer_22H);
        //handleVideoFrame(buffer_22H, 64, 64);
        renderYCImage(buffer_22H, 64, 64);

        if (ctxBinary) {
    const SRC_W = 64, SRC_H = 64;
    const DST_W = 384, DST_H = 384;
    const imgData = ctxBinary.createImageData(DST_W, DST_H);
    const pixels = imgData.data;
    const scaleX = SRC_W / DST_W, scaleY = SRC_H / DST_H;
    for (let dy = 0; dy < DST_H; dy++) {
      const sy = Math.floor(dy * scaleY);
      for (let dx = 0; dx < DST_W; dx++) {
        const sx = Math.floor(dx * scaleX);
        const pixIdx = sy * SRC_W + sx;           // 像素索引（0-based）
        
        const lo = buffer_22H[pixIdx * 2];         // 低字节
        const bit0 = lo & 0x01;                    // 最低位
        const val = bit0 ? 255 : 0;                // 1→白，0→黑
        const out = (dy * DST_W + dx) * 4;
        pixels[out]     = val;
        pixels[out + 1] = val;
        pixels[out + 2] = val;
        pixels[out + 3] = 255;
      }
    }
    ctxBinary.putImageData(imgData, 0, 0);
  }
    }
}

export const handle_YC_33H = (data) => {
    //set_CurrentFrame(data);
    //handleVideoFrame(data, 32, 32);
    renderYCImage(data, 32, 32);

    if (ctxBinary) {
    const SRC_W = 32, SRC_H = 32;
    const DST_W = 384, DST_H = 384;
    const imgData = ctxBinary.createImageData(DST_W, DST_H);
    const pixels = imgData.data;
    const scaleX = SRC_W / DST_W, scaleY = SRC_H / DST_H;
    for (let dy = 0; dy < DST_H; dy++) {
      const sy = Math.floor(dy * scaleY);
      for (let dx = 0; dx < DST_W; dx++) {
        const sx = Math.floor(dx * scaleX);
        const pixIdx = sy * SRC_W + sx;           // 像素索引（0-based）
        
        const lo = data[pixIdx * 2];         // 低字节
        const bit0 = lo & 0x01;                    // 最低位
        const val = bit0 ? 255 : 0;                // 1→白，0→黑
        const out = (dy * DST_W + dx) * 4;
        pixels[out]     = val;
        pixels[out + 1] = val;
        pixels[out + 2] = val;
        pixels[out + 3] = 255;
      }
    }
    ctxBinary.putImageData(imgData, 0, 0);
  }
}
 
export const handle_YC_44H = (data) => {
    const image_data=data.subarray(0,1922);
    //set_CurrentFrame(image_data);
    //handleVideoFrame(image_data, 31, 31);
    const jg_data=data.subarray(1922,2030);
    //在遥测中另起一个激光图像区域
    updateLaserImage(jg_data, "tableWidget_YC_JG");
    renderYCImage(image_data, 31, 31);

    if (ctxBinary) {
    const SRC_W = 31, SRC_H = 31;
    const DST_W = 384, DST_H = 384;
    const imgData = ctxBinary.createImageData(DST_W, DST_H);
    const pixels = imgData.data;
    const scaleX = SRC_W / DST_W, scaleY = SRC_H / DST_H;
    for (let dy = 0; dy < DST_H; dy++) {
      const sy = Math.floor(dy * scaleY);
      for (let dx = 0; dx < DST_W; dx++) {
        const sx = Math.floor(dx * scaleX);
        const pixIdx = sy * SRC_W + sx;           // 像素索引（0-based）
        
        const lo = image_data[pixIdx * 2];         // 低字节
        const bit0 = lo & 0x01;                    // 最低位
        const val = bit0 ? 255 : 0;                // 1→白，0→黑
        const out = (dy * DST_W + dx) * 4;
        pixels[out]     = val;
        pixels[out + 1] = val;
        pixels[out + 2] = val;
        pixels[out + 3] = 255;
      }
    }
    ctxBinary.putImageData(imgData, 0, 0);
  }
}

// ==================== 内部：重置图像组帧计数器 ====================
function bindYCExcelSaveEvents() {
    document.getElementById("pushButton_Start_Save_YC_Excel")?.addEventListener("click", () => {
        startSavingYCExcel();
    });
    document.getElementById("pushButton_Stop_Save_YC_Excel")?.addEventListener("click", () => {
        stopSavingYCExcel();
    });
    updateYCExcelButtons();
}

function updateYCExcelButtons() {
    const startBtn = document.getElementById("pushButton_Start_Save_YC_Excel");
    const stopBtn = document.getElementById("pushButton_Stop_Save_YC_Excel");
    if (startBtn) startBtn.disabled = isSavingYCExcel;
    if (stopBtn) stopBtn.disabled = !isSavingYCExcel;
}

function buildYCExcelFilename() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `YC_Telemetry_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.xlsx`;
}

function getYCExcelTimestamp() {
    const now = new Date();
    const pad = (value, size = 2) => String(value).padStart(size, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

async function chooseYCExcelSaveHandle(filename) {
    if (typeof window.showSaveFilePicker !== "function") return null;
    return await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
            {
                description: "Excel 文件",
                accept: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
                },
            },
        ],
    });
}

function appendYCExcelRow(helper) {
    if (!isSavingYCExcel || !helper) return;
    if (!ycExcelHeader) {
        ycExcelHeader = ["时间戳", ...helper.getAllNames("tableWidget_LVDS_YC")];
    }
    ycExcelRows.push([getYCExcelTimestamp(), ...helper.getAllValues()]);
}

async function buildYCExcelBlob() {
    const Excel = globalThis.ExcelJS;
    if (!Excel) {
        throw new Error("ExcelJS 未加载，无法保存 Excel 文件");
    }

    const helper = PacketManager.get("LVDS_YC_Recv");
    const header = ycExcelHeader || ["时间戳", ...helper.getAllNames("tableWidget_LVDS_YC")];
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet("YC_Telemetry");

    ws.columns = header.map((name, index) => ({
        header: name,
        key: `col_${index}`,
        width: index === 0 ? 24 : Math.min(Math.max(String(name).length + 4, 12), 28),
    }));
    for (const row of ycExcelRows) ws.addRow(row);

    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
}

async function writeYCExcelBlob(blob) {
    if (ycExcelSaveHandle) {
        const writable = await ycExcelSaveHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ycExcelFallbackFilename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }, 1000);
}

export async function startSavingYCExcel() {
    if (isSavingYCExcel) return;
    const sb = await getStatusBar();
    ycExcelRows = [];
    ycExcelHeader = null;
    ycExcelSaveHandle = null;
    ycExcelFallbackFilename = buildYCExcelFilename();

    try {
        ycExcelSaveHandle = await chooseYCExcelSaveHandle(ycExcelFallbackFilename);
    } catch (err) {
        if (err.name === "AbortError") {
            sb.sendMessage("已取消保存遥测 Excel", "none");
            return;
        }
        console.warn("[YC] showSaveFilePicker failed, fallback to download on stop:", err);
    }

    isSavingYCExcel = true;
    updateYCExcelButtons();
    sb.sendMessage(
        ycExcelSaveHandle ? "正在采集遥测数据到 Excel..." : "正在采集遥测数据，停止时将下载 Excel 文件...",
        "none",
    );
}

export async function stopSavingYCExcel() {
    if (!isSavingYCExcel) return;
    const sb = await getStatusBar();
    isSavingYCExcel = false;
    updateYCExcelButtons();

    try {
        const blob = await buildYCExcelBlob();
        await writeYCExcelBlob(blob);
        sb.sendMessage(`遥测 Excel 保存完成，共 ${ycExcelRows.length} 行`, "none");
    } catch (err) {
        console.error("[YC] 保存遥测 Excel 失败:", err);
        sb.sendMessage(`遥测 Excel 保存失败: ${err.message}`, "none");
    } finally {
        ycExcelSaveHandle = null;
        ycExcelRows = [];
        ycExcelHeader = null;
    }
}

function bindYCExcelSaveEventsClean() {
    document.getElementById("pushButton_Start_Save_YC_Excel")?.addEventListener("click", () => {
        startSavingYCExcelClean();
    });
    document.getElementById("pushButton_Stop_Save_YC_Excel")?.addEventListener("click", () => {
        stopSavingYCExcelClean();
    });
    updateYCExcelButtonsClean();
}

function updateYCExcelButtonsClean() {
    const startBtn = document.getElementById("pushButton_Start_Save_YC_Excel");
    const stopBtn = document.getElementById("pushButton_Stop_Save_YC_Excel");
    if (startBtn) startBtn.disabled = isSavingYCExcel;
    if (stopBtn) stopBtn.disabled = !isSavingYCExcel;
}

function buildYCExcelFilenameClean() {
    const now = new Date();
    const pad = (value) => String(value).padStart(2, "0");
    return `YC_Telemetry_${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}.xlsx`;
}

function getYCExcelTimestampClean() {
    const now = new Date();
    const pad = (value, size = 2) => String(value).padStart(size, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`;
}

async function chooseYCExcelSaveHandleClean(filename) {
    if (typeof window.showSaveFilePicker !== "function") return null;
    return await window.showSaveFilePicker({
        suggestedName: filename,
        types: [
            {
                description: "Excel file",
                accept: {
                    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": [".xlsx"],
                },
            },
        ],
    });
}

function appendYCExcelRowClean(helper) {
    if (!isSavingYCExcel || !helper) return;
    if (!ycExcelHeader) {
        ycExcelHeader = ["Timestamp", ...helper.getAllNames("tableWidget_LVDS_YC")];
    }
    ycExcelRows.push([getYCExcelTimestampClean(), ...helper.getAllValues()]);
}

async function buildYCExcelBlobClean() {
    const Excel = globalThis.ExcelJS;
    if (!Excel) {
        throw new Error("ExcelJS is not loaded");
    }

    const helper = PacketManager.get("LVDS_YC_Recv");
    const header = ycExcelHeader || ["Timestamp", ...helper.getAllNames("tableWidget_LVDS_YC")];
    const wb = new Excel.Workbook();
    const ws = wb.addWorksheet("YC_Telemetry");

    ws.columns = header.map((name, index) => ({
        header: name,
        key: `col_${index}`,
        width: index === 0 ? 24 : Math.min(Math.max(String(name).length + 4, 12), 28),
    }));
    for (const row of ycExcelRows) ws.addRow(row);

    const buffer = await wb.xlsx.writeBuffer();
    return new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
}

async function writeYCExcelBlobClean(blob) {
    if (ycExcelSaveHandle) {
        const writable = await ycExcelSaveHandle.createWritable();
        await writable.write(blob);
        await writable.close();
        return;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = ycExcelFallbackFilename;
    a.style.display = "none";
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        URL.revokeObjectURL(url);
        document.body.removeChild(a);
    }, 1000);
}

async function startSavingYCExcelClean() {
    if (isSavingYCExcel) return;
    ycExcelRows = [];
    ycExcelHeader = null;
    ycExcelSaveHandle = null;
    ycExcelFallbackFilename = buildYCExcelFilenameClean();

    try {
        ycExcelSaveHandle = await chooseYCExcelSaveHandleClean(ycExcelFallbackFilename);
    } catch (err) {
        if (err.name === "AbortError") {
            const sb = await getStatusBar();
            sb.sendMessage("YC Excel save cancelled", "none");
            return;
        }
        console.warn("[YC] showSaveFilePicker failed, fallback to download on stop:", err);
    }

    const sb = await getStatusBar();
    isSavingYCExcel = true;
    updateYCExcelButtonsClean();
    sb.sendMessage(
        ycExcelSaveHandle ? "Collecting YC telemetry to Excel..." : "Collecting YC telemetry; Excel will download on stop...",
        "none",
    );
}

async function stopSavingYCExcelClean() {
    if (!isSavingYCExcel) return;
    const sb = await getStatusBar();
    isSavingYCExcel = false;
    updateYCExcelButtonsClean();

    try {
        const blob = await buildYCExcelBlobClean();
        await writeYCExcelBlobClean(blob);
        sb.sendMessage(`YC Excel saved, ${ycExcelRows.length} rows`, "none");
    } catch (err) {
        console.error("[YC] Failed to save YC Excel:", err);
        sb.sendMessage(`YC Excel save failed: ${err.message}`, "none");
    } finally {
        ycExcelSaveHandle = null;
        ycExcelRows = [];
        ycExcelHeader = null;
    }
}

function resetYCCounters() {
    packet_count_11H = 0;
    packet_count_22H = 0;
    packet_count_33H = 0;
    packet_count_44H = 0;
    offset_11H = 0;
    offset_22H = 0;
}

// ==================== 内部：回放单个 buffer_per 帧 ====================
function replayYCFrame(frameBuf) {
    //console.log("切前",frameBuf);
    frameBuf=frameBuf.subarray(1);
    //console.log("切后",frameBuf);
    // frameBuf 是 2212 字节，与录制时的 buffer_per 完全一致
    const state = frameBuf[0] | (frameBuf[1] << 8);
    const frame_count = frameBuf[2];
    const image_data = frameBuf.subarray(3, 2051);

    switch (state) {
        case 0x11:
            //packet_count_11H=frame_count;
            handle_YC_11H(image_data, frame_count);
            break;
        case 0x22:
            //packet_count_22H=frame_count;
            handle_YC_22H(image_data, frame_count);
            break;
        case 0x33:
            handle_YC_33H(image_data);
            break;
        case 0x44:
            handle_YC_44H(image_data);
            break;
    }
    if(state===0x11||state===0x22||state===0x33||state===0x44){
    const table_data = frameBuf.subarray(2051);
    const helper = PacketManager.get("LVDS_YC_Recv");
    helper.loadBufferFromNet(table_data);
    helper.updateAllToTable("tableWidget_LVDS_YC");
    const statusValues = updateYCStatusTables(table_data);
    }
}

// ==================== YC录制 ====================

export async function startSavingYC() {
    const [ws, sb] = await Promise.all([getWsClient(), getStatusBar()]);
    sb.sendMessage("请在服务端窗口选择YC数据保存位置...", "none");
    const cmd = JSON.stringify({
        type: "REQUEST_SAVE_PATH",
        saveType: "yc",
        defaultName: "YC数据.dat",
        filter: "数据文件 (*.dat)|*.dat|所有文件 (*.*)|*.*",
    });
    ws.sendText(cmd);
    console.log("[YC] 请求服务端弹出YC文件保存对话框");

    const onStatus = async (msg) => {
        if (msg.saveType !== "yc") return;
        ws.off("SAVE_STATUS", onStatus);
        const s = await getStatusBar();
        if (msg.status === "started") {
            isSavingYC = true;
            s.sendMessage(`正在保存YC数据 → ${msg.path}`, "none");
        } else if (msg.status === "cancelled") {
            s.sendMessage("已取消保存YC数据", "none");
        } else if (msg.status === "error") {
            s.sendMessage(`YC数据保存失败: ${msg.msg}`, "none");
        }
    };
    ws.on("SAVE_STATUS", onStatus);
}

export async function stopSavingYC() {
    if (isSavingYC) {
        const [ws, sb] = await Promise.all([getWsClient(), getStatusBar()]);
        ws.sendText(JSON.stringify({
            type: "CONTROL_CMD",
            action: "STOP_SAVE_YC",
        }));
        isSavingYC = false;
        sb.sendMessage("YC数据保存已停止");
        console.log("[YC] 停止保存YC数据");
    }
}

// ==================== YC回放 ====================

/**
 * 从 File 对象加载 YC 录制文件
 * 每帧固定 2210 字节（buffer_per 原始数据）
 */
export async function loadYCReplayFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const raw = new Uint8Array(e.target.result);
                // 跳过无用的头部字节：查找有效的帧头 (76 11 / 76 22 / 76 33 / 76 44)
                const VALID_HEADERS = [
                    [0x76, 0x11],
                    [0x76, 0x22],
                    [0x76, 0x33],
                    [0x76, 0x44],
                ];
                let offset = 0;
                const isValidHeader = (pos) =>
                    VALID_HEADERS.some(([b0, b1]) => raw[pos] === b0 && raw[pos + 1] === b1);
                while (offset < raw.length - 1 && !isValidHeader(offset)) {
                    offset++;
                }
                if (offset >= raw.length - 1) {
                    reject(new Error("未找到有效的帧头 (76 11/22/33/44)"));
                    return;
                }
                const uint8Array = raw.slice(offset);
                if (offset > 0) {
                    console.log(`[YC] 跳过头部 ${offset} 字节`);
                }
                const FRAME_SIZE = 2304;
                const totalFrames = Math.floor(uint8Array.length / FRAME_SIZE);
                console.log(`[YC] 文件大小: ${uint8Array.length} 字节 (去头部后), 每帧: ${FRAME_SIZE} 字节, 总帧数: ${totalFrames}`);
                const frames = [];
                for (let i = 0; i < totalFrames; i++) {
                    frames.push(uint8Array.slice(i * FRAME_SIZE, (i + 1) * FRAME_SIZE));
                }
                resolve(frames);
            } catch (err) {
                reject(err);
            }
        };
        reader.onerror = () => reject(new Error("YC文件读取失败"));
        reader.readAsArrayBuffer(file);
    });
}

/**
 * 开始YC回放
 * @param {Uint8Array[]} frames
 * @param {number} fps - 回放帧率（buffer_per帧率，不是图像帧率）
 */
export function startYCReplay(frames, fps = ycReplayFps) {
    if (!frames || frames.length === 0) return;
    stopYCReplay();
    resetYCCounters();
    ycReplayFps = normalizeYCReplayFps(fps);

    isYCReplaying = true;
    ycReplayFrames = frames;
    ycReplayIndex = 0;
    ycReplayPaused = false;
    notifyYCReplayState();

    console.log(`[YC] 开始回放，总帧数: ${frames.length}，fps: ${ycReplayFps}`);

    scheduleYCReplayTimer();
}

export function pauseYCReplay() {
    ycReplayPaused = true;
    console.log("[YC] 暂停回放");
    notifyYCReplayState();
}

export function resumeYCReplay() {
    if (!ycReplayFrames || ycReplayFrames.length === 0) return;
    ycReplayPaused = false;
    console.log("[YC] 继续回放");
    notifyYCReplayState();
}

export function stopYCReplay() {
    if (ycReplayTimer) {
        clearInterval(ycReplayTimer);
        ycReplayTimer = null;
    }
    isYCReplaying = false;
    ycReplayPaused = true;
    ycReplayFrames = null;
    ycReplayIndex = 0;
    resetYCCounters();
    console.log("[YC] 停止回放");
    notifyYCReplayState();
}

export function seekYCReplay(index) {
    if (!ycReplayFrames) return;
    ycReplayIndex = clampYCReplayIndex(index);
    resetYCCounters();
    replayYCFrame(ycReplayFrames[ycReplayIndex]);
    ycReplayIndex = clampYCReplayIndex(ycReplayIndex + 1);
    notifyYCReplayState();
}

export function setYCReplayFps(fps) {
    ycReplayFps = normalizeYCReplayFps(fps);
    if (isYCReplaying && ycReplayFrames) {
        scheduleYCReplayTimer();
    }
    notifyYCReplayState();
    return ycReplayFps;
}

export function replayPreviousYCFrame() {
    if (!ycReplayFrames || !ycReplayPaused) return;
    const targetIndex = clampYCReplayIndex(ycReplayIndex - 2);
    resetYCCounters();
    replayYCFrame(ycReplayFrames[targetIndex]);
    ycReplayIndex = clampYCReplayIndex(targetIndex + 1);
    notifyYCReplayState();
}

export function replayNextYCFrame() {
    if (!ycReplayFrames || !ycReplayPaused) return;
    const targetIndex = clampYCReplayIndex(ycReplayIndex);
    resetYCCounters();
    replayYCFrame(ycReplayFrames[targetIndex]);
    ycReplayIndex = clampYCReplayIndex(targetIndex + 1);
    notifyYCReplayState();
}

export function onYCReplayStateChange(listener) {
    if (typeof listener !== "function") return () => {};
    ycReplayListeners.add(listener);
    listener(getYCReplayState());
    return () => ycReplayListeners.delete(listener);
}

export function getYCReplayState() {
    return {
        isReplaying: isYCReplaying,
        isPaused: ycReplayPaused,
        currentFrame: ycReplayIndex,
        totalFrames: ycReplayFrames ? ycReplayFrames.length : 0,
        fps: ycReplayFps,
    };
}
