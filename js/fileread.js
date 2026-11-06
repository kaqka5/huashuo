/* ============================================================
 * 画说 · fileread.js
 * 把上传的文件读成文字：.txt/.md/.csv/.json/.html 直接读，
 * .docx 用浏览器自带的 DecompressionStream 解压后取正文（零依赖）
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});

  /* ---------------- ZIP 解析（只做够用的部分） ---------------- */
  function findEOCD(u8) {
    // End of Central Directory: 0x06054b50，可能在文件尾部 64KB 内
    var start = Math.max(0, u8.length - 65558);
    for (var i = u8.length - 22; i >= start; i--) {
      if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) return i;
    }
    return -1;
  }

  function readU16(u8, p) { return u8[p] | (u8[p + 1] << 8); }
  function readU32(u8, p) { return (u8[p] | (u8[p + 1] << 8) | (u8[p + 2] << 16) | (u8[p + 3] << 24)) >>> 0; }

  function listEntries(u8) {
    var eocd = findEOCD(u8);
    if (eocd < 0) throw new Error('不是有效的 docx（没找到 ZIP 结尾）');
    var count = readU16(u8, eocd + 10);
    var cdOffset = readU32(u8, eocd + 16);
    var entries = [];
    var p = cdOffset;

    var dec = new TextDecoder('utf-8');
    for (var i = 0; i < count && p + 46 <= u8.length; i++) {
      if (readU32(u8, p) !== 0x02014b50) break;
      var method = readU16(u8, p + 10);
      var compSize = readU32(u8, p + 20);
      var nameLen = readU16(u8, p + 28);
      var extraLen = readU16(u8, p + 30);
      var commentLen = readU16(u8, p + 32);
      var localOffset = readU32(u8, p + 42);
      var name = dec.decode(u8.subarray(p + 46, p + 46 + nameLen));
      entries.push({ name: name, method: method, compSize: compSize, localOffset: localOffset });
      p += 46 + nameLen + extraLen + commentLen;
    }
    return entries;
  }

  async function extractEntry(u8, entry) {
    var p = entry.localOffset;
    if (readU32(u8, p) !== 0x04034b50) throw new Error('ZIP 数据损坏');
    var nameLen = readU16(u8, p + 26);
    var extraLen = readU16(u8, p + 28);
    var start = p + 30 + nameLen + extraLen;
    var data = u8.subarray(start, start + entry.compSize);

    if (entry.method === 0) return data;

    if (entry.method === 8) {
      if (typeof DecompressionStream === 'undefined') {
        throw new Error('这个浏览器不支持自动解压，请把文字复制粘贴进来');
      }
      var ds = new DecompressionStream('deflate-raw');
      var stream = new Blob([data]).stream().pipeThrough(ds);
      var ab = await new Response(stream).arrayBuffer();
      return new Uint8Array(ab);
    }
    throw new Error('不支持的压缩方式');
  }

  /* ---------------- docx → 纯文本 ---------------- */
  async function readDocx(file) {
    var u8 = new Uint8Array(await file.arrayBuffer());
    var entries = listEntries(u8);
    var doc = entries.filter(function (e) { return e.name === 'word/document.xml'; })[0];
    if (!doc) throw new Error('这个 docx 里没有正文');

    var xml = new TextDecoder('utf-8').decode(await extractEntry(u8, doc));

    // 段落 / 换行 / 制表
    xml = xml.replace(/<w:tab[^>]*\/>/g, '\t')
      .replace(/<w:br[^>]*\/>/g, '\n')
      .replace(/<\/w:p>/g, '\n')
      .replace(/<w:tc[^>]*>/g, ' | ');

    // 去标签 + 解实体
    var text = xml.replace(/<[^>]+>/g, '');
    text = decodeEntities(text);

    // 表格单元格拼成 "A | B"，去掉空行里的多余竖线
    text = text.split('\n').map(function (line) {
      return line.replace(/(\s*\|\s*)+/g, ' | ')
        .replace(/^[\s|]+/, '')
        .replace(/[\s|]+$/, '');
    }).join('\n');

    return text.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+\n/g, '\n').trim();
  }

  function decodeEntities(s) {
    var d = document.createElement('textarea');
    d.innerHTML = s
      .replace(/&lt;/g, '&lt;')
      .replace(/&gt;/g, '&gt;')
      .replace(/&quot;/g, '&quot;');
    // textarea 只解一次实体
    var once = d.value;
    return once
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&apos;/g, "'")
      .replace(/&#x([0-9a-f]+);/gi, function (_, h) { return String.fromCodePoint(parseInt(h, 16)); })
      .replace(/&#(\d+);/g, function (_, d2) { return String.fromCodePoint(parseInt(d2, 10)); });
  }

  /* ---------------- 对外 ---------------- */
  EM.files = {
    /** 返回 { kind:'text', name, text } 或抛出错误 */
    read: async function (file) {
      var name = file.name || '上传的文件';
      var lower = name.toLowerCase();

      if (/\.docx$/i.test(lower)) {
        var text = await readDocx(file);
        if (!text.trim()) throw new Error('这份 Word 里没有读到文字');
        return { name: name, text: text };
      }

      if (/\.pdf$/i.test(lower)) {
        if (!EM.pdf) throw new Error('PDF 模块没加载');
        var res = await EM.pdf.extract(file);
        return { name: name, text: res.text, images: res.images || [] };
      }

      if (/\.(txt|md|markdown|csv|json|log|html?|xml|tex)$/i.test(lower) || (file.type || '').indexOf('text/') === 0) {
        var t = await file.text();
        return { name: name, text: t };
      }

      // 兜底：当作文本读
      var t2 = await file.text();
      if (!t2 || t2.indexOf('\u0000') >= 0) throw new Error('认不出这个文件格式，试试复制里面的文字');
      return { name: name, text: t2 };
    }
  };

})(typeof window !== 'undefined' ? window : globalThis);
