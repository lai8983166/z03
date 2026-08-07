import imgUploadClient, { setOnHandshakeAck, setOnPerFrameAck } from "./ImageUploadClient.js";
import wsClient from "./Client.js";
import statusBar from "./StatusBar.js";
//import {loadCommand_SJCJ} from "./Command.js";
import PacketManager from "./BinaryTableHelper.js";
import { frameStats } from "./Video.js";
import { loadCommand_SJCJ_F000H, setResolveAck_F000H_SJCJ } from "./Command.js";

let buffer = null;
let sendBuffer = new Uint8Array(1040);
let curFile = {
  fileName: "",
  fileSize: 0,
  totalFrame: 0,
  beginFrame: 0,
  endFrame: 0,
  curFrame: 0,
};
let isStop = true;
let isSending = false;

let resolveAck = null;
let resolveSJCJ = null; // 新增：等待 SJCJ 1000H 应答

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export const initializeUploadImage = () => {
  // 注册图像上传应答处理函数到专用 WS 客户端
  setOnHandshakeAck((data) => handle_ImageUpload_0B00H(data));
  setOnPerFrameAck((data) => handle_ImageUpload_Per_Frame_0B00H(data));

  const handshakeImageuploadBtn = document.getElementById(
    "shandshake-imageupload-btn",
  );
  const imageUploadBtn = document.getElementById("image-upload-btn");

  // 重置帧功能
  const resetFrameBtn = document.getElementById("reset-imageupload-btn");
  const beginFrameInput = document.getElementById(
    "input-imageupload-begin-frame",
  );
  resetFrameBtn.addEventListener("click", () => {
    if (!isStop) {
      statusBar.sendMessage("请先暂停发送后再重置帧", "0B00H", "error");
      return;
    }

    // 使用begin-frame输入框的值
    const inputValue = beginFrameInput.value.trim();
    let newFrameValue;

    if (inputValue === "") {
      // 如果输入框为空，重置为0
      newFrameValue = 0;
    } else {
      // 否则使用用户输入的值
      newFrameValue = parseInt(inputValue, 10);
      if (isNaN(newFrameValue) || newFrameValue < 0) {
        statusBar.sendMessage("请输入有效的帧数值（>=0）", "0B00H", "error");
        return;
      }
    }

    // 更新当前帧和起始帧
    curFile.curFrame = newFrameValue;
    curFile.beginFrame = newFrameValue;

    // 更新UI显示
    updateCurrentFrameDisplay();

    statusBar.sendMessage(
      `帧已重置为 ${newFrameValue}`,
      "0B00H",
      `下次发送将从第${newFrameValue}帧开始`,
    );
  });

  // 单帧发送功能
  const singleFrameSendBtn = document.getElementById("single-frame-send-btn");
  singleFrameSendBtn.addEventListener("click", async () => {
    if (!isStop) {
      statusBar.sendMessage("请先暂停发送后再使用单帧发送", "0B00H", "error");
      return;
    }

    // 检查帧索引是否在范围内
    if (
      curFile.curFrame > curFile.endFrame ||
      curFile.curFrame < curFile.beginFrame
    ) {
      if (curFile.curFrame < curFile.beginFrame) {
        curFile.curFrame = curFile.beginFrame;
      } else {
        statusBar.sendMessage(
          "帧索引超出范围，已到达最后一帧",
          "0B00H",
          "error",
        );
        return;
      }
    }

    statusBar.sendMessage(
      `开始发送第${curFile.curFrame}帧（单帧模式）`,
      "0B00H",
    );

    // 发送单帧数据
    await sendSingleFrame();

    // 帧计数+1
    curFile.curFrame++;

    // 更新UI显示
    updateCurrentFrameDisplay();

    statusBar.sendMessage(
      `单帧发送完成，当前帧索引：${curFile.curFrame}`,
      "0B00H",
    );
  });

  handshakeImageuploadBtn.addEventListener("click", () => {
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x0c;
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0x0b; //0B00H

    sendBuffer[16] = 0x14;
    sendBuffer[17] = 0x06; //0614H握手标志位

    sendBuffer[18] = 0x00;
    sendBuffer[19] = 0x00; //00H帧计数

    sendBuffer[20] = 0x00;
    sendBuffer[21] = 0x80;
    sendBuffer[22] = 0x00;
    sendBuffer[23] = 0x00; //32768=128*128*2 0800H 数据总长度
      wsClient.sendUdp(sendBuffer);
      statusBar.sendMessage(
          "图像上传握手",
          "0B00H",
      );
  });

  imageUploadBtn.addEventListener("click", () => {
    //let view = new DataView(sendbuffer.buffer);

    const input = document.createElement("input");
    input.type = "file";
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (file) {
        const reader = new FileReader();
        reader.onload = function (event) {
          const arrayBuffer = event.target.result;
          buffer = new Uint8Array(arrayBuffer);
          curFile.fileName = file.name;
          curFile.fileSize = buffer.length;
          curFile.totalFrame = Math.ceil(buffer.length / 32768);
          curFile.beginFrame = 0;
          curFile.curFrame = 0;
          curFile.endFrame = curFile.totalFrame - 1;
          console.log(
            "加载文件名：",
            file.name,
            "大小：",
            buffer.length,
            "字节",
          );
          /*const firstFrameSize = Math.min(32768, buffer.length);
          const firstFrame = buffer.slice(0, firstFrameSize);

          const hexString = Array.from(firstFrame)
            .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
            .join(" ");
          console.log("第一帧数据（十六进制）：");
          console.log(hexString);

          if (curFile.totalFrame > 1) {
            const lastFrameStart = (curFile.totalFrame - 1) * 32768;
            const lastFrameEnd = buffer.length;
            const lastFrame = buffer.slice(lastFrameStart, lastFrameEnd);

            const lastHexString = Array.from(lastFrame)
              .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
              .join(" ");
            console.log(
              `最后一帧数据（第${curFile.totalFrame}帧，十六进制）：`
            );
            console.log(lastHexString);
          } else {
            console.log("只有一帧数据（第一帧即最后一帧）");
          }*/
          document.getElementById("input-imageupload-begin-frame").value = 0;
          document.getElementById("input-imageupload-end-frame").value =
            curFile.endFrame;
          const spanImageuploadFrameRage = document.getElementById(
            "span-imageupload-frame-range",
          );
          if (spanImageuploadFrameRage) {
            spanImageuploadFrameRage.innerText = `当前文件总帧数：${curFile.totalFrame}帧`;
          }
        };
        reader.readAsArrayBuffer(file);
      }
    };
    input.click();
  });

  const inputImageuploadBeginFrame = document.getElementById(
    "input-imageupload-begin-frame",
  );
  const inputImageuploadEndFrame = document.getElementById(
    "input-imageupload-end-frame",
  );
  inputImageuploadBeginFrame.addEventListener("input", () => {
    curFile.beginFrame = parseInt(inputImageuploadBeginFrame.value) || 0;
    if (isStop) {
      curFile.curFrame = curFile.beginFrame;
    }
  });
  inputImageuploadEndFrame.addEventListener("input", () => {
    curFile.endFrame = parseInt(inputImageuploadEndFrame.value) || 0;
  });
  const startImageuploadBtn = document.getElementById("start-imageupload-btn");
  startImageuploadBtn.addEventListener("click", () => {
    if (!isStop) return;
    isStop = false;
    if (
      curFile.curFrame > curFile.endFrame ||
      curFile.curFrame < curFile.beginFrame
    ) {
      curFile.curFrame = curFile.beginFrame;
    }
    loadCommand_ImageUpload();
  });
  const stopImageuploadBtn = document.getElementById("stop-imageupload-btn");
  stopImageuploadBtn.addEventListener("click", () => {
    isStop = true;
    if (resolveAck) {
      resolveAck();
      resolveAck = null;
    }
    if (resolveSJCJ) {
      resolveSJCJ();
      resolveSJCJ = null;
    }
    statusBar.sendMessage(
      "已停止图像发送",
      "0B00H",
      "当前待发送帧索引：" + curFile.curFrame,
    );
    startImageuploadBtn.innerText = "继续发送";
  });
};

