import statusBar from "./StatusBar";
import wsClient from "./Client";

const codeFile = {
    fileName:"",
    fileSize:0,
    buffer:null,
}

let sendBuffer = new Uint8Array(1040);
let resolveAck = null;
let resolveDownloadAck = null; // 程序下载每包应答 resolve
let codedownload_crc = 0;
let code_length = 0;
let last_packet_size = 0;

let upload_crc = 0;

// ==================== 6000H 上传协议 ====================
// 6000H 的协议字段统一使用大端序；CP 固定为 29 个 16 位字，
// 命令载荷为：COMD(2) + CP(58) + CRC(2)。
const CODE_WORDS_PER_FRAME = 26;
const CODE_BYTES_PER_FRAME = CODE_WORDS_PER_FRAME * 2;
const SIXK_CP_WORDS = 29;
const SIXK_PAYLOAD_LENGTH = 2 + SIXK_CP_WORDS * 2 + 2+2;
const SIXK_PACKET_LENGTH = 16 + SIXK_PAYLOAD_LENGTH;
const SIXK_CO = 0x6000;
const SIXK_AT = 0x52;
const YY_UPLOAD_ACK_WAIT_MS=1000;

const codeUploadSessions = {
    CX: { buffer: null, fileName: "", fileSize: 0, ar: 0xa0, frameIndex: 1, totalFrames: 0 },
    YY: { buffer: null, fileName: "", fileSize: 0, ar: 0xa0, classId: 0, frameIndex: 1, totalFrames: 0 },
};

let pending6000Ack = null;
// 不阻塞发送的 6000H 指令仍保留应答匹配，收到设备应答后再输出接收日志。
const nonBlocking6000Acks = [];
// 6000H 协议按设备约定不做超时和重传；相关实现保留，便于后续需要时重新启用。
const ENABLE_6000_TIMEOUT_RETRY = false;
const MAX_6000_FRAME_COUNT = 0xffff;

const saturate6000FrameCount = (value) => Math.min(
    MAX_6000_FRAME_COUNT,
    Math.max(0, Math.trunc(value)),
);

const readU16BE = (data, offset) => (data[offset] << 8) | data[offset + 1];

const writeU16BE = (data, offset, value) => {
    data[offset] = (value >>> 8) & 0xff;
    data[offset + 1] = value & 0xff;
};

// 6000H 文档只给出 CCITT-CRC，采用常见的 CRC-16/CCITT-FALSE 参数。
// CRC 覆盖 AR、AT、CO、COMD 和 CP，不覆盖外层 0~11 字节及 CRC 自身。
const crc16Ccitt = (data) => {
    let crc = 0xffff;
    for (const byte of data) {
        crc ^= byte << 8;
        for (let bit = 0; bit < 8; bit++) {
            crc = (crc & 0x8000) ? ((crc << 1) ^ 0x1021) : (crc << 1);
            crc &= 0xffff;
        }
    }
    return crc;
};

// 协议中的“程序校验和”是 32 位双字累加和，不是 CRC。
// 6000H 改为大端后，双字也按高字节在前累加；
// 校验范围按完整上传帧长度计算，缺失字节使用 0xFF 补齐。
const sum32Words = (buffer) => {
    let sum = 0;
    for (let offset = 0; offset < buffer.length; offset += 4) {
        const value = ((buffer[offset] || 0) << 24)
            | ((buffer[offset + 1] || 0) << 16)
            | ((buffer[offset + 2] || 0) << 8)
            | (buffer[offset + 3] || 0);
        sum = (sum + (value >>> 0)) >>> 0;
    }
    return sum >>> 0;
};

const selectedValue = (id, fallback) => {
    const element = document.getElementById(id);
    if (!element || element.value === "") return fallback;
    return Number.parseInt(element.value, 0);
};

const get6000Ar = (kind) => selectedValue(
    kind === "CX" ? "select_6000H_CX_AR" : "select_6000H_YY_AR",
    0xa0,
);

const get6000ClassId = () => Math.max(0, Math.min(4, selectedValue("select_6000H_YY_CLASS", 0)));

const require6000File = (kind) => {
    const session = codeUploadSessions[kind];
    if (!session.buffer || session.fileSize === 0) {
        throw new Error(`${kind === "CX" ? "擦写软件" : "应用软件"}程序文件尚未加载`);
    }
    return session;
};

