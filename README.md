# 衣境 · Gallery Reader

适合手机、平板和桌面浏览器的 E-Hentai / ExHentai 图集阅读器。收藏、阅读进度与设置保存在当前浏览器，已加载的列表和图片可从本机恢复。

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

- 发现和全部图集从当前源站加载列表；搜索框搜索当前来源，也支持粘贴完整图集链接。
- 在“阅读偏好 → 全局筛选分类”中多选 E-Hentai 的 10 个顶级分类，点击“应用分类”后对发现、搜索、收藏和足迹生效；默认选择全部分类。
- 点击图集详情或列表上方的标签，以该标签向源站精确搜索相关图集，保留全局分类设置。
- “加载更多”沿用源站游标继续请求，保留搜索词和分类。
- 收藏和历史记录保留图集 ID 与 token，首次打开或手动刷新列表时获取源站元数据。
- 阅读支持逐页、滚动、左右翻页方向、触摸翻页、页码跳转和进度恢复。
- 详情和阅读器采用单页导航，返回时保留搜索、分类、排序、布局、已加载结果与滚动位置。浏览器返回/前进可逐层导航，发现、收藏、足迹和全部图集分别保留各自的列表状态。
- 当前浏览器标签页通过 sessionStorage 保存浏览快照，刷新后恢复列表；进行中的列表请求继续执行，刷新时恢复未完成的加载。需要最新结果时点击列表右上角的刷新按钮。
- 已加载的图片通过浏览器 Cache API 保存，再次查看优先读取本地；每个来源会话最多缓存 200 张。设置页可查看数量并清除缓存。PWA 更新保留图片缓存，未缓存图片仍需要网络。
- ExHentai 图片缓存和浏览快照按来源/会话隔离，清除凭证时删除私有缓存；清除浏览器数据会移除收藏与进度。

## ExHentai 凭证

在“阅读偏好 → 内容源与凭证”中填写 `ipb_member_id`、`ipb_pass_hash`、`ipb_session_id`，可选填 `igneous`。点击“验证并保存”后，只有源站访问验证通过才可切换到 ExHentai。失效的 `igneous` 会尝试使用基础凭证重新取得。

凭证通过同源 HTTPS 提交，保存在 `Secure`、`HttpOnly`、`SameSite=Strict` 的浏览器会话 Cookie 中，不回显、不写入 localStorage、sessionStorage、Git 或 URL，也不在服务器数据库中保存。可以随时清除凭证。ExHentai 与 E-Hentai 使用相同的 10 个顶级分类和筛选编号。

## 实时接口

| 路径 | 用途 |
| --- | --- |
| `GET /api/galleries?q=关键词&next=游标&f_cats=排除分类掩码` | 解析源站搜索页，返回图集 ID、token 和下一页游标 |
| `GET /api/image?gid=ID&token=TOKEN&page=页码` | 解析图片页，以 302 跳转到原始图片 |
| `GET/POST/DELETE /api/ex-session` | 检查、验证或清除 ExHentai 会话 |
| `POST /api/metadata` | 取得需要认证的 ExHentai 元数据 |
| `GET /api/thumbnail` | 取得需要认证的小尺寸 ExHentai 封面 |

E-Hentai 元数据直接从浏览器请求 `https://e-hentai.org/api.php`，封面和原图也直连源站/CDN。ExHentai 需要凭证的元数据、搜索及小尺寸封面经过 Vercel；原图解析后仍以 302 让浏览器直连 CDN，Vercel 不转发原图。接口加 `source=exhentai` 时必须持有已验证会话。

图片按需加载，不预取下一页；图片地址跳转在浏览器私有缓存中保留 5 分钟，减少重复解析。搜索 API 响应不缓存，列表浏览快照保留在当前标签页；Service Worker 仅缓存应用界面和图片，凭证及元数据 API 不进入缓存。源站返回错误、限流或不可用时，界面显示错误并提供重试。

## 部署

`vercel.json` 指定 `npm run build` 和 `dist/`。根目录 `api/` 中的接口作为 Node.js Vercel Functions 部署，无数据库或环境变量要求。构建只打包应用界面并更新 PWA 缓存版本。

GitHub 仓库：[`polish1020/ehentai-reader`](https://github.com/polish1020/ehentai-reader)。已有 Vercel 项目为 `changsheng/ehentai-reader`，Production Branch 为 `main`。将变更合并到 `main` 后由 Git 集成自动构建。

生产域名：`ehentai.polishwb1020.com`。

## 参考

- [EhPanda](https://github.com/EhPanda-Team/EhPanda)
- [JHentai](https://github.com/jiangtian616/JHenTai)

本项目独立实现，没有复制上述项目的源代码、品牌图标或图片。
