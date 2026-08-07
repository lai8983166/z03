/**
 * 解析 _loc.csv 定义内存布局，维护二进制缓冲区 (ArrayBuffer)，
 * 处理数据类型转换、精度缩放 (Scale) 和大小端 (Endian)。
 */

/**
 * 数据类型枚举。注意：parseLocData 在类型字符串无法识别时会把原始
 * 字符串赋给 MetaItem.type，因此 type 字段实际为 string（如实描述当前行为）。
 */
const DataType = {
  UINT8: "UINT8",
  INT8: "INT8",
  UINT16: "UINT16",
  INT16: "INT16",
  UINT32: "UINT32",
  INT32: "INT32",
  FLOAT32: "FLOAT",
  FLOAT64: "DOUBLE",
  RES: "RES", // 预留位
  NOTUSE: "NOTUSE",
};

/**
 * @typedef {Object} MetaItem
 * @property {number} index - CSV 中的序号
 * @property {number} row - 来源行号
 * @property {number} col - 来源列号
 * @property {string} name - 字段名
 * @property {string} type - DataType 的某个值，或未识别的原始类型字符串
 * @property {number} scale - 物理值缩放（0 表示不缩放）
 * @property {number} byteWidth - 该字段字节宽度
 * @property {number} offset - 在 buffer 中的字节偏移
 */

/**
 * 按 _loc.csv 定义维护一块二进制缓冲区，提供按 index/name 的读写、
 * 表格双向同步、scale/endian 换算。DOM 相关方法（readCell/updateAllToTable 等）
 * 依赖浏览器 document，不在本 change 单元测试范围。
 */
class BinaryTableHelper {
  constructor() {
    /** @type {Map<number, MetaItem>} 按 index 存储字段定义 */
    this.metaData = new Map();

    this.buffer = null;
    this.view = null; // DataView 用于读写 buffer

    // 小端模式
    this.isLittleEndian = true;

    this.totalBytes = 0;
  }

  /**
   * 设置大小端模式
   * @param {boolean} isLittle true=小端, false=大端
   */
  setEndian(isLittle) {
    this.isLittleEndian = isLittle;
  }

  /**
   * 获取数据类型的字节宽度
   */
  getTypeWidth(type) {
    switch (type) {
      case DataType.UINT8:
      case DataType.INT8:
        return 1;
      case DataType.UINT16:
      case DataType.INT16:
        return 2;
      case DataType.UINT32:
      case DataType.INT32:
      case DataType.FLOAT32:
        return 4;
      case DataType.FLOAT64:
        return 8;
      default:
        return 0;
    }
  }

