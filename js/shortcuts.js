/* ============================================================
 * Branch · shortcuts.js
 * 可自定义的快捷键（存在本机 localStorage）
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var STORE_KEY = 'huashuo.keys.v1';

  var DEFAULTS = {
    move: 'v',
    line: 'l',
    circle: 'c',
    rect: 'r',
    ask: 'q',
    keep: 'k',
    split: 's',
    plot: 'p',
    fit: 'f'
  };

  var LABELS = {
    move: '移动 / 平移画布',
    line: '划线',
    circle: '画圈',
    rect: '画方框',
    ask: '框选提问',
    keep: '重点截取',
    split: '分框',
    plot: '画函数图',
    fit: '缩放到全部内容'
  };

  var cached = null;

  var S = (EM.shortcuts = {
    DEFAULTS: DEFAULTS,
    LABELS: LABELS,
    stay: true,          // 画完墨迹后保持当前工具

    get: function () {
      if (cached) return cached;
      var map = Object.assign({}, DEFAULTS);
      try {
        var raw = localStorage.getItem(STORE_KEY);
        if (raw) {
          var saved = JSON.parse(raw);
          Object.keys(saved).forEach(function (k) {
            if (k in DEFAULTS && typeof saved[k] === 'string' && saved[k].length === 1) map[k] = saved[k].toLowerCase();
          });
        }
      } catch (e) { }
      cached = map;
      return map;
    },

    save: function (map) {
      cached = Object.assign({}, DEFAULTS, map);
      try { localStorage.setItem(STORE_KEY, JSON.stringify(cached)); } catch (e) { }
      EM.bus.emit('shortcuts:change');
      return cached;
    },

    /** 改一个键；如果和别的动作冲突，就把那个动作清空 */
    setOne: function (action, key) {
      var map = Object.assign({}, S.get());
      key = String(key || '').toLowerCase();
      if (!key) return map;
      Object.keys(map).forEach(function (k) {
        if (k !== action && map[k] === key) map[k] = '';
      });
      map[action] = key;
      return S.save(map);
    },

    reset: function () {
      cached = null;
      try { localStorage.removeItem(STORE_KEY); } catch (e) { }
      cached = null;
      EM.bus.emit('shortcuts:change');
      return S.get();
    },

    /** 某个动作可读的键名 */
    label: function (action) {
      var k = S.get()[action];
      return k ? k.toUpperCase() : '—';
    }
  });

})(typeof window !== 'undefined' ? window : globalThis);
