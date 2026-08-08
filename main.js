/**
 *
 *
 *
 *  页面初始化
 *  标签页切换逻辑
 * 单选按钮组初始化
 *  LED 指示灯初始化
 *  提供公共工具函数 Utils（CSV 加载、表格操作等）
 */

import { initializeInfraredTables } from "./js/Infrared.js";
import { initializeLaserTables } from "./js/Laser.js";
import { initializeCommandTables } from "./js/Command.js";
import { initializeChart } from "./js/Chart.js";
import wsClient from "./js/Client.js";
import PacketManager from "./js/BinaryTableHelper";
import statusBar from "./js/StatusBar.js";
import { initializeUploadImage } from "./js/ImageUpload.js";
import { initializeVideoStream, initializeBinarizedStream } from "./js/Video.js";
import { initializeCodeUpload } from "./js/CodeUpload.js";
import { initializeTelemeter } from "./js/Telemeter.js";
import { initializeDataRouter } from "./js/DataRouter.js";
import { initializeYC } from "./js/YC.js";
import { initTurntableUI } from "./js/TurntableControl.js";

const AppState = {
  currentTab: 2,
};

export const Utils = {
  /**
   * 加载 CSV 到表格，并支持指定单元格可编辑
   * @param {string} csvPath - CSV 文件路径
   * @param {string} tableId - 表格 ID
   * @param {number} rows - 行数
   * @param {number} cols - 列数
   * @param {Array<{row: number, col: number}>} editableCells - 可编辑的单元格列表，例如 [{row: 0, col: 1}, {row: 3, col: 1}]
   */
  async loadCSVToTable(csvPath, tableId, rows, cols, editableCells = []) {
    try {
      const response = await fetch(csvPath);
      const csvText = await response.text();
      const lines = csvText.trim().split("\n");

      const table = document.getElementById(tableId);
      if (!table) {
        console.error(`Table ${tableId} not found`);
        return;
      }

      lines.forEach((line, rowIndex) => {
        if (rowIndex >= rows) return;
        const values = line.split(",");
        const tr = table.rows[rowIndex];

        if (tr) {
          values.forEach((val, colIndex) => {
            if (colIndex >= cols) return;
            const td = tr.cells[colIndex];
            if (td) {
              td.textContent = val.trim();

              // [STAR] 检查是否在可编辑列表中
              const isEditable = editableCells.some(
                (cell) => cell.row === rowIndex && cell.col === colIndex,
              );

              if (isEditable) {
                td.contentEditable = "true";
                td.style.backgroundColor = "#fff8dc"; // 淡黄色背景
                td.style.cursor = "text";
                td.style.border = "1px solid #ccc";

                // 可选：添加焦点样式
                td.addEventListener("focus", function () {
                  this.style.backgroundColor = "#fffacd";
                });
                td.addEventListener("blur", function () {
                  this.style.backgroundColor = "#fff8dc";
                });
              }
            }
          });
        }
      });
    } catch (error) {
      console.error(`Failed to load CSV ${csvPath}:`, error);
    }
  },

  /**
   * 获取可编辑单元格的值，返回 Map（以 "row,col" 字符串为键）
   * @param {string} tableId
   * @param {Array<{row: number, col: number}>} editableCells
   * @returns {Map<string, string>} - Map<"row,col", value>
   *
   * @example
   * const map = Utils.getEditableCellsAsPositionMap("tableWidget_CSZD", editableCells_CSZD);
   * const val = map.get("3,1"); // 获取第3行第1列的值
   */
  getEditableCellsAsPositionMap(tableId, editableCells) {
    const table = document.getElementById(tableId);
    if (!table) {
      console.error(`Table ${tableId} not found`);
      return new Map();
    }

    const map = new Map();

    editableCells.forEach(({ row, col }) => {
      const tr = table.rows[row];
      if (!tr) return;

      const td = tr.cells[col];
      if (!td) return;

      // 处理可能包含 input 元素的情况
      const input = td.querySelector("input");
      const value = input ? input.value.trim() : td.textContent.trim();

      // [STAR] 使用 "row,col" 作为键
      map.set(`${row},${col}`, value);
    });

    return map;
  },

  /**
   * 设置表格中指定单元格为可编辑
   * @param {string} tableId - 表格 ID
   * @param {Array<{row: number, col: number}>} editableCells - 可编辑单元格列表
   */
  setEditableCells(tableId, editableCells) {
    const table = document.getElementById(tableId);
    if (!table) {
      console.error(`Table ${tableId} not found`);
      return;
    }

    editableCells.forEach(({ row, col }) => {
      const tr = table.rows[row];
      if (tr) {
        const td = tr.cells[col];
        if (td) {
          td.contentEditable = "true";
          td.style.backgroundColor = "#fff8dc";
          td.style.cursor = "text";
          td.style.border = "1px solid #ccc";

          td.addEventListener("focus", function () {
            this.style.backgroundColor = "#fffacd";
          });
          td.addEventListener("blur", function () {
            this.style.backgroundColor = "#fff8dc";
          });
        }
      }
    });
  },

  /**
   *  CSV 解析
   * @param {string} text - CSV 文本内容
   * @returns {Array<Array<string>>}
   */
  parseCSV(text) {
    const lines = text.trim().split("\n");
    return lines.map((line) => {
      // 按逗号分割（不处理引号内的逗号）
      return line.split(",").map((cell) => cell.trim());
    });
  },

  /**
   * 保存表格数据到 CSV 文件
   * @param {string} tableId - 表格 ID
   * @param {string} fileName - 文件名
   * @param {number} rows - 行数
   * @param {number} cols - 列数
   */
  saveTableToCSV(tableId, fileName, rows, cols) {
    const table = document.getElementById(tableId);
    if (!table) return;

    let csvContent = "";

    for (let i = 0; i < rows && i < table.rows.length; i++) {
      const row = table.rows[i];
      const rowData = [];

      for (let j = 0; j < cols && j < row.cells.length; j++) {
        const cell = row.cells[j];
        const input = cell.querySelector("input, textarea");
        const value = input ? input.value : cell.textContent;
        rowData.push(value);
      }

      csvContent += rowData.join(",") + "\n";
    }

    // 下载文件
    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.click();

    console.log(`已保存 CSV: ${fileName}`);
  },

  /**
   * 设置单元格只读
   */
  setTableCellReadonly(tableId, row, col) {
    const table = document.getElementById(tableId);
    if (table && table.rows[row] && table.rows[row].cells[col]) {
      const cell = table.rows[row].cells[col];
      const input = cell.querySelector("input, textarea");
      if (input) {
        input.readOnly = true;
        input.style.backgroundColor = "#e0e0e0";
        input.style.cursor = "not-allowed";
      } else {
        cell.contentEditable = "false";
        cell.style.backgroundColor = "#e0e0e0";
      }
    }
  },

  /**
   * 表格居中对齐
   */
  centerAlignTable(tableId) {
    const table = document.getElementById(tableId);
    if (table) {
      Array.from(table.rows).forEach((row) => {
        Array.from(row.cells).forEach((cell) => {
          cell.style.textAlign = "center";
          cell.style.verticalAlign = "middle";
        });
      });
    }
  },

  /**
   * 设置表格列自适应拉伸
   */
  stretchTableColumns(tableId) {
    const table = document.getElementById(tableId);
    if (table) {
      table.style.width = "100%";
      table.style.tableLayout = "auto";
    }
  },

  /**
   * 在表格单元格中嵌入控件
   */
  setCellWidget(tableId, row, col, widgetId) {
    const table = document.getElementById(tableId);
    const widget = document.getElementById(widgetId);

    if (table && widget && table.rows[row] && table.rows[row].cells[col]) {
      const cell = table.rows[row].cells[col];
      cell.innerHTML = "";
      cell.appendChild(widget);
      widget.style.display = "inline-block";

      // 居中
      cell.style.textAlign = "center";
      cell.style.verticalAlign = "middle";
    }
  },
  /**
   * 设置表格单元格文本内容
   * @param {string} tableId - 表格 ID
   * @param {number} row - 行索引（从 0 开始）
   * @param {number} col - 列索引（从 0 开始）
   * @param {string} text - 要设置的文本
   */
  setTableCellText(tableId, row, col, text) {
    const table = document.getElementById(tableId);
    if (!table) {
      console.warn(`[WARN] 表格未找到: ${tableId}`);
      return;
    }

    const targetRow = table.rows[row];
    if (!targetRow) {
      console.warn(`[WARN] 行不存在: ${tableId} row ${row}`);
      return;
    }

    const cell = targetRow.cells[col];
    if (!cell) {
      console.warn(`[WARN] 单元格不存在: ${tableId} row ${row} col ${col}`);
      return;
    }

    // 如果单元格中有 input/textarea，更新其 value
    const input = cell.querySelector("input, textarea");
    if (input) {
      input.value = text;
    } else {
      // 否则直接设置单元格文本
      cell.textContent = text;
    }
  },
  /**
   * 获取表格单元格文本内容（新增方法）
   * @param {string} tableId - 表格 ID
   * @param {number} row - 行索引（从 0 开始）
   * @param {number} col - 列索引（从 0 开始）
   * @returns {string} - 单元格文本
   */
  getTableCellText(tableId, row, col) {
    const table = document.getElementById(tableId);
    if (!table) {
      console.warn(`[WARN] 表格未找到: ${tableId}`);
      return "";
    }

    const targetRow = table.rows[row];
    if (!targetRow) return "";

    const cell = targetRow.cells[col];
    if (!cell) return "";

    // 优先读取 input/textarea 的值，否则读取 textContent
    const input = cell.querySelector("input, textarea, select");
    return input ? input.value : cell.textContent;
  },
};