  /**
   * 解析 _loc.csv 内容并初始化缓冲区
   * @param {string} csvContent _loc.csv 的文件文本内容
   */
  parseLocData(csvContent) {
    this.metaData.clear();
    this.totalBytes = 0;

    const lines = csvContent
      .split(/\r?\n/)
      .filter((line) => line.trim() !== "");

    // 解析结构
    lines.forEach((line, rowIdx) => {
      const columns = line.split(",");
      columns.forEach((cellStr, colIdx) => {
        // 单元格格式："序号+类型+缩放" (0+UINT16+0.1) 或 "序号+RES+字节数" (2+RES+4)
        const parts = cellStr.split("+");

        if (parts.length === 3) {
          const index = parseInt(parts[0]);
          const typeStr = parts[1].trim(); // 类型字符串
          let name = "";

          // 字段名位于定义单元格左侧。数组字段的一行可能包含多个定义，
          // 因此需要向左越过其他定义单元格，找到最近的名称单元格。
          for (let nameCol = colIdx - 1; nameCol >= 0; nameCol--) {
            const candidate = columns[nameCol].trim();
            if (!candidate) continue;
            const candidateParts = candidate.split("+");
            const isDefinition =
              candidateParts.length === 3 &&
              Number.isInteger(parseInt(candidateParts[0], 10));
            if (!isDefinition) {
              name = candidate;
              break;
            }
          }

          let type = DataType.NOTUSE;
          let scale = 0;
          let byteWidth = 0;

          // 映射类型字符串到枚举
          if (typeStr === "RES") {
            type = DataType.RES;
            byteWidth = parseInt(parts[2]); // RES 直接读取字节数
          } else {
            for (let key in DataType) {
              if (
                typeStr.includes(key) ||
                (key === "FLOAT32" && typeStr === "FLOAT") ||
                (key === "FLOAT64" && typeStr === "DOUBLE")
              ) {
                type = DataType[key];
                break;
              }
            }
            // 如果没匹配到，默认为 NOTUSE 或抛出错误
            if (!type) type = typeStr;

            scale = parseFloat(parts[2]);
            byteWidth = this.getTypeWidth(type);
          }

          this.metaData.set(index, {
            index: index,
            row: rowIdx,
            col: colIdx,
            name,
            type: type,
            scale: scale,
            byteWidth: byteWidth,
            offset: 0,
          });
        }
      });
    });

    // 计算 Offset 和 总大小
    // Map按index 排序
    const sortedKeys = Array.from(this.metaData.keys()).sort((a, b) => a - b);

    let currentOffset = 0;
    sortedKeys.forEach((key) => {
      const item = this.metaData.get(key);
      item.offset = currentOffset;
      currentOffset += item.byteWidth;
      // 更新回 Map
      this.metaData.set(key, item);
    });

    this.totalBytes = currentOffset;

    //分配内存
    if (this.totalBytes > 0) {
      this.buffer = new ArrayBuffer(this.totalBytes);
      this.view = new DataView(this.buffer);
      console.log(`[BinaryHelper] Buffer allocated: ${this.totalBytes} bytes`);
    }
  }

  /**
   * 按 CSV 中的字段名查找定义索引。
   * @param {string} name 字段名（精确匹配）
   * @param {number} occurrence 同名字段的第几个定义，默认第一个
   * @returns {number|null}
   */
  getIndexByName(name, occurrence = 0) {
    const matches = Array.from(this.metaData.entries())
      .filter(([, item]) => item.name === name)
      .sort(([indexA], [indexB]) => indexA - indexB);
    return matches[occurrence]?.[0] ?? null;
  }

  /**
   * 按字段名获取元数据。
   * @param {string} name 字段名（精确匹配）
   * @param {number} occurrence 同名字段的第几个定义，默认第一个
   * @returns {Object|null}
   */
  getMetaByName(name, occurrence = 0) {
    const index = this.getIndexByName(name, occurrence);
    return index === null ? null : this.metaData.get(index);
  }

  /**
   * 按字段名写入值，避免业务逻辑依赖易变化的协议序号。
   */
  setValueByName(name, uiValue, occurrence = 0) {
    const index = this.getIndexByName(name, occurrence);
    return index === null ? false : this.setValue(index, uiValue);
  }

  /**
   * 按字段名读取值，避免业务逻辑依赖易变化的协议序号。
   */
  getValueByName(name, occurrence = 0) {
    const index = this.getIndexByName(name, occurrence);
    return index === null ? "ERR" : this.getValue(index);
  }

  /**
   * 将界面上的值写入二进制缓冲区
   * @param {number} index 数据索引
   * @param {string|number} uiValue 界面上的值 (字符串或数字)
   * @returns {boolean}
   */
  setValue(index, uiValue) {
    if (!this.view || !this.metaData.has(index)) return false;

    const item = this.metaData.get(index);

    // RES 类型通常不支持界面写入，或者是直接写 Hex 字符串，这里暂且跳过或按需实现
    if (item.type === DataType.RES || item.type === DataType.NOTUSE)
      return true;

    let numVal = parseFloat(uiValue);
    if (isNaN(numVal)) return false;

    // 界面值 10.0, scale 0.1 => 内存值 1
    if (item.scale !== 0) {
      numVal = numVal * item.scale;
    }

    try {
      switch (item.type) {
        case DataType.UINT8:
          this.view.setUint8(item.offset, numVal);
          break;
        case DataType.INT8:
          this.view.setInt8(item.offset, numVal);
          break;
        case DataType.UINT16:
          this.view.setUint16(item.offset, numVal, this.isLittleEndian);
          break;
        case DataType.INT16:
          this.view.setInt16(item.offset, numVal, this.isLittleEndian);
          break;
        case DataType.UINT32:
          this.view.setUint32(item.offset, numVal, this.isLittleEndian);
          break;
        case DataType.INT32:
          this.view.setInt32(item.offset, numVal, this.isLittleEndian);
          break;
        case DataType.FLOAT32:
          this.view.setFloat32(item.offset, numVal, this.isLittleEndian);
          break;
        case DataType.FLOAT64:
          this.view.setFloat64(item.offset, numVal, this.isLittleEndian);
          break;
      }
    } catch (e) {
      console.error(`Error writing value at index ${index}:`, e);
      return false;
    }
    return true;
  }

