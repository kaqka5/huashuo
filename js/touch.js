/* ============================================================
 * touch.js — 平板 / 触控笔支持
 *   · 双指缩放 + 平移
 *   · 笔用来画、手指用来拖（可切换）
 *   · 长按卡片 = 右键菜单
 * ============================================================ */
(function () {
  var EM = window.EM;
  var KEY = 'huashuo.touch.v1';

  var cfg = { fingerDraw: false };
  try {
    var raw = localStorage.getItem(KEY);
    if (raw) {
      var o = JSON.parse(raw);
      if (o && typeof o === 'object') cfg.fingerDraw = !!o.fingerDraw;
    }
  } catch (e) { /* 隐私模式，忽略 */ }

  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch (e) { }
  }

  var pts = {};        // pointerId -> {x,y}
  var pinch = null;    // { d, cx, cy }
  var lp = null;       // 长按计时

  var touch = (EM.touch = {
    isTouch: function () {
      return (navigator.maxTouchPoints || 0) > 0 || 'ontouchstart' in window;
    },

    /** 手指也能画？ */
    fingerDraw: function () { return !!cfg.fingerDraw; },

    setFingerDraw: function (v) {
      cfg.fingerDraw = !!v;
      save();
      touch.syncFlags();
    },

    /** 这一次按下应该画东西吗（笔和鼠标永远是 true） */
    shouldDraw: function (e) {
      if (e.pointerType === 'pen') return true;
      if (e.pointerType === 'touch') return !!cfg.fingerDraw;
      return true;
    },

    /** 给 <html> 打标记，CSS 用（只有"主要是触控"的设备才算，触屏笔记本仍按鼠标走） */
    syncFlags: function () {
      var d = document.documentElement;
      var coarse = false;
      try { coarse = window.matchMedia && window.matchMedia('(pointer: coarse)').matches; } catch (e) { }
      d.classList.toggle('is-touch', touch.isTouch() && coarse);
      d.classList.toggle('finger-draw', !!cfg.fingerDraw);
    }
  });

  function count() {
    var n = 0;
    for (var k in pts) if (pts.hasOwnProperty(k)) n++;
    return n;
  }

  function two() {
    var ids = [];
    for (var k in pts) if (pts.hasOwnProperty(k)) ids.push(k);
    return [pts[ids[0]], pts[ids[1]]];
  }

  function startPinch() {
    var p = two();
    if (!p[0] || !p[1]) return;
    pinch = {
      d: Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y),
      cx: (p[0].x + p[1].x) / 2,
      cy: (p[0].y + p[1].y) / 2
    };
    // 正在画的东西作废，别在缩放时冒出一条线
    if (EM.tools && EM.tools.cancelDrag) EM.tools.cancelDrag();
    if (EM.canvas && EM.canvas.cancelPan) EM.canvas.cancelPan();
    var st = document.getElementById('stage');
    if (st) st.classList.add('is-pinching');
    cancelLongPress();
  }

  function movePinch() {
    var p = two();
    if (!pinch || !p[0] || !p[1]) return;
    var d = Math.hypot(p[1].x - p[0].x, p[1].y - p[0].y);
    var cx = (p[0].x + p[1].x) / 2;
    var cy = (p[0].y + p[1].y) / 2;

    if (pinch.d > 8 && d > 8) {
      var f = d / pinch.d;
      if (Math.abs(f - 1) > 0.002) EM.canvas.zoomAt(cx, cy, f);
    }
    var dx = cx - pinch.cx, dy = cy - pinch.cy;
    if (Math.abs(dx) + Math.abs(dy) > 0.5) EM.canvas.panBy(dx, dy);

    pinch = { d: d, cx: cx, cy: cy };
    EM.persist.schedule();
  }

  function endPinch() {
    pinch = null;
    var st = document.getElementById('stage');
    if (st) st.classList.remove('is-pinching');
  }

  /* ---------------- 长按菜单 ---------------- */
  function cancelLongPress() {
    if (lp && lp.timer) clearTimeout(lp.timer);
    lp = null;
  }

  function startLongPress(e) {
    if (e.pointerType !== 'touch') return;
    var el = e.target.closest && e.target.closest('.box');
    if (!el) return;
    if (e.target.closest('.box-act') || e.target.closest('.box-no')) return;

    cancelLongPress();
    lp = {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      el: el,
      timer: setTimeout(function () {
        var box = EM.state.box(el.getAttribute('data-id'));
        var x = lp ? lp.x : e.clientX;
        var y = lp ? lp.y : e.clientY;
        cancelLongPress();
        if (!box || !EM.app.cardMenu) return;
        try { if (navigator.vibrate) navigator.vibrate(8); } catch (err) { }
        EM.app.cardMenu(box, x, y);
      }, 520)
    };
  }

  function moveLongPress(e) {
    if (!lp || e.pointerId !== lp.id) return;
    if (Math.hypot(e.clientX - lp.x, e.clientY - lp.y) > 10) cancelLongPress();
  }

  /* ---------------- 触摸设备：卡片默认不可编辑 ----------------
   安卓上，只要正文是 contenteditable，笔一碰就会聚焦、弹出手写输入法，
   键盘会把笔迹接管成"笔记的轨迹"，我们的线根本画不上。
   所以触摸设备上一律先设成不可编辑，要改字必须明确双击（或长按菜单里的"编辑文字"）。 */
  var EDITABLE_SEL = '.box-body, .qa-question, .note-body, .box-title';

  function isTouchMode() {
    return document.documentElement.classList.contains('has-touch');
  }

  function armInert(root) {
    if (!isTouchMode()) return;
    var list = (root || document).querySelectorAll(EDITABLE_SEL);
    for (var i = 0; i < list.length; i++) {
      var el = list[i];
      if (el.getAttribute('data-ce') === '1') continue;
      el.setAttribute('data-ce', '1');
      el.setAttribute('contenteditable', 'false');
    }
  }

  /** 明确进入编辑：双击正文、或长按菜单里点"编辑文字" */
  function beginEdit(el, x, y) {
    if (!el) return;
    var target = el.closest ? el.closest(EDITABLE_SEL) : null;
    if (!target) return;

    target.setAttribute('contenteditable', 'true');
    try { target.focus(); } catch (e) { }

    if (x != null && y != null && document.caretRangeFromPoint) {
      var r = document.caretRangeFromPoint(x, y);
      if (r) {
        var s = window.getSelection();
        s.removeAllRanges();
        s.addRange(r);
      }
    }

    target.addEventListener('blur', function onBlur() {
      target.removeEventListener('blur', onBlur);
      setTimeout(function () {
        if (document.activeElement !== target) target.setAttribute('contenteditable', 'false');
      }, 80);
    });
  }

  function bindEditGuard() {
    /* 第一次真正触摸（或笔）之后，才把"触屏模式"打开 */
    function onFirstTouch(e) {
      if (e.pointerType !== 'touch' && e.pointerType !== 'pen') return;
      document.documentElement.classList.add('has-touch');
      armInert(document);
    }
    window.addEventListener('pointerdown', onFirstTouch, true);

    /* 双击正文 = 进入编辑 */
    document.addEventListener('dblclick', function (e) {
      if (!isTouchMode()) return;
      var el = e.target.closest && e.target.closest(EDITABLE_SEL);
      if (!el) return;
      e.preventDefault();
      beginEdit(el, e.clientX, e.clientY);
    }, true);

    /* 卡片重绘之后，新元素同样设成不可编辑 */
    if (window.MutationObserver) {
      var mo = new MutationObserver(function (list) {
        if (!isTouchMode()) return;
        for (var i = 0; i < list.length; i++) {
          var added = list[i].addedNodes;
          for (var j = 0; j < added.length; j++) {
            var n = added[j];
            if (!n || n.nodeType !== 1) continue;
            if (n.matches && n.matches(EDITABLE_SEL)) {
              n.setAttribute('data-ce', '1');
              n.setAttribute('contenteditable', 'false');
            }
            armInert(n);
          }
        }
      });
      mo.observe(document.body, { childList: true, subtree: true });
    }
  }

  EM.touch.beginEdit = function (el, x, y) { beginEdit(el, x, y); };
  EM.touch.armInert = function (root) { armInert(root); };

  /* ---------------- 事件 ---------------- */
  function bind() {
    var viewport = document.getElementById('viewport') || document.getElementById('stage');
    if (!viewport) return;

    viewport.addEventListener('pointerdown', function (e) {
      if (e.pointerType === 'pen' || e.pointerType === 'touch') {
        document.documentElement.classList.add('has-touch');
      }
      if (e.pointerType !== 'touch') return;

      pts[e.pointerId] = { x: e.clientX, y: e.clientY };
      if (count() === 2) startPinch();
      else if (count() === 1) startLongPress(e);
    }, true);

    window.addEventListener('pointermove', function (e) {
      if (pts[e.pointerId]) {
        pts[e.pointerId].x = e.clientX;
        pts[e.pointerId].y = e.clientY;
        if (pinch) movePinch();
      }
      moveLongPress(e);
    }, true);

    function up(e) {
      if (pts[e.pointerId]) {
        delete pts[e.pointerId];
        if (pinch && count() < 2) endPinch();
      }
      if (lp && lp.id === e.pointerId) cancelLongPress();
    }
    window.addEventListener('pointerup', up, true);
    window.addEventListener('pointercancel', up, true);
    /* 双指时拦掉浏览器的默认缩放/滚动 */
    document.addEventListener('gesturestart', function (e) { e.preventDefault(); }, { passive: false });
  }

  EM.touch.bind = bind;
  EM.touch.syncFlags();
  bindEditGuard();

  /* UI：设置里的开关 */
  EM.touch.initUI = function () {
    var chk = document.getElementById('chkFingerDraw');
    if (!chk) return;
    chk.checked = !!cfg.fingerDraw;
    chk.addEventListener('change', function () {
      touch.setFingerDraw(chk.checked);
      EM.toast(chk.checked ? '手指现在也能画线了' : '手指恢复成拖画布');
    });
    var sec = document.getElementById('touchSec');
    if (sec && !touch.isTouch()) sec.classList.add('is-quiet');
  };
})();
