/* ============================================================
 * Branch · boxes.js
 * ③ 回答卡片：渲染、拖动、编辑、自动合并、分框、重点截取
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var U = EM.util;
  var BOX_W = 464;
  var GAP = 22;

  var els = {};          // id -> DOM
  var selectedId = null;

  var boxes = (EM.boxes = {
    BOX_W: BOX_W,
    GAP: GAP,
    els: els,

    /** 板块类型：回答 / 追问 / 图片 / 函数 —— 各用各的编号 */
    typeOf: function (b) {
      if (!b) return 'answer';
      if (b.kind === 'qa') return 'qa';
      if (b.kind === 'image') return 'image';
      if (b.kind === 'plot') return 'plot';
      return b.type || 'answer';
    },

    TYPE_NAME: { answer: '回答', qa: '追问', image: '图片', plot: '函数' },

    /** 编号显示：每类板块前面加个字，一眼能分清 */
    noLabel: function (b) {
      if (b.no == null || b.no === '') return '·';
      var s = String(b.no);
      if (!/^\d+$/.test(s)) return s;
      var g = EM.circled(Number(s));
      var t = boxes.typeOf(b);
      if (t === 'qa') return '问' + g;
      if (t === 'image') return '图' + g;
      if (t === 'plot') return '函' + g;
      return g;
    },

    /* ================= 渲染 ================= */
    renderAll: function () {
      var layer = EM.canvas.boxesLayer;
      layer.innerHTML = '';
      els = {};
      EM.boxes.els = els;
      EM.state.boxes.forEach(function (b) {
        var el = boxes.build(b);
        layer.appendChild(el);
        els[b.id] = el;
      });
      // 先量一遍高度
      requestAnimationFrame(function () { boxes.measureAll(); });
      EM.bus.emit('boxes:change');
    },

    measureAll: function () {
      EM.state.boxes.forEach(function (b) {
        var el = els[b.id];
        if (el) b.h = el.offsetHeight;
      });
      EM.canvas.syncFrame();
      EM.bus.emit('boxes:measured');
    },

    getEl: function (id) { return els[id] || null; },

    /* ================= 构建单个卡片 ================= */
    build: function (b) {
      var el = document.createElement('div');
      el.className = 'box kind-' + (b.kind || 'text');
      el.dataset.id = b.id;
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';
      el.style.width = b.w + 'px';
      if (selectedId === b.id) el.classList.add('sel');

      /* ---- 头部 ---- */
      var head = U.el('div', 'box-head');
      var plotExpr = (b.kind === 'plot') ? null : (EM.plot ? EM.plot.detect(U.truncate(b.html || '', 0) || EM.textOf(b.html)) : null);
      head.innerHTML =
        '<span class="box-no" title="' + U.esc(boxes.TYPE_NAME[boxes.typeOf(b)] + '板块') + '">' +
        U.esc(boxes.noLabel(b)) + '</span>' +
        '<div class="box-title" title="双击重命名">' + U.esc(b.title || '') + '</div>' +
        (b.tag ? '<span class="box-tag">' + U.esc(b.tag) + '</span>' : '') +
        '<div class="box-acts">' +
        (b.kind === 'qa'
          ? '<button class="box-act" data-act="regen" title="重新问一次"><svg viewBox="0 0 24 24"><path d="M20 12a8 8 0 11-2.4-5.7"/><path d="M20 4v4.5h-4.5"/></svg></button>'
          : '') +
        (b.kind === 'plot'
          ? '<button class="box-act" data-act="editplot" title="改解析式"><svg viewBox="0 0 24 24"><path d="M4 20l4-1 10-10-3-3L5 16z"/><path d="M14 6l3 3"/></svg></button>'
          : '') +
        (plotExpr
          ? '<button class="box-act" data-act="plot" title="把这里的函数式画出来"><svg viewBox="0 0 24 24"><path d="M3.5 20.5h17M3.5 20.5V3.5"/><path d="M5 17c2.6-6.4 4.4-9.4 6.2-9.4 1.9 0 2.2 3.4 3.4 5.6 1 1.9 1.9 2.9 3.4 2.9h3"/></svg></button>'
          : '') +
        '<button class="box-act" data-act="copy" title="把这张卡片的内容复制到剪贴板"><svg viewBox="0 0 24 24"><rect x="8.5" y="8.5" width="11" height="11" rx="2"/><path d="M15.5 5.5h-9a2 2 0 00-2 2v9"/></svg></button>' +
        '<button class="box-act" data-act="del" title="删除（Delete）"><svg viewBox="0 0 24 24"><path d="M5 7h14M9.5 7V5h5v2M7 7l.8 12h8.4L17 7"/></svg></button>' +
        '</div>';
      el.appendChild(head);
      if (plotExpr) el.dataset.plotExpr = plotExpr;

      /* ---- 提问框（仅 QA 卡） ---- */
      if (b.kind === 'qa') {
        var q = U.el('div', 'qa-question');
        q.textContent = b.qa || '';
        q.setAttribute('contenteditable', 'true');
        q.setAttribute('spellcheck', 'false');
        q.dataset.ph = '针对这段，问点什么…';
        el.appendChild(q);
      }

      /* ---- 正文 ---- */
      if (b.kind === 'plot') {
        var ph = U.el('div', 'plot-body');
        el.appendChild(ph);
        setTimeout(function () { if (EM.plot) EM.plot.render(b, ph); }, 0);
      } else if (b.kind === 'image') {
        var iw = U.el('div', 'img-body');
        iw.innerHTML = '<img src="' + (b.img || '') + '" alt="" draggable="false">';
        el.appendChild(iw);
        var im = iw.querySelector('img');
        if (im) {
          im.setAttribute('draggable', 'false');
          im.addEventListener('dragstart', function (e) { e.preventDefault(); });
        }
        if (im) {
          im.addEventListener('load', function () {
            b.h = el.offsetHeight;
            EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 240, pulse: false });
          });
        }
      } else {
        var body = U.el('div', 'box-body');
        body.setAttribute('contenteditable', 'true');
        body.setAttribute('spellcheck', 'false');
        body.innerHTML = b.html || '';
        el.appendChild(body);
      }

      /* ---- 宽度把手 ---- */
      var rz = U.el('div', 'box-resize');
      el.appendChild(rz);

      attach(el, b);
      return el;
    },

    /* 局部刷新（正文/标题变化后） */
    refresh: function (id) {
      var b = EM.state.box(id), el = els[id];
      if (!b || !el) return;
      var body = el.querySelector('.box-body');
      if (body && document.activeElement !== body) body.innerHTML = b.html || '';
      var title = el.querySelector('.box-title');
      if (title && document.activeElement !== title) title.textContent = b.title || '';
      var q = el.querySelector('.qa-question');
      if (q && document.activeElement !== q) q.textContent = b.qa || '';
      b.h = el.offsetHeight;
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';
      el.style.width = b.w + 'px';
    },

    /* ================= 增删 ================= */
    create: function (opts) {
      var kind = opts.kind || 'text';
      var type = opts.type || (kind === 'qa' ? 'qa' : kind === 'image' ? 'image' : kind === 'plot' ? 'plot' : 'answer');
      var no = opts.no;
      if (no == null) {
        if (type === 'qa') no = ++EM.state.qaSeq;
        else if (type === 'image') no = ++EM.state.imgSeq;
        else if (type === 'plot') no = ++EM.state.plotSeq;
        else no = ++EM.state.seq;
      }
      var b = {
        id: U.uid('b'),
        kind: kind,
        type: type,
        x: Math.round(opts.x || 0),
        y: Math.round(opts.y || 0),
        w: opts.w || BOX_W,
        h: opts.h || 120,
        no: no,
        title: opts.title || '',
        tag: opts.tag || '',
        html: opts.html || '',
        raw: opts.raw || '',
        qa: opts.qa || '',
        plot: opts.plot || null,
        img: opts.img || null,
        frameId: opts.frameId || null
      };
      EM.state.boxes.push(b);
      var el = boxes.build(b);
      EM.canvas.boxesLayer.appendChild(el);
      els[b.id] = el;

      // 同步量一次高度，方便调用方接着往下排
      b.h = el.offsetHeight || opts.h || 120;

      requestAnimationFrame(function () {
        b.h = el.offsetHeight || b.h;
        EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 220 });
        EM.bus.emit('boxes:change');
      });
      return b;
    },

    remove: function (id, opts) {
      opts = opts || {};
      var i = EM.state.boxes.findIndex(function (b) { return b.id === id; });
      if (i < 0) return;
      var b = EM.state.boxes[i];

      if (opts.confirm !== false) { /* 由调用方确认 */ }

      EM.state.boxes.splice(i, 1);

      // 清掉挂在这张卡上的墨迹、选区框、连接线
      EM.state.strokes = EM.state.strokes.filter(function (s) {
        return !(s.a.bid === id || s.b.bid === id);
      });
      // 选区框：卡片本身被删，或者这张卡片就是那个选区引出的提问卡，都要一起消失
      var deadFrames = EM.state.frames.filter(function (f) {
        return f.boxId === id || f.qaBoxId === id;
      }).map(function (f) { return f.id; });
      EM.state.frames = EM.state.frames.filter(function (f) {
        return f.boxId !== id && f.qaBoxId !== id;
      });
      EM.state.links = EM.state.links.filter(function (l) {
        return l.boxId !== id && deadFrames.indexOf(l.frameId) < 0;
      });

      var el = els[id];
      if (el && el.parentNode) {
        el.style.transition = 'opacity .18s, transform .18s';
        el.style.opacity = '0';
        el.style.transform = 'scale(.96)';
        setTimeout(function () { if (el.parentNode) el.parentNode.removeChild(el); }, 180);
      }
      delete els[id];

      EM.annotate.renderAll();
      EM.bus.emit('boxes:change');
      EM.persist.schedule();
    },

    duplicate: function (id) {
      var src = EM.state.box(id);
      if (!src) return;
      EM.history.push('复制卡片');
      var spot = EM.canvas.freeSpot(src.w, src.h || 120, { x: src.x + src.w + 40, y: src.y });
      var b = boxes.create({
        kind: src.kind, x: spot.x, y: spot.y, w: src.w,
        title: src.title, tag: src.tag, html: src.html, raw: src.raw, qa: src.qa,
        plot: src.plot ? { expr: src.plot.expr, xmin: src.plot.xmin, xmax: src.plot.xmax, ymin: null, ymax: null } : null
      });
      EM.toast('已复制一张卡片');
      return b;
    },

    /* ================= 布局 ================= */
    /** 在已有内容的下方，给一串卡片找起始位置 */
    stackAnchor: function () {
      var maxY = 0;
      EM.state.boxes.forEach(function (b) {
        var bottom = b.y + (b.h || 120);
        if (b.x < 900) maxY = Math.max(maxY, bottom);
      });
      return { x: 80, y: maxY ? maxY + 30 : 56 };
    },

    /** 一批卡片的排版：一列太长就自动换到右边新起一列 */
    beginBatch: function (startY) {
      var a = boxes.stackAnchor();
      var y = startY != null ? startY : a.y;
      var x = 80;

      /* 空画布：第一张卡落在视野正中，而不是从左上角开始 */
      if (!EM.state.boxes.length) {
        var vp = document.getElementById('viewport') || document.getElementById('stage');
        if (vp && EM.canvas) {
          var r = vp.getBoundingClientRect();
          var c = EM.canvas.toWorld(r.left + r.width / 2, r.top + r.height / 2);
          x = Math.round(c.x - BOX_W / 2);
          y = Math.round(c.y - 70);
          startY = y;
        }
      }

      return { x: x, y: y, colTop: y, colH: 0, colW: BOX_W, maxH: 1020 };
    },

    /**
     * 把刚建好的卡片放进这一批的流里；返回它最终的位置
     * （先放当前列，放不下就整体挪到右边新列）
     */
    placeInBatch: function (cur, b) {
      var el = els[b.id];
      var h = (el && el.offsetHeight) || b.h || 120;
      if (cur.colH > 0 && cur.colH + h > cur.maxH) {
        cur.x += cur.colW + 90;
        cur.y = cur.colTop;
        cur.colH = 0;
        b.x = cur.x;
        b.y = cur.y;
        if (el) { el.style.left = b.x + 'px'; el.style.top = b.y + 'px'; }
      }
      cur.colH += h + GAP;
      cur.y = b.y + h + GAP;
      return { x: b.x, y: b.y };
    },

    /** 把右侧区域用起来（提问卡用） */
    sideAnchor: function (fromBox, nearY) {
      var right = fromBox ? fromBox.x + fromBox.w : 600;
      var spot = EM.canvas.freeSpot(BOX_W, 160, { x: right + 96, y: nearY != null ? Math.max(60, nearY - 30) : 60 });
      return spot;
    },

    /* ================= 合并 ================= */
    /**
     * 合并两张卡片。谁留在原位：上边的（竖着贴）或左边的（横着贴）。
     * 同类型 → 中间留一点空白；不同类型 → 中间一条虚线。
     */
    merge: function (idA, idB) {
      var A = EM.state.box(idA), B = EM.state.box(idB);
      if (!A || !B || A.id === B.id) return null;

      // 上/左 的那个留下
      var aFirst = (A.y < B.y - 4) || (Math.abs(A.y - B.y) <= 4 && A.x <= B.x);
      var keep = aFirst ? A : B;
      var gone = aFirst ? B : A;

      // 图片板块 / 函数板块的内容不在 html 里，合并会把内容弄丢，先不支持
      var tA = boxes.typeOf(A), tB = boxes.typeOf(B);
      if (tA === 'image' || tA === 'plot' || tB === 'image' || tB === 'plot') {
        EM.toast('图片板块和函数板块暂时不参与合并');
        return null;
      }

      var sameType = tA === tB;
      var sep = sameType ? '<div class="seam-gap"></div>' : '<hr class="seam">';

      // 合并前先量一下留下来的那张卡的正文有多长（选区框的偏移要按这个平移）
      var keepEl0 = els[keep.id];
      var keepBody0 = keepEl0 && keepEl0.querySelector('.box-body');
      var keepLen = keepBody0 ? keepBody0.textContent.length : 0;

      // 追问卡被并进别的类型时，把问题也一起带过去
      var goneHtml = gone.html || '';
      if (gone.kind === 'qa' && keep.kind !== 'qa' && gone.qa) {
        goneHtml = '<p class="merged-q"><b>问：</b>' + U.esc(gone.qa) + '</p>' + goneHtml;
      }

      keep.html = (keep.html || '') + sep + goneHtml;
      if (gone.qa && keep.kind === 'qa') keep.qa = (keep.qa || '') + '\n' + gone.qa;

      var dy = gone.y - keep.y, dx = gone.x - keep.x;

      // 墨迹重新挂到保留的那张上
      EM.state.strokes.forEach(function (s) {
        if (s.a.bid === gone.id) { s.a.bid = keep.id; s.a.rx += dx; s.a.ry += dy; }
        if (s.b.bid === gone.id) { s.b.bid = keep.id; s.b.rx += dx; s.b.ry += dy; }
      });
      // 选区框：挂在被并掉那张上的，转挂到留下的那张（偏移跟着内容后移）
      var movedFrames = [];
      EM.state.frames.forEach(function (f) {
        if (f.boxId === gone.id) {
          // 老版本留下的框没有字符偏移：先在被并掉的那张卡里补算出来
          if (f.off == null && f.text) {
            var gEl = els[gone.id];
            var gBody = gEl && gEl.querySelector('.box-body');
            if (gBody) {
              var gr = findRangeByText(gBody, f.text);
              if (gr) {
                f.off = offsetOfRange(gBody, gr);
                f.len = gr.toString().length;
              }
            }
          }

          f.boxId = keep.id;
          if (f.off != null) f.off += keepLen;
          f.rx += dx; f.ry += dy;
          movedFrames.push(f);
        }
      });

      // 追问卡被并掉后，它那条引用连线就没有意义了：删线、框留着
      var qaIds = [];
      if (A.kind === 'qa') qaIds.push(A.id);
      if (B.kind === 'qa') qaIds.push(B.id);

      EM.state.links = EM.state.links.filter(function (l) {
        if (l.boxId === gone.id) return false;
        var f = EM.state.frame(l.frameId);
        if (f && qaIds.indexOf(f.qaBoxId) >= 0) return false;
        return true;
      });
      EM.state.frames.forEach(function (f) {
        if (qaIds.indexOf(f.qaBoxId) >= 0) f.qaBoxId = null;
      });

      EM.state.boxes = EM.state.boxes.filter(function (b) { return b.id !== gone.id; });
      var gel = els[gone.id];
      if (gel && gel.parentNode) gel.parentNode.removeChild(gel);
      delete els[gone.id];

      boxes.refresh(keep.id);
      requestAnimationFrame(function () {
        keep.h = els[keep.id] ? els[keep.id].offsetHeight : keep.h;
        // 内容合并后位置变了，按文字把框重新量一遍
        reanchorFrames(movedFrames);
        EM.canvas.expandTo({ x: keep.x, y: keep.y, w: keep.w, h: keep.h }, { pad: 220 });
        EM.annotate.renderAll();
        EM.bus.emit('boxes:change');

        // 版面稳定后再量一次，避免差几个像素
        setTimeout(function () {
          if (!movedFrames.length) return;
          reanchorFrames(movedFrames);
          EM.annotate.renderFrames();
        }, 90);
      });
      return keep;
    },

    /** 拖动时找可合并的目标（上下、左右都行） */
    mergeTargetFor: function (b) {
      var best = null, bestD = 1e9;
      var bh = b.h || 120;

      EM.state.boxes.forEach(function (o) {
        if (o.id === b.id) return;
        var oh = o.h || 120;

        var overlapX = Math.min(b.x + b.w, o.x + o.w) - Math.max(b.x, o.x);
        var overlapY = Math.min(b.y + bh, o.y + oh) - Math.max(b.y, o.y);

        // 上下相邻
        if (overlapX >= Math.min(120, b.w * 0.35)) {
          var below = Math.abs((o.y + oh) - b.y);
          var above = Math.abs((b.y + bh) - o.y);
          if (below <= 14 && below < bestD) { best = { id: o.id, axis: 'y', edge: 'top', snap: o.y + oh, d: below }; bestD = below; }
          if (above <= 14 && above < bestD) { best = { id: o.id, axis: 'y', edge: 'bottom', snap: o.y - bh, d: above }; bestD = above; }
        }

        // 左右相邻
        if (overlapY >= Math.min(90, Math.min(bh, oh) * 0.45)) {
          var right = Math.abs((o.x + o.w) - b.x);
          var left = Math.abs((b.x + b.w) - o.x);
          if (right <= 14 && right < bestD) { best = { id: o.id, axis: 'x', edge: 'left', snap: o.x + o.w, d: right }; bestD = right; }
          if (left <= 14 && left < bestD) { best = { id: o.id, axis: 'x', edge: 'right', snap: o.x - b.w, d: left }; bestD = left; }
        }
      });
      return best;
    },
    /* ================= 分框 ================= */
    splitAt: function (b, wx, wy) {
      var el = els[b.id];
      if (!el) return false;
      var body = el.querySelector('.box-body');
      if (!body) return false;

      var sp = EM.canvas.toScreen(wx, wy);
      var caret = caretFromPoint(sp.x, sp.y, body);
      if (!caret) { EM.toast('把指针放到正文中间再切'); return false; }

      var whole = document.createRange();
      whole.selectNodeContents(body);

      var r1 = document.createRange();
      r1.setStart(whole.startContainer, whole.startOffset);
      try { r1.setEnd(caret.startContainer, caret.startOffset); } catch (e) { return false; }

      var r2 = document.createRange();
      r2.setStart(caret.startContainer, caret.startOffset);
      r2.setEnd(whole.endContainer, whole.endOffset);

      var f1 = r1.cloneContents(), f2 = r2.cloneContents();
      var t1 = fragText(f1), t2 = fragText(f2);
      if (!t1.trim() || !t2.trim()) { EM.toast('这个位置切不开，换一行试试'); return false; }

      var d1 = document.createElement('div'); d1.appendChild(f1);
      var d2 = document.createElement('div'); d2.appendChild(f2);

      EM.history.push('分框');

      b.html = wrapInline(EM.md.clean(d1.innerHTML));
      b.raw = EM.textOf(b.html);
      boxes.refresh(b.id);
      b.h = els[b.id] ? els[b.id].offsetHeight : b.h;

      // 下半张紧贴在它下面
      var nb = boxes.create({
        kind: b.kind === 'qa' ? 'text' : b.kind,
        x: b.x,
        y: b.y + b.h + 16,
        w: b.w,
        title: b.title,
        tag: b.tag,
        html: wrapInline(EM.md.clean(d2.innerHTML))
      });
      nb.h = els[nb.id] ? els[nb.id].offsetHeight : 120;

      // 墨迹：原本挂在这张卡上、且位于切点下方的，挪到新卡
      var offset = nb.y - b.y;
      EM.state.strokes.forEach(function (s) {
        if (s.a.bid === b.id && s.a.ry > offset) { s.a.bid = nb.id; s.a.ry -= offset; }
        if (s.b.bid === b.id && s.b.ry > offset) { s.b.bid = nb.id; s.b.ry -= offset; }
      });

      // 后面的框如果会撞上，依次往下推
      shiftBelow(nb);
      EM.annotate.updateLinks();
      EM.canvas.expandTo({ x: nb.x, y: nb.y, w: nb.w, h: nb.h }, { pad: 240, pulse: false });
      EM.persist.schedule();
      EM.bus.emit('boxes:change');

      EM.toast('已切成上下两张');
      return true;
    },

    /* ================= 重点截取 ================= */
    keepOnly: function (b, rect) {
      var el = els[b.id];
      if (!el) return false;
      var body = el.querySelector('.box-body');
      var range = rangeBetween(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h, body);
      if (!range) { EM.toast('在这个框里没找到文字'); return false; }

      var frag = range.cloneContents();
      var txt = fragText(frag);
      if (!txt.trim()) { EM.toast('框里没有选中任何内容'); return false; }

      var d = document.createElement('div'); d.appendChild(frag);

      EM.history.push('重点截取');
      b.html = wrapInline(EM.md.clean(d.innerHTML));
      b.raw = EM.textOf(b.html);
      boxes.refresh(b.id);
      b.h = els[b.id] ? els[b.id].offsetHeight : b.h;
      EM.annotate.updateLinks();
      EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 220, pulse: false });
      EM.persist.schedule();
      EM.toast('已只保留框选的内容', { action: { label: '撤回', fn: function () { EM.history.undo(); } } });
      return true;
    },

    /* ================= 重点截取（多段） ================= */
    /** 保留若干矩形里的内容，其余删掉（按字精确取，不多留整句） */
    keepRegions: function (b, rects) {
      var el = els[b.id];
      if (!el) return false;
      var body = el.querySelector('.box-body');
      if (!body || !rects || !rects.length) return false;

      var merged = mergeRects(rects);
      var out = document.createElement('div');
      var kept = 0;

      merged.forEach(function (r) {
        var p1 = EM.canvas.toScreen(b.x + r.rx, b.y + r.ry);
        var p2 = EM.canvas.toScreen(b.x + r.rx + r.w, b.y + r.ry + r.h);
        var clientRect = {
          x: Math.min(p1.x, p2.x),
          y: Math.min(p1.y, p2.y),
          w: Math.abs(p2.x - p1.x),
          h: Math.abs(p2.y - p1.y)
        };

        var range = rangeByRect(clientRect, body) ||
          rangeBetween(b.x + r.rx, b.y + r.ry, b.x + r.rx + r.w, b.y + r.ry + r.h, body);
        if (!range) return;
        var frag = range.cloneContents();
        if (!fragText(frag).trim()) return;
        out.appendChild(frag);
        kept++;
      });

      if (!kept) return false;

      b.html = wrapInline(EM.md.clean(out.innerHTML));
      b.raw = EM.textOf(b.html);
      boxes.refresh(b.id);
      b.h = els[b.id] ? els[b.id].offsetHeight : b.h;
      EM.annotate.updateLinks();
      EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 220, pulse: false });
      EM.persist.schedule();
      return true;
    },

    /* ================= 选区（框选提问） ================= */
    /** 在卡片里取出一段文字的范围与位置 */
    captureRange: function (b, rect) {
      var el = els[b.id];
      if (!el) return null;
      var body = el.querySelector('.box-body');
      var range = rangeBetween(rect.x, rect.y, rect.x + rect.w, rect.y + rect.h, body);
      if (!range) return null;

      var txt = range.toString().replace(/\s+/g, ' ').trim();
      if (!txt) return null;

      // 选区的真实包围盒（相对卡片）
      var boxRect = el.getBoundingClientRect();
      var rects = range.getClientRects();
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (!r.width || !r.height) continue;
        minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
      }
      if (minX === 1e9) return null;

      var v = EM.state.view;
      return {
        text: txt,
        rich: richTextOfRange(range),
        off: offsetOfRange(body, range),
        len: range.toString().length,
        frame: {
          boxId: b.id,
          rx: (minX - boxRect.left) / v.k,
          ry: (minY - boxRect.top) / v.k,
          w: (maxX - minX) / v.k,
          h: (maxY - minY) / v.k
        }
      };
    },

    /* ================= 选择 ================= */
    select: function (id) {
      selectedId = id;
      Object.keys(els).forEach(function (k) {
        els[k].classList.toggle('sel', k === id);
      });
      EM.bus.emit('boxes:select', id);
    },

    byId: function (id) { return EM.state.box(id); },

    /** 卡片正文纯文本（给 AI 当上下文） */
    textOf: function (b) {
      return (b.title ? b.title + '\n' : '') + (b.qa ? '问题：' + b.qa + '\n' : '') + EM.textOf(b.html);
    }
  });

  /* ============================================================
   * 交互绑定
   * ========================================================== */
  function attach(el, b) {
    var head = el.querySelector('.box-head');
    var body = el.querySelector('.box-body');
    var title = el.querySelector('.box-title');
    var q = el.querySelector('.qa-question');

    /* ---------- 标题：双击重命名 ---------- */
    title.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      title.setAttribute('contenteditable', 'true');
      title.focus();
      document.execCommand && document.execCommand('selectAll', false, null);
    });
    title.addEventListener('blur', function () {
      title.removeAttribute('contenteditable');
      var v = title.textContent.trim();
      if (v !== b.title) {
        EM.history.push('改标题');
        b.title = v;
        EM.persist.schedule();
      }
    });
    title.addEventListener('keydown', function (e) {
      if (e.key === 'Enter') { e.preventDefault(); title.blur(); }
    });

    /* ---------- 正文编辑 ---------- */
    if (body) {
      body.addEventListener('focus', function () {
        if (!body.dataset.hist) {
          EM.history.push('编辑文字');
          body.dataset.hist = '1';
        }
      });
      body.addEventListener('blur', function () {
        body.dataset.hist = '';
        b.h = el.offsetHeight;
        EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 220, pulse: false });
        EM.persist.schedule();
      });

      var onEdit = U.debounce(function () {
        b.html = EM.md.clean(body.innerHTML);
        b.raw = EM.textOf(b.html);
        b.h = el.offsetHeight;
        EM.annotate.updateLinks();
        EM.bus.emit('boxes:edit', b);
        EM.persist.schedule();
      }, 260);
      body.addEventListener('input', onEdit);
    }

    /* ---------- 提问文字 ---------- */
    if (q) {
      q.addEventListener('blur', function () {
        var v = q.textContent.trim();
        if (v !== b.qa) { EM.history.push('改提问'); b.qa = v; EM.persist.schedule(); }
      });
      q.addEventListener('input', U.debounce(function () {
        b.qa = q.textContent.trim();
        EM.persist.schedule();
      }, 300));
      q.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); q.blur(); }
      });
    }

    /* ---------- 卡片按钮 ---------- */
    el.querySelector('.box-acts').addEventListener('pointerdown', function (e) {
      e.stopPropagation();
    });
    el.querySelector('.box-acts').addEventListener('click', function (e) {
      var btn = e.target.closest('.box-act');
      if (!btn) return;
      e.stopPropagation();
      var act = btn.dataset.act;
      if (act === 'del') {
        EM.history.push('删除卡片');
        boxes.remove(b.id);
        EM.toast('已删除一张卡片', { action: { label: '撤回', fn: function () { EM.history.undo(); } } });
      } else if (act === 'copy') {
        if (EM.app && EM.app.copyText) {
          EM.app.copyText(EM.boxes.textOf(b), '这张卡片的内容已复制');
        }
      } else if (act === 'dup') {
        boxes.duplicate(b.id);
      } else if (act === 'regen') {
        EM.bus.emit('box:regen', b);
      } else if (act === 'editplot') {
        EM.plot.openDialog({ box: b });
      } else if (act === 'plot') {
        var expr = el.dataset.plotExpr;
        if (expr) {
          EM.history.push('画函数图');
          EM.plot.create(expr, {
            at: { x: b.x + b.w + 70, y: b.y },
            title: '函数图 · y=' + expr
          });
        }
      }
    });

    /* ---------- 函数图：拖动平移、滚轮缩放 ---------- */
    if (b.kind === 'plot') {
      attachPlotInteractions(el, b);
    }

    /* ---------- 拖动 ---------- */
    head.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      if (e.target.closest('.box-act')) return;
      if (title.getAttribute('contenteditable') === 'true') return;
      startDrag(e, el, b);
    });

    /* ---------- 宽度调整 ---------- */
    var rz = el.querySelector('.box-resize');
    rz.addEventListener('pointerdown', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var startX = e.clientX, startW = b.w;
      var k = EM.state.view.k;
      EM.history.push('调整宽度');
      rz.setPointerCapture(e.pointerId);

      function move(ev) {
        b.w = U.clamp(startW + (ev.clientX - startX) / k, 280, 920);
        el.style.width = b.w + 'px';
        b.h = el.offsetHeight;
        EM.annotate.updateLinks();
      }
      function up() {
        rz.removeEventListener('pointermove', move);
        rz.removeEventListener('pointerup', up);
        EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 220 });
        EM.persist.schedule();
      }
      rz.addEventListener('pointermove', move);
      rz.addEventListener('pointerup', up);
    });

    /* ---------- 单击选中 ---------- */
    el.addEventListener('pointerdown', function (e) {
      if (e.target.closest('.box-act')) return;
      boxes.select(b.id);
    });
  }

  /* ============================================================
   * 函数图卡片：在图里拖动平移、滚轮缩放
   * ========================================================== */
  function attachPlotInteractions(el, b) {
    var host = el.querySelector('.plot-body');
    if (!host) return;

    host.addEventListener('pointerdown', function (e) {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.preventDefault();
      var svg = host.querySelector('svg');
      if (!svg || !b.plot) return;

      var is3d = b.plot.mode === '3d';
      var rect = svg.getBoundingClientRect();
      var sx = e.clientX, sy = e.clientY;
      var p0 = {
        xmin: b.plot.xmin, xmax: b.plot.xmax,
        ymin: b.plot.ymin, ymax: b.plot.ymax,
        yaw: b.plot.yaw, pitch: b.plot.pitch
      };
      var moved = false;

      function move(ev) {
        var dx = (ev.clientX - sx) / rect.width;
        var dy = (ev.clientY - sy) / rect.height;
        if (Math.abs(dx) > 0.004 || Math.abs(dy) > 0.004) {
          if (!moved) { EM.history.push(is3d ? '旋转曲面' : '平移函数图'); moved = true; }
        }

        if (is3d) {
          /* 三维：拖动 = 转视角 */
          b.plot.yaw = p0.yaw + dx * Math.PI * 2.2;
          b.plot.pitch = Math.max(-1.45, Math.min(1.45, p0.pitch + dy * Math.PI * 1.4));
        } else {
          var rx = (p0.xmax - p0.xmin) * dx;
          var ry = (p0.ymax - p0.ymin) * dy;
          b.plot.xmin = p0.xmin - rx;
          b.plot.xmax = p0.xmax - rx;
          b.plot.ymin = p0.ymin + ry;
          b.plot.ymax = p0.ymax + ry;
        }
        EM.plot.render(b, host);
      }
      function up() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        if (moved) EM.persist.schedule();
      }
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
    });

    host.addEventListener('wheel', function (e) {
      if (!b.plot) return;
      e.preventDefault();
      e.stopPropagation();
      var svg = host.querySelector('svg');
      if (!svg) return;

      if (b.plot.mode === '3d') {
        var z = b.plot.zoom || 1;
        b.plot.zoom = Math.max(0.4, Math.min(2.6, z * (e.deltaY < 0 ? 1.08 : 1 / 1.08)));
        EM.plot.render(b, host);
        EM.persist.schedule();
        return;
      }

      var rect = svg.getBoundingClientRect();
      var fx = (e.clientX - rect.left) / rect.width;
      var fy = (e.clientY - rect.top) / rect.height;
      // 图表绘图区在 viewBox 里的位置
      var padL = 34 / 428, padR = 14 / 428, padT = 12 / 250, padB = 24 / 250;
      var ix = Math.min(1, Math.max(0, (fx - padL) / (1 - padL - padR)));
      var iy = Math.min(1, Math.max(0, (fy - padT) / (1 - padT - padB)));

      var k = e.deltaY < 0 ? 0.88 : 1 / 0.88;
      var ax = b.plot.xmin + (b.plot.xmax - b.plot.xmin) * ix;
      var ay = b.plot.ymax - (b.plot.ymax - b.plot.ymin) * iy;

      b.plot.xmin = ax + (b.plot.xmin - ax) * k;
      b.plot.xmax = ax + (b.plot.xmax - ax) * k;
      b.plot.ymin = ay + (b.plot.ymin - ay) * k;
      b.plot.ymax = ay + (b.plot.ymax - ay) * k;
      EM.plot.render(b, host);
      EM.persist.schedule();
    }, { passive: false });

    host.addEventListener('dblclick', function (e) {
      e.stopPropagation();
      if (!b.plot) return;
      if (b.plot.mode === '3d') {
        b.plot.yaw = -0.62;
        b.plot.pitch = 0.62;
        b.plot.zoom = 1;
      } else {
        b.plot.ymin = null;
        b.plot.ymax = null;
        b.plot.xmin = -6;
        b.plot.xmax = 6;
      }
      EM.plot.render(b, host);
    });
  }

  /** 合并后：按字符偏移（其次按文字）重新量选区框的位置 */
  function reanchorFrames(frames) {
    var k = EM.state.view.k;
    (frames || EM.state.frames).forEach(function (f) {
      var el = els[f.boxId];
      if (!el) return;
      var body = el.querySelector('.box-body');
      if (!body) return;

      var range = null;

      /* 优先用字符偏移：同一句话在文里出现两次也不会认错 */
      if (f.off != null && f.len != null) {
        range = rangeAtOffsets(body, f.off, f.off + f.len);
        if (range) {
          // 偏移对不上（内容被改过）就退回按文字找
          var got = range.toString().replace(/\s+/g, ' ').trim();
          var want = String(f.text || '').replace(/\s+/g, ' ').trim();
          if (want && got !== want) range = null;
        }
      }
      if (!range && f.text) range = findRangeByText(body, f.text);
      if (!range) return;

      var boxRect = el.getBoundingClientRect();
      var rects = range.getClientRects();
      var minX = 1e9, minY = 1e9, maxX = -1e9, maxY = -1e9;
      for (var i = 0; i < rects.length; i++) {
        var r = rects[i];
        if (!r.width || !r.height) continue;
        minX = Math.min(minX, r.left); minY = Math.min(minY, r.top);
        maxX = Math.max(maxX, r.right); maxY = Math.max(maxY, r.bottom);
      }
      if (minX === 1e9) return;

      f.rx = (minX - boxRect.left) / k;
      f.ry = (minY - boxRect.top) / k;
      f.w = (maxX - minX) / k;
      f.h = (maxY - minY) / k;
    });
  }

  /** 选区起点在卡片正文里的字符偏移 */
  function offsetOfRange(root, range) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var idx = 0, n;
    while ((n = walker.nextNode())) {
      if (n === range.startContainer) return idx + range.startOffset;
      idx += n.nodeValue.length;
    }
    return null;
  }

  /** 按字符区间在正文里取 Range */
  function rangeAtOffsets(root, start, end) {
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var idx = 0, sn = null, so = 0, en = null, eo = 0, n;
    while ((n = walker.nextNode())) {
      var len = n.nodeValue.length;
      if (sn === null && start <= idx + len) { sn = n; so = Math.max(0, start - idx); }
      if (en === null && end <= idx + len) { en = n; eo = Math.max(0, end - idx); }
      idx += len;
      if (sn && en) break;
    }
    if (!sn || !en) return null;
    var range = document.createRange();
    try {
      range.setStart(sn, Math.min(so, sn.nodeValue.length));
      range.setEnd(en, Math.min(eo, en.nodeValue.length));
    } catch (e) { return null; }
    return range;
  }

  /** 在一段富文本里找到某段文字对应的 Range */
  function findRangeByText(root, text) {
    var needle = String(text).replace(/\s+/g, ' ').trim();
    if (!needle) return null;

    var chars = [], nodes = [], offsets = [];
    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    var n;
    while ((n = walker.nextNode())) {
      var t = n.nodeValue;
      for (var i = 0; i < t.length; i++) {
        chars.push(t[i]);
        nodes.push(n);
        offsets.push(i);
      }
    }
    var idx = chars.join('').indexOf(needle);
    if (idx < 0) return null;

    var range = document.createRange();
    try {
      range.setStart(nodes[idx], offsets[idx]);
      range.setEnd(nodes[idx + needle.length - 1], offsets[idx + needle.length - 1] + 1);
    } catch (e) { return null; }
    return range;
  }

  EM.boxes.reanchorFrames = reanchorFrames;
  EM.boxes.findRangeByText = findRangeByText;

  /* ============================================================
   * 拖动
   * ========================================================== */
  var hintEl = null;

  function startDrag(e, el, b) {
    if (e.isPrimary === false) return;      /* 第二根手指别拖卡片 */
    e.preventDefault();
    e.stopPropagation();
    if (el.querySelector('.box-title').getAttribute('contenteditable') === 'true') return;

    boxes.select(b.id);
    el.classList.add('dragging');

    var k = EM.state.view.k;
    var sx = e.clientX, sy = e.clientY;
    var ox = b.x, oy = b.y;
    var target = null;
    var lastClient = { x: e.clientX, y: e.clientY };
    var rafId = 0;
    var pushed = false;

    function ensureHint() {
      if (hintEl) return hintEl;
      hintEl = document.createElement('div');
      hintEl.className = 'merge-hint';
      return hintEl;
    }

    function clearHint() {
      document.querySelectorAll('.merge-hint.on').forEach(function (n) {
        n.classList.remove('on');
        if (n.parentNode) n.parentNode.removeChild(n);
      });
      document.querySelectorAll('.box.merge-target').forEach(function (n) { n.classList.remove('merge-target'); });
    }

    function move(ev) {
      var dx = (ev.clientX - sx) / k;
      var dy = (ev.clientY - sy) / k;

      if (!pushed && Math.abs(dx) + Math.abs(dy) > 3) {
        EM.history.push('移动卡片');
        pushed = true;
      }

      lastClient = { x: ev.clientX, y: ev.clientY };
      b.x = Math.max(24, Math.round(ox + dx));
      b.y = Math.max(24, Math.round(oy + dy));
      el.style.left = b.x + 'px';
      el.style.top = b.y + 'px';

      // 合并吸附
      target = boxes.mergeTargetFor(b);
      clearHint();
      if (target) {
        if (target.axis === 'x') b.x = target.snap;
        else b.y = target.snap;
        el.style.left = b.x + 'px';
        el.style.top = b.y + 'px';

        var tel = els[target.id];
        var tb = EM.state.box(target.id);
        if (tel && tb) {
          tel.classList.add('merge-target');
          var h = ensureHint();
          if (target.axis === 'x') {
            h.classList.add('vertical');
            h.style.top = '0px';
            h.style.left = (target.edge === 'left' ? -2 : tb.w - 2) + 'px';
            h.style.width = '0px';
            h.style.height = (tb.h || 120) + 'px';
          } else {
            h.classList.remove('vertical');
            h.style.left = '0px';
            h.style.top = (target.edge === 'top' ? -2 : (tb.h || 120) - 2) + 'px';
            h.style.width = tb.w + 'px';
            h.style.height = '0px';
          }
          h.classList.add('on');
          tel.appendChild(h);
        }
      }

      EM.annotate.updateLinks();
      EM.annotate.redrawForBox(b.id);
      EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h || 120 }, { pad: 260 });

      if (!rafId) {
        rafId = requestAnimationFrame(function () {
          rafId = 0;
          EM.canvas.autoPan(lastClient.x, lastClient.y);
          EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h || 120 }, { pad: 260, pulse: false });
        });
      }
    }

    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      el.classList.remove('dragging');
      clearHint();
      if (rafId) cancelAnimationFrame(rafId);

      if (target) {
        var merged = boxes.merge(target.id, b.id);
        if (merged) { EM.toast('两个板块已合并', { action: { label: '撤回', fn: function () { EM.history.undo(); } } }); }
      }

      EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h || 120 }, { pad: 260 });
      EM.annotate.updateLinks();
      EM.bus.emit('boxes:change');
      EM.persist.schedule();
    }

    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  /* ============================================================
   * 文字范围工具
   * ========================================================== */
  function fragText(frag) {
    var d = document.createElement('div');
    d.appendChild(frag.cloneNode(true));
    return d.textContent || '';
  }

  function caretFromPoint(clientX, clientY, fallbackEl) {
    var range = null;
    if (document.caretRangeFromPoint) {
      range = document.caretRangeFromPoint(clientX, clientY);
    } else if (document.caretPositionFromPoint) {
      var pos = document.caretPositionFromPoint(clientX, clientY);
      if (pos) {
        range = document.createRange();
        range.setStart(pos.offsetNode, pos.offset);
        range.collapse(true);
      }
    }
    if (!range && fallbackEl) {
      range = document.createRange();
      range.selectNodeContents(fallbackEl);
      range.collapse(false);
    }
    return range;
  }

  /** 用一个世界坐标矩形去框选卡片里的文字，返回 Range */
  function rangeBetween(wx1, wy1, wx2, wy2, bodyEl) {
    if (!bodyEl) return null;
    var p1 = EM.canvas.toScreen(wx1, wy1);
    var p2 = EM.canvas.toScreen(wx2, wy2);

    var r1 = caretFromPoint(p1.x, p1.y, bodyEl);
    var r2 = caretFromPoint(p2.x, p2.y, bodyEl);
    if (!r1 || !r2) return null;

    var start = r1.startContainer, so = r1.startOffset;
    var end = r2.endContainer, eo = r2.endOffset;

    if (!bodyEl.contains(start)) {
      var t1 = caretFromPoint(p1.x, p1.y, bodyEl);
      if (t1 && bodyEl.contains(t1.startContainer)) { start = t1.startContainer; so = t1.startOffset; }
      else { start = bodyEl; so = 0; }
    }
    if (!bodyEl.contains(end)) {
      var t2 = caretFromPoint(p2.x, p2.y, bodyEl);
      if (t2 && bodyEl.contains(t2.endContainer)) { end = t2.endContainer; eo = t2.endOffset; }
      else { end = bodyEl; eo = bodyEl.childNodes.length; }
    }

    var range = document.createRange();
    try {
      range.setStart(start, so);
      range.setEnd(end, eo);
    } catch (e) { return null; }

    // 框太小时两个落点可能重合 —— 退化成「按行相交」
    if (range.collapsed) {
      var alt = rangeByIntersection(p1, p2, bodyEl);
      if (alt) return alt;
    }
    return range;
  }

  /** 矩形与哪些行相交，就把它们整行包进来 */
  function rangeByIntersection(p1, p2, bodyEl) {
    var l = Math.min(p1.x, p2.x), r = Math.max(p1.x, p2.x);
    var t = Math.min(p1.y, p2.y), b = Math.max(p1.y, p2.y);
    var first = null, last = null;

    Array.prototype.forEach.call(bodyEl.childNodes, function (n) {
      if (n.nodeType !== 1) {
        if (n.nodeType === 3 && n.textContent.trim() && !first) {
          var rg = document.createRange();
          rg.selectNodeContents(n);
          var rr = rg.getBoundingClientRect();
          if (rr.bottom >= t && rr.top <= b && rr.right >= l && rr.left <= r) first = last = n;
        }
        return;
      }
      var rc = n.getBoundingClientRect();
      if (rc.bottom < t || rc.top > b) return;
      if (rc.right < l || rc.left > r) return;
      if (!first) first = n;
      last = n;
    });

    if (!first) return null;
    var range = document.createRange();
    try {
      range.setStartBefore(first);
      range.setEndAfter(last);
    } catch (e) { return null; }
    return range;
  }

  /** 保证片段至少被包在一个块里（否则加粗那段会贴着边） */
  function wrapInline(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    var hasBlock = Array.prototype.some.call(d.childNodes, function (n) {
      return n.nodeType === 1 && /^(P|DIV|UL|OL|H[1-6]|BLOCKQUOTE|PRE|TABLE|HR)$/.test(n.tagName);
    });
    return hasBlock ? d.innerHTML : '<p>' + d.innerHTML + '</p>';
  }

  /** 严格按矩形取字符：只保留和框真正相交的字 */
  function rangeByRect(rect, bodyEl) {
    var l = rect.x, t = rect.y, r = rect.x + rect.w, b = rect.y + rect.h;
    var walker = document.createTreeWalker(bodyEl, NodeFilter.SHOW_TEXT, null);
    var startNode = null, startOff = 0, endNode = null, endOff = 0;
    var node;

    while ((node = walker.nextNode())) {
      var text = node.nodeValue;
      if (!text) continue;
      for (var i = 0; i < text.length; i++) {
        if (!text[i].trim()) continue;
        var cr = document.createRange();
        cr.setStart(node, i);
        cr.setEnd(node, i + 1);
        var rr = cr.getBoundingClientRect();
        if (!rr.width && !rr.height) continue;
        if (rr.right > l && rr.left < r && rr.bottom > t && rr.top < b) {
          if (!startNode) { startNode = node; startOff = i; }
          endNode = node; endOff = i + 1;
        }
      }
    }

    if (!startNode) return null;
    var range = document.createRange();
    try {
      range.setStart(startNode, startOff);
      range.setEnd(endNode, endOff);
    } catch (e) { return null; }
    return range;
  }

  /** 把小方框按纵向合并，避免同一段被框两次时内容重复 */
  function mergeRects(rects) {
    var list = rects.slice().sort(function (a, b) { return a.ry - b.ry; });
    var out = [];
    list.forEach(function (r) {
      var last = out[out.length - 1];
      // 只有「纵向贴着、横向也接得上」才合并，避免把同一行的两处并成一整行
      if (last && r.ry <= last.ry + last.h + 4 &&
          r.rx <= last.rx + last.w + 12 && r.rx + r.w >= last.rx - 12) {
        var x1 = Math.min(last.rx, r.rx);
        var x2 = Math.max(last.rx + last.w, r.rx + r.w);
        var y2 = Math.max(last.ry + last.h, r.ry + r.h);
        last.rx = x1; last.w = x2 - x1; last.h = y2 - last.ry;
      } else {
        out.push({ rx: r.rx, ry: r.ry, w: r.w, h: r.h });
      }
    });
    return out;
  }

  /** 把 Range 里的内容还原成「带 ^ 和 _」的文字，方便当式子解析 */
  function richTextOfRange(range) {
    var frag = range.cloneContents();
    var div = document.createElement('div');
    div.appendChild(frag);

    div.querySelectorAll('sup').forEach(function (n) {
      n.parentNode.replaceChild(document.createTextNode('^{' + n.textContent + '}'), n);
    });
    div.querySelectorAll('sub').forEach(function (n) {
      n.parentNode.replaceChild(document.createTextNode('_{' + n.textContent + '}'), n);
    });

    return (div.textContent || '').replace(/\s+/g, ' ').trim();
  }

  /** 把下面撞上来的卡片依次往下推（同一列） */
  function shiftBelow(nb) {
    var gap = GAP;
    var column = EM.state.boxes.filter(function (o) {
      return o.id !== nb.id && Math.abs(o.x - nb.x) < 48 && o.y >= nb.y - 4;
    }).sort(function (a, b) { return a.y - b.y; });

    var cursor = nb.y + (nb.h || 120) + gap;
    column.forEach(function (o) {
      var oh = o.h || 120;
      if (o.y < cursor) {
        o.y = Math.round(cursor);
        var el = els[o.id];
        if (el) el.style.top = o.y + 'px';
        cursor = o.y + oh + gap;
      } else {
        cursor = Math.max(cursor, o.y + oh + gap);
      }
    });
  }

  EM.boxes.rangeBetween = rangeBetween;
  EM.boxes.caretFromPoint = caretFromPoint;

})(typeof window !== 'undefined' ? window : globalThis);