  /**
   * 从二进制缓冲区读取值用于界面显示
   * @param {number} index 数据索引
   * @returns {string} 格式化后的字符串
   */
  getValue(index) {
    if (!this.view || !this.metaData.has(index)) return "ERR";

    const item = this.metaData.get(index);
    if (item.type === DataType.RES) return ""; // 或者返回 Hex 字符串

    let rawVal = 0;
    switch (item.type) {
      case DataType.UINT8:
        rawVal = this.view.getUint8(item.offset);
        break;
      case DataType.INT8:
        rawVal = this.view.getInt8(item.offset);
        break;
      case DataType.UINT16:
        rawVal = this.view.getUint16(item.offset, this.isLittleEndian);
        break;
      case DataType.INT16:
        rawVal = this.view.getInt16(item.offset, this.isLittleEndian);
        break;
      case DataType.UINT32:
        rawVal = this.view.getUint32(item.offset, this.isLittleEndian);
        break;
      case DataType.INT32:
        rawVal = this.view.getInt32(item.offset, this.isLittleEndian);
        break;
      case DataType.FLOAT32:
        rawVal = this.view.getFloat32(item.offset, this.isLittleEndian);
        break;
      case DataType.FLOAT64:
        rawVal = this.view.getFloat64(item.offset, this.isLittleEndian);
        break;
      default:
        return "NULL";
    }

      // 应用缩放
      if (item.scale !== 0) {
        // C++: raw / scale

        const phyVal = rawVal / item.scale;

        // 限制小数点后最多4位
        return this.formatFloat(phyVal, 4);
      } else {
        if (item.type === DataType.FLOAT32 || item.type === DataType.FLOAT64) {
          return this.formatFloat(rawVal, 4);
        }
        return rawVal.toString();
      }
    }

    /**
     * 格式化浮点数显示，限制小数位数
     * @param {number} value - 要格式化的值
     * @param {number} maxDecimals - 最大小数位数
     * @returns {string} 格式化后的字符串
     */
    formatFloat(value, maxDecimals = 4) {
      // 如果是整数，直接返回
      if (Number.isInteger(value)) {
        return value.toString();
      }

      // 如果数据过小（如科学计数法的超小有效位），直接避免全0
      const str = value.toString();
      if (str.includes('e')) {
        return Number(value.toFixed(maxDecimals)).toString() === "0" ? value.toExponential(maxDecimals) : Number(value.toFixed(maxDecimals)).toString();
      }

      // 截取小数位并去除末尾无效的 0
      return Number(value.toFixed(maxDecimals)).toString();
    }  /**
   * 获取整个二进制 Buffer 用于发送
   * @returns {Uint8Array}
   */
  getBufferForSend() {
    if (!this.buffer) return new Uint8Array(0);
    return new Uint8Array(this.buffer);
  }

  /**
   * 接收数据并覆盖当前 Buffer
   * @param {ArrayBuffer|Uint8Array} data
   */
  loadBufferFromNet(data) {
    if (!this.buffer) return;

    // 确保数据是 Uint8Array
    const src = new Uint8Array(data);
    const dst = new Uint8Array(this.buffer);

    const len = Math.min(src.length, dst.length);
    dst.set(src.subarray(0, len));
  }

