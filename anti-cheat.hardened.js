/*
 * anti-cheat.hardened.js - усиленная версия для ВАШЕГО экзаменационного сайта.
 *
 * Подключать первым скриптом в <head>, синхронно (без defer/async):
 *   <script src="anti-cheat.hardened.js"></script>
 *
 * Использование:
 *   ExamAntiCheat.configure({
 *     eventEndpoint: "/api/ac/event",        // сервер ОБЯЗАТЕЛЕН, иначе защита только клиентская
 *     heartbeatEndpoint: "/api/ac/heartbeat",
 *     sessionId: "<id выданный сервером>",
 *     onBlock: (reason) => { ... остановить тест ... }
 *   });
 *   ExamAntiCheat.start();  // при старте теста
 *   ExamAntiCheat.stop();   // при завершении
 *
 * Сервер должен: считать пропуски seq у heartbeat, смотреть на ровность интервалов,
 * копить события VIOLATION и сам принимать решение о недействительности попытки.
 */
(() => {
  "use strict";

  // ---- 1. Сохраняем нативные ссылки ДО того, как их успеет подменить чужой код ----
  const N = {
    addEventListener: EventTarget.prototype.addEventListener,
    stopImmediatePropagation: Event.prototype.stopImmediatePropagation,
    fnToString: Function.prototype.toString,
    getDesc: Object.getOwnPropertyDescriptor,
    hasFocus: Document.prototype.hasFocus,
    raf: window.requestAnimationFrame.bind(window),
    setInterval: window.setInterval.bind(window),
    fetch: window.fetch ? window.fetch.bind(window) : null,
    beacon: navigator.sendBeacon ? navigator.sendBeacon.bind(navigator) : null,
    now: performance.now.bind(performance),
    json: JSON.stringify.bind(JSON),
    docEl: () => document.documentElement
  };
  const visGetter = N.getDesc(Document.prototype, "visibilityState")?.get;
  const hiddenGetter = N.getDesc(Document.prototype, "hidden")?.get;
  const fsGetter = N.getDesc(Document.prototype, "fullscreenElement")?.get;
  const call = (g) => (g ? g.call(document) : undefined);

  const isNative = (fn) => {
    try { return typeof fn === "function" && /\{\s*\[native code\]\s*\}\s*$/.test(N.fnToString.call(fn)); }
    catch (_) { return false; }
  };

  // ---- 2. Состояние в замыкании, наружу ничего изменяемого ----
  const cfg = {
    eventEndpoint: null, heartbeatEndpoint: null, sessionId: null,
    heartbeatMs: 500, rafGapMs: 1500, onBlock: null
  };
  let active = false, seq = 0, started = 0, blocked = false;
  let lastRaf = N.now();
  let baselineAttrs = null;
  const pendingFlags = [];

  const readState = () => ({
    visibility: call(visGetter),
    hidden: call(hiddenGetter),
    focused: N.hasFocus.call(document),
    fullscreen: !!call(fsGetter),
    online: navigator.onLine
  });

  function send(url, payload) {
    if (!url) return;
    const body = N.json(payload);
    try {
      if (N.beacon && N.beacon(url, new Blob([body], { type: "application/json" }))) return;
    } catch (_) {}
    if (N.fetch) N.fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true, credentials: "include" }).catch(() => {});
  }

  function emit(type, details, severity) {
    if (!active) return;
    send(cfg.eventEndpoint, {
      session: cfg.sessionId, seq: ++seq, type, severity: severity || "INFO",
      t: Date.now(), elapsedMs: Math.round(N.now() - started), state: readState(), details: details || {}
    });
  }

  function violation(type, details) {
    emit(type, details, "VIOLATION");
    if (blocked) return;
    blocked = true;
    const cb = cfg.onBlock;
    if (typeof cb === "function") { try { cb(type); } catch (_) {} }
  }

  // ---- 3. Слушатели: capture, регистрируются при ЗАГРУЗКЕ скрипта, а не при старте ----
  // Работают всегда, но реагируют только при active. Так чужой код, запущенный позже,
  // уже не окажется перед ними в очереди обработчиков.
  const on = (target, type, fn) => N.addEventListener.call(target, type, fn, true);

  on(window, "blur", (e) => { if (active) violation("FOCUS_LOST", { trusted: e.isTrusted }); });
  on(document, "visibilitychange", () => { if (active && call(hiddenGetter)) violation("VISIBILITY_HIDDEN"); });
  on(document, "fullscreenchange", () => { if (active && !call(fsGetter)) violation("FULLSCREEN_EXIT"); });
  on(window, "offline", () => { if (active) emit("NETWORK_OFFLINE", {}, "VIOLATION"); });
  ["copy", "cut", "paste", "contextmenu", "dragstart"].forEach((t) =>
    on(document, t, (e) => { if (active) { e.preventDefault(); violation("BLOCKED_" + t.toUpperCase()); } }));
  on(window, "beforeprint", () => { if (active) violation("PRINT_ATTEMPT"); });
  on(window, "keydown", (e) => {
    if (!active) return;
    const k = (e.key || "").toLowerCase();
    if (["f12", "printscreen"].includes(k) || (e.ctrlKey && ["p", "s", "u"].includes(k)) ||
        (e.ctrlKey && e.shiftKey && ["i", "j", "c"].includes(k))) emit("SUSPICIOUS_KEY", { k });
    if (e.ctrlKey && ["c", "v", "x"].includes(k)) e.preventDefault();
    if (e.isTrusted === false) emit("SYNTHETIC_KEY_EVENT", { k }, "VIOLATION");
  });

  // ---- 4. Независимый сигнал "вкладка не видна": rAF не вызывается в скрытой вкладке ----
  // visibilityState можно подделать, а остановку анимационных кадров подделать сложнее.
  (function rafLoop() {
    const t = N.now();
    if (active && t - lastRaf > cfg.rafGapMs) emit("RAF_GAP", { gapMs: Math.round(t - lastRaf) }, "VIOLATION");
    lastRaf = t;
    N.raf(rafLoop);
  })();

  // ---- 5. Проверка целостности нативных API ----
  function integrityCheck() {
    const bad = [];
    if (!isNative(EventTarget.prototype.addEventListener)) bad.push("addEventListener");
    if (!isNative(Event.prototype.stopImmediatePropagation)) bad.push("stopImmediatePropagation");
    if (!isNative(Document.prototype.hasFocus)) bad.push("hasFocus");
    if (!isNative(visGetter) || !isNative(hiddenGetter)) bad.push("visibility getters");
    // свойства не должны быть переопределены на самом объекте document
    for (const p of ["visibilityState", "hidden", "fullscreenElement", "hasFocus"]) {
      if (Object.prototype.hasOwnProperty.call(document, p)) bad.push("own:" + p);
    }
    // текущие дескрипторы должны совпадать с сохранёнными при загрузке
    if (N.getDesc(Document.prototype, "visibilityState")?.get !== visGetter) bad.push("visibilityState replaced");
    if (N.getDesc(Document.prototype, "hidden")?.get !== hiddenGetter) bad.push("hidden replaced");
    if (EventTarget.prototype.addEventListener !== N.addEventListener) bad.push("addEventListener replaced");
    if (Event.prototype.stopImmediatePropagation !== N.stopImmediatePropagation) bad.push("stopImmediatePropagation replaced");
    if (bad.length) violation("TAMPERING_DETECTED", { bad });
  }

  // ---- 6. Чужие изменения DOM: новые атрибуты на <html>, неизвестные скрипты/iframe ----
  function startDomWatch() {
    const el = N.docEl();
    baselineAttrs = new Set(Array.from(el.attributes, (a) => a.name));
    new MutationObserver((list) => {
      if (!active) return;
      for (const m of list) {
        if (m.type === "attributes" && m.target === el && !baselineAttrs.has(m.attributeName)) {
          emit("FOREIGN_HTML_ATTRIBUTE", { name: m.attributeName }, "VIOLATION");
        }
        if (m.type === "childList") {
          m.addedNodes.forEach((n) => {
            if (n.nodeType === 1 && (n.tagName === "SCRIPT" || n.tagName === "IFRAME") && !n.hasAttribute("data-exam-ok")) {
              emit("FOREIGN_NODE", { tag: n.tagName, src: n.src || null }, "VIOLATION");
            }
          });
        }
      }
    }).observe(el, { attributes: true, childList: true, subtree: true });
  }

  // ---- 7. Heartbeat на сервер: seq + время, пропуски и ровность смотрит сервер ----
  let hbSeq = 0, hbStarted = false;
  function startHeartbeat() {
    N.setInterval(() => {
      if (!active) return;
      integrityCheck();
      send(cfg.heartbeatEndpoint, { session: cfg.sessionId, hb: ++hbSeq, t: Date.now(), perf: Math.round(N.now()), state: readState() });
    }, cfg.heartbeatMs);
  }

  const api = {
    configure(o) { Object.assign(cfg, o || {}); },
    start() {
      if (active) return;
      active = true; blocked = false; started = N.now(); seq = 0; lastRaf = N.now();
      if (!baselineAttrs) startDomWatch();
      if (!hbStarted) { hbStarted = true; startHeartbeat(); }
      integrityCheck();
      if (!active || blocked) return;
      emit("EXAM_STARTED");
    },
    stop() { emit("EXAM_STOPPED"); active = false; },
    get active() { return active; }
  };
  Object.defineProperty(window, "ExamAntiCheat", { value: Object.freeze(api), writable: false, configurable: false });
})();