// 设置 LED 状态
export function setLEDStatus(elementId, isActive) {
  const element = document.getElementById(elementId);
  if (element) {
    element.style.width = "20px";
    element.style.height = "20px";
    element.style.borderRadius = "50%";
    element.style.display = "inline-block";
    element.style.backgroundColor = isActive ? "#00ff00" : "#ff0000";
    element.textContent = "";
  }
}

function initializeLEDIndicators() {
  setLEDStatus("label_led_HWCSZT", false);
  setLEDStatus("label_led_HWJH", false);
  setLEDStatus("label_led_HWGZ", false);
  setLEDStatus("label_led_HWJYGZ", false);
  setLEDStatus("label_led_HWDSMB", false);

  setLEDStatus("label_led_JGCSZT", false);
  setLEDStatus("label_led_JGJH", false);
  setLEDStatus("label_led_JGGZ", false);
  setLEDStatus("label_led_JGJYGZ", false);
  setLEDStatus("label_led_JGDSMB", false);

  setLEDStatus("label_led_WKZT", false);
  setLEDStatus("label_led_CGZT", false);
}

function initializeRadioGroups() {
  // 近界/远界
  const radioJJ = document.getElementById("radioButton_JJ");
  if (radioJJ) radioJJ.checked = true;

  // 无前发/有前发
  const radioWQF = document.getElementById("radioButton_WQF");
  if (radioWQF) radioWQF.checked = true;

  // 无干扰/有干扰
  const radioWGR = document.getElementById("radioButton_WGR");
  if (radioWGR) radioWGR.checked = true;

  // 航路
  const radioLHL = document.getElementById("radioButton_LHL");
  if (radioLHL) radioLHL.checked = true;

  // 迎攻/尾追/未知
  const radioUnKnown = document.getElementById("radioButton_UnKnown");
  if (radioUnKnown) radioUnKnown.checked = true;

  // 工作状态
  const initialStateRadio = document.getElementById(
    "radioButton_initial_state",
  );
  if (initialStateRadio) initialStateRadio.checked = true;

  // 激光工作状态
  const fsjsbkqRadio = document.getElementById("radioButton_FSJSBKQ");
  if (fsjsbkqRadio) fsjsbkqRadio.checked = true;
}