const load6000File = (kind, file, labelId) => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (event) => {
        const session = codeUploadSessions[kind];
        session.buffer = new Uint8Array(event.target.result);
        session.fileName = file.name;
        session.fileSize = session.buffer.length;
        session.frameIndex = 1;
        session.totalFrames = Math.ceil(session.fileSize / CODE_BYTES_PER_FRAME);
        const label = document.getElementById(labelId);
        if (label) label.innerText = `程序文件名：${session.fileName}（${session.fileSize}字节）`;
        statusBar.sendMessage(
            `${kind === "CX" ? "擦写软件" : "应用软件"}文件已加载，共${session.totalFrames}帧`,
            "6000H",
        );
        resolve(session);
    };
    reader.onerror = () => reject(reader.error || new Error("程序文件读取失败"));
    reader.readAsArrayBuffer(file);
});

const bind6000FilePicker = (kind, buttonId, labelId) => {
    document.getElementById(buttonId)?.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.onchange = async (event) => {
            const file = event.target.files?.[0];
            if (!file) return;
            try {
                await load6000File(kind, file, labelId);
            } catch (error) {
                console.error(error);
                statusBar.receiveMessage(error.message, "6000H");
            }
        };
        input.click();
    });
};

// ==================== 程序下载（A000H）接收缓冲 ====================
const codeDownload = {
    chunks: [],       // 收到的每包 Uint8Array 数据
    totalBytes: 0,    // 已收到字节数
    frameCount: 0,    // 已收到帧数
};

function resetCodeDownload() {
    codeDownload.chunks = [];
    codeDownload.totalBytes = 0;
    codeDownload.frameCount = 0;
}

export function initializeCodeUpload() {
    document.getElementById("pushtton_codefileupload")?.addEventListener("click", () => {
        const input = document.createElement("input");
        input.type = "file";
        input.onchange = (e) => {
            const file = e.target.files[0];
            if (file) {
                const reader = new FileReader();
                reader.onload = function (event) {
                    const arrayBuffer = event.target.result;
                    codeFile.buffer = new Uint8Array(arrayBuffer);
                    codeFile.fileName = file.name;
                    codeFile.fileSize = codeFile.buffer.length;
                    console.log(
                        "加载文件名：",
                        file.name,
                        "大小：",
                        codeFile.buffer.length,
                        "字节",
                    );
                    
                };
                reader.readAsArrayBuffer(file);
            }
        };
        input.click();
        const codeFileName = document.getElementById("codefile_name");
        codeFileName.innerText = `程序文件名：${codeFile.fileName}`;
    });

    bind6000FilePicker(
        "CX",
        "pushtton_codefileupload_6000H_CX",
        "codefile_name_6000H_CX",
    );
    bind6000FilePicker(
        "YY",
        "pushtton_codefileupload_6000H_YY",
        "codefile_name_6000H_YY",
    );

    document.getElementById("pushbutton_codeupload_handshake")?.addEventListener("click", () => {
        
        loadCommand_CXSC_CodeUpload_HandShake_9000H();
        
    });

    document.getElementById("pushbutton_codedataupload_handshake")?.addEventListener("click", () => {
        loadCommand_CXSC_CodeDataUpload_Handshake_9000H();

    });

    document.getElementById("pushbutton_codeupload")?.addEventListener("click", () => {
        loadCommand_CXSC_CodeUpload_9000H();

    });

    document.getElementById("pushbutton_codedata_check")?.addEventListener("click", () => {
        loadCommand_CXSC_CodeData_Check_9000H();

    });

    document.getElementById("pushbutton_code_write")?.addEventListener("click", () => {
        loadCommand_CXSC_Code_Write_9000H();

    });

    document.getElementById("pushbutton_codedownload_handshake")?.addEventListener("click", () => {
        loadCommand_codeDownload_handshake_9000H();

    });

    document.getElementById("pushbutton_codedownload")?.addEventListener("click", () => {
        runCodeDownload();

    });
    
    
    document.getElementById("pushbutton_codedownload_crc")?.addEventListener("click", () => {
        loadCommand_codedownload_crc();

    });

    document.getElementById("pushbutton_codeupload_handshake_6000H_CX")?.addEventListener("click", () => {
        run6000Operation(loadCommand_6000H_CX_handshake);
    });
    document.getElementById("pushbutton_codeupload_6000H_CX")?.addEventListener("click", () => {
        run6000Operation(loadCommand_6000H_CX_upload);
    });
    document.getElementById("pushbutton_code_write_6000H_CX")?.addEventListener("click", () => {
        run6000Operation(loadCommand_6000H_CX_process);
    });

    document.getElementById("pushbutton_codeupload_handshake_6000H_YY")?.addEventListener("click", () => {
        run6000Operation(loadCommand_handshake_6000H_YY);
    });
    document.getElementById("pushbutton_codeupload_6000H_YY")?.addEventListener("click", () => {
        run6000Operation(loadCommand_uploadData_6000H_YY);
    });
    document.getElementById("pushbutton_codedata_check_6000H_YY")?.addEventListener("click", () => {
        run6000Operation(loadCommand_dataCheck_6000H_YY);
    });
    document.getElementById("pushbutton_code_write_6000H_YY")?.addEventListener("click", () => {
        run6000Operation(loadCommand_flashWrite_6000H_YY);
    });
}