/**
 * 图像上传命令-握手应答
 */
export const handle_ImageUpload_0B00H = (data) => {
  console.log("收到图像上传握手应答");
  if (data.length < 8) {
    console.warn("图像上传握手应答数据长度不足");
    return;
  }
  if (data[0] !== 0x15 || data[1] !== 0x06) {
    console.warn("图像上传握手应答标志位错误");
    return;
  }
  statusBar.receiveMessage("图像上传握手成功", "0B00H");
  //statusBar.sendMessage("开始发送图像数据...", "0B00H");
  //loadCommand_ImageUpload();
};

//限制到每秒发10帧图
//TODO:选择要发的帧范围（x-y)  暂停功能
const loadCommand_ImageUpload = async () => {
  // 重置统计
  frameStats.reset();

  statusBar.sendMessage(
    "开始发送图像数据...",
    "0B00H",
    `当前进度: 第${curFile.curFrame}帧 / 目标: 第${curFile.endFrame}帧`,
  );
  const buildFrame = () => {
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0xf4;
    sendBuffer[7] = 0x03;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0x0b; //B000H

    sendBuffer[16] = 0x40;
    sendBuffer[17] = 0x06; //0640H 图像数据标志位

    sendBuffer[18] = 0x00;
    sendBuffer[19] = 0x00; // 帧计数(后面再算)

    sendBuffer[20] = 0x00;
    sendBuffer[21] = 0x00; //本包图像数据长度（后面再算）

    sendBuffer[22] = 0x00;
    sendBuffer[23] = 0x00; //上传结束标识 00H传输中 01H结束
  };

  while (curFile.curFrame <= curFile.endFrame) {
    if (isStop) {
      console.log("已停止发送,当前待发送帧索引：", curFile.curFrame);
      curFile.beginFrame = curFile.curFrame;

      return;
    }
    //计算当前帧数据位置
    let frameStart = curFile.curFrame * 32768;
    if (frameStart >= buffer.length) break;
    let frameEnd = Math.min(frameStart + 32768, curFile.fileSize);
    let packetCount = 0;
    let currentPos = frameStart;
    while (currentPos < frameEnd) {
      let chunkSize = Math.min(1000, frameEnd - currentPos);
      buildFrame();
      //填充图像数据
      //sendBuffer.set(buffer.slice(currentPos, currentPos + chunkSize), 24);
      //设置本包图像数据长度
      sendBuffer[20] = chunkSize & 0xff;
      sendBuffer[21] = (chunkSize >> 8) & 0xff;
      //设置上传结束标识
      if (chunkSize + currentPos >= frameEnd) {
        sendBuffer[22] = 0x01; //最后一包
        /*statusBar.sendMessage(
          "这是最后一包图像数据！！！！！！！！！！！！！",
          "0B00H"
        );*/
      } else {
        sendBuffer[22] = 0x00; //传输中
      }
      sendBuffer[18] = packetCount & 0xff;
      sendBuffer[19] = (packetCount >> 8) & 0xff;
        sendBuffer.set(buffer.slice(currentPos, currentPos + chunkSize), 24);

        //const sendTime = performance.now();
        //console.log("发送时刻：", sendTime.toFixed(3));
        wsClient.sendUdp(sendBuffer);
      /*statusBar.sendMessage(
        "发送图像数据包",
        "0B00H" + ` 第${curFile.curFrame}帧 第${packetCount}包`
      );*/
      await new Promise((resolve) => {
        resolveAck = resolve;
      });

        //const recvTime = performance.now();
        //console.log("收到时刻：", recvTime.toFixed(3));

      currentPos += chunkSize;
      packetCount++;

      //await sleep(2);
    }
    if (curFile.curFrame % 10 == 0) {
      console.log(`已发送第${curFile.curFrame}帧图像数据`);
      statusBar.sendMessage(`已发送第${curFile.curFrame}帧图像数据`, "0B00H");
    }

    // 统计：记录发送帧
    //frameStats.logSent();

    curFile.curFrame++;
    updateCurrentFrameDisplay();
  }
  isStop = true; // 重置状态
  statusBar.sendMessage("图像数据发送完毕", "0B00H");
  document.getElementById("start-imageupload-btn").innerText = "开始发送";
  curFile.curFrame = curFile.beginFrame;
};

