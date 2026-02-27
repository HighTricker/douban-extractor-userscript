# 豆瓣动态提取器 | Douban Status Extractor

一个 Tampermonkey / Violentmonkey 油猴脚本，用于批量提取豆瓣个人动态页的所有内容（说说、日记、书影音记录等），支持自动翻页、导出 JSON、打包下载图片。

A Tampermonkey / Violentmonkey userscript for batch-extracting all content from Douban personal status pages (posts, diaries, book/movie/music records, etc.), with auto-pagination, JSON export, and batch image download.

---

## 功能特性 | Features

### 中文

- **一键抓取当前页** — 解析列表页所有条目，自动拉取日记/话题详情页的完整全文
- **自动抓取所有页** — 点一次按钮，自动完成「抓取 → 翻页 → 抓取」循环，直到最后一页
- **随时停止** — 自动抓取过程中可随时点击停止，当前页完成后安全中断
- **导出 JSON** — 将所有已提取数据导出为结构化 JSON 文件
- **批量下载图片** — 将日记/话题中的图片打包为 ZIP 下载
- **跨页数据累积** — 使用 `GM_setValue` 持久化存储，数据在页面跳转间自动保留
- **去重机制** — 基于 URL 自动去重，重复抓取不会产生重复数据
- **反爬友好** — 请求间随机延迟，降低触发风控的风险

### English

- **Extract current page** — Parse all entries on the list page, automatically fetch full text from diary/topic detail pages
- **Auto-extract all pages** — One click to automatically loop through "extract → next page → extract" until the last page
- **Stop anytime** — Stop button available during auto-extraction; safely halts after the current page completes
- **Export JSON** — Export all extracted data as a structured JSON file
- **Batch download images** — Package all diary/topic images into a ZIP file for download
- **Cross-page data accumulation** — Uses `GM_setValue` for persistent storage; data is preserved across page navigations
- **Deduplication** — Automatic URL-based deduplication prevents duplicate entries
- **Rate-limit friendly** — Random delays between requests to reduce the risk of triggering anti-scraping measures

## 支持的动态类型 | Supported Status Types

| 类型 Type | 说明 Description |
|-----------|------------------|
| `saying` | 说说（短文字动态） Short text posts |
| `topic` | 日记 / 小组话题 Diaries / Group topics |
| `note` | 笔记 Notes |
| `movie` | 电影标记（看过/想看/在看） Movie records |
| `book` | 图书标记（读过/想读/在读） Book records |
| `music` | 音乐标记（听过/想听/在听） Music records |

## 安装 | Installation

### 1. 安装脚本管理器 | Install a userscript manager

推荐使用以下浏览器扩展之一：

Install one of the following browser extensions:

- [Tampermonkey](https://www.tampermonkey.net/) (Chrome / Firefox / Edge / Safari)
- [Violentmonkey](https://violentmonkey.github.io/) (Chrome / Firefox / Edge)

### 2. 安装脚本 | Install the script

点击下方链接，脚本管理器会自动弹出安装提示：

Click the link below, and the userscript manager will prompt you to install:

**[点击安装 / Click to install](../../raw/main/douban-extractor.user.js)**

或者手动操作：打开脚本管理器 → 新建脚本 → 将 `douban-extractor.user.js` 的内容粘贴进去 → 保存。

Or manually: open the userscript manager → create a new script → paste the contents of `douban-extractor.user.js` → save.

## 使用方法 | Usage

### 单页抓取 | Single Page Extraction

1. 打开你的豆瓣动态页：`https://www.douban.com/people/{你的ID}/statuses`
2. 页面右侧会出现「豆瓣动态提取器」面板
3. 点击 **「抓取本页」** 按钮
4. 等待日志显示完成后，点击 **「导出 JSON」** 保存数据

---

1. Open your Douban status page: `https://www.douban.com/people/{your-id}/statuses`
2. The "Douban Status Extractor" panel will appear on the right side
3. Click the **"抓取本页" (Extract this page)** button
4. After the log shows completion, click **"导出 JSON" (Export JSON)** to save

### 自动抓取所有页 | Auto-Extract All Pages

1. 进入动态列表的第 1 页
2. 点击 **「自动抓取所有页」** 按钮
3. 脚本会自动完成：抓取当前页 → 等待数秒 → 跳转下一页 → 继续抓取
4. 到达最后一页后自动停止，显示抓取摘要
5. 中途可随时点击 **「停止自动抓取」** 安全中断

---

1. Navigate to page 1 of the status list
2. Click the **"自动抓取所有页" (Auto-extract all pages)** button
3. The script will automatically: extract the current page → wait a few seconds → navigate to the next page → continue
4. Automatically stops at the last page with a summary
5. Click **"停止自动抓取" (Stop auto-extract)** anytime to safely interrupt

### 下载图片 | Download Images

点击 **「下载所有图片」**，脚本会将所有日记/话题中的图片下载并打包为 ZIP 文件。

Click **"下载所有图片" (Download all images)** to download and package all diary/topic images into a ZIP file.

## 导出数据格式 | Export Data Format

```json
[
  {
    "created_at": "2026-02-24 14:21:14",
    "status_type": "movie",
    "status_url": "https://www.douban.com/people/.../status/.../",
    "status_text": "看过 ★★★★☆ 不错的电影...",
    "status_movie_title": "电影名称 (2026)",
    "status_movie_url": "https://movie.douban.com/subject/.../"
  },
  {
    "created_at": "2026-02-20 10:00:00",
    "status_type": "topic",
    "status_url": "https://www.douban.com/topic/.../",
    "status_text": "说：...",
    "topic_title": "日记标题",
    "status_saying": "日记完整全文...",
    "status_pic_list": ["https://img9.doubanio.com/..."],
    "status_pic_local_list": []
  }
]
```

## 适用页面 | Supported Pages

| URL 模式 Pattern | 说明 Description |
|-------------------|------------------|
| `https://www.douban.com/people/*/statuses*` | 个人动态列表页 Status list page |
| `https://www.douban.com/topic/*` | 话题详情页 Topic detail page |
| `https://www.douban.com/note/*` | 笔记详情页 Note detail page |

## 注意事项 | Notes

- 脚本使用随机延迟（3-8 秒翻页，2-5 秒拉取详情页）以降低被豆瓣风控的概率，请勿修改为过小的值
- 数据存储在浏览器的油猴脚本存储中（`GM_setValue`），清除浏览器扩展数据会导致已抓取数据丢失，请及时导出
- 自动抓取状态在页面跳转间通过 `GM_setValue` 持久化，浏览器意外关闭后重新打开页面可自动恢复

---

- The script uses random delays (3-8s for pagination, 2-5s for detail fetching) to reduce the risk of triggering Douban's anti-scraping. Do not reduce these values.
- Data is stored in the userscript manager's storage (`GM_setValue`). Clearing browser extension data will erase extracted data — export promptly.
- Auto-extraction state is persisted via `GM_setValue` across page navigations. If the browser closes unexpectedly, reopening the page will auto-resume.

## 依赖 | Dependencies

- [JSZip](https://stuk.github.io/jszip/) v3.10.1 — 图片打包为 ZIP（通过 `@require` 自动加载）

  Used for packaging images into ZIP files (auto-loaded via `@require`).

## License

MIT
