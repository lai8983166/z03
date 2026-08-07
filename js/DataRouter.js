import { Utils, setLEDStatus } from "../main.js";
import statusBar from "./StatusBar.js";

let sendBuffer = new Uint8Array(1040);
let resolveAck = null;

export function initializeDataRouter() {
  Utils.loadCSVToTable(
    "./csv/SJL_SJCJ_Send.csv",
    "tableWidget_SJL_SJCJ_send",
    11,
    2,
  );

  Utils.centerAlignTable("tableWidget_SJL_SJCJ_send");

  Utils.loadCSVToTable(
    "./csv/SJL_SJCJ_Recv_0xFF.csv",
    "tableWidget_SJL_SJCJ_recv_0xFF",
    28,
    2,
  );

  Utils.centerAlignTable("tableWidget_SJL_SJCJ_recv_0xFF");
    set_tableWidget_SJL_SJCJ_recv_0xFF_MBXX();
    set_tableWidget_SJL_SJCJ_recv_YC();
    set_tableWidget_SJL_TB_B();

  Utils.loadCSVToTable(
    "./csv/SJL_SJCJ_Recv_0x00.csv",
    "tableWidget_SJL_SJCJ_recv_0x00",
    31,
    2,
  );

    Utils.centerAlignTable("tableWidget_SJL_SJCJ_recv_0x00");

    let sjlSjcjTimer = null;
    const btnSJL_A = document.getElementById("pushbutton_SJL_A");
    btnSJL_A.addEventListener("click", () => {
        if (sjlSjcjTimer !== null) {
            clearInterval(sjlSjcjTimer);
            sjlSjcjTimer = null;
            btnSJL_A.textContent = "发送数据链数据采集A帧";
            statusBar.sendMessage("已停止发送数据链数据采集A帧", "gray");
        } else {
            loadCommand_SJL_SJCJ();
            sjlSjcjTimer = setInterval(() => {
                loadCommand_SJL_SJCJ();
            }, 50);
            btnSJL_A.textContent = "停止发送数据链数据采集A帧";
        }
    })

    document.getElementById("pushtton_SJL_TB_A").addEventListener("click", () => {
        loadCommand_SJLTB_A();
    })
}

const set_tableWidget_SJL_TB_B = () => {
    Utils.setTableCellText(
        "tableWidget_SJL_TB_B",
        0,
        0,
        "当前使用的工作频点WSJ1",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_TB_B",
        1,
        0,
        "当前使用的工作频点WSJ2",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_TB_B",
        2,
        0,
        "当前使用的工作频点WSJ3",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_TB_B",
        3,
        0,
        "当前使用的工作频点WSJ4",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_TB_B",
        4,
        0,
        "当前使用的工作频点WSJ5",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_TB_B",
        5,
        0,
        "当前使用的工作频点WSJ6",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_TB_B",
        6,
        0,
        "当前使用的频率代号WSJN",
    );
}

const set_tableWidget_SJL_SJCJ_recv_YC = () => {
    
    Utils.setTableCellText(
        "tableWidget_SJL_SJCJ_recv_YC",
        0,
        0,
        "上行CRC比对结果",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_SJCJ_recv_YC",
        1,
        0,
        "当前工作天线",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_SJCJ_recv_YC",
        2,
        0,
        "成员编号比对标识",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_SJCJ_recv_YC",
        3,
        0,
        "SPL",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_SJCJ_recv_YC",
        4,
        0,
        "同步状态",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_SJCJ_recv_YC",
        5,
        0,
        "HH/HK比对标志",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_SJCJ_recv_YC",
        6,
        0,
        "数据链内部状态",
    );
    Utils.setTableCellText(
        "tableWidget_SJL_SJCJ_recv_YC",
        7,
        0,
        "SGDN",
    );
}