//握手->握手成功->加载文件->更新帧数范围->输入范围->开始发送->暂停->保存当前计数->继续发送

/**
 * 图像上传每包应答
 */
export const handle_ImageUpload_Per_Frame_0B00H = async (data) => {
  if (data[0] !== 0x40 || data[1] !== 0x06) {
    console.warn("图像上传每包应答标志位错误");
    return;
  }

  //优化时注释掉
  //console.log("收到图像上传每包应答");
  //statusBar.receiveMessage("图像上传每包应答", "0B00H");

  const packetCount = data[2] + (data[3] << 8);
  const dataLength = data[4] + (data[5] << 8);
  const packetSeqCheck = data[6] + (data[7] << 8);
  /*console.log(
    "图像上传每包应答数据：",
    "第" +
      packetCount +
      "包,包数据长度" +
      dataLength +
      ",包连续性校验" +
      packetSeqCheck
  );*/
  const packetStatus = () => {
    if (packetSeqCheck == 0x0000) {
      return "正常";
    } else if (packetSeqCheck == 0x0001) {
      return "结束";
    } else if (packetSeqCheck == 0x0002) {
      return "异常";
    } else {
      return "未知状态";
    }
  };

  if (packetSeqCheck == 0x0001) {
    if (!isStop) {
      //console.log(`第${curFile.curFrame}帧发送完毕，等待 SJCJ 应答...`);
      /*loadCommand_SJCJ_F000H_once();
      await new Promise((resolve) => {
        resolveSJCJ = resolve;
      });
      console.log(`收到 SJCJ 应答，继续发送下一帧`);*/
    }
    
  }

  if (resolveAck) {
    resolveAck(); // 触发 Promise resolve
    resolveAck = null; // 清空引用
  }
};

