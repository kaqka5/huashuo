/* ============================================================
 * Branch · tools.js
 * ① 工具栏：划线 / 画圈 / 方框 / 框选提问 / 重点截取 / 分框
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var U = EM.util;

  var stage, marquee, snapLine;
  var drag = null;
  var pop = null;
  var keepBar = null;     // 截取工具的确认条

  var TOOL_KEYS = {
    move: 'v', line: 'l', circle: 'c', rect: 'r',
    ask: 'q', keep: 'k', split: 's'
  };

  var tools = (EM.tools = {
    current: 'move',

    init: function () {
      stage = document.getElementById('stage');
      marquee = document.getElementById('marquee');
      snapLine = document.getElementById('snapLine');

      document.querySelectorAll('.tool[data-tool]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.dataset.tool;
          /* 函数图：已经在这个模式里再点一次 = 手动输入 */
          if (name === 'plot' && tools.current === 'plot') { EM.plot.openDialog({}); return; }
          tools.set(name);
        });
      });

      stage.addEventListener('pointerdown', onPointerDown);
      stage.addEventListener('pointermove', onHover);

      document.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
          if (pop) { closePop(); return; }
          if (keepBar) { clearKeep(); return; }
          if (EM.tools.current !== 'move') { tools.set('move'); return; }
        }
      });

      tools.set('move', true);
    },

    set: function (name, force) {
      if (!force && tools.current === name) return;
      tools.current = name;
      document.querySelectorAll('.tool[data-tool]').forEach(function (b) {
        b.classList.toggle('on', b.dataset.tool === name);
      });
      document.documentElement.dataset.tool = name;

      /* 触屏上：画图工具激活时，卡片正文不接受触摸 —— 否则一点就聚焦、弹出手写键盘 */
      var drawTool = (name === 'line' || name === 'circle' || name === 'rect' || name === 'ask' || name === 'keep' || name === 'plot');
      document.documentElement.classList.toggle('draw-tool', drawTool);
      if (drawTool) {
        var ae = document.activeElement;
        if (ae && ae.isContentEditable) {
          ae.blur();
          var sel = window.getSelection();
          if (sel && sel.rangeCount) sel.removeAllRanges();
        }
      }

      if (name !== 'move') EM.annotate.select(null);
      if (name !== 'split') hideSnap();
      if (name !== 'keep' && keepBar) clearKeep();
      if (keepBar && name === 'keep') showKeepBar();

      EM.bus.emit('tool:change', name);
    },

    ask: askFlow,
    closePop: closePop,
    TOOL_KEYS: TOOL_KEYS,

    /** 当前工具对应的按键（支持自定义） */
    keyFor: function (tool) {
      var map = EM.shortcuts ? EM.shortcuts.get() : TOOL_KEYS;
      return map[tool] || TOOL_KEYS[tool];
    },

    /** 临时工具：画函数图不是"模式"，点一下弹窗 */
    plot: function () { EM.plot.openDialog(); }
  });

  /* ============================================================
   * 指针按下
   * ========================================================== */
  function onPointerDown(e) {
    if (e.button !== 0) return;
    if (e.isPrimary === false) return;      /* 第二根手指不画东西，留给双指缩放 */
    if (EM.modal.isOpen()) return;
    if (e.target.closest('.composer-wrap, .zoom-dock, .toasts, .drawer, .modal, .keep-bar, .ask-pop, .ctx-menu')) return;

    /* 点画布时，先取消掉正在编辑/选中的文字 */
    var ae = document.activeElement;
    var inEditable = e.target.closest && e.target.closest('[contenteditable="true"]');
    if (ae && ae.isContentEditable && !inEditable) {
      ae.blur();
      var s = window.getSelection();
      if (s && s.rangeCount) s.removeAllRanges();
    }

    /* 刚画完的墨迹：按住里面拖动，点外面定稿 */
    var editingId = EM.annotate.editingId();
    if (editingId && !(e.target.closest && e.target.closest('.stroke-del'))) {
      var es = null;
      for (var si = 0; si < EM.state.strokes.length; si++) if (EM.state.strokes[si].id === editingId) es = EM.state.strokes[si];
      if (es) {
        var bb = EM.annotate.boundsOf(es);
        var wp = EM.canvas.toWorld(e.clientX, e.clientY);
        if (wp.x >= bb.x1 - 8 && wp.x <= bb.x2 + 8 && wp.y >= bb.y1 - 8 && wp.y <= bb.y2 + 8) {
          e.preventDefault();
          e.stopPropagation();
          EM.annotate.startMove(e, es);
          return;
        }
      }
      EM.annotate.clearEditing();
      return;
    }

    var t = tools.current;
    if (t === 'move') {
      if (!e.target.closest('.box') && !e.target.closest('.stroke.hit')) {
        EM.annotate.select(null);
      }
      return;
    }

    var stageRect = stage.getBoundingClientRect();
    var start = EM.canvas.toWorld(e.clientX, e.clientY);

    /* 手指且没开"手指也能画" → 这下手势交给画布平移，不画东西 */
    if (!EM.touch.shouldDraw(e)) return;

    if (t === 'split') {
      var hit = EM.canvas.boxAt(start.x, start.y);
      if (!hit) { EM.toast('点在一张卡片的正文上，才能切'); return; }
      e.preventDefault();
      EM.history.push('分框');
      EM.boxes.splitAt(hit, start.x, start.y);
      hideSnap();
      return;
    }

    if (t === 'line' || t === 'circle' || t === 'rect') {
      e.preventDefault();
      var a = EM.canvas.makePoint(start.x, start.y);
      drag = { kind: t, a: a, start: start, client: { x: e.clientX, y: e.clientY } };
    } else if (t === 'ask') {
      e.preventDefault();
      var box = EM.canvas.boxAt(start.x, start.y);
      if (!box) { EM.toast('从一张卡片里的文字开始框选'); return; }
      drag = { kind: t, box: box, start: start, stageRect: stageRect };
      marquee.hidden = false;
      setMarquee(start.x, start.y, start.x, start.y);
    } else if (t === 'plot') {
      e.preventDefault();
      var pbox = EM.canvas.boxAt(start.x, start.y);
      if (!pbox) { EM.plot.openDialog({}); return; }
      drag = { kind: t, box: pbox, start: start, stageRect: stageRect };
      marquee.hidden = false;
      setMarquee(start.x, start.y, start.x, start.y);
    } else if (t === 'keep') {
      e.preventDefault();
      var kbox = EM.canvas.boxAt(start.x, start.y);
      if (!kbox) { EM.toast('从一张卡片里的文字开始框选'); return; }
      drag = { kind: t, box: kbox, start: start, stageRect: stageRect };
      marquee.hidden = false;
      marquee.classList.add('keep');
      setMarquee(start.x, start.y, start.x, start.y);
    } else {
      return;
    }

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  }

  /* 双指缩放时，把正在进行的拖拽取消掉（不留痕迹） */
  EM.tools.cancelDrag = function () {
    if (!drag) return;
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    marquee.hidden = true;
    marquee.classList.remove('keep');
    EM.annotate.clearPreview();
  };

  function onMove(e) {
    if (!drag) return;
    var p = EM.canvas.toWorld(e.clientX, e.clientY);

    if (drag.kind === 'line' || drag.kind === 'circle' || drag.kind === 'rect') {
      var b = EM.canvas.makePoint(p.x, p.y);
      drag.b = b;
      EM.annotate.previewStroke(drag.kind === 'line' ? 'line' : drag.kind === 'circle' ? 'ellipse' : 'rect', drag.a, b);
    } else {
      setMarquee(drag.start.x, drag.start.y, p.x, p.y);
    }
  }

  function onUp(e) {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    if (!drag) return;

    var d = drag;
    drag = null;
    EM.annotate.clearPreview();

    var p = EM.canvas.toWorld(e.clientX, e.clientY);

    /* ---- 墨迹 ---- */
    if (d.kind === 'line' || d.kind === 'circle' || d.kind === 'rect') {
      var end = EM.canvas.makePoint(p.x, p.y);
      var dist = Math.hypot(p.x - d.start.x, p.y - d.start.y);
      if (!d.b || dist < 8) return;
      var type = d.kind === 'line' ? 'line' : d.kind === 'circle' ? 'ellipse' : 'rect';
      var label = d.kind === 'line' ? '划线' : d.kind === 'circle' ? '画圈' : '画方框';
      EM.history.push(label);
      var s = EM.annotate.addStroke(type, d.a, end);
      EM.persist.schedule();
      EM.annotate.setEditing(s.id);
      return;
    }

    /* ---- 选框 ---- */
    marquee.hidden = true;
    marquee.classList.remove('keep');
    var rect = {
      x: Math.min(d.start.x, p.x),
      y: Math.min(d.start.y, p.y),
      w: Math.abs(p.x - d.start.x),
      h: Math.abs(p.y - d.start.y)
    };

    if (d.kind === 'plot') {
      if (rect.w < 8 || rect.h < 8) { EM.plot.openDialog({ near: d.box }); return; }
      var pcap = EM.boxes.captureRange(d.box, rect);
      if (!pcap) { EM.plot.openDialog({ near: d.box }); return; }

      var picked = EM.plot.extractExpr(pcap.rich || pcap.text);
      if (picked) {
        /* 框里的式子认得出来：就在旁边生成一张函数板块 */
        var pspot = EM.boxes.sideAnchor(d.box, d.box.y + 30);
        EM.plot.create(picked, { spot: pspot });
        EM.toast('已按框选的式子画好：' + picked);
      } else {
        EM.plot.openDialog({
          expr: EM.plot.cleanExpr(pcap.rich || pcap.text),
          near: d.box,
          sourceText: pcap.text
        });
      }
      return;
    }

    if (rect.w < 6 || rect.h < 6) return;

    if (d.kind === 'keep') {
      addKeepRect(d.box, rect);
      return;
    }

    var cap = EM.boxes.captureRange(d.box, rect);
    if (!cap) { EM.toast('框里没有文字，试着把框拉过一两行'); return; }
    askFlow(d.box, cap);
  }

  /* ============================================================
   * 选框
   * ========================================================== */
  function setMarquee(x1, y1, x2, y2) {
    var a = EM.canvas.toScreen(x1, y1);
    var b = EM.canvas.toScreen(x2, y2);
    var r = stage.getBoundingClientRect();
    marquee.style.left = (a.x - r.left) + 'px';
    marquee.style.top = (a.y - r.top) + 'px';
    marquee.style.width = Math.abs(b.x - a.x) + 'px';
    marquee.style.height = Math.abs(b.y - a.y) + 'px';
  }

  /* 分框：悬停时显示切线 */
  function onHover(e) {
    if (tools.current !== 'split') { if (snapLine && !snapLine.hidden) hideSnap(); return; }
    var p = EM.canvas.toWorld(e.clientX, e.clientY);
    var b = EM.canvas.boxAt(p.x, p.y);
    if (!b) { hideSnap(); return; }
    var s = EM.canvas.toScreen(b.x, p.y);
    var r = stage.getBoundingClientRect();
    snapLine.hidden = false;
    snapLine.style.left = (s.x - r.left) + 'px';
    snapLine.style.top = (s.y - r.top) + 'px';
    snapLine.style.width = (b.w * EM.state.view.k) + 'px';
  }

  function hideSnap() {
    if (snapLine) snapLine.hidden = true;
  }

  /* ============================================================
   * 重点截取：先存多个框，点「确定」再裁
   * ========================================================== */
  function addKeepRect(box, rect) {
    var el = EM.boxes.getEl(box.id);
    if (!el) return;
    var boxRect = el.getBoundingClientRect();
    var v = EM.state.view;

    var f = {
      boxId: box.id,
      rx: (EM.canvas.toScreen(rect.x, rect.y).x - boxRect.left) / v.k,
      ry: (EM.canvas.toScreen(rect.x, rect.y).y - boxRect.top) / v.k,
      w: rect.w,
      h: rect.h
    };

    if (!keepRects.length) keepRects = [];
    keepRects.push(f);
    renderKeepRects();
    showKeepBar();
  }

  var keepRects = [];

  function renderKeepRects() {
    var layer = EM.canvas.framesLayer;
    layer.querySelectorAll('.keep-frame').forEach(function (n) { n.remove(); });
    keepRects.forEach(function (r, i) {
      var b = EM.state.box(r.boxId);
      if (!b) return;
      var el = U.el('div', 'keep-frame');
      el.style.left = (b.x + r.rx) + 'px';
      el.style.top = (b.y + r.ry) + 'px';
      el.style.width = r.w + 'px';
      el.style.height = r.h + 'px';
      el.innerHTML = '<span class="kf-no">' + (i + 1) + '</span>';
      layer.appendChild(el);
    });
  }

  function showKeepBar() {
    if (!keepBar) {
      keepBar = U.el('div', 'keep-bar');
      keepBar.innerHTML =
        '<span class="kb-text">已框选 <b id="kbCount">0</b> 处</span>' +
        '<button class="kb-ok">确定保留</button>' +
        '<button class="kb-cancel">取消</button>';
      stage.appendChild(keepBar);
      keepBar.querySelector('.kb-ok').addEventListener('click', applyKeep);
      keepBar.querySelector('.kb-cancel').addEventListener('click', clearKeep);
    }
    var c = document.getElementById('kbCount');
    if (c) c.textContent = String(keepRects.length);
    keepBar.classList.toggle('on', keepRects.length > 0);
  }

  function clearKeep() {
    keepRects = [];
    if (keepBar) { keepBar.remove(); keepBar = null; }
    EM.annotate.renderFrames();
    if (tools.current === 'keep') tools.set('move');
  }

  function applyKeep() {
    if (!keepRects.length) { clearKeep(); return; }

    // 同一张卡片的框合并成一个矩形列表
    var byBox = {};
    keepRects.forEach(function (r) {
      (byBox[r.boxId] = byBox[r.boxId] || []).push(r);
    });

    EM.history.push('重点截取');

    var okCount = 0;
    Object.keys(byBox).forEach(function (bid) {
      var box = EM.state.box(bid);
      if (!box) return;
      var ok = EM.boxes.keepRegions(box, byBox[bid]);
      if (ok) okCount++;
    });

    var n = keepRects.length;
    keepRects = [];
    if (keepBar) { keepBar.remove(); keepBar = null; }
    EM.annotate.renderFrames();
    tools.set('move');

    if (okCount) {
      EM.toast('已保留 ' + n + ' 处框选的内容', { action: { label: '撤回', fn: function () { EM.history.undo(); } } });
    } else {
      EM.toast('框里没有选中内容');
    }
  }

  EM.tools.applyKeep = applyKeep;
  EM.tools.keepRects = function () { return keepRects; };

  /* ============================================================
   * 框选提问
   * ========================================================== */
  function askFlow(box, cap) {
    closePop();

    var f = EM.annotate.addFrame({
      boxId: cap.frame.boxId,
      rx: cap.frame.rx,
      ry: cap.frame.ry,
      w: cap.frame.w,
      h: cap.frame.h,
      text: cap.text,
      off: cap.off,
      len: cap.len
    });

    var p1 = EM.canvas.toScreen(box.x + f.rx, box.y + f.ry);
    var p2 = EM.canvas.toScreen(box.x + f.rx + f.w, box.y + f.ry + f.h);
    var sr = stage.getBoundingClientRect();

    pop = U.el('div', 'ask-pop');
    pop.innerHTML =
      '<div class="ask-quote">' + U.esc(U.truncate(cap.text, 90)) + '</div>' +
      '<div class="ask-row">' +
      '<input class="ask-input" type="text" placeholder="针对这段，问点什么…" spellcheck="false">' +
      '<button class="ask-go" title="提问（Enter）">问</button>' +
      '<button class="ask-x" title="取消（Esc）">×</button>' +
      '</div>';

    stage.appendChild(pop);

    var w = 360;
    var left = U.clamp(p2.x - sr.left + 18, 8, stage.clientWidth - w - 12);
    var top = U.clamp(p1.y - sr.top - 4, 8, stage.clientHeight - 130);
    pop.style.left = left + 'px';
    pop.style.top = top + 'px';
    pop.style.width = w + 'px';

    var input = pop.querySelector('.ask-input');
    input.focus();

    pop.querySelector('.ask-go').addEventListener('click', submit);
    pop.querySelector('.ask-x').addEventListener('click', function () { cancel(); });
    input.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); submit(); }
      if (e.key === 'Escape') { e.preventDefault(); cancel(); }
    });

    function submit() {
      var q = input.value.trim() || '请解释这一段的意思和它在全文里的作用。';
      closePop();
      EM.history.push('框选提问');
      f.question = q;
      EM.ai.askOnSelection(box, cap.text, q, f);
    }

    function cancel() {
      closePop();
      EM.state.frames = EM.state.frames.filter(function (x) { return x.id !== f.id; });
      EM.annotate.renderFrames();
    }
  }

  function closePop() {
    if (pop && pop.parentNode) pop.parentNode.removeChild(pop);
    pop = null;
  }

  /* ============================================================
   * 键盘
   * ========================================================== */
  EM.tools.bindKeys = function () {
    EM.keys = EM.keys || {};

    document.addEventListener('keydown', function (e) {
      var editing = e.target.closest && e.target.closest('[contenteditable="true"], input, textarea, select');

      if (e.key === ' ' && !editing) EM.keys.space = true;

      var mod = e.ctrlKey || e.metaKey;

      if (mod && e.key.toLowerCase() === 'z') {
        if (editing) return;
        e.preventDefault();
        if (e.shiftKey) EM.history.redo(); else EM.history.undo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'y') {
        if (editing) return;
        e.preventDefault();
        EM.history.redo();
        return;
      }
      if (mod && e.key.toLowerCase() === 'e') {
        e.preventDefault();
        EM.exporter.exportPNG();
        return;
      }
      if (mod && e.key === ',') {
        e.preventDefault();
        EM.app.openDrawer();
        return;
      }

      if (editing) return;
      if (mod || e.altKey) return;

      var k = e.key.toLowerCase();
      var map = EM.shortcuts ? EM.shortcuts.get() : TOOL_KEYS;

      /* 工具切换 */
      var hitTool = null;
      Object.keys(map).forEach(function (t) { if (map[t] === k) hitTool = t; });
      if (hitTool) { e.preventDefault(); tools.set(hitTool); return; }

      if (k === (map.fit || 'f')) { e.preventDefault(); EM.canvas.fit(); return; }
      if (k === (map.plot || 'p')) { e.preventDefault(); EM.plot.openDialog(); return; }

      if (e.key === 'Delete' || e.key === 'Backspace') {
        var sid = EM.annotate.selectedStroke();
        if (sid) {
          e.preventDefault();
          EM.history.push('删除墨迹');
          EM.annotate.remove(sid);
        }
      }
    });

    document.addEventListener('keyup', function (e) {
      if (e.key === ' ') EM.keys.space = false;
    });
  };

})(typeof window !== 'undefined' ? window : globalThis);