const set_tableWidget_SJL_SJCJ_recv_0xFF_MBXX = () => {
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    0,
    0,
    "载机号HH",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    1,
    0,
    "通道号HK",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    2,
    0,
    "攻击模式AM",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    3,
    0,
    "制导机编号GDN",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    4,
    0,
    "载机端接收标志HRDCF",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    5,
    0,
    "接力制导标志PL",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    6,
    0,
    "接力制导标志有效性PLV",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    7,
    0,
    "群目标标志GC",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    8,
    0,
    "目标数量TN",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    9,
    0,
    "目标经度LON",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    10,
    0,
    "目标纬度LAT",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    11,
    0,
    "目标海高THO",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    12,
    0,
    "目标速度TVx",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    13,
    0,
    "目标速度TVy",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    14,
    0,
    "目标速度TVz",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    15,
    0,
    "方位角数据及准确度有效性AEV",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    16,
    0,
    "方位角准确度AE",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    17,
    0,
    "俯仰角数据及准确度有效性PEV",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    18,
    0,
    "俯仰角准确度PE",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    19,
    0,
    "距离数据及准确度有效性DEV",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    20,
    0,
    "目标距离准确度DE",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    21,
    0,
    "速度数据及准确度有效性VEV",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    22,
    0,
    "目标速度准确度VE",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    23,
    0,
    "目标相对地表高度有效性HV",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    24,
    0,
    "目标相对地表高度THPO",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    25,
    0,
    "地形标识LF",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    26,
    0,
    "目标RCS类型可信度DR",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    27,
    0,
    "目标RCS类型TR",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    28,
    0,
    "目标尺寸类型可信度DT",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    29,
    0,
    "目标尺寸类型TC",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    30,
    0,
    "目标信息递推标志TIED",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    31,
    0,
    "目标红外辐射类型标志TIR",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    32,
    0,
    "目标红外辐射类型可信度DIR",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    33,
    0,
    "被攻击机经度LAT",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    34,
    0,
    "被攻击机纬度LON",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    35,
    0,
    "被攻击机海高HO",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    36,
    0,
    "被攻击机速度Vx",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    37,
    0,
    "被攻击机速度Vy",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    38,
    0,
    "被攻击机速度Vz",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    39,
    0,
    "被攻击机AccX",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    40,
    0,
    "被攻击机AccY",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    41,
    0,
    "被攻击机AccZ",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    42,
    0,
    "目标侦听序号TSF",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    43,
    0,
    "制导机/被攻击机信息标志AType",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    44,
    0,
    "自毁指令有效性SDV",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    45,
    0,
    "自毁指令SD",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    46,
    0,
    "目标信息时标T-TIME-TAG",
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    47,
    0,
    "被攻击机时标P-TIME-TAG",
  );
};

