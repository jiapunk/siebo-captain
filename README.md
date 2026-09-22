# 🧊 賽博隊長 — 黑客松破冰組隊（siebo-captain）

> 「你負責寫 Code，隊長負責去破冰。」

黑客松最難的不是寫 Code，是**開場十分鐘沒人講話**。每個參賽者配一位專屬隊長（AI 代理）：
祂先跟其他參賽者的隊長互相盤點——技能互補嗎？目標一致嗎？48 小時會不會開天窗？——
通過交叉盤點的人，才會出現在你的**破冰雷達**上，附一張可以直接照著念的**破冰卡**；
通過的組合則直接變成**隊伍提案**，加入就能開工。

## ✨ 功能

- **選手訪談**：6 題編譯出選手檔案（角色／技術棧／參賽目標／可投入時間／合作地雷）+ 分享權限
- **隊長互盤**：技能互補（不同角色加權）、目標一致、投入度匹配、協作節奏；逐字稿 live 轉播
- **選手數據卡**：訪談完成後一鍵匯出 1080px PNG（角色/技術棧/目標/投入度/風格/VIBE/Bio＋GitHub 驗證印章）——快速自我介紹
- **破冰雷達**：最該先聊的對象清單（50 分以上入列、60 分以上標「優先」）；一鍵生成**破冰卡**（共同點／互補點／風險轉譯／開場三句，可複製）
- **破冰卡分享圖**：一鍵匯出 1080px PNG（Web Share API / 下載），適合直接發社群
- **GitHub 技能驗證**：接公開 GitHub API 交叉檢查技能主張（比對主要語言），未驗證的宣稱會在互盤報告被提醒
- **隊伍提案**：以互盤分數＋角色覆蓋率組出 2–3 支候選隊伍；加入即成立、自動收回其他提案
- **團隊群聊**：SSE、輸入中指示；模擬隊友依角色認領工作（「後端 API 我先開」「簡報我來扛」）
- **持續聯絡（Keep in touch）**：活動後仍要維繫的人，一鍵建立 1:1 連線——破冰雷達卡片或隊伍頁都能發起；連線不會隨活動結束消失，附獨立 DIRECT CHANNEL 私訊（模擬對象會回話）
- **完整註冊系統**：
  - Email + 密碼註冊/登入（scrypt 雜湊、DB Session 存 SHA-256 雜湊、HttpOnly cookie）
  - **Email 驗證**：一次性權杖（存雜湊、24h 到期）；dev 模式直接回傳驗證連結（`AUTH_DEV_LINKS`，production 預設關閉，正式版改接 SMTP）
  - **未驗證閘門**：未驗證帳號無法配對／組隊／發起聯絡（403 `email_unverified`），Header 顯示琥珀色驗證橫幅一鍵重寄
  - **忘記密碼 / 重設**：權杖 30 分鐘、重設後自動登出所有裝置；帳號列舉防護（一律回 200）
  - **登入節流**：同 Email+IP 15 分鐘 8 次失敗即鎖（429 + 剩餘秒數）
  - **密碼規則**：8–72 字元、不可與 Email 相同
  - 示範身分切換（cookie）仍保留，與真帳號並存
- **活動（Event）code 加入**：配對範圍鎖定同一場黑客松；demo 內建「TRAE 黑客松 2026 秋」（code: `TRAE26FALL`）

## 🚀 快速開始

```bash
npm run setup     # 安裝依賴 + SQLite migration + 種子（活動 + 9 位參賽者）
npm run dev       # http://localhost:3000
```

打開後：選 Demo阿飛（或到 `/login` 註冊真帳號）→ 我的隊長 → 「隊長出發」→ 看隊長互盤
→ 破冰雷達生成破冰卡、匯出分享圖 → 我的檔案做 GitHub 驗證
→ 回指揮台「產生隊伍提案」→「加入這隊」→ 團隊聊天室。

```bash
npm run demo:reset   # 清空 demo 資料（種子與活動保留）
npm run test:e2e     # Playwright：組隊全流程 + 真帳號 + 四語系切換 + 行動裝置（4 specs）
```

