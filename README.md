# 衣境 · Cosplay Reader

适合 iPhone Safari、iPad 和桌面浏览器的非色情 Cosplay 精选阅读器。纯静态 Web/PWA，无运行时数据库或账号依赖，部署目标为 Vercel。

## 当前状态

- 阅读器功能已实现：搜索审核目录、标签、排序、网格/列表、详情、收藏、历史、逐页/滚动阅读、左右翻页方向、触摸翻页、页码跳转、进度恢复、主题切换、PWA。
- 当前包括 1 本经过逐图检查的 E-Hentai 非色情 Cosplay 图集（15 页），以及 4 本原创服装插画演示（16 页）。两者在界面中明确区分。
- E-Hentai 接入采用离线、逐图审核后发布的模式。没有公开的全站搜索、任意 URL 代理、登录或 ExHentai 功能。
- 已通过真实图集 Some of my cosplay photos（553248，15 页）验证完整导入和审核链路。上游可能返回 403、限流或变更页面结构。
- 收藏和阅读进度保存在当前浏览器 localStorage；无跨设备同步。清除浏览器数据会清除它们。
- Service Worker 缓存已访问的本地图片；未访问的图片不保证离线可读。应用更新会生成新的缓存版本。

## 本地运行

需要 Node.js 22+；可选的真实图集导入需要 Python 3.10+。

```sh
npm run dev
# http://localhost:3000
npm test
npm run build
node scripts/serve.mjs dist
```

无生产依赖。图标与演示图片均为本站原创。不要在已有正式目录中运行 `scripts/seed-demo.mjs`，它会重置目录为演示数据。

## 非色情 Cosplay 图集导入

不以站点分类或标签代替人工逐图审核，不从公开应用接受任意图集 URL。未审核文件放在 `staging/`，构建只复制 `public/`，并进一步清理未被目录引用的素材。

1. 对明确属于非色情 Cosplay 的候选图集，在本地执行：

   ```sh
   npm run stage -- https://e-hentai.org/g/ID/TOKEN/
   ```

   该命令验证官方元数据的 `Cosplay` 分类，将最多 200 页下载到 `staging/eh-ID/`。失败会停止，不会发布部分内容。请求仅使用 HTTPS 和明确支持的上游域名，遇到禁止访问不会绕过。

2. 在本机打开 `staging/eh-ID/review.html`，**逐张全尺寸检查所有图片**。发现性裸露、性行为、性化呈现或任何不适合范围的内容，拒绝整本图集。仅当全部图片是非色情 Cosplay 时，在 `candidate.json` 中填写合适的标题、简介、标签和审核记录：

   ```json
   {"status":"approved-non-explicit","reviewer":"实际审核者","reviewedAt":"2026-10-30","allPagesReviewed":true}
   ```

3. 运行 `npm run approve -- eh-ID`，再运行 `npm test` 和 `npm run build`。

4. 在 Vercel 部署新版本。审核工具和候选图集不会作为应用接口暴露。构建核对每张真实来源图片的 SHA-256，图片变化必须重新审核。目录、标题、简介和标签也需人工确认，不能包含超出范围的内容。

这是一份审核工作流，不是自动内容识别模型；其正确性依赖审核质量。源站分类本身不构成安全保证。

## 统一限制配置

所有现有业务限制统一在 **[`public/content-policy.json`](public/content-policy.json)** 中维护。导入器、审核入库、构建校验和网页共用此文件；`public/policy.mjs` 是共享执行逻辑，不需要为修改名单、阈值或审核要求而编辑它。

