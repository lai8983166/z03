const dgram = require("dgram");
const EventEmitter = require("events");

const CMD = {
  WAKE: { cmd1: 0x01, cmd2: 0x00, flag: 0, len: 1 }, // 唤醒 0001H
  SLEEP: { cmd1: 0x04, cmd2: 0x00, flag: 1, len: 1 }, // 休眠 0004H
  SELF_TEST: { cmd1: 0x02, cmd2: 0x00, flag: 2, len: 0 }, // 自检 0002H
  CSZD_Recv_0100H: { cmd1: 0x00, cmd2: 0x01, flag: 3, len: 30 }, // 目标控制参数 0100H
  BBH: { cmd1: 0x30, cmd2: 0x00, flag: 5, len: 48 }, // 软件版本 0030H
  CMD_3000H: { cmd1: 0x00, cmd2: 0x30, flag: 6, len: 2 }, // 3000H
  NUC_CORRECT: { cmd1: 0x00, cmd2: 0x20, flag: 7, len: 1 }, // 非均匀校正 0020H
  DATA_COLLECT: { cmd1: 0x00, cmd2: 0x10, flag: 9, len: 1040 }, // 数据采集 1000H
  SELF_TEST_RES: { cmd1: 0x10, cmd2: 0x00, flag: 10, len: 5 }, // 自检结果 0010H
  CSZD_Recv_0200H: { cmd1: 0x00, cmd2: 0x02, flag: 11, len: 1040 }, // 参数装订 0200H
  ONE_CMD: { cmd1: 0x08, cmd2: 0x00, flag: 12, len: 1 }, // 一次指令 0008H
  GDCSZD_Recv_0300H: { cmd1: 0x00, cmd2: 0x03, flag: 13, len: 1 }, // 固定参数装订应答 0300H
  GDCSZDXC_0400H: { cmd1: 0x00, cmd2: 0x04, flag: 14, len: 30 }, // 固定参数下传应答 0400H
  CMD_0500H: { cmd1: 0x00, cmd2: 0x05, flag: 15, len: 100 }, // 0500H
  CMD_0600H: { cmd1: 0x00, cmd2: 0x06, flag: 16, len: 200 }, // 0600H
  CMD_0700H: { cmd1: 0x00, cmd2: 0x07, flag: 17, len: 1 }, // 0700H
  CMD_0800H: { cmd1: 0x00, cmd2: 0x08, flag: 18, len: 140 }, // 0800H
  IMAGE_UPLOAD_0B00H: { cmd1: 0x00, cmd2: 0x0b, flag: 19, len: 1040 }, // 图片上传 0B00H
    SJCJ_F000H: { cmd1: 0x00, cmd2: 0xf0, flag: 21, len: 1040 }, // 数据采集命令 F000H
    CSZD_4000H: { cmd1: 0x00, cmd2: 0x40, flag: 22, len: 1040 },
};

let bufffer = new Array();

class UdpBridge extends EventEmitter {
  constructor() {
    super();
    this.socket = dgram.createSocket("udp4");
    this.remote = null;
    this.isBound = false;
  }

  // 初始化 UDP
  init(localIp, localPort, remoteIp, remotePort) {
    this.remote = { address: remoteIp, port: remotePort };

    // 监听错误
    this.socket.on("error", (err) => {
      console.error("[ERROR] UDP socket error:", err);
      this.emit("error", err);
    });

    // 监听接收到的数据
    this.socket.on("message", (msg, rinfo) => {
      if (msg.length >= 16) {
        const cmd1 = msg[14];
        const cmd2 = msg[15];

        // 周期报文列表
        const isPeriodic =
          (cmd1 === 0x03 && cmd2 === 0x04) || // 心跳
          (cmd1 === 0xc0 && cmd2 === 0x1c) ||
          (cmd1 == 0xb0 && cmd2 === 0x1c) ||
          (cmd1 === 0xa0 && cmd2 === 0x1c); // 其他周期报文

        if (!isPeriodic) {
          console.log(
            `[RECV] UDP received ${msg.length} bytes from ${rinfo.address}:${rinfo.port}`,
          );
          //console.log("   Data (hex):", msg.toString("hex"));
          this._handleMessage(msg, rinfo);
        }
      }
    });

    // 绑定本地端口
    this.socket.bind(localPort, localIp, () => {
      console.log(`[OK] UDP bound to ${localIp}:${localPort}`);
      console.log(`   Remote: ${remoteIp}:${remotePort}`);
      this.emit("ready");
    });
  }

  /**
   * 发送数据包
   *
   *
   *
   *
   *
   */
  sendPacket(buffer) {
    if (!this.remote || !this.remote.address || !this.remote.port) {
      console.error(" [UDP] Remote IP/Port not set");
      return;
    }

    //bufffer.push(buffer);
    //console.log(bufffer);
    console.log(` [UDP] 发送到 ${this.remote.address}:${this.remote.port}`);
    console.log(`   长度: ${buffer.length} 字节`);
    console.log(
      `   数据: ${buffer.toString("hex")}
      }`,
    );

    this.socket.send(buffer, this.remote.port, this.remote.address, (err) => {
      if (err) {
        console.error(" [UDP] Send error:", err);
      } else {
        console.log(" [UDP] 发送成功");
        this.emit("sent", buffer);
      }
    });
  }

  /**
   * 内部处理接收到的消息
   */
  _handleMessage(msg, rinfo) {
    // 1. 基础校验 (12字节的规定)
    if (msg.length < 16 || msg[0] !== 0x13 || msg[1] !== 0x02) {
      return; // 丢弃无效包
    }

    // 提取命令字 (CMD)
    const cmd1 = msg[14];
    const cmd2 = msg[15];

    // 提取数据体，统一从 16 开始
      const payload = msg.subarray(16);
      console.log("udp:", payload);

    // 特殊处理：周期数据采集触发 (12=0x01, 13=0x02, 14=0x03)
    if (msg[12] === 0x01 && msg[13] === 0x02 && msg[14] === 0x03) {
      this.emit("SJCJ_trigger"); // 触发周期采集
      return;
    }

    // 3. 遍历命令表匹配
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
        }
        return;
      }
    }

    // 4. 未知命令
    console.log(
      `[UDP] Unknown CMD: 0x${cmd1.toString(16)} 0x${cmd2.toString(16)}`,
    );
  }

  // 关闭 socket
  close() {
    try {
      this.socket.close();
      console.log("[WS] UDP socket closed");
    } catch (e) {
      console.error("Error closing socket:", e);
    }
  }
}

module.exports = UdpBridge;