const loadCommand_CXSC_CodeUpload_HandShake_9000H = () => {
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x06;
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0x90; //9000H
    sendBuffer[16] = 0x14;
    sendBuffer[17] = 0x06; //0614H
    wsClient.sendUdp(sendBuffer);
    
    statusBar.sendMessage("进入上传程序命令握手", "9000H");
}

export const handle_CXSC_CodeUpload_HandShake_0615H_9000H = (data) => {
    if (data[0] == 0x15 && data[1] == 0x06) {
        statusBar.receiveMessage("进入上传程序命令握手应答", "9000H");
    }
}

export const handle_CXSC_CodeUpload_HandShake_0616H_9000H = (data) => {
    if (data[0] == 0x16 && data[1] == 0x06) {
        statusBar.receiveMessage("进入上传程序命令就绪应答", "9000H");
    }
}

const loadCommand_CXSC_CodeDataUpload_Handshake_9000H = () => {
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
    sendBuffer[15] = 0x90; //9000H
    sendBuffer[16] = 0x14;
    sendBuffer[17] = 0x06; //0614H
    sendBuffer[18] = 0x00;
    sendBuffer[19] = 0x00;//帧计数00H

    
    sendBuffer[20] = codeFile.fileSize & 0xff;
    sendBuffer[21] = (codeFile.fileSize >> 8) & 0xff;
    sendBuffer[22] = (codeFile.fileSize >> 16) & 0xff;
    sendBuffer[23] = (codeFile.fileSize >> 24) & 0xff;

    wsClient.sendUdp(sendBuffer);

    statusBar.sendMessage("进入上传程序命令握手", "9000H");
}

export const handle_CXSC_CodeDataUpload_Handshake_9000H = (data) => {
    if (data[0] == 0x15 && data[1] == 0x06) {
        statusBar.receiveMessage("数据上传握手应答", "9000H");
    }
}

const loadCommand_CXSC_CodeUpload_9000H = async() => {
    //let offset = 0;
    const totalFrameCount = codeFile.fileSize / 1000;
    let curFrame = 0;
    while (curFrame < totalFrameCount) {
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
        sendBuffer[15] = 0x90; //9000H

        sendBuffer[16] = 0x40;
        sendBuffer[17] = 0x06; //0640H 数据上传标志位

        sendBuffer[18] = 0x00;
        sendBuffer[19] = 0x00; // 帧计数(后面再算)

        sendBuffer[20] = 0x00;
        sendBuffer[21] = 0x00; //本包图像数据长度（后面再算）

        sendBuffer[22] = 0x00;
        sendBuffer[23] = 0x00; //上传结束标识 00H传输中 01H结束

        let frameStart = curFrame * 1000;
        if (frameStart >= codeFile.buffer.length) break;
        let frameEnd = codeFile.fileSize;
        
        
        
        let chunkSize = Math.min(1000, frameEnd - frameStart);
            
            sendBuffer[20] = chunkSize & 0xff;
            sendBuffer[21] = (chunkSize >> 8) & 0xff;
            //设置上传结束标识
        if (chunkSize + frameStart >= frameEnd) {
                sendBuffer[22] = 0x01; //最后一包
                statusBar.sendMessage(
                  "最后一包数据已发送",
                  "9000H"
                );
            } else {
                sendBuffer[22] = 0x00; //传输中
        }
        sendBuffer[18] = curFrame & 0xff;
        sendBuffer[19] = (curFrame >> 8) & 0xff;
        const chunk = codeFile.buffer.slice(frameStart, frameStart + chunkSize);
        sendBuffer.set(chunk, 24);

        for (let i = 0; i < chunk.length; ++i) {
            upload_crc += chunk[i];
            if (upload_crc >= 0xffffffff) {
                upload_crc &= 0xffffffff;
            }
        }

        wsClient.sendUdp(sendBuffer);

        await new Promise((resolve) => {
            resolveAck = resolve;
        });

        curFrame++;
    }
}

export const handle_CXSC_CodeUpload_9000H = (data) => {
    let str1 = "";
    let str2 = "";
    if (data[0] == 0x40 && data[1] == 0x06) {
        str1 = "收到数据上传应答：";
    }

    const frameSeqCheck = data[6];
    if (frameSeqCheck == 0x00) {
        str2 = "正常";
    } else if (frameSeqCheck == 0x01) {
        str2 = "结束";
    } else if (frameSeqCheck == 0x02) {
        str2 = "异常";
    }

    if (resolveAck !== null) {
        resolveAck();
    }


    statusBar.receiveMessage(str1+str2, "9000H");
}