  /**
   * 将 Helper 内部 buffer 的一段数据拷贝到外部 buffer
   * * @param {Uint8Array} targetBuffer - 目标的发送 buffer
   * @param {number} targetOffset - 目标 buffer 的写入起始位置 (例如 ptr[20])
   * @param {number} dataIndex - _loc 定义中的数据索引 (例如 第5个数据)
   * @param {number} count - 要拷贝多少个定义项 (例如 1个 或 27个)
   */
  copyTo(targetBuffer, targetOffset, dataIndex, count) {
    if (!this.view) return;

    //找到起始偏移
    const startItem = this.metaData.get(dataIndex);
    if (!startItem) return;
    const startByteOffset = startItem.offset;

    // 计算总字节数
    let totalBytesToCopy = 0;
    for (let i = 0; i < count; i++) {
      const item = this.metaData.get(dataIndex + i);
      if (item) {
        totalBytesToCopy += item.byteWidth;
      }
    }

    const srcSubArray = new Uint8Array(this.buffer).subarray(
      startByteOffset,
      startByteOffset + totalBytesToCopy,
    );

    if (targetOffset + totalBytesToCopy > targetBuffer.length) {
      console.error("Buffer overflow in copyTo");
      return;
    }

    targetBuffer.set(srcSubArray, targetOffset);
  }

  /**
   * 从指定表格读取单元格的值
   * @param {string} tableId - HTML 表格 ID
   * @param {number} row - 行号
   * @param {number} col - 列号
   * @returns {string}
   */
  readCell(tableId, row, col) {
    const table = document.getElementById(tableId);
    if (!table || !table.rows[row]) return "";

    const cell = table.rows[row].cells[col];
    if (!cell) return "";

    // 处理 input/select 元素
    const input = cell.querySelector("input, select");
    if (input) return input.value.trim();

    return cell.textContent.trim();
  }

  /**
   * 从表格更新单个数据到内存
   * @param {string} tableId - HTML 表格 ID
   * @param {number} index - 数据索引
   * @returns {boolean}
   */
  updateBufFromTable(tableId, index) {
    if (!this.view || !this.metaData.has(index)) return false;

    const item = this.metaData.get(index);

    if (item.type === DataType.RES || item.type === DataType.NOTUSE) {
      return true;
    }

    //从表格读取值
    const str = this.readCell(tableId, item.row, item.col);
    if (str === "") return true;

    let numVal = 0;

    //处理十六进制
    if (str.startsWith("0x") || str.startsWith("0X")) {
      numVal = parseInt(str, 16);
    } else {
      numVal = parseFloat(str);
    }

    if (isNaN(numVal)) return false;

    //应用缩放
    if (item.scale !== 0) {
      numVal = numVal * item.scale;
    }

    // 写入内存
    try {
      switch (item.type) {
        case DataType.UINT8:
          this.view.setUint8(item.offset, numVal & 0xff);
          break;
        case DataType.INT8:
          this.view.setInt8(item.offset, numVal);
          break;
        case DataType.UINT16:
          this.view.setUint16(
            item.offset,
            numVal & 0xffff,
            this.isLittleEndian,
          );
          break;
        case DataType.INT16:
          this.view.setInt16(item.offset, numVal, this.isLittleEndian);
          break;
        case DataType.UINT32:
          this.view.setUint32(item.offset, numVal >>> 0, this.isLittleEndian);
          break;
        case DataType.INT32:
          this.view.setInt32(item.offset, numVal, this.isLittleEndian);
          break;
        case DataType.FLOAT32:
          this.view.setFloat32(item.offset, numVal, this.isLittleEndian);
          break;
        case DataType.FLOAT64:
          this.view.setFloat64(item.offset, numVal, this.isLittleEndian);
          break;
      }
    } catch (e) {
      console.error(`Error writing index ${index}:`, e);
      return false;
    }

    return true;
  }

