/* ============================================================
 * 画说 · menu.js
 * 右键菜单（卡片 / 画布空白处共用）
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var el = null;

  function close() {
    if (el && el.parentNode) el.parentNode.removeChild(el);
    el = null;
    document.removeEventListener('pointerdown', onOutside, true);
    document.removeEventListener('keydown', onKey, true);
  }

  function onOutside(e) {
    if (el && !el.contains(e.target)) close();
  }

  function onKey(e) {
    if (e.key === 'Escape') close();
  }

  var menu = (EM.menu = {
    close: close,

    open: function (x, y, items) {
      close();
      if (!items || !items.length) return;

      el = document.createElement('div');
      el.className = 'ctx-menu';

      items.forEach(function (it) {
        if (it.sep) {
          el.appendChild(document.createElement('i'));
          return;
        }
        var b = document.createElement('button');
        b.className = 'ctx-item' + (it.danger ? ' danger' : '') + (it.disabled ? ' disabled' : '');
        b.innerHTML = '<span>' + it.label + '</span>' + (it.hint ? '<em>' + it.hint + '</em>' : '');
        if (it.disabled) b.disabled = true;
        else b.addEventListener('click', function () {
          close();
          it.fn && it.fn();
        });
        el.appendChild(b);
      });

      document.body.appendChild(el);

      /* 贴着鼠标，别超出窗口 */
      var r = el.getBoundingClientRect();
      var left = Math.min(x, window.innerWidth - r.width - 8);
      var top = Math.min(y, window.innerHeight - r.height - 8);
      el.style.left = Math.max(6, left) + 'px';
      el.style.top = Math.max(6, top) + 'px';

      setTimeout(function () {
        document.addEventListener('pointerdown', onOutside, true);
        document.addEventListener('keydown', onKey, true);
      }, 0);
    }
  });

})(typeof window !== 'undefined' ? window : globalThis);
