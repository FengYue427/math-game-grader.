# Math Game AI Grading Proxy

Cloudflare Worker 代理服务，用于隐藏 Deepseek API Key 并提供课题评分功能。

## 项目结构

```
ai-proxy/
├── src/
│   └── index.ts          # Worker 主逻辑
├── package.json          # 依赖配置
├── tsconfig.json         # TypeScript 配置
├── wrangler.toml         # Cloudflare 部署配置
└── README.md             # 本文件
```

## 快速部署

### 1. 安装依赖

```bash
cd ai-proxy
npm install
```

### 2. 配置 API Key

```bash
# 登录 Cloudflare
npx wrangler login

# 设置 Deepseek API Key（保密）
npx wrangler secret put DEEPSEEK_API_KEY
# 输入你的 Deepseek API Key
```

### 3. 本地测试

```bash
npm run dev
```

Worker 将在 `http://localhost:8787` 运行。

### 4. 部署到生产环境

```bash
npm run deploy
```

部署后你会获得类似 `https://math-game-grader.your-account.workers.dev` 的 URL。

## 更新 Godot 配置

部署完成后，将生成的 URL 更新到 Godot 项目中的 `remote_grader.gd`：

```gdscript
const WORKER_URL := "https://math-game-grader.your-account.workers.dev"
```

## API 接口

### POST /

提交课题进行 AI 评分。

**请求体格式：**

```json
{
  "question_id": "p3-001",
  "question_title": "函数极限与连续性",
  "question_description": "证明：函数 f(x) = sin(x)/x 在 x=0 处连续，并求其极限值。",
  "student_reasoning": "学生输入的推理过程...",
  "student_answer": "1",
  "reference_solution": "参考答案...",
  "rubric": {
    "reasoning_completeness": 25,
    "mathematical_rigor": 25,
    "answer_correctness": 20,
    "clarity": 15,
    "depth": 15
  },
  "pass_threshold": 60
}
```

**响应格式：**

```json
{
  "total_score": 85,
  "passed": true,
  "breakdown": {
    "reasoning_completeness": { "score": 22, "feedback": "步骤完整，逻辑清晰" },
    "mathematical_rigor": { "score": 20, "feedback": "使用了洛必达法则，但缺少泰勒展开方法" },
    "answer_correctness": { "score": 20, "feedback": "答案正确" },
    "clarity": { "score": 13, "feedback": "表达清晰" },
    "depth": { "score": 10, "feedback": "理解深入" }
  },
  "overall_feedback": "整体表现良好，证明过程完整，答案正确。",
  "suggestions": ["可以尝试使用泰勒展开作为替代方法", "可以补充连续性定义的引用"]
}
```

## 安全说明

- API Key 存储在 Cloudflare Secrets 中，不会暴露在代码或客户端
- Worker 支持 CORS，允许 Godot Web 导出版本调用
- 建议在生产环境中添加请求频率限制（Rate Limiting）

## 故障排查

### Worker 返回 500 错误

检查 Cloudflare Dashboard 的 Worker Logs，确认：
1. DEEPSEEK_API_KEY 已正确设置
2. Deepseek API 账户有可用额度

### Godot 无法连接

1. 确认 Worker URL 正确配置在 `remote_grader.gd`
2. 检查 CORS 设置（开发环境下允许 `*`）
3. 使用浏览器开发者工具查看网络请求

## 费用估算

基于 Deepseek API 定价：
- 每道课题评分约消耗 1000-2000 tokens
- 按 200 道课题计算，预计成本：$0.10 - $0.30

Cloudflare Worker 免费额度：
- 每天 100,000 次请求（足够使用）
