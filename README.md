# Context Translator

AI 翻译浏览器扩展，支持 Microsoft Edge、Google Chrome 和 Mozilla Firefox。基于你自己的 OpenAI 兼容 API，支持上下文会话和划词固定搭配（collocation）讲解。

## 功能

- **悬停翻译**：光标悬停 + 触发键（默认 `Alt`），译文嵌入原文下方，保留原始格式；按段落缓存，不重复请求。
- **划词翻译 + 搭配讲解**：选中文字后翻译；若原文中有值得学习的固定搭配，附带「Collocations:」讲解。
- **按页面的上下文会话**：同页多次翻译共享上下文；也可通过右键菜单手动补充背景或指引（Add to context / Add instruction）。
- **流式输出**，支持思考模式（需模型原生支持，见下方配置）。
- **任意 OpenAI 兼容端点**：DeepSeek、OpenAI、本地 Ollama 等。

## 安装

### 方式一：下载 Release

在 [Releases](https://github.com/spiritedRunning/context-translator-edge/releases) 下载对应文件：

- Edge：`context-translator-edge-<version>.zip`，解压后在 `edge://extensions` 开启开发人员模式并加载该文件夹。
- Chrome：`context-translator-chrome-<version>.zip`，解压后在 `chrome://extensions` 开启开发者模式并加载该文件夹。
- Firefox：`context-translator-firefox-<version>.xpi`。GitHub 上的本地构建为未签名包，可在 `about:debugging#/runtime/this-firefox` 临时加载；永久安装或公开分发前需提交 Mozilla AMO 签名。

### 方式二：从源码构建

```bash
git clone https://github.com/spiritedRunning/context-translator-edge.git
cd context-translator-edge
npm install
npm run build
```

`edge://extensions` → 开启「开发人员模式」→「加载解压缩的扩展」→ 选择 `dist/` 目录。

更新：`git pull && npm run build`，再到 `edge://extensions` 点该扩展的「刷新」。

## 配置

工具栏图标 →「设置…」：

| 字段 | 说明 |
|---|---|
| Base URL | OpenAI 兼容端点，默认本地 Ollama：`http://localhost:11434` |
| API Key | 远程服务必填；本地服务（Ollama）可留空 |
| Model | 默认 `qwen2.5:14b` |
| 触发键 | `Alt` / `Shift` / `Ctrl`，默认 `Alt` |
| 思考模式 | 需模型原生支持推理（见下）；开启后延迟增加、消耗额外 token |
| 自定义提示词 / 划词结果提示词 | 分别控制通用翻译与划词面板的输出，可选填 |
| 最大上下文（K） | 模型上下文窗口，用于弹窗用量显示；默认 `32` |

端点 / Key / 模型 / 思考模式即时生效；触发键与各类提示词需刷新已打开页面生效。

工具栏弹窗会显示当前页的上下文用量。使用 Ollama（本机或局域网 `11434` 端点）时，还会显示最近一次翻译的输入 token、生成速度和首个可见字符延迟；Ollama 不显示远程 API 的缓存命中率。使用 DeepSeek 等远程服务时，则显示最近一次及当前页累计的提示词缓存命中率。

### 接入 Ollama

新安装默认使用 Ollama 的 `qwen2.5:14b`。在 macOS 上按以下步骤准备本地模型。

#### 1. 安装 Ollama

1. 确认系统为 macOS 14 Sonoma 或更新版本。
2. 从 [Ollama 官方下载页](https://ollama.com/download/mac) 下载 `.dmg`。
3. 打开安装镜像，将 `Ollama.app` 拖入「应用程序」，然后启动 Ollama。
4. 首次启动时，如果系统询问是否安装 `ollama` 命令行工具，请允许。官方的完整说明见 [Ollama macOS 文档](https://docs.ollama.com/macos)。

打开终端确认安装成功：

```bash
ollama --version
curl http://localhost:11434/api/tags
```

第二条命令能返回 JSON 即表示本地服务已在默认端口 `11434` 运行。若无法连接，请先从「应用程序」重新打开 Ollama。

#### 2. 下载并测试 qwen2.5:14b

下载模型：

```bash
ollama pull qwen2.5:14b
```

该模型下载文件约 9 GB，还需要额外可用内存才能流畅运行。下载完成后确认模型已经安装：

```bash
ollama list
```

可选：在终端进行一次对话测试，输入 `/bye` 退出：

```bash
ollama run qwen2.5:14b
```

模型准备完成后，扩展无需额外填写即可使用。默认配置为：

| 字段 | 值 |
|---|---|
| Base URL | `http://localhost:11434` |
| API Key | 留空 |
| Model | `qwen2.5:14b` |
| 最大上下文（K） | `32` |
| 思考模式 | 关闭 |

扩展会自动把默认 Ollama 地址拼接为 `/v1/chat/completions`，本地 API 不需要 API Key。如改用其他本地模型，只需先执行 `ollama pull <模型名>`，再将 Model 改成相同名称。Qwen 2.5 不支持思考模式；需要思考能力时可换用 Qwen 3、DeepSeek R1、QwQ 等原生支持推理的模型。模型大小和版本参见 [Ollama 的 Qwen 2.5 模型页面](https://ollama.com/library/qwen2.5)。

### DeepSeek 配置示例

先在 DeepSeek 平台创建 API Key，然后在扩展设置中填写：

| 字段 | 示例值 |
|---|---|
| Base URL | `https://api.deepseek.com` |
| API Key | `sk-...` |
| Model | `deepseek-v4-flash`（也可使用 `deepseek-v4-pro`） |
| 最大上下文（K） | `1000` |
| 思考模式 | 按需开启；不开启时响应更快 |

保存后即可使用；Base URL 不需要手动追加 `/chat/completions`。DeepSeek 当前模型、上下文长度和 thinking 参数以其[官方模型说明](https://api-docs.deepseek.com/quick_start/pricing)及[思考模式文档](https://api-docs.deepseek.com/guides/thinking_mode/)为准。

### 接入其他 OpenAI 兼容服务

Base URL 填对应端点即可。服务商未识别的思考相关字段通常会被静默忽略，建议先用一小段文字测试，确认思考模式是否真的生效。

## 开发

- `npm run dev` — 开发模式
- `npm run typecheck` — 类型检查
- `npm run build` — 默认 Edge 生产构建到 `dist/`
- `npm run build:all` — 刷新默认 `dist/`，并分别构建到 `dist/edge`、`dist/chrome`、`dist/firefox`；Firefox 同时生成 `dist/firefox/context-translator-firefox.xpi`
- `npm run package:release` — 构建并生成三浏览器 Release 包及 SHA-256 校验文件到 `dist-zip/`
