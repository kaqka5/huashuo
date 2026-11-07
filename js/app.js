/* ============================================================
 * Branch · app.js
 * 界面装配：输入框、附件、设置抽屉、示例、复制粘贴模式
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var U = EM.util;

  var $ = function (id) { return document.getElementById(id); };

  var attachments = [];
  var generating = false;
  var genStatus = null;
  var topicThumbUrl = '';   // ② 里那张封面缩略图（只在本次会话里有效）

  var app = (EM.app = {});

  /* ============================================================
   * 启动
   * ========================================================== */
  function boot() {
    var params = new URLSearchParams(location.search);

    /* 主题 */
    var saved = EM.persist.load();
    var storedTheme = 'light';
    try { storedTheme = localStorage.getItem('huashuo.theme') || 'light'; } catch (e) { }
    var theme = params.get('theme') || (saved && saved.theme) || storedTheme;
    applyTheme(theme);

    EM.canvas.init();
    EM.annotate.bind();
    EM.canvas.bindPan();

    if (saved) restoreProject(saved);

    EM.boxes.renderAll();
    EM.annotate.renderAll();
    EM.tools.init();
    EM.tools.bindKeys();

    bindUI();
    bindBus();
    bindContextMenu();

    /* 平板：双指缩放、笔/手指分流、长按菜单 */
    if (EM.touch) {
      EM.touch.bind();
      EM.touch.initUI();
    }
    registerSW();

    if (!EM.state.view || (EM.state.view.x === 0 && EM.state.view.y === 0 && EM.state.view.k === 1 && !saved)) {
      EM.canvas.resetView();
    } else {
      EM.canvas.apply();
    }

    refreshState();
    updateChips();
    renderAttachments();
    EM.history.refresh();

    /* 版本号 */
    var vEl = document.getElementById('appVersion');
    var bEl = document.getElementById('appBuild');
    if (vEl) vEl.textContent = 'v' + EM.VERSION;
    if (bEl) bEl.textContent = EM.BUILD;

    if (EM.state.boxes.length) setTimeout(function () { EM.canvas.fit(); }, 60);

    /* 预览用：?demo=1&theme=dark */
    var demo = params.get('demo');
    if (demo) {
      setTimeout(function () {
        loadDemo(Number(demo) || 1);
        if (params.get('tool')) EM.tools.set(params.get('tool'));
        if (params.get('panel') === 'settings') openDrawer();
      }, 40);
    }
  }

  function restoreProject(data) {
    try {
      if (Array.isArray(data.boxes)) EM.state.boxes = data.boxes;
      if (Array.isArray(data.strokes)) EM.state.strokes = data.strokes;
      if (Array.isArray(data.frames)) EM.state.frames = data.frames;
      if (Array.isArray(data.links)) EM.state.links = data.links;
      if (data.canvas) EM.state.canvas = data.canvas;
      if (data.meta) EM.state.meta = Object.assign(EM.state.meta, data.meta);
      if (typeof data.seq === 'number') EM.state.seq = data.seq;
      if (data.view) EM.state.view = data.view;
      EM.state.started = !!data.started;
    } catch (e) { console.warn('恢复项目失败', e); }
  }

  /* ============================================================
   * 状态
   * ========================================================== */
  function refreshState() {
    var has = EM.state.boxes.length > 0;
    document.getElementById('app').dataset.state = has ? 'work' : 'home';
    EM.state.started = has;
  }

  function updateChips() {
    var topic = EM.state.meta.topic || '';
    var req = EM.state.meta.requirement || '';
    var tl = $('topicLabel'), rl = $('reqLabel');
    tl.textContent = topic || '还没有主题';
    rl.textContent = req || '还没有要求';
    $('chipTopic').classList.toggle('is-empty', !topic);
    $('chipReq').classList.toggle('is-empty', !req);

    var thumb = $('topicThumb');
    if (thumb) {
      if (topicThumbUrl) { thumb.src = topicThumbUrl; thumb.hidden = false; }
      else { thumb.hidden = true; thumb.removeAttribute('src'); }
    }
  }

  /* ============================================================
   * 事件
   * ========================================================== */
  function bindBus() {
    EM.bus.on('boxes:change', function () {
      refreshState();
      EM.persist.schedule();
    });
    EM.bus.on('render:all', function () {
      EM.boxes.renderAll();
      EM.annotate.renderAll();
    });
    EM.bus.on('state:restored', function () {
      EM.boxes.renderAll();
      EM.annotate.renderAll();
    });
    EM.bus.on('canvas:expand', function () {
      EM.annotate.syncSize();
    });
    EM.bus.on('box:regen', function (b) {
      var f = EM.state.frames.find(function (x) { return x.qaBoxId === b.id; });
      if (!f) { EM.toast('这张卡片找不到原来的选区'); return; }
      var src = EM.state.box(f.boxId);
      if (!src) { EM.toast('原来的卡片已不在了'); return; }
      if (!EM.ai.hasKey()) { EM.toast('还没有配置 API 密钥'); return; }
      EM.ai.answerInto(b, src, f.text, b.qa || '请解释这一段。');
    });
  }

  /* ============================================================
   * 界面绑定
   * ========================================================== */
  function bindUI() {
    var prompt = $('promptInput');

    /* --- 输入框 --- */
    prompt.addEventListener('input', function () {
      autoGrow(prompt);
      $('btnSend').disabled = !prompt.value.trim() && !attachments.length;
    });
    prompt.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        send();
      }
    });

    $('btnSend').addEventListener('click', send);
    $('btnAttach').addEventListener('click', function () { $('fileInput').click(); });
    $('fileInput').addEventListener('change', function (e) {
      addFiles(e.target.files);
      e.target.value = '';
    });

    /* 粘贴图片 */
    document.addEventListener('paste', function (e) {
      if (!e.clipboardData) return;
      var items = e.clipboardData.items || [];
      var got = false;
      for (var i = 0; i < items.length; i++) {
        if (items[i].type && items[i].type.indexOf('image/') === 0) {
          var f = items[i].getAsFile();
          if (f) { addFiles([f]); got = true; }
        }
      }
      if (got) e.preventDefault();
    });

    /* 拖拽文件 */
    var stage = $('stage');
    stage.addEventListener('dragover', function (e) {
      if (e.dataTransfer && Array.from(e.dataTransfer.types || []).indexOf('Files') >= 0) {
        e.preventDefault();
        stage.classList.add('drop-hint');
      }
    });
    stage.addEventListener('dragleave', function () { stage.classList.remove('drop-hint'); });
    stage.addEventListener('drop', function (e) {
      stage.classList.remove('drop-hint');
      if (!e.dataTransfer) return;
      if (e.dataTransfer.files && e.dataTransfer.files.length) {
        e.preventDefault();
        addFiles(e.dataTransfer.files);
      }
    });

    /* --- 工具栏按钮 --- */
    $('btnUndo').addEventListener('click', function () {
      if (!EM.history.undo()) EM.toast('没有可撤回的操作了');
    });
    $('btnRedo').addEventListener('click', function () {
      if (!EM.history.redo()) EM.toast('没有可重做的操作了');
    });
    $('btnExport').addEventListener('click', function () { EM.exporter.exportPNG(); });
    $('btnPlot').addEventListener('click', function () { EM.plot.openDialog(); });

    /* --- 缩放 --- */
    $('btnZoomIn').addEventListener('click', function () { EM.canvas.zoomStep(1); });
    $('btnZoomOut').addEventListener('click', function () { EM.canvas.zoomStep(-1); });
    $('zoomVal').addEventListener('click', function () { EM.canvas.setView({ k: 1 }); });
    $('btnFit').addEventListener('click', function () { EM.canvas.fit(); });

    /* --- 设置抽屉 --- */
    $('btnMenu').addEventListener('click', openDrawer);
    $('btnCloseDrawer').addEventListener('click', closeDrawer);
    $('drawerMask').addEventListener('click', closeDrawer);

    /* --- 弹窗遮罩 --- */
    $('modalMask').addEventListener('click', function (e) {
      if (e.target === $('modalMask')) EM.modal.close();
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape' && EM.modal.isOpen()) EM.modal.close();
    });

    /* --- 主题 --- */
    document.querySelectorAll('#themeSeg button').forEach(function (b) {
      b.addEventListener('click', function () { applyTheme(b.dataset.theme); });
    });

    /* --- AI 设置 --- */
    initAISettingsUI();

    /* --- 快捷键 --- */
    renderKeyList();
    $('btnResetKeys').addEventListener('click', function () {
      EM.shortcuts.reset();
      renderKeyList();
      EM.toast('快捷键已恢复默认');
    });

    /* --- 示例 --- */
    $('btnDemo1').addEventListener('click', function () { loadDemo(1); });
    $('btnDemo2').addEventListener('click', function () { loadDemo(2); });
    $('btnDemo3').addEventListener('click', function () { loadDemo(1); closeDrawer(); });

    /* --- 画布操作 --- */
    $('btnNew').addEventListener('click', function () {
      confirmModal('新建一个空白画布？', '当前画布上的卡片、墨迹都会清空（可以用撤回找回）。', function () {
        EM.history.push('新建画布');
        EM.state.boxes = [];
        EM.state.strokes = [];
        EM.state.frames = [];
        EM.state.links = [];
        EM.state.meta = { topic: '', requirement: '', mode: 'auto' };
        EM.state.seq = 0;
        EM.state.canvas = { w: 1180, h: 900 };
        EM.state.view = { x: 0, y: 0, k: 1 };
        EM.boxes.renderAll();
        EM.annotate.renderAll();
        EM.canvas.apply();
        EM.canvas.resetView();
        updateChips();
        refreshState();
        closeDrawer();
        EM.toast('画布已重置');
      });
    });

    $('btnClear').addEventListener('click', function () {
      confirmModal('清空画布上的所有内容？', '这会删掉全部卡片和墨迹，撤回可以找回。', function () {
        EM.history.push('清空画布');
        EM.state.boxes = [];
        EM.state.strokes = [];
        EM.state.frames = [];
        EM.state.links = [];
        EM.boxes.renderAll();
        EM.annotate.renderAll();
        refreshState();
        closeDrawer();
        EM.toast('已清空');
      });
    });

    /* --- 项目导出 / 导入（换电脑带走画布） --- */
    $('btnExportProject').addEventListener('click', function () {
      EM.exporter.exportJSON();
    });

    $('btnImportProject').addEventListener('click', function () {
      $('importFile').click();
    });

    $('importFile').addEventListener('change', function (e) {
      var file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;

      var fr = new FileReader();
      fr.onload = function () {
        var data;
        try {
          data = JSON.parse(String(fr.result));
        } catch (err) {
          EM.toast('这个文件不是项目文件');
          return;
        }
        if (!data || !data.boxes || !data.boxes.length && !data.strokes) {
          EM.toast('这个文件里没有画布内容');
          return;
        }

        EM.history.push('导入项目');
        EM.state.restore(data);
        EM.state.started = true;
        EM.boxes.renderAll();
        EM.annotate.renderAll();
        updateChips();
        refreshState();
        EM.persist.save();
        setTimeout(function () { EM.canvas.fit(120); }, 100);
        closeDrawer();
        EM.toast('已导入 ' + (data.boxes || []).length + ' 张卡片', {
          action: { label: '撤回', fn: function () { EM.history.undo(); } }
        });
      };
      fr.readAsText(file);
    });

    /* --- 顶部 ② ④ 编辑 --- */
    $('chipTopic').addEventListener('click', function () {
      editText('主题', '② 这张图的主题', EM.state.meta.topic, function (v) {
        EM.state.meta.topic = v;
        updateChips();
        EM.persist.schedule();
      });
    });
    $('chipReq').addEventListener('click', function () {
      editText('要求', '④ 你最开始提的要求', EM.state.meta.requirement, function (v) {
        EM.state.meta.requirement = v;
        updateChips();
        EM.persist.schedule();
      }, true);
    });

    /* --- 模式切换 --- */
    document.querySelectorAll('#modeSeg .mode').forEach(function (b) {
      b.addEventListener('click', function () {
        document.querySelectorAll('#modeSeg .mode').forEach(function (x) { x.classList.remove('on'); });
        b.classList.add('on');
        EM.state.meta.mode = b.dataset.mode;
      });
    });

    /* --- 首次点击画布空白，清掉墨迹选中 --- */
    $('stage').addEventListener('pointerdown', function (e) {
      if (!e.target.closest('.stroke.hit') && !e.target.closest('.box')) {
        EM.annotate.select(null);
      }
    });
  }

  /* ============================================================
   * 快捷键设置
   * ========================================================== */
  var listeningKey = null;

  function renderKeyList() {
    var list = $('keyList');
    if (!list) return;
    var map = EM.shortcuts.get();
    list.innerHTML = '';

    Object.keys(EM.shortcuts.LABELS).forEach(function (action) {
      var row = U.el('div', 'key-row');
      row.innerHTML = '<span>' + U.esc(EM.shortcuts.LABELS[action]) + '</span>';
      var btn = U.el('button', 'key-btn' + (map[action] ? '' : ' empty'));
      btn.textContent = map[action] ? map[action].toUpperCase() : '—';
      btn.title = '点一下，然后按新的键';
      btn.addEventListener('click', function (e) {
        e.preventDefault();
        startListening(action, btn);
      });
      row.appendChild(btn);
      list.appendChild(row);
    });
  }

  function startListening(action, btn) {
    if (listeningKey) stopListening();
    listeningKey = { action: action, btn: btn };
    btn.classList.add('editing');
    btn.textContent = '按键…';
    document.addEventListener('keydown', onKeyCapture, true);
  }

  function stopListening() {
    if (!listeningKey) return;
    listeningKey.btn.classList.remove('editing');
    listeningKey = null;
    document.removeEventListener('keydown', onKeyCapture, true);
    renderKeyList();
  }

  function onKeyCapture(e) {
    if (!listeningKey) return;
    e.preventDefault();
    e.stopPropagation();

    if (e.key === 'Escape') { stopListening(); return; }
    if (e.key === 'Backspace' || e.key === 'Delete') {
      EM.shortcuts.setOne(listeningKey.action, '');
      stopListening();
      return;
    }
    if (e.key.length !== 1 || e.ctrlKey || e.metaKey || e.altKey) return;

    EM.shortcuts.setOne(listeningKey.action, e.key);
    stopListening();
    EM.toast('快捷键已改为 ' + e.key.toUpperCase());
  }

  EM.app.renderKeyList = renderKeyList;

  /* ============================================================
   * 文档里的图：放到文字右边一列
   * ========================================================== */
  function placeDocImages(images, fileName) {
    if (!images || !images.length) return;
    var list = images.slice(0, 6);

    var stats = { created: 0 };
    var x = 80 + EM.boxes.BOX_W + 100;
    var y = 56;

    list.forEach(function (im) {
      var bw = 360;
      var estH = Math.round((bw - 20) * im.h / im.w) + 46;
      var b = EM.boxes.create({
        kind: 'image',
        x: x, y: y, w: bw,
        img: im.dataUrl,
        title: '插图 · 第 ' + im.page + ' 页',
        tag: '插图'
      });
      b.h = estH;
      stats.created++;
      y += estH + 18;
    });

    EM.canvas.expandTo({ x: 80, y: 40, w: (x + 380), h: y }, { pad: 240, pulse: false });
    EM.persist.schedule();
    if (stats.created) {
      EM.toast('已把文档里的 ' + stats.created + ' 张插图放到右边');
    }
  }

  EM.app.placeDocImages = placeDocImages;

  /* ============================================================
   * 卡片剪贴板 + 右键菜单
   * ========================================================== */
  var boxClipboard = null;

  function copyBoxToClip(b) {
    boxClipboard = {
      kind: b.kind, w: b.w, title: b.title, tag: b.tag, html: b.html,
      raw: b.raw, qa: b.qa,
      plot: b.plot ? { expr: b.plot.expr, xmin: b.plot.xmin, xmax: b.plot.xmax, ymin: null, ymax: null } : null,
      img: b.img || null
    };
    return boxClipboard;
  }

  function pasteBoxAt(wx, wy) {
    if (!boxClipboard) { EM.toast('剪贴板里还没有卡片'); return null; }
    EM.history.push('粘贴卡片');
    var b = EM.boxes.create({
      kind: boxClipboard.kind,
      x: Math.round(wx),
      y: Math.round(wy),
      w: boxClipboard.w || EM.boxes.BOX_W,
      title: boxClipboard.title,
      tag: boxClipboard.tag,
      html: boxClipboard.html,
      raw: boxClipboard.raw,
      qa: boxClipboard.qa,
      plot: boxClipboard.plot ? Object.assign({}, boxClipboard.plot) : null,
      img: boxClipboard.img
    });
    var el = EM.boxes.getEl(b.id);
    if (el) b.h = el.offsetHeight;
    EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 240 });
    refreshState();
    EM.persist.schedule();
    EM.toast('已粘贴一张卡片');
    return b;
  }

  EM.app.copyBox = copyBoxToClip;
  EM.app.pasteBoxAt = pasteBoxAt;
  EM.app.hasBoxClipboard = function () { return !!boxClipboard; };

  /** 卡片的右键菜单（桌面右键 / 平板长按共用） */
  EM.app.cardMenu = function (b, x, y) {
    EM.menu.open(x, y, [
      {
        label: '编辑这张卡的文字', fn: function () {
          var el = EM.boxes.getEl(b.id);
          if (!el) return;
          var body = el.querySelector('.box-body') || el.querySelector('.qa-question');
          if (EM.touch && EM.touch.beginEdit) EM.touch.beginEdit(body);
          else if (body) { body.setAttribute('contenteditable', 'true'); body.focus(); }
        }
      },
      { sep: true },
      {
        label: '复制回答框', fn: function () {
          copyBoxToClip(b);
          EM.toast('已复制这张卡片，右键空白处可以粘贴');
        }
      },
      {
        label: '剪切回答框', fn: function () {
          copyBoxToClip(b);
          EM.history.push('剪切卡片');
          EM.boxes.remove(b.id);
          EM.toast('已剪切，右键空白处可以粘贴');
        }
      },
      { sep: true },
      {
        label: '复制文字到剪贴板', fn: function () {
          EM.app.copyText(EM.boxes.textOf(b), '文字已复制');
        }
      },
      { sep: true },
      {
        label: '删除这张卡片', danger: true, fn: function () {
          EM.history.push('删除卡片');
          EM.boxes.remove(b.id);
          EM.toast('已删除一张卡片', { action: { label: '撤回', fn: function () { EM.history.undo(); } } });
        }
      }
    ]);
  };

  /** 空白处菜单 */
  EM.app.canvasMenu = function (x, y) {
    var p = EM.canvas.toWorld(x, y);
    EM.menu.open(x, y, [
      {
        label: '粘贴回答框',
        disabled: !boxClipboard,
        fn: function () { pasteBoxAt(p.x, p.y); }
      },
      { sep: true },
      { label: '画函数图…', fn: function () { EM.plot.openDialog({}); } },
      { label: '缩放到全部内容', fn: function () { EM.canvas.fit(); } }
    ]);
  };

  function bindContextMenu() {
    document.addEventListener('contextmenu', function (e) {
      if (EM.modal.isOpen()) return;
      if (e.target.closest('input, textarea, [contenteditable="true"]')) return;

      var boxEl = e.target.closest('.box');
      if (boxEl) {
        e.preventDefault();
        var b = EM.state.box(boxEl.dataset.id);
        if (!b) return;
        EM.app.cardMenu(b, e.clientX, e.clientY);
        return;
      }

      if (e.target.closest('#stage')) {
        e.preventDefault();
        EM.app.canvasMenu(e.clientX, e.clientY);
      }
    });
  }

  /* ============================================================
   * 主题
   * ========================================================== */
  function applyTheme(name) {
    EM.state.theme = name;
    document.documentElement.setAttribute('data-theme', name);
    document.querySelectorAll('#themeSeg button').forEach(function (b) {
      b.classList.toggle('on', b.dataset.theme === name);
    });
    try { localStorage.setItem('huashuo.theme', name); } catch (e) { }
    EM.persist.schedule();
  }

  /* ============================================================
   * 抽屉
   * ========================================================== */
  function openDrawer() {
    $('drawer').hidden = false;
    $('drawerMask').hidden = false;
    syncAISettingsUI();
  }
  function closeDrawer() {
    $('drawer').hidden = true;
    $('drawerMask').hidden = true;
  }
  EM.app.openDrawer = openDrawer;
  EM.app.closeDrawer = closeDrawer;

  /* ============================================================
   * AI 设置
   * ========================================================== */
  function initAISettingsUI() {
    var sel = $('aiPreset');
    sel.innerHTML = EM.ai.PRESETS.map(function (p) {
      return '<option value="' + p.id + '">' + U.esc(p.name) + '</option>';
    }).join('');

    sel.addEventListener('change', function () {
      var p = EM.ai.PRESETS.find(function (x) { return x.id === sel.value; });
      if (!p) return;
      if (p.base) $('aiBase').value = p.base;
      if (p.model) $('aiModel').value = p.model;
    });

    $('btnEye').addEventListener('click', function () {
      var k = $('aiKey');
      k.type = k.type === 'password' ? 'text' : 'password';
      $('btnEye').style.opacity = k.type === 'text' ? '1' : '.6';
    });

    $('btnSaveAI').addEventListener('click', function () {
      saveAISettings();
      setTestMsg('设置已保存在这台电脑的浏览器里。', 'ok');
    });

    $('btnTestAI').addEventListener('click', testAI);

    // 先把已存的设置灌进输入框，避免关页面时把空值写回去
    syncAISettingsUI();

    window.addEventListener('beforeunload', function () {
      saveAISettings();
    });
  }

  function syncAISettingsUI() {
    var s = EM.ai.settings();
    $('aiPreset').value = s.preset || 'custom';
    $('aiBase').value = s.base || '';
    $('aiModel').value = s.model || '';
    $('aiKey').value = s.apiKey || '';
  }
  function saveAISettings() {
    EM.ai.saveSettings({
      preset: $('aiPreset').value,
      base: $('aiBase').value.trim(),
      model: $('aiModel').value.trim(),
      apiKey: $('aiKey').value.trim()
    });
  }

  function setTestMsg(msg, kind) {
    var el = $('testMsg');
    el.textContent = msg || '';
    el.className = 'test-msg' + (kind ? ' ' + kind : '');
  }

  function testAI() {
    saveAISettings();
    if (!EM.ai.hasKey()) { setTestMsg('先填 API Key（本地 Ollama 可以不填）。', 'err'); return; }
    setTestMsg('正在连接…');
    $('btnTestAI').disabled = true;

    EM.ai.once([{ role: 'user', content: '只回复两个字：可以' }], { stream: false })
      .then(function (t) {
        setTestMsg('连接成功：' + U.truncate(t, 40), 'ok');
      })
      .catch(function (err) {
        setTestMsg('连接失败：' + err.message, 'err');
      })
      .then(function () { $('btnTestAI').disabled = false; });
  }

  /* ============================================================
   * 附件
   * ========================================================== */
  function addFiles(files) {
    Array.prototype.slice.call(files).forEach(function (f) {
      if (f.type && f.type.indexOf('image/') === 0) {
        if (attachments.filter(function (a) { return a.kind === 'image'; }).length >= 4) {
          EM.toast('最多先放 4 张图');
          return;
        }
        if (f.size > 6 * 1024 * 1024) { EM.toast('这张图太大了（>6MB）'); return; }
        var reader = new FileReader();
        reader.onload = function () {
          attachments.push({ kind: 'image', name: f.name || '截图', dataUrl: reader.result });
          renderAttachments();
        };
        reader.readAsDataURL(f);
      } else {
        if (f.size > 8 * 1024 * 1024) { EM.toast('这个文件太大了（>8MB）'); return; }
        EM.files.read(f).then(function (res) {
          attachments.push({ kind: 'text', name: res.name, text: res.text });
          renderAttachments();
          if (/\.docx$/i.test(res.name)) {
            EM.toast('已从 Word 里读出 ' + res.text.length + ' 个字');
          } else if (/\.pdf$/i.test(res.name)) {
            EM.toast('已从 PDF 里读出 ' + res.text.length + ' 个字');
            if (res.images && res.images.length) placeDocImages(res.images, res.name);
          }
        }).catch(function (err) {
          EM.toast(err.message || '这个文件读不了', { timeout: 6000 });
        });
      }
    });
  }

  function renderAttachments() {
    var list = $('attachList');
    list.innerHTML = '';
    attachments.forEach(function (a, i) {
      var n = U.el('div', 'attach');
      n.innerHTML = (a.kind === 'image'
        ? '<img src="' + a.dataUrl + '" alt="">'
        : '<span class="ficon">📄</span>') +
        '<span class="fname">' + U.esc(a.name) + '</span>' +
        '<button class="rm" title="移除">×</button>';
      n.querySelector('.rm').addEventListener('click', function () {
        attachments.splice(i, 1);
        renderAttachments();
      });
      list.appendChild(n);
    });
    $('btnSend').disabled = !$('promptInput').value.trim() && !attachments.length;
  }

  /* ============================================================
   * 发送 → 生成
   * ========================================================== */
  function send() {
    if (generating) return;
    var prompt = $('promptInput').value.trim();
    if (!prompt && !attachments.length) return;

    var opts = {
      requirement: prompt || '请帮我理解这份材料。',
      mode: EM.state.meta.mode || 'auto',
      attachments: attachments.slice(),
      docText: attachments.filter(function (a) { return a.kind === 'text'; })
        .map(function (a) { return '【' + a.name + '】\n' + a.text; }).join('\n\n')
    };

    EM.state.meta.requirement = opts.requirement;
    var firstImg = attachments.find(function (a) { return a.kind === 'image'; });
    if (firstImg) topicThumbUrl = firstImg.dataUrl;
    if (!EM.state.meta.topic) EM.state.meta.topic = U.truncate(prompt, 26);
    updateChips();

    if (!EM.ai.hasKey()) {
      openPasteModal(opts);
      return;
    }
    runGenerate(opts);
  }

  function runGenerate(opts) {
    generating = true;
    setGenerating(true);
    EM.history.push('AI 生成');

    var cursor = EM.boxes.beginBatch();
    var live = null;      // {box, idx}
    var count = 0;
    var topicSet = false;

    /* 视口先对准将要出现的位置 */
    EM.canvas.focusRect({ x: 40, y: cursor.y - 40, w: 560, h: 520 }, { keepZoom: true, maxK: EM.state.view.k, minK: 0.5 });

    function placeCard(card, isLive) {
      var html = cardHtml(card);
      var b = EM.boxes.create({
        kind: card.kind,
        title: card.title || ' ',
        tag: tagOf(card.kind),
        html: html,
        x: cursor.x,
        y: cursor.y,
        w: EM.boxes.BOX_W
      });
      var el = EM.boxes.getEl(b.id);
      if (el) {
        b.h = el.offsetHeight;
        if (isLive) el.classList.add('is-streaming');
      }
      EM.boxes.placeInBatch(cursor, b);
      count++;
      return b;
    }

    function finalize(b, card) {
      if (!b) return;
      b.html = cardHtml(card);
      b.title = card.title || b.title;
      b.raw = cardRaw(card);
      EM.boxes.refresh(b.id);
      var el = EM.boxes.getEl(b.id);
      if (el) {
        el.classList.remove('is-streaming');
        b.h = el.offsetHeight;
      }
      EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 260 });
    }

    EM.ai.generate(opts, {
      onTopic: function (t) {
        if (topicSet || !t) return;
        topicSet = true;
        EM.state.meta.topic = t;
        updateChips();
      },

      onCard: function (card, idx) {
        if (live && live.idx === idx) {
          finalize(live.box, card);
          cursor.y = live.box.y + (live.box.h || 120) + EM.boxes.GAP;
          live = null;
        } else {
          var b = placeCard(card, false);
          finalize(b, card);
          cursor.y = b.y + (b.h || 120) + EM.boxes.GAP;
        }
        setGenStatus('已写好 ' + (idx + 1) + ' 张');
      },

      onLiveCard: function (card, idx) {
        if (live && live.box && EM.state.box(live.box.id)) {
          var prevH = live.box.h || 120;
          live.box.html = cardHtml(card);
          live.box.title = card.title || live.box.title;
          var el = EM.boxes.getEl(live.box.id);
          if (el) {
            var tEl = el.querySelector('.box-title');
            if (tEl) tEl.textContent = live.box.title;
            var body = el.querySelector('.box-body');
            if (body && document.activeElement !== body) body.innerHTML = live.box.html;
            live.box.h = el.offsetHeight;
          }
          cursor.colH += (live.box.h || 120) - prevH;
          cursor.y = live.box.y + (live.box.h || 120) + EM.boxes.GAP;
        } else {
          var b = placeCard(card, true);
          live = { box: b, idx: idx };
          cursor.y = b.y + (b.h || 120) + EM.boxes.GAP;
        }
        setGenStatus('正在写第 ' + (idx + 1) + ' 张…');
      },

      onDone: function (parsed) {
        if (live && live.box) {
          var el = EM.boxes.getEl(live.box.id);
          if (el) el.classList.remove('is-streaming');
          var last = parsed.cards[parsed.cards.length - 1];
          if (last) finalize(live.box, last);
          live = null;
        }

        if (!parsed.cards.length || !count) {
          EM.toast('没有解析到卡片，可能需要重试或换个模型');
        }
        if (parsed.topic && !topicSet) {
          topicSet = true;
          EM.state.meta.topic = parsed.topic;
          updateChips();
        }

        EM.history.refresh();
        EM.persist.schedule();

        setTimeout(function () {
          EM.canvas.fit(110);
        }, 120);

        // 清掉已经用掉的附件
        attachments = [];
        renderAttachments();
        $('promptInput').value = '';
        autoGrow($('promptInput'));
        finish();
      }
    }).catch(function (err) {
      console.error(err);
      EM.toast('生成失败：' + err.message, {
        timeout: 8000,
        action: { label: '改用粘贴模式', fn: function () { openPasteModal(opts); } }
      });
      finish();
    });

    function finish() {
      generating = false;
      setGenerating(false);
      setGenStatus('');
    }
  }

  function setGenerating(on) {
    var c = $('composer');
    c.classList.toggle('generating', !!on);
    $('btnSend').disabled = !!on;
    if (!on) $('btnSend').disabled = !$('promptInput').value.trim() && !attachments.length;
  }

  function setGenStatus(txt) {
    if (!genStatus) {
      genStatus = U.el('div', 'gen-status');
      $('composer').appendChild(genStatus);
    }
    genStatus.textContent = txt || '';
    genStatus.classList.toggle('on', !!txt);
  }

  /* ============================================================
   * 卡片内容 → HTML
   * ========================================================== */
  function cardHtml(card) {
    if (card.kind === 'en') {
      var orig = card.original || '';
      var trans = card.translation || '';
      return '<span class="orig">' + EM.md.inline(orig) + '</span>' +
        (trans ? '<span class="tr">' + EM.md.inline(trans) + '</span>' : '');
    }
    return EM.md.toHtml(card.body || '');
  }

  function cardRaw(card) {
    if (card.kind === 'en') return (card.original || '') + '\n' + (card.translation || '');
    return card.body || '';
  }

  function tagOf(kind) {
    return ({
      step: '步骤', quote: '原文', para: '解释', en: '对照',
      answer: '结论', note: '备注', qa: '提问'
    })[kind] || '';
  }

  /* ============================================================
   * 示例
   * ========================================================== */
  var DEMOS = {
    1: {
      topic: '三次函数的单调性与极值',
      requirement: '已知 f(x)=x³-3x²+2，求单调区间和极值，要讲得能看懂。',
      cards: [
        { kind: 'step', title: '先把导数求出来', body: '已知 $f(x)=x^{3}-3x^{2}+2$。\n求导：\n$$f\'(x)=3x^{2}-6x=3x(x-2)$$\n导数大于零就递增，小于零就递减 —— 所以下一步先找导数等于零的点。' },
        { kind: 'step', title: '找到两个驻点', body: '令 $3x(x-2)=0$，得到 $x_{1}=0$，$x_{2}=2$。\n这两个点把定义域切成三段：$(-\\infty,0)$、$(0,2)$、$(2,+\\infty)$。' },
        { kind: 'step', title: '看每一段的正负', body: '取几个测试点代进去：\n- $x=-1$：$f\'(-1)=9>0$\n- $x=1$：$f\'(1)=-3<0$\n- $x=3$：$f\'(3)=9>0$\n\n于是 $f$ 在 $(-\\infty,0)$ 上递增，在 $(0,2)$ 上递减，在 $(2,+\\infty)$ 上递增。' },
        { kind: 'step', title: '代入求出极值', body: '极大值：$f(0)=2$\n极小值：$f(2)=8-12+2=-2$' },
        { kind: 'answer', title: '结论', body: '单调递增区间：$(-\\infty,0)$ 与 $(2,+\\infty)$；\n单调递减区间：$(0,2)$。\n\n极大值 $2$（$x=0$ 处），极小值 $-2$（$x=2$ 处）。' }
      ]
    },
    2: {
      topic: 'A Letter from the Lighthouse',
      requirement: '这是一篇英文短篇，按段落给我原文和翻译，再讲讲写法。',
      cards: [
        { kind: 'en', title: '第 1 段', original: 'The lighthouse keeper had not spoken to anyone in eleven days.', translation: '守灯塔的人已经十一天没和任何人说过话了。' },
        { kind: 'para', title: '这段在说什么', body: '一句话交代了**人物、时间和处境**，落点只有一个字：孤独。\n\n`eleven days` 比 "a long time" 有力得多 —— 具体数字让读者自己去算那份寂静有多长。' },
        { kind: 'en', title: '第 2 段', original: 'He counted the waves the way other men count sheep.', translation: '他数着海浪，就像别人数羊一样。' },
        { kind: 'para', title: '修辞与语气', body: '用 "the way other men count sheep" 作类比：数羊本来是为了入睡，而他数的是海浪 —— 失眠与孤独叠在了一起。\n\n"counted" 也回扣了上一段的 "eleven days"：日子被拆成一格一格。' },
        { kind: 'note', title: '可以学走的写法', body: '**具体数字 + 日常动作的错位类比**，是把孤独写得不煽情的最省力办法。' }
      ]
    }
  };

  function loadDemo(n) {
    var d = DEMOS[n] || DEMOS[1];
    EM.history.push('载入示例');

    EM.state.boxes = [];
    EM.state.strokes = [];
    EM.state.frames = [];
    EM.state.links = [];
    EM.state.seq = 0;
    EM.state.canvas = { w: 1180, h: 900 };
    EM.state.meta.topic = d.topic;
    EM.state.meta.requirement = d.requirement;

    EM.boxes.renderAll();
    EM.annotate.renderAll();

    var cursor = EM.boxes.beginBatch(56);
    d.cards.forEach(function (c) {
      var b = EM.boxes.create({
        kind: c.kind,
        title: c.title,
        tag: tagOf(c.kind),
        html: cardHtml(c),
        x: cursor.x, y: cursor.y, w: EM.boxes.BOX_W
      });
      var el = EM.boxes.getEl(b.id);
      b.h = el ? el.offsetHeight : 120;
      EM.boxes.placeInBatch(cursor, b);
    });

    EM.canvas.expandTo({ x: 80, y: 56, w: cursor.x + EM.boxes.BOX_W, h: cursor.y }, { pad: 260, pulse: false });
    updateChips();
    refreshState();
    EM.history.refresh();

    setTimeout(function () { EM.canvas.fit(120); }, 80);
    EM.toast('示例已载入，试试工具栏里的划线、画圈和框选提问');
  }

  EM.app.loadDemo = loadDemo;

  /* ============================================================
   * 离线缓存（只在 https / localhost 下注册）
   * ========================================================== */
  function registerSW() {
    if (!('serviceWorker' in navigator)) return;
    var https = location.protocol === 'https:';
    var local = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (!https && !local) return;
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 忽略 */ });
    });
  }

  /* ============================================================
   * 免密钥：复制提示词 → 粘贴回答
   * ========================================================== */
  function openPasteModal(opts) {
    var promptText = EM.ai.buildCopyPrompt(opts);

    var html = '' +
      '<button class="x" data-close>×</button>' +
      '<h2>没有密钥也能用</h2>' +
      '<p class="m-sub">把下面这段提示词复制到任意 AI（ChatGPT / DeepSeek / 豆包 / Kimi…），' +
      '再把它的完整回答粘回第二个框里，点「解析成卡片」，效果完全一样。</p>' +
      '<label class="m-label">① 提示词</label>' +
      '<textarea id="pastePrompt" readonly data-autofocus>' + U.esc(promptText) + '</textarea>' +
      '<div class="row gap" style="margin-top:8px">' +
      '  <button class="btn" id="btnCopyPrompt">复制提示词</button>' +
      '  <button class="btn" id="btnGoSettings">去填 API Key（可以跳过）</button>' +
      '</div>' +
      '<label class="m-label" style="margin-top:16px">② 把 AI 的回答粘在这里 <span id="pasteLen"></span></label>' +
      '<textarea id="pasteAnswer" placeholder="整段粘进来就行，不用整理格式"></textarea>' +
      '<div class="modal-foot">' +
      '  <button class="btn" data-close>取消</button>' +
      '  <button class="btn primary" id="btnParsePaste">解析成卡片</button>' +
      '</div>';

    EM.modal.open(html, function (root) {
      var ta = root.querySelector('#pastePrompt');
      var ans = root.querySelector('#pasteAnswer');
      var len = root.querySelector('#pasteLen');

      ans.addEventListener('input', function () {
        len.textContent = ans.value.trim() ? '（' + ans.value.length + ' 字）' : '';
      });

      root.querySelector('#btnCopyPrompt').addEventListener('click', function () {
        copyText(ta.value, '提示词已复制');
      });

      root.querySelector('#btnGoSettings').addEventListener('click', function () {
        EM.modal.close();
        openDrawer();
      });

      root.querySelectorAll('[data-close]').forEach(function (b) {
        b.addEventListener('click', function () { EM.modal.close(); });
      });

      root.querySelector('#btnParsePaste').addEventListener('click', function () {
        var text = ans.value.trim();
        if (!text) { EM.toast('先把 AI 的回答粘进来'); return; }

        var parsed = EM.ai.parseStream(text, true);
        if (!parsed.cards.length) { EM.toast('没读到卡片，检查一下是不是粘全了'); return; }

        EM.modal.close();
        EM.state.meta.requirement = opts.requirement;
        if (parsed.topic) EM.state.meta.topic = parsed.topic;
        updateChips();

        var cursor2 = EM.boxes.beginBatch();
        parsed.cards.forEach(function (c) {
          var b = EM.boxes.create({
            kind: c.kind, title: c.title, tag: tagOf(c.kind),
            html: cardHtml(c), x: cursor2.x, y: cursor2.y, w: EM.boxes.BOX_W
          });
          var el = EM.boxes.getEl(b.id);
          b.h = el ? el.offsetHeight : 120;
          EM.boxes.placeInBatch(cursor2, b);
        });
        EM.canvas.expandTo({ x: 80, y: 0, w: cursor2.x + EM.boxes.BOX_W, h: cursor2.y }, { pad: 260 });
        EM.history.push('粘贴生成');
        refreshState();
        attachments = [];
        renderAttachments();
        $('promptInput').value = '';
        autoGrow($('promptInput'));
        setTimeout(function () { EM.canvas.fit(110); }, 90);
        EM.toast('已解析成 ' + parsed.cards.length + ' 张卡片');
      });
    });
  }

  EM.app.openPasteModal = openPasteModal;

  function copyText(text, okMsg) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        EM.toast(okMsg || '已复制');
      }).catch(function () { fallbackCopy(text, okMsg); });
    } else {
      fallbackCopy(text, okMsg);
    }
  }

  function fallbackCopy(text, okMsg) {
    var ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); EM.toast(okMsg || '已复制'); }
    catch (e) { EM.toast('复制失败，手动选中再复制吧'); }
    ta.remove();
  }

  EM.app.copyText = copyText;

  /* ============================================================
   * 小弹窗
   * ========================================================== */
  function confirmModal(title, sub, onOk) {
    EM.modal.open(
      '<button class="x" data-close>×</button>' +
      '<h2>' + U.esc(title) + '</h2>' +
      '<p class="m-sub">' + U.esc(sub || '') + '</p>' +
      '<div class="modal-foot">' +
      '<button class="btn" data-close>先不要</button>' +
      '<button class="btn danger" id="mOk">确定</button>' +
      '</div>',
      function (root) {
        root.querySelectorAll('[data-close]').forEach(function (b) {
          b.addEventListener('click', function () { EM.modal.close(); });
        });
        root.querySelector('#mOk').addEventListener('click', function () {
          EM.modal.close();
          onOk && onOk();
        });
      }
    );
  }

  function editText(title, sub, value, onSave, multiline) {
    EM.modal.open(
      '<button class="x" data-close>×</button>' +
      '<h2>' + U.esc(title) + '</h2>' +
      '<p class="m-sub">' + U.esc(sub || '') + '</p>' +
      (multiline
        ? '<textarea id="editVal" style="min-height:110px" data-autofocus>' + U.esc(value || '') + '</textarea>'
        : '<input id="editVal" class="m-input" data-autofocus value="' + U.esc(value || '') + '">') +
      '<div class="modal-foot">' +
      '<button class="btn" data-close>取消</button>' +
      '<button class="btn primary" id="mOk">保存</button>' +
      '</div>',
      function (root) {
        var input = root.querySelector('#editVal');
        input.focus();
        input.select && input.select();
        function ok() {
          var v = input.value.trim();
          EM.modal.close();
          onSave(v);
        }
        root.querySelectorAll('[data-close]').forEach(function (b) {
          b.addEventListener('click', function () { EM.modal.close(); });
        });
        root.querySelector('#mOk').addEventListener('click', ok);
        input.addEventListener('keydown', function (e) {
          if (e.key === 'Enter' && (!multiline || e.ctrlKey)) { e.preventDefault(); ok(); }
        });
      }
    );
  }

  /* ============================================================
   * 杂项
   * ========================================================== */
  function autoGrow(el) {
    el.style.height = 'auto';
    el.style.height = Math.min(el.scrollHeight, 210) + 'px';
  }

  EM.app.send = send;
  EM.app.attachments = function () { return attachments; };
  EM.app.runGenerate = runGenerate;

  /* ---------- go ---------- */
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }

})(typeof window !== 'undefined' ? window : globalThis);
