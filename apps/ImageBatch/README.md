# 拾图 / ImageBatch

独立的通用 iOS 图片下载器。没有特定网站适配、图集解析、账号登录或远程配置；只下载用户导入的 HTTPS 图片直链。它与本仓库网站之间没有运行时依赖，可以把整个 `apps/ImageBatch` 目录移到独立仓库构建。

## 已实现

- 粘贴多条链接，导入 UTF-8 TXT / JSON，通过“文件 → 分享/打开方式”导入清单。
- 清单预览、URL 去重、安全文件名、同名文件避让；单任务最多 5,000 项、清单最大 5 MB。
- 三个并发下载、原生进度、停止、失败重试；检查 HTTP 状态及图片格式，错误页不显示为成功。
- URLSession 后台会话；重新打开时恢复系统中的下载任务，其他未完成任务重新排队。
- 按文件名导入更新的链接，保留已完成图片；普通网络重试不自动刷新过期直链。
- 图片直接保存到本机，不经过开发者服务器；不携带浏览器 Cookie、Authorization 或 Referer。
- 分享单张图片，流式导出无压缩 ZIP，不把整本图片加载到内存。ZIP 单次上限 4 GB / 65,535 项。
- 任务持久保存、删除任务及对应文件、深浅色和动态字体、iPhone/iPad。
- 本地隐私说明、隐私清单，无分析、广告或第三方 SDK。

## 构建

需要 Mac、Xcode 26 或更高版本（提交 App Store 时使用 Apple 当前支持的正式版本），以及 XcodeGen。

```sh
brew install xcodegen
cd apps/ImageBatch
xcodegen generate
open ImageBatch.xcodeproj
```

在 Xcode 的 ImageBatch target → Signing & Capabilities 中选择你自己的 Team。临时 Bundle ID 为 `com.polishwb1020.imagebatch`，正式提交前需要决定并在账号中注册唯一标识。默认最低系统 iOS 17。

无需开发者账号的编译检查：

```sh
xcodebuild -project ImageBatch.xcodeproj -scheme ImageBatch \
  -configuration Release -sdk iphoneos -destination 'generic/platform=iOS' \
  -derivedDataPath DerivedData CODE_SIGNING_ALLOWED=NO build
```

核心测试及 UI 测试：

```sh
cd Core
swift test
cd ..
xcodebuild -project ImageBatch.xcodeproj -scheme ImageBatch \
  -destination 'platform=iOS Simulator,name=iPhone 17' CODE_SIGNING_ALLOWED=NO test
```

`project.yml` 是工程配置来源；`.github/workflows/image-batch-ios.yml` 自动生成工程、测试核心、编译 iPhone Release，并在可用 iPhone 模拟器上测试导入界面。CI 不签名、不提交 App Store，也不生成可安装的签名 IPA。

## 下载清单

TXT 每行一个链接；JSON 支持 `Examples/images.json` 的对象格式、链接字符串数组或项目数组。对象格式的 `version` 默认为 1。`filename` 可省略，省略时按顺序生成文件名。签名路径和查询参数保持原样；重复链接忽略 fragment 后去重。

清单不支持脚本、可执行指令或网页解析。只接受 HTTPS，不支持含用户名/密码的 URL。需要额外登录、特殊请求头、已过期或服务器拒绝的链接可能失败。导入文件不要包含账号凭证。

## 本地存储与后台行为

- 任务在 Application Support 中；原链接可能包含临时访问签名，不发送到开发者服务器。
- 下载文件在 Documents/Downloads 的任务/项目目录中；使用 UUID 隔离，避免旧请求回调覆盖重试后的文件。可从系统“文件”App 访问。
- 图片排除 iCloud 设备备份；任务记录可能随设备备份保存。导出的 ZIP 放在临时缓存中，次日启动时清理。
- 读取任务记录失败时不会覆盖记录或自动开始下载，避免损坏已有任务。
- 图片完成以 HTTP 成功、格式检查及本地写入成功为准；不以“请求已开始”标记成功。
- 进程暂停时正在执行的系统下载可继续，但具体时机由 iOS 调度。用户强制退出后系统可能取消任务，重新打开时继续排队；不是无限后台执行。
- 当前版本失败重试会重新下载单个文件，不承诺断点续传。短期链接长时间排队后可能失效，需要导入更新清单。

## 发布前

见 [上架准备](Docs/APP_STORE.md) 和 [隐私政策草稿](Docs/PRIVACY.md)。应用名和 Bundle ID 尚未注册；发布者、联系方式、公开隐私政策 URL 和支持 URL 需要由账号持有人确认。开发完成不代表获得 Apple 审核通过。
