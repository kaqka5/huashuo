/* ============================================================
 * Branch · canvas.js
 * ⑤ 无限画布：平移、缩放、坐标换算、画布边界自动扩展
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var U = EM.util;

  var viewport, world, frameEl, boxesLayer, svgLayer, framesLayer;
  var MIN_K = 0.22, MAX_K = 2.8;

  var canvasApi = (EM.canvas = {
    MIN_K: MIN_K,
    MAX_K: MAX_K,

    init: function () {
      viewport = document.getElementById('viewport');
      world = document.getElementById('world');
      frameEl = document.getElementById('paperFrame');
      boxesLayer = document.getElementById('layerBoxes');
      svgLayer = document.getElementById('layerSvg');
      framesLayer = document.getElementById('layerFrames');

      canvasApi.viewport = viewport;
      canvasApi.world = world;
      canvasApi.frameEl = frameEl;
      canvasApi.boxesLayer = boxesLayer;
      canvasApi.svgLayer = svgLayer;
      canvasApi.framesLayer = framesLayer;

      canvasApi.apply();
      canvasApi.syncFrame();

      window.addEventListener('resize', function () {
        canvasApi.apply();
      });
    },

    /* ---------------- 变换 ---------------- */
    apply: function () {
      var v = EM.state.view;
      world.style.transform = 'translate3d(' + v.x + 'px,' + v.y + 'px,0) scale(' + v.k + ')';
      var z = document.getElementById('zoomVal');
      if (z) z.textContent = Math.round(v.k * 100) + '%';
      EM.bus.emit('view:change', v);
    },

    setView: function (v) {
      var s = EM.state.view;
      if (v.x !== undefined) s.x = v.x;
      if (v.y !== undefined) s.y = v.y;
      if (v.k !== undefined) s.k = U.clamp(v.k, MIN_K, MAX_K);
      canvasApi.apply();
    },

    /* 屏幕坐标 → 世界坐标 */
    toWorld: function (clientX, clientY) {
      var r = viewport.getBoundingClientRect();
      var v = EM.state.view;
      return {
        x: (clientX - r.left - v.x) / v.k,
        y: (clientY - r.top - v.y) / v.k
      };
    },

    /* 世界坐标 → 屏幕坐标 */
    toScreen: function (x, y) {
      var r = viewport.getBoundingClientRect();
      var v = EM.state.view;
      return { x: x * v.k + v.x + r.left, y: y * v.k + v.y + r.top };
    },

    /* 以某个客户端点为锚点缩放 */
    zoomAt: function (clientX, clientY, factor) {
      var v = EM.state.view;
      var r = viewport.getBoundingClientRect();
      var k2 = U.clamp(v.k * factor, MIN_K, MAX_K);
      if (k2 === v.k) return;
      var px = clientX - r.left, py = clientY - r.top;
      v.x = px - (px - v.x) * (k2 / v.k);
      v.y = py - (py - v.y) * (k2 / v.k);
      v.k = k2;
      canvasApi.apply();
    },

    /* 双指缩放：一次性算好，避免"先缩放再平移"两步叠加造成的抖动 */
    pinchAt: function (fromCx, fromCy, toCx, toCy, factor) {
      var v = EM.state.view;
      var k2 = U.clamp(v.k * factor, MIN_K, MAX_K);
      if (k2 === v.k && fromCx === toCx && fromCy === toCy) return;

      var r = viewport.getBoundingClientRect();
      var fx = fromCx - r.left, fy = fromCy - r.top;
      var tx = toCx - r.left, ty = toCy - r.top;

      // 让 from 点下的内容落到 to 点，同时缩放 k2/k
      var ratio = k2 / v.k;
      v.x = tx - (fx - v.x) * ratio;
      v.y = ty - (fy - v.y) * ratio;
      v.k = k2;
      canvasApi.apply();
    },

    zoomStep: function (dir) {
      var r = viewport.getBoundingClientRect();
      canvasApi.zoomAt(r.left + r.width / 2, r.top + r.height / 2, dir > 0 ? 1.18 : 1 / 1.18);
    },

    /* 平移画布 */
    panBy: function (dx, dy) {
      var v = EM.state.view;
      v.x += dx; v.y += dy;
      canvasApi.apply();
    },

    /* ---------------- 复位 / 适应 ---------------- */
    resetView: function () {
      var vw = viewport.clientWidth, vh = viewport.clientHeight;
      var c = EM.state.canvas;
      var k = U.clamp(Math.min(1, (vw - 48) / c.w, (vh - 48) / c.h), 0.5, 1);
      canvasApi.setView({
        k: k,
        x: Math.max(16, (vw - c.w * k) / 2),
        y: Math.max(16, (vh - c.h * k) / 2)
      });
    },

    /* 内容包围盒（世界坐标） */
    contentBounds: function () {
      var minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity, any = false;

      EM.state.boxes.forEach(function (b) {
        var h = b.h || 120;
        minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
        maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + h);
        any = true;
      });

      EM.state.strokes.forEach(function (s) {
        var a = canvasApi.point(s.a), b = canvasApi.point(s.b);
        var pts = [a, b];
        if (s.type === 'ellipse') {
          pts.push({ x: a.x + 2 * (b.x - a.x), y: a.y + 2 * (b.y - a.y) });
        }
        pts.forEach(function (p) {
          minX = Math.min(minX, p.x); minY = Math.min(minY, p.y);
          maxX = Math.max(maxX, p.x); maxY = Math.max(maxY, p.y);
          any = true;
        });
      });

      if (!any) return { x: 0, y: 0, w: 0, h: 0, empty: true };
      return { x: minX, y: minY, w: maxX - minX, h: maxY - minY, empty: false };
    },

    /* 缩放到全部内容 */
    fit: function (pad, opts) {
      opts = opts || {};
      pad = pad == null ? 90 : pad;
      var vw = viewport.clientWidth;
      var vh = viewport.clientHeight - (opts.bottomReserve == null ? 210 : opts.bottomReserve);
      var b = canvasApi.contentBounds();
      if (b.empty) { canvasApi.resetView(); return; }

      var k = Math.min((vw - pad * 2) / Math.max(b.w, 1), (vh - pad) / Math.max(b.h, 1));
      k = U.clamp(k, opts.minK || 0.55, 1.12);

      var x, y;
      if (b.w * k > vw - pad * 2) x = pad - b.x * k;
      else x = (vw - b.w * k) / 2 - b.x * k;

      if (b.h * k > vh - pad) y = pad * 0.6 - b.y * k;
      else y = (vh - b.h * k) / 2 - b.y * k;

      canvasApi.setView({ k: k, x: x, y: y });
    },

    /* 把某个世界坐标点居中 */
    centerOn: function (x, y, k) {
      var vw = viewport.clientWidth, vh = viewport.clientHeight;
      var v = EM.state.view;
      var kk = k || v.k;
      canvasApi.setView({ k: kk, x: vw / 2 - x * kk, y: vh / 2 - y * kk });
    },

    /* 平滑移动到某个矩形（可用于生成后定位） */
    focusRect: function (rect, opts) {
      opts = opts || {};
      var vw = viewport.clientWidth;
      var vh = viewport.clientHeight - (opts.bottomReserve == null ? 150 : opts.bottomReserve);
      var pad = opts.pad == null ? 80 : opts.pad;
      var maxK = opts.maxK || 1.05, minK = opts.minK || 0.45;
      var k = Math.min((vw - pad * 2) / Math.max(rect.w, 1), (vh - pad) / Math.max(rect.h, 1));
      k = U.clamp(k, minK, maxK);
      if (opts.keepZoom) k = EM.state.view.k;
      var target = {
        k: k,
        x: (vw - rect.w * k) / 2 - rect.x * k,
        y: (vh - rect.h * k) / 2 - rect.y * k
      };
      if (opts.keepZoom) {
        // 只把目标移到视野里，不改变缩放
        target.x = vw / 2 - (rect.x + rect.w / 2) * k;
        target.y = Math.min(vh - rect.h * k - 20, Math.max(24, vh / 2 - (rect.y + rect.h / 2) * k));
      }
      canvasApi.animateTo(target, opts.duration || 420);
    },

    animateTo: function (target, dur) {
      var from = Object.assign({}, EM.state.view);
      var t0 = performance.now();
      dur = dur || 380;
      function step(now) {
        var t = Math.min(1, (now - t0) / dur);
        var e = 1 - Math.pow(1 - t, 3);
        EM.state.view.x = from.x + (target.x - from.x) * e;
        EM.state.view.y = from.y + (target.y - from.y) * e;
        EM.state.view.k = from.k + (target.k - from.k) * e;
        canvasApi.apply();
        if (t < 1) requestAnimationFrame(step);
        else EM.persist.schedule();
      }
      requestAnimationFrame(step);
    },

    /* ---------------- 画布边界 ⑤ ---------------- */
    syncFrame: function () {
      if (!frameEl) return;
      var c = EM.state.canvas;
      frameEl.style.width = c.w + 'px';
      frameEl.style.height = c.h + 'px';
    },

    /** 内容越界就自动扩展画布 */
    expandTo: function (rect, opts) {
      opts = opts || {};
      var pad = opts.pad == null ? 240 : opts.pad;
      var c = EM.state.canvas;
      var changed = false;
      var nx = Math.min(0, rect.x - pad * 0.5);
      var ny = Math.min(0, rect.y - pad * 0.5);

      if (nx < 0) { c.w += -nx; changed = true; nx = 0; }
      if (ny < 0) { c.h += -ny; changed = true; ny = 0; }

      var needW = Math.max(rect.x + rect.w + pad, c.w);
      var needH = Math.max(rect.y + rect.h + pad, c.h);

      if (needW > c.w || needH > c.h) changed = true;

      if (needW > c.w) c.w = needW;
      if (needH > c.h) c.h = needH;

      if (changed) {
        canvasApi.syncFrame();
        if (opts.pulse !== false) canvasApi.pulseFrame();
        EM.bus.emit('canvas:expand', c);
      }
      return changed;
    },

    pulseFrame: function () {
      if (!frameEl) return;
      frameEl.classList.add('grow');
      clearTimeout(canvasApi._pulseT);
      canvasApi._pulseT = setTimeout(function () {
        frameEl.classList.remove('grow');
      }, 700);
    },

    /* ---------------- 点（可挂在卡片上） ---------------- */
    /** {bid, rx, ry} → 世界坐标 */
    point: function (p) {
      if (!p) return { x: 0, y: 0 };
      if (p.bid) {
        var b = EM.state.box(p.bid);
        if (b) return { x: b.x + p.rx, y: b.y + p.ry };
      }
      return { x: p.rx, y: p.ry };
    },

    /** 世界坐标 → 挂在卡片上的相对坐标（若落在卡片里） */
    makePoint: function (wx, wy) {
      var b = canvasApi.boxAt(wx, wy);
      if (b) return { bid: b.id, rx: wx - b.x, ry: wy - b.y };
      return { bid: null, rx: wx, ry: wy };
    },

    /** 找出某个世界坐标点所在的卡片（取最上层一张） */
    boxAt: function (wx, wy) {
      var boxes = EM.state.boxes;
      for (var i = boxes.length - 1; i >= 0; i--) {
        var b = boxes[i];
        var h = b.h || 120;
        if (wx >= b.x && wx <= b.x + b.w && wy >= b.y && wy <= b.y + h) return b;
      }
      return null;
    },

    /** 找出与矩形相交的卡片 */
    boxesInRect: function (r) {
      return EM.state.boxes.filter(function (b) {
        var h = b.h || 120;
        return !(b.x > r.x + r.w || b.x + b.w < r.x || b.y > r.y + r.h || b.y + h < r.y);
      });
    },

    /** 自动平移：拖拽到视口边缘时把画布推过去 */
    autoPan: function (clientX, clientY) {
      var r = viewport.getBoundingClientRect();
      var edge = 72, speed = 22;
      var dx = 0, dy = 0;
      if (clientX < r.left + edge) dx = speed * (1 - (clientX - r.left) / edge);
      else if (clientX > r.right - edge) dx = -speed * (1 - (r.right - clientX) / edge);
      if (clientY < r.top + edge) dy = speed * (1 - (clientY - r.top) / edge);
      else if (clientY > r.bottom - edge) dy = -speed * (1 - (r.bottom - clientY) / edge);
      dx = U.clamp(dx, -speed, speed);
      dy = U.clamp(dy, -speed, speed);
      if (dx || dy) canvasApi.panBy(dx, dy);
      return { dx: dx, dy: dy };
    },

    /** 计算新卡片应该放在哪（避免重叠） */
    freeSpot: function (w, h, prefer) {
      var gap = 18;
      var x = prefer && prefer.x != null ? prefer.x : 80;
      var y = prefer && prefer.y != null ? prefer.y : 60;
      var boxes = EM.state.boxes;

      function hits(x0, y0) {
        for (var i = 0; i < boxes.length; i++) {
          var b = boxes[i], bh = b.h || 120;
          if (x0 < b.x + b.w + gap && x0 + w + gap > b.x && y0 < b.y + bh + gap && y0 + h + gap > b.y) return true;
        }
        return false;
      }

      var tries = 0;
      while (hits(x, y) && tries < 240) {
        y += h + gap;
        if (y > 4000) { y = 80; x += w + gap * 2; }
        tries++;
      }
      return { x: x, y: y };
    }
  });

  /* ---------------- 平移交互 ---------------- */
  var panning = null;

  /* 双指缩放开始时，打断正在进行的平移 */
  EM.canvas.cancelPan = function () {
    panning = null;
    var st = document.getElementById('stage');
    if (st) st.classList.remove('is-panning');
  };

  EM.canvas.bindPan = function () {
    viewport.addEventListener('pointerdown', function (e) {
      /* 第二根手指不参与平移：否则它会和双指缩放叠加，画面在两指之间来回抖 */
      if (e.isPrimary === false) return;

      var isMiddle = e.button === 1;
      var isSpace = EM.keys && EM.keys.space;
      var isBackground = !e.target.closest('.box') && !e.target.closest('.sel-frame');

      /* 手指：只要没开"手指也能画"，一律当平移（不管当前是什么工具） */
      var fingerPan = e.pointerType === 'touch' && !(EM.touch && EM.touch.fingerDraw());

      var allow =
        isMiddle ||
        isSpace ||
        (isBackground && (EM.tools ? EM.tools.current === 'move' : true) && e.button === 0) ||
        (fingerPan && e.button === 0 && isBackground &&
          !e.target.closest('.composer-wrap, .zoom-dock, .drawer, .modal, .ctx-menu, .keep-bar, .ask-pop'));

      if (!allow) return;

      e.preventDefault();
      e.stopPropagation();

      panning = { x: e.clientX, y: e.clientY, moved: false };
      document.getElementById('stage').classList.add('is-panning');
      viewport.setPointerCapture && viewport.setPointerCapture(e.pointerId);

      function move(ev) {
        if (!panning) return;
        var dx = ev.clientX - panning.x, dy = ev.clientY - panning.y;
        if (Math.abs(dx) + Math.abs(dy) > 2) panning.moved = true;
        canvasApi.panBy(dx, dy);
        panning.x = ev.clientX; panning.y = ev.clientY;
      }
      function up() {
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', up);
        document.getElementById('stage').classList.remove('is-panning');
        if (panning && panning.moved) EM.bus.emit('canvas:pan-end');
        panning = null;
        EM.persist.schedule();
      }
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', up);
    });
    /* 滚轮 */
    viewport.addEventListener('wheel', function (e) {
      if (e.ctrlKey || e.metaKey) {
        e.preventDefault();
        canvasApi.zoomAt(e.clientX, e.clientY, Math.pow(1.0016, -e.deltaY));
      } else if (e.shiftKey) {
        e.preventDefault();
        canvasApi.panBy(-e.deltaY - e.deltaX, 0);
      } else {
        e.preventDefault();
        canvasApi.panBy(-e.deltaX, -e.deltaY);
      }
      EM.persist.schedule();
    }, { passive: false });

    /* 阻止浏览器把文件拖到页面直接打开 */
    ['dragover', 'drop'].forEach(function (t) {
      viewport.addEventListener(t, function (e) {
        if (e.dataTransfer && (e.dataTransfer.types || []).indexOf('Files') >= 0) e.preventDefault();
      });
    });
  };

})(typeof window !== 'undefined' ? window : globalThis);
