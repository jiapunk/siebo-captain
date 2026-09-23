# 🧊 賽博隊長 — 黑客松破冰組隊（siebo-captain）

> 「你負責寫 Code，隊長負責去破冰。」

黑客松最難的不是寫 Code，是**開場十分鐘沒人講話**。每個參賽者配一位專屬隊長（AI 代理）：
祂先跟同場其他參賽者的隊長互相盤點——技能互補嗎？目標一致嗎？48 小時會不會開天窗？——
兩邊隊長**各自評分**：雙方都給到 50 分以上的人，才會出現在你的**破冰雷達**上，附一張可以直接照著念的**破冰卡**；
雙方都給到 60 分以上的人，才會進入**隊伍提案**的候選，而且所有真人成員都按下同意，隊伍才成立。

> 評審／第三方查核請看 [AUDIT.md](./AUDIT.md)（逐項可複核的主張與證據），提交材料見 [SUBMISSION.md](./SUBMISSION.md)。

## ✨ 功能

- **選手訪談**：6 題訪談編譯出選手檔案（角色／技術棧／參賽目標／可投入時間／合作地雷）＋分享權限（每個欄位可設不公開；合作地雷預設不公開）
- **隊長互盤**：雙方隊長輪流提問、作答，再各自寫一份評估報告（技能互補、目標一致、投入度、協作節奏）；逐字稿 live 轉播
- **雙方門檻**（單一來源 `src/lib/pairGate.ts`）：一次互盤產生兩份報告——我的隊長評對方（reportA）、對方隊長評我（reportB），以兩者中**較低的分數**判斷：
  - 雙方都 ≥ 50 → 上破冰雷達（觀察）；雙方都 ≥ 60 → 標「優先」
  - 雙方都 ≥ 60 → 才能成為隊伍提案的候選
  - 每位對象只看最新一次完成的互盤（新評估不合格時，舊的合格評估不會「復活」）
- **破冰雷達**：最多 6 位值得先聊的人；雙方都 ≥ 50 就能生成**破冰卡**（共同點／互補點／風險轉譯／開場三句，可複製）
- **分享圖**：破冰卡與選手數據卡都能匯出 1080px PNG（Web Share API／下載）
- **GitHub 公開資料比對**：用 GitHub 公開 API 比對你宣稱的技能與公開 repo 的主要語言（排除 fork）。**只比對公開資料，不證明這個 GitHub 帳號屬於你**（API 固定回 `ownershipVerified:false`）；設計、簡報等非程式技能會標成「無法由此驗證」
- **隊伍提案**：候選（雙方 ≥ 60）取前 6 位，枚舉三人假設（≤ 15 組），每組一個隔離評估 Part；硬約束過濾後以不重疊貪婪選出最多 3 隊。**所有真人成員都同意才成立**（模擬隊友視為已同意），成立後收回這些真人的其他提案
- **團隊群聊**：SSE、輸入中指示；模擬隊友依角色認領工作（「後端 API 我先開」「簡報我來扛」）
- **持續聯絡（Keep in touch）**：對模擬對象直接連上；真人對真人要**對方接受邀請**（requested → connected）才會開啟 1:1 私訊；連線不隨活動結束消失
- **帳號與安全**：
  - Email + 密碼註冊／登入（scrypt 雜湊；DB Session 只存 SHA-256 雜湊）；密碼 8–72 字元、不可與 Email 相同
  - Cookie 一律 `HttpOnly; SameSite=Lax; Path=/`，production 且走 HTTPS 時才加 `Secure`（所以 `demo:serve` 用 `http://區網 IP` 也能登入）
  - **Email 驗證**：一次性權杖（存雜湊、24 小時到期）。尚未接 SMTP：`AUTH_DEV_LINKS=on` 時驗證連結直接附在 API 回應（demo 用）
  - **未驗證閘門**：有 email 但尚未驗證的帳號，不能發起配對、產生或加入隊伍、發起／接受聯絡、私訊、群聊、生成破冰卡、重跑 /compare（403 `email_unverified`）
  - **忘記密碼／重設**：權杖 30 分鐘、重設後登出所有裝置；回應一律同形狀（不透露帳號是否存在）。**重設連結只有 `AUTH_DEV_RESET_LINKS=on` 且不是 production 時才會附在回應裡**，其他情況不寄送也不回傳（沒有 SMTP）
  - **節流**：登入同一 email 15 分鐘失敗 8 次 → 429（附 `retryAfterSec` 與 `Retry-After`）；註冊、忘記密碼、重寄驗證、GitHub 比對、建立示範身分、以及所有會呼叫 LLM／Jev 的端點都有額度（見下方「節流與成本保護」）
  - **跨站防護**：`src/proxy.ts` 擋掉 Origin 與 Host 不符的跨來源 POST／PUT／DELETE（403 `bad_origin`）
  - **刪除帳號**：`DELETE /api/me` 刪除帳號與個人資料並清掉 cookie（種子角色不能刪）
  - **示範身分切換**：只能切到**沒有 email、也沒有密碼的示範身分**（種子角色與 demo 建立的角色）；真帳號不能被切換冒用，`/api/users` 也只列示範身分；登入真帳號時真 session 永遠優先（要切換請先登出）；`DEMO_SWITCH=off` 可整個關閉
- **活動（Event）code 加入**：配對範圍鎖定同一場活動；demo 內建「EvoTavern」（code `EVOTAVERN`）；沒加入任何活動時「隊長出發」回 409 `no_event`（候選只在同一場活動裡找，不做全域配對），/agent 會顯示加入活動的輸入框