> GitHub 驗證在測試中會以 `GITHUB_VERIFY=mock` 走確定性資料；正式運行則直接打公開 GitHub API（未驗證使用者 60 次/小時限流）。

## 📅 活動場次設定

Demo 種子活動可用 `.env` 直接換成你自己的黑客松：

```env
EVENT_NAME="TRAE 黑客松 2026 秋"
EVENT_CODE=TRAE26FALL
EVENT_STARTS_AT=2026-10-24T09:00:00+08:00
```

改完執行 `npm run db:seed`（會重建活動與種子參賽者；`demo:reset` 只清 demo 資料不動活動）。

## 🐝 蜂群引擎（P0+P1，EvoX 式）

互盤與組隊不是「一個中央 LLM 讀完所有報告再決定」，而是蜂群三原則：

| 原則 | 實作 | 檔案 |
|---|---|---|
| **原子拆分** | 每個互盤 run = 6 個 Part（`q:A / a:B / q:B / a:A / r:A / r:B`），穩定 ID、固定 slot；隊伍組裝 = 假設枚舉（≤15 組）每組一個評估 Part | `src/lib/swarm.ts`、`lib/matching.ts` |
| **隔離執行** | 每個 Part 只餵最小必要 state（兩份 profile + 對應逐字稿），互不污染；Part 級重試（1 次）與失敗記錄 | `runPart()` |
| **程序匯合** | 只從 slot 讀型別化分數：硬約束（角色缺口/死鎖/門檻）→ 排序 → 不重疊貪婪；文字只走模板，LLM 永不改數字 | `lib/teamAssembler.ts` |

**可視化驗證**（指揮台每張 run 卡）：
`PARTS 6/6 · RETRY 0 · RETAIN 100% · JEV`、隊伍頁 `SWARM // HYPOTHESES 15 · SELECTED 3 · ENGINE JEV`

- **RETAIN**：決策值原樣進入最終交付的比例（論文 Sub-Agent 僅 55.5%；我們決策路徑 100%）
- **覆蓋率**：expected vs done，缺漏如實顯示、只重試缺失的 Part
- 實測（真 Jev）：15 組隊伍假設併發 3、平均 ~2 秒/組、0 failed；單次逾時自動交 LLM 接手

## 🐝 蜂群引擎（P0+P1，取自 EvoX 蜂群研究）

> 設計依據：EvoX 實驗一（蜂群 70.7% vs Sub-Agent 38.5%）。三個關鍵——**原子拆分、隔離執行、程序匯合（不讓 LLM 重新理解答案）**。

**P0：Part 執行底座**
- 每個工作單元是 `SwarmPart`：穩定 ID（`q:<runId>:A`、`r:<runId>:B`、`t:<userId>:<a>:<b>`）、固定 slot、`pending→done/failed`
- **Part 級重試**（失敗自動重打一次，不牽連其他 part）＋ **覆蓋檢查**（expected vs done）
- 全程軌跡：provider / model / latency / tokens / confidence / **retained（決策值是否原樣進入交付）**
- 指揮台徽章：`PARTS 6/6 · RETAIN 100% · RETRY 0`

**P1：假設評估式組隊（取代中央啟發式）**
- 程式枚舉候選三人隊 → **每組一個隔離評估 part**（併發 3，Jev 答覆蓋/化學反應/死鎖風險）→ **程序匯合**：硬約束（角色缺口、死鎖風險）過濾 → 分數排序 → 不重疊貪婪取 2–3 隊
- 隊伍卡顯示 `HYPOTHESES n` 與每隊 `覆蓋 n` 證據

## 📒 P2：Agent Ledger（戰績帳本）＋ 合作網絡

**Ledger（append-only，對齊 EvoMap「recall before, record after」）**
- 行為即時記帳：`team_joined`（值=隊伍分）、`connection`、`message_sent`、`icebreaker`
- `summarizeLedger()` 單次 groupBy 取能力分（35 基準 + 成隊/聯絡/訊息/破冰/隊伍品質加權，30–98）
- 帳本寫入失敗絕不阻斷主流程

