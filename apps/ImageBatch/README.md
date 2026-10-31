# 拾图 / ImageBatch

独立的通用 iOS 图片下载器，导入图片链接即可批量保存到本机。

## 主要功能

- 粘贴链接，或导入 TXT / JSON 下载清单。
- 保存到应用内、文件目录、iCloud Drive 或系统相册。
- 下载进度、后台下载、失败重试和任务恢复。
- 更新失效链接后继续原任务，保留已完成的图片。
- 单张图片分享，以及文件任务的 ZIP 导出。

## 构建与运行

需要 Mac 和 Xcode 26 或更新版本，最低支持 iOS 17。

1. 打开 `ImageBatch.xcodeproj`。
2. 在 **Signing & Capabilities** 中选择自己的 Team，并设置可用的 Bundle ID。
3. 选择模拟器或连接 iPhone，点击 **Run**。真机需按系统提示开启开发者模式。

修改 `project.yml` 后，使用 XcodeGen 重新生成工程。

## 导入清单

TXT 每行一个 HTTPS 图片链接；JSON 格式见 [示例文件](Examples/images.json)。单任务最多 5,000 项，文件不超过 5 MB。

链接过期后重新导入清单，选择“继续已有任务”。JSON 保持相同的 `id`，TXT 保持原顺序，已完成图片不会重复下载。

保存到相册时，部分格式会转换为静态 JPEG；需要保留原文件或动画时，请选择文件目录。

## 更多说明

- [上架准备](Docs/APP_STORE.md)
- [隐私政策草稿](Docs/PRIVACY.md)
- [自动构建与测试](https://github.com/polish1020/gallery-reader/actions/workflows/image-batch-ios.yml)

自动构建提供的 IPA 未签名，安装到真机前需使用自己的 Apple 账号签名。
