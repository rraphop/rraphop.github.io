const QNA_API_URL = "https://script.google.com/macros/s/AKfycbz0Ip3aJaAailKcmDU4QsOoHOAkCB1v4JCT3zLn3ITeVB0Nl5j0T0aiuV5wbIXfF1Tf/exec";

window.QNA_CONFIG = {
  apiUrl: QNA_API_URL,
  pageSize: 10,
  timeoutMs: 20000,
  writeTimeoutMs: 45000,
  retryDelayMs: 600
};

(() => {
  const config = window.QNA_CONFIG;
  const jsonpActions = new Set([
    "list",
    "programList",
    "programDetail",
    "programTrack",
    "count",
    "visit",
    "acidRankings",
    "historyCauseRankings",
    "ping"
  ]);
  const pendingBridgeRequests = new Map();
  const readActions = new Set(['list', 'programList', 'programDetail', 'count', 'acidRankings', 'historyCauseRankings', 'ping']);
  const mutationActions = new Set(['create', 'update', 'answer', 'delete', 'programSave', 'programDelete', 'programCommentSave', 'programCommentDelete', 'acidRankingCreate', 'historyCauseRankingCreate', 'visit']);
  const inFlightReads = new Map();
  const readCache = new Map();
  let cacheEpoch = 0;
  const storagePrefix = `mysh:data:v3:${config.apiUrl}:`;
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
        cleanup(true);
        reject(Object.assign(new Error(options.timeoutMessage || "연결이 지연되고 있습니다. 잠시 후 다시 불러와 주세요."), { retryable: true }));
      }, Number(options.timeoutMs || config.timeoutMs) || 20000);

      function cleanup(lateResponse = false) {
        window.clearTimeout(timeoutId);
        if (lateResponse) {
          // 제거된 script 요청의 늦은 응답이 실행돼도 ReferenceError가 나지 않게 합니다.
          window[callbackName] = () => {};
          window.setTimeout(() => { delete window[callbackName]; }, 60000);
        } else delete window[callbackName];
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
        cleanup(true);
        reject(Object.assign(new Error(options.connectionErrorMessage || "데이터에 연결하지 못했습니다."), { retryable: true }));
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
      }, Number(config.writeTimeoutMs) || 45000);

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
        reject(new Error(mutationActions.has(action)
          ? '저장 결과 확인이 지연되고 있습니다. 다시 저장하기 전에 목록을 새로고침해 반영 여부를 확인해 주세요.'
          : (options.timeoutMessage || '연결이 지연되고 있습니다. 잠시 후 다시 시도해 주세요.')));
      }, Number(config.writeTimeoutMs) || 45000);

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

  function clearReadCache() {
    cacheEpoch += 1;
    readCache.clear();
    inFlightReads.clear();
    try {
      for (let i = window.sessionStorage.length - 1; i >= 0; i--) {
        const key = window.sessionStorage.key(i);
        if (key?.startsWith(storagePrefix)) window.sessionStorage.removeItem(key);
      }
    } catch { /* 저장소 제한 환경에서도 네트워크 요청은 동작합니다. */ }
  }

  function cachedRead(key) {
    try {
      const entry = readCache.get(key) || JSON.parse(window.sessionStorage.getItem(storagePrefix + key) || 'null');
      if (entry && entry.expiresAt > Date.now()) return JSON.parse(entry.json);
    } catch { /* 캐시가 없으면 서버에서 읽습니다. */ }
    return null;
  }

  async function runRead(action, params, options, key, epoch) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const payload = await requestByJsonp(action, params, options);
        const ttl = action === 'count' ? 5000 : 10000;
        const json = JSON.stringify(payload);
        if (epoch === cacheEpoch && json.length <= 100000 && action !== 'ping') {
          const entry = { json, expiresAt: Date.now() + ttl };
          readCache.set(key, entry);
          try { window.sessionStorage.setItem(storagePrefix + key, JSON.stringify(entry)); } catch { /* 메모리 캐시 사용 */ }
        }
        return payload;
      } catch (error) {
        if (!error.retryable || attempt === 1) throw error;
        await new Promise((resolve) => window.setTimeout(resolve, Number(config.retryDelayMs) || 600));
      }
    }
  }

  function request(action, params = {}, options = {}) {
    if (!isConfigured()) {
      return Promise.reject(new Error(options.notConfiguredMessage || "데이터 연결 주소를 설정하세요."));
    }
    if (readActions.has(action)) {
      const key = JSON.stringify([action, Object.entries(params).sort(([a], [b]) => a.localeCompare(b))]);
      if (!options.forceRefresh) {
        const cached = cachedRead(key);
        if (cached) return Promise.resolve(cached);
        if (inFlightReads.has(key)) return inFlightReads.get(key);
      }
      const task = runRead(action, params, options, key, cacheEpoch).finally(() => {
        if (inFlightReads.get(key) === task) inFlightReads.delete(key);
      });
      inFlightReads.set(key, task);
      return task;
    }
    const mutation = mutationActions.has(action);
    if (mutation) clearReadCache();
    const task = jsonpActions.has(action)
      ? requestByJsonp(action, params, options)
      : requestByBridge(action, params, options);
    // 쓰기 요청은 타임아웃이어도 자동 재전송하지 않습니다(중복 글/방문 집계 방지).
    return mutation ? task.finally(clearReadCache) : task;
  }

  document.addEventListener('focusin', (event) => {
    if (event.target.closest?.('#qnaForm, #programForm, #programCommentForm, #programDeleteForm, #questionDetail form')) {
      if (isConfigured()) ensureBridge().catch(() => {});
    }
  });

  window.DATA_API = Object.freeze({
    isConfigured,
    request
  });
})();