const loadCommand_SJL_SJCJ = () => {
  sendBuffer[0] = 0x31;
  sendBuffer[1] = 0x02;
  sendBuffer[2] = 0x01;
  sendBuffer[3] = 0x50;
  sendBuffer[4] = 0x00;
  sendBuffer[5] = 0x00;
  sendBuffer[6] = 0x19;
  sendBuffer[7] = 0x00;
  sendBuffer[8] = 0x00;
  sendBuffer[9] = 0x00;
  sendBuffer[10] = 0x00;
  sendBuffer[11] = 0x00;
  sendBuffer[12] = 0x4a; // AR_DYT
  sendBuffer[13] = 0x52; // AT_JK
  sendBuffer[14] = 0x00;
  sendBuffer[15] = 0x10; //1000H

  // 按 16位字(Word) 构建数据---
  const W = new Uint16Array(10); // 下标 0~9 对应 Word 1~10

  // 提取 UI 值 (不需要比例因子的直接取整参与位移)
  const Mtype = Number(document.getElementById("SJL_Mtype").value) || 0;
  const SPL = Number(document.getElementById("SJL_SPL").value) || 0;
  const CA = Number(document.getElementById("SJL_CA").value) || 0;
  const SGDN = Number(document.getElementById("SJL_SGDN").value) || 0;
  const SAM = Number(document.getElementById("SJL_SAM").value) || 0;

  // 字 1: MType(3) + SPL(1) + CA(2) + 0(2) + 0(1) + SGDN(3) + SAM(4)
  W[0] =
    ((Mtype & 0x07) << 13) |
    ((SPL & 0x01) << 12) |
    ((CA & 0x03) << 10) |
    ((SGDN & 0x07) << 4) |
    (SAM & 0x0f);

  // 经纬度 24位提取与逆运算缩放：实际值 * 2^23 / 90.0
  const LON = Number(document.getElementById("SJL_LON").value) || 0;
  const LAT = Number(document.getElementById("SJL_LAT").value) || 0;
  const lon_24 = Math.round((LON * (1 << 23)) / 90.0) & 0xffffff;
  const lat_24 = Math.round((LAT * (1 << 23)) / 90.0) & 0xffffff;

  // 字 2: 导弹 LON (低16位)
  W[1] = lon_24 & 0xffff;

  // 字 3: 导弹 LAT (低8位) 作为 MSB(高字节) + 导弹 LON (高8位) 作为 LSB(低字节)
  const lat_low8 = lat_24 & 0xff;
  const lon_high8 = (lon_24 >> 16) & 0xff;
  W[2] = (lat_low8 << 8) | lon_high8;

  // 字 4: 导弹 LAT (高16位)
  W[3] = (lat_24 >> 8) & 0xffff;

  // 字 5: 导弹 MHO (16位，LSB=1m)
  const MHO = Number(document.getElementById("SJL_MHO").value) || 0;
  W[4] = Math.round(MHO) & 0xffff;

  // ==== 速度及对应标志位提取与逆运算缩放：LSB = 2.5m/s ====
  const MVx_UI = Number(document.getElementById("SJL_MVx").value) || 0;
  const MVx = Math.round(MVx_UI / 2.5) & 0x03ff; // 取10位补码
  const EWI = Number(document.getElementById("SJL_EWI").value) || 0;

  // 字 6: MVx(10位) + EWI(1位) + 0(5位)
  // EWI占第11位，所以左移5位，后面5位全0
  W[5] = (MVx << 6) | ((EWI & 0x01) << 5);

  const MVy_UI = Number(document.getElementById("SJL_MVy").value) || 0;
  const MVy = Math.round(MVy_UI / 2.5) & 0x03ff; // 取10位补码
  const MCT = Number(document.getElementById("SJL_MCT").value) || 0;

  // 字 7: MVy(10位) + 0(2位) + MCT(3位) + 0(1位)
  // MCT从第13位开始占3位(即占据13、14、15位)，所以左移1位
  W[6] = (MVy << 6) | ((MCT & 0x07) << 1);

  const MVz_UI = Number(document.getElementById("SJL_MVz").value) || 0;
  const MVz = Math.round(MVz_UI / 2.5) & 0x03ff; // 取10位补码
  const MS1 = Number(document.getElementById("SJL_MS1").value) || 0;
  const MS2 = Number(document.getElementById("SJL_MS2").value) || 0;
  const MS3 = Number(document.getElementById("SJL_MS3").value) || 0;
  const MS4 = Number(document.getElementById("SJL_MS4").value) || 0;
  const MS5 = Number(document.getElementById("SJL_MS5").value) || 0;
  const MS6 = Number(document.getElementById("SJL_MS6").value) || 0;

  // 字 8: MVz(10位) + MS1~MS6(各1位，共6位)
  // MS1~MS6从第11位开始直到第16位
  W[7] =
    (MVz << 6) |
    ((MS1 & 0x01) << 5) |
    ((MS2 & 0x01) << 4) |
    ((MS3 & 0x01) << 3) |
    ((MS4 & 0x01) << 2) |
    ((MS5 & 0x01) << 1) |
    (MS6 & 0x01);

  // 字 9: 0 (全部填0)
  W[8] = 0x0000;

  // 字 10: M-TIME-TAG (LSB=1ms)
  const M_TIME_TAG =
    Number(document.getElementById("SJL_M-TIME-TAG").value) || 0;
  W[9] = Math.round(M_TIME_TAG) & 0xffff;

  // --- 3. 将 16位字写入 ---
  for (let i = 0; i < 10; i++) {
    const byteOffset = 16 + i * 2;
    sendBuffer[byteOffset] = W[i] & 0xff; // 小端：低字节在前
    sendBuffer[byteOffset + 1] = (W[i] >> 8) & 0xff; // 小端：高字节在后
  }

  // --- 4. 附加标志位 ---
  const FLAG_TX = Number(document.getElementById("SJL_FLAG-TX").value) || 0;
  const FLAG_LJ = Number(document.getElementById("SJL_FLAG-LJ").value) || 0;
  sendBuffer[36] = (FLAG_TX & 0x03) | ((FLAG_LJ & 0x01) << 2);

 
    wsClient.sendUdp(sendBuffer);
    /*const HexString = Array.from(sendBuffer)
        .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
        .join(" ");
    console.log(
        `数据链数据采集A帧：`
    );
    console.log(HexString);*/
  statusBar.sendMessage("发送数据链数据采集A帧", "0100H");
};

