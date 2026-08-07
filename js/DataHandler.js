/**
 * 数据处理模块dataHandler.js - 对应 C++ 的 receive_RS485() 回调
 * 根据 flag 分发到具体的业务处理函数
 */

//import { Utils, setLEDStatus } from "../main.js";
import {
  handle_CSZD_Recv_0100H,
  handle_CSZD_Recv_0200H,
  handle_GDCSZD_Recv_0300H,
  handle_BBH_0030H,
  handle_SelfTest_0002H,
  handle_GDCSZDXC_Recv_0400H,
  handle_GetSelfTestResult_0010H,
  handle_Shut_0004H,
  handle_Wake_0001H,
  handle_FJYJZ_Recv_0020H,
  handle_JGCSZD_Recv_0500H,
  handle_JGCSZDXC_Recv_0600H,
  handle_IRDetectParam_Recv_0700H,
  handle_IRDetectParamRequest_Recv_0800H,
  handle_SJCJ_Recv_010203H,
  handle_SJCJ_Recv_1000H,
    
    handle_SJCJ_Recv_F000H,
    handle_CSZD_Recv_4000H,
    handle_CSZD_Recv_3000H,
    handle_FJYJZ_2000H,
    handle_FJYJZJG_0020H,
    
} from "./Command.js";
// handle_ImageUpload_0B00H / handle_ImageUpload_Per_Frame_0B00H 已移至 ImageUploadClient.js 直接分发
import { handle_ImageUpload_0B00H, handle_ImageUpload_Per_Frame_0B00H, } from "./ImageUpload.js";
import {
    handle_CXSC_CodeUpload_HandShake_0615H_9000H,
    handle_CXSC_CodeUpload_HandShake_0616H_9000H,
    handle_CXSC_CodeDataUpload_Handshake_9000H,
    handle_CXSC_CodeUpload_9000H,
    handle_CXSC_CodeData_Check_9000H,
    handle_CXSC_Code_Write_9000H,
    handle_codeDownload_handshake_9000H,
    handle_codeDownload_a000H,
    handle_codedownload_crc,
    handle_6000H_response,
} from "./CodeUpload.js";
import {
    handle_SJL_SJCJ_Recv_0xFF,
    handle_SJL_SJCJ_Recv_0x00,
    handle_SJLTB_B,

} from "./DataRouter.js"
import { handle_YC_DATA_Per } from "./Telemeter.js";

/**
 * 主处理入口
 * @param {number} flag - RS485_Recv_Flag
 * @param {string} name - 命令名称
 * @param {Uint8Array} data - 原始数据 (十六进制字符串需先转换)
 */
