# 文章内容目录

网站文章统一保存在这里，使用 Markdown 格式。页面为 `/blog` 和 `/blog/<slug>`，无需登录。

## 新增文章

1. 复制 `_template.md`，改成有意义的文件名，如 `replay-getting-started.md`。
2. 填写开头的 YAML 信息，再写正文。slug 使用小写英文字母、数字和短横线，必须唯一；发布后尽量保持不变。
3. 完成后把 `draft: true` 改为 `draft: false`，构建并发布网站。

```yaml
---
title: "如何开始第一次行情回放"
slug: "replay-getting-started"
description: "从选择市场到回顾交易，完成一次有记录的练习。"
publishedAt: "2026-11-06"
tags:
  - 使用教程
cover: "/images/blog/replay-getting-started/cover.webp"
draft: false
---
```

`title`、`slug`、`description`、`publishedAt` 必填。日期为有效的 `YYYY-MM-DD`，建议加引号。`tags`、`cover` 可省略。文章必须有正文。列表按发布日期倒序排列。

`draft: true` 的文章在构建阶段排除，正文不会进入浏览器资源。`README.md` 和以下划线开头的文件始终忽略。未来日期不会自动定时发布，需要保持草稿直到准备好发布。

## 图片与正文

图片放到 `frontend/public/images/blog/<slug>/`，正文用 `![图片说明](/images/blog/<slug>/image.webp)` 引用。封面也使用这个目录中的路径。图片应压缩，并填写有意义的说明。

支持标题（二级标题开始）、段落、列表、引用、链接、图片、表格、行内代码和代码块。原始 HTML 会经过安全过滤，脚本、iframe、事件处理器等不会保留。尽量使用 Markdown，不依赖自定义 HTML。

## 本地检查

在 frontend 目录运行 `npm run dev`，打开 `/blog`；添加、修改、删除文章会刷新页面。运行 `npm run build` 验证元信息和生产构建。无效日期、重复 slug 或缺失字段会让构建失败。

目前正文使用客户端渲染，页面会设置独立标题、描述与 canonical；若需要完整的搜索引擎静态正文，后续可增加预渲染。生产 nginx 的 SPA 回退支持直接打开和刷新文章地址。
