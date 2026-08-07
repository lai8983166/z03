const WebSocket = require("ws");
const dgram = require("dgram");
const EventEmitter = require("events");

const CMD_54 = {
    FJYJZ: { cmd1: 0x00, cmd2: 0x20, flag: 0, len: 1 }, // 非均匀校正 2000H
    FJYJZ_0020: { cmd1: 0x20, cmd2: 0x00, flag: 27, len: 1 }, // 非均匀校正 0020H
    SELF_TEST: { cmd1: 0x01, cmd2: 0x00, flag: 2, len: 0 }, // 自检 0001H
    //CSZD_Recv_0100H: { cmd1: 0x00, cmd2: 0x01, flag: 3, len: 30 }, // 目标控制参数 0100H
    BBH: { cmd1: 0x20, cmd2: 0x00, flag: 5, len: 48 }, // 软件版本 0020H
    CMD_3000H: { cmd1: 0x00, cmd2: 0x30, flag: 6, len: 2 }, // 3000H
    NUC_CORRECT: { cmd1: 0x00, cmd2: 0x70, flag: 7, len: 1 }, // 非均匀校正 7000H
    

    //CSZD_Recv_0200H: { cmd1: 0x00, cmd2: 0x02, flag: 11, len: 1040 }, // 参数装订 0200H
    ONE_CMD: { cmd1: 0x08, cmd2: 0x00, flag: 12, len: 1 }, // 一次指令 0008H
    GDCSZD_Recv_0300H: { cmd1: 0x00, cmd2: 0x03, flag: 13, len: 1 }, // 固定参数装订应答 0300H
    GDCSZDXC_0400H: { cmd1: 0x00, cmd2: 0x04, flag: 14, len: 30 }, // 固定参数下传应答 0400H
    CMD_0500H: { cmd1: 0x00, cmd2: 0x50, flag: 15, len: 100 }, // 激光图像参数装订5000H
    CMD_0600H: { cmd1: 0x00, cmd2: 0x60, flag: 16, len: 200 }, // 激光图像参数装订下传6000H
    CMD_0700H: { cmd1: 0x00, cmd2: 0x07, flag: 17, len: 1 }, // 0700H
    CMD_0800H: { cmd1: 0x00, cmd2: 0x08, flag: 18, len: 140 }, // 0800H
    IMAGE_UPLOAD_0B00H: { cmd1: 0x00, cmd2: 0x0b, flag: 19, len: 1040 }, // 图片上传 B000H
    SJCJ_0010H: { cmd1: 0x00, cmd2: 0x10, flag: 21, len: 1040 }, // 数据采集命令 1000H
    CSZD_4000H: { cmd1: 0x00, cmd2: 0x40, flag: 22, len: 1040 },
    SJCJ_0100H: { cmd1: 0x00, cmd2: 0x01, flag: 23, len: 1040 }, // 数据采集命令 0100H
    CXSC_9000H: { cmd1: 0x00, cmd2: 0x90, flag: 24, len: 1040 }, // 程序上传/烧写9000H
    CXCX_A000H: { cmd1: 0x00, cmd2: 0xa0, flag: 25, len: 1040 }, // 程序查询A000H
    YC_DATA:{ cmd1: 0x01, cmd2: 0xa0, flag: 26, len: 1040},//遥测数据A001H
};

const CMD_32 = {
    SELF_TEST: { cmd1: 0x01, cmd2: 0x00, flag: 30, len: 1 }, // 要求从站自检 0001H
    SELF_TEST_RES: { cmd1: 0x10, cmd2: 0x00, flag: 31, len: 1 }, // 取从站自检结果 0010H
    BBH: { cmd1: 0x20, cmd2: 0x00, flag: 32, len: 0 }, // 取版本号 0020H
    SLEEP: { cmd1: 0x00, cmd2: 0x10, flag: 33, len: 30 }, // 休眠 1000H
    WAKE: { cmd1: 0x00, cmd2: 0x20, flag: 34, len: 30 }, // 唤醒 2000H
};

