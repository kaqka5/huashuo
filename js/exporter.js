/* ============================================================
 * 画说 · exporter.js
 * 把 ⑤ 画布导出成一张 PNG（纯前端，用 SVG foreignObject 截屏）
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var U = EM.util;

  var VARS = [
    '--paper', '--paper-2', '--paper-3', '--ink', '--ink-2', '--ink-3', '--ink-4',
    '--rule', '--rule-soft', '--accent', '--accent-2', '--accent-3', '--hl',
    '--font-ui', '--font-read', '--font-hand', '--font-math', '--font-mono'
  ];

  var cssCache = null;

  /* 直接双击 index.html（file://）时读不到外部样式表，
     这里内置一份导出够用的精简样式当退路 */
  var FALLBACK_CSS = [
    '.box{position:absolute;width:464px;border:1.5px solid var(--ink);border-radius:11px 7px 12px 8px/8px 12px 7px 11px;background:var(--paper-2);box-shadow:0 6px 18px -14px rgba(0,0,0,.45);}',
    '.box-head{display:flex;align-items:center;gap:8px;padding:9px 12px 7px;}',
    '.box-no{flex:0 0 auto;display:grid;place-items:center;width:21px;height:21px;border:1.3px solid var(--ink);border-radius:50%;font-family:var(--font-read);font-size:11.5px;line-height:1;}',
    '.box-title{flex:1 1 auto;font-family:var(--font-hand);font-size:14.5px;color:var(--ink);white-space:nowrap;overflow:hidden;}',
    '.box-tag{font-size:10px;color:var(--ink-4);border:1px solid var(--rule);border-radius:99px;padding:1px 6px;}',
    '.qa-question{margin:0 12px 6px;padding:8px 11px;border:1.3px dashed var(--accent);border-radius:8px;background:rgba(181,68,44,.06);font-size:12.5px;line-height:1.6;color:var(--accent);font-family:var(--font-ui);}',
    '.box-body{padding:2px 16px 14px;font-family:var(--font-read);font-size:15px;line-height:1.86;color:var(--ink);}',
    '.box-body p{margin:0 0 .62em;}.box-body ul,.box-body ol{padding-left:1.35em;margin:.2em 0 .7em;}',
    '.box.kind-quote .box-body{font-size:14.5px;color:var(--ink-2);}',
    '.box.kind-en .tr{display:block;margin:.18em 0 .75em;padding-left:.72em;border-left:2px solid var(--accent-2);font-size:.875em;color:var(--ink-3);}',
    '.box.kind-en .orig{display:block;}',
    '.box.kind-answer{border-width:2px;}',
    '.box-body hr.seam{border:0;border-top:1.5px dashed var(--accent);margin:1em 0;}',
    '.math,.mathblock{font-family:var(--font-math);font-size:1.03em;white-space:nowrap;}',
    '.mathblock{display:block;margin:.6em 0;text-align:center;white-space:normal;}',
    '.frac{display:inline-flex;flex-direction:column;vertical-align:-.52em;margin:0 .22em;text-align:center;line-height:1.18;}',
    '.frac>.num{display:block;padding:0 .34em .04em;border-bottom:1.1px solid currentColor;}',
    '.frac>.den{display:block;padding:.04em .34em 0;}',
    '.radical{display:inline-flex;}.radicand{border-top:1.1px solid currentColor;padding:0 .16em;}',
    'sup{font-size:.68em;}.upright{font-style:normal;}.mbf{font-weight:700;}',
    '.stroke{fill:none;stroke:var(--ink);stroke-width:2.1;stroke-linecap:round;stroke-linejoin:round;}',
    '.stroke.ghost{stroke-width:1;opacity:.45;}',
    '.link-path{fill:none;stroke:var(--accent);stroke-width:1.4;stroke-dasharray:5 4;}',
    '.sel-frame{position:absolute;border:1.3px dashed var(--accent);border-radius:5px;background:rgba(181,68,44,.07);}',
    '.sel-badge{position:absolute;left:-9px;top:-9px;width:18px;height:18px;display:grid;place-items:center;border-radius:50%;background:var(--accent);color:#fff;font-size:10px;}'
  ].join('\n');

  function collectCSS() {
    if (cssCache) return Promise.resolve(cssCache);

    var linkEl = document.querySelector('link[href*="app.css"]');
    var href = linkEl ? linkEl.getAttribute('href') : 'css/app.css';

    return fetch(href).then(function (r) {
      if (!r.ok) throw new Error('css');
      return r.text();
    }).then(function (t) {
      cssCache = t;
      return t;
    }).catch(function () {
      // 退路 1：直接从样式表读
      var out = '';
      try {
        for (var i = 0; i < document.styleSheets.length; i++) {
          var sh = document.styleSheets[i];
          try {
            var rules = sh.cssRules;
            for (var j = 0; j < rules.length; j++) out += rules[j].cssText + '\n';
          } catch (e) { /* 跨域样式表跳过 */ }
        }
      } catch (e2) { out = ''; }

      if (!out) {
        // 退路 2：内置精简样式（file:// 直接打开时）
        out = FALLBACK_CSS;
      }
      cssCache = out;
      return out;
    });
  }

  function themeVars() {
    var cs = getComputedStyle(document.documentElement);
    return VARS.map(function (v) {
      return v + ':' + cs.getPropertyValue(v).trim();
    }).join(';');
  }

  /* 需要复制的样式属性 */
  var STYLE_PROPS = [
    'box-sizing', 'display', 'position', 'left', 'top', 'right', 'bottom',
    'width', 'height', 'min-width', 'max-width', 'min-height', 'max-height',
    'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
    'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
    'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
    'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
    'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
    'border-top-left-radius', 'border-top-right-radius', 'border-bottom-right-radius', 'border-bottom-left-radius',
    'background-color', 'background-image', 'background-position', 'background-size', 'background-repeat', 'background-clip',
    'color', 'font-family', 'font-size', 'font-weight', 'font-style', 'line-height',
    'letter-spacing', 'word-spacing', 'text-align', 'text-indent', 'text-transform',
    'text-decoration-line', 'text-decoration-color', 'text-underline-offset',
    'white-space', 'word-break', 'overflow-wrap', 'overflow', 'vertical-align',
    'opacity', 'transform', 'transform-origin', 'box-shadow', 'z-index',
    'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
    'align-items', 'align-self', 'justify-content', 'gap', 'row-gap', 'column-gap',
    'list-style-type', 'list-style-position', 'border-collapse',
    'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin', 'stroke-dasharray',
    'fill', 'vector-effect', 'marker-end', 'direction'
  ];

  function inlineStyles(srcRoot, dstRoot) {
    if (!srcRoot || !dstRoot) return;

    var srcs = [srcRoot].concat(Array.prototype.slice.call(srcRoot.querySelectorAll('*')));
    var dsts = [dstRoot].concat(Array.prototype.slice.call(dstRoot.querySelectorAll('*')));
    if (srcs.length !== dsts.length) return; // 结构不一致就放弃，避免错位

    // 用一份共享的 computed style 读表，逐元素写入内联样式
    for (var i = 0; i < srcs.length; i++) {
      var s = srcs[i], d = dsts[i];
      if (!s || !d || d.nodeType !== 1) continue;
      if (d.tagName === 'STYLE' || d.tagName === 'SCRIPT') continue;

      var cs = getComputedStyle(s);
      var buf = '';
      for (var p = 0; p < STYLE_PROPS.length; p++) {
        var name = STYLE_PROPS[p];
        var val = cs.getPropertyValue(name);
        if (!val) continue;
        if (val === 'none' && /^(background-image|box-shadow|transform|text-decoration-line|stroke-dasharray)$/.test(name)) continue;
        if (val === 'auto' && /^(top|left|right|bottom|width|height|min-width|max-width|min-height|max-height|margin-top|margin-right|margin-bottom|margin-left|flex-basis)$/.test(name)) continue;
        if (val === 'normal' && /^(letter-spacing|word-spacing|font-style|line-height)$/.test(name)) continue;
        if (val === 'rgba(0, 0, 0, 0)' && name === 'background-color') continue;
        buf += name + ':' + val + ';';
      }
      // 原始内联样式放在最后，保证 left/top/width 以它为准
      d.setAttribute('style', buf + (d.getAttribute('style') || ''));
    }
  }

  function buildSvg(bounds, pad, scale, css) {
    var W = Math.ceil(bounds.w + pad * 2);
    var H = Math.ceil(bounds.h + pad * 2);

    var root = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    root.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    root.setAttribute('class', 'export-root');
    root.setAttribute('style',
      'position:relative;width:' + W + 'px;height:' + H + 'px;overflow:hidden;' +
      'background:' + getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() + ';' +
      themeVars()
    );

    var style = document.createElementNS('http://www.w3.org/1999/xhtml', 'style');
    style.textContent = css + '\n' +
      '.export-root .box{animation:none!important;}' +
      '.export-root .box-acts,.export-root .box-resize{display:none!important;}' +
      '.export-root .sel-frame{pointer-events:none;}' +
      '.export-root .box-body:focus{background:transparent!important;}' +
      '.export-root .thinking{display:none;}';
    root.appendChild(style);

    var host = document.createElementNS('http://www.w3.org/1999/xhtml', 'div');
    host.setAttribute('class', 'export-host');
    host.setAttribute('style',
      'position:absolute;left:' + (pad - bounds.x) + 'px;top:' + (pad - bounds.y) + 'px;' +
      'width:0;height:0;'
    );

    var layers = [
      document.getElementById('layerBoxes'),
      document.getElementById('layerSvg'),
      document.getElementById('layerFrames')
    ];

    layers.forEach(function (layer) {
      if (!layer) return;
      var clone = layer.cloneNode(true);
      // 关键：把计算样式逐条写成内联样式。
      // 浏览器把 SVG 当图片渲染时，foreignObject 里的 <style> 不生效。
      inlineStyles(layer, clone);
      clone.querySelectorAll('.merge-hint, .box-resize').forEach(function (n) { n.remove(); });
      clone.querySelectorAll('.box.dragging, .box.pulse, .box.sel, .stroke.sel').forEach(function (n) {
        n.classList.remove('dragging', 'pulse', 'sel');
      });
      clone.querySelectorAll('.preview').forEach(function (n) { n.remove(); });
      host.appendChild(clone);
    });

    root.appendChild(host);

    var xml = new XMLSerializer().serializeToString(root);

    return {
      svg: '<svg xmlns="http://www.w3.org/2000/svg" width="' + Math.round(W * scale) + '" height="' + Math.round(H * scale) +
        '" viewBox="0 0 ' + W + ' ' + H + '">' +
        '<foreignObject x="0" y="0" width="' + W + '" height="' + H + '">' +
        xml + '</foreignObject></svg>',
      W: W, H: H
    };
  }

  function rasterize(svgText, W, H, scale) {
    return new Promise(function (resolve, reject) {
      // 用 data: URL（blob: 会让 canvas 被标记为「跨源」，导出时会报 Tainted canvases）
      var url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgText);
      var img = new Image();

      img.onload = function () {
        try {
          var canvas = document.createElement('canvas');
          canvas.width = Math.round(W * scale);
          canvas.height = Math.round(H * scale);
          var ctx = canvas.getContext('2d');
          ctx.fillStyle = getComputedStyle(document.documentElement).getPropertyValue('--paper').trim() || '#fff';
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve(canvas);
        } catch (e) {
          reject(e);
        }
      };
      img.onerror = function () {
        reject(new Error('图片渲染失败'));
      };
      img.src = url;
    });
  }

  function downloadSVG(svgText) {
    var blob = new Blob([svgText], { type: 'image/svg+xml;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'huashuo-' + stamp() + '.svg';
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 400);
  }

  function download(canvas, name) {
    return new Promise(function (resolve) {
      try {
        canvas.toBlob(function (blob) {
          if (!blob) { resolve(false); return; }
          var a = document.createElement('a');
          var url = URL.createObjectURL(blob);
          a.href = url;
          a.download = name;
          document.body.appendChild(a);
          a.click();
          setTimeout(function () {
            URL.revokeObjectURL(url);
            a.remove();
            resolve(true);
          }, 400);
        }, 'image/png');
      } catch (e) {
        resolve(false);
      }
    });
  }

  var exporter = (EM.exporter = {
    /** 调试用：拿到生成的 SVG 源文本 */
    debugSVG: function () {
      var bounds = EM.canvas.contentBounds();
      return collectCSS().then(function (css) {
        return buildSvg(bounds, 56, 1, css).svg;
      });
    },

    /** 导出 ⑤ 画布为 PNG */
    exportPNG: function (opts) {
      opts = opts || {};
      if (!EM.state.boxes.length && !EM.state.strokes.length) {
        EM.toast('画布还是空的，先让 AI 生成几张卡片吧');
        return Promise.resolve(null);
      }

      EM.toast('正在把画布拼成图片…', { timeout: 1600 });

      var bounds = EM.canvas.contentBounds();
      if (bounds.empty) bounds = { x: 0, y: 0, w: 600, h: 400 };
      var pad = opts.pad == null ? 56 : opts.pad;
      var scale = opts.scale || 2;
      var built = null;

      return collectCSS().then(function (css) {
        built = buildSvg(bounds, pad, scale, css);
        return rasterize(built.svg, built.W, built.H, scale);
      }).then(function (canvas) {
        var name = 'huashuo-' + stamp() + '.png';
        return download(canvas, name).then(function (ok) {
          if (!ok) {
            downloadSVG(built.svg);
            EM.toast('这个浏览器不让直接存 PNG，已改成导出 SVG 图片');
            return canvas;
          }
          EM.toast('已导出图片：' + name);
          return canvas;
        });
      }).catch(function (err) {
        console.error(err);
        if (built) {
          downloadSVG(built.svg);
          EM.toast('导出 PNG 失败（' + (err.message || '未知原因') + '），已改成导出 SVG 图片');
        } else {
          EM.toast('导出失败：' + (err.message || '浏览器不支持'));
        }
        return null;
      });
    },

    /** 导出为可再导入的 JSON（备份用） */
    exportJSON: function () {
      var data = EM.state.snapshot();
      var blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'huashuo-' + stamp() + '.json';
      a.click();
      setTimeout(function () { URL.revokeObjectURL(a.href); }, 500);
    }
  });

  function stamp() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    return d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + '-' + p(d.getHours()) + p(d.getMinutes());
  }

})(typeof window !== 'undefined' ? window : globalThis);
