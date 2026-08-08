import { Utils, setLEDStatus } from "../main.js";
import PacketManager from "./BinaryTableHelper";
import {
  handleVideoFrame,
  convert16to8bit,
  set_CurrentFrame,
} from "./Video.js";
import { isSavingJG, tryUpdateLaserImage1Hz } from "./Laser.js";
import wsClient from "./Client.js";
import { isSavingVideo } from "./Video.js";
import statusBar from "./StatusBar.js";

// 黑匣子保存状态
export let isSavingBlackbox = false;

// 黑匣子数据保存到 Excel 状态
export let isSavingHeixiaziExcel = false;

let packetCount = 0;
let cur_offset = 0;
let buffer = new Uint8Array(50000);

// 二值图 canvas 上下文
let ctxBinary = null;

export function initializeTelemeter() {
  Utils.loadCSVToTable("./csv/YCTX_Recv.csv", "tableWidget_YCTX", 34, 8);
  Utils.centerAlignTable("tableWidget_YCTX");

  Utils.setTableCellText("ztz-table",0,0,"同步/制冷到位状态");
  Utils.setTableCellText("ztz-table",1,0,"AD/测温二极管自检结果");
  Utils.setTableCellText("ztz-table",2,0,"红外积分时间");
  Utils.setTableCellText("ztz-table",3,0,"激光发射温控出光状态");

  Utils.setTableCellText("zlz-table",0,0,"解锁响应");
  Utils.setTableCellText("zlz-table",1,0,"有无回波");
  Utils.setTableCellText("zlz-table",2,0,"GIF信息引爆来源");
  Utils.setTableCellText("zlz-table",3,0,"自毁响应");

  // 初始化黑匣子二值图 canvas
  const binaryContainer = document.getElementById("yctx-binary-widget");
  if (binaryContainer) {
    const canvas = document.createElement("canvas");
    canvas.width = 384;
    canvas.height = 384;
    binaryContainer.appendChild(canvas);
    ctxBinary = canvas.getContext("2d");
  }

  // 绑定黑匣子Excel 保存按钮
  const btnStartHeixiaziExcel = document.getElementById("pushButton_Start_Save_HeixiaziExcel");
  const btnStopHeixiaziExcel  = document.getElementById("pushButton_Stop_Save_HeixiaziExcel");
  if (btnStartHeixiaziExcel) btnStartHeixiaziExcel.addEventListener("click", startSavingHeixiaziExcel);
  if (btnStopHeixiaziExcel)  btnStopHeixiaziExcel.addEventListener("click",  stopSavingHeixiaziExcel);
}

//1280
export const handle_YC_DATA_Per = async (msg) => {
  if (window.isBlackboxReplaying) return; // 回放黑匣子时，屏蔽实时遥测数据
  
  //let msg_data=msg;
  //console.log(msg);
  //console.log(typeof(msg));
  const data=msg.slice(12);
  //console.log(data);
  //const data=msg_data.subarray(12);
  //console.log("handle_YC_DATA_Per",data);
  //console.log(msg[4]);
  //console.log(packetCount);
  if(packetCount!=msg[4]){console.log("noteq");return;}
  //console.log(msg[4]);
  packetCount += 1;
  //let data_per = data;
  buffer.set(data, cur_offset);
  //console.log("buffer", buffer);

  // console.log("buffer", buffer);
  if (packetCount == 32) {
    //console.log("buffer",buffer);
    //frame_count+=1;
    //if(frame_count%5==0){await handle_YC_DATA(buffer);frame_count=0;}
    //console.log("heixiazi");
    await handle_YC_DATA(buffer)
    
    cur_offset = 0;
    packetCount = 0;
  } else if (packetCount == 1) {
    /*const HexString = Array.from(data_per)
      .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
      .join(" ");
    console.log(HexString);*/
    cur_offset += 1280;
  } else {
    cur_offset += 1280;
  }
};