const CMD_4A = {
    SJL_SJCJ_B: { cmd1: 0x00, cmd2: 0x10, flag: 40, len: 1 }, // 取数据链数据采集B帧 1000H
    SJL_TB_B: { cmd1: 0x00, cmd2: 0x20, flag: 41, len: 1 }, // 取数据链同步B帧 2000H
    SJL_SJCJ_A: { cmd1: 0x00, cmd2: 0x01, flag: 42, len: 1 }, // 取数据链数据采集A帧 1000H
    SJL_TB_A: { cmd1: 0x00, cmd2: 0x02, flag: 43, len: 1 }, // 取数据链同步A帧 2000H
};

// 6000H 上传协议使用表4中的站地址，不能按原有 54H/32H/4AH 命令表路由。
const CODE_UPLOAD_6000H_AR = new Set([0xa0, 0x68, 0x32, 0x77, 0x55, 0x56]);
const CODE_UPLOAD_6000H_CO = 0x6000;

let upload_count_6000h=0;
let heixiazi_flag = false;
let yc_flag=false;

class TcpBridge extends EventEmitter {
    constructor() {
        super();
        this.mode = 'ws';       // 'ws' 或 'udp'
        this.client = null;     // WebSocket 实例
        this.socket = null;     // dgram UDP socket 实例
        this.localPort = null;
        this.remoteIP = null;
        this.remotePort = null;
        this.isConnected = false;
        this.shouldReconnect = true;
        this.recvBuffer = Buffer.alloc(0);
    }

    init(localIP, localPort, remoteIP, remotePort, mode = 'ws') {
        this.mode = mode;
        this.localPort = localPort;
        this.remoteIP = remoteIP;
        this.remotePort = remotePort;
        console.log(`[Bridge] init mode=${mode}, remote=${remoteIP}:${remotePort}, local port=${localPort}`);
        if (mode === 'udp') {
            this.bindUDP();
        } else {
            this.connectWS();
        }
    }

    bindUDP() {
        if (this.socket) {
            this.socket.close();
            this.socket = null;
        }
        this.socket = dgram.createSocket('udp4');

        this.socket.on('listening', () => {
            const addr = this.socket.address();
            console.log(`[UDP] 监听 ${addr.address}:${addr.port}`);
            this.isConnected = true;
            this.emit('ready');
        });

        this.socket.on('message', (msg, rinfo) => {
            //console.log("收到数据");
            // 转台 ASCII 帧透传
            const rawText = msg.toString('utf8');
            if (rawText.trimStart().startsWith('$')) {
                this.emit('raw_text', rawText);
                return;
            }
            this.handleData(msg, rinfo.port);
        });

        this.socket.on('error', (err) => {
            console.error('[UDP] 错误:', err);
            this.emit('error', err);
        });

        this.socket.on('close', () => {
            console.log('[UDP] socket 关闭');
            this.isConnected = false;
        });

        this.socket.bind(this.localPort);
    }

    connectWS() {
        console.log("ws conn");
        if (this.client) {
            this.client.removeAllListeners();
            this.client.terminate();
            this.client = null;
        }
        const url = `ws://${this.remoteIP}:${this.remotePort}`;
        console.log("正在连接", url);
        this.client = new WebSocket(url);

        this.client.binaryType = "nodebuffer";

        /*this.client.connect(this.remotePort, this.remoteIP, () => {
            console.log("Tcp已连接到", this.remoteIP,this.remotePort);
            this.isConnected = true;
            this.recvBuffer = Buffer.alloc(0);
            this.emit("ready");

        });*/

        this.client.on("open", () => {
            if (this.client._socket && this.client._socket.setNoDelay) {
                this.client._socket.setNoDelay(true);
                //console.log("已禁用nagle!!!!");
            }

            console.log("tcp已连接");
            this.isConnected = true;
            this.emit("ready");
        })

        this.client.on("message", (data) => {
            //console.log("数据来源类型：", Buffer.isBuffer(data));
            //const buffer=Buffer.isBuffer(data)?data:Buffer.from(data)
            
            //console.log("isBuffer::::::", Buffer.isBuffer(data));
            try {
                //const str = Buffer.isBuffer(data) ? data.toString('utf8') : data;
                //const obj = JSON.parse(str);
                
                //const msg = Buffer.from(obj.data, 'base64');

                // ---- 转台 ASCII 帧透传：若收到的是可打印文本（以 $ 开头），emit raw_text ----
                const rawText = data.toString('utf8');
                if (rawText.trimStart().startsWith('$')) {
                    this.emit('raw_text', rawText);
                }

               // console.log("obj.data:::", obj.data);
                //console.log("msg:::", msg);
                //console.log(obj.port);
                upload_count_6000h+=1;
            console.log(upload_count_6000h);
                this.handleData(data);
                //console.log(obj.port);
            } catch (err) {
                //console.error("消息解析失败", err.message);
                //console.error("原始数据", data.toString());
            }
        })

        //this.client.on("data", (data) => { this.handleData(data); })

        this.client.on("close", () => {
            console.log("Tcp链接关闭");
            this.isConnected = false;

        });

        this.client.on("error", (err) => {
            console.log("链接失败", err);
        });

        

    }

