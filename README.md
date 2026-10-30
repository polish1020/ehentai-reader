# 衣境 · Gallery Reader

适合手机、平板和桌面浏览器的实时 E-Hentai 图集阅读器。搜索、图集信息和图片均在使用时请求源站，收藏、阅读进度与设置保存在当前浏览器。

## 本地运行

需要 Node.js 22+。

```sh
npm install
npm run dev
# http://localhost:3000
npm test
npm run build
node scripts/serve.mjs dist
```

开发服务器和 Vercel 部署共用同一组 API。`dist/` 是应用界面，实时接口需要 Node.js 服务或 Vercel Functions，不能只部署到纯静态文件服务器。

## 使用

- 发现和全部图集从源站加载最新列表；搜索框实时搜索 E-Hentai，也支持粘贴完整图集链接。
- 在“阅读偏好 → 全局筛选分类”中多选 E-Hentai 的 10 个顶级分类，点击“应用分类”后对发现、搜索、收藏和足迹生效；默认选择全部分类。
- 点击图集详情或列表上方的标签，以该标签向源站精确搜索相关图集，保留全局分类设置。
- “加载更多”沿用源站游标继续请求，保留搜索词和分类。
- 收藏和历史记录保留图集 ID 与 token，打开列表时重新获取源站元数据。
- 阅读支持逐页、滚动、左右翻页方向、触摸翻页、页码跳转和进度恢复。
- PWA 仅缓存应用界面；图集和图片需要网络连接。清除浏览器数据会移除收藏与进度。

## 实时接口

| 路径 | 用途 |
| --- | --- |
| `GET /api/galleries?q=关键词&next=游标&f_cats=排除分类掩码` | 解析源站搜索页，返回图集 ID、token 和下一页游标 |
| `GET /api/image?gid=ID&token=TOKEN&page=页码` | 解析图片页，以 302 跳转到原始图片 |

元数据直接从浏览器请求 `https://e-hentai.org/api.php`；收藏、历史与详情不经过 Vercel。封面和原图也由浏览器直连源站或图片 CDN，Vercel 不接收或转发图片文件。仅不支持跨域的搜索页和图片页通过两个小型接口解析。

图片按需加载，不预取下一页；图片地址跳转在浏览器私有缓存中保留 5 分钟，减少重复解析。搜索结果不缓存，Service Worker 仅缓存应用界面。源站返回错误、限流或不可用时，界面显示错误并提供重试。

## 部署

`vercel.json` 指定 `npm run build` 和 `dist/`。根目录 `api/` 中的接口作为 Node.js Vercel Functions 部署，无数据库或环境变量要求。构建只打包应用界面并更新 PWA 缓存版本。

GitHub 仓库：[`polish1020/ehentai-reader`](https://github.com/polish1020/ehentai-reader)。已有 Vercel 项目为 `changsheng/ehentai-reader`，Production Branch 为 `main`。将变更合并到 `main` 后由 Git 集成自动构建。

生产域名：`ehentai.polishwb1020.com`。

## 参考

- [EhPanda](https://github.com/EhPanda-Team/EhPanda)
- [JHentai](https://github.com/jiangtian616/JHenTai)

本项目独立实现，没有复制上述项目的源代码、品牌图标或图片。