const loadCommand_CXSC_CodeData_Check_9000H = () => {
    
    

    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x0a;
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0x90; //9000H

    sendBuffer[16] = 0x50;
    sendBuffer[17] = 0x06; //0650H 数据上传标志位

    sendBuffer[18] = upload_crc&0xff;
    sendBuffer[19] = (upload_crc>>8)&0xff;
    sendBuffer[20] = (upload_crc>>16)&0xff;
    sendBuffer[21] = (upload_crc >> 24) & 0xff;

    statusBar.sendMessage("发送程序上传数据校验命令", "9000H");

    wsClient.sendUdp(sendBuffer);
}

export const handle_CXSC_CodeData_Check_9000H = (data) => {
    let str1 = "";
    let str2 = "";
    if (data[0] == 0x55 && data[1] == 0x06) {
        str1 = "收到数据校验应答：";
    }
    if (data[2] == 0x00) {
        str2 = "正常:";
    } else if (data[2] == 0x0f) {
        str2 = "异常:";
    }
    const crc = data.subarray(4, 8);
    const hex = Array.from(crc, b => b.toString(16).padStart(2, '0')).join('');
    statusBar.receiveMessage(str1 + str2 + hex, "9000H");
}

const loadCommand_CXSC_Code_Write_9000H = () => {
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x06;
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0x90; //9000H

    sendBuffer[16] = 0x60;
    sendBuffer[17] = 0x06; //0660H

    wsClient.sendUdp(sendBuffer);

    statusBar.sendMessage("发送程序烧写命令,等待烧写", "9000H");
}

export const handle_CXSC_Code_Write_9000H = (data) => {
    //statusBar.receiveMessage("烧写状态回复", "9000H");
    if (data[0] = 0x65 && data[1] == 0x06) {
        if (data[2] == 0x01) {
            statusBar.receiveMessage("烧写进行中", "9000H");
        } else if (data[2] == 0x02) {
            statusBar.receiveMessage("烧写完成", "9000H");
        }
    }
}

const loadCommand_codeDownload_handshake_9000H=() => {
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x08;
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0xa0; //a000H

    sendBuffer[16] = 0x14;
    sendBuffer[17] = 0x06; //0614H
    sendBuffer[18] = 0x00;
    sendBuffer[19] = 0x00;

    wsClient.sendUdp(sendBuffer);

    statusBar.sendMessage("发送程序查询握手命令", "A000H");
}

export const handle_codeDownload_handshake_9000H = (data) => {
    if (data[0] == 0x15 && data[1] == 0x06) {
        statusBar.receiveMessage("收到程序查询握手回复", "A000H");
    }
    const length = data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24);
    code_length = length;
    last_packet_size = code_length % 1000;
    console.log(code_length);
}

const loadCommand_codeDownload = (frameIdx = 0)=>{
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x0a;
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0xa0; //a000H

    sendBuffer[16] = 0x40;
    sendBuffer[17] = 0x06; //0640H
    sendBuffer[18] = frameIdx & 0xff;        // 请求的帧计数低字节
    sendBuffer[19] = (frameIdx >> 8) & 0xff; // 请求的帧计数高字节
    sendBuffer[20] = 0xe8;
    sendBuffer[21] = 0x03;
    if (code_length >= 1000) { code_length -= 1000; }
    else {
        sendBuffer[20] = last_packet_size & 0xff;
        sendBuffer[21] = (last_packet_size >> 8) & 0xff;
    }
    

    

    wsClient.sendUdp(sendBuffer);

    statusBar.sendMessage(`发送程序下载命令，请求第 ${frameIdx} 包`, "A000H");
}

/**
 * 程序下载主循环：每发一包请求，等待设备返回该包数据后再发下一包，
 * 直到收到结束标志（endFlag === 0x0001）为止。
 */
const runCodeDownload = async () => {
    resetCodeDownload();
    let frameIdx = 0;

    statusBar.sendMessage("开始程序下载...", "A000H");

    while (true) {
        // 发送当前帧请求
        loadCommand_codeDownload(frameIdx);

        // 等待 handle_codeDownload_a000H resolve
        const isDone = await new Promise((resolve) => {
            resolveDownloadAck = resolve;
        });

        if (isDone) break; // 收到结束标志，退出循环

        frameIdx++;
    }
}