## 🚀 快速開始

需要 Node.js ≥ 20.9。

```bash
git clone https://github.com/jiapunk/siebo-captain && cd siebo-captain
npm install
npm run setup          # 沒有 .env 時自動從 .env.example 建立（mock 模式、金鑰空白）→ migrate deploy → 種子（活動 + 9 位參賽者）
npm run dev            # http://localhost:3000
```

打開後：選 Demo阿飛（示範身分，或到 `/login` 註冊真帳號）→ 我的隊長 →「隊長出發」→ 看隊長互盤
→ 破冰雷達生成破冰卡、匯出分享圖 → 我的檔案做 GitHub 公開資料比對
→ 回指揮台「產生隊伍提案」→「加入這隊」→ 團隊聊天室。

### 完整檢查（與 AUDIT §9 同一套步驟）

```bash
npm run typecheck                  # next typegen && tsc --noEmit（型別要先由 typegen 產生，直接跑 tsc 會缺 LayoutProps）
npm run lint
npm run build
npm run test:unit                  # node:test 單元測試（tests/unit/*.test.ts）
npx playwright install chromium    # 第一次跑 E2E 前安裝瀏覽器
npm run test:e2e                   # Playwright E2E（tests/**/*.spec.ts）
```

`test:e2e` 使用**獨立的測試資料庫**（`prisma/test-<port>.db`，預設 port 3100）與獨立的 build 目錄，全部走 mock（LLM、決策層、GitHub、EvoMap 都不外連），**不會動到 demo 用的 `prisma/dev.db`**。可用 `E2E_PORT` 換 port。

> Next 16 在 build 目錄不是預設的 `.next` 時，會自動在 `tsconfig.json` 的 `include` 加兩行（`<目錄>/types/**/*.ts`）。`test:e2e` 跑完會自動還原；自己用 `NEXT_DIST_DIR=…` 手動跑 `dev`／`build` 時，結束後要自己還原 `tsconfig.json`（例如 `git checkout tsconfig.json`），不要把這兩行提交進去。

### Demo 現場

```bash
npm run demo:snapshot   # 演示前先存一份 dev.db 快照（prisma/demo-snapshots/，不進版控）
npm run demo:serve      # next build && next start -H 0.0.0.0 -p ${PORT:-3000}（production 模式、區網可連，現場建議用這個）
npm run demo:restore    # 還原快照並自動對齊 migration 紀錄；沒有快照時只印提示（全新 clone 本來就沒有快照）
npm run demo:reset      # 清空 demo 互動資料（種子角色與活動保留）
npm run db:seed         # 重建活動與種子角色（真帳號與其資料保留，移到新活動）
```

- `demo:serve` 的 port 讀 shell 環境變數（`PORT=3000 npm run demo:serve`），寫在 `.env` 沒有效果
- `demo:serve` 是 production 模式：cookie 只有走 HTTPS 才加 `Secure`（http 區網照常登入）；`AUTH_DEV_LINKS=on` 的驗證連結照樣會回傳，但密碼重設連結不會（`AUTH_DEV_RESET_LINKS` 只在非 production 生效）
- **從舊版升級既有的 demo DB**：舊版的 10 支 migration 已合併成單一 baseline。用舊版建立的 `prisma/dev.db` 要先跑一次 `npm run db:rebaseline`（只改寫 `_prisma_migrations`，會先比對 schema 並備份成 `.pre-rebaseline.bak`；可用 `-- --dry-run` 先看），之後才能 `npm run db:migrate`

## 📅 活動場次設定

Demo 種子活動可用 `.env` 換成你自己的黑客松（預設值與 `.env.example`、種子一致）：

```env
EVENT_NAME="EvoTavern"
EVENT_CODE=EVOTAVERN
EVENT_STARTS_AT=2026-09-21T09:00:00+08:00
EVENT_ENDS_AT=2026-09-24T23:59:59+08:00
```

改完執行 `npm run db:seed`。seed 會先驗證這四個值（日期格式、結束晚於開始、code 不可含空白），不合法就直接中止、不動任何資料；成功時在單一交易內重建活動與種子角色，真帳號保留。

## 🐝 蜂群引擎（P0 + P1）

> 設計依據：EvoX 蜂群研究的實驗一（論文數字：蜂群 70.7% vs Sub-Agent 38.5%，不是本產品的量測）。取其三個原則——**原子拆分、隔離執行、程序匯合（不讓 LLM 重新理解答案）**。

| 原則 | 實作 | 檔案 |
|---|---|---|
| **原子拆分** | 每場互盤 = 6 個 Part（`q:A / a:B / q:B / a:A / r:A / r:B`：雙方各自提問、作答、寫評估報告），穩定 ID、固定 slot；組隊 = 每個三人假設 1 個 `team_eval` Part | `src/lib/swarm.ts`、`src/lib/matching.ts` |
| **隔離執行** | 每個 Part 只拿最小必要的 state（兩份依分享權限投影後的檔案＋對應逐字稿）；Part 級重試 1 次，失敗與退路都記在 `SwarmPart` | `runPartDetailed()` |
| **程序匯合** | 只從 slot 讀型別化分數：硬約束（隊伍評估 ≥ 60、角色缺口與死鎖旗標 < 0.6）→ 排序 → 不重疊貪婪（最多 3 隊）；文字只走模板，LLM 不改數字 | `src/lib/teamAssembler.ts` |