**能力加權組隊（`ASSEMBLY_SIGNAL`）**
- `competence`（預設）：最終分 = 互盤評估 × 0.75 ＋ 成員帳本均分 × 0.25
- `social`（對照組）：只用互盤評估分
- 隊伍卡直接顯示算式：`能力模式：互盤 81 × 0.75 ＋ 帳本 79 × 0.25 = 80`

**單體 vs 蜂群對照（/compare）**
- 同一場對盤實跑兩種架構：蜂群 6-Part＋決策層（可重試）vs 單體 1 次 LLM 呼叫
- 顯示呼叫數/重試/牆鐘延遲/累計 Part 工時/報告欄位完整度/分數/失敗韌性＋五維對照
- 實測：81（JEV, 46.0s）vs 76（1-call, 22.9s）——質量/速度/成本取捨可量化

**Jev 差別可視化**
- 每份評估報告附 `ENGINE // JEV · RULE 81 → 84 Δ+3`（Jev 與規則層的即時分差；規則分為零成本純函式對照）
- 指揮台頂部聚合列：`DECISION // JEV ×5 · LLM ×0 · LOCAL ×0` ＋ `JEV vs RULE Δ +3.2（n=5）`——一眼看出決策層現況與實際貢獻

**合作網絡圖（`/api/network`）**
- 節點=活動成員（大小=連結度、顏色=活躍度）、邊=已成立隊伍＋持續聯絡
- 指標：**聚類係數、邊數/平均度、樞紐節點**
- **雙信號模擬**：用同一批 `team_eval` 假設重跑匯合（不寫 DB），並列 `社交模式 vs 能力模式` 的聚類與跨群連結數——把 EvoX 實驗二（0.53 → 0.28）搬進產品畫面

## 🧬 P3：EvoMap GEP-A2A 對接（opt-in）

- **註冊**：`npm run evomap:register` → `POST /a2a/hello`（免 key）取得 `node_secret` 與 `claim_url`
- **發佈**：`npm run evomap:release` → 最新組隊成果打包成 **Gene＋Capsule＋EvolutionEvent**，sha256 內容定址（canonical JSON，鍵排序）
- **Hub 預檢**：`POST /a2a/validate` dry-run，Hub 回傳精準修正建議（例：Gene 需要 `strategy` ≥2 步）→ 迭代到 validate OK
- **狀態總覽**：`npm run evomap:status` → 節點（claimed/reputation/credits/生存狀態）＋上次 bundle 審核狀態＋網路相關資產（免費 search）＋開放任務；hello 同時作為心跳
- **搜尋**：`POST /a2a/fetch`（search_only 免費；完整內容抓取會計 credits）
- **Fail-open**：預設 `EVOMAP_ENABLED=0` 完全不連線；失敗永不阻斷組隊流程
- **實測**：validate OK → publish OK，bundle `bundle_9b91f1df7185954e`（newcomer_candidate）
- 指揮台狀態列：`EVOMAP // OFF（opt-in）` / `EVOMAP // LINKED node_…`

## 🧠 決策層（Jev / TypeSafe System One）

互盤評分走**決策層**：Jev 用 Noul / Choice / Score 回傳型別化機率，**不生成文字**；
文字理由與摘要一律由本地化模板合成（可稽核、零幻覺空間）。

```
LLM_PROVIDER=mock   → 全規則（離線、測試固定路徑）
LLM_PROVIDER=real   → 全 LLM（DeepSeek 生成含評分）
LLM_PROVIDER=hybrid → LLM 負責對談/文案 + Jev 負責評分（推薦）
```

- **三段鏈 fallback（Jev → LLM → 規則）**：
  - Jev 缺 key／逾時（6s）／非 200／欄位缺漏或型別不符 → 先退 **LLM 決策**（同一組題目、JSON 模式、不生成報告文字），再退本機規則
  - 為何最後才是規則：它是唯一**不會失敗、零延遲、零成本**的層；LLM 與 Jev 共用網路/額度風險，故放中間
  - **逐題** fallback：部分題目缺漏時只退該題，其餘仍用遠端答案
  - **斷路器**：Jev 60 秒內連續 3 次失敗 → 暫時跳過（避免每次白等 6s 逾時）
  - 開關：`DECISION_FALLBACK=auto|llm|mock`（mock = 不經 LLM）
  - 透明性：報告會標記 `decisionSource`（jev / llm / mock），指揮台顯示 `ENGINE // JEV|LLM|MOCK` 標籤
