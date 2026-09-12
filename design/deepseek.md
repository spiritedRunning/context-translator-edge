# deepseek

DeepSeek 作为参考后端的特调知识与兼容性注意。插件对所有 LLM 请求走用户配置的 OpenAI 兼容 chat completions 端点（ARCH-001），不绑定 DeepSeek；DeepSeek 是首要适配目标，本文记录已落实的 DeepSeek 特调 spec、特性参考、以及尚未实施的特调机会。本文不对应 src 下的代码模块，而是横跨 background / session / config / popup 的后端适配知识库。

## Specs

- DS-001 [DONE] cache-prefix-stable request shape: requests are shaped to hit DeepSeek's context cache as a stable prefix unit — the system message leads and is constant within a page, committed turns append in order, the custom prompt leads the first user message's <user-instruction> block (constant per page, CFG-005) with buffered context/instruction within the user message, and history is never auto-truncated. (Deepens ARCH-006 for the DeepSeek KV-cache prefix-unit model.)
- DS-002 [DONE] no reasoning_content roundtrip: multi-round history carries only the assistant's final content, never its reasoning_content, so thinking-mode chains neither enter the prefix nor break cache hits, matching DeepSeek thinking-mode guidance for tool-free turns.
- DS-003 [DONE] current model-name examples: examples and placeholders use deepseek-v4-flash (or deepseek-v4-pro), not deepseek-chat / deepseek-reasoner, which are deprecated 2026/07/24.
- DS-004 [DONE] canonical base-url example: the example base URL is the canonical https://api.deepseek.com (no /v1); URL joining still tolerates a user-supplied /v1.
- DS-005 [DONE] configurable thinking/effort: DeepSeek thinking mode (top-level `thinking` field) and reasoning_effort are user-configurable from the options page; effort offers the full Low/Medium/High/Max range for backend portability though DeepSeek only honors High/Max (low/medium map to high). The `thinking` field is always sent — DeepSeek defaults to enabled when it is omitted, so disabling requires an explicit `{type:"disabled"}`.

## Compatibility stance

特调分两类，边界如下：

