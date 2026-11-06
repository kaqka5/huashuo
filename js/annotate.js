/* ============================================================
 * 画说 · annotate.js
 * 墨迹（划线 / 画圈 / 画方框）· 选中后可以拖动或删除
 * 选区小框 · 选区到提问卡的连线
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var U = EM.util;
  var SVGNS = 'http://www.w3.org/2000/svg';

  var selectedStroke = null;
  var ghostPath = null;   // 拖拽中的预览
  var editing = false;    // 刚画完、还可以拖动调整的状态

  var A = (EM.annotate = {
    selectedStroke: function () { return selectedStroke; },

    /* ================= 渲染 ================= */
    renderAll: function () {
      var svg = EM.canvas.svgLayer;
      if (!svg) return;
      svg.innerHTML =
        '<defs>' +
        '<marker id="arrow" viewBox="0 0 10 10" refX="8.4" refY="5" markerWidth="5.6" markerHeight="5.6" orient="auto-start-reverse">' +
        '<path d="M0.6 1.4L8.6 5L0.6 8.6" fill="none" stroke="context-stroke" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>' +
        '</marker>' +
        '</defs>' +
        '<g class="g-links"></g>' +
        '<g class="g-strokes"></g>' +
        '<g class="g-tools"></g>';

      syncSvgSize();

      EM.state.strokes.forEach(function (s) { A.renderStroke(s); });
      A.renderFrames();
      A.updateLinks();
      A.renderTools();
    },

    renderStroke: function (s) {
      var g = EM.canvas.svgLayer && EM.canvas.svgLayer.querySelector('.g-strokes');
      if (!g) return;
      var old = g.querySelector('[data-id="' + s.id + '"]');
      if (old) old.remove();

      var a = EM.canvas.point(s.a), b = EM.canvas.point(s.b);
      var seed = hash(s.id);
      var sel = selectedStroke === s.id;

      var group = document.createElementNS(SVGNS, 'g');
      group.setAttribute('data-id', s.id);

      /* 描边：主线 + 一层淡的重影，像手画的 */
      var main = document.createElementNS(SVGNS, 'path');
      main.setAttribute('d', A.pathFor(s, 0, seed));
      main.setAttribute('class', 'stroke' + (sel ? ' sel' : ''));
      group.appendChild(main);

      var ghost = document.createElementNS(SVGNS, 'path');
      ghost.setAttribute('d', A.pathFor(s, 1, seed + 5));
      ghost.setAttribute('class', 'stroke ghost');
      group.appendChild(ghost);

      /* 拖拽命中区 */
      var hit = document.createElementNS(SVGNS, 'path');
      hit.setAttribute('d', A.hitPath(s, a, b, seed));
      hit.setAttribute('class', 'stroke hit');
      hit.setAttribute('data-id', s.id);
      group.appendChild(hit);

      g.appendChild(group);
      A.renderTools();
    },

    /** 几何路径；inset>0 时生成偏移的重影 */
    pathFor: function (s, inset, seed) {
      var a = EM.canvas.point(s.a), b = EM.canvas.point(s.b);
      if (s.type === 'ellipse') {
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        var rx = Math.max(6, Math.abs(b.x - a.x) / 2), ry = Math.max(6, Math.abs(b.y - a.y) / 2);
        return ellipsePath(cx + inset * .8, cy + inset, rx + inset * 1.4, ry + inset * 1.2, seed);
      }
      if (s.type === 'rect') return rectPath(a, b, seed, inset);
      return linePath({ x: a.x + inset * .8, y: a.y + inset }, { x: b.x + inset * .6, y: b.y + inset }, seed);
    },

    hitPath: function (s, a, b, seed) {
      if (s.type === 'ellipse') {
        var cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
        return 'M' + a.x + ' ' + cy + 'A' + Math.abs(b.x - a.x) / 2 + ' ' + Math.abs(b.y - a.y) / 2 + ' 0 1 0 ' + b.x + ' ' + cy +
          'A' + Math.abs(b.x - a.x) / 2 + ' ' + Math.abs(b.y - a.y) / 2 + ' 0 1 0 ' + a.x + ' ' + cy;
      }
      if (s.type === 'rect') {
        var x1 = Math.min(a.x, b.x), x2 = Math.max(a.x, b.x);
        var y1 = Math.min(a.y, b.y), y2 = Math.max(a.y, b.y);
        return 'M' + x1 + ' ' + y1 + 'H' + x2 + 'V' + y2 + 'H' + x1 + 'Z';
      }
      return 'M' + a.x + ' ' + a.y + 'L' + b.x + ' ' + b.y;
    },

    /** 只重画挂在某张卡片上的墨迹（拖动卡片时用） */
    redrawForBox: function (id) {
      EM.state.strokes.forEach(function (s) {
        if (s.a.bid === id || s.b.bid === id) A.renderStroke(s);
      });
    },

    /** 新建墨迹：a、b 为 {bid,rx,ry} */
    addStroke: function (type, a, b) {
      var s = { id: U.uid('s'), type: type, a: a, b: b };
      EM.state.strokes.push(s);
      A.renderStroke(s);
      return s;
    },

    /** 拖拽预览 */
    previewStroke: function (type, a, b) {
      var svg = EM.canvas.svgLayer;
      if (!ghostPath) {
        ghostPath = document.createElementNS(SVGNS, 'path');
        ghostPath.setAttribute('class', 'stroke preview');
        ghostPath.style.opacity = '.55';
        ghostPath.style.strokeDasharray = '6 4';
        svg.appendChild(ghostPath);
      }
      var p1 = EM.canvas.point(a), p2 = EM.canvas.point(b);
      var fake = { type: type, a: a, b: b };
      if (type === 'ellipse') {
        var cx = (p1.x + p2.x) / 2, cy = (p1.y + p2.y) / 2;
        ghostPath.setAttribute('d', ellipsePath(cx, cy, Math.abs(p2.x - p1.x) / 2, Math.abs(p2.y - p1.y) / 2, 1));
      } else if (type === 'rect') {
        ghostPath.setAttribute('d', rectPath(p1, p2, 1, 0));
      } else {
        ghostPath.setAttribute('d', 'M' + p1.x + ' ' + p1.y + 'L' + p2.x + ' ' + p2.y);
      }
    },

    clearPreview: function () {
      if (ghostPath && ghostPath.parentNode) ghostPath.parentNode.removeChild(ghostPath);
      ghostPath = null;
    },

    /* ================= 选中 / 移动 ================= */
    select: function (id) {
      editing = false;
      selectedStroke = id;
      var g = EM.canvas.svgLayer && EM.canvas.svgLayer.querySelector('.g-strokes');
      if (g) {
        g.querySelectorAll('.stroke').forEach(function (n) { n.classList.remove('sel'); });
        if (id) {
          var grp = g.querySelector('[data-id="' + id + '"]');
          if (grp) {
            var main = grp.querySelector('.stroke:not(.hit):not(.ghost)');
            if (main) main.classList.add('sel');
          }
        }
      }
      A.renderTools();
      EM.bus.emit('stroke:select', id);
    },

    /** 刚画完：进入「可拖动调整」状态，点外面才定稿 */
    setEditing: function (id) {
      A.select(id);
      editing = true;
      A.renderTools();
      if (!A._editTip) {
        A._editTip = true;
        EM.toast('按住图形内部可以挪位置，点外面就定下来', { timeout: 3200 });
      }
    },

    editingId: function () { return editing ? selectedStroke : null; },

    clearEditing: function () {
      editing = false;
      if (selectedStroke) A.select(null);
      else A.renderTools();
    },

    startMove: function (e, s) { startMove(e, s); },

    /** 选中时在旁边放一个删除按钮 + 虚线框 */
    renderTools: function () {
      var svg = EM.canvas.svgLayer;
      if (!svg) return;
      var g = svg.querySelector('.g-tools');
      if (!g) return;
      g.innerHTML = '';
      if (!selectedStroke) return;

      var s = null;
      for (var i = 0; i < EM.state.strokes.length; i++) if (EM.state.strokes[i].id === selectedStroke) s = EM.state.strokes[i];
      if (!s) { selectedStroke = null; return; }

      var bb = A.boundsOf(s);
      var box = document.createElementNS(SVGNS, 'rect');
      box.setAttribute('x', bb.x1 - 4);
      box.setAttribute('y', bb.y1 - 4);
      box.setAttribute('width', Math.max(8, bb.x2 - bb.x1 + 8));
      box.setAttribute('height', Math.max(8, bb.y2 - bb.y1 + 8));
      box.setAttribute('rx', 5);
      box.setAttribute('class', 'stroke-selbox' + (editing ? ' editing' : ''));
      g.appendChild(box);

      if (editing) {
        var tip = document.createElementNS(SVGNS, 'text');
        tip.setAttribute('x', bb.x1);
        tip.setAttribute('y', bb.y1 - 10);
        tip.setAttribute('class', 'stroke-tip');
        tip.textContent = '拖动调整 · 点外面确定';
        g.appendChild(tip);
      }

      var btn = document.createElementNS(SVGNS, 'g');
      btn.setAttribute('class', 'stroke-del');
      btn.setAttribute('transform', 'translate(' + (bb.x2 + 12) + ',' + (bb.y1 - 12) + ')');
      btn.innerHTML = '<circle r="9"/><path d="M-3.1 -3.1L3.1 3.1M3.1 -3.1L-3.1 3.1"/>';
      g.appendChild(btn);
    },

    boundsOf: function (s) {
      var a = EM.canvas.point(s.a), b = EM.canvas.point(s.b);
      return { x1: Math.min(a.x, b.x), y1: Math.min(a.y, b.y), x2: Math.max(a.x, b.x), y2: Math.max(a.y, b.y) };
    },

    /** 整体平移（世界坐标增量），点在卡片上就保留相对关系 */
    moveBy: function (s, dx, dy) {
      var before = { ax: s.a.rx, ay: s.a.ry, bx: s.b.rx, by: s.b.ry };
      s.a.rx = before.ax + dx; s.a.ry = before.ay + dy;
      s.b.rx = before.bx + dx; s.b.ry = before.by + dy;
      A.renderStroke(s);
    },

    remove: function (id) {
      EM.state.strokes = EM.state.strokes.filter(function (s) { return s.id !== id; });
      var g = EM.canvas.svgLayer.querySelector('.g-strokes [data-id="' + id + '"]');
      if (g) g.remove();
      if (selectedStroke === id) { selectedStroke = null; A.renderTools(); }
      EM.persist.schedule();
    },

    /* ================= 选区小框 ================= */
    addFrame: function (data) {
      var f = {
        id: U.uid('f'),
        boxId: data.boxId,
        rx: Math.round(data.rx),
        ry: Math.round(data.ry),
        w: Math.round(data.w),
        h: Math.round(data.h),
        text: data.text || '',
        question: data.question || '',
        off: data.off != null ? data.off : null,
        len: data.len != null ? data.len : null,
        no: EM.state.frames.length + 1,
        qaBoxId: null
      };
      EM.state.frames.push(f);
      A.renderFrames();
      return f;
    },

    renderFrames: function () {
      var layer = EM.canvas.framesLayer;
      if (!layer) return;
      layer.innerHTML = '';

      EM.state.frames.forEach(function (f, idx) {
        var parent = EM.state.box(f.boxId);
        var el = U.el('div', 'sel-frame');
        el.dataset.id = f.id;
        el.style.left = (parent ? parent.x + f.rx : f.rx) + 'px';
        el.style.top = (parent ? parent.y + f.ry : f.ry) + 'px';
        el.style.width = f.w + 'px';
        el.style.height = f.h + 'px';
        el.style.zIndex = String(10 + idx);
        el.title = '点击定位到对应的提问卡';

        var badge = U.el('span', 'sel-badge', String(MORKS[Math.min(idx, MORKS.length - 1)]));
        el.appendChild(badge);

        el.addEventListener('click', function (e) {
          e.stopPropagation();
          if (f.qaBoxId) {
            var qb = EM.state.box(f.qaBoxId);
            if (qb) {
              var qel = EM.boxes.getEl(qb.id);
              if (qel) {
                qel.classList.remove('pulse');
                void qel.offsetWidth;
                qel.classList.add('pulse');
                EM.canvas.focusRect({ x: qb.x, y: qb.y, w: qb.w, h: qb.h || 120 }, { keepZoom: true, duration: 420 });
              }
            }
          }
        });

        layer.appendChild(el);
      });
      A.updateLinks();
    },

    /** 卡片移动/缩放后，选区框跟着走 */
    positionFrames: function () {
      EM.canvas.framesLayer.querySelectorAll('.sel-frame').forEach(function (el) {
        var f = EM.state.frame(el.dataset.id);
        if (!f) return;
        var parent = EM.state.box(f.boxId);
        el.style.left = (parent ? parent.x + f.rx : f.rx) + 'px';
        el.style.top = (parent ? parent.y + f.ry : f.ry) + 'px';
      });
    },

    /* ================= 连线 ================= */
    addLink: function (frameId, boxId) {
      EM.state.links.push({ id: U.uid('l'), frameId: frameId, boxId: boxId });
      A.updateLinks();
    },

    updateLinks: function () {
      var g = EM.canvas.svgLayer && EM.canvas.svgLayer.querySelector('.g-links');
      if (!g) return;
      g.innerHTML = '';
      A.positionFrames();

      EM.state.links.forEach(function (l) {
        var f = EM.state.frame(l.frameId);
        var b = EM.state.box(l.boxId);
        if (!f || !b) return;

        var pbox = EM.state.box(f.boxId);
        var fx1 = (pbox ? pbox.x : 0) + f.rx;
        var fy1 = (pbox ? pbox.y : 0) + f.ry;
        var fw = f.w, fh = f.h;
        var fx2 = fx1 + fw, fy2 = fy1 + fh;

        var host = EM.boxes.getEl(b.id);
        var bh = host ? host.offsetHeight : (b.h || 120);
        var bx1 = b.x, by1 = b.y, bx2 = b.x + b.w, by2 = b.y + bh;

        // 谁在谁哪边：决定连线从哪条边出去、从哪条边进来
        var dx = (bx1 + bx2) / 2 - (fx1 + fx2) / 2;
        var dy = (by1 + by2) / 2 - (fy1 + fy2) / 2;

        var sx, sy, ex, ey, d;
        var horizontal = Math.abs(dx) >= Math.abs(dy) * 0.85;

        if (horizontal) {
          var sy0 = (fy1 + fy2) / 2;
          var ey0 = Math.min(Math.max((by1 + by2) / 2, by1 + 16), by2 - 16);
          if (dx >= 0) { sx = fx2; sy = sy0; ex = bx1; ey = ey0; }
          else { sx = fx1; sy = sy0; ex = bx2; ey = ey0; }
          var dxp = Math.max(46, Math.abs(ex - sx) * 0.45);
          d = 'M' + sx + ' ' + sy +
            ' C' + (sx + (dx >= 0 ? dxp : -dxp)) + ' ' + sy + ',' +
            (ex - (dx >= 0 ? dxp : -dxp)) + ' ' + ey + ',' + ex + ' ' + ey;
        } else {
          var sx0 = (fx1 + fx2) / 2;
          var ex0 = Math.min(Math.max((bx1 + bx2) / 2, bx1 + 24), bx2 - 24);
          if (dy >= 0) { sx = sx0; sy = fy2; ex = ex0; ey = by1; }
          else { sx = sx0; sy = fy1; ex = ex0; ey = by2; }
          var dyp = Math.max(40, Math.abs(ey - sy) * 0.45);
          d = 'M' + sx + ' ' + sy +
            ' C' + sx + ' ' + (sy + (dy >= 0 ? dyp : -dyp)) + ',' +
            ex + ' ' + (ey - (dy >= 0 ? dyp : -dyp)) + ',' + ex + ' ' + ey;
        }

        var path = document.createElementNS(SVGNS, 'path');
        path.setAttribute('d', d);
        path.setAttribute('class', 'link-path');
        path.setAttribute('marker-end', 'url(#arrow)');
        g.appendChild(path);

        var dot = document.createElementNS(SVGNS, 'circle');
        dot.setAttribute('cx', sx);
        dot.setAttribute('cy', sy);
        dot.setAttribute('r', 2.6);
        dot.setAttribute('class', 'link-dot');
        g.appendChild(dot);
      });
    },

    syncSize: function () { syncSvgSize(); },

    /* ================= 交互 ================= */
    bind: function () {
      var svg = EM.canvas.svgLayer;

      svg.addEventListener('pointerdown', function (e) {
        /* 删除按钮 */
        var del = e.target.closest ? e.target.closest('.stroke-del') : null;
        if (del) {
          e.stopPropagation();
          e.preventDefault();
          if (!selectedStroke) return;
          var id = selectedStroke;
          EM.history.push('删除墨迹');
          A.remove(id);
          EM.toast('已删除这条墨迹', { action: { label: '撤回', fn: function () { EM.history.undo(); } } });
          return;
        }

        var hit = e.target.closest ? e.target.closest('.stroke.hit') : null;
        if (!hit) return;
        if (EM.tools && EM.tools.current !== 'move') return;

        e.stopPropagation();
        e.preventDefault();

        var s = null;
        for (var i = 0; i < EM.state.strokes.length; i++) if (EM.state.strokes[i].id === hit.dataset.id) s = EM.state.strokes[i];
        if (!s) return;

        A.select(s.id);
        startMove(e, s);
      });

      /* 点空白处取消选中 */
      EM.canvas.viewport.addEventListener('pointerdown', function (e) {
        if (e.target.closest && e.target.closest('.stroke.hit, .stroke-del, .sel-frame, .box')) return;
        if (EM.annotate.selectedStroke()) EM.annotate.select(null);
      });
    }
  });

  /* ---------------- 拖动的实现 ---------------- */
  function startMove(e, s) {
    var k = EM.state.view.k;
    var sx = e.clientX, sy = e.clientY;
    var o = { ax: s.a.rx, ay: s.a.ry, bx: s.b.rx, by: s.b.ry };
    var pushed = false;
    var moved = false;

    function move(ev) {
      var dx = (ev.clientX - sx) / k;
      var dy = (ev.clientY - sy) / k;
      if (!moved && Math.abs(dx) + Math.abs(dy) < 2) return;
      if (!pushed) {
        EM.history.push('移动墨迹');
        pushed = true;
      }
      moved = true;
      s.a.rx = o.ax + dx; s.a.ry = o.ay + dy;
      s.b.rx = o.bx + dx; s.b.ry = o.by + dy;
      A.renderStroke(s);
      A.renderTools();
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (moved) EM.persist.schedule();
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ---------------- 手绘风格路径 ---------------- */
  var MORKS = '⓵⓶⓷⓸⓹⓺⓻⓼⓽⓾⓫⓬⓭⓮⓯⓰⓱⓲⓳⓴'.split('');

  function syncSvgSize() {
    var svg = EM.canvas.svgLayer;
    if (!svg) return;
    var c = EM.state.canvas;
    svg.setAttribute('width', Math.max(1, c.w));
    svg.setAttribute('height', Math.max(1, c.h));
    svg.style.width = Math.max(1, c.w) + 'px';
    svg.style.height = Math.max(1, c.h) + 'px';
  }

  EM.bus.on('canvas:expand', syncSvgSize);

  function hash(str) {
    var h = 0;
    for (var i = 0; i < String(str).length; i++) h = (h * 31 + String(str).charCodeAt(i)) & 0x7fffffff;
    return h;
  }

  function linePath(a, b, seed) {
    var dx = b.x - a.x, dy = b.y - a.y;
    var len = Math.hypot(dx, dy) || 1;
    var wob = Math.min(2.4, len / 90) * (((seed % 100) / 100) - 0.5);
    var nx = -dy / len, ny = dx / len;
    var mx = (a.x + b.x) / 2 + nx * wob;
    var my = (a.y + b.y) / 2 + ny * wob;
    return 'M' + a.x + ' ' + a.y + ' Q' + mx + ' ' + my + ' ' + b.x + ' ' + b.y;
  }

  function rectPath(a, b, seed, inset) {
    var j = function (k) { return (((seed + k * 53) % 100) / 100 - 0.5) * 2.2; };
    var o = inset || 0;
    var x1 = Math.min(a.x, b.x) - o, x2 = Math.max(a.x, b.x) + o;
    var y1 = Math.min(a.y, b.y) - o, y2 = Math.max(a.y, b.y) + o;
    return 'M' + (x1 + j(1)) + ' ' + (y1 + j(2)) +
      ' L' + (x2 + j(3)) + ' ' + (y1 + j(4)) +
      ' L' + (x2 + j(5)) + ' ' + (y2 + j(6)) +
      ' L' + (x1 + j(7)) + ' ' + (y2 + j(8)) +
      ' L' + (x1 + j(9)) + ' ' + (y1 + j(10));
  }

  function ellipsePath(cx, cy, rx, ry, seed) {
    var j = function (k) { return (((seed + k * 37) % 100) / 100 - 0.5) * Math.min(3, rx * 0.06); };
    var r1x = rx + j(1), r1y = ry + j(2), r2x = rx + j(3), r2y = ry + j(4);
    var k = 0.5523;
    return 'M' + (cx + r1x) + ' ' + cy +
      ' C' + (cx + r1x) + ' ' + (cy - r1y * k) + ' ' + (cx + r2x * k) + ' ' + (cy - r1y) + ' ' + cx + ' ' + (cy - r1y) +
      ' C' + (cx - r2x * k) + ' ' + (cy - r1y) + ' ' + (cx - r1x) + ' ' + (cy - r1y * k) + ' ' + (cx - r1x) + ' ' + cy +
      ' C' + (cx - r1x) + ' ' + (cy + r2y * k) + ' ' + (cx - r2x * k) + ' ' + (cy + r2y) + ' ' + cx + ' ' + (cy + r2y) +
      ' C' + (cx + r2x * k) + ' ' + (cy + r2y) + ' ' + (cx + r1x) + ' ' + (cy + r1y * k) + ' ' + (cx + r1x) + ' ' + cy +
      ' C' + (cx + r1x * 1.02) + ' ' + (cy - 1) + ' ' + (cx + r1x * 1.04) + ' ' + (cy + 2) + ' ' + (cx + r1x * 0.99) + ' ' + (cy + 3);
  }

})(typeof window !== 'undefined' ? window : globalThis);