export const handle_SJL_SJCJ_Recv_0xFF = (data) => {
  MBXX(data);

  // 数据链遥测 SJL_YC (2U, data[43], data[44])
  const W_YC = data[43] | (data[44] << 8);
  const CRC_Status = (W_YC >> 15) & 0x01; // Bit15: 上行CRC比对结果 (0:正确 1:错误)
  const Antenna = (W_YC >> 13) & 0x03; // Bit14~13: 当前工作天线
  const Member_Match = (W_YC >> 11) & 0x01; // Bit11: 成员编号比对标识
  const SPL_Status = (W_YC >> 10) & 0x01; // Bit10: SPL
  const Sync_Status = (W_YC >> 9) & 0x01; // Bit9: 同步状态
  const HH_HK_Match = (W_YC >> 8) & 0x01; // Bit8: HH/HK比对标志 (置1)
  const YC_Backup = (W_YC >> 3) & 0x1f; // Bit7~3: 备份
  const SGDN = W_YC & 0x07; // Bit2~0: SGDN

  // (均为 2U 无符号16位整形)
  const TimeDiff = data[45] | (data[46] << 8); // 接收射频帧与基准时间差
  const PAPR = data[47] | (data[48] << 8); // 峰均比
  const FreqOffset = data[49] | (data[50] << 8); // 频偏
  const AGC_Vol = data[51] | (data[52] << 8); // AGC电压
  const PowerEst = data[53] | (data[54] << 8); // 有效信号功率估计(相对值)

  const tb = "tableWidget_SJL_SJCJ_recv_0xFF";
    const tb_YC = "tableWidget_SJL_SJCJ_recv_YC";

    Utils.setTableCellText(tb_YC,  0, 1, CRC_Status);
    Utils.setTableCellText(tb_YC,  1, 1, Antenna);
    Utils.setTableCellText(tb_YC,  2, 1, Member_Match);
    Utils.setTableCellText(tb_YC,  3, 1, SPL_Status);
    Utils.setTableCellText(tb_YC,  4, 1, Sync_Status);
    Utils.setTableCellText(tb_YC,  5, 1, HH_HK_Match);
    Utils.setTableCellText(tb_YC,  6, 1, YC_Backup);
    Utils.setTableCellText(tb_YC,  7, 1, SGDN);
  Utils.setTableCellText(tb,  23, 1, TimeDiff);
  Utils.setTableCellText(tb,  24, 1, PAPR);
  Utils.setTableCellText(tb,  25, 1, FreqOffset);
  Utils.setTableCellText(tb,  26, 1, AGC_Vol);
  Utils.setTableCellText(tb,  27, 1, PowerEst);
  statusBar.receiveMessage("收到数据链采集B帧","1000H");
};

