// ==UserScript==
// @name         豆瓣动态/日记提取器
// @namespace    https://github.com/DouBanSpider
// @version      1.1.0
// @description  提取豆瓣动态页的日记、说说、书影音记录，导出 JSON + 下载图片
// @match        https://www.douban.com/people/*/statuses*
// @match        https://www.douban.com/topic/*
// @match        https://www.douban.com/note/*
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_download
// @grant        GM_xmlhttpRequest
// @grant        GM_addStyle
// @grant        GM_registerMenuCommand
// @run-at       document-idle
// @connect      img1.doubanio.com
// @connect      img2.doubanio.com
// @connect      img3.doubanio.com
// @connect      img9.doubanio.com
// @require      https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js
// ==/UserScript==

(function () {
  'use strict';

  // ========== PageDetector ==========
  const PageDetector = {
    isListPage() {
      return /\/people\/[^/]+\/statuses/.test(location.pathname);
    },
    isTopicPage() {
      return /^\/topic\/\d+/.test(location.pathname);
    },
    isNotePage() {
      return /^\/note\/\d+/.test(location.pathname);
    },
    isDetailPage() {
      return this.isTopicPage() || this.isNotePage();
    },
    getPageType() {
      if (this.isListPage()) return 'list';
      if (this.isTopicPage()) return 'topic';
      if (this.isNotePage()) return 'note';
      return 'unknown';
    }
  };

  // ========== DataStore ==========
  const DataStore = {
    STORAGE_KEY: 'douban_extractor_data',

    getAll() {
      return GM_getValue(this.STORAGE_KEY, []);
    },

    save(items) {
      GM_setValue(this.STORAGE_KEY, items);
    },

    addItems(newItems) {
      const existing = this.getAll();
      const urlSet = new Set(existing.map(item => item.status_url));
      let addedCount = 0;
      for (const item of newItems) {
        if (!urlSet.has(item.status_url)) {
          existing.push(item);
          urlSet.add(item.status_url);
          addedCount++;
        }
      }
      this.save(existing);
      return { total: existing.length, added: addedCount };
    },

    clear() {
      GM_setValue(this.STORAGE_KEY, []);
    },

    exportJSON() {
      const data = this.getAll();
      const dateStr = new Date().toISOString().slice(0, 10);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `豆瓣动态_${dateStr}.json`;
      a.click();
      URL.revokeObjectURL(url);
      return data.length;
    }
  };

  // ========== ListPageParser ==========
  const ListPageParser = {
    /**
     * 解析列表页所有条目，返回元数据数组
     */
    parseAll() {
      const items = [];
      const wrappers = document.querySelectorAll('div.stream-items > div.new-status.status-wrapper');

      for (const wrapper of wrappers) {
        const item = this.parseOne(wrapper);
        if (item) items.push(item);
      }
      return items;
    },

    parseOne(wrapper) {
      // 跳过转发
      if (wrapper.querySelector('span.reshared_by') || wrapper.querySelector('div.reshared')) {
        return null;
      }

      const statusItem = wrapper.querySelector('div.status-item');
      if (!statusItem) return null;

      const dataAtype = statusItem.getAttribute('data-atype') || '';
      const textDiv = wrapper.querySelector('.hd .text') || wrapper.querySelector('.text');
      const textContent = textDiv ? textDiv.textContent.trim() : '';

      // 提取基本信息
      const createdAtEl = wrapper.querySelector('span.created_at[title]');
      const createdAt = createdAtEl ? createdAtEl.getAttribute('title') : '';

      // 提取 status_url：优先从 hd 的 data-status-url，否则从 actions 的链接
      let statusUrl = '';
      const hdDiv = wrapper.querySelector('.hd[data-status-url]');
      if (hdDiv) {
        statusUrl = hdDiv.getAttribute('data-status-url');
      } else {
        const actionLink = wrapper.querySelector('.actions .created_at a[href]');
        if (actionLink) statusUrl = actionLink.getAttribute('href');
      }

      // 提取 status_text（hd .text 区域的文字）
      const statusText = textContent;

      // 提取类型
      const typeInfo = this.detectType(dataAtype, textContent);

      // 提取图片 URL（从 pics-wrapper 中的 script 正则提取）
      const pics = this.extractPicsFromWrapper(wrapper);

      // 构造结果
      const result = {
        created_at: createdAt,
        status_type: typeInfo.type,
        status_url: this.cleanUrl(statusUrl),
        status_text: statusText,
      };

      // 根据类型补充字段
      if (typeInfo.type === 'topic' || typeInfo.type === 'note') {
        const titleLink = wrapper.querySelector('.content .title a');
        result.topic_title = titleLink ? titleLink.textContent.trim() : '';
        result.detail_url = titleLink ? this.cleanUrl(titleLink.getAttribute('href')) : '';
        // 列表页截断文字
        const blockquote = wrapper.querySelector('.content blockquote');
        result.status_saying = blockquote ? this.cleanBlockquoteText(blockquote.textContent) : '';
        result.status_pic_list = pics;
        result.status_pic_local_list = [];
        result._needFetchDetail = true;
      } else if (typeInfo.type === 'saying') {
        const blockquote = wrapper.querySelector('.content blockquote') || wrapper.querySelector('blockquote');
        result.status_saying = blockquote ? this.cleanBlockquoteText(blockquote.textContent) : '';
        result.status_pic_list = pics;
        result.status_pic_local_list = [];
      } else if (typeInfo.type === 'movie') {
        const titleLink = wrapper.querySelector('.content .title a') || wrapper.querySelector('.block .title a');
        result.status_movie_title = titleLink ? titleLink.textContent.trim() : '';
        result.status_movie_url = titleLink ? titleLink.getAttribute('href') : '';
      } else if (typeInfo.type === 'book') {
        const titleLink = wrapper.querySelector('.content .title a') || wrapper.querySelector('.block .title a');
        result.status_book_title = titleLink ? titleLink.textContent.trim() : '';
        result.status_book_url = titleLink ? titleLink.getAttribute('href') : '';
      } else if (typeInfo.type === 'music') {
        const titleLink = wrapper.querySelector('.content .title a') || wrapper.querySelector('.block .title a');
        result.status_music_title = titleLink ? titleLink.textContent.trim() : '';
        result.status_music_url = titleLink ? titleLink.getAttribute('href') : '';
      } else {
        // other 类型也提取图片
        result.status_pic_list = pics;
        result.status_pic_local_list = [];
      }

      return result;
    },

    detectType(dataAtype, textContent) {
      // data-atype 优先
      if (dataAtype === 'personal/topic' || dataAtype === 'group/topic') {
        return { type: 'topic' };
      }
      if (dataAtype === 'note') {
        return { type: 'note' };
      }

      // 文字关键词判断
      if (/看过|在看|想看/.test(textContent)) return { type: 'movie' };
      if (/听过|在听|想听/.test(textContent)) return { type: 'music' };
      if (/读过|在读|想读/.test(textContent)) return { type: 'book' };
      if (/说：|说:/.test(textContent)) return { type: 'saying' };

      return { type: 'other' };
    },

    extractPicsFromWrapper(wrapper) {
      const pics = [];
      const scripts = wrapper.querySelectorAll('.pics-wrapper script');
      for (const script of scripts) {
        const text = script.textContent || '';
        // 匹配 "url": "https://img*.doubanio.com/..." 模式
        const matches = text.matchAll(/"url"\s*:\s*"(https?:\/\/img[^"]+)"/g);
        const urlSet = new Set();
        for (const m of matches) {
          // 优先取 large 的 URL（去重）
          const url = m[1].replace(/\\\//g, '/');
          if (!urlSet.has(url)) {
            urlSet.add(url);
          }
        }
        // 如果有 large + normal 同 URL，去重后只留一份
        pics.push(...urlSet);
      }
      // 去重（同一张图 large 和 normal 可能 URL 一样）
      return [...new Set(pics)];
    },

    cleanUrl(url) {
      if (!url) return '';
      // 去掉整个查询字符串（详情页不需要任何参数）
      return url.split('?')[0].split('#')[0];
    },

    cleanBlockquoteText(text) {
      if (!text) return '';
      return text.trim()
        .replace(/\s*（全文）\s*$/, '')
        .replace(/\s*\(全文\)\s*$/, '')
        .trim();
    }
  };

  // ========== DetailPageFetcher ==========
  const DetailPageFetcher = {
    /**
     * fetch 详情页并解析完整内容
     * @param {string} url - 详情页 URL
     * @returns {Promise<{fullText: string, pics: string[]}>}
     */
    async fetch(url) {
      const resp = await fetch(url, { credentials: 'same-origin' });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const html = await resp.text();
      const doc = new DOMParser().parseFromString(html, 'text/html');

      let fullText = '';
      let pics = [];

      if (/\/topic\//.test(url)) {
        fullText = this.extractTopicText(doc);
        pics = this.extractTopicPics(html);
      } else if (/\/note\//.test(url)) {
        fullText = this.extractNoteText(doc);
        pics = this.extractNotePics(html);
      }

      return { fullText, pics };
    },

    extractTopicText(doc) {
      // 主选择器：div.topic-richtext p
      const paragraphs = doc.querySelectorAll('div.topic-richtext p');
      if (paragraphs.length > 0) {
        return Array.from(paragraphs).map(p => p.textContent.trim()).filter(t => t).join('\n');
      }
      // fallback：div.topic-content
      const topicContent = doc.querySelector('div.topic-content');
      if (topicContent) return topicContent.textContent.trim();
      return '';
    },

    extractTopicPics(html) {
      // 从 window._CONFIG.topic.photos 提取
      const pics = [];
      // 匹配 "large":{"height":...,"url":"..."} 模式
      const regex = /"large"\s*:\s*\{[^}]*"url"\s*:\s*"([^"]+)"/g;
      let m;
      while ((m = regex.exec(html)) !== null) {
        pics.push(m[1].replace(/\\\//g, '/'));
      }
      if (pics.length > 0) return [...new Set(pics)];

      // fallback：提取所有 img*.doubanio.com 的图片 URL
      const fallbackRegex = /"url"\s*:\s*"(https?:\/\/img[^"]+)"/g;
      while ((m = fallbackRegex.exec(html)) !== null) {
        pics.push(m[1].replace(/\\\//g, '/'));
      }
      return [...new Set(pics)];
    },

    extractNoteText(doc) {
      // 多级 fallback
      // 1. div.note-richtext p
      const noteRichtext = doc.querySelectorAll('div.note-richtext p');
      if (noteRichtext.length > 0) {
        return Array.from(noteRichtext).map(p => p.textContent.trim()).filter(t => t).join('\n');
      }
      // 2. #link-report .note
      const linkReportNote = doc.querySelector('#link-report .note');
      if (linkReportNote) return linkReportNote.textContent.trim();
      // 3. #link-report 全文
      const linkReport = doc.querySelector('#link-report');
      if (linkReport) return linkReport.textContent.trim();
      // 4. div.topic-richtext p（有些 note 走 topic 结构）
      const topicRichtext = doc.querySelectorAll('div.topic-richtext p');
      if (topicRichtext.length > 0) {
        return Array.from(topicRichtext).map(p => p.textContent.trim()).filter(t => t).join('\n');
      }
      return '';
    },

    extractNotePics(html) {
      // note 页面的图片提取，复用 topic 的方式
      return this.extractTopicPics(html);
    }
  };

  // ========== DetailPageExtractor ==========
  const DetailPageExtractor = {
    /**
     * 在当前详情页直接提取内容
     */
    extract() {
      const url = location.href.replace(/[?#].*$/, '');
      const title = document.title.trim();
      const createTimeEl = document.querySelector('span.create-time');
      const createdAt = createTimeEl ? createTimeEl.textContent.trim() : '';

      let fullText = '';
      let pics = [];
      let statusType = 'topic';

      if (PageDetector.isTopicPage()) {
        statusType = 'topic';
        fullText = this.extractTopicText();
        pics = this.extractTopicPics();
      } else if (PageDetector.isNotePage()) {
        statusType = 'note';
        fullText = this.extractNoteText();
        pics = this.extractNotePics();
      }

      // 提取用户名
      const authorEl = document.querySelector('.author-name') || document.querySelector('.user-face + .article-main .author-name');
      const authorName = authorEl ? authorEl.textContent.trim() : '';

      return {
        created_at: createdAt,
        status_type: statusType,
        status_url: url,
        status_text: authorName ? `${authorName}\n说：` : title,
        topic_title: title.replace(/的动态$/, '').trim(),
        status_saying: fullText,
        status_pic_list: pics,
        status_pic_local_list: []
      };
    },

    extractTopicText() {
      const paragraphs = document.querySelectorAll('div.topic-richtext p');
      if (paragraphs.length > 0) {
        return Array.from(paragraphs).map(p => p.textContent.trim()).filter(t => t).join('\n');
      }
      const topicContent = document.querySelector('div.topic-content');
      if (topicContent) return topicContent.textContent.trim();
      return '';
    },

    extractTopicPics() {
      // 尝试从 window._CONFIG 读取
      try {
        const config = unsafeWindow._CONFIG || window._CONFIG;
        if (config && config.topic && config.topic.photos) {
          return config.topic.photos
            .map(p => {
              const img = p.image || p;
              return (img.large && img.large.url) || (img.normal && img.normal.url) || '';
            })
            .filter(u => u)
            .map(u => u.replace(/\\\//g, '/'));
        }
      } catch (e) {
        // fallback to regex
      }
      // 正则 fallback
      const scripts = document.querySelectorAll('script');
      for (const s of scripts) {
        const text = s.textContent || '';
        if (text.includes('_CONFIG') && text.includes('photos')) {
          return DetailPageFetcher.extractTopicPics(text);
        }
      }
      return [];
    },

    extractNoteText() {
      return DetailPageFetcher.extractNoteText(document);
    },

    extractNotePics() {
      const html = document.documentElement.innerHTML;
      return DetailPageFetcher.extractNotePics(html);
    }
  };

  // ========== ImageDownloader ==========
  const ImageDownloader = {
    async downloadAll(items, logger) {
      const allPics = [];
      for (const item of items) {
        if (item.status_type !== 'topic' && item.status_type !== 'note') continue;
        const pics = item.status_pic_list || [];
        const date = this.extractDate(item.created_at);
        for (const url of pics) {
          allPics.push({ url, date });
        }
      }

      if (allPics.length === 0) {
        logger('没有找到可下载的图片');
        return;
      }

      logger(`共 ${allPics.length} 张图片，开始逐张下载到磁盘...`);

      const dateTotals = {};
      for (const pic of allPics) {
        dateTotals[pic.date] = (dateTotals[pic.date] || 0) + 1;
      }
      const dateUsed = {};
      let success = 0;
      let fail = 0;

      for (let i = 0; i < allPics.length; i++) {
        const { url, date } = allPics[i];
        const ext = this.extractExt(url);
        const filename = this.buildFilename(date, ext, dateTotals, dateUsed);
        try {
          await this.gmDownload(url, filename);
          success++;
          logger(`[${i + 1}/${allPics.length}] 下载成功: ${filename}`);
        } catch (e) {
          fail++;
          logger(`[${i + 1}/${allPics.length}] 下载失败: ${filename} - ${e.message || e}`);
        }
        if (i < allPics.length - 1) {
          await this.sleep(500 + Math.random() * 1000);
        }
      }

      logger(`下载完成：成功 ${success}，失败 ${fail}，已保存到浏览器下载目录`);
    },

    gmDownload(url, filename) {
      return new Promise((resolve, reject) => {
        GM_download({
          url: url,
          name: `豆瓣图片/${filename}`,
          headers: { 'Referer': 'https://www.douban.com/' },
          onload: () => resolve(),
          onerror: (e) => reject(new Error(e.error || 'download error')),
          ontimeout: () => reject(new Error('timeout'))
        });
      });
    },

    extractDate(createdAt) {
      if (!createdAt) return 'unknown';
      const match = createdAt.match(/^\d{4}-\d{2}-\d{2}/);
      return match ? match[0] : 'unknown';
    },

    extractExt(url) {
      const match = url.match(/\.(\w+)$/);
      return match ? '.' + match[1] : '.jpg';
    },

    buildFilename(date, ext, dateTotals, dateUsed) {
      dateUsed[date] = (dateUsed[date] || 0) + 1;
      if (dateTotals[date] === 1) {
        return `${date}${ext}`;
      }
      return `${date}_${dateUsed[date]}${ext}`;
    },

    sleep(ms) {
      return new Promise(resolve => setTimeout(resolve, ms));
    }
  };

  // ========== AutoPagination ==========
  const AutoPagination = {
    STATE_KEY: 'douban_extractor_auto_state',

    getState() {
      return GM_getValue(this.STATE_KEY, { running: false, startPage: 1, pagesDone: 0, startTime: 0 });
    },

    setState(state) {
      GM_setValue(this.STATE_KEY, state);
    },

    start() {
      this.setState({
        running: true,
        startPage: this.getCurrentPageNumber(),
        pagesDone: 0,
        startTime: Date.now()
      });
    },

    stop() {
      const state = this.getState();
      state.running = false;
      this.setState(state);
    },

    clear() {
      this.setState({ running: false, startPage: 1, pagesDone: 0, startTime: 0 });
    },

    isRunning() {
      return this.getState().running;
    },

    incrementPagesDone() {
      const state = this.getState();
      state.pagesDone++;
      this.setState(state);
    },

    getCurrentPageNumber() {
      const match = location.search.match(/[?&]p=(\d+)/);
      return match ? parseInt(match[1], 10) : 1;
    },

    getNextPageUrl() {
      const nextLink = document.querySelector('.paginator .next a');
      return nextLink ? nextLink.href : null;
    },

    navigateToNextPage(logger) {
      if (!this.isRunning()) {
        logger('自动抓取已停止，不再翻页', 'warn');
        return;
      }
      const nextUrl = this.getNextPageUrl();
      if (!nextUrl) {
        logger('没有下一页了', 'info');
        return;
      }
      const delay = 3000 + Math.random() * 5000;
      logger(`等待 ${(delay / 1000).toFixed(1)} 秒后跳转下一页...`, 'info');
      setTimeout(() => {
        if (!this.isRunning()) {
          logger('自动抓取已停止，取消跳转', 'warn');
          return;
        }
        window.location.href = nextUrl;
      }, delay);
    }
  };

  // ========== UIPanel ==========
  const UIPanel = {
    panel: null,
    logArea: null,
    statsEl: null,
    isRunning: false,

    init() {
      if (PageDetector.isListPage()) {
        this.createListPanel();
      } else if (PageDetector.isDetailPage()) {
        this.createDetailButton();
      }
    },

    createListPanel() {
      GM_addStyle(`
        #db-extractor-panel {
          position: fixed;
          top: 80px;
          right: 20px;
          width: 320px;
          background: #fff;
          border: 1px solid #ccc;
          border-radius: 8px;
          box-shadow: 0 2px 12px rgba(0,0,0,0.15);
          z-index: 99999;
          font-family: "Microsoft YaHei", sans-serif;
          font-size: 13px;
        }
        #db-extractor-panel .panel-header {
          background: #42bd56;
          color: #fff;
          padding: 10px 14px;
          border-radius: 8px 8px 0 0;
          font-size: 14px;
          font-weight: bold;
          cursor: move;
          display: flex;
          justify-content: space-between;
          align-items: center;
        }
        #db-extractor-panel .panel-header .minimize-btn {
          cursor: pointer;
          font-size: 18px;
          line-height: 1;
          color: #fff;
          background: none;
          border: none;
          padding: 0 4px;
        }
        #db-extractor-panel .panel-body {
          padding: 12px 14px;
        }
        #db-extractor-panel .panel-body.hidden {
          display: none;
        }
        #db-extractor-panel .btn-row {
          display: flex;
          gap: 6px;
          margin-bottom: 8px;
          flex-wrap: wrap;
        }
        #db-extractor-panel button {
          padding: 6px 12px;
          border: 1px solid #ccc;
          border-radius: 4px;
          background: #f9f9f9;
          cursor: pointer;
          font-size: 12px;
          transition: background 0.2s;
        }
        #db-extractor-panel button:hover:not(:disabled) {
          background: #e8e8e8;
        }
        #db-extractor-panel button:disabled {
          opacity: 0.5;
          cursor: not-allowed;
        }
        #db-extractor-panel button.primary {
          background: #42bd56;
          color: #fff;
          border-color: #42bd56;
        }
        #db-extractor-panel button.primary:hover:not(:disabled) {
          background: #38a84c;
        }
        #db-extractor-panel button.danger {
          color: #e74c3c;
          border-color: #e74c3c;
        }
        #db-extractor-panel button.stop {
          background: #e74c3c;
          color: #fff;
          border-color: #e74c3c;
        }
        #db-extractor-panel button.stop:hover:not(:disabled) {
          background: #c0392b;
        }
        #db-extractor-panel .stats {
          color: #666;
          margin-bottom: 8px;
          line-height: 1.6;
        }
        #db-extractor-panel .log-area {
          background: #f5f5f5;
          border: 1px solid #ddd;
          border-radius: 4px;
          padding: 8px;
          height: 200px;
          overflow-y: auto;
          font-size: 11px;
          line-height: 1.5;
          color: #333;
          word-break: break-all;
        }
        #db-extractor-panel .log-area .log-line {
          margin-bottom: 2px;
        }
        #db-extractor-panel .log-area .log-success { color: #42bd56; }
        #db-extractor-panel .log-area .log-error { color: #e74c3c; }
        #db-extractor-panel .log-area .log-info { color: #3498db; }
        #db-extractor-panel .log-area .log-warn { color: #f39c12; }

        #db-extractor-detail-btn {
          position: fixed;
          bottom: 30px;
          right: 30px;
          z-index: 99999;
          padding: 10px 18px;
          background: #42bd56;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          font-family: "Microsoft YaHei", sans-serif;
        }
        #db-extractor-detail-btn:hover:not(:disabled) {
          background: #38a84c;
        }
        #db-extractor-detail-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `);

      const panel = document.createElement('div');
      panel.id = 'db-extractor-panel';
      panel.innerHTML = `
        <div class="panel-header">
          <span>豆瓣动态提取器</span>
          <button class="minimize-btn" title="最小化">−</button>
        </div>
        <div class="panel-body">
          <div class="stats"></div>
          <div class="btn-row">
            <button class="primary" id="db-btn-extract">抓取本页</button>
            <button id="db-btn-export">导出 JSON</button>
          </div>
          <div class="btn-row">
            <button class="primary" id="db-btn-auto" style="flex:1">自动抓取所有页</button>
          </div>
          <div class="btn-row">
            <button id="db-btn-download">下载所有图片</button>
            <button class="danger" id="db-btn-clear">清空数据</button>
          </div>
          <div class="log-area"></div>
        </div>
      `;
      document.body.appendChild(panel);

      this.panel = panel;
      this.logArea = panel.querySelector('.log-area');
      this.statsEl = panel.querySelector('.stats');

      // 最小化
      let minimized = false;
      const bodyEl = panel.querySelector('.panel-body');
      const minBtn = panel.querySelector('.minimize-btn');
      minBtn.addEventListener('click', () => {
        minimized = !minimized;
        bodyEl.classList.toggle('hidden', minimized);
        minBtn.textContent = minimized ? '+' : '−';
      });

      // 拖拽
      this.enableDrag(panel);

      // 按钮事件
      panel.querySelector('#db-btn-extract').addEventListener('click', () => this.onExtract());
      panel.querySelector('#db-btn-auto').addEventListener('click', () => this.onAutoToggle());
      panel.querySelector('#db-btn-export').addEventListener('click', () => this.onExport());
      panel.querySelector('#db-btn-download').addEventListener('click', () => this.onDownload());
      panel.querySelector('#db-btn-clear').addEventListener('click', () => this.onClear());

      this.updateStats();
    },

    createDetailButton() {
      GM_addStyle(`
        #db-extractor-detail-btn {
          position: fixed;
          bottom: 30px;
          right: 30px;
          z-index: 99999;
          padding: 10px 18px;
          background: #42bd56;
          color: #fff;
          border: none;
          border-radius: 6px;
          font-size: 14px;
          cursor: pointer;
          box-shadow: 0 2px 8px rgba(0,0,0,0.2);
          font-family: "Microsoft YaHei", sans-serif;
        }
        #db-extractor-detail-btn:hover:not(:disabled) {
          background: #38a84c;
        }
        #db-extractor-detail-btn:disabled {
          opacity: 0.6;
          cursor: not-allowed;
        }
      `);

      const btn = document.createElement('button');
      btn.id = 'db-extractor-detail-btn';
      btn.textContent = '提取本页内容';
      document.body.appendChild(btn);

      btn.addEventListener('click', () => {
        btn.disabled = true;
        btn.textContent = '提取中...';
        try {
          const item = DetailPageExtractor.extract();
          const result = DataStore.addItems([item]);
          btn.textContent = `已提取（累计 ${result.total} 条）`;
        } catch (e) {
          btn.textContent = '提取失败: ' + e.message;
          setTimeout(() => {
            btn.disabled = false;
            btn.textContent = '提取本页内容';
          }, 3000);
        }
      });
    },

    enableDrag(el) {
      const header = el.querySelector('.panel-header');
      let isDragging = false;
      let offsetX, offsetY;

      header.addEventListener('mousedown', (e) => {
        if (e.target.tagName === 'BUTTON') return;
        isDragging = true;
        offsetX = e.clientX - el.getBoundingClientRect().left;
        offsetY = e.clientY - el.getBoundingClientRect().top;
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isDragging) return;
        el.style.left = (e.clientX - offsetX) + 'px';
        el.style.top = (e.clientY - offsetY) + 'px';
        el.style.right = 'auto';
      });

      document.addEventListener('mouseup', () => {
        isDragging = false;
      });
    },

    updateStats() {
      if (!this.statsEl) return;
      const data = DataStore.getAll();
      const typeCounts = {};
      for (const item of data) {
        typeCounts[item.status_type] = (typeCounts[item.status_type] || 0) + 1;
      }
      const typeStr = Object.entries(typeCounts).map(([k, v]) => `${k}:${v}`).join(' | ');
      this.statsEl.innerHTML = `累计: <b>${data.length}</b> 条` + (typeStr ? `<br>${typeStr}` : '');
    },

    log(msg, type = '') {
      if (!this.logArea) {
        console.log('[豆瓣提取器]', msg);
        return;
      }
      const line = document.createElement('div');
      line.className = 'log-line' + (type ? ` log-${type}` : '');
      const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
      line.textContent = `[${time}] ${msg}`;
      this.logArea.appendChild(line);
      this.logArea.scrollTop = this.logArea.scrollHeight;
    },

    setButtonsDisabled(disabled) {
      if (!this.panel) return;
      const buttons = this.panel.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.classList.contains('minimize-btn')) continue;
        // 自动抓取期间保持「停止」按钮可点击
        if (btn.id === 'db-btn-auto' && disabled && AutoPagination.isRunning()) continue;
        btn.disabled = disabled;
      }
    },

    async onExtract() {
      if (this.isRunning) return;
      this.isRunning = true;
      this.setButtonsDisabled(true);
      await this.doExtractCurrentPage();
      this.isRunning = false;
      this.setButtonsDisabled(false);
    },

    async doExtractCurrentPage() {
      this.log('开始解析列表页条目...', 'info');

      try {
        const items = ListPageParser.parseAll();
        this.log(`解析到 ${items.length} 条有效条目`, 'info');

        if (items.length === 0) {
          this.log('本页没有找到条目', 'warn');
          return;
        }

        // 统计类型
        const types = {};
        for (const item of items) {
          types[item.status_type] = (types[item.status_type] || 0) + 1;
        }
        this.log(`类型分布: ${Object.entries(types).map(([k, v]) => `${k}(${v})`).join(', ')}`, 'info');

        // 对 topic/note 类型拉取详情页
        const needFetch = items.filter(item => item._needFetchDetail && item.detail_url);
        if (needFetch.length > 0) {
          this.log(`需要拉取 ${needFetch.length} 个详情页...`, 'info');
          for (let i = 0; i < needFetch.length; i++) {
            const item = needFetch[i];
            this.log(`[${i + 1}/${needFetch.length}] 正在拉取: ${item.topic_title || item.detail_url}`, 'info');
            try {
              const detail = await DetailPageFetcher.fetch(item.detail_url);
              if (detail.fullText) {
                item.status_saying = detail.fullText;
                this.log(`  → 全文提取成功 (${detail.fullText.length} 字)`, 'success');
              } else {
                this.log(`  → 未能提取全文，保留截断文字`, 'warn');
              }
              if (detail.pics.length > 0) {
                item.status_pic_list = detail.pics;
                this.log(`  → 提取到 ${detail.pics.length} 张图片`, 'success');
              }
            } catch (e) {
              this.log(`  → 详情页拉取失败: ${e.message}，保留列表页数据`, 'error');
            }

            // 随机延迟 2-5 秒
            if (i < needFetch.length - 1) {
              const delay = 2000 + Math.random() * 3000;
              this.log(`  等待 ${(delay / 1000).toFixed(1)} 秒...`);
              await new Promise(resolve => setTimeout(resolve, delay));
            }
          }
        }

        // 清理内部标志字段
        for (const item of items) {
          delete item._needFetchDetail;
          delete item.detail_url;
        }

        // 保存
        const result = DataStore.addItems(items);
        this.log(`保存完成: 新增 ${result.added} 条，累计 ${result.total} 条`, 'success');
        this.updateStats();

      } catch (e) {
        this.log(`错误: ${e.message}`, 'error');
        console.error('[豆瓣提取器]', e);
      }
    },

    onExport() {
      try {
        const count = DataStore.exportJSON();
        this.log(`已导出 ${count} 条数据`, 'success');
      } catch (e) {
        this.log(`导出失败: ${e.message}`, 'error');
      }
    },

    async onDownload() {
      if (this.isRunning) return;
      this.isRunning = true;
      this.setButtonsDisabled(true);

      const data = DataStore.getAll();
      await ImageDownloader.downloadAll(data, (msg) => {
        if (msg.includes('失败')) {
          this.log(msg, 'error');
        } else if (msg.includes('成功')) {
          this.log(msg, 'success');
        } else {
          this.log(msg, 'info');
        }
      });

      this.isRunning = false;
      this.setButtonsDisabled(false);
    },

    onAutoToggle() {
      if (AutoPagination.isRunning()) {
        AutoPagination.stop();
        this.updateAutoButton(false);
        this.log('自动抓取已停止，当前页完成后不再翻页', 'warn');
      } else {
        AutoPagination.start();
        this.updateAutoButton(true);
        this.log('自动抓取已启动', 'success');
        this.startAutoExtract();
      }
    },

    async startAutoExtract() {
      this.isRunning = true;
      this.setButtonsDisabled(true);

      const pageNum = AutoPagination.getCurrentPageNumber();
      this.log(`正在抓取第 ${pageNum} 页...`, 'info');

      await this.doExtractCurrentPage();
      AutoPagination.incrementPagesDone();

      // 检查是否仍在运行
      if (!AutoPagination.isRunning()) {
        this.log('自动抓取已停止', 'warn');
        this.isRunning = false;
        this.setButtonsDisabled(false);
        this.updateAutoButton(false);
        this.showAutoSummary();
        return;
      }

      // 检查下一页
      const nextUrl = AutoPagination.getNextPageUrl();
      if (!nextUrl) {
        this.log('已到达最后一页', 'success');
        AutoPagination.stop();
        this.isRunning = false;
        this.setButtonsDisabled(false);
        this.updateAutoButton(false);
        this.showAutoSummary();
        return;
      }

      // 跳转到下一页
      AutoPagination.navigateToNextPage((msg, type) => this.log(msg, type));
    },

    updateAutoButton(isRunning) {
      const btn = this.panel && this.panel.querySelector('#db-btn-auto');
      if (!btn) return;
      if (isRunning) {
        btn.textContent = '停止自动抓取';
        btn.classList.remove('primary');
        btn.classList.add('stop');
      } else {
        btn.textContent = '自动抓取所有页';
        btn.classList.remove('stop');
        btn.classList.add('primary');
      }
    },

    showAutoSummary() {
      const state = AutoPagination.getState();
      const elapsed = Date.now() - state.startTime;
      const minutes = Math.floor(elapsed / 60000);
      const seconds = Math.floor((elapsed % 60000) / 1000);
      const totalItems = DataStore.getAll().length;
      this.log(`=== 自动抓取完成 ===`, 'success');
      this.log(`共抓取 ${state.pagesDone} 页，累计 ${totalItems} 条数据，耗时 ${minutes}分${seconds}秒`, 'success');
      AutoPagination.clear();
    },

    onClear() {
      if (!confirm('确定要清空所有已提取的数据吗？')) return;
      AutoPagination.stop();
      AutoPagination.clear();
      DataStore.clear();
      this.updateAutoButton(false);
      this.log('数据已清空', 'warn');
      this.updateStats();
    }
  };

  // ========== 注册 Tampermonkey 菜单命令 ==========
  GM_registerMenuCommand('导出 JSON', () => {
    const count = DataStore.exportJSON();
    alert(`已导出 ${count} 条数据`);
  });

  GM_registerMenuCommand('清空数据', () => {
    if (confirm('确定要清空所有已提取的数据吗？')) {
      DataStore.clear();
      alert('数据已清空');
    }
  });

  GM_registerMenuCommand('查看累计数据量', () => {
    const data = DataStore.getAll();
    const types = {};
    for (const item of data) {
      types[item.status_type] = (types[item.status_type] || 0) + 1;
    }
    const typeStr = Object.entries(types).map(([k, v]) => `${k}: ${v}`).join('\n');
    alert(`累计 ${data.length} 条数据\n\n${typeStr || '暂无数据'}`);
  });

  // ========== 启动 ==========
  UIPanel.init();

  // ========== 自动抓取恢复 ==========
  if (PageDetector.isListPage() && AutoPagination.isRunning()) {
    setTimeout(() => {
      const pageNum = AutoPagination.getCurrentPageNumber();
      UIPanel.log(`自动抓取恢复中（第 ${pageNum} 页）...`, 'info');
      UIPanel.updateAutoButton(true);
      UIPanel.startAutoExtract();
    }, 1000);
  }

})();
