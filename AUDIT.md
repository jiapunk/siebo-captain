# 赛博队长 × 赛博月老 · 第三方查核包

> EvoTavern 进化酒馆黑客松 · 深圳站 ｜ 赛道 **04 多 Agent 蜂群协作 | SECTION 9**
> 本文件让第三方（评委 / 审计）**逐项独立复核**两个产品的全部主张。
> 每条主张都附「如何复现」与「预期输出」；机读证据在 `audit/evidence/`。

---

## 0. 五分钟查核（TL;DR）

| 步骤 | 命令 | 预期 |
|---|---|---|
| 1 | 打开 <https://github.com/jiapunk/siebo-captain> 与 <https://github.com/jiapunk/surrodate> | 公开可访问、代码完整 |
| 2 | `git clone` 任一仓库 → `npm install` → `npm run setup` | 迁移 + 种子成功（SQLite） |
| 3 | `npm run test:e2e` | **赛博队长 15/15 通过**（约 2 分钟） |
| 4 | `npm run dev` → <http://localhost:3000>（或 :3001） | 可进入 Demo（身份：Demo阿飛 / Demo小陽） |
| 5 | 读 `audit/evidence/*` | 静态/测试/Live/EvoMap/物料 证据原文 |

---

## 1. 项目总览

**一套「代理人协商引擎」，两个垂直产品：**