  /**
   * 从表格批量更新所有数据到内存
   * @param {string} tableId - HTML 表格 ID
   * @returns {boolean}
   */
  updateAllFromTable(tableId) {
    if (!this.view) return false;

    let success = true;
    this.metaData.forEach((item, index) => {
      if (!this.updateBufFromTable(tableId, index)) {
        success = false;
      }
    });

    return success;
  }

  /**
   * 从内存更新所有数据到表格（用于接收数据后刷新 UI）
   * @param {string} tableId - HTML 表格 ID
   */
  updateAllToTable(tableId) {
    const table = document.getElementById(tableId);
    if (!table || !this.view) return;

    this.metaData.forEach((item, index) => {
      if (item.type === DataType.RES || item.type === DataType.NOTUSE) return;

      const row = table.rows[item.row];
      if (!row) return;

      const cell = row.cells[item.col];
      if (!cell) return;

      const value = this.getValue(index);

      // 处理 input/select 元素
      const input = cell.querySelector("input, select");
      if (input) {
        input.value = value;
      } else {
        cell.textContent = value;
      }
    });
  }

  /**
   * 按字段顺序返回所有非保留字段的当前值数组
   * 与 loadBufferFromNet 配合使用，可从实际发送的字节直接提取各字段值
   * @returns {Array} 字段值数组（顺序与 metaData 的 index 排序一致）
   */
  getAllValues() {
    const sortedKeys = Array.from(this.metaData.keys()).sort((a, b) => a - b);
    const result = [];
    for (const key of sortedKeys) {
      const item = this.metaData.get(key);
      if (item.type === DataType.RES || item.type === DataType.NOTUSE) continue;
      result.push(this.getValue(key));
    }
    return result;
  }

  /**
   * 按字段顺序返回所有非保留字段的名称数组（从 HTML 表格名称列读取）
   * 名称列 = 值列 - 1（CSV 格式：name, value, name, value, ...）
   * @param {string} tableId - HTML 表格 ID
   * @returns {string[]} 字段名称数组
   */
  getAllNames(tableId) {
    const table = document.getElementById(tableId);
    const sortedKeys = Array.from(this.metaData.keys()).sort((a, b) => a - b);
    const result = [];
    for (const key of sortedKeys) {
      const item = this.metaData.get(key);
      if (item.type === DataType.RES || item.type === DataType.NOTUSE) continue;
      let name = `字段${key}`;
      if (table) {
        const row = table.rows[item.row];
        if (row && row.cells[item.col - 1]) {
          const text = row.cells[item.col - 1].textContent.trim();
          if (text) name = text;
        }
      }
      result.push(name);
    }
    return result;
  }

  /**
   * 获取指定索引的详细信息（用于调试和显示）
   * @param {string} tableId - HTML 表格 ID
   * @param {number} index - 数据索引
   * @returns {Object|null} 包含 uiValue, memoryValue, scale, type 等信息
   */
  getSpecInfo(tableId, index) {
    const table = document.getElementById(tableId);
    if (!table || !this.view) return null;

    const item = this.metaData.get(index);
    if (!item) return null;

    const row = item.row;
    const col = item.col;
    const uiValue = this.readCell(tableId, row, col);

    let memoryValue = 0;
    try {
      switch (item.type) {
        case DataType.UINT8:
          memoryValue = this.view.getUint8(item.offset);
          break;
        case DataType.INT8:
          memoryValue = this.view.getInt8(item.offset);
          break;
        case DataType.UINT16:
          memoryValue = this.view.getUint16(item.offset, this.isLittleEndian);
          break;
        case DataType.INT16:
          memoryValue = this.view.getInt16(item.offset, this.isLittleEndian);
          break;
        case DataType.UINT32:
          memoryValue = this.view.getUint32(item.offset, this.isLittleEndian);
          break;
        case DataType.INT32:
          memoryValue = this.view.getInt32(item.offset, this.isLittleEndian);
          break;
        case DataType.FLOAT32:
          memoryValue = this.view.getFloat32(item.offset, this.isLittleEndian);
          break;
        case DataType.FLOAT64:
          memoryValue = this.view.getFloat64(item.offset, this.isLittleEndian);
          break;
        case DataType.RES:
          // 保留字段，读取原始字节
          const resBytes = new Uint8Array(
            this.buffer,
            item.offset,
            item.byteWidth,
          );
          memoryValue = Array.from(resBytes)
            .map((b) => b.toString(16).padStart(2, "0"))
            .join(" ");
          break;
        default:
          memoryValue = "N/A";
      }
    } catch (e) {
      console.error(`Error reading memory at index ${index}:`, e);
      memoryValue = "ERR";
    }
    return {
      uiValue,
      memoryValue,
      scale: item.scale,
      type: item.type,
    };
  }
}

