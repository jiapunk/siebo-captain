# 赛博队长 × 赛博月老 · 第三方查核包

> EvoTavern 进化酒馆黑客松 · 深圳站 ｜ 赛道 **04 多 Agent 蜂群协作 | SECTION 9**
> 本文件让第三方（评委 / 审计）**逐项独立复核赛博队长（本仓库）的主张**。每条主张都附「如何复现」与「预期输出」，机读证据在 `audit/evidence/`。
> 赛博月老（surrodate）是另一个仓库，本文件只列索引；它的数据不在本次修正范围内，未重新复核。
> **修正版说明**：本版依 2026-09-23 的全面审查修正了代码与文件，只写代码真正做得到的事。数值与测试数已由修正版（commit `072b471`）实测填入；`audit/evidence/` 的静态闸门、测试、Live API 与全新 clone 证据都已用修正版重新生成（2026-09-23 10:56 PDT），`evomap.txt` 与 `demo-assets-qa.txt` 仍是修正前的记录（见 §4）。

---

## 0. 五分钟查核（TL;DR）

| 步骤 | 命令 | 预期 |
|---|---|---|
| 1 | 打开 <https://github.com/jiapunk/siebo-captain> | 公开可访问、代码完整 |
| 2 | `git clone` → `npm install` → `npm run setup` | 没有 `.env` 时自动从 `.env.example` 建立（mock 模式、密钥空白）→ `prisma migrate deploy` → 种子成功（SQLite） |
| 3 | `npm run typecheck && npm run lint && npm run build` | 0 error（`typecheck` = `next typegen && tsc --noEmit`；lint 0 error / 0 warning；build 无 whole-project tracing 警告） |
| 4 | `npm run test:unit` | 60 passed（12 个文件，node:test） |
| 5 | `npx playwright install chromium && npm run test:e2e` | 50 passed（19 个 spec 文件，约 3.5 分钟）；使用独立测试 DB（`prisma/test-3100.db`），全程 mock、不外连，不会动到 demo 数据；跑完工作区保持干净 |
| 6 | `npm run dev` → <http://localhost:3000> | 以示范身份 Demo阿飛 进入 |
| 7 | 读 `audit/evidence/*` | 静态 / 测试 / Live / 全新 clone / EvoMap / 物料证据原文（见 §4 的说明） |

---

## 1. 项目总览

**一套「代理人协商引擎」，两个垂直产品：**