| | 🧊 赛博队长（本仓库） | 🔮 赛博月老 |
|---|---|---|
| 场景 | 黑客松组队破冰 | 约会配对 |
| 一句话 | 你的队长先替你去破冰，聊得来才组队 | 你的月老先替你去相亲，过关才见面 |
| 仓库 | [jiapunk/siebo-captain](https://github.com/jiapunk/siebo-captain) | [jiapunk/surrodate](https://github.com/jiapunk/surrodate) |
| 测试 | 15 项（13 个 spec 文件） | 7 项（5 个 spec 文件） |
| 语言 | 繁中 / 简中 / EN / 日本語 | 繁中（UI） |

**引擎共通要素（两站同一套）**
1. **原子拆分**：每场互评拆成 6 个隔离 Part（提问/作答/评估/报告），独立执行、per-Part 重试
2. **可稽核决策层**：每道评分题走 `Jev → LLM → 本地规则`（逐题 fallback + 断路器），报告附 `决策 // JEV · 规则 X → Y Δ`
3. **记忆闭环**：行为 → Agent Ledger（队长）/ 见面回馈记忆（月老）→ 影响下一次筛选
4. **EvoMap GEP-A2A（opt-in）**：注册节点、学习他人基因、发布自己的 Gene+Capsule、心跳存活

---

## 2. 功能 × 测试对照表

### 2.1 赛博队长（15 项）

| 功能 | 测试文件 | 断言要点 |
|---|---|---|
| 注册/登录/验证/密码重设 | `register-journey.spec.ts` | 全流程可走通、闸门生效 |
| 身份与权限 | `auth.spec.ts` | 未登录重定向、分享权限 |
| 持续联络（1:1 私讯） | `contacts.spec.ts` | 建立连线、讯息往返 |
| 决策层三段链 | `decision.spec.ts`（3 项） | Jev 不可用 → LLM → 规则 fallback、覆盖不足重试、本地模式 |
| 四语系动态内容 | `i18n.spec.ts` / `i18n-content.spec.ts` / `dynamic-i18n.spec.ts` | 切语系后 UI 与内容同步 |
| 行动版 | `mobile.spec.ts` | 手机宽度可用 |
| 组队局主流程 | `hackathon.spec.ts` | 出发 → 逐字稿 → 队伍提案 → 加入 → 群聊 |
| 蜂群 P0/P1 | `swarm.spec.ts` | Parts 覆盖 6/6、保留率、假设评估组队 |
| Agent Ledger + 网络图 | `network.spec.ts` | 记帐 → 能力分、网络指标、双信号模拟 |
| 单体 vs 蜂群 | `compare.spec.ts` | 跑单体 baseline、取舍表、五维对照 |
| EvoMap opt-in | `evomap.spec.ts` | 默认关闭（`EVOMAP_ENABLED=0`）、动作被拒、UI 标示 |

### 2.2 赛博月老（7 项）

| 功能 | 测试文件 | 断言要点 |
|---|---|---|
| 决策层 | `decision.spec.ts`（3 项） | 同队长（同构引擎） |
| 主流程 | `demo.spec.ts` | 访谈 → 出发 → 配对 → 同意 → 聊天 |
| 互动回馈记忆 | `feedback.spec.ts` | 回馈 → 记忆 → 下一轮报告带记忆 |
| 见面后续约闭环 | `second-date.spec.ts` | 正向回馈 → JEV 企划 → 接受 → 聊天室置顶；二轮回馈权重 ×2；负向不生成 |
| 单体 vs 蜂群 | `compare.spec.ts` | 月老版取舍表 |

---

## 3. 实测数据（含复现指令）

| 指标 | 数值 | 复现方式 |
|---|---|---|
| 互评场次 | 5 场全部 `decisionSource=jev` | `GET /api/agent/runs` |
| JEV vs 规则 Δ | +6 / +14 / +12 / +12 / +14（**avg +11.6**） | 同上，`score - ruleScore` |
| 蜂群覆盖 | 每场 `PARTS 6/6 · RETAIN 100%` | 同上，`partRows` / `parts` |
| 合作网络 | 9 节点 · 6 边 · 聚类 0.87 | `GET /api/network` |
| 单体 vs 蜂群（队长） | **81（JEV, 46.0s, 6 calls）vs 76（1 call, 22.9s）** | `GET /api/compare?runId=…` |
| 单体 vs 蜂群（月老） | **72（JEV, Δ规则+22, 55.8s）vs 63（1 call, 9.4s）** | 同上（:3001） |
| 月老记忆 | `已累积 2 笔回馈 · 含 1 次第二次约会 · 对「插画(3)、猫(3)」评价最好` | `GET /api/feedback` |
| 续约闭环 | `secondDate: accepted · source: jev`；二轮回馈已收 | `GET /api/matches/{id}` |

---

## 4. 证据文件索引（机读原文）

### 赛博队长 `audit/evidence/`
| 文件 | 内容 |
|---|---|
| `static-gates.txt` | tsc / lint / build / prisma status / 环境（去敏）/ 密钥扫描 |
| `test-run.txt` | `npx playwright test` 完整输出（15 passed） |
| `live-api.txt` | runs / teams / network / evomap / events 的真实响应节选 |
| `evomap.txt` | `evomap:status` 输出 + 心跳日志 + launchd 状态 |
| `demo-assets-qa.txt` | QR 解码、简报/海报加载、PDF 页数 |

### 赛博月老 `audit/evidence/`
| 文件 | 内容 |
|---|---|
| `static-gates.txt` | tsc / lint / build / prisma status |
| `test-run.txt` | `npx playwright test` 完整输出（7 passed） |
| `live-api.txt` | matches / feedback / 续约闭环 的真实响应节选 |

---

## 5. 外部可验证（EvoMap GEP-A2A）

| 项目 | 值 | 验证方式 |
|---|---|---|
| 节点 | `node_74fc6e393a8171eb`（alias `siebo-captain`） | `POST https://evomap.ai/a2a/hello`（带 Bearer） |
| 账号绑定 | `claimed: true` · Level 2 · reputation 50 | 同上响应 |
| 存活 | `survival_status: alive` · credits 95.87 | 同上 + `GET /a2a/nodes/{id}` |
| 发布 v1 | `bundle_9b91f1df7185954e`（GDI 32.9） | `GET /a2a/assets/{asset_id}` |
| 发布 v2 | `bundle_59acb3cc7a144c00`（GDI 35.0，含 code_snippet + execution_trace） | 同上 |
| 学习（recall） | 抓取 promoted 基因 `sha256:299eb589…`（花 4.13 credits） | `POST /a2a/fetch`（付费）|
| 心跳 | launchd 每 5 分钟 hello（日志 `/tmp/evomap-heartbeat.log`） | `launchctl list \| grep evomap` |

> 说明：资产处于 `candidate / quarantine`（新节点首发布待 Hub 审核），审计链接口 `GET /a2a/assets/{id}` 可直接读取。

---

## 6. 安全与隐私

| 项 | 状态 | 证据 |
|---|---|---|
| `.env` 未入库 | ✅ `git ls-files \| grep -c '\.env$'` = **0**（仅 `.env.example`） | static-gates.txt |
| 真实密钥扫描 | ✅ 追踪文件中 `apikey_2236` 命中 **0** | static-gates.txt |
| 分享权限过滤 | ✅ 关闭字段不传给对方 agent（`publicProfile` 投影，见 `src/lib/profile.ts`） | 代码 + profile 测试 |
| 认证闸门 | ✅ 未登录 API 401 / 页面重定向 | auth.spec.ts |
| 速率限制 | ✅ 登录/注册/重设节流（`src/lib/rateLimit.ts`） | register-journey.spec.ts |
| EvoMap 凭证 | ✅ `node_secret` 仅存本地 `.env`（64-hex），入库前已脱敏 | evomap.txt |

---

## 7. 已知限制与诚实声明

1. **测试会重置 demo 数据库**（两站共用 `prisma/dev.db`）；已提供 `npm run demo:snapshot` / `demo:restore` 一键保全。跑测试后请 restore 再演示。
2. **EvoMap 资产待审核**（candidate/quarantine）；平台对自包含 validation 标记 `validation_status: noop`（同类资产亦有此标记，不影响发布）。
3. **lint 警告**：队长 11 条 / 月老 4 条（全部为 warning，0 error；多为 React hook 建议与未用图标）。
4. **活动时间依赖 `.env`**（`EVENT_STARTS_AT/ENDS_AT`）；变更后需 `npm run db:seed`。
5. **真 Jev / LLM 依赖网络**：断网时决策层自动降级（徽章显示 LLM/MOCK），流程不中断——可当作「可稽核」现场演示。
6. Feishu 活动文档为 JS 渲染页，无法程序化抓取（人工阅读）。

---

## 8. 版本信息

| | 赛博队长 | 赛博月老 |
|---|---|---|
| 当前 commit | `be773f2`（详见 `git log`） | `0aaab99`（详见 `git log`） |
| 数据库迁移 | 10 个（SQLite / Prisma） | 8 个 |
| 运行时 | Node 22 · Next.js 16.3 · TypeScript 5 | 同左 |
| 主要依赖 | prisma, next, react, opencc-js, playwright | 同左（无 opencc） |

---

## 9. 第三方查核步骤（逐条照做）

```bash
# ① 赛博队长
git clone https://github.com/jiapunk/siebo-captain && cd siebo-captain
npm install && npm run setup
npx tsc --noEmit                 # 预期：无输出（0 error）
npm run lint                     # 预期：0 errors（11 warnings）
npm run build                    # 预期：Compiled successfully
npm run test:e2e                 # 预期：15 passed
npm run demo:restore             # 恢复演示数据（若跑过测试）
npm run dev                      # → http://localhost:3000（身份：Demo阿飛）

# ② 赛博月老
git clone https://github.com/jiapunk/surrodate && cd surrodate
npm install && npm run setup
npx tsc --noEmit && npm run build
npm run test:e2e                 # 预期：7 passed
npm run demo:restore
npm run dev                      # → http://localhost:3001（身份：Demo小陽）
```

**查核要点（对应 SECTION 9 要求）**
| 官方要求 | 在哪看 |
|---|---|
| 角色分工 | 指挥台 `SWARM // LIVE PARTS`（6 个 Part 各自标签与 provider） |
| 通信协议 | 展开任一场 RECON 逐字稿（两边 agent 结构化互访） |
| 冲突解决 | 队伍卡「能力模式：互盘 ×0.75 ＋ 帐本 ×0.25」；硬约束过滤（假设评估） |
| 故障恢复 | 勾「故障演练」→ Part 首失败 → 自动重试接力（`R1`） |
| 质量/速度/成本 | `/compare` 取舍表（81 vs 76、46s vs 23s、calls 6 vs 1） |
| 另一位 Agent 复核 | 双方 agent 独立评分，双 ≥70 才配对/组队 |
| 去 EvoMap 找办法 + 留下经验 | §5（fetch 学习 + publish 回网络 + 心跳） |

---

## 10. 成员与联络

- 成员：（待填：姓名 · 分工）
- 演示脚本：`DEMO.md`（三分钟摊位版 / 五分钟舞台版 / 十分钟完整版）
- 提交材料：`SUBMISSION.md`

*本查核包随代码提交（见 `git log`）；证据文件生成时间与对应 commit 见各文件头。*