window.showTab = function (index) {
  document.querySelectorAll(".tab-content").forEach((tab) => {
    tab.classList.remove("active");
  });
  document.querySelectorAll(".tab-btn").forEach((btn) => {
    btn.classList.remove("active");
  });

  document.getElementById("tab-" + index).classList.add("active");
  const activeBtn = document.querySelector(`.tab-btn[data-tab="${index}"]`);
  if (activeBtn) activeBtn.classList.add("active");
  AppState.currentTab = index;
};

function initializeTables() {
  initializeInfraredTables();
  initializeLaserTables();
  initializeCommandTables();
  initializeChart();
}

document.addEventListener("DOMContentLoaded", async function () {
  initializeTables();
  initializeRadioGroups();
  initializeLEDIndicators();
  initializeUploadImage();
  initializeVideoStream();
    initializeBinarizedStream(); 
    initializeCodeUpload();
    initializeTelemeter();
    initializeDataRouter();
    initializeYC();
    initTurntableUI();
  showTab(2); // 默认显示

  statusBar.init();
  // 
  document.getElementById("pushButton_18")?.addEventListener("click", () => {
    statusBar.clear();
  });

  await PacketManager.init();
  console.log("[OK] PacketManager 初始化完成");

  // 将 wsClient 挂载到 全局
  window.wsClient = wsClient;

  wsClient.on("udp_ready", () => {
    alert("UDP 通道就绪！");
  });
  wsClient.connect();
});