    handleData(msg,port) {
        //console.log(
        //    `[RECV]handleData received ${data.length} bytes from ${data.address}:${data.port}`,
        //);
        /*this.recvBuffer = Buffer.concat([this.recvBuffer, data]);
        
        while (this.recvBuffer.length >= 16) {
            const payloadLength = this.readUInt16LE(6);
            const totalPacketLength = 16 + payloadLength;

            if (this.recvBuffer.length < totalPacketLength) { break; }

            const packet = this.recvBuffer.subarray(0, totalPacketLength);
            this.recvBuffer = this.recvBuffer.subarray(totalPacketLength);

            this.emit("received", {
                data: packet,
                from: {
                    address: this.remoteIP,
                    port: this.remotePort,
                },
            });
        }*/
        
        /*const base64Str = data.toString('utf8');
        console.log("base64Str:::::", base64Str);
        const jsonStr = Buffer.from(base64Str, 'base64').toString('utf8');
        try {
            const obj = JSON.parse(jsonStr);
            console.log(obj);
        } catch (e) {
            console.log("解析失败：", jsonStr)
        }
        //console.log("obj::::", obj);*/
        //console.log(msg);
        /*const HexString = Array.from(msg)
            .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
            .join(" ");
        
        console.log(HexString);*/
        if (msg[0] == 0x13 && msg[1]== 0x00) {
            heixiazi_flag = true;
        }
        if (msg[0] == 0x13 && msg[1] == 0x01) {
            //const payload = msg.subarray(12);
            //const count=msg[4];
           // console.log("msg", msg);

            const data = msg;
           //console.log("data",msg);
            
            
            if (heixiazi_flag == true) { this.emit("heixiazi", { data}); return;}
            
        }
        /*const HexString = Array.from(msg)
            .map((byte) => byte.toString(16).padStart(2, "0").toUpperCase())
            .join(" ");

        console.log(HexString);*/
        
        if (msg.length < 16 || msg[0] !== 0x13 || msg[1] !== 0x02) {
            return; 
        }
        if (this.localPort == 30042) {
            //if(msg[14]==0x00&&msg[12]==0x11){yc_flag=true;}
            const payload = msg.subarray(12);
            //console.log("msg", msg);

            const data = payload;
            
                this.emit("YC", { data });
                return;
            
        }

        // 提取命令字 (CMD)
        const cmd1 = msg[14];
        const cmd2 = msg[15];
        
        const AR = msg[13];
        // 提取数据体，统一从 16 开始
        const payload = msg.subarray(16);

        // 发送端按协议布局为 [AR][AT][CO]，6000H 必须在通用 AR 路由之前处理。
        // 这样可以避免 32H 等地址被旧的 CMD_32 表截走。
        const protocolAr = msg[12];
        const protocolAt = msg[13];
        // 6000H 协议字节序为大端：CO、COMD 及所有 CP/SP 字均高字节在前。
        const protocolCo = (msg[14] << 8) | msg[15];
        const codeUploadAr = protocolAt === 0x52 && CODE_UPLOAD_6000H_AR.has(protocolAr)
            ? protocolAr
            : (protocolAr === 0x52 && CODE_UPLOAD_6000H_AR.has(protocolAt) ? protocolAt : null);
        if (
            codeUploadAr !== null
            && protocolCo === CODE_UPLOAD_6000H_CO
        ) {
            this.emit("rs485", {
                flag: 44,
                name: "CODE_UPLOAD_6000H",
                data: payload,
                meta: {
                    ar: codeUploadAr,
                    at: 0x52,
                    co: protocolCo,
                    command: payload.length >= 2 ? (payload[0] << 8) | payload[1] : null,
                },
            });

            
            return;
        }

        // 特殊处理：周期数据采集触发 (12=0x01, 13=0x02, 14=0x03)
        /*if (msg[12] === 0x01 && msg[13] === 0x02 && msg[14] === 0x03) {
            this.emit("SJCJ_trigger"); // 触发周期采集
            return;
        }*/
        let CMD = null;

        if (AR === 0x54) {
            CMD = CMD_54;
        } else if (AR === 0x32) {
            CMD = CMD_32;
        } else if (AR === 0x4A) {
            CMD = CMD_4A;
            //console.log("!!!!!!!!!!!!!!!!!!!!!!")
        } else{
            return;
        }

        // 命令表匹配
        for (const [name, def] of Object.entries(CMD)) {
            if (cmd1 === def.cmd1 && cmd2 === def.cmd2) {
                const data = payload;

                // 数据采集需要特殊处理（额外提取激光数据）
                if (name === "DATA_COLLECT") {
                    // 只有 recv_buf[5] === 0x00 时才处理主数据
                    if (msg[5] === 0x00) {
                        this.emit("rs485", { flag: def.flag, name, data });
                        this.emit("chart_update", data); // 给图表模块
                    }
                    // 激光数据始终提取 (recv_buf + 120, 108 bytes)
                    const laserData = msg.subarray(120, 120 + 108);
                    this.emit("laser_data", laserData);
                } else {
                    // 通用处理
                    this.emit("rs485", { flag: def.flag, name, data });
                    //console.log("!!!!!!!!!!");
                }
                return;
            }
        }

        // 未知命令
      //console.log(`[UDP] Unknown CMD: 0x${cmd1.toString(16)} 0x${cmd2.toString(16)}`);

        
    }