| | 🧊 赛博队长（本仓库） | 🔮 赛博月老 |
|---|---|---|
| 场景 | 黑客松组队破冰 | 约会配对 |
| 一句话 | 你的队长先替你去破冰，双方都认可才组队 | 你的月老先替你去相亲，过关才见面 |
| 仓库 | [jiapunk/siebo-captain](https://github.com/jiapunk/siebo-captain) | [jiapunk/surrodate](https://github.com/jiapunk/surrodate) |
| 测试 | E2E 50 + 单元 60 | 见其仓库（本次未复核） |
| 语言 | 繁中 / 简中 / EN / 日本語 | 繁中（UI） |

**赛博队长的引擎要素**
1. **原子拆分**：每场互盘拆成 6 个隔离 Part（双方各自提问、作答、写评估报告），独立执行、per-Part 重试；组队时每个三人假设 1 个 `team_eval` Part
2. **可稽核决策层**：评分题走 `Jev → LLM → 本地规则`（逐题 fallback + 断路器），报告附 `ENGINE // JEV · RULE X → Y Δ`（Δ 是与规则层的分歧，不是贡献）
3. **双方门槛**：两边队长各自评分，取较低分——≥50 上破冰雷达、≥60 标优先并进入组队候选（单一来源 `src/lib/pairGate.ts`）
4. **记忆闭环**：行为 → Agent Ledger → 能力分 → 影响下一次组队（`ASSEMBLY_SIGNAL=competence`）
5. **EvoMap GEP-A2A（opt-in）**：注册节点、`fetch` 他人资产、发布自己的 Gene + Capsule + EvolutionEvent、心跳存活

---

## 2. 功能 × 测试对照表

### 2.1 赛博队长

> 本表对应修正版（commit `072b471`）的 spec 与单元测试：E2E 50 项、单元 60 项全数通过（`audit/evidence/test-run.txt`）。
> E2E 在 `tests/*.spec.ts` 与 `tests/api/*.spec.ts`（Playwright），单元测试在 `tests/unit/*.test.ts`（node:test）。

| 功能 | 测试文件 | 断言要点 |
|---|---|---|
| 注册 / 验证 / 密码重设 | `register-journey.spec.ts` | 注册 → 未验证时发起配对得 403 `email_unverified` → 验证 → 访谈 → 组队 → 聊天 → 重登 → 密码重设 → 旧密码失效 |
| 真账号、场次与认证闸门 | `auth.spec.ts` | 注册、加入场次（错误 code 得 404）、登出、登录、错误密码提示；未登录时受保护 API 回 401、需要身份的页面导回首页 |
| 认证与账号安全 | `api/auth-security.spec.ts` | 手动塞 `sd_uid` 也冒用不了真账号；`/api/users` 只列示范身份、不含 email；`POST /api/session` 对真账号 403、真 session 优先；登录失败第 9 次 429（换 `X-Forwarded-For` 也绕不过）；注册同 email 第 6 次 429；forgot 对存在与不存在的账号响应同形状且不外泄链接；`PUT /api/profile` 不能写入 github；跨来源 POST 得 403 `bad_origin`；`DELETE /api/me` 后无法再登录、种子角色不可删；编译完成后访谈原文已清空、只留 `consentAt`；删除账号后对方的 `/api/agent/runs` 不再列出那场 run |
| API 守门 | `api/api-guards.spec.ts` | `/compare` 非当事人读不到也不能重跑、当事人每分钟 1 次；多工逐字稿串流的权限与参数检查；执行中重送「队长出发」得 409 `already_running`；没有加入活动的用户「队长出发」得 409 `no_event`、不建立任何 run；真人对真人联络需对方接受、重复邀请不重复建立、未验证账号被挡；组队需两位真人都同意、bot 视为已同意；访谈长度上限与坏 JSON 得 400；访谈第一轮不带 `consent: true` 得 400 `consent_required`，同意后存 `consentAt` 与随机 `sid`（不是 userId） |
| 双方门槛 | `unit/pairGate.test.ts` | 门槛常数 50 / 60；依视角对调 mine / theirs；缺报告为 null；雷达分级看较低分；`bothPass` 双方 ≥60；每位对象只取最新一笔 run |
| 决策层 | `decision.spec.ts` + `unit/decide.test.ts` | E2E（完全离线：`scripts/verify-decision.ts` 在本机 stub server 上用真的 fetch 触发各情境，外部地址一律指向 127.0.0.1:9）：链顺序；fallback 实际穿过三段（Jev 401 → LLM 接手、LLM 坏 JSON → 规则、Jev 连不上 → 规则）；覆盖不足只重打缺漏题；逐题 fallback；断路器连续 3 次后跳过；超时涵盖读 body 且 hybrid 报告带 `decisionSource=jev` 与规则对照分；`jev-smoke` CLI 不连外。单元：答案范围与枚举验证、逐题 fallback 且只重打缺漏题、第 2 次失败时保留第 1 次的部分答案、远端 0 题有效时 source 为 mock、超时涵盖读 body、断路器（连续 3 次才打开、成功归零、半开只放一个探测、并行时只有一个真的送出） |
| 蜂群 P0 / P1 | `swarm.spec.ts` + `unit/retain.test.ts` + `unit/teamAssembler.test.ts` + `unit/append-event.test.ts` + `unit/matching-event.test.ts` + `unit/compare-input.test.ts` | E2E：run 卡显示 `PARTS 6/6`、`RETAIN`、`HYPOTHESES n` 与候选队伍；勾「故障演练」后 Part 首次失败 → `R1` 重试接力，run 仍完整 6/6。单元：RETAIN 量测（直通保留、夹限 / 规则覆写 / 逐题退回不保留）；假设 ID 与顺序无关；硬约束；不重叠贪婪最多 3 队；team_eval 的 RETAIN；重新组队只收回自己上一轮、没有其他真人同意的提案；旧数据反向重复的假设 ID 同一组队友只留最新一笔；旧数据只取最新一轮（与该 owner 最新一笔 team_eval 相差 10 分钟内；一轮 15 组 + 前一轮 6 组旧 ID → 只剩 15，对应 demo 数据 h:seed-里歐 21→15）；没有 EventMember 的用户拿不到候选、startMatching 丢 NO_EVENT、不建 run，有活动时候选只限同一场活动；每场 runPair 的 promise 交给 defer（路由用 after() 追踪），等它们结束后 run 收尾为 completed；单体对齐决策层的 6 个字段、蜂群 `r:A` 是否走决策层的判定；同一个 run 并行追加事件不遗失 |
| 本机退路与失败分支 | `fallback.spec.ts` | real 模式、LLM 端点指向黑洞：首个提问 Part 退回本机脚本、本场后续 Part 降级，run 仍 completed，指挥台标 `LOCAL-FB`；没有退路的 `team_eval` Part 一直失败 → `SwarmPart` 记 failed、错误往上抛 |
| Ledger + 网络图 | `network.spec.ts` + `unit/network.test.ts` + `unit/ledger.test.ts` | E2E：组队与聊天后 `/api/network` 有边、有双信号模拟、能力分上升。单元：标准聚类（三角形 = 1、路径 = 0、孤立 / degree 1 记 0 并计入平均）；双信号模拟选出三人队时聚类 > 0 且两种信号可区分；能力分公式、权重上限、夹在 30–98 |
| 其他引擎规则 | `unit/engine-misc.test.ts` | 候选排序（未互盘真人优先、上限 5）；dealbreakers 默认不外送；`sanitizeProfile` 的型别与长度收敛；mock 团队回复不再丢失语系 |
| GitHub 公开资料比对 | `unit/github.test.ts` + `unit/profile-github.test.ts` | 限流（403 + `X-RateLimit-Remaining=0`、429 + `Retry-After`）→ `rate_limited`；404 → `not_found`；HTML / 非数组 / 超时 → `fetch_failed`；fork 不计入语言、结果缓存 10 分钟；档案里伪造的 `compiled.github` 一律丢弃，只有比对记录能成为「GitHub 验证」理由 |
| 持续联络（对模拟对象） | `contacts.spec.ts` | 破冰卡「保持联络」→ 队伍页清单 → 1:1 私信往返 |
| 四语系 | `i18n.spec.ts` / `i18n-content.spec.ts` / `dynamic-i18n.spec.ts` / `i18n-compare.spec.ts` / `i18n-pages.spec.ts` | 界面四语系切换与重载保留；EN 模式下对谈与报告为英文；访谈回复随语系切换；`/compare` 在简中与 EN 模式下没有繁中残留；`/agent`（含展开的逐字稿与报告）、`/teams`（含网络面板）、`/people` 在简中无繁体字、EN 无中日文、日文无简体字与日文不用的繁体字且有假名（只排除种子档案里用户自填的文字；角色标签必须在地化） |
| 行动版 | `mobile.spec.ts` | 390×844 视窗下 Dock 单列导览、各页无水平卷动 |
| 组队局主流程 | `hackathon.spec.ts` | 出发 → 逐字稿（每场 completed、≥11 个事件，双方队长的问答气泡是实际的问与答）→ 破冰雷达 / 破冰卡 → 分享图 → GitHub 公开资料比对（mock）→ 队伍提案 → 加入 → 群聊 |
| 单体 vs 蜂群 | `compare.spec.ts` | 跑一次单体 baseline，显示取舍表与五维对照 |
| EvoMap opt-in | `evomap.spec.ts` + `evomap-contract.spec.ts` | 默认关闭（`EVOMAP_ENABLED=0`）、`GET /api/evomap` 可查、UI 标示 OFF；POST 只限管理员（匿名、示范身份、不在管理员清单的真账号都得 403）。协定契约（本机 stub，不连 Hub）：0 队时 outcome=failed、没有 `success_streak`；`execution_trace` 原样来自传入的证据；asset_id 用独立实作重算 sha256 核对；hello 不带 Bearer、fetch / validate / publish 带 Bearer；没有 node secret 就不送 Authorization |

**未被自动化测试覆盖的主张**（如实列出）：对真实 Jev / LLM 服务的调用（需要付费 key，只能手动验证；自动化测试只用本机 stub 与黑洞地址验证回退行为）。

### 2.2 赛博月老

见 surrodate 仓库自身的查核包（决策层、主流程、互动回馈记忆、见面后续约、单体 vs 蜂群）。本次修正未涵盖该仓库。

---

## 3. 实测数据（含复现方式）

> 以下数值是修正版 server（commit `072b471`，mock 设定）读取 demo 数据库副本的实测结果（2026-09-23 10:50 PDT，原文见 `audit/evidence/live-api.txt`）。互盘、队伍与 `/compare` 的来源记录是 2026-09-22 在 hybrid 模式（真 Jev + 真 LLM）下由修正前代码写入的记录；修正版负责读取与重新计算（聚类、双信号模拟、假设的最新一轮切分、Δ、compare 分栏都是修正版算法）。
> **可重现性**：Jev / LLM 相关数字需要 `LLM_PROVIDER=hybrid` 与付费的 `JEV_API_KEY`、`LLM_API_KEY`；fresh clone 默认是 mock 模式，只会得到规则层的确定性数字（`decisionSource=mock`）。LLM 输出有随机性，即使有 key 也不会得到完全相同的数字。

| 指标 | 数值 | 复现方式 | 定义 |
|---|---|---|---|
| 互评场次与决策来源 | Demo阿飛 5 场全部 completed，`decisionSource` = `jev` ×5（`jev-1.13.0`）；修正版 mock 模式新跑 4 场 = `mock` ×4 | `GET /api/agent/runs` → `myReport.decisionSource` | 至少一题由 Jev 有效回答才标 `jev`；0 题有效时标 `mock` |
| 决策层 vs 规则层 Δ | +6 / +14 / +12 / +12 / +14，平均 **+11.6**（n = 5） | 同上，`score - ruleScore` | 与手写规则的分歧，不是决策层的「贡献」 |
| 蜂群覆盖 / RETAIN | 每场 `PARTS 6/6`、retries 0、fallbacks 0；修正版新跑的 4 场 `RETAIN 8/8`（mock）。demo 数据里 2026-09-22 的 5 场由修正前代码写入，没有 `retention`，其 `retainedPct=100` 来自旧版旗标，**不算**新定义的量测 | 同上，`parts`（`done`、`retries`、`fallbacks`、`retainedPct`）与 `myReport.retention`（`kept` / `slots`） | RETAIN 只量报告 Part：8 个决策 slot 是否原封不动进入报告（夹限、规则覆写、逐题退回都算不保留）。`retention.kept/slots` 是单份报告；`retainedPct` 是两个报告 Part 中完全保留的比例（只会是 0 / 50 / 100%）；mock 模式规则层直通，恒为全数保留 |
| 合作网络 | 9 节点 / 6 边 / 平均度 1.33 / 聚类系数 **0.48**（手算核对：(1/3 + 4) / 9 = 0.481） | `GET /api/network` → `metrics` | 标准平均聚类（同 networkx `average_clustering`：degree < 2 的节点记 0 并计入平均）。旧证据的 0.87 是排除孤立节点的旧算法，已作废 |
| 双信号模拟 | Demo阿飛 最新一轮只有 **3 个假设**（2026-09-22 07:46 UTC，候选 老吳 / 小綠 / 里歐）；social 与 competence 都只选出 老吳 + 小綠 一队：6 边（+0）、聚类 0.48、跨角色群连结 5 —— 这份数据上两种信号看不出差异。参考：切换到示范身份 里歐（最新一轮 15 个假设），两种信号也选出相同的 3 队（13 边、+7、聚类 0.64） | `GET /api/network` → `sim.social` / `sim.competence`；`GET /api/teams` → `swarm.hypotheses`（同为 3） | 只用当前用户最新一轮（与最新一笔相差 10 分钟内）的 team_eval 假设，旧数据里同一组队友有 `t:o:a:b` / `t:o:b:a` 两笔时只算最新一笔：Demo阿飛 原始 16 笔 → 去重 10 笔 → 最新一轮 3 笔。旧证据的「10 个假设」与「两种信号选出不同队伍」是混了多轮的结果，已作废；每队 = 本人 + 两位队友的三角形 |
| 单体 vs 蜂群（队长） | 评分步骤：蜂群 `r:A`（Jev）1,492 ms / 1 次调用 vs 单体（LLM，沿用蜂群逐字稿）22,904 ms / 1 次调用；分数 81 vs 76（维度平均差 9.2）；蜂群全流程 46,036 ms（对谈 44,070 ms，不与单体比）；n = 1 场；demo 数据是修正前写入的，没有 token 记录（`tokens` 为 null） | `GET /api/compare?runId=…` → `timing.scoringMs`、`callBreakdown.scoringComparable`、`scoringSource`、`reusesSwarmTranscript` | 单体沿用蜂群已生成的逐字稿，只重做评分；公平可比的是评分步骤；以 A 方视角；每场只有 1 次单体取样。demo 那份单体 baseline 建于修正前：Jev 只看 6 个档案字段＋逐字稿前 6000 字，单体 LLM 看完整公开档案（`solo.extra.input = "public-profile"`），两边的评分者与输入都不同；修正版重跑时单体只收到同样的 6 个字段与长度（输入对齐），评分者仍不同。81 vs 76 的分差不能解读为蜂群的质量优势 |
| 单体 vs 蜂群（月老） | 见 surrodate 仓库 | — | 本次未复核 |

---

## 4. 证据文件索引（机读原文）

> `static-gates.txt`、`test-run.txt`、`live-api.txt`、`fresh-clone.txt` 已用修正版（commit `072b471`，2026-09-23 10:56 PDT）重新生成，都是完整原始输出（未节选）；路径已去识别（`<repo>`、`<scratchpad>`）。
> 仍是修正前的记录：`evomap.txt`（commit `be773f2`；心跳日志来自旧版 launchd 设定，log 在 `/tmp`）与 `demo-assets-qa.txt`（物料在仓库外）。
> 旧版证据的已知缺口（节选的测试输出、截断的 build、只扫一把 key 的密钥扫描、旧算法的聚类 0.87）已由新文件取代。

### 赛博队长 `audit/evidence/`
| 文件 | 内容 |
|---|---|
| `static-gates.txt` | typecheck / lint（含 JSON 统计）/ build 完整输出（含路由表）/ prisma migrate status / 环境（去敏）/ 密钥扫描（`npm run secret-scan`：`.env` 与 `.env.live` 全部机密值 × 工作树与全部 git 历史） |
| `test-run.txt` | 单元测试 + Playwright 完整输出，以及跑完后 `prisma/dev.db` 的 mtime / sha1 / 笔数比对 |
| `live-api.txt` | 修正版 server 的 me / runs / network / teams / events / compare 实测（含 compare 原文）与 mock 新跑的互盘 |
| `fresh-clone.txt` | 全新 clone、不建 `.env`，依文件跑 install → setup → typecheck → lint → build → test:unit → test:e2e 的逐步 exit、耗时与完整输出 |
| `evomap.txt` | `evomap:status` 输出 + 心跳日志 + launchd 状态 |
| `demo-assets-qa.txt` | QR 解码、简报 / 海报加载、PDF 页数（物料在仓库外） |

### 赛博月老
见 surrodate 仓库的 `audit/evidence/`。

---

## 5. 外部可验证（EvoMap GEP-A2A）

| 项目 | 值 | 验证方式 |
|---|---|---|
| 节点 | `node_74fc6e393a8171eb`（alias `siebo-captain`） | `GET https://evomap.ai/a2a/nodes/node_74fc6e393a8171eb`（公开，无需凭证）：可看到 `reputation_score`、`survival_status`、`quarantine_strikes`、`total_published` |
| claimed / Level / credits | 仅能用节点凭证取得 | 需要 `POST /a2a/hello`（带 Bearer `node_secret`），第三方无法独立验证；旁证为 `audit/evidence/evomap.txt`（去敏的 `evomap:status` 输出） |
| 发布 v1 | `bundle_9b91f1df7185954e` | **仅本地记录，无法公开验证**：仓库与 git 历史中没有它的 asset id；公开节点的 `total_published: 2` 只能证明发布过两次 |
| 发布 v2 | `bundle_59acb3cc7a144c00`（2026-09-22T04:17:48Z，decision `quarantine` / `newcomer_candidate`） | asset id 见 `assets/gep/last-publish.json`，用 `GET https://evomap.ai/a2a/assets/<asset id>` 公开查询（bundle id 不能拿来查，会 404）：<br>Gene `sha256:7cc26ef0100285bdf18b3e398e231b5483da775106467be232dacf1e962270f8`<br>Capsule `sha256:7722f2b55faf677a7409852f0b089fb9324682f8f50166b85c34115f4ef49ebf`<br>`sha256:2d404bd585eb62fb4e6eac07b0c6e011cde4650301053693ad99646365235ce5`（依 bundle 顺序推定为 EvolutionEvent，仓库证据里没有 Hub 标示的类型） |
| v2 内容说明 | 已发布版本的 `execution_trace` 与 `success_streak` 为旧产生器的常数 | 修正后的产生器改由 DB 记录计算 `execution_trace`（互盘 Part、team_eval Part、实际写入的队伍），`success_streak` 因算不出真实连胜而省略；**尚未重新发布**，重新发布后 Gene id 会改变 |
| 学习（recall） | 抓取 promoted Capsule `sha256:299eb589…`，本地存档 `assets/gep/learned/sha256_299eb589.json` | 用途：只参考其 bundle 打包格式（自包含 validation 指令、`code_snippet` 证据栏位）；组队引擎为自研，运行时不读取该档，也未使用该基因。GEP payload 没有引用来源的栏位，所以没有结构化引用。fetch 花费（团队记录 4.13 credits）需节点凭证核对 |
| 心跳 | 每 5 分钟 `hello` | 用 `scripts/evomap-heartbeat-install.sh` 安装后，log 在 `~/Library/Logs/siebo-evomap-heartbeat.log`（超过 1MB 自动截断），到 `EVOMAP_HEARTBEAT_UNTIL`（未设时用 `EVENT_ENDS_AT`）自动停止；`launchctl list \| grep evomap` 只能在作者本机查看；偶发失败会以 exit 1 保留在 launchctl 状态 |

> 说明：资产处于 `candidate / quarantine`（新节点首次发布，待 Hub 审核）。发布流程：`npm run evomap:release` 先跑 Hub validate，没过或 0 队就不发布；`--dry-run` 只印出 bundle 不连线。发布内容不含任何用户 id 或姓名。

---

## 6. 安全与隐私

| 项 | 实际行为 | 证据 |
|---|---|---|
| `.env` 未入库 | `git ls-files` 只有 `.env.example`；`.env.example` 全是安全默认值（mock、EvoMap 关闭、密钥空白） | `git ls-files \| grep '\.env'` |
| 密钥扫描 | `npm run secret-scan`：`.env` 与 `.env.live` 的全部机密值（LLM / Jev / EvoMap，共 3 把）对工作树 214 个文件与全部 git 历史（闸门执行时 20 个 commit、797 个物件，含二进位 blob）比对：命中 0；追踪的 `.env*` 只有 `.env.example`；只印变量名与命中数，不印值 | `static-gates.txt` |
| 示范身份切换 | 只能切到**没有 email、没有密码**的示范身份；`sd_uid` 必须对应示范身份才生效；登录真账号时真 session 永远优先；`DEMO_SWITCH=off` 可整个关闭 | `api/auth-security.spec.ts` |
| 认证闸门 | 受保护 API 未登录回 401；需要身份的页面由前端导回首页 | `auth.spec.ts`、`api/auth-security.spec.ts`、`api/api-guards.spec.ts` |
| 未验证闸门 | 有 email 但未验证：不能发起配对、组队（产生 / 加入）、联络（发起 / 接受 / 私信）、群聊、破冰卡、`/compare` 重跑（403 `email_unverified`） | `register-journey.spec.ts`、`api/api-guards.spec.ts` |
| 速率限制 | 登录每 email 8 次 / 15 分钟；注册每 email 5 次 / 15 分钟 + 每来源 30 次 / 10 分钟；忘记密码每 email 3 次 / 15 分钟 + 每来源 20 次 / 15 分钟；重寄验证每人 5 次 / 15 分钟；GitHub 比对每人 5 次 / 10 分钟；所有 LLM / Jev 端点另有额度（`src/lib/costGuard.ts` 的 `LIMITS`）。**均为单一进程的内存状态** | `api/auth-security.spec.ts`（登录、注册 429）、`api/api-guards.spec.ts`（compare 重跑、访谈上限） |
| 密码重设链接 | 仅 `AUTH_DEV_RESET_LINKS=on` 且非 production 才回传；没有 SMTP | `api/auth-security.spec.ts`（forgot 不外泄链接） |
| Cookie | `HttpOnly; SameSite=Lax; Path=/`；production 且 HTTPS 才加 `Secure` | `src/lib/auth.ts` 的 `authCookieOptions` |
| 跨站请求 | `src/proxy.ts`：非 GET / HEAD 且 Origin 与 Host 不符 → 403 `bad_origin` | `api/auth-security.spec.ts` |
| 分享权限 | 关闭的字段在互盘、组队、网络图、对方的破冰卡都以 `publicProfile` 投影后才使用；合作地雷默认不外送 | `unit/engine-misc.test.ts`；`src/lib/profile.ts` |
| GitHub 比对 | 只比对公开资料，**不证明账号所有权**（`ownershipVerified:false`）；排除 fork；缓存 10 分钟；`PUT /api/profile` 不能伪造比对结果 | `api/auth-security.spec.ts`（不能写入 github） |
| 删除账号 | `DELETE /api/me` 删除账号与个人资料、清掉 cookie；种子角色不可删；档案编译完成即清空访谈原文（只留 `consentAt`）；保存期限：活动结束 30 天后清除非种子账号（目前由营运者手动执行） | `api/auth-security.spec.ts` |
| EvoMap 管理动作 | `POST /api/evomap` 仅限 `EVOMAP_ADMIN_USER_IDS` 中以密码登录的真账号，其他一律 403；每人每分钟 6 次 | `evomap.spec.ts` |
| EvoMap 凭证 | `node_secret` 只存在本地 `.env`，不入库；证据已去敏 | `evomap.txt` |
| 依赖漏洞 | `npm audit` 报 3 个 high（prisma CLI → @prisma/config → deepmerge-ts），只在 CLI，不在运行时 bundle；不要执行 `npm audit fix --force`（会降级 prisma） | `npm audit` |

**第三方数据流**（只有 `LLM_PROVIDER=real|hybrid` 且填了密钥时才会外送；默认 mock 模式下互盘、组队评估、`/compare` 单体都用本机规则）

| 第三方 | 何时送出 | 送出内容 |
|---|---|---|
| LLM 供应商（`LLM_BASE_URL`，默认 OpenCode Go / DeepSeek） | real / hybrid 且有 `LLM_API_KEY` | 访谈回答全文（包括用户在访谈中提到的合作地雷）与档案编译；互盘提问 / 作答 / 报告（双方只送投影后的档案 + 逐字稿）；破冰卡（本人完整档案 + 对方投影后的档案）；有模拟队友的群聊与私信最近 20 则；决策层退到 LLM 时的决策题状态。请求头带 `x-opencode-session`（访谈与档案编译＝每份档案的随机 id；互盘＝runId、团队聊天＝teamId、私信＝connectionId） |
| Jev（`JEV_BASE_URL`，TypeSafe） | 非 mock 模式、有 `JEV_API_KEY`，且 `DECISION_PROVIDER` 不是 mock | 互盘评分：双方投影后的档案摘要 + 逐字稿；队伍评估：三位成员投影后的档案摘要 |
| GitHub API | 用户按下 GitHub 比对，且 `GITHUB_VERIFY` 不是 mock | 用户输入的 GitHub 用户名 |
| EvoMap | `EVOMAP_ENABLED=1`，由 CLI 或管理员账号触发 | 组队汇总统计（队伍数、平均分、provider、Part 完成数），不含用户 id 或姓名；心跳只送节点凭证 |

---

## 7. 已知限制与诚实声明

1. **单机架构**：SQLite；SSE 的 bus 是进程内 EventEmitter；节流、锁、断路器都是进程内内存。多实例或 serverless 部署时各实例各算各的，群聊 / 私信的即时事件不互通（run 串流另有每 3 秒的 DB 轮询补送）。互盘在响应后执行，已用 `after()` 追踪（`/api/matching/run`，`maxDuration` 300 秒；自架 graceful shutdown 与平台 waitUntil 都会等）；超过平台时限仍会被中止（超过 10 分钟仍在 running 的 run 收尾为 failed），serverless 要稳定执行仍需工作队列
2. **节流在内存**：重启即归零；没设 `TRUST_PROXY=1` 时所有直连用户共用「每来源」额度
3. **GitHub 比对不证明账号所有权**：只看公开 repo 的语言分布；设计 / 简报等非程序技能无法由此验证
4. **现场数据需要付费 key**：Jev 评分、`/compare` 延迟、token 用量只能在 hybrid 模式加付费 key 下重现；LLM 有随机性
5. **`/compare` 不是统计实验**：每场只有一次单体取样，单体沿用蜂群已生成的逐字稿；hybrid 下两边评分 provider 不同；hybrid 下 Jev 只看双方各 6 个档案字段加逐字稿前 6000 字，修正版的单体 LLM 在蜂群走决策层时也只收到同样的字段与长度（demo 数据库里唯一那份单体 baseline 建于修正前，看的是完整公开档案）；评分者与量尺不同，分差不能解读为蜂群的质量优势
6. **流程不中断的范围**：LLM Part 重试后仍失败会改用本机脚本并让本场后续 Part 降级，但断网时每场最坏要等约 3 分钟才降级；数据库写入失败或进程重启仍会中断（超过 10 分钟仍在 running 的 run 会被收尾为 failed）。现场网络不稳时，最稳的做法是 `.env` 改 `LLM_PROVIDER=mock` 后重启
7. **没有 SMTP**：Email 验证靠 `AUTH_DEV_LINKS=on` 把链接放在响应里；密码重设链接默认不回传，正式环境目前无法自助重设密码
8. **注册仍会回 409 `email_taken`**：可借此得知 email 是否已注册（已节流）
9. **未验证 email 的用户仍可能被别人的队长选为互盘候选**（闸门只挡他自己发起的动作）
10. **保存期限靠人工执行**：访谈前告知卡写明「访谈原文编译完成即删除；活动结束 30 天后清除所有参赛者账号与相关数据」。前者由 `/api/onboarding/compile` 执行；后者目前没有自动排程或清除脚本，要由营运者手动执行，此修正前已编译的档案也需一次性清空访谈原文。服务器会检查同意：新访谈第一轮必须带 `consent: true`（否则 400 `consent_required`），同意时间存进 interview JSON；同意机制上线前已开始的访谈不再要求同意
11. **EvoMap**：资产待审核（candidate / quarantine），平台对自包含 validation 标记 `validation_status: noop`；v1 无法公开验证；v2 的 `execution_trace` 与 `success_streak` 是旧产生器的常数，修正后的产生器尚未重新发布
12. **lint**：`react-hooks/set-state-in-effect` 已恢复为 error，全仓 0 error / 0 warning（旧版曾降为 warn 并有 11 个 warning）
13. **活动时间依赖 `.env`**（`EVENT_STARTS_AT` / `EVENT_ENDS_AT`）；变更后需 `npm run db:seed`（格式错误会在动数据前中止）
14. **`shots/` 是静态展示截图**：拍摄于不同时间点，多数早于修正版，细节可能与现况不同（例如部分画面显示当时的 `MODE`、数值与文案）。拆分前约会版的 7 张画面已移除，`23-en-landing.png`、`25-cn-landing.png` 已用修正版（EvoTavern、mock 模式）重拍；git 历史中的旧版截图仍在。测试截图写到 `test-results/`，不再覆写 `shots/`

---

## 8. 版本信息

| | 赛博队长 |
|---|---|
| 证据生成时 commit | 修正版 `072b471`（分支 `review-fixes`；之后的提交只更新文件与证据）；`evomap.txt`、`demo-assets-qa.txt` 仍为 `be773f2` |
| 数据库迁移 | 1 个 baseline（`20260923000000_baseline`，SQLite / Prisma；旧版 10 个迁移已合并） |
| 运行时 | Node ≥ 20.9（`package.json` engines）· Next.js 16.3.5 · React 19 · Prisma 6 · TypeScript 5 |
| 主要依赖 | next、react、@prisma/client、openai；开发：prisma、@playwright/test、tsx、dotenv、eslint |

赛博月老的版本信息见其仓库。

---

## 9. 第三方查核步骤（逐条照做）

```bash
git clone https://github.com/jiapunk/siebo-captain && cd siebo-captain
npm install
npm run setup                    # 没有 .env 时自动从 .env.example 建立 → prisma migrate deploy → 种子
npm run typecheck                # next typegen && tsc --noEmit；预期 0 error
npm run lint                     # 预期 0 errors、0 warnings
npm run build                    # 预期 build 成功
npm run test:unit                # 预期 60 passed
npx playwright install chromium  # 第一次跑 E2E 需要
npm run test:e2e                 # 预期 50 passed；独立测试 DB，不会动到 prisma/dev.db
npm run dev                      # → http://localhost:3000（示范身份：Demo阿飛）
```

- **`npm run demo:restore`**：还原 `npm run demo:snapshot` 存下的快照，并自动对齐迁移记录。全新 clone 没有快照，执行只会印出提示并正常结束；要回到初始 demo 数据请用 `npm run db:seed`
- **现场演示**建议用 `npm run demo:serve`（`next build && next start -H 0.0.0.0 -p ${PORT:-3000}`，production 模式、局域网可连）
- **从旧版升级既有的 demo 数据库**：先 `npm run db:rebaseline`（先比对 schema、备份为 `.pre-rebaseline.bak`，只改写 `_prisma_migrations`；可加 `-- --dry-run`），再 `npm run db:migrate`
- 赛博月老的查核步骤见其仓库

**查核要点（对应 SECTION 9 要求）**
| 官方要求 | 在哪看 |
|---|---|
| 角色分工 | 指挥台 `SWARM // LIVE PARTS`（6 个 Part 各自的标签、provider、重试）；`src/lib/swarm.ts` |
| 通信协议 | 展开任一场逐字稿（双方队长的自然语言问答）；评分为型别化决策题（`src/lib/llm/mock.ts` 的报告 8 题、`src/lib/teamAssembler.ts` 的组队 7 题） |
| 冲突解决 | 双方门槛（`src/lib/pairGate.ts`：较低分 ≥50 上雷达、≥60 进组队候选）；队伍卡「能力模式：互盘 ×0.75 ＋ 账本 ×0.25」；硬约束过滤（假设评估）；队伍需所有真人同意 |
| 故障恢复 | 勾「故障演练」→ Part 首次失败 → 自动重试接力（`RETRY 1`）；LLM Part 重试后仍失败 → 本机脚本退路（`SwarmPart.note` 记 `fallback=local`） |
| 质量 / 速度 / 成本 | `/compare`：评分步骤（蜂群 `r:A` vs 单体一次调用）的耗时与调用数；实测 1,492 ms（Jev）vs 22,904 ms（LLM），各 1 次调用，n = 1（§3） |
| 另一位 Agent 复核 | 对方队长独立写 reportB，与 reportA 取较低分做门槛；任一方 <60 不进组队候选 |
| 去 EvoMap 找办法 + 留下经验 | §5（fetch 学习 + publish 回网络 + 心跳） |

---

## 10. 成员与联络

- 成员：**⚠️ 提交前必填：队员姓名 · 分工**
- 演示脚本：团队内部文件，不在本仓库；基本动线见 README「快速开始」
- 提交材料：`SUBMISSION.md`

*本查核包随代码提交（见 `git log`）；证据文件生成时间与对应 commit 见各文件头。*