**軌跡**：每個 Part 記錄 provider／model／latency／tokens／實際 HTTP 請求數／重試數／是否退回本機腳本。指揮台 run 卡顯示 `PARTS 6/6 · RETRY n · RETAIN …`（有 Part 退回本機腳本時另顯示 `LOCAL-FB n`），隊伍頁顯示 `HYPOTHESES n · SELECTED n`。

- **RETAIN（量測值）**：只量「報告 Part」——決策層回答的 8 個 slot（5 個維度分＋3 個旗標）是否原封不動進入最終報告。0–100 換算被 25–97 夾限、被規則覆寫（例如同角色群強制判定重疊）、或遠端該題退回規則，都算不保留。run 卡顯示你這一側報告保留的 slot 數／總數（例如 `RETAIN 8/8`）；API 的 `parts.retainedPct` 另給兩個報告 Part 中完全保留的比例（只會是 0／50／100%）。規則層（mock）直通，所以 mock 模式恆為全數保留；`LLM_PROVIDER=real`（報告由 LLM 直接生成、沒有決策 slot）時不可量測、不顯示。組隊的 `team_eval` Part 用同樣規則量測。提問／作答 Part 沒有 RETAIN。這和 EvoX 論文的 Sub-Agent 保留率量的不是同一件事，不做並列比較
- **覆蓋率**：expected vs done；Part 級重試只重跑失敗的那個 Part
- **故障演練**：指揮台勾「故障演練」，讓「我的隊長作答」Part 第一次嘗試故意失敗，可以看到自動重試接力（`RETRY 1`）

### 流程不中斷的實際範圍

- **互盤的提問／作答／報告**：Part 失敗先由 Part 級重試 1 次（real.ts 內部再重試 1 次，單次請求逾時 `LLM_TIMEOUT_MS`，預設 45 秒）；仍失敗就改用本機腳本產生該 Part（`SwarmPart.note` 記 `fallback=local`），**本場之後的 LLM Part 直接改走本機腳本**（降級），run 仍會 completed。代價：斷網時每場最壞要等一個 Part 的重試預算（約 3 分鐘）才降級，5 場並行；降級後的逐字稿是本機腳本文字
- **評分**：hybrid 模式走決策層 Jev → LLM → 本機規則（見下方「決策層」）
- **訪談、檔案編譯、破冰卡、模擬隊友回覆**：遠端失敗時改用本機腳本（伺服器 log 記一筆 warning）
- **仍會中斷的情況**：資料庫寫入失敗；行程重啟（進行中的 run 超過 10 分鐘會被收尾成 failed）；多實例部署（見「已知限制」）
- **現場網路不穩時最穩的做法**：`.env` 改 `LLM_PROVIDER=mock` 後重啟，全部走本機腳本

## 📒 P2：Agent Ledger（戰績帳本）＋ 合作網絡 ＋ 對照

**Ledger（append-only，對齊 EvoMap「recall before, record after」）**
- 行為記帳：`team_joined`（值＝隊伍分，只記真人）、`connection`（重複邀請不重複記帳）、`message_sent`、`icebreaker`
- `summarizeLedger()` 單次 groupBy 算能力分：基準 35 ＋ 隊伍 ×8（上限 20）＋ 聯絡 ×5（上限 15）＋ 訊息 ×0.5（上限 10）＋ 平均隊伍分 ×0.15（上限 15）＋ 破冰卡 ×1（上限 5），夾在 30–98
- 帳本寫入失敗不阻斷主流程

**能力加權組隊（`ASSEMBLY_SIGNAL`）**
- `competence`（預設）：最終分 = 隊伍評估 × 0.75 ＋ 兩位隊友帳本均分 × 0.25
- `social`（對照組）：只用隊伍評估分
- 隊伍卡直接顯示算式

**單體 vs 蜂群對照（/compare）**
- 蜂群＝該場既有的 6 個 Part（4 個對談生成＋2 個評分）；單體＝**沿用蜂群已生成的同一份逐字稿**，用一次呼叫直接產出 A 方報告
- **公平可比的是「評分步驟」**：`timing.scoringMs`（蜂群 `r:A` Part 耗時 vs 單體那一次呼叫）與 `callBreakdown.scoringComparable`；蜂群的全流程牆鐘含對談生成（mock 模式另含每步 650ms 的轉播節奏延遲），和單體不是同一個範圍，API 分欄列出
- 評分者不同、輸入對齊：hybrid 下蜂群評分走 Jev 決策層（失敗退 LLM 決策→本機規則），決策層只看雙方各 6 個檔案欄位（暱稱、角色、技能、目標、可投入時間、協作風格）加逐字稿前 6000 字；蜂群 `r:A` 走決策層時，單體 LLM 也只收到同樣的 6 個欄位與前 6000 字（`solo.extra.input = "decision-fields"`；更早快取的單體看的是完整公開檔案，標 `"public-profile"`，重新執行即可對齊）。輸入相同，但評分者與量尺不同，分差不能解讀為蜂群的品質優勢，/compare 頁面明講。real 模式兩邊是同一個 LLM、完整公開檔案；mock 模式兩邊都是本機規則、不外送（`scoringSource` 如實標示）
- 對照固定以 A 方（發起者）視角；B 方打開時看到的是 A 方隊長的評估（回應 `viewerSide`）
- 每場只有一次單體取樣（LLM 有隨機性，重跑會變），不能當統計結論；只有該場當事人能看、能重跑（每場每分鐘 1 次）

