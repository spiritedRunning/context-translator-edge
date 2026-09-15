# background

无状态 service worker：唯一持有 API key 的 LLM 调用入口，做流式 chat completions、用量回传、右键菜单注册与转发。

## Specs

- BG-001 [DONE] streaming LLM call: the service worker issues a chat completions request with streaming and forwards tokens as they arrive.
- BG-002 [DONE] API key custody: only the service worker reads the API key; it is never exposed to the content script or popup.
- BG-003 [DONE] context-dependent selection menu: the right-click menu is a single item that adapts to the selection state — "Add to context" when a text selection exists, "Add instruction" when none — so exactly one item is ever visible (a single item keeps Chrome from collapsing two extension items into an extension-name submenu). The menu no longer offers a translate action; selection translation is via the trigger key (CT-017). "Add to context" forwards the selection to the content script (→ session.addContext); "Add instruction" signals the content script to show its instruction input panel (POP-002).
- BG-004 [DONE] usage return: the service worker returns token usage from each completion, including DeepSeek cache-hit/miss fields when present.
- BG-005 [DONE] provider-aware thinking: DeepSeek requests carry `thinking: {type:"enabled"|"disabled"}` plus `reasoning_effort` when enabled; Ollama's OpenAI-compatible endpoint carries only `reasoning_effort` (`none` when disabled, and UI `max` maps to Ollama `high`); other compatible providers receive `reasoning_effort` only when enabled. Unsupported Ollama models return a localized actionable error.
- BG-006 [DONE] popup manual translation transport: the popup may open the same `llm-stream` Port and submit a standalone translation message array. The service worker remains stateless and applies the same endpoint, credentials, model, streaming, and thinking settings; the popup owns display state and intentionally ignores page-session usage accounting.

## Responsibilities

- 接收 content/popup 的消息请求（翻译、压缩、菜单动作），自身不持有任何 session 状态。
- 翻译/压缩请求：从 config 读 `baseUrl`/`apiKey`/`model`/`thinking`/`effort`，以 `stream:true` 调 `/chat/completions`，按 DeepSeek/Ollama/通用 OpenAI 兼容端点生成相应的思考参数，解析 SSE `data:` 行，逐 chunk 经消息通道转发给请求方；流结束后回传聚合后的 `usage`。
- 右键菜单：注册**单个**菜单项 `id:'ctx'`（`contexts:['all']`），标题随选区在 "Add to context"（有选区）/ "Add instruction"（无选区）间切换——content 监听 `selectionchange`，去抖(50ms) + 仅在空↔非空状态翻转时把 `{kind:'selectionState', has}` 报给 background，background `chrome.contextMenus.update('ctx',{title})` 更新标题（`chrome.contextMenus` 无 onShown/refresh 事件，故按状态翻转更新标题而非在菜单弹出时切换）。始终只有一项可见、顶层扁平（避免 Chrome 把 2+ 项折叠进扩展名子菜单）。点击动作由 `info.selectionText` 在点击时决定（不依赖标题，故标题短暂滞后不会导致误动作）：有选区 → understand 动作发当前 tab content（→ session.addContext）；无选区 → addInstruction 动作（content 弹内联输入面板，POP-002）。菜单不再含翻译动作，选区翻译由触发键承担（CT-017）。已知小局限：先在某处选区、再到别处右键时，标题可能仍显 "Add to context" 而实际点击处无选区（动作以 `info.selectionText` 为准）。
- 错误：HTTP 非 2xx / 网络失败 / SSE 解析失败时，把错误信息回传给请求方，由 content 原位展示并附重试。

## Messaging

流式场景用长连接 `chrome.runtime.Port` 逐 chunk 推送；一次性请求（如压缩也可走流式）与菜单动作可用普通 `chrome.runtime.sendMessage`。消息类型（请求/响应/chunk/error/usage）定义在 `src/shared/`，供 background、content、popup 共享。