- **通用最佳实践**（对任何 OpenAI 兼容后端都成立，DeepSeek 之外也受益）：system 消息前置且页面内稳定、committed 轮次顺序追加、变化内容置于请求末尾、不自动截断历史、多轮不回传 reasoning_content、流式跳过 SSE keep-alive 注释行。
- **DeepSeek 专属**（仅 DeepSeek 端点生效）：`usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 缓存字段、`thinking` 顶层字段、`reasoning_effort`、prefix completion 的 `/beta` 端点。读侧对缺失字段容错——`normalizeUsage` 仅在字段存在时捕获。写侧仅对 DeepSeek 端点发送 `thinking`（enabled/disabled）；Ollama 与其他兼容端点不再收到该 DeepSeek 专用字段。

## Reference

### Models & deprecation

| 模型 | 上下文 | 最大输出 | 并发 | 备注 |
|---|---|---|---|---|
| deepseek-v4-flash | 1M | 384K | 2500 | 推荐；非思考 + 思考双模式（靠 thinking flag 切换） |
| deepseek-v4-pro | 1M | 384K | 500 | 推荐；支持思考 |

`deepseek-chat` / `deepseek-reasoner` 将于 **2026/07/24 23:59（Asia/Shanghai）弃用**，分别对应 v4-flash 的非思考 / 思考模式。

### Pricing (per 1M tokens, CNY)

| 项目 | v4-flash | v4-pro |
|---|---|---|
| 输入·缓存命中 | 0.02 | 0.025 |
| 输入·缓存未命中 | 1 | 3 |
| 输出 | 2 | 6 |

缓存折扣：命中 vs 未命中，flash **1/50**、pro **1/120**——命中部分几乎免费。思考模式无额外费率，但 `reasoning_content` 按输出价计费。

### Rate limits

- 并发按账号粒度（与 API key 无关）：flash 2500、pro 500；超出返回 **429**。
- 文档未公开 RPM/TPM 数值，未提供 `Retry-After` 或退避策略。
- 请求保活：流式等待时返回 SSE keep-alive 注释；**10 分钟未开始推理则服务端关闭连接**。

### Error codes

| HTTP | 含义 |
|---|---|
| 400 | 请求体格式错误 |
| 401 | API key 认证失败 |
| 402 | 账号余额不足 |
| 422 | 请求体参数错误 |
| 429 | 速率/并发达上限 |
| 500 | 服务器内部故障 |
| 503 | 服务器繁忙 |

文档未给出 JSON `error` 结构示例，仅 HTTP 状态 + 中文描述；客户端按状态码 + body text 判断。

### Thinking mode

- 开关：HTTP 请求体顶层 `thinking: { type: "enabled" | "disabled" }`（curl/Node），Python SDK 用 `extra_body`。**不发该字段时服务端默认 enabled**，故关闭须显式 `{type:"disabled"}`。`reasoning_effort` 取 `low`/`medium`/`high`/`max`（DeepSeek 实际仅 high/max 生效，low/medium 映射 high；普通默认 high）。
- 流式：思维链走 `delta.reasoning_content`，最终回答走 `delta.content`，分块返回。
- 思考模式下 `temperature` / `top_p` / `presence_penalty` / `frequency_penalty` 被静默忽略。
- 多轮回传：无 tool calls 时历史可省略 `reasoning_content`；有 tool calls 必须完整回传，否则 400。
- 思维链 token 按输出价计费（见 Pricing），可能显著推高成本。

### Context cache (KV cache)

- 全自动、零配置；每个请求都触发缓存构建。命中需**完整匹配缓存前缀单元**（非任意公共前缀）。
- 前缀 = 从头开始的连续 messages 序列（system + 历史 user/assistant）。中间插入变化内容会破坏前缀连续性。
- 命中通过 `usage.prompt_cache_hit_tokens` / `prompt_cache_miss_tokens` 识别；命中部分按折扣价、降低首 token 延迟（TTFT）。
- 缓存秒级构建，几小时~几天自动过期；首次请求无命中收益；同页多轮翻译随轮次增多命中率上升、TTFT 下降。
- 最佳实践：system 最前、历史顺序稳定、变化内容末尾。

### Multi-round

API 无状态，每次需手动拼完整历史。`messages.append(response.choices[0].message)` 取完整 role+content 对象；assistant 用 `content`（非 `reasoning_content`）；顺序严格 user→assistant。

### Prefix completion (not adopted)

DeepSeek beta 功能：`base_url` 切 `/beta`，末条消息 `role:assistant` + `prefix:true`，模型从该前缀续写，可配 `stop`。能强制输出开头、杜绝前导语。

**有意不采用**：需 `/beta` 端点（与 ARCH-001 通用 OpenAI 兼容定位冲突，OpenAI/其他后端不支持），且末尾追加 assistant 消息会破坏多轮缓存前缀。当前已用 system prompt 软性要求"Output ONLY translated HTML"，足够。

### Token approximation

1 英文字符 ≈ 0.3 token，1 中文字符 ≈ 0.6 token（近似，以模型返回 usage 为准）。

## Tuning opportunities (not implemented)

下方为可选增强，未落实，非 spec：

- **友好错误提示**：`sw.ts` 对 401（key 错误）/ 402（余额不足）给中文友好提示，其余仍走 `HTTP <status>: <body>`。
- **自动重试**：429 / 500 / 503 指数退避重试 1~2 次（文档未要求，属可选）。
- **thinking UI 反馈与计费提示**：thinking 现已可配（默认关闭，开启时设置页弹通知提示翻译可能变慢），但流式解析仍只读 `delta.content`——思维链阶段（`delta.reasoning_content`）braille spinner 会一直转到译文首字，用户可能以为卡住。可选增强：(a) 解析 `delta.reasoning_content` 并在 UI 显示"思考中"（区别于 `Translating`），(b) 实测 `completion_tokens` 是否已含 reasoning 以免漏统/重统。
- **thinking 下 max_tokens 兜底**：思维链 token 计入输出预算，可能耗尽模型默认 max_tokens 导致译文为空。当前不设 max_tokens（保持与非思考模式一致），作为已知注意点；实测遇到译文为空可考虑设较大 max_tokens。
- **usage 展示避免双重计数**（POP-003 实现注意）：OpenAI 兼容惯例下 `prompt_tokens` 是总输入，`prompt_cache_hit_tokens + prompt_cache_miss_tokens` 是其拆分；展示应为"输入 X（其中 Y 命中缓存）"，勿将三者相加。thinking 下 `completion_tokens` 的 reasoning 归属需实测确认。