export const handle_SJL_SJCJ_Recv_0x00 = (data) => {
  MBXX(data);

  // 数据链遥测 SJL_YC (2U, data[43], data[44])
  const W_YC = data[43] | (data[44] << 8);
  const CRC_Status = (W_YC >> 15) & 0x01; // Bit15: 上行CRC比对结果 (0:正确 1:错误)
  const Antenna = (W_YC >> 13) & 0x03; // Bit14~13: 当前工作天线
  const Member_Match = (W_YC >> 11) & 0x01; // Bit11: 成员编号比对标识
  const SPL_Status = (W_YC >> 10) & 0x01; // Bit10: SPL
  const Sync_Status = (W_YC >> 9) & 0x01; // Bit9: 同步状态
  const HH_HK_Match = (W_YC >> 8) & 0x01; // Bit8: HH/HK比对标志 (置0)
  const Datalink_Status = (W_YC >> 3) & 0x1f; // Bit7~3: 数据链内部状态标志
  const SGDN = W_YC & 0x07; // Bit2~0: SGDN

  const AD_Amp = data[45] | (data[46] << 8); // AD幅度 (2U)

  // 当前使用的伪随机数 (1U*6，共6个字节，转为 Hex 字符串显示)
  const prnArray = Array.from(data.slice(47, 53));
  const PRN_Hex = prnArray
    .map((b) => b.toString(16).padStart(2, "0").toUpperCase())
    .join(" ");

  const CurrentFreq = data[53] | (data[54] << 8); // 当前使用的频率 (2U)

    const tb = "tableWidget_SJL_SJCJ_recv_0x00";
    const tb_YC = "tableWidget_SJL_SJCJ_recv_YC";

    Utils.setTableCellText(tb_YC,  0, 1, CRC_Status);
    Utils.setTableCellText(tb_YC,  1, 1, Antenna);
    Utils.setTableCellText(tb_YC,  2, 1, Member_Match);
    Utils.setTableCellText(tb_YC,  3, 1, SPL_Status);
    Utils.setTableCellText(tb_YC, 4, 1, Sync_Status);
    Utils.setTableCellText(tb_YC,  5, 1, HH_HK_Match);
    Utils.setTableCellText(tb_YC,  6, 1, Datalink_Status);
    Utils.setTableCellText(tb_YC,  7, 1, SGDN);
  Utils.setTableCellText(tb,  23, 1, AD_Amp);
  Utils.setTableCellText(tb,  29, 1, PRN_Hex);
  Utils.setTableCellText(tb,  30, 1, CurrentFreq);

  statusBar.receiveMessage("收到数据链采集B帧","1000H");
};

