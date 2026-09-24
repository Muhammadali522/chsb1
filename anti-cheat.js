(() => {
  "use strict";

  const DEFAULTS = {
    eventEndpoint: null,
    heartbeatEndpoint: null,
    heartbeatMs: 3000,
    blockOnBlur: true,
    blockOnHidden: true,
    blockOnFullscreenExit: true,
    blockOnCopy: true,
    blockOnPaste: true,
    blockOnCut: true,
    blockOnContextMenu: true,
    blockOnSelection: true,
    blockOnPrint: true,
    blockOnDrag: true,
    blockOnBeforeUnload: false
  };

  const cfg = Object.assign({}, DEFAULTS, window.EXAM_ANTICHEAT_CONFIG || {});
  let active = false, heartbeat = null, startedAt = 0, seq = 0;
  let lastEvent = null;
  const listeners = [];

  const state = () => ({
    visibility: document.visibilityState,
    hidden: document.hidden,
    focused: document.hasFocus(),
    fullscreen: !!document.fullscreenElement,
    online: navigator.onLine,
    href: location.href,
    q: typeof current !== "undefined" ? current + 1 : null
  });

  function add(target, type, fn, options) {
    target.addEventListener(type, fn, options);
    listeners.push(() => target.removeEventListener(type, fn, options));
  }

  async function emit(type, details = {}, severity = "INFO") {
    if (!active) return;
    const event = {
      id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + "-" + Math.random(),
      seq: ++seq,
      type, severity,
      timestamp: new Date().toISOString(),
      elapsedMs: performance.now() - startedAt,
      state: state(),
      details
    };
    lastEvent = event;

    try {
      const raw = JSON.stringify(event);
      const old = sessionStorage.getItem("exam_ac_events") || "";
      sessionStorage.setItem("exam_ac_events", old ? old + "\n" + raw : raw);
    } catch (_) {}

    if (cfg.eventEndpoint) {
      try {
        navigator.sendBeacon?.(
          cfg.eventEndpoint,
          new Blob([JSON.stringify(event)], {type: "application/json"})
        );
      } catch (_) {}
    }

    if (window.sendAntiCheatEvent) {
      try { await window.sendAntiCheatEvent(event); } catch (_) {}
    }
  }

  function violation(type, details) {
    emit(type, details, "VIOLATION");
    if (typeof window.__examAntiCheatBlock === "function") {
      window.__examAntiCheatBlock(type);
    }
  }

  function start() {
    if (active) return;
    active = true;
    startedAt = performance.now();
    seq = 0;

    emit("EXAM_STARTED", {}, "INFO");

    add(window, "blur", () => {
      emit("WINDOW_BLUR");
      if (cfg.blockOnBlur) violation("FOCUS_LOST");
    });

    add(window, "focus", () => emit("WINDOW_FOCUS"));

    add(document, "visibilitychange", () => {
      emit(document.hidden ? "PAGE_HIDDEN" : "PAGE_VISIBLE");
      if (document.hidden && cfg.blockOnHidden) violation("VISIBILITY_HIDDEN");
    });

    add(document, "fullscreenchange", () => {
      emit(document.fullscreenElement ? "FULLSCREEN_ENTER" : "FULLSCREEN_EXIT");
      if (!document.fullscreenElement && cfg.blockOnFullscreenExit) {
        violation("FULLSCREEN_EXIT");
      }
    });

    add(document, "fullscreenerror", () => violation("FULLSCREEN_ERROR"));

    add(window, "pagehide", e => emit("PAGE_HIDE", {persisted: !!e.persisted}));
    add(window, "pageshow", e => emit("PAGE_SHOW", {persisted: !!e.persisted}));

    add(window, "offline", () => emit("NETWORK_OFFLINE", {}, "VIOLATION"));
    add(window, "online", () => emit("NETWORK_ONLINE"));

    add(document, "copy", e => {
      emit("COPY_ATTEMPT");
      if (cfg.blockOnCopy) { e.preventDefault(); violation("CLIPBOARD_COPY"); }
    }, true);

    add(document, "cut", e => {
      emit("CUT_ATTEMPT");
      if (cfg.blockOnCut) { e.preventDefault(); violation("CLIPBOARD_CUT"); }
    }, true);

    add(document, "paste", e => {
      emit("PASTE_ATTEMPT");
      if (cfg.blockOnPaste) { e.preventDefault(); violation("CLIPBOARD_PASTE"); }
    }, true);

    add(document, "contextmenu", e => {
      emit("CONTEXT_MENU_ATTEMPT");
      if (cfg.blockOnContextMenu) { e.preventDefault(); violation("CONTEXT_MENU"); }
    }, true);

    add(document, "selectstart", e => {
      emit("TEXT_SELECTION_ATTEMPT");
      if (cfg.blockOnSelection) { e.preventDefault(); violation("TEXT_SELECTION"); }
    }, true);

    add(document, "dragstart", e => {
      emit("DRAG_ATTEMPT");
      if (cfg.blockOnDrag) { e.preventDefault(); violation("DRAG_ATTEMPT"); }
    }, true);

    add(window, "beforeprint", () => {
      emit("PRINT_ATTEMPT");
      if (cfg.blockOnPrint) violation("PRINT_ATTEMPT");
    });

    add(window, "afterprint", () => emit("PRINT_END"));

    add(window, "keydown", e => {
      const key = e.key;
      const combo = [
        e.ctrlKey ? "Ctrl" : "",
        e.metaKey ? "Meta" : "",
        e.altKey ? "Alt" : "",
        e.shiftKey ? "Shift" : "",
        key
      ].filter(Boolean).join("+");

      if (["PrintScreen", "F12", "F11"].includes(key) ||
          (e.ctrlKey && ["p","c","v","x","s","u"].includes(key.toLowerCase())) ||
          (e.ctrlKey && e.shiftKey && ["i","j","c"].includes(key.toLowerCase()))) {
        emit("SUSPICIOUS_KEY", {combo});
      }

      if (e.ctrlKey && ["c","v","x"].includes(key.toLowerCase())) {
        e.preventDefault();
      }
    }, true);

    add(window, "popstate", () => violation("HISTORY_NAVIGATION"));
    add(window, "hashchange", () => emit("HASH_CHANGE"));

    heartbeat = setInterval(() => {
      const hb = {
        type: "HEARTBEAT",
        timestamp: new Date().toISOString(),
        seq,
        state: state()
      };
      if (cfg.heartbeatEndpoint) {
        fetch(cfg.heartbeatEndpoint, {
          method: "POST",
          headers: {"Content-Type": "application/json"},
          body: JSON.stringify(hb),
          credentials: "include",
          keepalive: true
        }).catch(() => emit("HEARTBEAT_SEND_FAILED", {}, "VIOLATION"));
      }
      emit("HEARTBEAT");
    }, cfg.heartbeatMs);
  }

  function stop() {
    active = false;
    if (heartbeat) clearInterval(heartbeat);
    heartbeat = null;
    while (listeners.length) listeners.pop()();
    emit("EXAM_STOPPED");
  }

  window.ExamAntiCheat = {start, stop, emit, state, get active() { return active; }};
})();