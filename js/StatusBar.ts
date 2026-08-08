/**
 * 状态栏消息管理
 */

class StatusBar {
  element: HTMLElement | null;
  elementId: string;
  maxMessages: number;

  constructor(elementId: string = "textBrowser_3") {
    this.element = null;
    this.elementId = elementId;

    this.maxMessages = 100;
  }

  /**
   * 初始化状态栏
   */
  init(): void {
    this.element = document.getElementById(this.elementId);
    if (!this.element) {
      console.warn(` 状态栏元素未找到: ${this.elementId}`);
      return;
    }
    this.element.style.overflowY = "auto";
  }

  /**
   * 添加消息
   */
  addMessage(message: string, color: string = "black"): void {
    if (!this.element) {
      console.warn("[WARN] 状态栏未初始化");
      return;
    }

    const timestamp = new Date().toLocaleTimeString("zh-CN", {
      hour12: false,
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

    const messageDiv = document.createElement("div");
    messageDiv.style.color = color;
    messageDiv.style.marginBottom = "2px";
    messageDiv.textContent = `[${timestamp}] ${message}`;

    this.element.appendChild(messageDiv);

    // 超出上限时，从顶部移除最旧的消息
    while (this.element.children.length > this.maxMessages) {
      this.element.removeChild(this.element.firstChild as Node);
    }

    this.element.scrollTop = this.element.scrollHeight;
  }

  /**
   * 发送消息（红色）
   * code 可选：调用方未传时显示 "undefined"（保持运行时原行为）
   */
  sendMessage(command: string, code?: string): void {
    this.addMessage(`发送 ${command} (${code})`, "red");
  }

  /**
   * 接收消息（蓝色）
   */
  receiveMessage(command: string, code?: string): void {
    this.addMessage(`接收 ${command} (${code})`, "blue");
  }

  /**
   * 成功消息（绿色）
   */
  successMessage(message: string): void {
    this.addMessage(`✓ ${message}`, "green");
  }

  /**
   * 错误消息（橙色）
   */
  errorMessage(message: string): void {
    this.addMessage(`✗ ${message}`, "orange");
  }

  /**
   * 清空状态栏
   */
  clear(): void {
    if (this.element) {
      this.element.innerHTML = "";
    }
  }
}

export default new StatusBar();
