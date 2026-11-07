/* ============================================================
 * Branch · ai.js
 * AI 接入：OpenAI 兼容接口、流式输出、卡片协议解析、免密钥粘贴
 * ============================================================ */
(function (global) {
  'use strict';

  var EM = (global.EM = global.EM || {});
  var U = EM.util;
  var SETTINGS_KEY = 'huashuo.ai.v1';

  var PRESETS = [
    { id: 'deepseek', name: 'DeepSeek', base: 'https://api.deepseek.com/v1', model: 'deepseek-chat' },
    { id: 'openai', name: 'OpenAI', base: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
    { id: 'moonshot', name: '月之暗面 Kimi', base: 'https://api.moonshot.cn/v1', model: 'moonshot-v1-8k' },
    { id: 'dashscope', name: '阿里通义千问', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus' },
    { id: 'zhipu', name: '智谱 GLM', base: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4-flash' },
    { id: 'siliconflow', name: '硅基流动', base: 'https://api.siliconflow.cn/v1', model: 'deepseek-ai/DeepSeek-V3' },
    { id: 'ollama', name: '本地 Ollama', base: 'http://localhost:11434/v1', model: 'qwen2.5:7b' },
    { id: 'custom', name: '自定义（OpenAI 兼容）', base: '', model: '' }
  ];

  /* ============================================================
   * 提示词
   * ========================================================== */
  var SYSTEM = [
    '你是一位「图解笔记」助手。用户会给你一段材料（一道题目、一篇文章，或者一张图片截图）和一条要求。',
    '你要把结果拆成若干张卡片，一张卡片只讲一件事，方便用户在一张无限画布上拖动、圈画、追问。',
    '',
    '【输出格式】只输出下面这种纯文本，不要任何前言、总结或代码块围栏：',
    '',
    '@@topic 不超过 20 个字的主题',
    '',
    '@@card 类型 | 卡片标题',
    '卡片正文（Markdown，公式写成 $...$）',
    '',
    '@@card 类型 | 卡片标题',
    '……',
    '',
    '【卡片类型】',
    'step —— 题目解答里的一个步骤',
    'quote —— 原文摘录',
    'para —— 对上一段原文的解释',
    'en —— 英文对照，正文固定两行：',
    '      EN: 英文原文',
    '      ZH: 中文翻译',
    'answer —— 最终答案或结论',
    'note —— 补充说明、背景、易错点',
    '',
    '【怎么选类型】',
    '· 用户给的是题目：用 step 分步讲（3~8 张），最后用 answer 给结论。',
    '· 用户给的是中文文章：按段落来，先 quote 一段原文，紧接着 para 解释这一段；可以有多组。',
    '· 用户给的是英文文章：按段落用 en，一行英文原文、一行中文翻译。',
    '· 用户只是让你讲解某个知识点：用 step 或 note。',
    '',
    '【硬性要求】',
    '1. 数学式子一律写成 LaTeX，用 $...$ 包起来；不要用文字描述公式。',
    '2. 每张卡片正文不超过 220 字，讲清楚一件事就停。',
    '3. 标题 6~14 个字，不要带序号，不要出现「第一步」「步骤」「段落」这些字样。',
    '4. 不要在卡片正文里再写 @@card 或 @@topic。',
    '5. 不要复述用户的要求，也不要写「好的，我来……」。',
    '6. 用户说中文就用中文回答，除非要求里另有指定。'
  ].join('\n');

  var ASK_SYSTEM = [
    '你是一位耐心的老师兼编辑。用户在一份笔记里框出了一段文字，并向你提出一个问题。',
    '请只回答这个问题本身：直接给解释、给答案，不要客套，不要复述问题，不要说「这段文字是……」。',
    '可以用 Markdown，公式写成 $...$。控制在 200 字以内，必要时分两小段。'
  ].join('\n');

  /* ============================================================
   * 设置
   * ========================================================== */
  var defaults = {
    preset: 'deepseek',
    base: PRESETS[0].base,
    model: PRESETS[0].model,
    apiKey: '',
    temperature: 0.7
  };

  var cached = null;

  var ai = (EM.ai = {
    PRESETS: PRESETS,
    SYSTEM: SYSTEM,

    settings: function () {
      if (cached) return cached;
      var s = Object.assign({}, defaults);
      try {
        var raw = localStorage.getItem(SETTINGS_KEY);
        if (raw) Object.assign(s, JSON.parse(raw));
      } catch (e) { }
      cached = s;
      return s;
    },

    saveSettings: function (patch) {
      var s = Object.assign(ai.settings(), patch);
      cached = s;
      try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) { }
      return s;
    },

    isLocal: function (base) {
      return /localhost|127\.0\.0\.1|0\.0\.0\.0/.test(base || '');
    },

    hasKey: function () {
      var s = ai.settings();
      return !!(s.apiKey && String(s.apiKey).trim()) || ai.isLocal(s.base);
    },

    /* ---------------- 提示词 ---------------- */
    buildUserPrompt: function (opts) {
      opts = opts || {};
      var lines = [];
      var mode = opts.mode || 'auto';
      var modeTip = {
        auto: '',
        problem: '这是一道题目，请分步讲解，用 step 卡片，最后用 answer 给结论。',
        article: '这是一篇文章，请按段落拆分：先 quote 原文，再紧跟 para 解释。',
        en: '这是英文材料，请按段落用 en 卡片：一行英文原文，一行中文翻译。'
      }[mode] || '';

      if (modeTip) lines.push('【材料类型】' + modeTip);
      lines.push('【用户的要求】');
      lines.push(opts.requirement || '请帮我理解和整理下面的内容。');

      if (opts.docText) {
        lines.push('');
        lines.push('【材料正文】');
        lines.push(opts.docText);
      }

      var imgs = (opts.attachments || []).filter(function (a) { return a.kind === 'image'; });
      if (imgs.length) {
        lines.push('');
        lines.push('【用户还提供了 ' + imgs.length + ' 张图片】请直接看图里的内容理解材料；如果图里有题目或文字，请以图为准。');
      }
      return lines.join('\n');
    },

    buildMessages: function (opts) {
      var userText = ai.buildUserPrompt(opts);
      var imgs = (opts.attachments || []).filter(function (a) { return a.kind === 'image'; });

      if (!imgs.length) {
        return [
          { role: 'system', content: SYSTEM },
          { role: 'user', content: userText }
        ];
      }

      var parts = [{ type: 'text', text: userText }];
      imgs.slice(0, 4).forEach(function (a) {
        parts.push({ type: 'image_url', image_url: { url: a.dataUrl } });
      });
      return [
        { role: 'system', content: SYSTEM },
        { role: 'user', content: parts }
      ];
    },

    /** 免密钥模式：整段提示词 */
    buildCopyPrompt: function (opts) {
      return SYSTEM + '\n\n=====================\n\n' + ai.buildUserPrompt(opts);
    },

    /* ---------------- 接口地址 ---------------- */
    chatUrl: function (base) {
      var b = String(base || '').trim().replace(/\/+$/, '');
      if (!b) return '';
      if (/\/chat\/completions$/.test(b)) return b;
      return b + '/chat/completions';
    },

    /* ---------------- 调用 ---------------- */
    chat: function (messages, opts) {
      opts = opts || {};
      var s = ai.settings();
      var url = ai.chatUrl(opts.base || s.base);
      if (!url) return Promise.reject(new Error('还没有填写 API 地址。'));

      var key = opts.apiKey != null ? opts.apiKey : s.apiKey;
      if (!key && !ai.isLocal(opts.base || s.base)) {
        return Promise.reject(new Error('还没有填写 API Key。可以在左上角设置里填，或者用「复制提示词」跳过。'));
      }

      var body = {
        model: opts.model || s.model || 'deepseek-chat',
        messages: messages,
        stream: opts.stream !== false
      };
      if (typeof s.temperature === 'number' && !/reasoner|r1|o1|o3|thinking/i.test(body.model)) {
        body.temperature = s.temperature;
      }

      var headers = { 'Content-Type': 'application/json' };
      if (key) headers.Authorization = 'Bearer ' + key;

      var ctrl = new AbortController();
      var timer = setTimeout(function () { ctrl.abort(); }, opts.timeout || 180000);

      if (opts.onDelta) opts.onDelta('', 'start'); // 给 UI 一个开始信号

      return fetch(url, {
        method: 'POST',
        headers: headers,
        body: JSON.stringify(body),
        signal: ctrl.signal
      }).then(function (res) {
        if (!res.ok) {
          return res.text().then(function (text) { throw makeHttpError(res.status, text); });
        }

        var ct = (res.headers.get('content-type') || '').toLowerCase();

        /* ---- 真流式 ---- */
        if (res.body && res.body.getReader && ct.indexOf('json') < 0) {
          var reader = res.body.getReader();
          var decoder = new TextDecoder('utf-8');
          var full = '', buf = '';

          function consumeLine(line) {
            line = line.replace(/\r$/, '');
            if (!line || line.charAt(0) === ':') return;
            if (line.indexOf('data:') !== 0) return;
            var payload = line.slice(5).trim();
            if (!payload || payload === '[DONE]') return;
            var j;
            try { j = JSON.parse(payload); } catch (e) { return; }
            var d = deltaOf(j);
            if (d) {
              full += d;
              if (opts.onDelta) opts.onDelta(d, 'chunk');
            }
          }

          function pump() {
            return reader.read().then(function (r) {
              if (r.done) {
                buf += decoder.decode();
                if (buf) consumeLine(buf);
                return full;
              }
              buf += decoder.decode(r.value, { stream: true });
              var idx;
              while ((idx = buf.indexOf('\n')) >= 0) {
                consumeLine(buf.slice(0, idx));
                buf = buf.slice(idx + 1);
              }
              return pump();
            });
          }
          return pump();
        }

        /* ---- 一次性 JSON ---- */
        return res.text().then(function (text) {
          var trimmed = String(text).trim();
          if (/^data:/.test(trimmed) || trimmed.indexOf('data: ') >= 0) {
            return parseSSE(trimmed, opts.onDelta);
          }
          var data;
          try { data = JSON.parse(trimmed); } catch (e) { throw new Error('返回的内容不是合法 JSON。'); }
          var content = pickContent(data);
          if (opts.onDelta && content) opts.onDelta(content, 'chunk');
          return content;
        });
      }).catch(function (err) {
        clearTimeout(timer);
        if (err && err.name === 'AbortError') throw new Error('请求超时了，换个模型或稍后再试。');
        if (/failed to fetch|networkerror|load failed|fetch failed/i.test(err.message || '')) {
          throw new Error('连不上这个接口：可能是网络问题，或者服务商不允许浏览器直接调用（跨域限制）。' +
            '可以改用「复制提示词 → 粘贴 AI 回答」，效果一样。');
        }
        throw err;
      }).then(function (v) {
        clearTimeout(timer);
        return v;
      });
    },

    /** 非流式取一整段 */
    once: function (messages, opts) {
      return ai.chat(messages, Object.assign({ stream: false }, opts)).then(function (t) {
        return t || '';
      });
    },

    /* ============================================================
     * 生成：把流式文本实时变成卡片
     * ========================================================== */
    generate: function (opts, h) {
      var buf = '';
      var emitted = 0;
      var lastLen = 0;
      var raf = 0;

      var messages = ai.buildMessages(opts);

      function flush(final) {
        var parsed = ai.parseStream(buf, final);
        if (parsed.topic && h.onTopic) h.onTopic(parsed.topic);

        // 新出现的完整卡片
        for (var i = emitted; i < parsed.cards.length; i++) {
          var c = parsed.cards[i];
          if (!final && i === parsed.cards.length - 1 && !c.closed) break;
          h.onCard && h.onCard(c, i);
          emitted++;
        }
        // 正在写的最后一张
        var tail = parsed.cards[parsed.cards.length - 1];
        if (!final && tail && !tail.closed && emitted === parsed.cards.length - 1) {
          h.onLiveCard && h.onLiveCard(tail, emitted);
        }
        if (final) {
          if (h.onDone) h.onDone(parsed);
        }
      }

      function schedule(final) {
        if (raf) return;
        raf = requestAnimationFrame(function () {
          raf = 0;
          flush(final);
        });
      }

      function run(msgs) {
        buf = '';
        emitted = 0;
        return ai.chat(msgs, {
          onDelta: function (delta) {
            if (!delta) return;
            buf += delta;
            schedule(false);
          }
        }).then(function (full) {
          if (full && full.length > buf.length) buf = full;
          if (raf) cancelAnimationFrame(raf);
          raf = 0;
          flush(true);
          return buf;
        });
      }

      return run(messages).catch(function (err) {
        // 看图失败：自动退回纯文字再试一次
        var hasImages = (opts.attachments || []).some(function (a) { return a.kind === 'image'; });
        if (hasImages && /image|vision|multimodal|content|图片/i.test(err.message || '')) {
          EM.toast('这个模型好像看不了图，先用文字版再试一次');
          var textOnly = ai.buildMessages(Object.assign({}, opts, { attachments: [] }));
          return run(textOnly);
        }
        throw err;
      });
    },

    /* ============================================================
     * 框选追问
     * ========================================================== */
    askOnSelection: function (box, selectedText, question, frame) {
      var spot = EM.boxes.sideAnchor(box, box.y + frame.ry);

      var qbox = EM.boxes.create({
        kind: 'qa',
        x: spot.x,
        y: spot.y,
        w: Math.max(360, Math.min(box.w, 460)),
        title: '追问',
        tag: '追问',
        qa: question,
        html: '<p class="thinking">正在想…</p>'
      });

      frame.qaBoxId = qbox.id;
      EM.annotate.addLink(frame.id, qbox.id);
      EM.annotate.renderFrames();

      ai.answerInto(qbox, box, selectedText, question);

      // 定位过去
      requestAnimationFrame(function () {
        var e5 = EM.boxes.getEl(qbox.id);
        if (e5) qbox.h = e5.offsetHeight;
        EM.annotate.updateLinks();
      });

      return { box: qbox };
    },

    /** 把答案流式写进某张已有的卡片里 */
    answerInto: function (qbox, box, selectedText, question) {
      var ctx = EM.boxes.textOf(box);
      var messages = [
        { role: 'system', content: ASK_SYSTEM },
        {
          role: 'user',
          content: '【所在卡片】' + (box.title || '') + '\n' +
            '【卡片全文】\n' + U.truncate(ctx, 1200) + '\n\n' +
            '【我框住的这一段】\n' + selectedText + '\n\n' +
            '【我的问题】\n' + question
        }
      ];

      var acc = '';
      var el = EM.boxes.getEl(qbox.id);
      if (el) el.classList.add('is-streaming');

      var render = U.throttle(function () {
        qbox.html = EM.md.toHtml(acc);
        qbox.raw = acc;
        EM.boxes.refresh(qbox.id);
        if (!qbox.h) {
          var e2 = EM.boxes.getEl(qbox.id);
          if (e2) qbox.h = e2.offsetHeight;
        }
        EM.annotate.updateLinks();
      }, 90);

      return ai.chat(messages, {
        onDelta: function (d) {
          if (!d) return;
          acc += d;
          render();
        }
      }).then(function (full) {
        if (full && full.length > acc.length) acc = full;
        qbox.html = EM.md.toHtml(acc);
        qbox.raw = acc;
        EM.boxes.refresh(qbox.id);
        var e3 = EM.boxes.getEl(qbox.id);
        if (e3) {
          e3.classList.remove('is-streaming');
          qbox.h = e3.offsetHeight;
        }
        EM.annotate.updateLinks();
        EM.canvas.expandTo({ x: qbox.x, y: qbox.y, w: qbox.w, h: qbox.h }, { pad: 240 });
        EM.persist.schedule();
        return acc;
      }).catch(function (err) {
        var e4 = EM.boxes.getEl(qbox.id);
        if (e4) {
          e4.classList.remove('is-streaming');
          qbox.html = '<p class="err">没能问到答案：' + U.esc(err.message) + '</p>' +
            '<p class="muted">可以在左上角设置里检查接口，或把这句问题复制到任意 AI 里问。</p>';
        }
        EM.boxes.refresh(qbox.id);
        EM.annotate.updateLinks();
      });
    },

    /* ============================================================
     * 解析
     * ========================================================== */
    parseStream: function (buf, final) {
      var text = String(buf || '');
      // 去掉模型可能加的代码围栏
      text = text.replace(/^\s*```[a-zA-Z]*\s*\n?/, '').replace(/\n?```\s*$/, '');

      var out = { topic: '', cards: [] };

      var tm = text.match(/@@topic[ \t]*([^\n]*)/);
      if (tm) out.topic = tm[1].trim();

      var idx = text.indexOf('@@card');
      if (idx < 0) {
        if (final) {
          // 没有按协议输出：退回普通 Markdown 拆分
          out.cards = splitMarkdown(text);
          out.topic = out.topic || guessTopic(text);
        }
        return out;
      }

      var rest = text.slice(idx);
      var chunks = rest.split(/@@card[ \t]*/);
      chunks.shift();

      chunks.forEach(function (chunk, i) {
        var nl = chunk.indexOf('\n');
        var header = nl < 0 ? chunk : chunk.slice(0, nl);
        var body = nl < 0 ? '' : chunk.slice(nl + 1);

        var parts = header.split('|');
        var kind = (parts[0] || '').trim().toLowerCase();
        var title = (parts[1] || '').trim();

        if (!/^(step|quote|para|en|answer|note)$/.test(kind)) {
          // 头还没写完，或者类型不合法
          if (!title && !body) return;
          if (!/^(step|quote|para|en|answer|note)$/.test(kind)) {
            title = title || header.trim();
            kind = guessKind(title, body);
          }
        }

        var isLast = i === chunks.length - 1;
        var closed = !isLast || final;

        body = body.replace(/\s+$/, '');
        var card = { kind: kind, title: title, body: body, closed: closed };

        if (kind === 'en') {
          var pair = splitBilingual(body);
          card.original = pair.original;
          card.translation = pair.translation;
        }

        if (body.trim() || title) out.cards.push(card);
      });

      return out;
    }
  });

  /* ============================================================
   * 辅助
   * ========================================================== */
  function guessKind(title, body) {
    if (/^(原文|摘录|引用|节选)/.test(title)) return 'quote';
    if (/^(译文|翻译|对照)/.test(title)) return 'en';
    if (/^(答案|结论|最终)/.test(title)) return 'answer';
    if (/^(解释|说明|理解|分析)/.test(title)) return 'para';
    if (/EN:|TRANSLATION:/i.test(body)) return 'en';
    return 'step';
  }

  function splitBilingual(body) {
    var t = String(body || '').trim();
    var m = t.match(/^\s*(?:EN|En|英文|原文)\s*[:：]\s*([\s\S]*?)(?:\n+\s*(?:ZH|Zh|中文|翻译|译文)\s*[:：]\s*([\s\S]*))?$/);
    if (m) return { original: (m[1] || '').trim(), translation: (m[2] || '').trim() };

    // 用空行分两段
    var seg = t.split(/\n\s*\n/);
    if (seg.length >= 2) {
      return { original: seg[0].trim(), translation: seg.slice(1).join('\n\n').trim() };
    }
    // 用行分
    var lines = t.split('\n').filter(function (l) { return l.trim(); });
    if (lines.length >= 2) {
      return { original: lines[0].trim(), translation: lines.slice(1).join('\n').trim() };
    }
    return { original: t, translation: '' };
  }

  function guessTopic(text) {
    var t = String(text || '').trim();
    if (!t) return '';
    var first = t.split('\n').find(function (l) { return l.trim(); }) || '';
    first = first.replace(/^#+\s*/, '').replace(/\*\*/g, '').trim();
    return U.truncate(first, 24);
  }

  /** 没按协议输出时，用 Markdown 标题/段落兜底拆分 */
  function splitMarkdown(text) {
    var t = String(text || '').trim();
    if (!t) return [];

    var cards = [];

    // 1) 有 ### 小标题
    if (/(^|\n)\s{0,3}##+\s+/.test(t)) {
      var parts = t.split(/\n(?=\s{0,3}##+\s+)/);
      parts.forEach(function (p) {
        p = p.trim();
        if (!p) return;
        var m = p.match(/^\s{0,3}##+\s+(.+)\n?/);
        var title = m ? m[1].trim() : '';
        var body = m ? p.slice(m[0].length).trim() : p;
        if (!body) return;
        cards.push({ kind: guessKind(title, body), title: title || guessTopic(body), body: body, closed: true });
      });
      if (cards.length) return cards;
    }

    // 2) 按空行分段，每段一张
    var paras = t.split(/\n\s*\n/).map(function (p) { return p.trim(); }).filter(Boolean);
    paras.forEach(function (p) {
      cards.push({ kind: 'note', title: guessTopic(p), body: p, closed: true });
    });
    return cards;
  }

  function makeHttpError(status, text) {
    var msg = 'HTTP ' + status;
    try {
      var j = JSON.parse(text);
      var m = (j.error && (j.error.message || j.error.code)) || j.message || '';
      if (m) msg += '：' + m;
    } catch (e) {
      if (text) msg += '：' + String(text).slice(0, 180);
    }
    if (status === 401) msg += '（密钥无效或权限不足）';
    if (status === 404) msg += '（接口地址或模型名不对）';
    if (status === 429) msg += '（请求太频繁或额度用完了）';
    if (status === 400 && /image|vision|multimodal/i.test(msg)) msg += '（当前模型可能不支持看图）';
    var err = new Error(msg);
    err.status = status;
    return err;
  }

  function pickContent(data) {
    try {
      var ch = data.choices && data.choices[0];
      if (!ch) return '';
      if (ch.message) {
        if (typeof ch.message.content === 'string') return ch.message.content;
        if (Array.isArray(ch.message.content)) {
          return ch.message.content.map(function (p) { return p.text || ''; }).join('');
        }
      }
      if (typeof ch.text === 'string') return ch.text;
      if (data.output) return typeof data.output.text === 'string' ? data.output.text : '';
    } catch (e) { }
    return '';
  }

  /** 从 SSE 的一个 chunk 里取正文增量 */
  function deltaOf(j) {
    try {
      var ch = j.choices && j.choices[0];
      if (!ch) return '';
      if (ch.delta) {
        if (typeof ch.delta.content === 'string') return ch.delta.content;
        if (Array.isArray(ch.delta.content)) {
          return ch.delta.content.map(function (p) { return p.text || ''; }).join('');
        }
      }
      if (ch.message && typeof ch.message.content === 'string') return ch.message.content;
      if (typeof ch.text === 'string') return ch.text;
    } catch (e) { }
    return '';
  }

  function parseSSE(text, onDelta) {
    var full = '';
    var lines = String(text).split(/\r?\n/);
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      if (!line || line.charAt(0) === ':') continue;
      if (line.indexOf('data:') !== 0) continue;
      var payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      var j;
      try { j = JSON.parse(payload); } catch (e) { continue; }
      var d = '';
      try {
        var ch = j.choices && j.choices[0];
        if (ch) {
          if (ch.delta && typeof ch.delta.content === 'string') d = ch.delta.content;
          else if (ch.message && typeof ch.message.content === 'string') d = ch.message.content;
          else if (typeof ch.text === 'string') d = ch.text;
        }
      } catch (e2) { }
      if (d) {
        full += d;
        if (onDelta) onDelta(d, 'chunk');
      }
    }
    return full;
  }

  EM.ai.parseSSE = parseSSE;
  EM.ai.pickContent = pickContent;
  EM.ai.splitMarkdown = splitMarkdown;

})(typeof window !== 'undefined' ? window : globalThis);
