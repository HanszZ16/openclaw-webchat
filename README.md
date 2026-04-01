# iClaw WebChat

OpenClaw Gateway 的 Web 前端客户端，提供智能对话、管理面板和技能查看功能。支持独立部署和 iframe 嵌入集成。

## 功能概览

### 智能对话

- **流式输出** — 实时显示 AI 回复，支持中断生成
- **Markdown 渲染** — 代码高亮、表格、列表、LaTeX 等完整渲染，代码块支持一键复制
- **Tool 调用展示** — CoPaw 风格可折叠卡片，展示工具名称、参数、执行结果和技能标签（exec/read/web_fetch 等），刷新页面后通过服务端缓存自动恢复
- **思考过程展示** — 支持 `thinking-events` 协议，实时显示模型思考过程（需模型支持，如 Claude Opus/Sonnet）
- **文件上传** — 支持图片、PDF、Word、Excel、代码等文件，自动智能分流处理，上传/解析失败支持重试
- **语音输入** — 集成 FunASR 语音识别（需配置 ASR 服务）
- **会话管理** — 新建会话、清除历史、会话隔离，侧边栏快速切换历史会话
- **模型切换** — 预置常用模型 + 自定义输入
- **消息重试** — 助手回复支持重新生成，发送失败的消息支持重发
- **Token 进度条** — 会话列表显示上下文 token 用量可视化

### 管理面板

通过侧边栏切换，复用已建立的 WebSocket 连接读取 Gateway 数据（只读，无安全隐患）：

- **系统状态** — 在线状态、默认模型、运行时间、Gateway 版本、认证模式、Tick 间隔、Agent/会话数量、健康检查
- **团队状态** — 所有 Agent 列表，显示名称、emoji、心跳配置、会话数量
- **会话与记忆** — 活跃会话列表，包括名称、最后消息预览、模型、token 用量、更新时间
- **任务日志** — Gateway JSONL 日志实时查看，支持级别和子系统标识
- **定时任务** — Cron 任务列表（名称、schedule、启用状态、上次/下次执行）和执行记录

### 已安装技能

- 显示用户安装的技能（过滤内置技能）
- 按启用/停用分组，显示名称、描述、来源、授权状态
- Agent 离线时降级显示提示
- 显示托管目录和工作区路径

### iframe 嵌入

- 通过 URL 参数自动连接，跳过登录页
- 嵌入模式下隐藏侧边栏和管理功能，只显示纯聊天界面
- 每个用户拥有独立的对话历史

---

## 技术栈

| 层级 | 技术 |
|------|------|
| 框架 | React 19 + TypeScript |
| 构建 | Vite 8 |
| 样式 | Tailwind CSS 4 |
| 图标 | lucide-react |
| Markdown | react-markdown + remark-gfm + rehype-highlight |
| 文件解析 | pdfjs-dist, mammoth, xlsx |
| 语音识别 | FunASR WebSocket 客户端 |
| WebSocket | 原生浏览器 API + Node.js ws（服务端代理） |
| 生产服务器 | Node.js HTTP（server.mjs，含 Turn 缓存 API） |

---

## 快速开始

### 开发模式

```bash
npm install
npm run dev
```

访问 `http://localhost:5173`，在登录页输入 Gateway 地址（如 `ws://127.0.0.1:18789`），选择密码或 Token 认证方式。

### 生产构建

```bash
npm run build
node server.mjs         # 默认端口 5200
node server.mjs 8080    # 指定端口
```

---

## 项目结构

```
openclaw-webchat/
├── src/
│   ├── App.tsx                    # 应用入口，侧边栏布局 + embed 模式判断
│   ├── main.tsx                   # React 挂载
│   ├── index.css                  # 全局样式（Tailwind + 侧边栏/管理面板）
│   ├── lib/
│   │   ├── gateway.ts             # WebSocket 客户端（OpenClaw v3 协议 + 管理 API）
│   │   ├── useGateway.ts          # 对话状态管理 Hook（含 Tool/Thinking 持久化）
│   │   ├── useAdminData.ts        # 管理面板数据获取 Hook（15s 轮询）
│   │   ├── embedParams.ts         # iframe URL 参数解析
│   │   ├── fileParser.ts          # 文件解析 & 上传
│   │   ├── funasr-client.ts       # 语音识别 WebSocket 客户端
│   │   ├── useVoiceInput.ts       # 语音输入 Hook
│   │   └── types.ts               # TypeScript 类型定义
│   └── components/
│       ├── Sidebar.tsx            # 左侧导航栏（对话 / 管理面板 / 技能）
│       ├── ChatView.tsx           # 主聊天界面
│       ├── ChatInput.tsx          # 输入框 & 附件上传
│       ├── MessageBubble.tsx      # 消息气泡（含内联 ThinkingBlock）
│       ├── ToolCard.tsx           # Tool 调用展示卡片（CoPaw 风格）
│       ├── ModelSelector.tsx      # 模型选择
│       ├── LoginPage.tsx          # 登录页
│       ├── AdminPanel.tsx         # 管理面板（系统状态/团队/会话/日志/定时任务）
│       └── SkillsPanel.tsx        # 已安装技能展示
├── server.mjs                     # 生产服务器（静态文件 + WS 代理 + 文件上传 + Turn 缓存 API）
├── vite.config.ts                 # Vite 开发配置（含 WS 代理 + Turn 缓存插件）
├── index.html
├── package.json
├── tsconfig.json
└── .gitignore
```

---

## Gateway API

WebChat 通过单一 WebSocket 连接与 OpenClaw Gateway 通信，使用的 RPC 方法：

