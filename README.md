# ReviewPilot

ReviewPilot 是一个面向内部团队的 AI Code Review 管理平台。用户登录后，可以手动提交 GitLab Merge Request，也可以通过 GitLab Webhook 自动审查指定仓库的新 MR 和新提交。
<img width="1893" height="836" alt="image" src="https://github.com/user-attachments/assets/64b344a4-a627-4231-b009-8aac766e7739" />

## v1.0 已实现

- 首次启动创建管理员账号，后续账号由管理员创建，不开放公开注册
- 用户、凭据、自动审查配置和审查记录相互隔离
- 密码使用 `scrypt` 安全哈希，不保存明文密码
- GitLab Token 与 OpenAI API Key 使用 AES-256-GCM 加密后写入 SQLite
- 完整 Token/Key 不会通过列表接口返回浏览器，页面只显示掩码
- 一个用户可以保存多组 GitLab/OpenAI 凭据，并为每次手动审查或不同仓库选择不同配置
- GitLab Webhook 自动触发新建 MR、重新打开 MR 和推送新提交的审查
- 自动任务按“自动化配置 + MR 编号 + 最新提交 SHA”去重
- 可按自动化配置限定目标分支、模型、审查重点和是否同步 GitLab 评论
- GitLab.com 和私有 GitLab 的 MR 地址解析
- 自动兼容 `PRIVATE-TOKEN` 与 `Authorization: Bearer` 两种 GitLab 鉴权方式
- 兼容 Diffs、Changes 与 Compare 三级 Diff 回退
- 私有 GitLab 过期或自签名证书兼容选项
- OpenAI Responses API 结构化中文 Review
- `medium`、`high`、`critical` 问题自动评论到对应的 GitLab Diff 新增代码行
- 低风险报告图片评论到 MR，但不请求 Approve
- 只有没有任何问题时才评论通过报告并请求 Approve
- 审查记录删除、搜索和 PNG 转发图片
- 旧版示例不写入数据库、不参与统计

## 下载后直接运行

发布包提供 macOS 与 Windows 双平台版本，用户不需要安装 Node.js，也不需要执行 npm 命令：

- Apple Silicon（M1/M2/M3/M4 等）：`ReviewPilot-macos-arm64.zip`
- Intel Mac：`ReviewPilot-macos-amd64.zip`
- 普通 Intel/AMD Windows 电脑：`ReviewPilot-windows-amd64.zip`
- Windows ARM 电脑：`ReviewPilot-windows-arm64.zip`

解压对应 ZIP 后，macOS 双击 `ReviewPilot-macos-*`，Windows 双击 `ReviewPilot-windows-*.exe` 即可启动，浏览器会自动打开 <http://localhost:4173>。运行窗口需要保持打开；关闭窗口即可停止 ReviewPilot。

首次启动时创建管理员账号，登录后进入“系统配置”，添加至少一组 GitLab/OpenAI 凭据。独立程序的数据在 macOS 默认保存在 `~/Library/Application Support/ReviewPilot`，在 Windows 默认保存在 `%APPDATA%\ReviewPilot`；重新下载或替换程序不会删除账号和审查记录。

未使用 Apple Developer ID 公证的 GitHub 下载包，首次打开时可能被 macOS Gatekeeper 拦截。此时在 Finder 中右键程序并选择“打开”即可授权；要实现完全无提示的首次双击启动，需要使用 Apple Developer ID 签名并提交 Apple 公证。Windows 发布包当前未进行 Authenticode 签名，首次运行时可能出现 Microsoft Defender SmartScreen 提示。

## 从源码构建独立程序

构建机需要 macOS、Node.js `22.13` 或更新版本以及网络连接。首次构建会下载官方 Node.js arm64 和 x64 运行时，之后使用 `.build-cache/` 中的缓存。

```bash
npm install
npm run build
```

构建结果位于 `dist/`：

- `ReviewPilot-macos-arm64` 与对应 ZIP
- `ReviewPilot-macos-amd64` 与对应 ZIP
- `ReviewPilot-windows-arm64.exe` 与对应 ZIP
- `ReviewPilot-windows-amd64.exe` 与对应 ZIP

请优先发布 ZIP，以保留程序的可执行权限。构建产物已包含服务端、网页和 Node.js 运行时，不包含数据库、Token、API Key、测试文件或源码目录。

日常源码开发仍可双击 `start.command`，或执行 `npm start`；这两种方式使用项目根目录下的 `data/`。

从 v0.7 升级时，原 `data/reviews.json` 中的历史审查记录会在首个管理员创建后迁移到该管理员账号。原文件会保留，不会删除。

## 凭据配置

每组配置包含：

- 配置名称
- GitLab 服务器地址，例如 `https://gitlab.company.com`
- GitLab Token
- 是否忽略 GitLab HTTPS 证书校验
- OpenAI API 地址
- OpenAI API Key
- 默认模型

