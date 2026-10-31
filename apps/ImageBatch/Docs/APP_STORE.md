# 上架准备

核对日期：2026-10-31。此工程是通用下载工具，所有导入、更新链接和下载行为均需如实提供给审核。无需隐藏功能或特定站点的额外配置。

## 账号与设备

1. 准备开启双重认证的 Apple Account，真实姓名、可验证身份证明和联系方式。
2. 公开上架加入 Apple Developer Program，通常 99 美元/年，地区价格以购买页面为准。符合条件的非营利、教育和政府机构可申请减免。个人账号足够发布，商店销售者显示个人法定姓名；组织账号显示组织名称，需法律实体、D-U-N-S 等材料。
3. 准备 Mac/Xcode 或 macOS CI、至少一台实际 iPhone。免费账号可真机开发测试，个人测试描述文件一般 7 天到期，不能公开上架。不要购买企业证书用于公众分发。

## 签名和 App Store Connect

- 确定正式应用名、唯一 Bundle ID；当前工程的应用名和标识是开发用默认值。
- 在 Apple 账号创建/确认 App ID，Xcode 选择 Team，自动管理开发签名。
- 在 App Store Connect 创建应用记录；正式签名 Archive → Validate → 上传。若配置 CI 上传，应使用受限的 App Store Connect API Key，并存入 CI Secrets，不提交仓库。
- 签署需要的协议；如果将来收费或提供内购，另外完善税务和收款信息。
- 当前 Apple 要求上传 iOS 应用使用 Xcode 26+ 和 iOS 26+ SDK，最低支持系统仍可设置 iOS 17；提交前重新核对 Apple 要求，使用正式受支持的 Xcode。

## 商店资料

- 图标（工程提供 1024px 工作版）、当前实际界面的 iPhone/iPad 截图、描述、关键词、分类、版本信息。
- 开发者支持邮箱、有效支持网址，以及无需登录可访问的隐私政策 URL。`PRIVACY.md` 需要填入发布者和联系方式后发布。
- App Privacy 问卷按实际行为填写：本版本没有开发者后端、账号、广告或分析，不收集或上传下载列表；用户指定的文件服务器仍会收到正常网络请求。若以后增加 SDK、崩溃上报、云同步，必须重新评估。
- 年龄分级、内容权利和加密出口问卷如实填写。本版本仅使用系统 HTTPS，不包含自行实现的加密算法，工程声明不使用非豁免加密；最终以实际功能及 Apple 问卷为准。
- 面向中国大陆发行时核实 APP 备案/ICP 等要求；面向欧盟发行时填写适用的交易者信息。

## 审核材料

描述应用的真实用途：导入公开通用格式的图片清单，用户主动发起下载、管理本机文件、导出 ZIP。提供自己有权使用、长期可访问的示例图片和 JSON/TXT；审核需覆盖导入、去重、错误处理、更新链接和导出。

不内置特定内容源，不需要登录账号，不执行清单中的代码。没有站点限制不意味着对内容和下载权利没有责任；Apple 仍会评估实际用途和第三方服务授权。App Store 通过情况不能提前保证。

## 真机验收（提交前必须实际完成）

- [ ] 选择本机目录、iCloud Drive、第三方文件服务；重启后授权恢复，保存失败仅重试保存；系统云端同步状态正确。
- [ ] 相册添加权限允许/拒绝/撤销、Photos 保存和 WebP 转换；不请求读取照片。
- [ ] 在实际设备导入 TXT、JSON、粘贴多链接；从“文件”App 分享文件打开。
- [ ] 长 JSON / TXT 导入后预览和保存位置可达，清单默认收起；展开后的编辑框内部滚动，收起再展开不丢失内容；动态字体和 iPad 布局正常。
- [ ] 有效图片成功，404/403、登录 HTML、无网络、TLS 错误正确失败。
- [ ] 锁屏、切后台、重新启动后核对任务和磁盘文件；了解强制退出限制。
- [ ] 停止/重试/更新链接快速连续操作，旧回调不能覆盖新文件；已下载文件保持。
- [ ] 链接过期后导入更新清单，按稳定 id/文件名保留完成项，不重复保存相册项；TXT 顺序保持一致。
- [ ] 验证存储空间不足、5000项清单、长/中文/重复文件名和大图。
- [ ] ZIP 用系统“文件”App 解压，单图分享、删除以及 iPad 分屏/旋转正常。
- [ ] VoiceOver、动态字体、深浅色、弱网与蜂窝网络。
- [ ] 使用正式签名的 Release 构建完成一轮 TestFlight 真机验证。

开发阶段的编译、自动化与手动验证记录见 [README](../README.md#本机验证记录2026-10-31)。个人开发签名的安装成功或使用者反馈正常，不替代本清单中的权限拒绝、故障、后台及正式发布验证；检查项仅在对应场景实际完成后勾选。

## 官方资料

- https://developer.apple.com/help/account/membership/program-enrollment/
- https://developer.apple.com/help/account/basics/about-your-developer-account/
- https://developer.apple.com/news/upcoming-requirements/
- https://developer.apple.com/help/app-store-connect/manage-app-information/overview-of-app-privacy-details/
- https://developer.apple.com/app-store/review/guidelines/