const MBXX = (data) => {
  // 构建16位字数组，根据小端模式(低字节在前，高字节在后)将相邻字节合并
  const W = new Uint16Array(21); // 下标 0~20 对应 Word 1~21
  for (let i = 0; i < 21; i++) {
    W[i] = data[i * 2+1] | (data[i * 2 + 2] << 8);
  }

  // 有符号位扩展
  const sign_extend_24 = (val) => (val & 0x800000 ? val - 0x1000000 : val);
  const sign_extend_16 = (val) => (val & 0x8000 ? val - 0x10000 : val);
  const sign_extend_10 = (val) => (val & 0x200 ? val - 0x400 : val);

  // ===================================
  // 字 1
  // ===================================
  const TSF = (W[0] >> 13) & 0x07;
  const HH = (W[0] >> 8) & 0x1f;
  const HK = (W[0] >> 5) & 0x07;
  const AM = W[0] & 0x1f;
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 42, 1, TSF);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 0, 1, HH);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 1, 1, HK);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 2, 1, AM);

  // ===================================
  // 字 2
  // ===================================
  const GDN = (W[1] >> 13) & 0x07;
  const HRDCF = (W[1] >> 12) & 0x01;
  const PL = (W[1] >> 11) & 0x01;
  const PLV = (W[1] >> 10) & 0x01;
  const GC = (W[1] >> 9) & 0x01;
  const TN = (W[1] >> 6) & 0x07;
  const SDV = (W[1] >> 3) & 0x01;
  const AType = (W[1] >> 2) & 0x01;
  const TIED = W[1] & 0x03;
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 3, 1, GDN);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 4, 1, HRDCF);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 5, 1, PL);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 6, 1, PLV);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 7, 1, GC);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 8, 1, TN);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 44, 1, SDV);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 43, 1, AType);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 30, 1, TIED);

  // ===================================
  // 字 3 ~ 字 5: 目标经纬度
  // ===================================
  const LON_low16 = W[2];
  const LAT_low8 = (W[3] >> 8) & 0xff;
  const LON_high8 = W[3] & 0xff;
  const LAT_high16 = W[4];

  const LON_val =
    (sign_extend_24((LON_high8 << 16) | LON_low16) * 90.0) / (1 << 23);
  const LAT_val =
    (sign_extend_24((LAT_high16 << 8) | LAT_low8) * 90.0) / (1 << 23);
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    9,
    1,
    LON_val.toFixed(6),
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    10,
    1,
    LAT_val.toFixed(6),
  );

  // ===================================
  // 字 6: 目标 THO
  // ===================================
  const THO = sign_extend_16(W[5]);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 11, 1, THO);

  // ===================================
  // 字 7 ~ 字 9: 目标速度及对应准确度
  // ===================================
  const TVx = sign_extend_10((W[6] >> 6) & 0x03ff) * 3.0;
  const AE = (W[6] & 0x3f) * 0.1;
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    12,
    1,
    TVx.toFixed(1),
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    16,
    1,
    AE.toFixed(1),
  );

  const TVy = sign_extend_10((W[7] >> 6) & 0x03ff) * 3.0;
  const PE = (W[7] & 0x3f) * 0.1;
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    13,
    1,
    TVy.toFixed(1),
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    18,
    1,
    PE.toFixed(1),
  );

  const TVz = sign_extend_10((W[8] >> 6) & 0x03ff) * 3.0;
  const DEV = (W[8] >> 5) & 0x01;
  const DE = (W[8] & 0x1f) * 200;
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    14,
    1,
    TVz.toFixed(1),
  );
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 19, 1, DEV);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 20, 1, DE);

  // ===================================
  // 字 10: HV / THPO / VEV / VE
  // ===================================
  const HV = (W[9] >> 15) & 0x01;
  const THPO = ((W[9] >> 6) & 0x01ff) * 12.5;
  const VEV = (W[9] >> 5) & 0x01;
  const VE = (W[9] & 0x1f) * 25;
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 23, 1, HV);
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    24,
    1,
    THPO.toFixed(1),
  );
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 21, 1, VEV);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 22, 1, VE);

  // ===================================
  // 字 11: 多个标志位
  // ===================================
  const AEV = (W[10] >> 15) & 0x01;
  const PEV = (W[10] >> 14) & 0x01;
  const LF = (W[10] >> 12) & 0x03;
  const DR = (W[10] >> 11) & 0x01;
  const TR = (W[10] >> 8) & 0x07;
  const DT = (W[10] >> 7) & 0x01;
  const TC = (W[10] >> 4) & 0x07;
  const DIR = (W[10] >> 3) & 0x01;
  const TIR = W[10] & 0x07;
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 15, 1, AEV);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 17, 1, PEV);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 25, 1, LF);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 26, 1, DR);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 27, 1, TR);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 28, 1, DT);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 29, 1, TC);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 32, 1, DIR);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 31, 1, TIR);

  // ===================================
  // 字 12 ~ 字 14: 被攻击机 (或制导机) 经纬度
  // ===================================
  const P_LON_low16 = W[11];
  const P_LAT_low8 = (W[12] >> 8) & 0xff;
  const P_LON_high8 = W[12] & 0xff;
  const P_LAT_high16 = W[13];

  const P_LON_val =
    (sign_extend_24((P_LON_high8 << 16) | P_LON_low16) * 90.0) / (1 << 23);
  const P_LAT_val =
    (sign_extend_24((P_LAT_high16 << 8) | P_LAT_low8) * 90.0) / (1 << 23);
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    34,
    1,
    P_LON_val.toFixed(6),
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    33,
    1,
    P_LAT_val.toFixed(6),
  );

  // ===================================
  // 字 15: 被攻击机 H0
  // ===================================
  const P_HO = sign_extend_16(W[14]);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 35, 1, P_HO);

  // ===================================
  // 字 16 ~ 字 19: 被攻击机速度及加速度 (非常规穿插打包)
  // ===================================
  const P_Vx = sign_extend_10((W[15] >> 6) & 0x03ff) * 0.3;
  const AccY_high6 = W[15] & 0x3f;

  const P_Vy = sign_extend_10((W[16] >> 6) & 0x03ff) * 0.3;
  const AccY_low4 = (W[16] >> 2) & 0x0f;
  const SD_high2 = W[16] & 0x03;

  const P_Vz = sign_extend_10((W[17] >> 6) & 0x03ff) * 0.3;
  const AccZ_high6 = W[17] & 0x3f;

  const AccX = sign_extend_10((W[18] >> 6) & 0x03ff) * 0.3;
  const AccZ_low4 = (W[18] >> 2) & 0x0f;
  const SD_low2 = W[18] & 0x03;

  const AccY = sign_extend_10((AccY_high6 << 4) | AccY_low4) * 0.3;
  const AccZ = sign_extend_10((AccZ_high6 << 4) | AccZ_low4) * 0.3;
  const SD = (SD_high2 << 2) | SD_low2;

  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    36,
    1,
    P_Vx.toFixed(1),
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    37,
    1,
    P_Vy.toFixed(1),
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    38,
    1,
    P_Vz.toFixed(1),
  );

  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    39,
    1,
    AccX.toFixed(1),
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    40,
    1,
    AccY.toFixed(1),
  );
  Utils.setTableCellText(
    "tableWidget_SJL_SJCJ_recv_0xFF_MBXX",
    41,
    1,
    AccZ.toFixed(1),
  );
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 45, 1, SD);

  // ===================================
  // 字 20 和 字 21: 时标
  // ===================================
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 46, 1, W[19]);
  Utils.setTableCellText("tableWidget_SJL_SJCJ_recv_0xFF_MBXX", 47, 1, W[20]);
};

