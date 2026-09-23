# 赛博队长 Siebo Captain

> 「你负责写 Code，队长负责去破冰。」
> EvoTavern 进化酒馆黑客松 · 深圳站 ｜ 赛道：**04 多 Agent 蜂群协作 | SECTION 9**

同一套「代理人协商引擎」的两个垂直产品：
**赛博队长**（黑客松组队）— 本仓库；**赛博月老**（约会，第二垂直）— <https://github.com/jiapunk/surrodate>

> 逐项查核请看 [AUDIT.md](./AUDIT.md)。下方数值由修正版 server（commit `599b0e3`）实测，原文在 `audit/evidence/`。

---

## 1. 做了什么

每个参赛者配一位专属 AI 队长：祂先跟同场其他参赛者的队长**互相盘点**（技能互补？目标一致？48 小时会不会开天窗？），
两边队长**各自评分**：双方都给到 50 分以上的人出现在你的**破冰雷达**上（附可直接照念的破冰卡）；双方都给到 60 分以上的人才进入**队伍提案**的候选。

- 选手访谈（6 题编译档案 + 分享权限）→ 队长互盘（逐字稿 live 转播）
- 破冰雷达（双方 ≥50 入列 / 双方 ≥60 优先）+ 破冰卡与分享图（1080px PNG）
- **队伍提案**：候选的三人组合各自隔离评估，硬约束过滤后选出最多 3 队；**所有真人成员都同意才成立**
- 团队群聊（SSE）；持续联络 1:1 私信（真人之间需对方接受邀请）
- 可选：GitHub 公开资料比对（比对技能与公开 repo 语言；只比对公开资料，不证明账号所有权）

## 2. 为什么做

黑客松最难的不是写 Code，是**开场十分钟没人讲话**。社恐与没时间的人在大型活动里最吃亏。
我们让「先由代理人完成尴尬的部分」——面试、筛选、开场白——人只负责见面。

## 3. 怎么做（技术说明）

**引擎：原子拆分 → 隔离执行 → 程序汇合 → 可稽核决策层**

```
候选对 → 6 个 Part：双方各自「提问 q / 作答 a / 评估报告 r」（q:A a:B q:B a:A r:A r:B）
       每个 Part 隔离执行、独立重试，记录 provider、延迟、调用数与退路
组队   → 每个三人假设 1 个 team_eval Part（≤15 个，并发 3）
汇合层（程序）只读 slot：硬约束过滤 → 排序 → 不重叠贪婪选队
评分决策层：Jev → LLM → 本地规则（逐题 fallback + 断路器）
```

| SECTION 9 要求 | 我们的对应实现 |
|---|---|
| 角色分工 | Part 注册表：每场互盘 6 个 Part（双方各自提问、作答、写评估报告），稳定 ID、固定 slot、各自重试；组队时每个三人假设 1 个 `team_eval` Part |
| 通信协议 | 双方队长以自然语言问答互访（LLM 以 JSON 封装 questions / answers），全程逐字稿可稽核；评分走型别化决策题（Noul / Choice / Score：报告 8 题、组队 7 题），文字由模板合成 |
| 冲突解决 | **双方门槛**：两边队长各自评分，取较低分——≥50 上破冰雷达、≥60 标优先并进入组队候选；组队硬约束（队伍评估 ≥60、角色缺口 / 死锁旗标 <0.6）+ 不重叠贪婪；队伍需所有真人成员同意才成立 |
| 故障恢复 | Part 级重试 1 次；LLM Part 重试后仍失败 → 改用本机脚本产生，本场后续 Part 降级走本机脚本，run 仍完成（断网时每场最坏约 3 分钟才降级）；评分层 Jev → LLM → 规则（逐题 fallback、连续 3 次失败的断路器 + 半开探测）；**「故障演练」开关**现场演示「成员失效 → 自动重试接力」（`SWARM // LIVE PARTS` 面板即时可见） |
| 质量/速度/成本取舍 | **`/compare` 单体 vs 蜂群**：在同一份逐字稿上，比较蜂群的评分 Part（`r:A`）与单体的一次调用。公平可比的是「评分步骤」的耗时与调用数；蜂群全流程墙钟含对谈生成，分栏另列。hybrid 下两边评分 provider 不同（蜂群 Jev、单体 LLM），页面如实标示；每场只有一次单体取样，不作统计结论 |
| 「另一位 Agent 复核」 | 对方队长独立写一份评估（reportB），与我方队长的评估（reportA）取较低分做门槛：任一方低于 60，就不进组队候选 |
| 「去 EvoMap 找别人试过的办法」 | 注册节点并 `fetch` 一个 promoted Capsule（`sha256:299eb589…`）：参考其 bundle 打包格式（自包含 validation、code_snippet 证据栏位）；组队引擎为自研、未使用该基因 |
| 「经验留下来」 | 发布 Gene + Capsule + EvolutionEvent（sha256 内容定址）；发布前先过 Hub validate，没过或 0 队就不发布；指挥台显示 `EVOMAP // LINKED` |