export function handleRS485(flag, name, data, meta = null) {
  //console.log(`[DataHandler] Processing flag=${flag}, name=${name}`);

  switch (flag) {
    case 0:
          handle_FJYJZ_2000H(data);
      break;
    case 1:
      handle_Shut_0004H(data);
      break;
    case 2:
      handle_SelfTest_0002H();
      break;
    case 3:
      handle_CSZD_Recv_0100H(data);
      break;
    case 4: //废弃
      break;
    case 5:
      handle_BBH_0030H(data);
      break;
    case 6: 
          handle_CSZD_Recv_3000H(data);
      break;
    case 7: //非均匀校正应答0020H
      handle_FJYJZ_Recv_0020H(data);
      break;
    case 8: //废弃
      break;
    case 9: //todo:数据采集1000H
      handle_SJCJ_Recv_1000H(data);
      break;
    case 10:
      handle_GetSelfTestResult_0010H(data);
      break;
    case 11:
      handle_CSZD_Recv_0200H(data);
      break;
    case 12: //todo:一次指令0008H (协议中废弃？)
      handleOneCmd(data);
      break;
    case 13:
      handle_GDCSZD_Recv_0300H(data);
      break;
    case 14:
      handle_GDCSZDXC_Recv_0400H(data);
      break;
    case 15: //激光参数装订应答0500H
      handle_JGCSZD_Recv_0500H(data);
      break;
    case 16: //激光参数装订下传应答6000H
      handle_JGCSZDXC_Recv_0600H(data);
      break;
    case 17: //红外检测参数装订应答0700H
      handle_IRDetectParam_Recv_0700H(data);
      break;
    case 18: //红外检测参数下传应答0800H
      handle_IRDetectParamRequest_Recv_0800H(data);
      break;
    case 19:
      // 图像上传应答(0B00H) 现已通过独立 WS 通道(8082)接收，此处不再路由
      // handle_ImageUpload_0B00H / handle_ImageUpload_Per_Frame_0B00H
      // 由 ImageUploadClient.js 直接分发
          console.log("0b00");
          if (data[0] == 0x15) {
              handle_ImageUpload_0B00H(data);
          } else if (data[0] == 0x40) {
              handle_ImageUpload_Per_Frame_0B00H(data);
          }
      break;
    case 20:
      handle_SJCJ_Recv_010203H();
      break;
    case 21: //TODO: 数据采集命令 F000H
          handle_SJCJ_Recv_F000H(data);
          break;
      case 22:
          handle_CSZD_Recv_4000H(data);
          break;
      case 23:
          handle_SJCJ_Recv_F000H(data);

          break;
      case 24:
          if (data[0] == 0x15) {
              if (data.length < 3) {
                  handle_CXSC_CodeUpload_HandShake_0615H_9000H(data);
              } else { handle_CXSC_CodeDataUpload_Handshake_9000H(data); }
          }
          else if (data[0] == 0x16) { handle_CXSC_CodeUpload_HandShake_0616H_9000H(data); }
          else if (data[0] == 0x40) { handle_CXSC_CodeUpload_9000H(data); }
          else if (data[0] == 0x55) { handle_CXSC_CodeData_Check_9000H(data); }
          else if (data[0] == 0x65) { handle_CXSC_Code_Write_9000H(data);}
          break;
      case 25:
          if (data[0] == 0x15) { handle_codeDownload_handshake_9000H(data); }
          else if (data[0] == 0x40) { handle_codeDownload_a000H(data); }
          
          else if (data[0] == 0x55) { handle_codedownload_crc(data);}
          break;
      case 26:
          //TODO：YC_DATA
          break;
      case 27:
        handle_FJYJZJG_0020H(data);
        break;

      case 44:
          handle_6000H_response(data, meta);
          break;
          
      case 30: 
          handle_SelfTest_0002H(data);
          break;
      case 31:
          handle_GetSelfTestResult_0010H(data);
          break;
      case 32:
          handle_BBH_0030H(data);
          break;
      case 33:
          handle_Shut_0004H(data);
          break;
      case 34:
          handle_Wake_0001H(data);
          break;
      case 35:
          //handle_CSZD_Recv_4000H(data);
          break;
      case 40:
          
          if (data[0] == 0xFF) {
              handle_SJL_SJCJ_Recv_0xFF(data);
          } else if (data[0] == 0x00) {
              handle_SJL_SJCJ_Recv_0x00(data);
          }
          break;
      case 41:
          handle_SJLTB_B(data);
          break;
      case 42:
          const hexString = Array.from(data)
              .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
              .join(" ");
          
          console.log(hexString);
          break;
    default:
      console.warn(`[DataHandler] Unknown flag: ${flag}`);
  }
}

/**
 * 数据采集 - 心跳
 *
 */
export function handle_SJCJ_010203H() {
  handle_SJCJ_Recv_010203H();
}

function handleSelfCheckResult(data) {
  console.log("[DataHandler] 自检结果 (5 bytes)");
  // 解析 5 字节自检结果
}

function handleParamRecv(data) {
  console.log("[DataHandler] 参数装订接收 (1040 bytes)");
}

function handleOneCmd(data) {
  console.log("[DataHandler] 一次指令");
}

function handleParamAck(data) {
  console.log("[DataHandler] 参数装订应答");
  // 通常 1 字节，表示成功/失败
  const result = data[0];
  if (result === 0x00) {
    console.log("  → 装订成功");
  } else {
    console.warn("  → 装订失败, code:", result);
  }
}

function handleParamDownAck(data) {
  console.log("[DataHandler] 参数下传应答 (50 bytes)");
}

function handle0500H(data) {
  console.log("[DataHandler] 0500H (100 bytes)");
}

function handle0600H(data) {
  console.log("[DataHandler] 0600H (200 bytes)");
}

function handle0700H(data) {
  console.log("[DataHandler] 0700H (1 byte)");
}

function handle0800H(data) {
  console.log("[DataHandler] 0800H (140 bytes)");
}

// ==================== 激光数据处理 ====================

export function handleLaserData(data) {
  console.log("[DataHandler] 激光图像数据 (108 bytes)");
  // 更新激光图像显示
  // 可以调用 laser.js 中的函数
}

// ==================== 图表数据处理 ====================

export function handleChartUpdate(data) {
  console.log("[DataHandler] 图表数据更新");
  // 调用 chart.js 更新曲线
}
