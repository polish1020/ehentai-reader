# Gallery Reader

适合手机、平板和桌面浏览器的图集阅读器，提供简洁的浏览、搜索与阅读体验。

[在线体验](https://gallery.polishwb1020.com)

## 主要功能

- 热门发现、分类筛选、高级搜索和以图搜图。
- 缩略图预览、全屏查看、手势缩放和上下连续阅读。
- 收藏管理、浏览足迹、搜索历史和阅读进度保存。
- 图片预载、本地缓存、深浅色主题和 PWA 支持。
- 导出图片下载清单，配合独立下载器批量保存。

## 本地运行

需要 Node.js 22 或更新版本。

```sh
npm install
npm run dev
```

浏览器打开 <http://localhost:3000>。

```sh
npm test       # 运行测试
npm run build  # 构建应用
```

部署到 Vercel 时，构建命令为 `npm run build`，输出目录为 `dist/`。项目包含服务端接口，需要支持 Node.js 或 Vercel Functions 的运行环境。

## iOS 下载器

仓库内包含独立的通用图片下载器，支持导入链接清单、保存到文件目录或相册，以及更新失效链接后继续下载。

构建与安装方法见 [ImageBatch 使用说明](apps/ImageBatch/README.md)。
