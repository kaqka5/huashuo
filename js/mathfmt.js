/* ============================================================
 * Branch · mathfmt.js
 * 轻量 LaTeX 排版：把常见数学写法转成 HTML（不联网、不依赖 KaTeX）
 * 支持 \frac \sqrt[n]{} ^ _ \text \mathbf \vec \overline
 *      \begin{cases} / matrix / aligned、希腊字母与常用符号
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});

  var SYMBOLS = {
    /* 希腊字母 */
    alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', varepsilon: 'ε',
    zeta: 'ζ', eta: 'η', theta: 'θ', vartheta: 'ϑ', iota: 'ι', kappa: 'κ',
    lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', omicron: 'ο', pi: 'π', varpi: 'ϖ',
    rho: 'ρ', varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ',
    phi: 'φ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
    Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π',
    Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',

    /* 关系 / 运算 */
    le: '≤', leq: '≤', ge: '≥', geq: '≥', ne: '≠', neq: '≠', approx: '≈',
    equiv: '≡', cong: '≅', sim: '∼', simeq: '≃', propto: '∝', ll: '≪', gg: '≫',
    lt: '<', gt: '>', leqslant: '⩽', geqslant: '⩾',
    pm: '±', mp: '∓', times: '×', div: '÷', cdot: '·', ast: '∗',
    cup: '∪', cap: '∩', setminus: '∖', backslash: '＼',
    subset: '⊂', supset: '⊃', subseteq: '⊆', supseteq: '⊇', subsetneq: '⊊',
    in: '∈', notin: '∉', ni: '∋', emptyset: '∅', varnothing: '∅',
    forall: '∀', exists: '∃', nexists: '∄', neg: '¬', land: '∧', lor: '∨',
    oplus: '⊕', otimes: '⊗', odot: '⊙', circ: '∘',
    perp: '⊥', parallel: '∥', nparallel: '∦', angle: '∠', measuredangle: '∡',
    triangle: '△', square: '□', diamond: '⋄', bigcirc: '○',
    therefore: '∴', because: '∵',
    infty: '∞', partial: '∂', nabla: '∇', surd: '√',
    sum: '∑', prod: '∏', coprod: '∐', int: '∫', iint: '∬', iiint: '∭', oint: '∮',
    prime: '′', backprime: '‵', degree: '°', '°': '°',
    cdots: '⋯', ldots: '…', dots: '…', vdots: '⋮', ddots: '⋱',
    to: '→', rightarrow: '→', longrightarrow: '⟶', leftarrow: '←',
    longleftarrow: '⟵', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐',
    Leftrightarrow: '⇔', implies: '⟹', iff: '⟺', mapsto: '↦', uparrow: '↑',
    downarrow: '↓', nearrow: '↗', searrow: '↘', rightleftharpoons: '⇌',
    star: '⋆', bullet: '∙', checkmark: '✓', degrees: '°', degree2: '°',

    /* 空格类 */
    quad: '\u2003', qquad: '\u2003\u2003', enspace: '\u2002', thinspace: '\u2009'
  };

  /* 函数名 —— 用正体，前面补个空格 */
  var FUNCS = {
    sin: 1, cos: 1, tan: 1, cot: 1, sec: 1, csc: 1,
    arcsin: 1, arccos: 1, arctan: 1, sinh: 1, cosh: 1, tanh: 1,
    log: 1, ln: 1, lg: 1, exp: 1, lim: 1, limsup: 1, liminf: 1,
    max: 1, min: 1, sup: 1, inf: 1, det: 1, dim: 1, ker: 1,
    mod: 1, gcd: 1, lcm: 1, arg: 1, deg: 1, Pr: 1
  };

  var UNITS = {
    cm: 'cm', mm: 'mm', pt: 'pt', em: 'em', ex: 'ex', mu: 'mu', px: 'px',
    alpha2: '', deg: '°'
  };

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /* ---------- 读一个组 ---------- */
  function readGroup(s, i) {
    if (s[i] === '{') {
      var depth = 0, start = i + 1;
      for (var k = i; k < s.length; k++) {
        if (s[k] === '\\') { k++; continue; }
        if (s[k] === '{') depth++;
        else if (s[k] === '}') {
          depth--;
          if (depth === 0) return { body: s.slice(start, k), next: k + 1 };
        }
      }
      return { body: s.slice(start), next: s.length };
    }
    if (s[i] === '\\') {
      var j = i + 1;
      if (/[A-Za-z]/.test(s[j] || '')) {
        while (j < s.length && /[A-Za-z]/.test(s[j])) j++;
      } else j++;
      return { body: s.slice(i, j), next: j };
    }
    return { body: s[i] || '', next: i + 1 };
  }

  function skipSpace(s, i) { while (i < s.length && s[i] === ' ') i++; return i; }

  /* ---------- 环境（cases / matrix / aligned） ---------- */
  function readEnv(s, i) {
    // s[i..] 是 \begin{name}
    var g = readGroup(s, i + 6);
    var name = g.body.trim();
    var endTag = '\\end{' + name + '}';
    var endPos = s.indexOf(endTag, g.next);
    if (endPos < 0) endPos = s.length;
    return {
      name: name,
      body: s.slice(g.next, endPos),
      next: Math.min(s.length, endPos + endTag.length)
    };
  }

  function splitTop(str, sep) {
    var out = [], buf = '', depth = 0;
    for (var i = 0; i < str.length; i++) {
      var c = str[i];
      if (c === '\\') {
        var two = str.slice(i, i + 2);
        if (two === sep && depth === 0) { out.push(buf); buf = ''; i++; continue; }
        buf += two; i++; continue;
      }
      if (c === '{') depth++;
      else if (c === '}') depth--;
      if (c === sep && depth === 0) { out.push(buf); buf = ''; continue; }
      buf += c;
    }
    out.push(buf);
    return out;
  }

  function renderEnv(env) {
    var rows = splitTop(env.body, '\\\\').map(function (r) { return r.trim(); })
      .filter(function (r, i, a) { return r.length || i < a.length - 1; });
    var name = env.name;
    var cellHtml = rows.map(function (row) {
      var cells = splitTop(row, '&');
      return cells.map(function (c) { return '<span class="mx-cell">' + render(c.trim()) + '</span>'; }).join('');
    });

    if (/cases|dcases/.test(name)) {
      return '<span class="mx mx-cases"><span class="mx-brace">{</span><span class="mx-table">' +
        cellHtml.map(function (r) { return '<span class="mx-row">' + r + '</span>'; }).join('') +
        '</span></span>';
    }
    if (/matrix/.test(name)) {
      var withDelim = name.indexOf('p') === 0 ? 'p' : name.indexOf('b') === 0 ? 'b' : name.indexOf('v') === 0 ? 'v' : '';
      var open = withDelim === 'p' ? '(' : withDelim === 'b' ? '[' : withDelim === 'v' ? '|' : '';
      var close = withDelim === 'p' ? ')' : withDelim === 'b' ? ']' : withDelim === 'v' ? '|' : '';
      return '<span class="mx mx-matrix">' + (open ? '<span class="mx-brace">' + open + '</span>' : '') +
        '<span class="mx-table">' + cellHtml.map(function (r) { return '<span class="mx-row">' + r + '</span>'; }).join('') +
        '</span>' + (close ? '<span class="mx-brace">' + close + '</span>' : '') + '</span>';
    }
    if (/align|alignat|gather|split|array/.test(name)) {
      return '<span class="mx mx-table mx-stack">' + cellHtml.map(function (r) { return '<span class="mx-row">' + r + '</span>'; }).join('') + '</span>';
    }
    return '<span class="mx mx-table">' + cellHtml.map(function (r) { return '<span class="mx-row">' + r + '</span>'; }).join('') + '</span>';
  }

  /* ---------- 主渲染 ---------- */
  var STRIP_CMDS = {
    displaystyle: 1, textstyle: 1, scriptstyle: 1, limits: 1, nolimits: 1,
    mathstrut: 1, strut: 1, hfill: 1, hfil: 1, nonumber: 1, notag: 1,
    middle: 0, small: 1, footnotesize: 1, large: 1, Large: 1, normalsize: 1
  };

  function render(src) {
    var s = String(src == null ? '' : src);
    var out = '', buf = '', i = 0;

    function flush() { if (buf) { out += esc(buf); buf = ''; } }
    function push(html) { flush(); out += html; }

    while (i < s.length) {
      var ch = s[i];

      /* ------- 命令 ------- */
      if (ch === '\\') {
        var j = i + 1, name = '';
        if (/[A-Za-z]/.test(s[j] || '')) {
          while (j < s.length && /[A-Za-z]/.test(s[j])) { name += s[j]; j++; }
        } else {
          name = s[j] || ''; j++;
        }

        /* 换行、转义符号 */
        if (name === '\\') { push('<br>'); i = j; continue; }
        if (name === '{' || name === '}' || name === '%' || name === '&' ||
            name === '#' || name === '$' || name === '_') { buf += name; i = j; continue; }
        if (name === ' ') { buf += ' '; i = j; continue; }
        if (name === ',' || name === ';' || name === ':' || name === '!') {
          buf += name === '!' ? '' : '\u2009'; i = j; continue;
        }

        /* 分数 */
        if (name === 'frac' || name === 'dfrac' || name === 'tfrac' || name === 'cfrac') {
          var g1 = readGroup(s, skipSpace(s, j));
          var g2 = readGroup(s, skipSpace(s, g1.next));
          var big = name === 'dfrac' || name === 'cfrac';
          push('<span class="frac' + (big ? ' big' : '') + '"><span class="num">' + render(g1.body) +
            '</span><span class="den">' + render(g2.body) + '</span></span>');
          i = g2.next; continue;
        }
        if (name === 'binom' || name === 'dbinom' || name === 'tbinom') {
          var b1 = readGroup(s, skipSpace(s, j));
          var b2 = readGroup(s, skipSpace(s, b1.next));
          push('<span class="binom"><span class="num">' + render(b1.body) + '</span><span class="den">' + render(b2.body) + '</span></span>');
          i = b2.next; continue;
        }

        /* 根号 */
        if (name === 'sqrt') {
          var k = skipSpace(s, j), idx = null;
          if (s[k] === '[') {
            var close = s.indexOf(']', k);
            if (close > 0) { idx = s.slice(k + 1, close); k = close + 1; }
          }
          var gs = readGroup(s, skipSpace(s, k));
          push('<span class="radical">' +
            (idx != null ? '<span class="rootidx">' + render(idx) + '</span>' : '') +
            '<span class="rad-sym">√</span><span class="radicand">' + render(gs.body) + '</span></span>');
          i = gs.next; continue;
        }

        /* 文字 / 字体 */
        if (name === 'text' || name === 'textrm' || name === 'mbox' || name === 'textnormal' ||
            name === 'operatorname' || name === 'textup') {
          var gt = readGroup(s, j);
          push('<span class="upright">' + esc(gt.body).replace(/\\%/g, '%') + '</span>');
          i = gt.next; continue;
        }
        if (name === 'mathrm' || name === 'mathsf' || name === 'mathtt' || name === 'mathit') {
          var gm = readGroup(s, j);
          push('<span class="upright">' + render(gm.body) + '</span>');
          i = gm.next; continue;
        }
        if (name === 'mathbf' || name === 'textbf' || name === 'boldsymbol' || name === 'bm' || name === 'pmb') {
          var gb = readGroup(s, j);
          push('<span class="mbf">' + render(gb.body) + '</span>');
          i = gb.next; continue;
        }
        if (name === 'mathbb') {
          var gmb = readGroup(s, j);
          push('<span class="mbb">' + render(gmb.body) + '</span>');
          i = gmb.next; continue;
        }
        if (name === 'mathcal' || name === 'mathscr') {
          var gc = readGroup(s, j);
          push('<span class="mcal">' + render(gc.body) + '</span>');
          i = gc.next; continue;
        }

        /* 装饰 */
        if (name === 'vec' || name === 'overrightarrow' || name === 'overleftarrow') {
          var gv = readGroup(s, j);
          push('<span class="vec">' + render(gv.body) + '</span>');
          i = gv.next; continue;
        }
        if (name === 'bar' || name === 'overline' || name === 'underline' || name === 'hat' ||
            name === 'widehat' || name === 'tilde' || name === 'widetilde' || name === 'dot' || name === 'ddot') {
          var gd = readGroup(s, j);
          var cls = (name === 'bar' || name === 'overline') ? 'ovl'
            : name === 'underline' ? 'unl'
              : name === 'hat' || name === 'widehat' ? 'hat'
                : name === 'tilde' || name === 'widetilde' ? 'tld'
                  : name === 'dot' ? 'dot' : 'ddot';
          push('<span class="' + cls + '">' + render(gd.body) + '</span>');
          i = gd.next; continue;
        }

        /* 尺寸 / 括号 */
        if (name === 'left' || name === 'right') {
          i = skipSpace(s, j);
          var d = s[i];
          if (d === '.') { i++; continue; }
          if (d === '\\') {
            var dm = '';
            i++;
            while (i < s.length && /[A-Za-z]/.test(s[i])) { dm += s[i]; i++; }
            if (dm === 'langle') push('<span class="delim">⟨</span>');
            else if (dm === 'rangle') push('<span class="delim">⟩</span>');
            else if (dm === 'lbrace') push('<span class="delim">{</span>');
            else if (dm === 'rbrace') push('<span class="delim">}</span>');
            else if (dm === 'vert' || dm === 'lvert') push('<span class="delim">|</span>');
            else if (dm === 'rvert') push('<span class="delim">|</span>');
            else if (dm === 'Vert') push('<span class="delim">‖</span>');
            else if (dm === 'lfloor') push('<span class="delim">⌊</span>');
            else if (dm === 'rfloor') push('<span class="delim">⌋</span>');
            else if (dm === 'lceil') push('<span class="delim">⌈</span>');
            else if (dm === 'rceil') push('<span class="delim">⌉</span>');
            continue;
          }
          push('<span class="delim">' + esc(d) + '</span>');
          i++; continue;
        }
        if (name === 'big' || name === 'Big' || name === 'bigg' || name === 'Bigg' ||
            name === 'bigl' || name === 'bigr' || name === 'Bigl' || name === 'Bigr') {
          i = skipSpace(s, j); continue;
        }

        /* 环境 */
        if (name === 'begin') {
          var env = readEnv(s, i);
          push(renderEnv(env));
          i = env.next; continue;
        }
        if (name === 'end') {
          var ge = readGroup(s, j);
          i = ge.next; continue;
        }

        /* 样式指令：直接跳过 */
        if (STRIP_CMDS[name] !== undefined) { i = j; continue; }

        if (name === 'color' || name === 'textcolor' || name === 'colorbox') {
          var gc2 = readGroup(s, j);
          if (name === 'color') { i = gc2.next; continue; }
          var gc3 = readGroup(s, gc2.next);
          push(render(gc3.body));
          i = gc3.next; continue;
        }
        if (name === 'phantom' || name === 'hphantom' || name === 'vphantom') {
          var gp = readGroup(s, j);
          i = gp.next; continue;
        }

        /* 函数名 */
        if (FUNCS[name]) {
          if (/[A-Za-z0-9]$/.test(buf)) buf += ' ';
          push('<span class="fn">' + name + '</span>');
          i = j;
          if (s[i] === ' ') i++;
          continue;
        }

        /* 符号表 */
        if (SYMBOLS[name] !== undefined) {
          if (/[A-Za-z0-9]$/.test(buf) && /^[A-Za-z]+$/.test(name) && name.length > 1 &&
              !/^(pi|alpha|lambda)$/.test(name)) { /* 保持原样 */ }
          buf += SYMBOLS[name];
          i = j;
          if (s[i] === ' ') i++;
          continue;
        }

        /* 未知命令：原样输出名字 */
        buf += name;
        i = j;
        continue;
      }

      /* ------- 上下标 ------- */
      if (ch === '^' || ch === '_') {
        var gsu = readGroup(s, i + 1);
        push(ch === '^' ? '<sup>' + render(gsu.body) + '</sup>' : '<sub>' + render(gsu.body) + '</sub>');
        i = gsu.next;
        continue;
      }

      /* ------- 普通字符 ------- */
      buf += ch;
      i++;
    }

    flush();
    return out;
  }

  /* 纯文本（去掉标签） */
  function plain(src) {
    var d = document.createElement('div');
    d.innerHTML = render(src);
    return d.textContent || '';
  }

  /* ---------------- 把一段普通文字 + $公式$ 混排 ---------------- */
  function textChunk(t) {
    if (!t) return '';
    // 文本里夹着没写 $ 的 LaTeX（AI 经常这样），直接按公式排版
    if (/\\[a-zA-Z]{2,}|\\frac|\\sqrt|\^\{|_\{/.test(t)) {
      return render(t);
    }
    return esc(t)
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/(^|[\s（(])\*(?!\s)([^*]+?)\*(?=[\s，。、）)]|$)/g, '$1<i>$2</i>');
  }

  function inline(src) {
    var s = String(src == null ? '' : src);
    var out = '', last = 0, m;
    var re = /\$\$([\s\S]+?)\$\$|\$([^$\n]+?)\$/g;
    while ((m = re.exec(s)) !== null) {
      out += textChunk(s.slice(last, m.index));
      if (m[1] !== undefined) {
        out += '<span class="mathblock">' + render(m[1]) + '</span>';
      } else {
        out += '<span class="math">' + render(m[2]) + '</span>';
      }
      last = re.lastIndex;
    }
    out += textChunk(s.slice(last));
    return out;
  }

  EM.MathFmt = { render: render, inline: inline, plain: plain, esc: esc };

})(typeof window !== 'undefined' ? window : globalThis);
