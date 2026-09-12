# Context Translator

AI 翻译 Edge 插件，基于你自己的 OpenAI 兼容 API，支持上下文会话和划词固定搭配（collocation）讲解。

## 功能

- **悬停翻译**：光标悬停 + 触发键（默认 `Alt`），译文嵌入原文下方，保留原始格式；按段落缓存，不重复请求。
- **划词翻译 + 搭配讲解**：选中文字后翻译；若原文中有值得学习的固定搭配，附带「Collocations:」讲解。
- **按页面的上下文会话**：同页多次翻译共享上下文；也可通过右键菜单手动补充背景或指引（Add to context / Add instruction）。
- **流式输出**，支持思考模式（需模型原生支持，见下方配置）。
- **任意 OpenAI 兼容端点**：DeepSeek、OpenAI、本地 Ollama 等。

## 安装

### 方式一：下载 Release

1. [Releases](https://github.com/spiritedRunning/context-translator-edge/releases) 下载最新 zip 并解压
2. `edge://extensions` → 开启「开发人员模式」→「加载解压缩的扩展」→ 选择解压出的文件夹

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
| Base URL | OpenAI 兼容端点，默认 `https://api.deepseek.com` |
| API Key | 远程服务必填；本地服务（Ollama）可留空 |
| Model | 默认 `deepseek-v4-flash` |
| 触发键 | `Alt` / `Shift` / `Ctrl`，默认 `Alt` |
| 思考模式 | 需模型原生支持推理（见下）；开启后延迟增加、消耗额外 token |
| 自定义提示词 / 划词结果提示词 | 分别控制通用翻译与划词面板的输出，可选填 |
| 最大上下文（K） | 模型上下文窗口，用于弹窗用量显示 |

端点 / Key / 模型 / 思考模式即时生效；触发键与各类提示词需刷新已打开页面生效。

### 接入 Ollama

1. 本地启动 Ollama（默认监听 `http://localhost:11434`）
2. Base URL 填 `http://localhost:11434`（会自动识别为本地端点并拼上 `/v1/chat/completions`），API Key 留空
3. Model 填 Ollama 里已 `pull` 的模型名，如 `qwen3:8b`
4. 思考模式仅对支持推理的模型生效，如 Qwen 3、DeepSeek R1、QwQ；Qwen 2.5 等基础对话模型不支持，开关不会报错但也没有效果

### 接入其他 OpenAI 兼容服务

Base URL 填对应端点即可。服务商未识别的思考相关字段通常会被静默忽略，建议先用一小段文字测试，确认思考模式是否真的生效。

## 隐私

API Key 仅存于本地浏览器扩展存储，不同步、不上传（除发送给你配置的 LLM 端点外）；翻译内容只发送到你配置的端点。

## 开发

- `npm run dev` — 开发模式
- `npm run typecheck` — 类型检查
- `npm run build` — 生产构建到 `dist/`

## 致谢

- Claude Code
- GLM-5.2
- DeepSeek V4
