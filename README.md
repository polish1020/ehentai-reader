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

- “发现”复用当前来源的 Popular 热门页，默认保留源站热度顺序，热门最多 50 本，之后点击“继续浏览最新图集”接上普通列表并去重；“全部图集”浏览源站最新列表。首页热门支持全局分类，搜索词仍进入正常源站搜索，也支持粘贴完整图集链接。
- 源站热门依据最近一分钟访问热度，从过去 24 小时发布的图集中排列，属于全站热门而非个性化推荐（[源站说明](https://ehwiki.org/wiki/Galleries#Popular)）。热门页为空、当前分类没有热门或热门临时不可用时自动切换最新图集；凭证失效仍提示重新验证。热门页不自动轮询，点击刷新获取当前结果；返回和刷新保留续接位置、分页游标与去重结果。
- 在“阅读偏好 → 全局筛选分类”中多选 E-Hentai 的 10 个顶级分类，点击“应用分类”后对发现、搜索、收藏和足迹生效；默认选择全部分类。
- 点击图集详情或列表上方的标签，以该标签向源站精确搜索相关图集，保留全局分类设置。
- “加载更多”沿用源站游标继续请求，保留搜索词和分类。
- 收藏和历史记录保留图集 ID 与 token，首次打开或手动刷新列表时获取源站元数据。
- 默认使用上下连续滚动，仍可手动切换逐页阅读。旧版默认方式会更新一次，之后保留手动选择。支持左右翻页方向、触摸翻页、页码跳转和进度恢复。
- 图集详情默认显示照片缩略图网格；点击照片进入横向预览，支持顺滑左右滑动、底部胶片条跳转，再点击进入全屏。全屏时轻点退出到带底部缩略图的预览；预览和全屏均可下滑直接返回图集网格。
- 照片预览中可切换上下连续阅读，切换时保持当前照片；各模式均按当前页移动预载窗口，提前加载前后各 5 张图片，后台最多 3 张并发。预载复用本地图片缓存，跳页会替换等待队列，退出后停止预载。
- 详情和阅读器采用单页导航，返回时保留搜索、分类、排序、布局、已加载结果与滚动位置。浏览器返回/前进可逐层导航，发现、收藏、足迹和全部图集分别保留各自的列表状态。
- 当前浏览器标签页通过 sessionStorage 保存浏览快照，刷新后恢复列表；进行中的列表请求继续执行，刷新时恢复未完成的加载。需要最新结果时点击列表右上角的刷新按钮。
- 已加载的图片通过浏览器 Cache API 保存，再次查看优先读取本地；每个来源会话最多缓存 200 张。设置页可查看数量并清除缓存。PWA 更新保留图片缓存，未缓存图片仍需要网络。
- ExHentai 图片缓存和浏览快照按来源/会话隔离，清除凭证时删除私有缓存；清除浏览器数据会移除收藏与进度。

## ExHentai 凭证

在“阅读偏好 → 内容源与凭证”中填写 `ipb_member_id`、`ipb_pass_hash`、`ipb_session_id`，可选填 `igneous`。点击“验证并保存”后，只有源站访问验证通过才可切换到 ExHentai。失效的 `igneous` 会尝试使用基础凭证重新取得。

凭证通过同源 HTTPS 提交，保存在本机浏览器的 `Secure`、`HttpOnly`、`SameSite=Strict` 持久 Cookie 中，有效期一年，检查会话时自动续期。关闭浏览器后仍可恢复；现有会话会自动升级，保留私有图片缓存。凭证设置位于阅读偏好最底部；打开设置时以密码输入框回填已保存凭证，可直接修改并更新，关闭设置后清空表单。只有设置页的同源请求会读取凭证，接口响应不缓存。凭证不写入 localStorage、sessionStorage、Git 或 URL，也不在服务器数据库中保存。可以随时点击“清除凭证”；清除浏览器数据或源站凭证失效后需要重新验证。ExHentai 与 E-Hentai 使用相同的 10 个顶级分类和筛选编号。

## 实时接口

| 路径 | 用途 |
| --- | --- |
| `GET /api/galleries?q=关键词&next=游标&f_cats=排除分类掩码&feed=popular` | 读取热门或搜索列表，返回图集 ID、token 和下一页游标（热门无分页） |
| `GET /api/pages?gid=ID&token=TOKEN&p=缩略图分页` | 按需读取源站小图或拼图裁剪信息，避免下载整本原图 |
| `GET /api/image?gid=ID&token=TOKEN&page=页码` | 解析图片页，以 302 跳转到原始图片 |
| `GET/POST/DELETE /api/ex-session` | 检查、验证或清除 ExHentai 会话 |
| `POST /api/metadata` | 取得需要认证的 ExHentai 元数据 |
| `GET /api/thumbnail` | 取得需要认证的小尺寸 ExHentai 封面 |

E-Hentai 元数据直接从浏览器请求 `https://e-hentai.org/api.php`，封面和原图也直连源站/CDN。ExHentai 需要凭证的元数据、搜索及小尺寸封面经过 Vercel；原图解析后仍以 302 让浏览器直连 CDN，Vercel 不转发原图。接口加 `source=exhentai` 时必须持有已验证会话。

图片在当前页前后各 5 张的窗口内预载，范围外保留占位；图片地址跳转在浏览器私有缓存中保留 5 分钟，减少重复解析。搜索 API 响应不缓存，列表浏览快照保留在当前标签页；Service Worker 仅缓存应用界面和图片，凭证及元数据 API 不进入缓存。源站返回错误、限流或不可用时，界面显示错误并提供重试。

## 部署

`vercel.json` 指定 `npm run build` 和 `dist/`。根目录 `api/` 中的接口作为 Node.js Vercel Functions 部署，无数据库或环境变量要求。构建只打包应用界面并更新 PWA 缓存版本。

GitHub 仓库：[`polish1020/ehentai-reader`](https://github.com/polish1020/ehentai-reader)。已有 Vercel 项目为 `changsheng/ehentai-reader`，Production Branch 为 `main`。将变更合并到 `main` 后由 Git 集成自动构建。

生产域名：`ehentai.polishwb1020.com`。

## 参考

- [EhPanda](https://github.com/EhPanda-Team/EhPanda)
- [JHentai](https://github.com/jiangtian616/JHenTai)

本项目独立实现，没有复制上述项目的源代码、品牌图标或图片。