- 環境變數：`DECISION_PROVIDER=auto|jev|mock`、`JEV_API_KEY`、`JEV_MODEL=jev-latest`、`JEV_TIMEOUT_MS`
- 驗證：`npx tsx scripts/jev-smoke.ts [--bad-key] [--report]`；E2E `tests/decision.spec.ts`（壞 key 必走 fallback）
- 實測：單次決策 9 題並行 ~1.1s / 493 input tokens（≈$0.00002）；hybrid 實跑 5 位候選 Jev 評分 70–93、零 fallback

## 🤖 LLM 設定

預設 **OpenCode Go 訂閱**驅動的 **DeepSeek V4.1 Flash**（`.env`）：

```env
LLM_PROVIDER=real
LLM_BASE_URL=https://opencode.ai/zen/go/v1
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-v4.1-flash
```

- 遵循 OpenCode Go 規範：`User-Agent: siebo-captain/1.0` + `x-opencode-session`（onboarding=userId、互盤=runId、破冰卡=runId、團隊聊天=teamId）
- `LLM_PROVIDER=mock` 可切換內建腳本引擎（零成本、離線、E2E 固定使用）
- 成本：一次完整互盤 = 5 位候選 × 6 次呼叫（真 LLM 約 2-5 分鐘，過程中 live 轉播）

## 🎛️ 設計系統：GITS（Ghost in the Shell 風格 HUD）

刻意避開「AI 產品樣板臉」（紫黑霓虹漸層、發光玻璃、emoji 滿版），走**攻殼機動隊**路線：深墨底、磷光綠、國際橘、掃描線、準星環、直書日文。

| 元素 | 做法 |
|---|---|
| 底色 | `#0b1014` 深墨 + 32px 藍圖網格 + 光學迷彩斜紋 + 暗角 |
| 訊號色 | 磷光綠 `#5be3a7`（狀態/正向）、警戒橘 `#ff5c38`（行動）、琥珀 `#ffb454`（提示）、資訊藍 `#54c7ec` |
| 面板 | 1px 硬框 + **磷光轉角括號** + 刻度尺；**不用 clip-path**（Chromium 捲動容器有渲染 bug，改用角括號） |
| 元件語言 | 準星環頭像（虛線旋轉圈）、LEED 訊號燈、波形動態列（live）、旋轉印章、等寬分段訊號條 |
| 錯字/點綴 | 直書日文（「攻殻機動隊・電脳空間」）、`MONO // 中文` 區塊代碼（TGT-01 / STEP 01 / SQUAD PROPOSAL） |
| 動效 | boot-in 進場（去模糊）、CTA 掃掠光、led 閃爍 |
| 分享卡 | 同款深色終端機風（1080px PNG、橘色信號條、綠色 RADAR READY 印章） |

## 🌐 多語系（i18n）

- **語言**：繁中（預設）· **简体中文** · English · 日本語 — Header 與首頁狀態列一鍵切換，存 cookie（`sc_lang`），重載保留
- **UI 字典**：`src/lib/i18n-dict.ts`（206 鍵 × 4 語系）；`src/lib/i18n.tsx`（Provider + `useT()`）
- **動態內容字典**：`src/lib/content.ts`（46KB，訪談題庫/對談模板/報告理由/破冰卡/團隊訊息/引擎文案 × 4 語系）
- 簡中由 OpenCC（tw→cn）生成 + 大陸慣用詞彙映射（檔案→文件、訊息→消息、資料→数据、登入→登录…）
- 首次造訪依瀏覽器語言自動選擇；`<html lang>` 同步更新