| 方法 | 用途 | 面板 |
|------|------|------|
| `connect` | 建立连接、认证（密码/Token）、获取 snapshot | 全局 |
| `chat.send` | 发送消息 | 对话 |
| `chat.history` | 加载聊天历史 | 对话 |
| `chat.abort` | 中断生成 | 对话 |
| `sessions.patch` | 切换模型 | 对话 |
| `sessions.delete` | 删除会话 | 对话 |
| `status` | 系统状态摘要 | 管理面板 |
| `health` | 健康检查（Agent 心跳、会话统计） | 管理面板 |
| `agents.list` | Agent 列表 | 管理面板 |
| `sessions.list` | 活跃会话列表 | 管理面板 |
| `logs.tail` | 日志尾部读取 | 管理面板 |
| `cron.status` | 定时任务状态 | 管理面板 |
| `cron.list` | 定时任务列表 | 管理面板 |
| `cron.runs` | 定时任务执行记录 | 管理面板 |
| `skills.status` | 技能状态列表 | 技能 |

---

## iframe 嵌入

```html
<!-- 密码认证 -->
<iframe
  src="http://服务器IP:5200/?user=zhonghua&ws=ws://服务器IP:18789&pwd=your_password"
  width="100%"
  height="600"
  style="border: none;"
></iframe>

<!-- Token 认证 -->
<iframe
  src="http://服务器IP:5200/?user=zhonghua&ws=ws://服务器IP:18789&token=your_device_token"
  width="100%"
  height="600"
  style="border: none;"
></iframe>
```

### URL 参数

| 参数 | 必填 | 说明 |
|------|------|------|
| `user` | 是 | 用户名，作为独立的 session key |
| `ws` | 是 | OpenClaw Gateway WebSocket 地址 |
| `pwd` | 否 | Gateway 密码（与 token 二选一） |
| `token` | 否 | Device Token（与 pwd 二选一） |
| `embed` | 否 | 设为 `1` 显式启用嵌入模式 |

### 嵌入模式行为

- 自动跳过登录页，直接连接 Gateway
- **完全隐藏侧边栏**（无管理面板和技能标签）
- 隐藏"断开连接"和"新建会话"按钮
- 保留消息发送、清除历史功能
- 头部显示用户名

### 动态生成示例

```javascript
const username = getCurrentUser().name;
// 密码认证
const chatUrl = `http://10.0.0.100:5200/?user=${encodeURIComponent(username)}&ws=ws://10.0.0.100:18789&pwd=your_password`;
// 或 Token 认证
const chatUrl = `http://10.0.0.100:5200/?user=${encodeURIComponent(username)}&ws=ws://10.0.0.100:18789&token=your_device_token`;
document.getElementById('chat-frame').src = chatUrl;
```

---

## 文件上传

| 文件类型 | 处理方式 |
|---------|---------|
| 图片 (.jpg/.png 等) | 通过 Gateway 图片附件通道发送（需多模态模型） |
| 小文本/代码文件 (<512KB) | 前端解析，文本内容注入消息 |
| 小 PDF/Word/Excel (<512KB) | 前端解析，文本内容注入消息 |
| 大文件 (>512KB) | 上传到服务器 `uploads/` 目录，告知 Agent 文件路径 |

> 大文件上传模式需要 Agent 的 tools profile 设为 `coding` 或 `full`，Agent 才有权限读取服务器上的文件。

---

## 离线部署

### 1. 构建

```bash
npm install
npm run build
```

### 2. 打包（最小体积）

```bash
mkdir -p deploy/node_modules
cp -r dist server.mjs package.json deploy/
cp -r node_modules/ws deploy/node_modules/
tar -czf openclaw-webchat.tar.gz -C deploy .
```

### 3. 服务器部署

```bash
mkdir -p /opt/openclaw-webchat
cd /opt/openclaw-webchat
tar -xzf /path/to/openclaw-webchat.tar.gz
node server.mjs
```

### 4. Systemd 开机自启

```bash
cat > /etc/systemd/system/openclaw-webchat.service << 'EOF'
[Unit]
Description=iClaw WebChat
After=network.target

[Service]
Type=simple
WorkingDirectory=/opt/openclaw-webchat
ExecStart=/usr/bin/node server.mjs
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now openclaw-webchat
```

### 环境要求

- Node.js 18+
- OpenClaw Gateway 运行中（默认端口 18789）

---

## 部署清单

- [ ] `npm install && npm run build`
- [ ] 打包 `dist/` + `server.mjs` + `package.json` + `node_modules/ws`
- [ ] 传输到服务器
- [ ] 确认 Node.js 18+
- [ ] `node server.mjs`
- [ ] 访问 `http://服务器IP:5200`
- [ ] （可选）配置 systemd 开机自启
- [ ] （可选）在其他项目中 iframe 嵌入

---

## 更新日志

### v2 — Tool/Thinking 持久化 & UI 增强

- **Tool 调用持久化** — 服务端 `/api/turns` 缓存 API，刷新页面后工具调用卡片自动恢复，不再丢失为 raw 文本
- **CoPaw 风格 ToolCard** — 重写工具调用卡片，状态指示灯、输入/输出代码块、技能标签（自动推断 github/git/http/python 等）、可折叠展开
- **ThinkingBlock** — 思考过程展示组件，紫色渐变标题动画，支持 `thinking-events` 协议
- **Skill 推断** — 根据工具名 + 参数自动推断调用了哪个技能（exec+curl→http, exec+gh→github 等）
- **历史消息清理** — 自动过滤 Gateway 历史中的 `toolResult`/`toolCall`/`system` 类型消息，清理用户消息中的 `System:` 日志前缀
- **内容匹配恢复** — 通过文本内容相似度匹配缓存，避免时间戳偏差导致的匹配失败

---

## License

Private
