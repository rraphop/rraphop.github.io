const QNA_API_URL = "https://script.google.com/macros/s/AKfycbzdAa37qCRj5_HPkX8Vkjr0su68PVUZfjx-K5cEN0ZWxZqRJSs4wWR-3Zi1XwKiCica/exec";

window.QNA_CONFIG = {
  apiUrl: QNA_API_URL,
  pageSize: 10,
  timeoutMs: 15000
};

(() => {
  const config = window.QNA_CONFIG;
  const jsonpActions = new Set([
    "list",
    "count",
    "visit",
    "acidRankings",
    "historyCauseRankings",
    "ping"
  ]);
  const pendingBridgeRequests = new Map();
  let bridgeFrame = null;
  let bridgeWindow = null;
  let bridgeOrigin = "";
  let bridgeChannel = "";
  let bridgeReadyPromise = null;

  function isConfigured() {
    try {
      const url = new URL(config.apiUrl);
      return url.protocol === "https:" && url.pathname.endsWith("/exec");
    } catch {
      return false;
    }
  }

  function createRequestId(prefix) {
    const randomPart = window.crypto?.getRandomValues
      ? Array.from(window.crypto.getRandomValues(new Uint32Array(2)), (value) => value.toString(36)).join("")
      : Math.random().toString(36).slice(2);
    return `${prefix}_${Date.now()}_${randomPart}`;
  }

  function requestByJsonp(action, params = {}, options = {}) {
    return new Promise((resolve, reject) => {
      const callbackPrefix = options.callbackPrefix || "__dataCallback";
      const callbackName = createRequestId(callbackPrefix);
      const script = document.createElement("script");
      const timeoutId = window.setTimeout(() => {
        cleanup();
        reject(new Error(options.timeoutMessage || "응답 시간이 초과되었습니다."));
      }, Number(config.timeoutMs) || 15000);

      function cleanup() {
        window.clearTimeout(timeoutId);
        delete window[callbackName];
        script.remove();
      }

      window[callbackName] = (payload) => {
        cleanup();
        if (payload?.ok) {
          resolve(payload);
        } else {
          reject(new Error(payload?.message || options.defaultErrorMessage || "데이터 요청을 처리하지 못했습니다."));
        }
      };

      const url = new URL(config.apiUrl);
      url.searchParams.set("callback", callbackName);
      url.searchParams.set("action", action);
      Object.entries(params).forEach(([key, value]) => {
        url.searchParams.set(key, value == null ? "" : String(value));
      });

      script.async = true;
      script.onerror = () => {
        cleanup();
        reject(new Error(options.connectionErrorMessage || "데이터에 연결하지 못했습니다."));
      };
      script.src = url.toString();
      document.head.appendChild(script);
    });
  }

  function handleBridgeMessage(event) {
    const message = event.data;
    if (!bridgeFrame || !message || message.channel !== bridgeChannel) return;
    if (!isTrustedBridgeOrigin(event.origin)) return;

    if (message.type === "social-history-data-bridge-ready") {
      bridgeWindow = event.source;
      bridgeOrigin = event.origin === "null" ? "*" : event.origin;
      return;
    }

    if (message.type !== "social-history-data-bridge-response") return;
    if (!bridgeWindow || event.source !== bridgeWindow) return;
    const pending = pendingBridgeRequests.get(message.id);
    if (!pending) return;
    pendingBridgeRequests.delete(message.id);
    window.clearTimeout(pending.timeoutId);

    if (message.payload?.ok) {
      pending.resolve(message.payload);
    } else {
      pending.reject(new Error(message.payload?.message || pending.defaultErrorMessage));
    }
  }

  window.addEventListener("message", handleBridgeMessage);

  function isTrustedBridgeOrigin(origin) {
    return origin === "https://script.google.com"
      || /^https:\/\/[a-z0-9-]+-script\.googleusercontent\.com$/i.test(origin);
  }

  function ensureBridge(options = {}) {
    if (bridgeReadyPromise) return bridgeReadyPromise;

    bridgeReadyPromise = new Promise((resolve, reject) => {
      bridgeChannel = createRequestId("bridge");
      bridgeFrame = document.createElement("iframe");
      bridgeFrame.tabIndex = -1;
      bridgeFrame.title = "";
      bridgeFrame.setAttribute("aria-hidden", "true");
      Object.assign(bridgeFrame.style, {
        position: "fixed",
        width: "1px",
        height: "1px",
        left: "-10000px",
        border: "0",
        opacity: "0",
        pointerEvents: "none"
      });

      const timeoutId = window.setTimeout(() => {
        window.removeEventListener("message", waitForBridgeReady);
        reject(new Error(options.connectionErrorMessage || "안전한 데이터 연결을 준비하지 못했습니다."));
        bridgeReadyPromise = null;
        bridgeFrame?.remove();
        bridgeFrame = null;
        bridgeWindow = null;
        bridgeOrigin = "";
      }, Number(config.timeoutMs) || 15000);

      function waitForBridgeReady(event) {
        if (!bridgeFrame || !isTrustedBridgeOrigin(event.origin)) return;
        if (event.data?.type !== "social-history-data-bridge-ready") return;
        if (event.data.channel !== bridgeChannel) return;
        window.removeEventListener("message", waitForBridgeReady);
        window.clearTimeout(timeoutId);
        bridgeWindow = event.source;
        bridgeOrigin = event.origin === "null" ? "*" : event.origin;
        resolve();
      }

      window.addEventListener("message", waitForBridgeReady);
      const url = new URL(config.apiUrl);
      url.searchParams.set("action", "bridge");
      url.searchParams.set("channel", bridgeChannel);
      bridgeFrame.src = url.toString();
      document.body.appendChild(bridgeFrame);
    });

    return bridgeReadyPromise;
  }

  async function requestByBridge(action, params = {}, options = {}) {
    await ensureBridge(options);
    const id = createRequestId("bridgeRequest");

    return new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingBridgeRequests.delete(id);
        reject(new Error(options.timeoutMessage || "응답 시간이 초과되었습니다."));
      }, Number(config.timeoutMs) || 15000);

      pendingBridgeRequests.set(id, {
        resolve,
        reject,
        timeoutId,
        defaultErrorMessage: options.defaultErrorMessage || "데이터 요청을 처리하지 못했습니다."
      });

      bridgeWindow.postMessage({
        type: "social-history-data-bridge-request",
        channel: bridgeChannel,
        id,
        action,
        params
      }, bridgeOrigin || "*");
    });
  }

  function request(action, params = {}, options = {}) {
    if (!isConfigured()) {
      return Promise.reject(new Error(options.notConfiguredMessage || "데이터 연결 주소를 설정하세요."));
    }
    return jsonpActions.has(action)
      ? requestByJsonp(action, params, options)
      : requestByBridge(action, params, options);
  }

  window.DATA_API = Object.freeze({
    isConfigured,
    request
  });
})();