const loadCommand_SJCJ_once = async () => {
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

  wsClient.sendUdp(sendSJCJBuffer);
};

const loadCommand_SJCJ_F000H_once = async() => {
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x6c; // 64字节 (0x0040) 60+4
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00; //  (F000H)
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
    
        console.log(
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
        );
    
        console.log(
          "[F000H] 发送F000H数据采集命令完成，目标状态字: 0x" +
            targetStatusWord.toString(16).padStart(4, "0") +
            ", 复合指令字: 0x" +
            compositeCommandWord.toString(16).padStart(4, "0"),
        );
        statusBar.sendMessage("F000H数据采集命令已发送", "F000H");
        console.log(
          Array.from(sendBuffer)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" "),
        );
    


    wsClient.sendUdp(sendBuffer);
    await new Promise((resolve) => {
        setResolveAck_F000H_SJCJ(resolve);
    });
    
}

const parseBinaryOption = (str) => {
    const match = str.match(/^([01]+)b/);
    if (match) {
        return parseInt(match[1], 2);
    }
    return 0;
};

/**
 * 触发 SJCJ 应答的 resolve（由 Command.js 调用）
 */
export const triggerSJCJResolve = () => {
  if (resolveSJCJ) {
    resolveSJCJ();
    resolveSJCJ = null;
  }
};

/**
 * 单帧发送功能
 * 发送当前帧的所有数据包，然后等待SJCJ应答
 */
const sendSingleFrame = async () => {
  // 检查是否已加载文件
  if (!buffer) {
    statusBar.sendMessage("请先加载图像文件", "0B00H", "error");
    return;
  }

  // 检查帧索引是否超出范围
  if (
    curFile.curFrame > curFile.endFrame ||
    curFile.curFrame < curFile.beginFrame
  ) {
    statusBar.sendMessage("帧索引超出范围，无法发送", "0B00H", "error");
    return;
  }

  const buildFrame = () => {
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0xf4;
    sendBuffer[7] = 0x03;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0x0b; //0B00H

    sendBuffer[16] = 0x40;
    sendBuffer[17] = 0x06; //0640H 图像数据标志位

    sendBuffer[18] = 0x00;
    sendBuffer[19] = 0x00; // 帧计数(后面再算)

    sendBuffer[20] = 0x00;
    sendBuffer[21] = 0x00; //本包图像数据长度（后面再算）

    sendBuffer[22] = 0x00;
    sendBuffer[23] = 0x00; //上传结束标识 00H传输中 01H结束
  };

  // 计算当前帧数据位置
  let frameStart = curFile.curFrame * 32768;
  if (frameStart >= buffer.length) {
    statusBar.sendMessage("帧数据超出文件范围", "0B00H", "error");
    return;
  }

  let frameEnd = Math.min(frameStart + 32768, curFile.fileSize);
  let packetCount = 0;
  let currentPos = frameStart;

  // 发送当前帧的所有数据包
  while (currentPos < frameEnd) {
    let chunkSize = Math.min(1000, frameEnd - currentPos);
    buildFrame();

    // 填充图像数据
    sendBuffer[20] = chunkSize & 0xff;
    sendBuffer[21] = (chunkSize >> 8) & 0xff;

    // 设置上传结束标识
    if (chunkSize + currentPos >= frameEnd) {
      sendBuffer[22] = 0x01; // 最后一包
    } else {
      sendBuffer[22] = 0x00; // 传输中
    }

    sendBuffer[18] = packetCount & 0xff;
    sendBuffer[19] = (packetCount >> 8) & 0xff;
    sendBuffer.set(buffer.slice(currentPos, currentPos + chunkSize), 24);

      wsClient.sendUdp(sendBuffer);

    await new Promise((resolve) => {
      resolveAck = resolve;
    });

    currentPos += chunkSize;
    packetCount++;
  }

  // 统计：记录发送帧
  frameStats.logSent();

  // 等待SJCJ应答（如果数据采集正在进行）
  await new Promise((resolve) => {
    const originalResolveSJCJ = resolveSJCJ;
    resolveSJCJ = () => {
      if (originalResolveSJCJ) originalResolveSJCJ();
      resolve();
    };
    // 触发一次数据采集命令
    loadCommand_SJCJ_once();
  });
};

/**
 * 更新当前帧显示
 */
const updateCurrentFrameDisplay = () => {
  const displayElement = document.getElementById("current-frame-display");
  if (displayElement) {
    displayElement.textContent = `当前待发送帧索引：${curFile.curFrame}`;
  }
};
