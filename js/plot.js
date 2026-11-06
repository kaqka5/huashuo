/* ============================================================
 * 画说 · plot.js
 * 函数图像：解析表达式 → 画成一张可以拖动的函数图卡片
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var U = EM.util;
  var SVGNS = 'http://www.w3.org/2000/svg';

  /* ============================================================
   * 1. 表达式 → 函数
   * ========================================================== */
  var FN1 = {
    sin: Math.sin, cos: Math.cos, tan: Math.tan, cot: function (x) { return 1 / Math.tan(x); },
    sec: function (x) { return 1 / Math.cos(x); }, csc: function (x) { return 1 / Math.sin(x); },
    asin: Math.asin, acos: Math.acos, atan: Math.atan,
    sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh,
    ln: Math.log, log: Math.log, lg: function (x) { return Math.log10(x); },
    log10: Math.log10, log2: Math.log2,
    sqrt: Math.sqrt, cbrt: Math.cbrt, abs: Math.abs, exp: Math.exp,
    floor: Math.floor, ceil: Math.ceil, round: Math.round,
    sign: Math.sign, trunc: Math.trunc
  };
  var CONST = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
  var usedY = false;

  function normalize(expr) {
    var s = String(expr == null ? '' : expr).trim();
    s = s.replace(/^[yY]\s*=\s*/, '')
      .replace(/^[fF]\s*\(\s*[xX]\s*\)\s*=\s*/, '')
      .replace(/\\left|\\right|\\,|\\;/g, '')
      .replace(/\\pi/g, 'pi')
      .replace(/\\cdot|·|×/g, '*')
      .replace(/÷/g, '/')
      .replace(/π/g, 'pi')
      .replace(/（/g, '(').replace(/）/g, ')')
      .replace(/，/g, ',')
      .replace(/[−–—]/g, '-')
      .replace(/\s+/g, '');
    return s;
  }

  function tokenize(s) {
    var out = [], i = 0;
    while (i < s.length) {
      var c = s[i];
      if (/[0-9.]/.test(c)) {
        var j = i;
        while (j < s.length && /[0-9.]/.test(s[j])) j++;
        // 科学计数法 1e-3
        if (s[j] === 'e' && /[0-9+-]/.test(s[j + 1] || '')) {
          j++;
          if (s[j] === '+' || s[j] === '-') j++;
          while (j < s.length && /[0-9]/.test(s[j])) j++;
        }
        out.push({ t: 'num', v: parseFloat(s.slice(i, j)) });
        i = j;
        continue;
      }
      if (/[a-zA-Z]/.test(c)) {
        var k = i;
        while (k < s.length && /[a-zA-Z0-9_]/.test(s[k])) k++;
        out.push({ t: 'id', v: s.slice(i, k).toLowerCase() });
        i = k;
        continue;
      }
      if ('+-*/^(),'.indexOf(c) >= 0) { out.push({ t: c }); i++; continue; }
      throw new Error('看不懂这个符号：' + c);
    }
    return splitIdentifier(out);
  }

  /* sinx / cos2x / lnx 这类连写，拆成 sin x 的形式 */
  function splitIdentifier(tokens) {
    var names = Object.keys(FN1).sort(function (a, b) { return b.length - a.length; });
    var out = [];

    tokens.forEach(function (t) {
      if (t.t !== 'id') { out.push(t); return; }
      var rest = t.v, guard = 0;

      while (rest.length && guard++ < 10) {
        var hit = null;
        for (var i = 0; i < names.length; i++) {
          if (rest.indexOf(names[i]) === 0) { hit = names[i]; break; }
        }
        if (hit) {
          out.push({ t: 'id', v: hit });
          rest = rest.slice(hit.length);
          continue;
        }
        var mNum = /^[0-9.]+/.exec(rest);
        if (mNum) {
          out.push({ t: 'num', v: parseFloat(mNum[0]) });
          rest = rest.slice(mNum[0].length);
          continue;
        }
        var m = /^[a-z]+/.exec(rest);
        var word = m ? m[0] : rest;
        out.push({ t: 'id', v: word });
        rest = rest.slice(word.length);
      }
    });
    return out;
  }

  function parse(tokens) {
    var pos = 0;

    function peek() { return tokens[pos]; }
    function eat(t) {
      if (tokens[pos] && tokens[pos].t === t) { pos++; return true; }
      return false;
    }

    function parseExpr() { return parseAdd(); }

    function parseAdd() {
      var left = parseMul();
      while (peek() && (peek().t === '+' || peek().t === '-')) {
        var op = tokens[pos++].t;
        var right = parseMul();
        left = op === '+' ? add(left, right) : sub(left, right);
      }
      return left;
    }

    function parseMul() {
      var left = parseUnary();
      while (peek()) {
        var t = peek().t;
        if (t === '*' || t === '/') {
          pos++;
          var right = parseUnary();
          left = t === '*' ? mul(left, right) : div(left, right);
        } else if (t === 'num' || t === 'id' || t === '(') {
          // 隐式乘法：2x、3(x+1)、x sin(x)
          var r2 = parseUnary();
          left = mul(left, r2);
        } else break;
      }
      return left;
    }

    function parseUnary() {
      if (eat('-')) return neg(parseUnary());
      if (eat('+')) return parseUnary();
      return parsePow();
    }

    function parsePow() {
      var base = parsePrimary();
      if (eat('^')) return pow(base, parseUnary());
      return base;
    }

    function parsePrimary() {
      var tk = peek();
      if (!tk) throw new Error('表达式没写完');

      if (tk.t === 'num') { pos++; return num(tk.v); }

      if (tk.t === '(') {
        pos++;
        var inner = parseExpr();
        if (!eat(')')) throw new Error('括号不配对');
        return inner;
      }

      if (tk.t === 'id') {
        pos++;
        var name = tk.v;

        /* sin x / ln x 这种不带括号的写法 */
        if (FN1[name] && !(tokens[pos] && tokens[pos].t === '(')) {
          var argM = parseMul();
          var fnM = FN1[name];
          return function (x, y) { return fnM(argM(x, y)); };
        }

        if (eat('(')) {
          var args = [parseExpr()];
          while (eat(',')) args.push(parseExpr());
          if (!eat(')')) throw new Error('函数括号不配对');
          if (name === 'pow' && args.length === 2) return pow(args[0], args[1]);
          if (name === 'max') return function (x, y) { return Math.max.apply(null, args.map(function (a) { return a(x, y); })); };
          if (name === 'min') return function (x, y) { return Math.min.apply(null, args.map(function (a) { return a(x, y); })); };
          if (name === 'atan2' && args.length === 2) return function (x, y) { return Math.atan2(args[0](x, y), args[1](x, y)); };
          if (!FN1[name]) throw new Error('不认识这个函数：' + name);
          var f = FN1[name], a0 = args[0];
          return function (x, y) { return f(a0(x, y)); };
        }
        if (name === 'x') return function (x) { return x; };
        if (name === 'y') { usedY = true; return function (x, y) { return y; }; }
        if (CONST[name] !== undefined) return num(CONST[name]);
        throw new Error('不认识这个字母：' + name);
      }

      throw new Error('表达式有问题');
    }

    var fn = parseExpr();
    if (pos < tokens.length) throw new Error('多出来一段：' + tokens[pos].v);
    return fn;
  }

  function num(v) { return function () { return v; }; }
  function add(a, b) { return function (x, y) { return a(x, y) + b(x, y); }; }
  function sub(a, b) { return function (x, y) { return a(x, y) - b(x, y); }; }
  function mul(a, b) { return function (x, y) { return a(x, y) * b(x, y); }; }
  function div(a, b) { return function (x, y) { return a(x, y) / b(x, y); }; }
  function pow(a, b) { return function (x, y) { return Math.pow(a(x, y), b(x, y)); }; }
  function neg(a) { return function (x, y) { return -a(x, y); }; }

  function compile(expr) {
    var s = normalize(expr);
    if (!s) throw new Error('还没写解析式');
    usedY = false;
    return parse(tokenize(s));
  }

  /** 含 y 的式子 → 三维曲面 z=f(x,y) */
  function compile3(expr) {
    var f = compile(expr);
    return { f: f, usesY: usedY };
  }

  /* ============================================================
   * 2. 画图
   * ========================================================== */
  var PAD = { l: 34, r: 14, t: 12, b: 24 };
  var VW = 428, VH = 250;

  function niceStep(range, target) {
    var raw = range / Math.max(1, target);
    var mag = Math.pow(10, Math.floor(Math.log10(raw)));
    var n = raw / mag;
    var step;
    if (n < 1.5) step = 1; else if (n < 3) step = 2; else if (n < 7) step = 5; else step = 10;
    return step * mag;
  }

  function fmtTick(v, step) {
    if (v === 0) return '0';
    var d = Math.max(0, -Math.floor(Math.log10(step)));
    var s = v.toFixed(Math.min(4, d));
    return s.replace(/\.0+$/, '').replace(/(\.\d*?)0+$/, '$1');
  }

  function sample(f, xmin, xmax) {
    var N = 720;
    var pts = [];
    for (var i = 0; i <= N; i++) {
      var x = xmin + (xmax - xmin) * i / N;
      var y;
      try { y = f(x); } catch (e) { y = NaN; }
      pts.push({ x: x, y: (typeof y === 'number' && isFinite(y)) ? y : null });
    }
    return pts;
  }

  function autoY(pts) {
    var ys = pts.filter(function (p) { return p.y != null; }).map(function (p) { return p.y; });
    if (!ys.length) return { min: -1, max: 1 };
    ys.sort(function (a, b) { return a - b; });
    // 去掉极端值（渐近线），用 2%~98% 分位
    var lo = ys[Math.floor(ys.length * 0.02)];
    var hi = ys[Math.floor(ys.length * 0.98)];
    if (!(hi > lo)) { lo -= 1; hi += 1; }
    var pad = (hi - lo) * 0.12 || 1;
    return { min: lo - pad, max: hi + pad };
  }

  function renderInto(svg, plot) {
    var f = plot.fn;
    var xmin = plot.xmin, xmax = plot.xmax;
    var pts = sample(f, xmin, xmax);

    var ymin = plot.ymin, ymax = plot.ymax;
    if (ymin == null || ymax == null) {
      var ay = autoY(pts);
      if (ymin == null) ymin = ay.min;
      if (ymax == null) ymax = ay.max;
      plot._autoY = { min: ymin, max: ymax };
    }
    if (!(ymax > ymin)) ymax = ymin + 1;

    var W = VW, H = VH;
    var iw = W - PAD.l - PAD.r, ih = H - PAD.t - PAD.b;

    function sx(x) { return PAD.l + (x - xmin) / (xmax - xmin) * iw; }
    function sy(y) { return PAD.t + (ymax - y) / (ymax - ymin) * ih; }

    var parts = [];

    /* 背景 */
    parts.push('<rect class="plot-bg" x="' + PAD.l + '" y="' + PAD.t + '" width="' + iw + '" height="' + ih + '" rx="3"/>');

    /* 网格 + 刻度 */
    var stx = niceStep(xmax - xmin, 7);
    var sty = niceStep(ymax - ymin, 5);
    var gx = [], gy = [];
    var x0 = Math.ceil(xmin / stx) * stx;
    for (var x = x0; x <= xmax + 1e-9; x += stx) gx.push(x);
    var y0 = Math.ceil(ymin / sty) * sty;
    for (var y = y0; y <= ymax + 1e-9; y += sty) gy.push(y);

    gx.forEach(function (v) {
      var px = sx(v);
      parts.push('<line class="plot-grid" x1="' + px + '" y1="' + PAD.t + '" x2="' + px + '" y2="' + (PAD.t + ih) + '"/>');
      parts.push('<text class="plot-tick" text-anchor="middle" x="' + px + '" y="' + (PAD.t + ih + 14) + '">' + fmtTick(v, stx) + '</text>');
    });
    gy.forEach(function (v) {
      var py = sy(v);
      parts.push('<line class="plot-grid" x1="' + PAD.l + '" y1="' + py + '" x2="' + (PAD.l + iw) + '" y2="' + py + '"/>');
      parts.push('<text class="plot-tick" text-anchor="end" x="' + (PAD.l - 6) + '" y="' + (py + 3.5) + '">' + fmtTick(v, sty) + '</text>');
    });

    /* 坐标轴 */
    if (ymin <= 0 && ymax >= 0) {
      var ay0 = sy(0);
      parts.push('<line class="plot-axis" x1="' + PAD.l + '" y1="' + ay0 + '" x2="' + (PAD.l + iw) + '" y2="' + ay0 + '"/>');
    }
    if (xmin <= 0 && xmax >= 0) {
      var ax0 = sx(0);
      parts.push('<line class="plot-axis" x1="' + ax0 + '" y1="' + PAD.t + '" x2="' + ax0 + '" y2="' + (PAD.t + ih) + '"/>');
    }

    /* 曲线 */
    var d = '', pen = false;
    var limit = (ymax - ymin) * 6;
    var prevY = null;
    pts.forEach(function (p) {
      if (p.y == null || Math.abs(p.y) > Math.abs(limit) + Math.abs(ymax) + 1e6) { pen = false; prevY = null; return; }
      // 渐近线：相邻两点跳得离谱就断开
      if (prevY != null && Math.abs(p.y - prevY) > limit) { pen = false; }
      var px = sx(p.x), py = sy(p.y);
      if (!pen) { d += 'M' + px.toFixed(2) + ' ' + py.toFixed(2); pen = true; }
      else d += 'L' + px.toFixed(2) + ' ' + py.toFixed(2);
      prevY = p.y;
    });
    parts.push('<path class="plot-curve" d="' + d + '"/>');

    /* 外框 */
    parts.push('<rect class="plot-frame" x="' + PAD.l + '" y="' + PAD.t + '" width="' + iw + '" height="' + ih + '" rx="3"/>');

    svg.setAttribute('viewBox', '0 0 ' + W + ' ' + H);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.innerHTML = parts.join('');

    return { ymin: ymin, ymax: ymax };
  }

  /* ============================================================
   * 2.5 三维曲面
   * ========================================================== */
  var VW3 = 428, VH3 = 300;

  function render3D(svg, plot) {
    var f = plot.fn;
    var N = 30;
    var xmin = plot.xmin, xmax = plot.xmax;
    var ymin = plot.ymin, ymax = plot.ymax;
    var zmin = plot.zmin, zmax = plot.zmax;

    /* 采样 */
    var grid = [];
    var zs = [];
    for (var i = 0; i <= N; i++) {
      var row = [];
      var x = xmin + (xmax - xmin) * i / N;
      for (var j = 0; j <= N; j++) {
        var y = ymin + (ymax - ymin) * j / N;
        var z;
        try { z = f(x, y); } catch (e) { z = NaN; }
        if (typeof z !== 'number' || !isFinite(z)) z = null;
        else zs.push(z);
        row.push({ x: x, y: y, z: z });
      }
      grid.push(row);
    }

    if (!zs.length) return null;

    if (zmin == null || zmax == null) {
      zs.sort(function (a, b) { return a - b; });
      var lo = zs[Math.floor(zs.length * 0.03)];
      var hi = zs[Math.floor(zs.length * 0.97)];
      if (!(hi > lo)) { lo -= 1; hi += 1; }
      var padz = (hi - lo) * 0.08 || 1;
      zmin = lo - padz; zmax = hi + padz;
    }
    plot.zmin = zmin; plot.zmax = zmax;

    var yaw = plot.yaw == null ? -0.62 : plot.yaw;
    var pitch = plot.pitch == null ? 0.62 : plot.pitch;
    var zoom = plot.zoom == null ? 1 : plot.zoom;

    var cx = Math.cos(yaw), sx = Math.sin(yaw);
    var sp = Math.sin(pitch), cp = Math.cos(pitch);

    /* 世界坐标 → 屏幕（正交投影） */
    var span = Math.max(xmax - xmin, ymax - ymin) || 1;
    var scale = (VW3 * 0.38 / span) * zoom;
    var ox = VW3 / 2, oy = VH3 / 2 + (VH3 * 0.06);

    function project(x, y, z) {
      var xn = (x - (xmin + xmax) / 2) / span;
      var yn = (y - (ymin + ymax) / 2) / span;
      var zn = (z - (zmin + zmax) / 2) / ((zmax - zmin) || 1) * 0.62;
      var xr = xn * cx - yn * sx;
      var yr = xn * sx + yn * cx;
      return {
        sx: ox + xr * span * scale,
        sy: oy + (yr * sp - zn * cp) * span * scale,
        depth: yr * cp + zn * sp
      };
    }

    /* 面片 */
    var faces = [];
    for (var a = 0; a < N; a++) {
      for (var bb = 0; bb < N; bb++) {
        var p0 = grid[a][bb], p1 = grid[a + 1][bb], p2 = grid[a + 1][bb + 1], p3 = grid[a][bb + 1];
        if (p0.z == null || p1.z == null || p2.z == null || p3.z == null) continue;
        var q0 = project(p0.x, p0.y, p0.z);
        var q1 = project(p1.x, p1.y, p1.z);
        var q2 = project(p2.x, p2.y, p2.z);
        var q3 = project(p3.x, p3.y, p3.z);
        var zavg = (p0.z + p1.z + p2.z + p3.z) / 4;
        faces.push({
          d: 'M' + q0.sx.toFixed(1) + ' ' + q0.sy.toFixed(1) +
            'L' + q1.sx.toFixed(1) + ' ' + q1.sy.toFixed(1) +
            'L' + q2.sx.toFixed(1) + ' ' + q2.sy.toFixed(1) +
            'L' + q3.sx.toFixed(1) + ' ' + q3.sy.toFixed(1) + 'Z',
          depth: (q0.depth + q1.depth + q2.depth + q3.depth) / 4,
          t: (zavg - zmin) / ((zmax - zmin) || 1)
        });
      }
    }
    faces.sort(function (p, q) { return q.depth - p.depth; });

    var parts = [];
    parts.push('<rect class="plot-bg" x="0" y="0" width="' + VW3 + '" height="' + VH3 + '" rx="4"/>');

    faces.forEach(function (p) {
      var t = Math.min(1, Math.max(0, p.t));
      var hue = 210 - 200 * t;
      parts.push('<path class="surf-face" data-t="' + t.toFixed(3) + '" d="' + p.d +
        '" fill="hsl(' + hue.toFixed(0) + ',62%,' + (58 - 6 * t).toFixed(0) + '%)"/>');
    });

    /* 坐标轴 */
    var ax = [];
    function line(x1, y1, z1, x2, y2, z2, cls) {
      var p = project(x1, y1, z1), q = project(x2, y2, z2);
      ax.push('<line class="' + cls + '" x1="' + p.sx.toFixed(1) + '" y1="' + p.sy.toFixed(1) +
        '" x2="' + q.sx.toFixed(1) + '" y2="' + q.sy.toFixed(1) + '"/>');
      return { p: p, q: q };
    }
    var zb = zmin;
    line(xmin, ymin, zb, xmax, ymin, zb, 'plot-axis3');
    line(xmin, ymin, zb, xmin, ymax, zb, 'plot-axis3');
    line(xmin, ymin, zb, xmin, ymin, zmax, 'plot-axis3');
    line(xmax, ymin, zb, xmax, ymax, zb, 'plot-grid3');
    line(xmin, ymax, zb, xmax, ymax, zb, 'plot-grid3');
    line(xmin, ymax, zb, xmin, ymax, zmin + (zmax - zmin) * 0.98, 'plot-grid3');
    line(xmax, ymin, zmax, xmax, ymax, zmax, 'plot-grid3');
    line(xmax, ymin, zb, xmin, ymin, zmax, 'plot-grid3');

    var lx = project(xmax, ymin, zb), ly = project(xmin, ymax, zb), lz = project(xmin, ymin, zmax);
    ax.push('<text class="plot-tick3" text-anchor="middle" x="' + lx.sx + '" y="' + (lx.sy + 12) + '">x</text>');
    ax.push('<text class="plot-tick3" text-anchor="middle" x="' + ly.sx + '" y="' + (ly.sy + 12) + '">y</text>');
    ax.push('<text class="plot-tick3" text-anchor="middle" x="' + lz.sx + '" y="' + (lz.sy - 6) + '">z</text>');

    /* 坐标轴画在面之前 */
    parts.splice(1, 0, ax.join(''));

    svg.setAttribute('viewBox', '0 0 ' + VW3 + ' ' + VH3);
    svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
    svg.innerHTML = parts.join('');
    return { zmin: zmin, zmax: zmax };
  }

  /* ============================================================
   * 3. 卡片
   * ========================================================== */
  /* 把框选到的一段式子擦干净，交给解析器 */
  function cleanExpr(t) {
    var s = String(t || '');
    s = s.replace(/\$/g, '')
      .replace(/\\left|\\right|\\,|\\;|\\:|\\!|\\quad|\\qquad/g, '')
      .replace(/\\mathrm|\\text/g, '')
      .replace(/\\[dt]?frac\s*\{([^{}]*)\}\s*\{([^{}]*)\}/g, '(($1)/($2))')
      .replace(/\\sqrt\s*\[([^\]]*)\]\s*\{([^{}]*)\}/g, '($2)^(1/($1))')
      .replace(/\\sqrt\s*\{([^{}]*)\}/g, 'sqrt($1)')
      .replace(/\\(sin|cos|tan|cot|sec|csc|arcsin|arccos|arctan|ln|log|exp|abs)\b/g, '$1')
      .replace(/\\pi/g, 'pi')
      .replace(/\^\{([^{}]*)\}/g, '^($1)')
      .replace(/_\{([^{}]*)\}/g, '$1')
      .replace(/[−–—]/g, '-')
      .replace(/[×·]/g, '*')
      .replace(/÷/g, '/')
      .replace(/[，。；;、,]+$/g, '')
      .replace(/\s+/g, '')
      .replace(/^(y|z|f\(x\)|f\(x,y\))=/i, '');
    return s;
  }

  var plot = (EM.plot = {
    compile: compile,
    compile3: compile3,
    cleanExpr: cleanExpr,

    /** 标题里显示得好看一点：去掉多余的括号、把 ^(2) 写成 ^2 */
    pretty: function (expr) {
      return String(expr || '')
        .replace(/^[yz]\s*=\s*/i, '')
        .replace(/\^\(([-0-9.]+)\)/g, '^$1')
        .replace(/\s+/g, '');
    },

    /** 从一段框选文字里挑出最像解析式的那一段；挑不出就返回 null */
    extractExpr: function (text) {
      var raw = String(text || '');
      var cands = [];

      /* 先试 $...$ 里的 */
      var m = raw.match(/\$([^$]+)\$/g) || [];
      m.forEach(function (s) { cands.push(cleanExpr(s)); });

      cands.push(cleanExpr(raw));

      /* 再试里面像式子的片段，以及相邻几段拼起来的 */
      var cleaned = cleanExpr(raw);
      var frags = cleaned.match(/[0-9a-zA-Z+\-*/^().]+/g) || [];
      frags.forEach(function (frag, i) {
        if (frag.length > 2 && /[xy]/.test(frag)) cands.push(frag);
        var joined = frags.slice(i, i + 4).join('');
        if (joined.length > 2 && /[xy]/.test(joined)) cands.push(joined);
      });

      for (var i = 0; i < cands.length; i++) {
        var c = cands[i];
        if (!c) continue;
        try { compile3(c); return c; } catch (e) { /* 试下一个 */ }
      }
      return null;
    },

    render: function (b, host) {
      if (!host || !b.plot) return;
      var p = b.plot;
      var svg = host.querySelector('svg');
      if (!svg) {
        svg = document.createElementNS(SVGNS, 'svg');
        svg.setAttribute('class', 'plot-svg');
        host.innerHTML = '';
        host.appendChild(svg);
      }
      try {
        p.fn = compile(p.expr);
      } catch (e) {
        host.innerHTML = '<div class="plot-err">' + U.esc(e.message) + '</div>';
        return;
      }
      if (p.mode === '3d') {
        var r3 = render3D(svg, p);
        if (!r3) { host.innerHTML = '<div class="plot-err">这个范围内没有可画的曲面</div>'; return; }
      } else {
        var r = renderInto(svg, p);
        p.ymin = r.ymin;
        p.ymax = r.ymax;
      }
      host.dataset.ready = '1';
    },

    /** 建一张函数图 / 曲面图卡片 */
    create: function (expr, opts) {
      opts = opts || {};
      var probe;
      try { probe = compile3(expr); } catch (e) { EM.toast('解析式有问题：' + e.message); return null; }

      var mode = opts.mode || (probe.usesY ? '3d' : '2d');
      var xmin = -6, xmax = 6;
      if (opts.xmin != null && opts.xmax != null && opts.xmax > opts.xmin) {
        xmin = opts.xmin; xmax = opts.xmax;
      }

      var pdata = {
        expr: expr, mode: mode,
        xmin: xmin, xmax: xmax,
        ymin: mode === '3d' ? xmin : null,
        ymax: mode === '3d' ? xmax : null,
        zmin: null, zmax: null,
        yaw: -0.62, pitch: 0.62, zoom: 1
      };

      var spot = opts.spot || EM.canvas.freeSpot(EM.boxes.BOX_W, mode === '3d' ? 430 : 340, opts.at || EM.boxes.stackAnchor());
      var b = EM.boxes.create({
        kind: 'plot',
        x: spot.x,
        y: spot.y,
        w: EM.boxes.BOX_W,
        title: opts.title || ((mode === '3d' ? '曲面图 · z=' : '函数图 · y=') + plot.pretty(expr)),
        tag: mode === '3d' ? '曲面' : '图像',
        plot: pdata,
        html: ''
      });

      var el = EM.boxes.getEl(b.id);
      var host = el && el.querySelector('.plot-body');
      if (host) {
        plot.render(b, host);
        b.h = el.offsetHeight;
        EM.canvas.expandTo({ x: b.x, y: b.y, w: b.w, h: b.h }, { pad: 220 });
      }
      EM.history.push('画函数图');
      EM.persist.schedule();

      setTimeout(function () {
        EM.canvas.focusRect({ x: b.x, y: b.y, w: b.w, h: b.h || 320 }, { keepZoom: true, duration: 380 });
        var e2 = EM.boxes.getEl(b.id);
        if (e2) { e2.classList.add('pulse'); setTimeout(function () { e2.classList.remove('pulse'); }, 900); }
      }, 80);

      return b;
    },

    /* ---------------- 弹窗 ---------------- */
    openDialog: function (opts) {
      opts = opts || {};
      var editing = opts.box || null;
      var cur = editing && editing.plot ? editing.plot.expr : (opts.expr || '');
      var initMode = editing && editing.plot ? (editing.plot.mode || '2d') : (opts.mode || '2d');

      var examples = ['x^2-2x-3', 'sin(x)', 'e^(-x^2)', '1/x', 'sqrt(x)', 'ln(x)', 'x^2+y^2', 'sin(x)*cos(y)', 'x^2-y^2'];

      EM.modal.open(
        '<button class="x" data-close>×</button>' +
        '<h2>画函数图像</h2>' +
        '<p class="m-sub">二维写 y=f(x)，三维写 z=f(x,y)。也可以先用工具栏的「函数图」在卡片里框住一段式子，它会自动带进来。</p>' +
        '<label class="m-label">解析式</label>' +
        '<input class="m-input" id="plotExpr" data-autofocus spellcheck="false" placeholder="例如：x^2-2x-3 或 x^2+y^2" value="' + U.esc(cur) + '">' +
        '<div class="plot-chips" id="plotChips">' +
        examples.map(function (e) { return '<button class="chip-sm" data-ex="' + U.esc(e) + '">' + U.esc(e) + '</button>'; }).join('') +
        '</div>' +
        '<div class="row gap" style="margin-top:14px;align-items:center">' +
        '<div class="seg" id="plotMode">' +
        '<button data-mode="2d">二维 y=f(x)</button>' +
        '<button data-mode="3d">三维 z=f(x,y)</button>' +
        '</div>' +
        '<label class="field inline" style="margin-left:auto"><span>范围</span>' +
        '<input class="m-input sm" id="plotXmin" value="-6">' +
        '<span>到</span>' +
        '<input class="m-input sm" id="plotXmax" value="6"></label>' +
        '</div>' +
        '<div class="plot-preview" id="plotPreview"></div>' +
        '<div class="modal-foot">' +
        '<button class="btn" data-close>取消</button>' +
        '<button class="btn primary" id="plotOk">' + (editing ? '更新' : '画出来') + '</button>' +
        '</div>',
        function (root) {
          var input = root.querySelector('#plotExpr');
          var preview = root.querySelector('#plotPreview');
          var xminEl = root.querySelector('#plotXmin');
          var xmaxEl = root.querySelector('#plotXmax');
          var modeSeg = root.querySelector('#plotMode');
          var mode = initMode;
          var userPicked = !!initMode;

          function paintMode() {
            modeSeg.querySelectorAll('button').forEach(function (b) {
              b.classList.toggle('on', b.dataset.mode === mode);
            });
          }
          paintMode();

          modeSeg.querySelectorAll('button').forEach(function (b) {
            b.addEventListener('click', function () {
              mode = b.dataset.mode;
              userPicked = true;
              paintMode();
              updatePreview();
            });
          });

          function range() {
            var a = Number(xminEl.value), b = Number(xmaxEl.value);
            if (!isFinite(a) || !isFinite(b) || b <= a) return [-6, 6];
            return [a, b];
          }

          function updatePreview() {
            var expr = input.value.trim();
            if (!expr) { preview.innerHTML = ''; return; }
            if (!preview.querySelector('svg')) preview.innerHTML = '<svg class="plot-svg"></svg>';
            var svg = preview.querySelector('svg');
            var rg = range();
            try {
              var probe = compile3(expr);
              if (!userPicked && probe.usesY) { mode = '3d'; paintMode(); }
              if (mode === '3d') {
                render3D(svg, {
                  fn: probe.f, xmin: rg[0], xmax: rg[1], ymin: rg[0], ymax: rg[1],
                  zmin: null, zmax: null, yaw: -0.62, pitch: 0.62, zoom: 1
                });
              } else {
                renderInto(svg, { fn: probe.f, xmin: rg[0], xmax: rg[1], ymin: null, ymax: null });
              }
              preview.classList.remove('bad');
            } catch (e) {
              preview.innerHTML = '<div class="plot-err">' + U.esc(e.message) + '</div>';
              preview.classList.add('bad');
            }
          }

          input.addEventListener('input', U.debounce(updatePreview, 220));
          xminEl.addEventListener('input', U.debounce(updatePreview, 300));
          xmaxEl.addEventListener('input', U.debounce(updatePreview, 300));

          root.querySelectorAll('#plotChips .chip-sm').forEach(function (b) {
            b.addEventListener('click', function () {
              input.value = b.dataset.ex;
              userPicked = false;
              updatePreview();
              input.focus();
            });
          });

          root.querySelectorAll('[data-close]').forEach(function (b) {
            b.addEventListener('click', function () { EM.modal.close(); });
          });

          root.querySelector('#plotOk').addEventListener('click', function () {
            var expr = input.value.trim();
            if (!expr) { EM.toast('先写一个解析式'); return; }
            try { compile(expr); } catch (e) { EM.toast('解析式有问题：' + e.message); return; }
            var rg = range();
            EM.modal.close();

            if (editing) {
              EM.history.push('改函数图');
              editing.plot.expr = expr;
              editing.plot.mode = mode;
              editing.plot.xmin = rg[0];
              editing.plot.xmax = rg[1];
              editing.plot.ymin = mode === '3d' ? rg[0] : null;
              editing.plot.ymax = mode === '3d' ? rg[1] : null;
              editing.plot.zmin = null;
              editing.plot.zmax = null;
              editing.title = (mode === '3d' ? '曲面图 · z=' : '函数图 · y=') + expr;
              editing.tag = mode === '3d' ? '曲面' : '图像';
              var el = EM.boxes.getEl(editing.id);
              if (el) {
                var t = el.querySelector('.box-title');
                if (t) t.textContent = editing.title;
                var tg = el.querySelector('.box-tag');
                if (tg) tg.textContent = editing.tag;
                plot.render(editing, el.querySelector('.plot-body'));
                editing.h = el.offsetHeight;
              }
              EM.persist.schedule();
            } else {
              var spot = opts.near ? EM.boxes.sideAnchor(opts.near, opts.near.y + 30) : null;
              plot.create(expr, { xmin: rg[0], xmax: rg[1], mode: mode, spot: spot });
            }
          });

          input.addEventListener('keydown', function (e) {
            if (e.key === 'Enter') { e.preventDefault(); root.querySelector('#plotOk').click(); }
          });

          if (cur) updatePreview();
          setTimeout(function () { input.focus(); input.select && input.select(); }, 60);
        }
      );
    },

    /** 从一段文字里找可画的式子 */
    detect: function (text) {
      var t = String(text || '');
      var m = t.match(/(?:^|[\s，,。；;])(y|f\s*\(\s*x\s*\))\s*=\s*([0-9a-zA-Z+\-*/^().\s]{2,60})/);
      if (!m) return null;
      var expr = m[2].trim().replace(/[，,。；;]$/, '');
      if (!/[x]/.test(expr)) return null;
      try { compile(expr); return expr; } catch (e) { return null; }
    }
  });

})(typeof window !== 'undefined' ? window : globalThis);