    sendPacket(buffer) {
        if (this.mode === 'udp') {
            this.sendUDP(buffer);
        } else {
            this.sendWS(buffer);
        }
    }

    sendUDP(buffer) {
        if (!this.socket || !this.isConnected) {
            console.log("[UDP] 未绑定，发送失败");
            return;
        }
        this.socket.send(buffer, this.remotePort, this.remoteIP, (err) => {
            if (err) {
                console.log("[UDP] 发送失败", err.message);
                this.emit("error", err);
            }
        });
    }

    sendWS(buffer) {
        if (!this.client || !this.isConnected) {
            console.log("tcp未连接，发送失败");
            return;
        }
        console.log("tcp sendpacket")
        const data = {
            "code": 0,
            "ip": "192.168.0.170",
            "port": 30041,
            "data": buffer.toString('base64')
        };
        console.log("data:::", data);
        const jsonStr = JSON.stringify(data);
        this.client.send(jsonStr, (err) => {
            if (err) {
                console.log("tcp发送失败", err.message);
                this.emit("error", err);
            } else {
                console.log("jsonStr:::", jsonStr);
                this.emit("sent", jsonStr);
            }
        });
    }

    close() {
        this.shouldReconnect = false;
        if (this.mode === 'udp') {
            if (this.socket) {
                this.socket.close();
                this.socket = null;
            }
        } else {
            if (this.client) {
                this.client.terminate();
                this.client = null;
            }
        }
        this.isConnected = false;
        console.log("[Bridge] 连接关闭");
    }
}

module.exports = TcpBridge;
