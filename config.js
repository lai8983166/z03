// 配置读取与校验。
//
// server.js 是 CommonJS 且直接用 `node server.js` 运行（无构建步骤），
// 因此本模块用 .js + JSDoc 类型；后续 change 把后端整体迁移到 TS 时
// 再连同 server 一并转为 config.ts。
//
// 错误处理：loadConfig 在文件缺失 / 解析失败 / 关键字段校验失败时抛出
// Error。server 顶层不 catch，未捕获异常会使 node 进程以非 0 退出，
// 行为上等价于 process.exit(1)，但可被单元测试用 expect().toThrow() 捕获。

const fs = require("fs");

/**
 * @typedef {Object} BridgeConfig
 * @property {boolean} useTcp
 * @property {string} localIp
 * @property {number} localPort
 * @property {string} remoteIp
 * @property {number} remotePort
 */

/**
 * @typedef {Object} Config
 * @property {{ port: number }} http
 * @property {{ port: number, portImg: number }} ws
 * @property {{ remoteIp: string, remotePort: number }} imageUpload
 * @property {[BridgeConfig, BridgeConfig, BridgeConfig]} bridges
 * @property {{ serialPort: string, baudRate: number }} turntable
 * @property {{ rtspUrl: string, binarizedRtspUrl: string, ffmpegPath: string, srcWidth: number, srcHeight: number, bytesPerPixel16bit: number }} video
 * @property {string} dataDir
 */

/**
 * 校验配置对象，返回错误信息数组（空数组表示通过）。
 * 纯函数，不触碰文件系统，便于单元测试。
 * @param {unknown} c
 * @returns {string[]}
 */
function validateConfig(c) {
  const errors = [];
  if (typeof c !== "object" || c === null || Array.isArray(c)) {
    return ["配置根必须是对象"];
  }
  const cfg = c;

  const need = (obj, key, type, path) => {
    const label = path ? `${path}.${key}` : key;
    if (!(key in obj)) {
      errors.push(`${label} 缺失`);
    } else if (typeof obj[key] !== type) {
      errors.push(`${label} 必须是 ${type}（实际: ${typeof obj[key]}）`);
    }
  };
  const needObj = (obj, key, path) => {
    const label = path ? `${path}.${key}` : key;
    if (!(key in obj)) {
      errors.push(`${label} 缺失`);
    } else if (typeof obj[key] !== "object" || obj[key] === null || Array.isArray(obj[key])) {
      errors.push(`${label} 必须是对象`);
    }
  };

  needObj(cfg, "http", "");
  if (cfg.http && typeof cfg.http === "object") need(cfg.http, "port", "number", "http");

  needObj(cfg, "ws", "");
  if (cfg.ws && typeof cfg.ws === "object") {
    need(cfg.ws, "port", "number", "ws");
    need(cfg.ws, "portImg", "number", "ws");
  }

  needObj(cfg, "imageUpload", "");
  if (cfg.imageUpload && typeof cfg.imageUpload === "object") {
    need(cfg.imageUpload, "remoteIp", "string", "imageUpload");
    need(cfg.imageUpload, "remotePort", "number", "imageUpload");
  }

  if (!Array.isArray(cfg.bridges) || cfg.bridges.length !== 3) {
    errors.push("bridges 必须是长度为 3 的数组");
  } else {
    cfg.bridges.forEach((/** @type {unknown} */ b, i) => {
      const p = `bridges[${i}]`;
      if (typeof b !== "object" || b === null || Array.isArray(b)) {
        errors.push(`${p} 必须是对象`);
        return;
      }
      need(b, "useTcp", "boolean", p);
      need(b, "localIp", "string", p);
      need(b, "localPort", "number", p);
      need(b, "remoteIp", "string", p);
      need(b, "remotePort", "number", p);
    });
  }

  needObj(cfg, "turntable", "");
  if (cfg.turntable && typeof cfg.turntable === "object") {
    need(cfg.turntable, "serialPort", "string", "turntable");
    need(cfg.turntable, "baudRate", "number", "turntable");
  }

  needObj(cfg, "video", "");
  if (cfg.video && typeof cfg.video === "object") {
    need(cfg.video, "rtspUrl", "string", "video");
    need(cfg.video, "binarizedRtspUrl", "string", "video");
    need(cfg.video, "ffmpegPath", "string", "video");
    need(cfg.video, "srcWidth", "number", "video");
    need(cfg.video, "srcHeight", "number", "video");
    need(cfg.video, "bytesPerPixel16bit", "number", "video");
  }

  need(cfg, "dataDir", "string", "");

  return errors;
}

/**
 * 加载并校验配置文件。
 * 文件缺失 / JSON 解析失败 / 关键字段校验失败时抛出 Error。
 * @param {string} configPath
 * @returns {Config}
 */
function loadConfig(configPath) {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `[config] 配置文件不存在: ${configPath}（可从 config.example.json 复制一份为 config.json 后修改）`,
    );
  }
  let raw;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (e) {
    throw new Error(`[config] 配置文件读取失败: ${configPath} - ${/** @type {Error} */ (e).message}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`[config] 配置文件 JSON 解析失败: ${configPath} - ${/** @type {Error} */ (e).message}`);
  }
  const errors = validateConfig(parsed);
  if (errors.length > 0) {
    throw new Error(`[config] 配置文件校验失败 (${configPath}):\n  - ${errors.join("\n  - ")}`);
  }
  return /** @type {Config} */ (parsed);
}

module.exports = { loadConfig, validateConfig };