| 配置路径 | 用途 |
| --- | --- |
| `content.allowedCategories` | 可显示和导入的分类，当前为 `cosplay` |
| `content.allowedSources` | 允许的来源，当前为 `demo`、`e-hentai` |
| `content.blockedTags` | 禁止标签，忽略大小写，完整标签匹配 |
| `content.blockedKeywords` | 标题、上传者、简介和标签中的禁止词，忽略大小写，子串匹配 |
| `content.blockedGalleryIds` | 禁止图集 ID，例如 `eh-553248` |
| `content.maxPagesPerGallery` | 单本最多页数，当前 200 |
| `review.approvedStatus` | 审核通过状态值 |
| `review.requireDate` | 是否要求审核日期 |
| `review.sourcesRequiringReviewer` | 必须填写审核者的来源 |
| `review.sourcesRequiringAllPagesReviewed` | 必须完成逐图审核的来源 |
| `review.sourcesRequiringImageHashes` | 必须校验图片 SHA-256 的来源 |
| `assets.maxImageBytes` | 单张图片大小上限，字节，当前 25 MiB |
| `assets.extensionsBySource` | 各来源允许的图片扩展名 |
| `assets.mimeExtensions` | 导入器允许的图片 MIME 类型与保存扩展名 |
| `network.maxResponseBytes` | 单次下载响应上限，字节 |
| `network.timeoutSeconds` | 单次请求超时，秒 |
| `network.requestIntervalSeconds` | 导入请求间隔，秒 |
| `network.hosts` | 允许的域名、子域名及端口 |

例如只需要在 `content` 中设置 `"blockedTags": ["某个标签"]`、`"blockedKeywords": ["某个禁止词"]`，或修改 `maxPagesPerGallery`。JSON 不支持注释；此表提供字段说明。审核状态、标签和阈值规则不会自动识别图片内容，逐图审核仍需执行。

配置缺失或格式错误时停止加载或构建，不会回退到宽松默认值。如果收紧后的规则与已收录图集冲突，构建会失败：需要同时从 `public/catalog.json` 移除不符合规则的图集，再发布。网页也会按同一规则过滤目录。路径穿越防护、本地素材路径要求、HTTPS、站点 URL 格式等程序安全约束仍由代码固定执行，不提供关闭开关。

修改后运行 `npm test && npm run build`，提交并部署。构建会将配置和共享校验逻辑发布到网页，并把它们加入离线缓存版本计算。配置是公开静态文件，不存放登录信息或凭据。

## iOS

Safari 中打开 HTTPS 地址 → 分享 → 添加到主屏幕。支持 safe-area 和动态视口。保留双指缩放；单指横划仅在逐页模式且页面未放大时翻页。可以从设置切换左右翻页方向。

已用 Chromium 的移动视口测试交互；没有真实 iPhone Safari 硬件测试记录。

## 部署

`vercel.json` 指定 `npm run build` 和 `dist/`。构建先验证内容目录，失败则不生成新版本。项目不需要环境变量。

生产域名：`ehentai.polishwb1020.com`。DNS 托管在阿里云，按 Vercel 对此项目返回的记录配置，保留其他子域名记录。

GitHub 仓库：[`polish1020/ehentai-reader`](https://github.com/polish1020/ehentai-reader)。已关联现有 Vercel 项目 `changsheng/ehentai-reader`，Production Branch 为 `main`，构建命令为 `npm run build`，输出目录为 `dist`。

日常修改和发布：

1. 在 GitHub 编辑 [`public/content-policy.json`](https://github.com/polish1020/ehentai-reader/blob/main/public/content-policy.json) 或其他源码。
2. 将修改提交到 `main`，或者通过 Pull Request 合并到 `main`。
3. Vercel 自动构建；在项目的 Deployments 页面确认状态为 `Ready` 后，通过正式域名查看新版本。

只有构建成功的新版本才会替换线上版本；构建失败时，线上继续保留前一个成功版本。其他分支的预览部署遵循项目的 Git 设置。只修改配置文件也需要提交并完成部署，当前网页没有在线配置后台。本机的 `.vercel/`、`.env*` 和 `staging/` 不提交到仓库。

## 参考

- [EhPanda](https://github.com/EhPanda-Team/EhPanda)：iOS 原生浏览和阅读体验。
- [JHentai](https://github.com/jiangtian616/JHenTai)：响应式图集、收藏、历史、标签检索和多种阅读布局。

本项目独立实现，没有复制上述项目的源代码、品牌图标或图片。
