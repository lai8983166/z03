// 配置读取与校验。
//
// 后端由 tsx 运行（见 server.ts），本模块用 ESM import/export。
//
// 错误处理：loadConfig 在文件缺失 / 解析失败 / 关键字段校验失败时抛出
// Error。server 顶层不 catch，未捕获异常会使进程以非 0 退出，
// 行为上等价于 process.exit(1)，但可被单元测试用 expect().toThrow() 捕获。

import fs from "fs";

interface BridgeConfig {
  useTcp: boolean;
  localIp: string;
  localPort: number;
  remoteIp: string;
  remotePort: number;
}

interface Config {
  http: { port: number };
  ws: { port: number; portImg: number };
  imageUpload: { remoteIp: string; remotePort: number };
  bridges: [BridgeConfig, BridgeConfig, BridgeConfig];
  turntable: { serialPort: string; baudRate: number };
  video: {
    rtspUrl: string;
    binarizedRtspUrl: string;
    ffmpegPath: string;
    srcWidth: number;
    srcHeight: number;
    bytesPerPixel16bit: number;
  };
  dataDir: string;
}

/**
 * 校验配置对象，返回错误信息数组（空数组表示通过）。
 * 纯函数，不触碰文件系统，便于单元测试。
 */
function validateConfig(c: unknown): string[] {
  const errors: string[] = [];
  if (typeof c !== "object" || c === null || Array.isArray(c)) {
    return ["配置根必须是对象"];
  }
  const cfg = c as Record<string, unknown>;

  const need = (obj: unknown, key: string, type: string, path: string) => {
    const label = path ? `${path}.${key}` : key;
    if (typeof obj !== "object" || obj === null || !(key in obj)) {
      errors.push(`${label} 缺失`);
    } else if (typeof (obj as Record<string, unknown>)[key] !== type) {
      errors.push(`${label} 必须是 ${type}（实际: ${typeof (obj as Record<string, unknown>)[key]}）`);
    }
  };
  const needObj = (obj: unknown, key: string, path: string) => {
    const label = path ? `${path}.${key}` : key;
    if (typeof obj !== "object" || obj === null || !(key in obj)) {
      errors.push(`${label} 缺失`);
    } else {
      const v = (obj as Record<string, unknown>)[key];
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        errors.push(`${label} 必须是对象`);
      }
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
    cfg.bridges.forEach((b: unknown, i: number) => {
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
 */
function loadConfig(configPath: string): Config {
  if (!fs.existsSync(configPath)) {
    throw new Error(
      `[config] 配置文件不存在: ${configPath}（可从 config.example.json 复制一份为 config.json 后修改）`,
    );
  }
  let raw: string;
  try {
    raw = fs.readFileSync(configPath, "utf8");
  } catch (e) {
    throw new Error(`[config] 配置文件读取失败: ${configPath} - ${(e as Error).message}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    throw new Error(`[config] 配置文件 JSON 解析失败: ${configPath} - ${(e as Error).message}`);
  }
  const errors = validateConfig(parsed);
  if (errors.length > 0) {
    throw new Error(`[config] 配置文件校验失败 (${configPath}):\n  - ${errors.join("\n  - ")}`);
  }
  return parsed as Config;
}

export { loadConfig, validateConfig };