export const handle_YC_DATA = async (data) => {
  //console.log("handle_YC_DATA", data.length);
  const image_data = data.subarray(0, 32768);
  //console.log(image_data);
  if (!window.isBlackboxReplaying) {
    // 如果处于保存状态，将原始16位图像帧发给服务端保存
    if (isSavingVideo) {
      const frame = new Uint8Array(image_data);
      const packet = new Uint8Array(1 + frame.length);
      packet[0] = 0xf0; // 视频帧保存魔术字节
      packet.set(frame, 1);
      wsClient.sendUdp(packet);
    }
    let JG_buffer = data.subarray(32781, 32889);
    // 如果处于保存状态，将激光帧数据发给服务端保存
    if (isSavingJG) {
      const jgFrame = new Uint8Array(JG_buffer);
      const packet = new Uint8Array(1 + jgFrame.length);
      packet[0] = 0xf1; // 激光帧保存魔术字节
      packet.set(jgFrame, 1);
      wsClient.sendUdp(packet);
    }

    // 开始保存黑匣子（40960字节）
    if (isSavingBlackbox) {
      const blackboxFrame = data.subarray(0, 40960);
      const packet = new Uint8Array(1 + blackboxFrame.length);
      packet[0] = 0xf2; // 黑匣子保存魔术字节
      packet.set(blackboxFrame, 1);
      wsClient.sendUdp(packet);
    }
  }

  let JG_buffer = data.subarray(32781, 32889);

  /*const HexString = Array.from(JG_buffer)
        .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");

    console.log(HexString);*/

  const restData=data.subarray(32768,40960);
  /*const HexString = Array.from(restData)
        .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");

    console.log(HexString);*/
  const helper = PacketManager.get("YCTX_Recv");
  helper.loadBufferFromNet(restData);
  helper.updateAllToTable("tableWidget_YCTX");

  // 若正在保存黑匣子 Excel，将本帧数据发给服务端缓存
  if (isSavingHeixiaziExcel) {
    const now = new Date();
    const ts = now.toISOString().replace("T", " ").replace("Z", "");
    const values = helper.getAllValues();
    wsClient.sendText(JSON.stringify({
      type: "SAVE_HEIXIAZI_EXCEL_ROW",
      row: [ts, ...values],
    }));
  }

  /*const ztz=restData[13];
  const ztzTable=document.getElementById("ztz-table");
  const zt_tb_zl=ztz&0x03;
  const zt_ad_cw=(ztz>>2)&0x03;
  const zt_hwzlt=(ztz>>4)&0x03;
  const zt_jgq_wk=(ztz>>6)&0x03;
  Utils.setTableCellText(ztz-table, 0, 1, zt_tb_zl);
  Utils.setTableCellText(ztz-table, 1, 1, zt_ad_cw);
  Utils.setTableCellText(ztz-table, 2, 1, zt_hwzlt);
  Utils.setTableCellText(ztz-table, 3, 1, zt_jgq_wk);

  const zlz=restData[374];
  const zlzTable=document.getElementById("zlz-table");
  const zlz_jsxy=zlz&0x01;
  const zlz_ywhb=(zlz>>1)&0x01;
  const zlz_gif_ybly=(zlz>>2)&0x01;
  const zlz_zhxy=(zlz>>3)&0x01;
  Utils.setTableCellText(zlz-table, 0, 1, zlz_jsxy);
  Utils.setTableCellText(zlz-table, 1, 1, zlz_ywhb);
  Utils.setTableCellText(zlz-table, 2, 1, zlz_gif_ybly);
  Utils.setTableCellText(zlz-table, 3, 1, zlz_zhxy);*/
  //const image_data_8bit = convert16to8bit(image_data);
  handleVideoFrame(image_data, 128, 128);
  //console.log(image_data);
  // 以不超过 1Hz 的频率刷新激光图像（受 1Hz显示激光 开关控制）
  tryUpdateLaserImage1Hz(JG_buffer);

  // 二值图：取每个16位像素的最低位（bit0），白色=1，黑色=0，放大到384×384
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
        // image_data 是 Uint8Array，16位小端：低字节在前
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
};

// ==================== 黑匣子保存事件 ====================