export const loadCommand_SJLTB_A = () => {
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
    sendBuffer[12] = 0x4a; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0x20; //2000H
  const offset = 16;

  // 1. 载机编号和数据链通道号 HHK (2U)
  const channel = Number(document.getElementById("CP_T_Channel").value) || 0; // bit0-3
  const aircraftId =
    Number(document.getElementById("CP_T_AircraftId").value) || 0; // bit4-8
  const tsfFlag = Number(document.getElementById("CP_T_TSFFlag").value) || 0; // bit9-11
  const HHK =
    (channel & 0x0f) | ((aircraftId & 0x1f) << 4) | ((tsfFlag & 0x07) << 9);
  sendBuffer[offset] = HHK & 0xff;
  sendBuffer[offset + 1] = (HHK >> 8) & 0xff;

  // 2. 发送同步命令帧时刻 Time0 (4U) - 比例尺 40us
  const Time0_UI = Number(document.getElementById("CP_T_Time0").value) || 0;
  const Time0 = Math.round(Time0_UI / 40) >>> 0;
  sendBuffer[offset + 2] = Time0 & 0xff;
  sendBuffer[offset + 3] = (Time0 >> 8) & 0xff;
  sendBuffer[offset + 4] = (Time0 >> 16) & 0xff;
  sendBuffer[offset + 5] = (Time0 >> 24) & 0xff;

  // 3. 伪随机数产生时间 Time23 (4U) - 比例尺 40us
  const Time23_UI = Number(document.getElementById("CP_T_Time23").value) || 0;
  const Time23 = Math.round(Time23_UI / 40) >>> 0;
  sendBuffer[offset + 6] = Time23 & 0xff;
  sendBuffer[offset + 7] = (Time23 >> 8) & 0xff;
  sendBuffer[offset + 8] = (Time23 >> 16) & 0xff;
  sendBuffer[offset + 9] = (Time23 >> 24) & 0xff;

  // 4~9. 工作频点 CS1 ~ CS6 (各 2U)
  for (let i = 0; i < 6; i++) {
    const csVal = Number(document.getElementById(`CP_T_CS${i + 1}`).value) || 0;
    const val = csVal === 166 ? 0xa6a6 : csVal & 0xffff;
    sendBuffer[offset + 10 + i * 2] = val & 0xff;
    sendBuffer[offset + 11 + i * 2] = (val >> 8) & 0xff;
  }

  // 10. 跳频起始位置 POS (2U)
  const POS = Number(document.getElementById("CP_T_POS").value) || 0;
  sendBuffer[offset + 22] = POS & 0xff;
  sendBuffer[offset + 23] = (POS >> 8) & 0xff;

  wsClient.sendUdp(sendBuffer);
  statusBar.sendMessage("发送数据链同步A帧(CP_T)", "成功");
};

