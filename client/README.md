# ReviewPilot 客户端

ReviewPilot 的跨平台 Flutter 客户端，支持 macOS、Windows、iPhone/iPad 和 Android。

## 运行方式

客户端不连接 ReviewPilot 服务端，也不需要部署 ReviewPilot 后端。设备需要能够联网，并由客户端直接访问用户配置的 GitLab 和 OpenAI API：

```text
ReviewPilot 客户端 ── HTTPS ──> GitLab API
                   └─ HTTPS ──> OpenAI Responses API
```

- GitLab Token 和 OpenAI API Key 只写入设备的系统安全存储。
- GitLab 地址、OpenAI API 地址、模型、自动审查规则和审查记录写入设备的应用数据目录。
- 不会把配置或审查记录上传到 ReviewPilot 服务端。
- 卸载应用或清除应用数据会删除本地数据，请自行保管原始 Token 和 API Key。

## 已实现功能

- 配置多套 GitLab/OpenAI 凭据，手动选择配置和模型发起审查。
- 读取 GitLab Merge Request 基本信息、代码差异和必要的文件上下文。
- 调用可配置地址与模型的 OpenAI Responses API 生成审查报告。
- 把中、高、致命风险发布到对应 GitLab 代码行。
- 没有中高风险时发布完整报告；完全没有问题时才请求 Approve。
- 在设备本地保存、查看和删除审查记录，并把报告生成为 PNG 图片进行转发。
- 轮询指定仓库的新 MR 或新提交并自动审查。

自动审查由客户端进程执行。macOS/Windows 客户端需要保持运行；iOS/Android 应用进入后台或被系统关闭后，不能保证继续轮询。

## 安全说明

- 远程 GitLab 地址必须使用 HTTPS，防止 Token 明文传输。
- 自建 GitLab 使用过期或自签名证书时，可在对应凭据中单独开启“忽略 GitLab 证书错误”。该开关只作用于这套 GitLab 配置，不作用于 OpenAI。
- OpenAI API 地址应使用有效的 HTTPS 证书。自定义地址需要兼容 OpenAI Responses API。
- Android 已关闭应用数据自动云备份，避免敏感数据被系统备份到其他设备。

非敏感数据文件名为 `reviewpilot.json`，位于各系统分配给 ReviewPilot 的 Application Support/应用数据目录中。密钥不会写入这个 JSON 文件：iOS/macOS 使用 Keychain，Android 使用 Keystore 加密存储，Windows 使用 Credential Manager 管理加密密钥。

## 开发环境

安装 Flutter stable，并确保目标平台的官方开发工具可用：

- macOS/iOS：Xcode
- Android：Android Studio 或 Android SDK
- Windows：Visual Studio 的“使用 C++ 的桌面开发”及 C++ ATL 组件

在 `client` 目录执行：

```bash
flutter pub get
flutter analyze
flutter test
flutter run -d macos
```

## macOS 本机快速开始

1. 从 Mac App Store 安装完整 Xcode，首次打开时接受许可证并完成组件安装。
2. 在 Xcode 的 Settings → Accounts 登录 Apple ID。
3. 打开 `macos/Runner.xcworkspace`，进入 Runner Target 的 Signing & Capabilities，启用自动签名并选择 Personal Team。
4. 把 Team ID 写入仅本机使用的 `macos/Runner/Configs/Local.xcconfig`：

```text
DEVELOPMENT_TEAM = 你的 Team ID
```

`Local.xcconfig` 已被 Git 忽略，不会把个人 Team ID 发布到仓库。完成后运行：

```bash
flutter build macos --release
open build/macos/Build/Products/Release/ReviewPilot.app
```

如需安装到“应用程序”目录：

```bash
ditto build/macos/Build/Products/Release/ReviewPilot.app /Applications/ReviewPilot.app
```

Personal Team 签名只适合本机开发运行。发布给其他 Mac 用户时，需要 Apple Developer ID Application 证书、Hardened Runtime 和 Apple 公证，否则 Gatekeeper 可能拒绝直接打开。

## 发布构建

Flutter 原生应用需要在对应操作系统上构建。Windows 版本请在 Windows 构建机执行，iOS/macOS 版本请在 macOS 构建机执行。

### macOS

首次签名配置见上面的“macOS 本机快速开始”。

```bash
flutter build macos --release
```

产物：`build/macos/Build/Products/Release/ReviewPilot.app`

当前工程在 macOS 上已验证可生成同时包含 `arm64` 与 `x86_64` 的通用应用。发布前可使用以下命令复核，并对最终应用签名、公证：

```bash
file build/macos/Build/Products/Release/ReviewPilot.app/Contents/MacOS/ReviewPilot
codesign --verify --deep --strict build/macos/Build/Products/Release/ReviewPilot.app
```

### Windows

```powershell
flutter build windows --release
```

产物位于 `build\windows\<架构>\runner\Release\`。分发时需要打包整个 Release 目录，不能只复制 `ReviewPilot.exe`，因为 Flutter 运行库和数据目录也是程序的一部分。x64 版本适用于常见 Intel/AMD Windows 电脑；Windows ARM64 版本需要 ARM64 构建环境。

### Android

分别生成 ARM 和 x86_64 APK：

```bash
flutter build apk --release --split-per-abi
```

产物位于 `build/app/outputs/flutter-apk/`。发布到应用商店时建议使用：

```bash
flutter build appbundle --release
```

正式发布前需要配置自己的 Android 签名证书；当前工程的 release 配置仅用于本地验证。

### iPhone/iPad

```bash
flutter build ipa --release
```

需要在 Xcode 中配置开发者团队、Bundle ID、签名证书和描述文件。仅验证模拟器构建时可以使用：

```bash
flutter build ios --simulator --no-codesign
```

## 发布前检查

```bash
dart format lib test
flutter analyze
flutter test
```

不要提交 `.dart_tool/`、`build/`、IDE 本机配置、签名证书、Token、API Key 或设备上的 `reviewpilot.json`。