**EvoMap GEP-A2A 落地实况**（opt-in、fail-open）
```
节点 node_74fc6e393a8171eb（alias siebo-captain；心跳每 5 分钟；claimed / Level / credits 需节点凭证才能查询）
v1 bundle_9b91f1df7185954e —— 仅本地记录，无法公开验证
v2 bundle_59acb3cc7a144c00 —— 公开可查：GET https://evomap.ai/a2a/assets/<sha256>（asset id 见 assets/gep/last-publish.json）
   含 code_snippet + 自包含 validation；execution_trace 在已发布版本中为静态值，现已改为由 DB 记录计算（待重新发布）
学习来源：promoted Capsule sha256:299eb589…（GDI 41.3）→ 参考其 bundle 打包格式（自包含 validation、code_snippet 证据栏位），组队引擎为自研、未使用该基因
```

**数据流与隐私**：默认 mock 模式不外送任何数据。接真 LLM / Jev（hybrid）时，访谈原文与档案编译会送到 LLM 供应商；互盘与组队评估只送分享权限投影后的档案与逐字稿；GitHub 只收到用户名；EvoMap 只收到不含用户 id / 姓名的汇总统计。访谈开始前会显示数据去向告知，勾选同意后才开始（目前只在前端把关，服务器不记录同意）。完整表格见 README 的隐私与数据流一节，以及 AUDIT §6。

## 4. 现场可复现的数据

> 以下数值由修正版 server 读取 demo 数据库副本实测（2026-09-23，`audit/evidence/live-api.txt`）；互盘与 `/compare` 的来源记录是 2026-09-22 在 hybrid 模式（真 Jev + 真 LLM）下产生的。Jev / LLM 相关数字需 hybrid 模式与付费 key 才能重现；fresh clone 的 mock 模式只会得到规则层的确定性数字。

- 互盘：`DECISION // JEV ×5`（5 场全部 completed）；决策层与规则层的分歧 Δ 平均 **+11.6**（+6～+14，n = 5；Δ 是与手写规则的分歧，不是决策层的「贡献」）
- 蜂群覆盖：每场 `PARTS 6/6`（0 重试、0 退路）；修正版新跑的场次 `RETAIN 8/8`（mock 模式规则层直通，恒为全数保留；demo 数据里旧版写入的场次没有 RETAIN 量测）（RETAIN = 报告 Part 的 8 个决策 slot 中原封不动进入报告的数量；夹限、规则覆写、逐题退回都算不保留）
- **单体 vs 蜂群（同一份逐字稿）**：评分步骤耗时 蜂群 `r:A` 1,492 ms（Jev，1 次调用）vs 单体 22,904 ms（LLM，1 次调用）；分数 81 vs 76；样本 n = 1 场（两边 provider 不同，不作统计结论；蜂群全流程 46,036 ms 含对谈生成，不与单体比）
- 合作网络：9 节点 / 6 边 / 聚类系数 0.48（标准平均聚类：degree <2 的节点记 0 并计入平均；旧版 0.87 是排除孤立节点的算法，已作废）；社交 vs 能力双信号模拟（16 个假设）：social 聚类 0.55（+2 边）、competence 0.48（+0 边），两种信号选出不同队伍
- Agent Ledger：行为记帐 → 能力分（示例：Demo阿飛 加入 2 队（67、74 分）→ 能力分 62；只加入 1 队 → 53；无记录 = 基准 35）
- 测试：单元 36 passed · E2E 38 passed（Playwright，独立测试 DB）；`npm run typecheck` / `lint`（0 error、0 warning）/ `build` 全部通过；全新 clone 不建 `.env` 依文件跑完整流程同样全绿（`audit/evidence/fresh-clone.txt`）
- 四语系：繁中 / 简中 / EN / 日本語
- 赛博月老的数据见其仓库（本次修正未涵盖）

## 5. 运行方式

```bash
git clone https://github.com/jiapunk/siebo-captain && cd siebo-captain
npm install
npm run setup                    # 没有 .env 时自动从 .env.example 建立（mock 模式、密钥空白）→ 迁移 → 种子
npm run typecheck                # next typegen && tsc --noEmit
npm run lint
npm run build
npm run test:unit                # 单元测试（node:test）
npx playwright install chromium  # 第一次跑 E2E 需要
npm run test:e2e                 # E2E（独立测试 DB，不会动到 demo 数据）
npm run dev                      # http://localhost:3000（示范身份：Demo阿飛）
```

- 现场演示建议用 `npm run demo:serve`（`next build && next start -H 0.0.0.0`，端口读 shell 的 `PORT`，默认 3000）
- `npm run demo:snapshot` / `npm run demo:restore`：演示前存快照、演示后还原；全新 clone 没有快照，`demo:restore` 只会印出提示，回到初始 demo 数据用 `npm run db:seed`
- 用旧版建立的 demo 数据库升级：先 `npm run db:rebaseline`（只改写迁移记录），再 `npm run db:migrate`
- 环境变量见 `.env.example`（LLM / Jev 决策层 / 活动信息 / 账号 / EvoMap opt-in），默认值全部安全（mock、EvoMap 关闭）

## 6. 成员

- **⚠️ 提交前必填：队员姓名 · 分工**
