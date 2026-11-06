/* ============================================================
 * 画说 · pdftext.js
 * 自己解析 PDF 里的文字（纯前端、零依赖、不联网）
 *   · 解压内容流（浏览器自带 DecompressionStream）
 *   · 用字体自带的 ToUnicode 表把字形码翻译成文字
 *   · 按换行/间距还原成段落
 * 只处理文字型 PDF；扫描件没有文字层，会明确告诉你。
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});

  /* ---------------- 小工具 ---------------- */
  function latin1(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return s;
  }

  function bytesFromLatin1(str) {
    var out = new Uint8Array(str.length);
    for (var i = 0; i < str.length; i++) out[i] = str.charCodeAt(i) & 0xff;
    return out;
  }

  async function inflate(bytes, raw) {
    if (typeof DecompressionStream === 'undefined') {
      throw new Error('这个浏览器不支持解压 PDF，换 Chrome / Edge 新版试试');
    }
    var ds = new DecompressionStream(raw ? 'deflate-raw' : 'deflate');
    var stream = new Blob([bytes]).stream().pipeThrough(ds);
    var ab = await new Response(stream).arrayBuffer();
    return new Uint8Array(ab);
  }

  /* ---------------- 对象表 ---------------- */
  function parseObjects(bytes, str) {
    var objs = {};
    var re = /(\d+)\s+(\d+)\s+obj\b/g;
    var m;
    while ((m = re.exec(str)) !== null) {
      var num = Number(m[1]);
      var start = m.index + m[0].length;
      var end = str.indexOf('endobj', start);
      if (end < 0) end = str.length;

      var body = str.slice(start, end);
      var sIdx = body.search(/\bstream\r?\n|\bstream\r/);
      var dict = body, sStart = -1, sEnd = -1;

      if (sIdx >= 0) {
        dict = body.slice(0, sIdx);
        var after = start + sIdx;
        var sp = str.indexOf('stream', after) + 6;
        while (sp < str.length && (str[sp] === '\r' || str[sp] === '\n')) sp++;
        var es = str.indexOf('endstream', sp);
        if (es < 0) es = end;
        sStart = sp; sEnd = es;
      }
      objs[num] = { num: num, dict: dict, sStart: sStart, sEnd: sEnd };
    }
    return objs;
  }

  function readDict(s, i) {
    var depth = 0;
    for (var k = i; k < s.length; k++) {
      if (s[k] === '<' && s[k + 1] === '<') { depth++; k++; continue; }
      if (s[k] === '>' && s[k + 1] === '>') { depth--; k++; if (!depth) return s.slice(i, k + 1); }
    }
    return s.slice(i);
  }

  function subDict(dict, key) {
    var m = new RegExp('/' + key + '\\s*<<').exec(dict);
    if (!m) return null;
    return readDict(dict, m.index + m[0].length - 2);
  }

  function refOf(dict, key) {
    var m = new RegExp('/' + key + '\\s+(\\d+)\\s+0\\s+R').exec(dict);
    return m ? Number(m[1]) : null;
  }

  function refsOf(dict, key) {
    var m = new RegExp('/' + key + '\\s*\\[([\\s\\S]*?)\\]').exec(dict);
    if (!m) return null;
    var out = [], re = /(\d+)\s+0\s+R/g, x;
    while ((x = re.exec(m[1])) !== null) out.push(Number(x[1]));
    return out;
  }

  /* ---------------- 内容流 ---------------- */
  /* （流的字节直接从原缓冲区切片，见 extract 里的 getStreamText） */

  /* ---------------- 图片 ---------------- */
  function unfilter(data, colors, columns, bpc) {
    var bpp = Math.max(1, Math.ceil(colors * bpc / 8));
    var rowLen = Math.ceil(colors * columns * bpc / 8);
    var rows = Math.floor(data.length / (rowLen + 1));
    var out = new Uint8Array(rows * rowLen);
    var prev = new Uint8Array(rowLen);

    for (var r = 0; r < rows; r++) {
      var ft = data[r * (rowLen + 1)];
      var src = data.subarray(r * (rowLen + 1) + 1, r * (rowLen + 1) + 1 + rowLen);
      var cur = new Uint8Array(rowLen);
      for (var i = 0; i < rowLen; i++) {
        var a = i >= bpp ? cur[i - bpp] : 0;
        var b = prev[i];
        var c = i >= bpp ? prev[i - bpp] : 0;
        var x = src[i];
        switch (ft) {
          case 0: cur[i] = x; break;
          case 1: cur[i] = (x + a) & 255; break;
          case 2: cur[i] = (x + b) & 255; break;
          case 3: cur[i] = (x + ((a + b) >> 1)) & 255; break;
          case 4: {
            var p = a + b - c;
            var pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
            cur[i] = (x + (pa <= pb && pa <= pc ? a : pb <= pc ? b : c)) & 255;
            break;
          }
          default: cur[i] = x;
        }
      }
      out.set(cur, r * rowLen);
      prev = cur;
    }
    return { data: out, rows: rows, rowLen: rowLen };
  }

  function toDataUrlFromRaw(raw, w, h, colors) {
    if (typeof document === 'undefined') return null;
    var scale = Math.min(1, 1100 / Math.max(w, h));
    var cw = Math.max(1, Math.round(w * scale));
    var ch = Math.max(1, Math.round(h * scale));

    var canvas = document.createElement('canvas');
    canvas.width = cw; canvas.height = ch;
    var ctx = canvas.getContext('2d');
    var im = ctx.createImageData(cw, ch);
    var d = im.data;

    for (var y = 0; y < ch; y++) {
      var sy = Math.min(h - 1, Math.floor(y / scale));
      for (var x = 0; x < cw; x++) {
        var sx = Math.min(w - 1, Math.floor(x / scale));
        var si = (sy * w + sx) * colors;
        var di = (y * cw + x) * 4;
        if (colors === 1) {
          var g = raw[si] || 0;
          d[di] = d[di + 1] = d[di + 2] = g;
        } else {
          d[di] = raw[si] || 0;
          d[di + 1] = raw[si + 1] || 0;
          d[di + 2] = raw[si + 2] || 0;
        }
        d[di + 3] = 255;
      }
    }
    ctx.putImageData(im, 0, 0);
    return canvas.toDataURL('image/png');
  }

  function b64(bytes) {
    var s = '', CH = 0x8000;
    for (var i = 0; i < bytes.length; i += CH) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
    }
    return (typeof btoa !== 'undefined') ? btoa(s) : Buffer.from(bytes).toString('base64');
  }
  function parseCMap(text) {
    var map = {};
    var keyLen = 1;
    var re = /beginbfchar([\s\S]*?)endbfchar/g, m;
    while ((m = re.exec(text)) !== null) {
      var pairs = m[1].match(/<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/g) || [];
      pairs.forEach(function (p) {
        var g = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>/.exec(p);
        keyLen = Math.max(keyLen, g[1].length / 2);
        map[g[1].toUpperCase()] = hexToText(g[2]);
      });
    }
    re = /beginbfrange([\s\S]*?)endbfrange/g;
    while ((m = re.exec(text)) !== null) {
      var body = m[1];
      var rr = /<([0-9A-Fa-f]+)>\s*<([0-9A-Fa-f]+)>\s*(<([0-9A-Fa-f]+)>|\[([\s\S]*?)\])/g, x;
      while ((x = rr.exec(body)) !== null) {
        var from = parseInt(x[1], 16), to = parseInt(x[2], 16);
        keyLen = Math.max(keyLen, x[1].length / 2);
        if (x[3].charAt(0) === '[') {
          var items = x[5].match(/<([0-9A-Fa-f]+)>/g) || [];
          items.forEach(function (it, k) {
            var h = it.replace(/[<>]/g, '');
            if (from + k <= to) map[hexPad(from + k, x[1].length)] = hexToText(h);
          });
        } else {
          var base = x[4];
          for (var c = from; c <= to && c - from < 65536; c++) {
            map[hexPad(c, x[1].length)] = hexToText(hexOffset(base, c - from));
          }
        }
      }
    }
    return { map: map, keyLen: keyLen };
  }

  function hexPad(n, len) {
    var h = n.toString(16).toUpperCase();
    while (h.length < len) h = '0' + h;
    return h;
  }

  function hexOffset(hex, delta) {
    var v = parseInt(hex, 16) + delta;
    return hexPad(v, hex.length);
  }

  function hexToText(hex) {
    var out = '';
    for (var i = 0; i + 3 < hex.length + 1; i += 4) {
      var code = parseInt(hex.substr(i, 4), 16);
      if (!isNaN(code) && code !== 0) out += String.fromCharCode(code);
    }
    return out;
  }

  /* ---------------- 内容流分词 ---------------- */
  function tokenize(s) {
    var toks = [], i = 0;
    while (i < s.length) {
      var c = s.charCodeAt(i);
      if (c === 37) { while (i < s.length && s[i] !== '\n' && s[i] !== '\r') i++; continue; }
      if (c <= 32) { i++; continue; }

      if (c === 40) { // (
        var b = [], depth = 1, j = i + 1;
        while (j < s.length && depth > 0) {
          var ch = s[j];
          if (ch === '\\') {
            var n = s[j + 1];
            var mapc = { n: 10, r: 13, t: 9, b: 8, f: 12, '(': 40, ')': 41, '\\': 92 };
            if (mapc[n] !== undefined) { b.push(mapc[n]); j += 2; continue; }
            if (n >= '0' && n <= '7') {
              var oct = '';
              j++;
              while (oct.length < 3 && s[j] >= '0' && s[j] <= '7') { oct += s[j]; j++; }
              b.push(parseInt(oct, 8) & 0xff);
              continue;
            }
            if (n === '\r' || n === '\n') { j += 2; continue; }
            b.push(s.charCodeAt(j + 1) & 0xff); j += 2; continue;
          }
          if (ch === '(') depth++;
          else if (ch === ')') { depth--; if (!depth) { j++; break; } }
          b.push(s.charCodeAt(j) & 0xff);
          j++;
        }
        toks.push({ t: 'str', v: b });
        i = j;
        continue;
      }

      if (c === 60) { // <
        if (s[i + 1] === '<') {
          var d = 0, k2 = i;
          while (k2 < s.length) {
            if (s[k2] === '<' && s[k2 + 1] === '<') { d++; k2 += 2; continue; }
            if (s[k2] === '>' && s[k2 + 1] === '>') { d--; k2 += 2; if (!d) break; continue; }
            k2++;
          }
          toks.push({ t: 'dict' });
          i = k2;
          continue;
        }
        var e2 = s.indexOf('>', i);
        if (e2 < 0) e2 = s.length;
        var hex = s.slice(i + 1, e2).replace(/[^0-9A-Fa-f]/g, '');
        if (hex.length % 2) hex += '0';
        var arr = [];
        for (var h = 0; h < hex.length; h += 2) arr.push(parseInt(hex.substr(h, 2), 16));
        toks.push({ t: 'str', v: arr });
        i = e2 + 1;
        continue;
      }

      if (c === 91) { toks.push({ t: '[' }); i++; continue; }
      if (c === 93) { toks.push({ t: ']' }); i++; continue; }

      if (c === 47) {
        var mm = /^\/[^\s/<>\[\]()%{}]*/.exec(s.slice(i));
        toks.push({ t: 'name', v: mm ? mm[0].slice(1) : '' });
        i += mm ? mm[0].length : 1;
        continue;
      }

      var m3 = /^[^\s/<>\[\]()%{}]+/.exec(s.slice(i));
      if (!m3) { i++; continue; }
      var w = m3[0];
      i += w.length;
      if (/^[-+]?(\d+\.?\d*|\.\d+)$/.test(w)) toks.push({ t: 'num', v: parseFloat(w) });
      else toks.push({ t: 'op', v: w });
    }
    return toks;
  }

  /* ---------------- 解码一段文字 ---------------- */
  function decodeString(bytes, font) {
    if (!font) {
      return latin1(new Uint8Array(bytes));
    }
    if (font.cmap && Object.keys(font.cmap).length) {
      var out = '', len = font.keyLen || 1;
      for (var i = 0; i + len <= bytes.length; i += len) {
        var hex = '';
        for (var j = 0; j < len; j++) {
          var h = bytes[i + j].toString(16).toUpperCase();
          hex += h.length < 2 ? '0' + h : h;
        }
        var u = font.cmap[hex];
        out += (u != null ? u : '');
      }
      return out;
    }
    return latin1(new Uint8Array(bytes));
  }

  /* ---------------- 一页的文字 ---------------- */
  function extractPage(content, fonts) {
    var toks = tokenize(content);
    var out = '';
    var stack = [];
    var curFont = null;
    var inArray = null;
    var lastY = null;
    var lastX = null;
    var em = 1;

    function newlineIfNeeded() {
      if (out && !/\n$/.test(out)) out += '\n';
    }

    for (var i = 0; i < toks.length; i++) {
      var tk = toks[i];

      if (tk.t === '[') { inArray = []; continue; }
      if (tk.t === ']') { stack.push({ t: 'array', v: inArray || [] }); inArray = null; continue; }
      if (inArray) { inArray.push(tk); continue; }

      if (tk.t === 'name') { stack.push(tk); continue; }
      if (tk.t === 'num') { stack.push(tk); continue; }
      if (tk.t === 'str') { stack.push(tk); continue; }
      if (tk.t === 'dict') { stack.push(tk); continue; }

      var op = tk.v;

      if (op === 'Tf') {
        var fname = stack.length >= 2 && stack[stack.length - 2].t === 'name' ? stack[stack.length - 2].v : null;
        var size = stack.length >= 1 && stack[stack.length - 1].t === 'num' ? stack[stack.length - 1].v : 12;
        curFont = fonts[fname] || null;
        em = size || 12;
        stack.length = 0;
        continue;
      }

      if (op === 'Tj' || op === "'" || op === '"') {
        var s = null;
        for (var k = stack.length - 1; k >= 0; k--) if (stack[k].t === 'str') { s = stack[k]; break; }
        if (op !== 'Tj') newlineIfNeeded();
        if (s) out += decodeString(s.v, curFont);
        stack.length = 0;
        continue;
      }

      if (op === 'TJ') {
        var arr = null;
        for (var k2 = stack.length - 1; k2 >= 0; k2--) if (stack[k2].t === 'array') { arr = stack[k2]; break; }
        if (arr) {
          arr.v.forEach(function (it) {
            if (it.t === 'str') out += decodeString(it.v, curFont);
            else if (it.t === 'num' && it.v <= -140) out += ' ';
          });
        }
        stack.length = 0;
        continue;
      }

      if (op === 'Td' || op === 'TD') {
        var ty = 0;
        if (stack.length >= 2 && stack[stack.length - 1].t === 'num') ty = stack[stack.length - 1].v;
        // 只有明显换行才断行；上标/下标（半个字高以内）接着写
        if (Math.abs(ty) > em * 0.55) newlineIfNeeded();
        stack.length = 0;
        continue;
      }

      if (op === 'Tm') {
        var nums = stack.filter(function (x) { return x.t === 'num'; });
        if (nums.length >= 6) {
          var tx0 = nums[4].v, y = nums[5].v;
          // 真正的换行：纵向位移够大，而且横坐标回到了行首
          if (lastY != null && Math.abs(y - lastY) > em * 0.55 &&
              (lastX == null || tx0 <= lastX + em * 0.35)) {
            newlineIfNeeded();
          }
          lastY = y;
          lastX = tx0;
        }
        stack.length = 0;
        continue;
      }

      if (op === 'T*') { newlineIfNeeded(); stack.length = 0; continue; }

      /* 结束一个文字块：不强制换行，交给下一段的位置判断 */
      if (op === 'ET') { stack.length = 0; continue; }

      /* 其它操作符：清空栈 */
      if (op !== 'q' && op !== 'Q' && op !== 'cm' && op !== 'BT' && op !== 'gs' &&
          op !== 'rg' && op !== 'RG' && op !== 'scn' && op !== 'SCN' && op !== 'cs' && op !== 'CS' &&
          op !== 're' && op !== 'W' && op !== 'n' && op !== 'm' && op !== 'l' && op !== 'c' &&
          op !== 'h' && op !== 'f' && op !== 'S' && op !== 'Do' && op !== 'Tc' && op !== 'Tw' &&
          op !== 'Tz' && op !== 'TL' && op !== 'Ts' && op !== 'Tr' && op !== 'w' && op !== 'J' && op !== 'j' && op !== 'd') {
        /* 未知操作符 */
      }
      stack.length = 0;
    }

    return out;
  }

  /* ---------------- 主流程 ---------------- */
  async function extract(bytes, opts) {
    opts = opts || {};
    var dbg = { contentLens: [], fonts: [], pageCount: 0, order: [] };
    var str = latin1(bytes);

    var objs = parseObjects(bytes, str);
    if (!Object.keys(objs).length) throw new Error('这个文件不像 PDF');

    /* 找页面顺序 */
    var order = [];
    var catalogNum = null;
    Object.keys(objs).forEach(function (n) {
      if (/\/Type\s*\/Catalog/.test(objs[n].dict)) catalogNum = Number(n);
    });

    function walk(num, depth) {
      if (depth > 32) return;
      var o = objs[num];
      if (!o) return;
      if (/\/Type\s*\/Page\b/.test(o.dict) && !/\/Type\s*\/Pages/.test(o.dict)) {
        order.push(num);
        return;
      }
      var kids = refsOf(o.dict, 'Kids');
      if (kids) kids.forEach(function (k) { walk(k, depth + 1); });
    }

    if (catalogNum != null) {
      var rootPages = refOf(objs[catalogNum].dict, 'Pages');
      if (rootPages) walk(rootPages, 0);
    }
    if (!order.length) {
      Object.keys(objs).forEach(function (n) {
        if (/\/Type\s*\/Page\b/.test(objs[n].dict) && !/\/Type\s*\/Pages/.test(objs[n].dict)) order.push(Number(n));
      });
      order.sort(function (a, b) { return a - b; });
    }

    async function getStreamText(num) {
      var o = objs[num];
      if (!o || o.sStart < 0) return '';
      var data = bytes.subarray(o.sStart, o.sEnd);
      var isFlate = /\/FlateDecode/.test(o.dict);
      if (!isFlate) return latin1(data);

      // endstream 前面常带 \r\n，会让解压器报 "Trailing junk"，逐字节往回退着试
      for (var cut = 0; cut <= 6 && cut < data.length; cut++) {
        var d = cut ? data.subarray(0, data.length - cut) : data;
        try {
          var out = await inflate(d, false);
          return latin1(out);
        } catch (e) { /* 再退一个字节 */ }
      }
      return '';
    }

    async function fontsOf(pageDict) {
      var resRef = refOf(pageDict, 'Resources');
      var resDict = resRef != null && objs[resRef] ? objs[resRef].dict : (subDict(pageDict, 'Resources') || pageDict);
      var fontDict = subDict(resDict, 'Font') ||
        (refOf(resDict, 'Font') != null && objs[refOf(resDict, 'Font')] ? objs[refOf(resDict, 'Font')].dict : null);
      var fonts = {};
      if (!fontDict) return fonts;

      var re = /\/([^\s/<>\[\]()%]+)\s+(\d+)\s+0\s+R/g, m;
      while ((m = re.exec(fontDict)) !== null) {
        var fname = m[1], fnum = Number(m[2]);
        var fobj = objs[fnum];
        if (!fobj) continue;
        var tuNum = refOf(fobj.dict, 'ToUnicode');
        if (tuNum == null) { fonts[fname] = { cmap: null, keyLen: 1 }; continue; }
        var cmapText = await getStreamText(tuNum);
        var parsed = parseCMap(cmapText);
        fonts[fname] = { cmap: parsed.map, keyLen: parsed.keyLen };
      }
      return fonts;
    }

    /* 一页里的大图（插图、示意图） */
    async function imagesOfPage(pageDict, pageIndex) {
      var out = [];
      var resRef = refOf(pageDict, 'Resources');
      var resDict = resRef != null && objs[resRef] ? objs[resRef].dict : (subDict(pageDict, 'Resources') || pageDict);
      var xRef = refOf(resDict, 'XObject');
      var xDict = xRef != null && objs[xRef] ? objs[xRef].dict : subDict(resDict, 'XObject');
      if (!xDict) return out;

      var re = /\/([^\s/<>\[\]()%]+)\s+(\d+)\s+0\s+R/g, m;
      var seen = {};
      while ((m = re.exec(xDict)) !== null) {
        var num = Number(m[2]);
        if (seen[num]) continue;
        seen[num] = 1;
        var o = objs[num];
        if (!o || !/\/Subtype\s*\/Image/.test(o.dict)) continue;

        var w = Number((/\/Width\s+(\d+)/.exec(o.dict) || [])[1] || 0);
        var h = Number((/\/Height\s+(\d+)/.exec(o.dict) || [])[1] || 0);
        if (!w || !h || w < 110 || h < 110) continue;      // 跳过图标、小装饰
        if (w * h > 9e6) continue;                          // 跳过超大图

        var filterM = /\/Filter\s*(?:\/([A-Za-z0-9]+)|\[([^\]]*)\])/.exec(o.dict) || [];
        var filter = String(filterM[1] || filterM[2] || '');
        var data = bytes.subarray(o.sStart, o.sEnd);
        var dataUrl = null;

        if (/DCTDecode/.test(filter)) {
          dataUrl = 'data:image/jpeg;base64,' + b64(data);
        } else if (/FlateDecode/.test(filter)) {
          var raw = null;
          for (var cut = 0; cut <= 6 && !raw && cut < data.length; cut++) {
            try { raw = await inflate(cut ? data.subarray(0, data.length - cut) : data, false); }
            catch (e) { raw = null; }
          }
          if (!raw) continue;

          var colors = /\/DeviceGray/.test(o.dict) ? 1 : 3;
          var bpc = Number((/\/BitsPerComponent\s+(\d+)/.exec(o.dict) || [])[1] || 8);
          if (bpc !== 8) continue;

          var pm = /\/Predictor\s+(\d+)/.exec(o.dict);
          var arr = raw;
          if (pm && Number(pm[1]) >= 10) {
            var uf = unfilter(raw, colors, w, bpc);
            if (uf.rows >= h) arr = uf.data;
          }
          dataUrl = toDataUrlFromRaw(arr, w, h, colors);
        }

        if (dataUrl) out.push({ page: pageIndex + 1, dataUrl: dataUrl, w: w, h: h });
      }
      return out;
    }

    var pages = [];
    var images = [];
    for (var i = 0; i < order.length && i < 60; i++) {
      var pageDict = objs[order[i]].dict;
      var cRefs = refsOf(pageDict, 'Contents');
      if (!cRefs) {
        var one = refOf(pageDict, 'Contents');
        cRefs = one != null ? [one] : [];
      }
      var content = '';
      for (var c = 0; c < cRefs.length; c++) {
        content += await getStreamText(cRefs[c]) + '\n';
      }

      if (images.length < 18) {
        var pimgs = await imagesOfPage(pageDict, i);
        pimgs.forEach(function (im) { if (images.length < 18) images.push(im); });
      }

      if (!content.trim()) { pages.push(''); continue; }
      var fonts = await fontsOf(pageDict);
      var text = extractPage(content, fonts);
      pages.push(text);

      if (opts.debug) {
        dbg.pageCount++;
        dbg.contentLens.push(content.length);
        dbg.fonts.push(Object.keys(fonts).map(function (k) {
          return k + ':' + (fonts[k].cmap ? Object.keys(fonts[k].cmap).length + '字' : '无表');
        }).join(', '));
        if (dbg.pageCount === 1) {
          dbg.firstContent = content.slice(0, 300);
          dbg.firstPageDict = pageDict.slice(0, 600);
        }
      }
    }

    var full = pages.join('\n\n').replace(/\r/g, '');
    full = full
      .replace(/[\uFB00-\uFB06]/g, function (c) {
        return ({ '\uFB00': 'ff', '\uFB01': 'fi', '\uFB02': 'fl', '\uFB03': 'ffi', '\uFB04': 'ffl', '\uFB05': 'st', '\uFB06': 'st' })[c] || c;
      })
      .replace(/\u00AD/g, '')
      .split('\n')
      .map(function (line) { return line.replace(/^[ \t]+|[ \t]+$/g, ''); })
      .join('\n')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .trim();

    dbg.order = order;
    return {
      pages: pages.length, text: full, empty: !full.trim(),
      images: images, debug: opts.debug ? dbg : null
    };
  }

  EM.pdf = {
    extract: async function (file) {
      var buf = new Uint8Array(await file.arrayBuffer());
      var res = await extract(buf);
      if (res.empty && !(res.images && res.images.length)) {
        throw new Error('这份 PDF 没有文字层（像是扫描件），把页面截图发给我看图也行');
      }
      return res;
    },
    extractBuffer: extract
  };

  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      extract: extract, extractPage: extractPage, parseCMap: parseCMap,
      tokenize: tokenize, parseObjects: parseObjects, refsOf: refsOf, refOf: refOf
    };
  }

})(typeof window !== 'undefined' ? window : globalThis);