### 動態內容也吃語系（cookie → API → LLM）
```
sc_lang cookie → getServerLocale() → 傳入 llm.*(…, locale)
  ├─ mock：讀 content.ts 對應語系腳本（四語系全覆蓋）
  └─ real：system prompt 附加輸出語言指令（langDirective）→ DeepSeek 直接輸出該語言
```
- 覆蓋範圍：訪談回覆、互盤逐字稿（提問/回答）、互盤報告（理由/紅旗/摘要）、破冰卡（共同點/互補/開場三句）、隊伍組裝報告、團隊聊天回覆、對談轉播系統訊息
- 跨語系角色正規化：`canonical()` 讓中文/英文/日文角色字串都能對上同一組 canonical 角色
- E2E 驗證：`tests/dynamic-i18n.spec.ts`（四語系訪談回覆斷言）、`tests/i18n-content.spec.ts`（EN 模式下的對談與報告）

## 📱 行動裝置自適應

- **底部 Dock**：登入後手機顯示 4 鍵導覽（我的隊長／破冰雷達／隊伍／我的檔案），含 active 指示與 safe-area 留白
- 桌機頂部導覽 / 手機 Dock 雙軌；手機頂欄只留品牌＋語言＋身分
- 全站單欄重排（sm 斷點）、觸控目標 ≥ 44px（`.btn` 強制 min-height）
- E2E 覆蓋：390×844 視窗的 Dock 導覽測試（`tests/mobile.spec.ts`）

## 🏗️ 架構

| 層 | 技術 |
|---|---|
| 前端 | Next.js 16 (App Router) · React 19 · Tailwind v4 |
| 後端 | Route Handlers · SSE（EventEmitter 匯流排） |
| 資料 | SQLite + Prisma（User / Session / AgentProfile / Event / EventMember / MatchRun / Icebreaker / Team / TeamMember / TeamMessage） |
| LLM | mock 腳本引擎 / OpenAI 相容 API（可插拔） |

### 核心管線

```
訪談 → 選手卡（分享權限投影）
   → 隊長互盤（提問→回答→雙方報告；雙門檻 60）
   → 破冰雷達（≥60 的人 + 破冰卡：共同點/互補點/風險/開場三句）
   → N 對 N 聯盟形成（互盤分 + 角色覆蓋 + 目標一致 → 2-3 隊）
   → 加入 → 團隊群聊（模擬隊友依角色認領）
```

### 專案結構

```
src/
  app/
    page.tsx           # Landing + 身分選擇
    onboarding/        # 選手訪談
    profile/           # 選手卡 + 分享權限
    agent/             # 我的隊長（互盤 live + 產生隊伍提案）
    people/            # 破冰雷達（破冰卡）
    teams/ team/[id]/  # 隊伍提案 + 團隊群聊
    login/             # 登入 / 註冊
    api/               # auth/session/users/me/profile(verify)/onboarding/
                       # events/events-join/matching/agent/people/teams/bus
  lib/
    llm/               # mock 引擎 + real provider
    matching.ts        # 互盤引擎（事件分流發布）
    teamAssembler.ts   # N 對 N 聯盟形成
    teamBot.ts         # 模擬隊友（角色認領）
    auth.ts            # scrypt 雜湊 + DB session
    github.ts          # GitHub 技能驗證（真 API / mock）
  components/          # AppHeader / RunStream / ScoreRing / Icons
prisma/                # schema + seed（活動 + 9 參賽者）+ reset-demo
tests/hackathon.spec.ts
```

## 🗺️ 路線圖

- **P0**：部署（Vercel + Postgres；SSE 限制確認）、密碼重設、Rate limit
- **P1**：現場模式（QR 進桌、同桌輪轉破冰題）、團隊章程生成（分工表/milestone）、Discord/Line 通知
- **P2**：主辦方後台（組隊率/互動率）、活動後團隊追蹤、開放 Agent Card API

## ⚠️ 已知限制（MVP）

- GitHub 驗證只看公開語言分佈，設計/簡報等非程式技能無法由此驗證（UI 會標註）
- 沒有密碼重設 / Email 驗證（roadmap）
- 真 LLM 模式一次互盤約 2-5 分鐘（背景執行 + live 轉播）
- 示範身分切換（cookie）與真帳號並存：真帳號優先，登出會清除兩者

---

*本專案由 Surrodate 拆分而來（2026-09-18）；共用引擎與拆分紀錄見原 repo 的 `docs/handoff/`。*