export function startSavingBlackbox() {
  statusBar.sendMessage("请在服务端窗口选择黑匣子保存位置...", "none");
  const cmd = JSON.stringify({
    type: "REQUEST_SAVE_PATH",
    saveType: "blackbox",
    defaultName: "黑匣子.dat",
    filter: "数据文件 (*.dat)|*.dat|所有文件 (*.*)|*.*",
  });
  wsClient.sendText(cmd);
  console.log("[Telemeter] 请求服务端弹出黑匣子文件保存对话框");

  // 监听服务端回传的保存状态（一次性）
  const onStatus = (msg) => {
    if (msg.saveType !== "blackbox") return;
    wsClient.off("SAVE_STATUS", onStatus);
    if (msg.status === "started") {
      isSavingBlackbox = true;
      statusBar.sendMessage(`正在保存黑匣子 → ${msg.path}`, "none");
    } else if (msg.status === "cancelled") {
      statusBar.sendMessage("已取消保存黑匣子", "none");
    } else if (msg.status === "error") {
      statusBar.sendMessage(`黑匣子保存失败: ${msg.msg}`, "none");
    }
  };
  wsClient.on("SAVE_STATUS", onStatus);
}

export function stopSavingBlackbox() {
  if (isSavingBlackbox) {
    wsClient.sendText(
      JSON.stringify({
        type: "CONTROL_CMD",
        action: "STOP_SAVE_BLACKBOX",
      }),
    );
    isSavingBlackbox = false;
    statusBar.sendMessage("黑匣子数据保存已停止");
    console.log("[Telemeter] 停止保存黑匣子数据");
  }
}

// ==================== 黑匣子数据保存到 Excel ====================

/**
 * 开始保存黑匣子数据到 Excel
 * 先弹出保存路径对话框，确认路径后通知服务端创建文件并发送表头
 */
export function startSavingHeixiaziExcel() {
  if (isSavingHeixiaziExcel) return;
  statusBar.sendMessage("请在服务端窗口选择黑匣子 Excel 保存位置...", "none");

  const cmd = JSON.stringify({
    type: "REQUEST_SAVE_PATH",
    saveType: "heixiazi_excel",
    defaultName: "黑匣子遥测数据.xlsx",
    filter: "Excel 文件 (*.xlsx)|*.xlsx|所有文件 (*.*)|*.*",
  });
  wsClient.sendText(cmd);

  const onStatus = (msg) => {
    if (msg.saveType !== "heixiazi_excel") return;
    wsClient.off("SAVE_STATUS", onStatus);
    if (msg.status === "started") {
      isSavingHeixiaziExcel = true;
      // 服务端已就绪，发送表头（从当前 DOM 表格读取字段名）
      const helper = PacketManager.get("YCTX_Recv");
      const names = helper.getAllNames("tableWidget_YCTX");
      wsClient.sendText(JSON.stringify({
        type: "HEIXIAZI_EXCEL_HEADER",
        header: ["时间戳", ...names],
      }));
      statusBar.sendMessage(`正在保存黑匣子到 Excel → ${msg.path}`, "none");
    } else if (msg.status === "cancelled") {
      statusBar.sendMessage("已取消保存黑匣子 Excel", "none");
    } else if (msg.status === "error") {
      statusBar.sendMessage(`黑匣子 Excel 保存失败: ${msg.msg}`, "none");
    }
  };
  wsClient.on("SAVE_STATUS", onStatus);
}

/**
 * 停止保存黑匣子数据到 Excel，触发服务端写文件
 */
export function stopSavingHeixiaziExcel() {
  if (!isSavingHeixiaziExcel) return;
  isSavingHeixiaziExcel = false;
  wsClient.sendText(JSON.stringify({
    type: "CONTROL_CMD",
    action: "STOP_SAVE_HEIXIAZI_EXCEL",
  }));
  statusBar.sendMessage("黑匣子 Excel 保存已停止，正在写入文件...");
  console.log("[Telemeter] 停止保存黑匣子 Excel");
}