**決策層 vs 規則層的分歧（Δ）**
- 每份報告附 `ruleScore`（同一組合的規則層分數，純函式、零成本），UI 顯示 `ENGINE // JEV · RULE 81 → 84 Δ+3` 這類對照，指揮台彙總 Δ 平均
- Δ 量的是「決策層與手寫規則的分歧」，不是決策層的「實際貢獻」；要主張貢獻需要人工標註或事後成隊結果來校驗

**合作網絡圖（`/api/network`）**
- 節點＝同一場活動的成員（角色依分享權限投影）；邊＝同活動已成立隊伍的兩兩成員＋兩端都在本活動的持續聯絡（connected）；沒有加入活動時回空圖
- 指標：**聚類係數**（標準平均聚類，同 networkx `average_clustering`：degree < 2 的節點記 0 並計入平均）、邊數／平均度、樞紐節點
- **雙信號模擬**：取「你最新一輪組隊」的 `team_eval` 假設（舊資料沒有封存上一輪時，只取與你最新一筆相差 10 分鐘內的假設，與隊伍頁的 `HYPOTHESES` 同一套計數），套用與實際組隊相同的硬約束與不重疊貪婪，分別用 social 與 competence 信號各選一次；每隊＝你＋兩位隊友的三角形，加上既有的邊建圖，比較兩種信號下的聚類係數與跨角色群連結數（不寫 DB）
- 限制：只模擬單一使用者的最新一輪，樣本很小；EvoX 實驗二的 0.53 → 0.28 是論文數字，這裡只是把同一個比較方式搬進產品畫面，不是重現該實驗

## 🧬 P3：EvoMap GEP-A2A 對接（opt-in）

- **預設關閉**：`EVOMAP_ENABLED=0` 完全不連線；失敗不阻斷組隊流程
- **註冊**：`npm run evomap:register` → `POST /a2a/hello` 取得 `node_secret` 與 `claim_url`，寫進 `.env`。`.env` 已有 secret 時不會重新註冊；`--force` 才另註冊新節點（舊的 id／secret 先備份到 `.env.evomap-backup-<時間>`）
- **發佈**：`npm run evomap:release` 把最新一輪組隊成果打包成 **Gene＋Capsule＋EvolutionEvent**（sha256 內容定址，canonical JSON）。Capsule 的 `execution_trace` 由 DB 紀錄組出（互盤 Part、隊伍評估 Part、實際寫入的隊伍），不是重新執行；發佈內容不含任何使用者 id 或姓名。先跑 Hub `validate`，沒通過或 0 隊就不發佈；`--dry-run` 只印出 bundle 不連線，`--force` 才會強制發佈
- **網頁端**：`GET /api/evomap` 公開查狀態（不含秘密，Hub 統計快取 60 秒）；`POST /api/evomap`（validate／publish／fetch）只限 `EVOMAP_ADMIN_USER_IDS` 裡、用密碼登入的真帳號，其他一律 403；UI 沒有發佈按鈕，一般發佈走 CLI
- **狀態**：`npm run evomap:status`；**搜尋**：`POST /a2a/fetch`（search_only 免費；完整抓取會扣 credits）
- **心跳**：`scripts/evomap-heartbeat-install.sh` 產生 launchd 設定（`--load` 才會載入），log 預設 `~/Library/Logs/siebo-evomap-heartbeat.log`、超過 1MB 自動截斷；到 `EVOMAP_HEARTBEAT_UNTIL`（沒設時用 `EVENT_ENDS_AT`）自動停止
- **學到的基因** `sha256:299eb589…`（存於 `assets/gep/learned/`）：只參考它的 bundle 打包格式（自包含 validation 指令、`code_snippet` 證據欄位）；組隊引擎是自研的，程式執行時完全不讀這個檔，也沒有使用它的 Gene
- **發佈紀錄**：v1 `bundle_9b91f1df7185954e` 只有本地紀錄（repo 內沒有它的 asset id），無法公開驗證；v2 `bundle_59acb3cc7a144c00` 的 asset id 在 `assets/gep/last-publish.json`，可用 `GET https://evomap.ai/a2a/assets/<sha256:…>` 公開查詢（bundle id 不能拿去查）。已發佈的 v2 是舊產生器產的，`execution_trace` 與 `success_streak` 是常數；修正後的產生器尚未重新發佈。詳見 [AUDIT §5](./AUDIT.md)

## 🧠 決策層（Jev / TypeSafe System One）

互盤評分走**決策層**：Jev 用 Noul／Choice／Score 回傳型別化答案，**不生成文字**；
文字理由與摘要一律由本地化模板合成（可稽核）。

```
LLM_PROVIDER=mock   → 全部本機規則／腳本（離線、E2E 固定使用；預設值）
LLM_PROVIDER=real   → 全部 LLM（評分也由 LLM 直接生成）
LLM_PROVIDER=hybrid → LLM 負責對談／文案 ＋ 決策層負責評分（現場用）
（real / hybrid 沒有 LLM_API_KEY 時一律視為 mock）
```

