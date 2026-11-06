/* ============================================================
 * 画说 · markdown.js
 * 轻量 Markdown → HTML（公式交给 MathFmt）
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var esc = EM.MathFmt.esc;
  var renderMath = EM.MathFmt.render;

  /* ---------------- 行内 ---------------- */
  function inlineFmt(t) {
    t = esc(t);

    // 行内代码
    t = t.replace(/`([^`\n]+)`/g, function (_, c) {
      return '<code>' + c + '</code>';
    });

    // 加粗 / 斜体 / 删除线
    t = t.replace(/\*\*\*([^*\n]+?)\*\*\*/g, '<b><i>$1</i></b>');
    t = t.replace(/\*\*([^*\n]+?)\*\*/g, '<b>$1</b>');
    t = t.replace(/__([^_\n]+?)__/g, '<b>$1</b>');
    t = t.replace(/(^|[^\w*])\*(?![\s*])([^*\n]+?)\*(?![\w*])/g, '$1<i>$2</i>');
    t = t.replace(/~~([^~\n]+?)~~/g, '<del>$1</del>');

    // 链接
    t = t.replace(/\[([^\]\n]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>');

    // 上标 ^2 这种（不在公式里的）
    t = t.replace(/\^(\d+)\b/g, '<sup>$1</sup>');
    return t;
  }

  /** 文本 + $..$ / $$..$$ / \(..\) / \[..\] 混排 */
  function inline(src) {
    var s = String(src == null ? '' : src);
    var out = '', last = 0, m;
    var re = /\$\$([\s\S]+?)\$\$|\\\[([\s\S]+?)\\\]|\$((?:\\.|[^$\\\n])+?)\$|\\\(((?:\\.|[^)\\\n])+?)\\\)/g;

    while ((m = re.exec(s)) !== null) {
      out += inlineFmt(s.slice(last, m.index));
      var body = m[1] !== undefined ? m[1] : m[2] !== undefined ? m[2] : m[3] !== undefined ? m[3] : m[4];
      var isBlock = m[1] !== undefined || m[2] !== undefined;
      out += isBlock
        ? '<span class="mathblock">' + renderMath(body) + '</span>'
        : '<span class="math">' + renderMath(body) + '</span>';
      last = re.lastIndex;
    }
    out += inlineFmt(s.slice(last));
    return out;
  }

  /* ---------------- 块级 ---------------- */
  var RE = {
    fence: /^\s*(```|~~~)\s*([\w+-]*)\s*$/,
    mathBlock: /^\s*\$\$\s*$/,
    beginEnv: /^\s*\\begin\{/,
    heading: /^\s{0,3}(#{1,6})\s+(.*)$/,
    hr: /^\s{0,3}(-{3,}|\*{3,}|_{3,})\s*$/,
    quote: /^\s{0,3}>\s?/,
    ul: /^\s{0,3}[-*+]\s+/,
    ol: /^\s{0,3}\d+[.)]\s+/,
    tableSep: /^\s*\|?[\s:-]+\|[\s:|-]*$/
  };

  function toHtml(md) {
    var lines = String(md == null ? '' : md).replace(/\r\n?/g, '\n').split('\n');
    var out = [], i = 0, n = lines.length;

    function flushPara(buf) {
      if (!buf.length) return;
      out.push('<p>' + inline(buf.join('\n').trim()).replace(/\n/g, '<br>') + '</p>');
      buf.length = 0;
    }

    var para = [];

    while (i < n) {
      var line = lines[i];

      /* 空行 */
      if (!line.trim()) { flushPara(para); i++; continue; }

      /* 代码块 */
      var mF = line.match(RE.fence);
      if (mF) {
        flushPara(para);
        var fence = mF[1], code = [];
        i++;
        while (i < n && !new RegExp('^\\s*' + fence).test(lines[i])) { code.push(lines[i]); i++; }
        i++;
        out.push('<pre class="code"><code>' + esc(code.join('\n')) + '</code></pre>');
        continue;
      }

      /* $$ 数学块 */
      if (RE.mathBlock.test(line)) {
        flushPara(para);
        var math = [];
        i++;
        while (i < n && !RE.mathBlock.test(lines[i])) { math.push(lines[i]); i++; }
        i++;
        out.push('<span class="mathblock">' + renderMath(math.join('\n')) + '</span>');
        continue;
      }

      /* \begin{...} 多行公式 */
      if (RE.beginEnv.test(line)) {
        flushPara(para);
        var envLines = [line], depth = (line.match(/\\begin\{/g) || []).length - (line.match(/\\end\{/g) || []).length;
        i++;
        while (i < n && depth > 0) {
          envLines.push(lines[i]);
          depth += (lines[i].match(/\\begin\{/g) || []).length;
          depth -= (lines[i].match(/\\end\{/g) || []).length;
          i++;
        }
        out.push('<span class="mathblock">' + renderMath(envLines.join(' ')) + '</span>');
        continue;
      }

      /* 标题 */
      var mH = line.match(RE.heading);
      if (mH) {
        flushPara(para);
        var lvl = Math.min(4, mH[1].length + 2); // ### -> h5
        out.push('<h' + lvl + '>' + inline(mH[2].trim()) + '</h' + lvl + '>');
        i++; continue;
      }

      /* 分割线 */
      if (RE.hr.test(line)) { flushPara(para); out.push('<hr>'); i++; continue; }

      /* 引用 */
      if (RE.quote.test(line)) {
        flushPara(para);
        var q = [];
        while (i < n && (RE.quote.test(lines[i]) || (q.length && lines[i].trim() && !RE.heading.test(lines[i])))) {
          q.push(lines[i].replace(RE.quote, ''));
          i++;
        }
        out.push('<blockquote>' + inline(q.join('\n').trim()).replace(/\n/g, '<br>') + '</blockquote>');
        continue;
      }

      /* 表格 */
      if (line.indexOf('|') >= 0 && i + 1 < n && RE.tableSep.test(lines[i + 1])) {
        flushPara(para);
        var head = line.split('|').map(function (c) { return c.trim(); }).filter(function (c, k, a) { return !(k === 0 && !c) && !(k === a.length - 1 && !c); });
        i += 2;
        var rows = [];
        while (i < n && lines[i].indexOf('|') >= 0 && lines[i].trim()) {
          rows.push(lines[i].split('|').map(function (c) { return c.trim(); }).filter(function (c, k, a) { return !(k === 0 && !c) && !(k === a.length - 1 && !c); }));
          i++;
        }
        out.push('<table><thead><tr>' + head.map(function (h) { return '<th>' + inline(h) + '</th>'; }).join('') +
          '</tr></thead><tbody>' + rows.map(function (r) {
            return '<tr>' + r.map(function (c) { return '<td>' + inline(c) + '</td>'; }).join('') + '</tr>';
          }).join('') + '</tbody></table>');
        continue;
      }

      /* 列表 */
      if (RE.ul.test(line) || RE.ol.test(line)) {
        flushPara(para);
        var ordered = RE.ol.test(line);
        var items = [];
        while (i < n && (ordered ? RE.ol : RE.ul).test(lines[i])) {
          items.push(lines[i].replace(ordered ? RE.ol : RE.ul, ''));
          i++;
        }
        out.push('<' + (ordered ? 'ol' : 'ul') + '>' +
          items.map(function (t) { return '<li>' + inline(t.trim()) + '</li>'; }).join('') +
          '</' + (ordered ? 'ol' : 'ul') + '>');
        continue;
      }

      /* 普通段落 */
      para.push(line);
      i++;
    }
    flushPara(para);

    return out.join('');
  }

  /* ---------------- 清理 ---------------- */
  function clean(html) {
    var d = document.createElement('div');
    d.innerHTML = html || '';
    d.querySelectorAll('script,style,iframe,object,embed,link,meta').forEach(function (n) { n.remove(); });
    d.querySelectorAll('*').forEach(function (n) {
      for (var k = n.attributes.length - 1; k >= 0; k--) {
        var a = n.attributes[k];
        if (/^on/i.test(a.name)) n.removeAttribute(a.name);
        if ((a.name === 'href' || a.name === 'src') && /^\s*javascript:/i.test(a.value)) n.removeAttribute(a.name);
      }
    });
    return d.innerHTML;
  }

  /* 粗略判断是不是 Markdown（用于决定要不要转换） */
  function looksLikeMarkdown(s) {
    return /(^|\n)\s{0,3}(#{1,6}\s|[-*+]\s|\d+[.)]\s|>|```|\|)/.test(s) ||
      /\*\*[^*]+\*\*/.test(s) || /\$[^$]+\$/.test(s);
  }

  EM.md = { toHtml: toHtml, inline: inline, clean: clean, looksLikeMarkdown: looksLikeMarkdown };

})(typeof window !== 'undefined' ? window : globalThis);