export const handle_SJLTB_B = (data) => {
  statusBar.receiveMessage("收到数据链同步B帧","2000H");
  Utils.setTableCellText("tableWidget_SJL_TB_B", 0, 1, data[0]||(data[1]<<8));
  Utils.setTableCellText("tableWidget_SJL_TB_B", 1, 1, data[2]||(data[3]<<8));
  Utils.setTableCellText("tableWidget_SJL_TB_B", 2, 1, data[4]||(data[5]<<8));
  Utils.setTableCellText("tableWidget_SJL_TB_B", 3, 1, data[6]||(data[7]<<8));
  Utils.setTableCellText("tableWidget_SJL_TB_B", 4, 1, data[8]||(data[9]<<8));
  Utils.setTableCellText("tableWidget_SJL_TB_B", 5, 1, data[10]||(data[11]<<8));
  Utils.setTableCellText("tableWidget_SJL_TB_B", 6, 1, data[12]||(data[13]<<8));
}
/*
export const handle_SJLTB_A = (data) => {
  
  const offset = 16;
  const W1 = data[offset] | (data[offset + 1] << 8);
  const channel = W1 & 0x0f;
  const aircraftId = (W1 >> 4) & 0x1f;
  const tsfFlag = (W1 >> 9) & 0x07;

  const Time0 =
    (data[offset + 2] |
      (data[offset + 3] << 8) |
      (data[offset + 4] << 16) |
      (data[offset + 5] << 24)) >>>
    0;
  const Time0_val = Time0 * 40; // 单位 us

  const Time23 =
    (data[offset + 6] |
      (data[offset + 7] << 8) |
      (data[offset + 8] << 16) |
      (data[offset + 9] << 24)) >>>
    0;
  const Time23_val = Time23 * 40; // 单位 us

  const CS = [];
  for (let i = 0; i < 6; i++) {
    CS.push(data[offset + 10 + i * 2] | (data[offset + 11 + i * 2] << 8));
  }
  const POS = data[offset + 22] | (data[offset + 23] << 8);

  const tb = "tableWidget_CP_T_recv"; // 假设的 UI 表格 ID
  // Utils.setTableCellText(tb, 0, 1, channel);
  // (在此处根据实际界面映射填写 Utils.setTableCellText 调用)
  console.log({ channel, aircraftId, tsfFlag, Time0_val, Time23_val, CS, POS });
};

// ==========================================
// A.12 取数据链同步 B 帧命令 (SP_T) 共 14 字节
// ==========================================
export const loadCommand_SJLTB_B = () => {
  const offset = 16;

  // 1~6. 工作频点 WSJ1 ~ WSJ6 (各 2U)
  for (let i = 0; i < 6; i++) {
    const wsjVal =
      Number(document.getElementById(`SP_T_WSJ${i + 1}`).value) || 0;
    sendBuffer[offset + i * 2] = wsjVal & 0xff;
    sendBuffer[offset + 1 + i * 2] = (wsjVal >> 8) & 0xff;
  }

  // 7. 频率代号 WSJN (2U)
  const WSJN = Number(document.getElementById("SP_T_WSJN").value) || 0;
  sendBuffer[offset + 12] = WSJN & 0xff;
  sendBuffer[offset + 13] = (WSJN >> 8) & 0xff;

  wsClient.sendUdp(sendBuffer);
  statusBar.sendMessage("发送数据链同步B帧(SP_T)", "成功");
};

export const handle_SJLTB_B = (data) => {
  const offset = 16;
  const WSJ = [];
  for (let i = 0; i < 6; i++) {
    WSJ.push(data[offset + i * 2] | (data[offset + 1 + i * 2] << 8));
  }
  const WSJN = data[offset + 12] | (data[offset + 13] << 8);

  const tb = "tableWidget_SP_T_recv"; // 假设的 UI 表格 ID
  // Utils.setTableCellText(tb, 0, 1, WSJ[0]);
  // (在此处根据实际界面映射填写 Utils.setTableCellText 调用)
  console.log({ WSJ, WSJN });
};*/