- **三段鏈 fallback（Jev → LLM → 本機規則）**：
  - Jev 沒有 key／逾時（`JEV_TIMEOUT_MS`，預設 6 秒，涵蓋讀完 body）／非 200／答案型別、範圍或選項不合法 → 先退 **LLM 決策**（同一組題目、JSON 模式，`DECISION_LLM_TIMEOUT_MS` 預設 20 秒），再退本機規則
  - 為何最後才是規則：它是唯一不會失敗、零延遲、零成本的層
  - **逐題 fallback**：部分題目不合法只退那幾題；覆蓋不足時**只重打缺漏的題目**並與前一次合併；遠端一題有效答案都沒有時，來源標成 `mock`，不會標成 `jev`
  - **斷路器**：Jev **連續** 3 次失敗 → 60 秒內跳過；冷卻後只放一個探測請求（半開），成功才恢復；成功一次就歸零。狀態在行程內
  - 開關：`DECISION_PROVIDER=auto|jev|mock`、`DECISION_FALLBACK=auto|mock`（mock＝不經 LLM）
  - 透明性：報告記錄 `decisionSource`（jev／llm／mock）、逐題退回數與覆蓋明細，指揮台顯示 `ENGINE // JEV|LLM|MOCK`
- 題數：互盤報告 8 題（5 個維度分＋3 個旗標）；隊伍評估 7 題
- 驗證：`npx tsx scripts/jev-smoke.ts [--bad-key] [--report]`（會讀 `.env`）；單元測試 `tests/unit/decide.test.ts`（逐題 fallback、只重打缺漏題、逾時涵蓋 body、斷路器連續／半開／並行）；E2E `tests/decision.spec.ts`（本機 stub server，完全離線）
- 實測延遲與 token：demo 資料中一場 hybrid 互盤的評分步驟，Jev（`r:A`）1,492 ms、單體 LLM 22,904 ms；互盤 Part 平均延遲 7.7–16.3 秒（見 `audit/evidence/live-api.txt`）。token：修正版會記錄供應商回傳的用量（`MatchReport.usage`、`SwarmPart`，`/api/compare` 的 `tokens`），但 demo 資料是修正前寫入的、沒有 token 紀錄（null），mock 模式也不產生 token；要實測需付費的 Jev／LLM key

## 🤖 LLM 設定

預設是 **mock**（`.env.example`：`LLM_PROVIDER=mock`，不呼叫任何付費 API）。要接真 LLM，編輯 `.env`：

```env
LLM_PROVIDER=hybrid                          # 或 real
LLM_BASE_URL=https://opencode.ai/zen/go/v1   # OpenCode Go；DeepSeek 官方為 https://api.deepseek.com
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-v4.1-flash
LLM_TIMEOUT_MS=45000
JEV_API_KEY=...                              # hybrid 評分用（沒有就退到 LLM 決策，再退規則）
```

- 遵循 OpenCode Go 規範：專屬 `User-Agent` ＋ `x-opencode-session`（訪談與檔案編譯＝每份檔案的隨機 id（存在 interview JSON 的 sid，不是 userId）、互盤＝runId、破冰卡＝runId、團隊聊天＝teamId、私訊＝connectionId；只保留 ASCII；供應商端可藉 runId／teamId／connectionId 關聯同一場對談的請求）
- 呼叫量：一場互盤 hybrid 約 4 次 LLM ＋ 2 次決策請求、real 約 6 次 LLM（不含重試）；「隊長出發」一次最多 5 場，並行執行；真 LLM 模式一次約數分鐘（背景執行＋ live 轉播）

## 🔒 隱私與資料流

**只有 `LLM_PROVIDER=real|hybrid` 且填了金鑰時才會把資料送到第三方**。預設的 mock 模式下，互盤、組隊評估、/compare 單體都用本機規則，不呼叫 LLM 或 Jev（GitHub 與 EvoMap 另由 `GITHUB_VERIFY`、`EVOMAP_ENABLED` 控制）。

| 第三方 | 什麼時候送 | 送出什麼 |
|---|---|---|
| LLM 供應商（`LLM_BASE_URL`，預設 OpenCode Go／DeepSeek） | real／hybrid 且有 `LLM_API_KEY` | 訪談回答全文（包括你在訪談裡提到的合作地雷）與檔案編譯；互盤提問／作答／報告（雙方都只送分享權限投影後的檔案＋逐字稿）；破冰卡（你自己的完整檔案＋對方投影後的檔案）；有模擬隊友的群聊與私訊最近 20 則；決策層退到 LLM 時的決策題狀態 |
| Jev（`JEV_BASE_URL`，TypeSafe） | 非 mock 模式、有 `JEV_API_KEY`，且 `DECISION_PROVIDER` 不是 mock | 互盤評分：雙方投影後的檔案摘要＋逐字稿；隊伍評估：三位成員投影後的檔案摘要 |
| GitHub API | 按「GitHub 比對」且 `GITHUB_VERIFY` 不是 mock | 你輸入的 GitHub 使用者名稱（可選 `GITHUB_TOKEN`；結果快取 10 分鐘） |
| EvoMap（`EVOMAP_BASE`） | `EVOMAP_ENABLED=1`，由 CLI 或管理者帳號觸發 | 組隊彙總統計（隊伍數、平均分、provider、Part 完成數），不含使用者 id 或姓名；心跳只送節點憑證 |

