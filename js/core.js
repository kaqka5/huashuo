/* ============================================================
 * 画说 · core.js
 * 基础工具 / 全局状态 / 撤回栈 / 本地存储 / Toast / 弹窗
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});

  EM.VERSION = '1.0';
  EM.BUILD = '2026-11-06';

  /* ------------------------------------------------------------
   * 1. 小工具
   * ---------------------------------------------------------- */
  var U = (EM.util = {
    uid: function (prefix) {
      return (prefix || 'id') + '_' + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-3);
    },
    clamp: function (v, a, b) { return v < a ? a : v > b ? b : v; },
    esc: function (s) {
      return String(s == null ? '' : s)
        .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    },
    debounce: function (fn, ms) {
      var t = 0;
      return function () {
        var args = arguments, self = this;
        clearTimeout(t);
        t = setTimeout(function () { fn.apply(self, args); }, ms);
      };
    },
    throttle: function (fn, ms) {
      var last = 0, timer = 0;
      return function () {
        var now = Date.now(), self = this, args = arguments;
        var wait = ms - (now - last);
        if (wait <= 0) { clearTimeout(timer); last = now; fn.apply(self, args); }
        else if (!timer) { timer = setTimeout(function () { timer = 0; last = Date.now(); fn.apply(self, args); }, wait); }
      };
    },
    el: function (tag, cls, html) {
      var n = document.createElement(tag);
      if (cls) n.className = cls;
      if (html != null) n.innerHTML = html;
      return n;
    },
    s: function (v) { return v == null ? '' : String(v); },
    truncate: function (s, n) {
      s = String(s == null ? '' : s).replace(/\s+/g, ' ').trim();
      return s.length > n ? s.slice(0, n - 1) + '…' : s;
    },
    // 一份浅拷贝（用于历史快照）
    clone: function (o) { return JSON.parse(JSON.stringify(o)); },
    round: function (v, p) { var m = Math.pow(10, p || 0); return Math.round(v * m) / m; },
    escapeRe: function (s) { return String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }
  });

  /* ------------------------------------------------------------
   * 2. 事件总线
   * ---------------------------------------------------------- */
  var handlers = {};
  EM.bus = {
    on: function (name, fn) {
      (handlers[name] = handlers[name] || []).push(fn);
      return fn;
    },
    off: function (name, fn) {
      var arr = handlers[name];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    emit: function (name, payload) {
      var arr = handlers[name];
      if (!arr) return;
      for (var i = 0; i < arr.length; i++) {
        try { arr[i](payload); } catch (e) { console.error('[bus]', name, e); }
      }
    }
  };

  /* ------------------------------------------------------------
   * 3. 状态
   * ---------------------------------------------------------- */
  var DEFAULT_VIEW = { x: 0, y: 0, k: 1 };
  var DEFAULT_CANVAS = { w: 1180, h: 900 };

  EM.state = {
    version: 1,
    seq: 0,              // 回答板块的编号
    qaSeq: 0,            // 追问板块的编号
    imgSeq: 0,           // 图片板块的编号
    plotSeq: 0,          // 函数板块的编号
    boxes: [],           // 卡片
    strokes: [],         // 划线 / 画圈
    frames: [],          // 框选提问留下的选区框
    links: [],           // 选区 → 提问卡 的连接线
    view: Object.assign({}, DEFAULT_VIEW),
    canvas: Object.assign({}, DEFAULT_CANVAS),
    meta: { topic: '', requirement: '', mode: 'auto' },
    theme: 'light',
    started: false
  };

  var DATA_KEYS = ['seq', 'qaSeq', 'imgSeq', 'plotSeq', 'boxes', 'strokes', 'frames', 'links', 'canvas', 'meta', 'started'];

  EM.state.snapshot = function () {
    var o = { version: EM.state.version };
    DATA_KEYS.forEach(function (k) { o[k] = U.clone(EM.state[k]); });
    return o;
  };

  EM.state.restore = function (snap) {
    if (!snap) return;
    DATA_KEYS.forEach(function (k) {
      if (snap[k] !== undefined) EM.state[k] = U.clone(snap[k]);
    });
    EM.bus.emit('state:restored');
    EM.renderAll();
  };

  /* 便捷查询 */
  EM.state.box = function (id) {
    for (var i = 0; i < EM.state.boxes.length; i++) if (EM.state.boxes[i].id === id) return EM.state.boxes[i];
    return null;
  };
  EM.state.frame = function (id) {
    for (var i = 0; i < EM.state.frames.length; i++) if (EM.state.frames[i].id === id) return EM.state.frames[i];
    return null;
  };

  /* ------------------------------------------------------------
   * 4. 撤回 / 重做
   * ---------------------------------------------------------- */
  var undoStack = [], redoStack = [], MAX_HISTORY = 60;

  EM.history = {
    /** 在改动之前调用，把当前状态压栈 */
    push: function (label) {
      undoStack.push({ snap: EM.state.snapshot(), label: label || '' });
      if (undoStack.length > MAX_HISTORY) undoStack.shift();
      redoStack.length = 0;
      EM.history.refresh();
      EM.persist.schedule();
    },
    canUndo: function () { return undoStack.length > 0; },
    canRedo: function () { return redoStack.length > 0; },
    undo: function () {
      if (!undoStack.length) return false;
      var cur = EM.state.snapshot();
      var item = undoStack.pop();
      redoStack.push({ snap: cur, label: item.label });
      EM.state.restore(item.snap);
      EM.history.refresh();
      EM.persist.schedule();
      EM.bus.emit('history:undo', item.label);
      return true;
    },
    redo: function () {
      if (!redoStack.length) return false;
      var cur = EM.state.snapshot();
      var item = redoStack.pop();
      undoStack.push({ snap: cur, label: item.label });
      EM.state.restore(item.snap);
      EM.history.refresh();
      EM.persist.schedule();
      return true;
    },
    clear: function () { undoStack.length = 0; redoStack.length = 0; EM.history.refresh(); },
    refresh: function () {
      var btn = document.getElementById('btnUndo');
      if (btn) btn.disabled = !undoStack.length;
      var redo = document.getElementById('btnRedo');
      if (redo) redo.disabled = !redoStack.length;
      EM.bus.emit('history:change');
    },
    label: function () {
      var it = undoStack[undoStack.length - 1];
      return it ? it.label : '';
    }
  };

  /* ------------------------------------------------------------
   * 5. 本地存储
   * ---------------------------------------------------------- */
  var PROJECT_KEY = 'huashuo.project.v1';

  EM.persist = {
    save: function () {
      try {
        var data = EM.state.snapshot();
        data.view = EM.state.view;
        data.theme = EM.state.theme;
        data.savedAt = Date.now();
        localStorage.setItem(PROJECT_KEY, JSON.stringify(data));
      } catch (e) {
        /* 配额满或隐私模式，静默失败 */
      }
    },
    load: function () {
      try {
        var raw = localStorage.getItem(PROJECT_KEY);
        if (!raw) return null;
        var data = JSON.parse(raw);
        if (!data || typeof data !== 'object') return null;
        return data;
      } catch (e) { return null; }
    },
    clear: function () {
      try { localStorage.removeItem(PROJECT_KEY); } catch (e) { }
    }
  };
  EM.persist.schedule = U.debounce(EM.persist.save, 450);

  /* ------------------------------------------------------------
   * 6. Toast
   * ---------------------------------------------------------- */
  var toastLayer = null;

  EM.toast = function (msg, opts) {
    opts = opts || {};
    if (!toastLayer) toastLayer = document.getElementById('toasts');
    if (!toastLayer) return;

    // 最多同时叠 3 条，超出就立刻清掉最老的（不等淡出动画，免得堆一屏）
    var live = toastLayer.querySelectorAll('.toast');
    while (live.length >= 3) {
      var old = live[0];
      if (old.parentNode) old.parentNode.removeChild(old);
      live = toastLayer.querySelectorAll('.toast');
    }

    var n = U.el('div', 'toast');
    n.innerHTML = '<span>' + U.esc(msg) + '</span>';

    if (opts.action) {
      var b = U.el('button', 't-act', U.esc(opts.action.label || '撤销'));
      b.addEventListener('click', function () {
        opts.action.fn();
        remove();
      });
      n.appendChild(b);
    }

    toastLayer.appendChild(n);
    var timer = setTimeout(remove, opts.timeout || (opts.action ? 6200 : 2600));

    function remove() {
      clearTimeout(timer);
      if (!n.parentNode) return;
      n.classList.add('out');
      setTimeout(function () { if (n.parentNode) n.parentNode.removeChild(n); }, 280);
    }
    return remove;
  };

  /* ------------------------------------------------------------
   * 7. 弹窗
   * ---------------------------------------------------------- */
  var modalMask = null, modalEl = null, lastFocus = null;

  EM.modal = {
    open: function (html, onMount) {
      modalMask = modalMask || document.getElementById('modalMask');
      modalEl = modalEl || document.getElementById('modal');
      lastFocus = document.activeElement;
      modalEl.innerHTML = html;
      modalMask.hidden = false;
      if (onMount) onMount(modalEl);
      var first = modalEl.querySelector('[data-autofocus]');
      if (first) setTimeout(function () { first.focus(); }, 40);
      return modalEl;
    },
    close: function () {
      if (!modalMask) return;
      modalMask.hidden = true;
      if (modalEl) modalEl.innerHTML = '';
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) { } }
      EM.bus.emit('modal:close');
    },
    isOpen: function () { return modalMask && !modalMask.hidden; }
  };

  /* ------------------------------------------------------------
   * 8. 渲染总入口（由各模块挂载）
   * ---------------------------------------------------------- */
  EM.renderAll = function () {
    EM.bus.emit('render:all');
    EM.canvas && EM.canvas.syncFrame && EM.canvas.syncFrame();
  };

  /* ------------------------------------------------------------
   * 9. 编号字符
   * ---------------------------------------------------------- */
  var CIRCLED = '①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮⑯⑰⑱⑲⑳';
  EM.circled = function (n) {
    if (n >= 1 && n <= 20) return CIRCLED.charAt(n - 1);
    return String(n);
  };

  /* 纯文本提取 */
  EM.textOf = function (html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    return (d.textContent || '').replace(/\u00a0/g, ' ').replace(/[ \t]+/g, ' ').replace(/\n{3,}/g, '\n\n').trim();
  };

})(typeof window !== 'undefined' ? window : globalThis);