export const handle_codeDownload_a000H = (data) => {
    if (data[0] !== 0x40 || data[1] !== 0x06) return;

    const frameIdx = data[2] | (data[3] << 8);  // 帧计数
    const dataLen = data[4] | (data[5] << 8);  // 本包数据长度
    const endFlag = data[6] | (data[7] << 8);  // 0x0000=传输中, 0x0001=传输完成

    // 如果这是第一包，先清空缓冲
    if (frameIdx === 0) {
        resetCodeDownload();
    }

    // 截取本包有效数据（从 data[8] 开始，长度 dataLen）
    const chunk = data.slice(8, 8 + dataLen);
    codeDownload.chunks.push(chunk);
    codeDownload.totalBytes += chunk.length;
    codeDownload.frameCount++;

    for (let i = 0; i < chunk.length; ++i) {
        codedownload_crc += chunk[i];
        if (codedownload_crc >= 0xffffffff) {
            codedownload_crc &= 0xffffffff;
        }
    }

    const isDone = endFlag === 0x0001;

    statusBar.receiveMessage(
        `收到程序下载分包 #${frameIdx}，包长 ${dataLen}，已收 ${codeDownload.totalBytes} 字节${isDone ? " [完成]" : ""}`,
        "A000H",
    );

    // resolve 循环，传入是否结束标志
    if (resolveDownloadAck) {
        const r = resolveDownloadAck;
        resolveDownloadAck = null;
        r(isDone);
    }

    if (isDone) {
        // 最后一包——合并所有分包并触发文件下载
        const merged = new Uint8Array(codeDownload.totalBytes);
        let offset = 0;
        for (const c of codeDownload.chunks) {
            merged.set(c, offset);
            offset += c.length;
        }

        // 生成下载文件名（含时间戳）
        const now = new Date();
        const ts = now.toISOString().replace(/T/, "_").replace(/:/g, "-").replace(/\..+/, "");
        const filename = `code_download_${ts}.bin`;

        const blob = new Blob([merged], { type: "application/octet-stream" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        statusBar.receiveMessage(
            `程序下载完成，共 ${codeDownload.totalBytes} 字节，已保存为 ${filename}`,
            "A000H",
        );

        resetCodeDownload();
    }
}

const loadCommand_codedownload_crc = () => {
    sendBuffer[0] = 0x31;
    sendBuffer[1] = 0x02;
    sendBuffer[2] = 0x01;
    sendBuffer[3] = 0x50;
    sendBuffer[4] = 0x00;
    sendBuffer[5] = 0x00;
    sendBuffer[6] = 0x0a;
    sendBuffer[7] = 0x00;
    sendBuffer[8] = 0x00;
    sendBuffer[9] = 0x00;
    sendBuffer[10] = 0x00;
    sendBuffer[11] = 0x00;
    sendBuffer[12] = 0x54; // AR_DYT
    sendBuffer[13] = 0x52; // AT_JK
    sendBuffer[14] = 0x00;
    sendBuffer[15] = 0xa0; //a000H

    sendBuffer[16] = 0x50;
    sendBuffer[17] = 0x06;
    sendBuffer[18] = (codedownload_crc)&0xff;
    sendBuffer[19] = (codedownload_crc >> 8) & 0xff;
    sendBuffer[20] = (codedownload_crc >> 16) & 0xff;
    sendBuffer[21] = (codedownload_crc >> 24) & 0xff;

    wsClient.sendUdp(sendBuffer);

    statusBar.sendMessage(`发送程序下载数据校验`, "A000H");
}

export const handle_codedownload_crc = (data) => {
    statusBar.receiveMessage(`校验和：${data[4] | (data[5] << 8) | (data[6] << 16) | (data[7] << 24)}`);
    if (data[2] == 0x00) {
        statusBar.receiveMessage("程序下载数据校验正常", "A000H");
    } else if (data[2] == 0x01) {
        statusBar.receiveMessage("程序下载数据校验异常", "A000H");
    }
}

const build6000Packet = (ar, comd, cpWords) => {
    if (cpWords.length !== SIXK_CP_WORDS) {
        throw new Error(`6000H CP 必须为 ${SIXK_CP_WORDS} 个字`);
    }

    const packet = new Uint8Array(SIXK_PACKET_LENGTH);
    packet[0] = 0x31;
    packet[1] = 0x02;
    packet[2] = 0x01;
    packet[3] = 0x50;
    // [6..7] 是现有外层传输头的长度字段，保持传输层小端约定。
    packet[6] = SIXK_PAYLOAD_LENGTH & 0xff;
    packet[7] = (SIXK_PAYLOAD_LENGTH >>> 8) & 0xff;
    packet[12] = ar & 0xff;
    packet[13] = SIXK_AT;
    writeU16BE(packet, 14, SIXK_CO);
    writeU16BE(packet, 16, comd);

    cpWords.forEach((word, index) => writeU16BE(packet, 18 + index * 2, word));
    
    

    //const crc = crc16Ccitt(packet.subarray(12, 76));
    
    //writeU16BE(packet, 76, crc);
    return packet;
};

const createInfoCp = (session) => {
    const cp = new Uint16Array(SIXK_CP_WORDS);
    cp[0] = saturate6000FrameCount(session.totalFrames);
    cp[1] = (session.fileSize >>> 16) & 0xffff;
    cp[2] = session.fileSize & 0xffff;
    return cp;
};

const createDataCp = (session, frameIndex) => {
    const cp = new Uint16Array(SIXK_CP_WORDS);
    const frameStart = (frameIndex - 1) * CODE_BYTES_PER_FRAME;
    const isLast = frameIndex === session.totalFrames;
    cp[0] = saturate6000FrameCount(frameIndex);
    cp[1] = isLast ? 0xffff : 0x0000;

    for (let wordIndex = 0; wordIndex < CODE_WORDS_PER_FRAME; wordIndex++) {
        const byteOffset = frameStart + wordIndex * 2;
        const high = session.buffer[byteOffset] ?? 0xff;
        const low = session.buffer[byteOffset + 1] ?? 0xff;
        cp[2 + wordIndex] = (high << 8) | low;
    }
    // cp[28] 是备用字，Uint16Array 已初始化为 0。
    return cp;
};

const createChecksumCp = (checksum) => {
    const cp = new Uint16Array(SIXK_CP_WORDS);
    cp[0] = (checksum >>> 16) & 0xffff;
    cp[1] = checksum & 0xffff;
    return cp;
};

const resultDescription = (result, type) => {
    if (result === 0) return "正常";
    if (type === "upload") {
        return ({
            0x0001: "帧计数超界",
            0x0002: "帧计数不连续",
            0x0004: "比对错误",
        })[result] || `异常(0x${result.toString(16).padStart(4, "0")})`;
    }
    if (type === "checksum") return result === 0xffff ? "校验和异常" : `异常(0x${result.toString(16)})`;
    if (type === "flash") {
        return ({
            0x0001: "擦除失败",
            0x0002: "写入失败",
            0x0004: "关闭写保护失败",
            0x0008: "擦写后写保护失败",
        })[result] || `异常(0x${result.toString(16).padStart(4, "0")})`;
    }
    return `异常(0x${result.toString(16).padStart(4, "0")})`;
};

const completePending6000 = (result) => {
    if (!pending6000Ack) return;
    const pending = pending6000Ack;
    pending6000Ack = null;
    clearTimeout(pending.timer);
    result.ok ? pending.resolve(result) : pending.reject(new Error(result.message));
};

const waitFor6000Ack = (packet, options) => new Promise((resolve, reject) => {
    if (pending6000Ack) {
        reject(new Error("6000H 仍有未完成的应答等待"));
        return;
    }

    const pending = {
        ...options,
        resolve,
        reject,
        timer: ENABLE_6000_TIMEOUT_RETRY
            ? setTimeout(() => {
                if (pending6000Ack === pending) pending6000Ack = null;
                reject(new Error(`${options.label}等待应答超时`));
            }, options.timeout ?? 3000)
            : null,
    };
    pending6000Ack = pending;

    if(options.skipOnTimeout){
        pending.timer=setTimeout(()=>{
            if(pending6000Ack!==pending)return;
            pending6000Ack=null;
            statusBar.receiveMessage('1秒未收到应答，继续发下一帧');
            resolve({ok:false,skipped:true,timeout:true});
        },options.timeout??YY_UPLOAD_ACK_WAIT_MS);
    }

    if (!wsClient.sendUdp(packet)) {
        if (pending.timer !== null) clearTimeout(pending.timer);
        pending6000Ack = null;
        reject(new Error("WebSocket 未连接，6000H 报文未发送"));
    }
});

const send6000WithRetry = async (packet, options) => {
    //const retryCount = ENABLE_6000_TIMEOUT_RETRY ? (options.retryCount ?? 2) : 0;
    const retryCount = options.skipOnTimeout?0:(ENABLE_6000_TIMEOUT_RETRY?(options.retryCount??2):0);
    let lastError = null;
    for (let attempt = 0; attempt <= retryCount; attempt++) {
        try {
            return await waitFor6000Ack(packet, options);
        } catch (error) {
            lastError = error;
            if (attempt < retryCount) {
                statusBar.sendMessage(`${options.label}超时，重发第${attempt + 1}次`, "6000H");
            }
        }
    }
    throw lastError;
};

const send6000Command = async ({
    ar,
    comd,
    cp,
    expectedStus,
    stage,
    frameIndex,
    label,
    timeout,
    skipOnTimeout = false,
    waitForAck = true,
    responseMessage,
}) => {
    const packet = build6000Packet(ar, comd, cp);
    statusBar.sendMessage(`${label}（${packet.length}字节）`, "6000H");
    /*const HexString = Array.from(packet)
            .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
            .join(" ");

        console.log(HexString);*/
    if (!waitForAck) {
        if (!wsClient.sendUdp(packet)) {
            throw new Error("WebSocket 未连接，6000H 报文未发送");
        }
        nonBlocking6000Acks.push({
            expectedStus,
            stage,
            frameIndex: frameIndex === undefined ? undefined : saturate6000FrameCount(frameIndex),
            label,
            responseMessage,
        });
        return { ok: true, sentOnly: true };
    }

    return send6000WithRetry(packet, {
        expectedStus,
        stage,
        frameIndex: frameIndex === undefined ? undefined : saturate6000FrameCount(frameIndex),
        label,
        timeout,
        skipOnTimeout,
        waitForAck,
    });
};

const run6000Operation = (operation) => {
    operation().catch((error) => {
        console.error("6000H 操作失败:", error);
        statusBar.receiveMessage(`6000H失败：${error.message}`, "6000H");
    });
};

export const loadCommand_6000H_CX_handshake = async (ar = get6000Ar("CX")) => {
    const session = require6000File("CX");
    session.ar = ar & 0xff;
    await send6000Command({
        ar: session.ar,
        comd: 0x0610,
        cp: createInfoCp(session),
        expectedStus: 0x0615,
        stage: "info",
        label: "发送擦写软件上下传程序信息命令",
        waitForAck: false,
        responseMessage: "擦写软件程序信息应答正常",
    });
};

export const loadCommand_6000H_CX_upload = async (ar = get6000Ar("CX")) => {
    const session = require6000File("CX");
    session.ar = ar & 0xff;
    for (let frameIndex = 1; frameIndex <= session.totalFrames; frameIndex++) {
        await send6000Command({
            ar: session.ar,
            comd: 0x0620,
            cp: createDataCp(session, frameIndex),
            expectedStus: 0x0625,
            stage: "upload",
            frameIndex,
            label: `上传擦写程序第${frameIndex}/${session.totalFrames}帧`,
        });
        session.frameIndex = frameIndex + 1;
    }
    statusBar.receiveMessage("擦写软件上传完成", "6000H");
};

export const loadCommand_6000H_CX_process = async (ar = get6000Ar("CX")) => {
    const session = require6000File("CX");
    session.ar = ar & 0xff;
    await send6000Command({
        ar: session.ar,
        comd: 0x0630,
        cp: new Uint16Array(SIXK_CP_WORDS),
        stage: "process",
        label: "发送运行擦写程序命令",
        timeout: 10000,
    });
    statusBar.receiveMessage("擦写程序运行应答正常", "6000H");
};

export const loadCommand_handshake_6000H_YY = async (ar = get6000Ar("YY")) => {
    const session = require6000File("YY");
    session.ar = ar & 0xff;
    session.classId = get6000ClassId();
    const comd = 0x0610 + session.classId;
    await send6000Command({
        ar: session.ar,
        comd,
        cp: createInfoCp(session),
        expectedStus: 0x0615 + session.classId,
        stage: "info",
        label: `发送应用软件${session.classId}类程序信息命令`,
        waitForAck: false,
        responseMessage: "应用软件程序信息应答正常",
    });
};

export const loadCommand_uploadData_6000H_YY = async (ar = get6000Ar("YY")) => {
    const session = require6000File("YY");
    session.ar = ar & 0xff;
    session.classId = get6000ClassId();
    for (let frameIndex = 1; frameIndex <= session.totalFrames; frameIndex++) {
        await send6000Command({
            ar: session.ar,
            comd: 0x0640 + session.classId,
            cp: createDataCp(session, frameIndex),
            expectedStus: 0x0645 + session.classId,
            stage: "upload",
            frameIndex,
            timeout:YY_UPLOAD_ACK_WAIT_MS,
            skipOnTimeout:true,
            label: `上传应用软件第${frameIndex}/${session.totalFrames}帧`,
        });
        session.frameIndex = frameIndex + 1;
    }
    statusBar.receiveMessage("应用软件上传完成", "6000H");
};

export const loadCommand_dataCheck_6000H_YY = async (ar = get6000Ar("YY")) => {
    const session = require6000File("YY");
    session.ar = ar & 0xff;
    session.classId = get6000ClassId();
    session.checksum = sum32Words(session.buffer);
    await send6000Command({
        ar: session.ar,
        comd: 0x0650 + session.classId,
        cp: createChecksumCp(session.checksum),
        expectedStus: 0x0655 + session.classId,
        stage: "checksum",
        label: `发送应用软件校验和 0x${session.checksum.toString(16).padStart(8, "0")}`,
        timeout: 10000,
        waitForAck: false,
        responseMessage: "应用软件校验和应答正常",
    });
};

export const loadCommand_flashWrite_6000H_YY = async (ar = get6000Ar("YY")) => {
    const session = require6000File("YY");
    session.ar = ar & 0xff;
    session.classId = get6000ClassId();
    await send6000Command({
        ar: session.ar,
        comd: 0x0660 + session.classId,
        cp: new Uint16Array(SIXK_CP_WORDS),
        expectedStus: 0x0665 + session.classId,
        stage: "flash",
        label: "启动应用软件 FLASH 擦除及写入",
        timeout: 120000,
    });
    statusBar.receiveMessage("应用软件 FLASH 擦除及写入完成", "6000H");
};

const parse6000Response = (data) => {
    if (!data || data.length < 2) return null;
    const stus = readU16BE(data, 0);
    if (stus >= 0x0615 && stus <= 0x0619) {
        return {
            stus,
            type: "info",
            result: 0,
            totalFrames: data.length >= 4 ? saturate6000FrameCount(readU16BE(data, 2)) : 0,
        };
    }
    if ((stus >= 0x0625 && stus <= 0x0629) || (stus >= 0x0645 && stus <= 0x0649)) {
        return {
            stus,
            type: "upload",
            frameIndex: data.length >= 4 ? readU16BE(data, 2) : 0,
            result: data.length >= 6 ? readU16BE(data, 4) : 0xffff,
        };
    }
    if (stus >= 0x0655 && stus <= 0x0659) {
        return {
            stus,
            type: "checksum",
            result: data.length >= 4 ? readU16BE(data, 2) : 0xffff,
            checksum: data.length >= 8
                ? (((readU16BE(data, 4) << 16) | readU16BE(data, 6)) >>> 0)
                : null,
        };
    }
    if (stus >= 0x0665 && stus <= 0x0669) {
        return {
            stus,
            type: "flash",
            result: data.length >= 4 ? readU16BE(data, 2) : 0xffff,
        };
    }
    return null;
};

export const handle_6000H_response = (data) => {
    const response = parse6000Response(data);
    const nonBlockingIndex = response
        ? nonBlocking6000Acks.findIndex((ack) => (
            ack.expectedStus === response.stus
            && (ack.stage !== "upload" || ack.frameIndex === response.frameIndex)
        ))
        : -1;

    if (nonBlockingIndex >= 0) {
        const [ack] = nonBlocking6000Acks.splice(nonBlockingIndex, 1);
        const result = response.result ?? 0;
        if (result === 0) {
            if (ack.responseMessage) {
                statusBar.receiveMessage(ack.responseMessage, "6000H");
            }
        } else {
            statusBar.receiveMessage(
                `${ack.label}应答失败：${resultDescription(result, response.type)}`,
                "6000H",
            );
        }
        return;
    }

    const pending = pending6000Ack;
    if (!pending) {
        statusBar.receiveMessage("收到未关联的 6000H 应答", "6000H");
        return;
    }

    if (pending.stage === "process") {
        if (data.length < 2) return;
        completePending6000({ ok: true, stage: "process", crc: readU16BE(data, 0) });
        return;
    }

    if (!response || response.stus !== pending.expectedStus) return;
    if (response.type === "upload" && response.frameIndex !== pending.frameIndex) {
        if(pending.skipOnTimeout){
            return;
        }
        completePending6000({
            ok: false,
            message: `应答帧号错误，期望${pending.frameIndex}，收到${response.frameIndex}`,
        });
        return;
    }

    const result = response.result ?? 0;
    const description = resultDescription(result, response.type);
    statusBar.receiveMessage(`收到${pending.label}应答：${description}`, "6000H");
    if (result !== 0) {
        completePending6000({ ok: false, message: `${pending.label}失败：${description}` });
        return;
    }
    completePending6000({ ok: true, response });
};

// 保留旧的命名导出，便于已有调用方逐步迁移。
export const handle_handshake_6000H_CX = handle_6000H_response;
export const handle_6000H_CX_upload = handle_6000H_response;
export const handle_process_6000H_CX = handle_6000H_response;
export const handle_handshake_6000H_YY = handle_6000H_response;
export const handle_uploadData_6000H_YY = handle_6000H_response;