- **訪談前告知**：`/onboarding` 開始新訪談前先顯示一張告知卡：回答會送到第三方 AI 服務處理、伺服器可能在使用者所在地區以外、分享權限擋不住 AI 服務處理、可隨時刪除帳號、保存期限（訪談原文編譯完成即刪除；活動結束 30 天後清除參賽者帳號與資料）；要勾選同意才開始（mock 模式另註明回答不會外送）。已經有回答的訪談不再顯示。伺服器也會檢查：新訪談第一則回答要帶 `consent: true`，否則 `/api/onboarding/message` 回 400 `consent_required`；同意時間 `consentAt` 存進 interview JSON（沒有改 schema）。同意機制上線前就已開始的訪談不再要求同意
- **分享權限**：關閉的欄位不會給對方參賽者看到，也不會放進互盤、組隊、網絡圖送出的檔案；但訪談原文與你自己的破冰卡生成仍會送到 LLM 供應商
- **資料保存**：訪談逐字稿與檔案存在本機 SQLite；檔案編譯完成（`status=ready`）時會清空訪談原文，只留 `consentAt` 與清除時間 `clearedAt`（編譯出的選手檔案保留）；`DELETE /api/me` 會刪除帳號與所有衍生資料。**保存期限：活動結束（`EVENT_ENDS_AT`）30 天後，清除所有非種子帳號（真帳號與 demo 建立的示範身分）及其資料**；目前沒有自動排程，由營運者手動執行。此修正前已編譯的檔案仍保留訪談原文，需由營運者一次性清空。第三方供應商端的保存政策不在本服務控制範圍

## 🛡️ 節流與成本保護

- 帳號類（`src/lib/rateLimit.ts`）：登入每 email 8 次／15 分鐘（成功或重設密碼後歸零）；註冊每 email 5 次／15 分鐘、每來源 30 次／10 分鐘；忘記密碼每 email 3 次／15 分鐘、每來源 20 次／15 分鐘；重寄驗證每人 5 次／15 分鐘；GitHub 比對每人 5 次／10 分鐘、每來源 30 次／10 分鐘；建立示範身分每來源 60 次／10 分鐘
- 成本類（`src/lib/costGuard.ts` 的 `LIMITS`）：隊長出發、產生隊伍提案各每人 10 次／10 分鐘（執行中重送回 409 `already_running`）；/compare 重跑每場每分鐘 1 次；訪談訊息每人 20 則／分鐘（上限 1000 字、20 則回答）；檔案編譯 5 次／10 分鐘；破冰卡新生成 30 張／10 分鐘；群聊＋私訊 30 則／分鐘；聯絡 30 次／10 分鐘；加入活動 10 次／10 分鐘；EvoMap 管理動作每人 6 次／分鐘
- SSE：每人最多 24 條同時連線；後端提供多工逐字稿串流（`GET /api/agent/runs/stream?ids=…`，一條連線最多看 8 場）；run 串流每 3 秒輪詢 DB 補送；斷線一定退訂
- 「來源」預設所有直連用戶共用一個桶；放在反向代理後面時設 `TRUST_PROXY=1` 才會用 `X-Forwarded-For` 區分。所有額度都是單一行程的記憶體狀態

## 🎛️ 設計系統：GITS（Ghost in the Shell 風格 HUD）

刻意避開「AI 產品樣板臉」（紫黑霓虹漸層、發光玻璃、emoji 滿版），走**攻殼機動隊**路線：深墨底、磷光綠、國際橘、掃描線、準星環、直書日文。

| 元素 | 做法 |
|---|---|
| 底色 | `#0b1014` 深墨 + 32px 藍圖網格 + 光學迷彩斜紋 + 暗角 |
| 訊號色 | 磷光綠 `#5be3a7`（狀態／正向）、警戒橘 `#ff5c38`（行動）、琥珀 `#ffb454`（提示）、資訊藍 `#54c7ec` |
| 面板 | 1px 硬框 + **磷光轉角括號** + 刻度尺；**不用 clip-path**（Chromium 捲動容器有渲染 bug，改用角括號） |
| 元件語言 | 準星環頭像（虛線旋轉圈）、LED 訊號燈、波形動態列（live）、旋轉印章、等寬分段訊號條 |
| 點綴 | 直書日文（「攻殻機動隊・電脳空間」）、`MONO // 中文` 區塊代碼（TGT-01 / STEP 01 / SQUAD PROPOSAL） |
| 動效 | boot-in 進場（去模糊）、CTA 掃掠光、LED 閃爍 |
| 分享卡 | 同款深色終端機風（1080px PNG、橘色信號條、綠色 RADAR READY 印章） |

## 🌐 多語系（i18n）

- **語言**：繁中（預設）· 簡體中文 · English · 日本語——Header 與首頁狀態列一鍵切換，存 cookie（`sc_lang`）
- **語系決定順序**：`sc_lang` cookie → 瀏覽器 `Accept-Language` → 繁中；伺服器產生的動態內容（訪談、逐字稿、破冰卡…）與介面用同一個語系
- **UI 字典**：`src/lib/i18n-dict.ts` 主字典每語系 253 鍵，加上擴充字典 `src/lib/i18n-ext-a.ts`（每語系 121 鍵）、`src/lib/i18n-ext-b.ts`（每語系 102 鍵）（同名 key 以擴充字典為準，其中 12 個覆蓋主字典），合併後每語系 464 鍵（四語系鍵集合一致）；`src/lib/i18n.tsx`（Provider + `useT()`）
- **動態內容字典**：`src/lib/content.ts`（約 49KB，訪談題庫／對談模板／報告理由／破冰卡／團隊訊息／引擎文案 × 4 語系）
- 簡中為人工維護的字典（不在執行時轉換）

