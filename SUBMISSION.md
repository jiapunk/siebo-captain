# 赛博队长 Siebo Captain

> 「你负责写 Code，队长负责去破冰。」
> EvoTavern 进化酒馆黑客松 · 深圳站 ｜ 赛道：**04 多 Agent 蜂群协作 | SECTION 9**

同一套「代理人协商引擎」的两个垂直产品：
**赛博队长**（黑客松组队）— 本仓库；**赛博月老**（约会，第二垂直）— <https://github.com/jiapunk/surrodate>

---

## 1. 做了什么

每个参赛者配一位专属 AI 队长：祂先跟其他参赛者的队长**互相盘点**（技能互补？目标一致？48 小时会不会开天窗？），
通过交叉盘点的人出现在你的**破冰雷达**上（附可直接照念的破冰卡），通过组合直接变成**队伍提案**。

- 选手访谈（6 题编译档案 + 分享权限）→ 队长互盘（逐字稿 live 转播）
- 破冰雷达（50 分入列 / 60 分优先）+ 破冰卡与分享图（1080px PNG）
- **队伍提案**：互盘分 + 角色覆盖率组出候选队伍，加入即成立
- 团队群聊（SSE）、持续联络 1:1 私讯
- 可选：GitHub 技能验证（公开 API 交叉比对语言主张）

## 2. 为什么做

黑客松最难的不是写 Code，是**开场十分钟没人讲话**。社恐与没时间的人在大型活动里最吃亏。
我们让「先由代理人完成尴尬的部分」——面试、筛选、开场白——人只负责见面。

## 3. 怎么做（技术说明）

**引擎：原子拆分 → 隔离执行 → 程序汇合 → 可稽核决策层**

```
候选对 → 6 个 Part（提问/作答/假設評估/組隊評估/報告/破冰）
       每個 Part 隔離執行、獨立重試、記錄 provider 與延遲
       匯合層（程式）只讀 slot：硬約束過濾 → 排序 → 不重疊貪婪選隊
       評分決策層：Jev → LLM → 本地規則（逐題 fallback + 斷路器）
```

| SECTION 9 要求 | 我们的对应实现 |
|---|---|
| 角色分工 | Part 注册表（questions/answers/team_eval/…），每个 Part 独立职责与重试 |
| 通信协议 | 双方队长**结构化互访问答**（JSON 决策协议），全程逐字稿可稽核 |
| 冲突解决 | 硬约束（角色缺口 / 死局概率）+ 双方独立评分取交集 |
| 故障恢复 | per-Part retry + 决策层降级（Jev 挂→LLM→规则），流程永不中断；**「故障演练」开关**现场演示「成员失效 → 自动重试接力」（`SWARM // LIVE PARTS` 面板即时可见，支持 DB 回填） |
| 质量/速度/成本取舍 | **`/compare` 单双对照页**：同一对话纪录实跑「单体 1 次呼叫」vs「蜂群 6-Part」——现场数据 81(JEV) vs 76、46s vs 23s、10/10 栏位完整度、调用 6 vs 1；另有 `规则分 vs Jev 分` 每场 Δ 可量化 |
| 「另一位 Agent 复核」 | 双方代理**独立评审**，双 ≥70 才配对；組隊採隔離假設評估 |
| 「去 EvoMap 找别人试过的办法」 | 已注册节点并 `fetch` 学习 promoted 基因（花 4.13 credits） |
| 「经验留下来」 | 发布 Gene+Capsule+EvolutionEvent（sha256 内容定址）；指挥台显示 `EVOMAP // LINKED` |

**EvoMap GEP-A2A 落地实况**（opt-in、fail-open）
```
节点 node_74fc6e393a8171eb（claimed · Level 2 · reputation 50 · 心跳每 5 分钟）
v1 bundle_9b91f1df7185954e（GDI 32.9）
v2 bundle_59acb3cc7a144c00（GDI 35.0；含 code_snippet + execution_trace + 自包含 validation）
学习来源：promoted Capsule sha256:299eb589…（GDI 41.3）→ 已吸收进 v2
```

## 4. 现场可复现的数据

- 互盘 5 场：`DECISION // JEV ×5 · JEV vs RULE Δ avg +11.6`、每场 `PARTS 6/6 · RETAIN 100%`
- **单体 vs 蜂群（同一场对话纪录）**：蜂群 81 分（JEV、6/6 Parts、46.0s）vs 单次 LLM 76 分（1 call、22.9s）→ 一致性分数差 5、五维平均差 9.2
- 合作网络：9 节点 / 6 边 / 聚类系数 0.87（社交 vs 能力双信号模拟）
- Agent Ledger：行为记帐 → 能力分（示例 53）
- 测试：队长 15/15 · 月老 7/7（Playwright）；`tsc` 0 error；build ✅
- 四语系：繁中 / 简中 / EN / 日本語

## 5. 运行方式

```bash
npm install
npm run setup          # 迁移 + 种子
npm run dev            # http://localhost:3000（Demo 身份：Demo阿飛）
npm run test:e2e       # 14 项端到端测试
```

环境变量见 `.env.example`（LLM / Jev 决策层 / 活动资讯 / EvoMap opt-in）。

## 6. 成员

- （待填：队员姓名 · 分工）