GitLab Token 与 OpenAI Key 加密后存入数据库。编辑配置时，密钥输入框留空表示保留原值。MR 所在 GitLab 服务器必须与所选凭据配置一致，避免 Token 被发送到错误主机。

OpenAI API 地址可以填写基础地址，例如 `https://api.openai.com/v1`，也可以填写完整的 Responses API 地址。自定义服务需要兼容 OpenAI Responses API 和 Bearer Token 鉴权。

## 自动审查仓库

1. 进入“自动审查”。
2. 填写 GitLab 仓库地址、凭据配置、可选目标分支和审查重点。
3. 保存后立即复制页面显示的 Webhook URL 与 Secret Token。Secret 只在创建或重置后显示一次。
4. 在 GitLab 项目的 `Settings → Webhooks` 中填写：
   - URL：ReviewPilot 页面生成的 Webhook URL
   - Secret token：ReviewPilot 页面生成的 Secret
   - Trigger：勾选 `Merge request events`
5. 保存 GitLab Webhook。

GitLab 服务器必须能访问 ReviewPilot 的 Webhook URL。如果 ReviewPilot 部署在另一台机器上，不要在 GitLab 中填写 `localhost`，应使用 ReviewPilot 部署机的内网域名或 IP，并建议通过反向代理提供 HTTPS。

自动审查响应以下事件：

- 新建 MR
- 重新打开 MR
- MR 推送新提交

标题编辑等没有产生新提交 SHA 的事件不会重复审查。暂停自动化配置后，Webhook 会被安全忽略，但历史记录仍会保留。

## GitLab 同步规则

- 存在 `medium`、`high` 或 `critical`：把问题、依据、影响和修改建议评论到准确的新增代码行，不请求 Approve。
- 只有 `low`：评论完整 SVG 报告图片，不请求 Approve。
- 没有任何问题：评论通过报告图片，然后调用 GitLab Approve API。

行内评论要求 AI 给出的文件和行号能够定位到本次 Diff 的新增代码行。无法定位的问题只保留在网页报告中。评论按提交、文件、行号和问题去重。

自动 Approve 还要求 Token 所属用户具备该 MR 的审批资格，并受 GitLab 项目审批规则限制。评论或 Approve 失败不会中断已经完成的网页报告。

## 评分规则

- 无问题：固定 `100`，结论“建议通过”
- 只有低风险：`90–99`，结论“建议关注”
- 最高为中风险：`70–89`，结论“需要修改”
- 最高为高风险：`40–69`，结论“需要修改”
- 存在致命风险：`0–39`，结论“需要修改”

## 数据与安全

默认数据文件：

- SQLite 数据库：`data/reviewpilot.db`
- 主加密密钥：`data/master.key`
- 旧版历史记录：`data/reviews.json`

必须同时备份数据库和 `master.key`。如果只恢复数据库但丢失主密钥，已保存的 GitLab Token 和 OpenAI Key 将无法解密。

安全设计：

- 数据库主密钥不会写入数据库
- 自动生成的 `master.key` 权限限制为当前系统用户可读
- 也可以通过 `REVIEWPILOT_MASTER_KEY` 提供 32 字节 Base64 或 64 位十六进制主密钥
- 浏览器只保存 HttpOnly、SameSite 登录会话 Cookie，不使用 `localStorage` 保存凭据
- 停用账号会立即删除该账号的所有登录会话
- Webhook 使用每个仓库独立的 Secret Token
- 审查记录不包含 GitLab Token 或 OpenAI API Key

## 局域网或服务器部署

在 `.env` 中设置：

```dotenv
HOST=0.0.0.0
PORT=4173
# REVIEWPILOT_DATA_DIR=/path/to/persistent/reviewpilot-data
# REVIEWPILOT_MASTER_KEY=base64-or-64-character-hex-key
```

正式自动审查需要 ReviewPilot 持续运行，建议部署到内网服务器、NAS 或虚拟机，而不是开发电脑。推荐在前面配置 HTTPS 反向代理，并限制只允许可信内网访问。

如果私有 GitLab 使用过期或自签名证书，优先修复服务器证书。临时无法处理时，可以在对应凭据配置中开启“忽略 GitLab HTTPS 证书校验”，仅用于完全受信任的内网服务器。

部分私有 GitLab 或反向代理会拦截 `PRIVATE-TOKEN`。ReviewPilot 在收到 401/403 后会自动切换 Bearer 鉴权重试，并在失败时显示经过安全截断的服务器原因，不会暴露 Token。

## 当前限制

- 当前只支持 GitLab Merge Request，尚未支持 GitHub Pull Request
- 单次最多读取 100 个变更文件，最多补充 8 个相关文件上下文
- 审查在单进程后台执行；服务重启会把未完成任务标记为中断
- Webhook 需要在每个 GitLab 项目中配置一次
- 自动 Approve 是否成功取决于 GitLab 用户资格、项目规则和 MR 当前状态