### 動態內容也吃語系（cookie → API → LLM）
```
語系 → getServerLocale() → 傳入 llm.*(…, locale)
  ├─ mock：讀 content.ts 對應語系腳本（四語系全覆蓋）
  └─ real／hybrid：system prompt 附加輸出語言指令 → LLM 直接輸出該語言
```
- 覆蓋範圍：訪談回覆、互盤逐字稿（提問／回答）、互盤報告（理由／紅旗／摘要）、破冰卡、隊伍組裝報告、團隊聊天回覆、對談轉播系統訊息
- 例外：GitHub 比對結果的 `note` 欄位目前只有繁中
- E2E：`tests/i18n.spec.ts`（四語系切換與保留）、`tests/dynamic-i18n.spec.ts`（訪談回覆隨語系切換）、`tests/i18n-content.spec.ts`（EN 模式下的對談與報告）、`tests/i18n-compare.spec.ts`（/compare 在簡中與 EN 模式下沒有繁中殘留）

## 📱 行動裝置自適應

- **底部 Dock**：登入後手機顯示底部導覽（我的隊長／破冰雷達／隊伍／對照／我的檔案），含 active 指示與 safe-area 留白
- 桌機頂部導覽／手機 Dock 雙軌；手機頂欄只留品牌＋語言＋身分
- E2E：390×844 視窗的 Dock 導覽與各頁無水平捲動（`tests/mobile.spec.ts`）

## 🏗️ 架構

| 層 | 技術 |
|---|---|
| 前端 | Next.js 16 (App Router) · React 19 · Tailwind v4 |
| 後端 | Route Handlers · SSE（行程內 EventEmitter 匯流排；run 串流另有 DB 輪詢補送）· `src/proxy.ts`（跨來源檢查） |
| 資料 | SQLite + Prisma 6（16 個 model：User / AuthToken / Session / Event / EventMember / AgentProfile / MatchRun / SwarmPart / SoloBaseline / Icebreaker / Team / TeamMember / TeamMessage / Connection / ConnectMessage / LedgerEvent） |
| LLM | 本機腳本引擎 / OpenAI 相容 API（可插拔）；決策層 Jev → LLM → 規則 |

### 核心管線

```
訪談 → 選手卡（分享權限投影）
   → 隊長互盤（雙方各自提問 → 作答 → 各寫一份報告）
   → 雙方門檻：較低分 ≥ 50 上破冰雷達（破冰卡），≥ 60 標優先並進入組隊候選
   → 組隊：前 6 位候選的三人假設各自評估 → 硬約束 → 不重疊貪婪（最多 3 隊）
   → 所有真人同意 → 團隊群聊（模擬隊友依角色認領）
```

### 專案結構

```
src/
  proxy.ts             # 跨來源 POST 檢查（Next 16 proxy，原 middleware）
  app/
    page.tsx           # Landing + 示範身分選擇
    onboarding/        # 選手訪談
    profile/           # 選手卡 + 分享權限 + GitHub 比對
    agent/             # 我的隊長（互盤 live、蜂群面板、產生隊伍提案）
    people/            # 破冰雷達（破冰卡）
    teams/ team/[id]/  # 隊伍提案 + 團隊群聊 + 持續聯絡清單 + 網絡面板
    connect/[id]/      # 1:1 私訊
    compare/           # 單體 vs 蜂群對照
    login/ verify/ reset/  # 登入註冊 / Email 驗證 / 密碼重設
    api/               # agent/runs(+stream) auth/* bus/user compare connections(+accept/messages/stream/typing)
                       # events/{current,join} evomap matching/run me network onboarding/{message,compile}
                       # people(+icebreakers) profile(+verify/github) session teams(+assemble/messages/stream/typing) users
  lib/
    llm/               # index（模式切換＋本機退路）· mock · real · decide（決策層）· meter（呼叫計量）· lang
    matching.ts        # 互盤引擎（6 Part、降級、候選排序）
    swarm.ts           # Part 底座（重試、退路、覆蓋、RETAIN 統計）
    pairGate.ts        # 雙方門檻單一來源
    teamAssembler.ts   # 假設評估式組隊
    network.ts         # 合作網絡＋雙信號模擬
    ledger.ts          # Agent Ledger
    compare.ts         # 單體 vs 蜂群
    evomap.ts          # GEP-A2A 打包與 Hub 呼叫
    teamBot.ts connectBot.ts   # 模擬隊友／私訊回覆
    auth.ts session.ts gate.ts rateLimit.ts costGuard.ts http.ts sse.ts bus.ts
    github.ts profile.ts content.ts i18n*.ts locale.ts personas.ts card.ts client.tsx
  components/          # AppHeader / RunStream / ScoreRing / LocaleSwitcher / Icons
prisma/                # schema、單一 baseline migration、seed、reset-demo、db-path、orphans
scripts/               # ensure-env、db-rebaseline、db-prune-orphans、demo-snapshot/restore、evomap-*、jev-smoke、verify-decision、secret-scan
tests/
  *.spec.ts            # E2E：auth compare contacts decision dynamic-i18n evomap evomap-contract fallback
                       #      hackathon i18n i18n-compare i18n-content i18n-pages mobile network
                       #      register-journey swarm
  api/*.spec.ts        # API 層：api-guards auth-security
  unit/*.test.ts       # 單元（node:test）：append-event compare-input decide engine-misc github ledger
                       #      matching-event network pairGate profile-github retain teamAssembler
  probes/              # fallback.spec 用的子行程探針（real 模式引擎、端點全指向黑洞）
  global-setup.ts global-teardown.ts helpers.ts
shots/                 # 靜態展示截圖（多數早於修正版，細節可能與現況不同；測試不會再覆寫，測試截圖寫到 test-results/）
```

