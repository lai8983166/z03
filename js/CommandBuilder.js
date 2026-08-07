/**
 * 数据包构建器
 *
 * 封装 16 字节包头 + 数据载荷
 * 结构：
 * [00-01] 0x13 0x02  (固定头)
 * [02-05] 0x00...    (保留)
 * [06-07] Length     (后续数据长度，小端序)
 * [08-11] 0x00...    (保留)
 * [12]    0x54       (主站地址)
 * [13]    0x52       (从站地址)
 * [14]    Cmd Low    (命令字低位)
 * [15]    Cmd High   (命令字高位)
 * [16...] Payload    (数据体)
 *
 * @param {number} cmdByte1 - 命令字低位
 * @param {number} cmdByte2 - 命令字高位
 * @param {Uint8Array|Array} payload - 数据体
 * @returns {Uint8Array} - 组装好的二进制数据包
 */
export function buildPacket(cmdByte1, cmdByte2, payload = []) {
  let payloadData;
  if (payload instanceof Uint8Array) {
    payloadData = payload;
  } else {
    payloadData = new Uint8Array(payload || []);
  }

  const headerLen = 16;
  const totalLen = headerLen + payloadData.length;

  const buffer = new Uint8Array(totalLen);

  const view = new DataView(buffer.buffer);

  // [0-1] 固定头
  buffer[0] = 0x13;
  buffer[1] = 0x02;

  // [2-5] 保留 (默认为 0)

  // [6-7] 长度

  const lengthVal = payloadData.length + 2;
  view.setUint16(6, lengthVal, true); // true = 小端序

  // [8-11] 保留 (默认为 0)

  // [12-13] 地址位
  buffer[12] = 0x54; // 主站地址
  buffer[13] = 0x52; // 从站地址

  // [14-15] 命令字
  buffer[14] = cmdByte1; // 0xXX
  buffer[15] = cmdByte2; // 0x00

  if (payloadData.length > 0) {
    buffer.set(payloadData, 16);
  }

  return buffer;
}

/**
 * 辅助工具：将 Uint8Array 转为 Hex 字符串
 * 用于通过 WebSocket 发送 JSON
 * @param {Uint8Array} buffer
 * @returns {string}
 */
export function bufferToHex(buffer) {
  return Array.from(buffer)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}