/**
 * 管理多个协议的 BinaryTableHelper 实例。init() 并发 fetch 所有 _loc.csv
 * 并解析；get() 按协议名取出 helper。模块底部导出单例。
 * 注意：init 依赖 fetch，不在本 change 单元测试范围。
 */
class PacketManager {
  constructor() {
    /** @type {Object.<string, BinaryTableHelper>} */
    this.packets = {};

    //Web端无法自动扫描文件夹，必须手动列出，或者请求一个包含列表的json
    this.protocols = [
      "SJCJ_Recv",
      "SJCJ_Send",
      "SJCJ_F000H_Recv",
      "SJCJ_F000H_Send",
      "JGCSZD_Send",
      "IRDetectParam_Recv",
      "Wake_Send",
      "App_Ver_Recv",
      "CSZD",
      "CSZD_Recv",
      "CSZD_ZTZ",
      "CSZD_ZTZ_Recv",
      "GDCSZD_Recv",
      "GDCSZD_Send",
      "HWYDZT_Recv",
      "IRDetectParam_Send",
      "JFSJ_Recv",
      "JFSJ_Send",
      "JGCSZD",
      "JGCSZD_Send",
      "JGCSZD_Recv",
      "JGCSZDXC_Recv",
      "JGGZZT_Recv",
      "OnceCommand_Send",
      "Product_Pic",
      "RJBB_Recv",
      "SFCS",
      "SFCSZD",
      "Shut_Send",
        "ZJJG_Recv",
        "CSZD_Send_3000H",
        "CSZD_Send_3000H_JJHCS",
        "CSZD_Recv_3000H",
        "YCTX_Recv",
        "SJL_SJCJ_Send",
        "SJL_SJCJ_Recv_0x00",
        "SJL_SJCJ_Recv_0xFF",
        "LVDS_YC_Recv",
    ];
  }

  /**
   * 初始化：并发请求所有 CSV 文件并解析
   * @param {string} csvBaseUrl - csv 文件存放的相对路径
   */
  async init(csvBaseUrl = "./csv/") {
    console.log(
      `[PacketManager] Starting to load protocols from ${csvBaseUrl}...`,
    );

    // 创建一组 Promise，并行下载所有 CSV
    const loadPromises = this.protocols.map(async (name) => {
      const fileName = `${name}_loc.csv`;
      const url = `${csvBaseUrl}${fileName}`;

      try {
        const response = await fetch(url);

        if (!response.ok) {
          throw new Error(`HTTP Error ${response.status}`);
        }

        const csvContent = await response.text();

        const helper = new BinaryTableHelper();

        helper.parseLocData(csvContent);

        this.packets[name] = helper;

        console.log(
          `[PacketManager] Loaded: ${name}, Size: ${helper.totalBytes} bytes`,
        );
      } catch (error) {
        console.error(`[PacketManager] Failed to load ${fileName}:`, error);
      }
    });

    await Promise.all(loadPromises);
    console.log("[PacketManager] All protocols loaded.");
  }

  /**
   * 获取指定协议的 Helper
   * @param {string} protocolName
   * @returns {BinaryTableHelper}
   */
  get(protocolName) {
    if (!this.packets[protocolName]) {
      console.warn(
        `[PacketManager] Protocol not found or not loaded: ${protocolName}`,
      );
      return null;
    }
    return this.packets[protocolName];
  }
}

export default new PacketManager();