## 🧪 測試

E2E 在 `tests/*.spec.ts` 與 `tests/api/*.spec.ts`（Playwright），單元測試在 `tests/unit/*.test.ts`（node:test）。目前 E2E 48 項（19 個 spec 檔）、單元 51 項（10 個檔）全數通過（commit `85ab163`，完整輸出見 `audit/evidence/test-run.txt`）；逐項斷言見 [AUDIT §2](./AUDIT.md)。

- E2E 用獨立測試 DB 與 mock 設定（見 `playwright.config.ts`），外部端點一律指向不可達的 `127.0.0.1:9`；測試截圖與下載檔寫到 `test-results/`（不進版控）
- `tests/decision.spec.ts`：透過 `scripts/verify-decision.ts` 在本機 stub server 上驗證三段鏈實際回退、覆蓋不足重打、逐題 fallback、斷路器與逾時（完全離線）
- `tests/api/auth-security.spec.ts`：真帳號無法被 `sd_uid` 冒用、`/api/users` 不含真帳號、登入第 9 次 429（換 `X-Forwarded-For` 也繞不過）、註冊節流、forgot 不外洩連結、PUT /api/profile 不能寫入 github、跨來源 POST 403、刪除帳號（含編譯後訪談原文已清空、刪除後對方的 `/api/agent/runs` 不再列出那場 run）
- `tests/api/api-guards.spec.ts`：/compare 權限與重跑額度、多工逐字稿串流、執行中重送 409、沒有加入活動的用戶「隊長出發」得 409 `no_event`、不建立任何 run、真人聯絡要對方接受、組隊要所有真人同意、訪談長度上限、訪談第一輪要同意（400 `consent_required`，存 `consentAt` 與隨機 `sid`）

## 🗺️ 路線圖

- **上線部署（從單機 SQLite 到雲端）**，實際要做的事：
  - SQLite → Postgres：migration 目前是 SQLite 方言（`migration_lock.toml` 綁 sqlite、`DATETIME` 型別、SQLite 對 `JSONB` 只當型別名稱、實際存成文字），要另外產生 Postgres baseline，並寫資料轉換（毫秒時間戳→timestamptz、0/1→boolean、TEXT→jsonb）；連線要走 pooler 並設 `directUrl`
  - 即時事件：bus 是行程內 EventEmitter，多實例要換成共享 pub/sub（Redis、Postgres LISTEN/NOTIFY 或託管 realtime）
  - 背景工作：`/api/matching/run` 已用 `after()` 追蹤每場互盤（`maxDuration` 300 秒；自架 `next start` 的 graceful shutdown 與平台 waitUntil 都會等它們跑完）。但一次最多 5 場、real 模式可能跑數分鐘，超過平台時限仍會被中止（超過 10 分鐘仍在 running 的 run 由 `reapStaleRuns` 收尾成 failed）；要穩定跑在 serverless 仍需改成工作佇列（例如 Vercel Queues、Inngest、QStash）
  - 節流、鎖、斷路器：目前都是行程內記憶體，要搬到外部儲存（例如 Redis）
  - 寄信：接 SMTP／寄信服務，才能關掉 `AUTH_DEV_LINKS`
- **P1**：現場模式（QR 進桌、同桌輪轉破冰題）、團隊章程生成（分工表／milestone）、Discord／Line 通知、GitHub 所有權驗證（OAuth 或 bio／gist 驗證碼）
- **P2**：主辦方後台（組隊率／互動率）、活動後團隊追蹤、開放 Agent Card API

## ⚠️ 已知限制

- **單機設計**：SQLite、行程內 bus、行程內節流／鎖／斷路器；多實例或 serverless 部署時各實例各算各的，群聊／私訊即時事件不互通
- **節流在記憶體**：重啟即歸零；沒設 `TRUST_PROXY=1` 時所有直連用戶共用「每來源」額度
- **GitHub 比對不證明所有權**，只看公開 repo 的語言分佈；非程式技能無法由此驗證
- **沒有 SMTP**：Email 驗證靠 `AUTH_DEV_LINKS=on` 把連結放在回應裡；密碼重設連結預設不回傳，所以正式環境目前無法自助重設密碼
- **註冊仍會回 409 `email_taken`**，可藉此得知 email 是否已註冊（已節流）
- **尚未驗證 email 的使用者仍可能被別人的隊長選為互盤候選**（閘門只擋他自己發起的動作）
- **真 LLM／Jev 模式需要付費 key**：現場數據（Jev 評分、/compare 延遲、token）用 fresh clone 的 mock 模式無法重現；LLM 輸出有隨機性，即使有 key 也不會得到相同數字
- **/compare** 每場只有一次單體取樣，且單體沿用蜂群逐字稿；不能當統計結論
- **SSE 單實例**；前端斷線後的重連策略以各頁實作為準
- **保存期限靠人工執行**：告知卡與本文件寫明活動結束 30 天後清除非種子帳號，但目前沒有自動排程或清除腳本，要由營運者手動執行；此修正前已編譯的檔案仍留有訪談原文

---

*本專案由 Surrodate 拆分而來（2026-09-18）；拆分時的交接文件見 `docs/handoff/`（歷史文件，目前行為以本 README 與 AUDIT.md 為準）。*
