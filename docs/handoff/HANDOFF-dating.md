# 🔮 賽博月老 — 交接文件（dating vertical）

> 版本 v1 ｜ 2026-09-18 ｜ 來源：Surrodate repo（拆分後本文件伴隨 `siebo-yuelao` 專案）
>
> ⚠️ **歷史文件，描述的是約會產品（賽博月老），不是本 repo**。文中的「雙門檻 70 分」屬於約會版；賽博隊長的門檻見根目錄 [README.md](../../README.md)（雙方較低分 ≥ 50 上雷達、≥ 60 進組隊候選）。

## 0. 一頁摘要

| 項目 | 內容 |
|---|---|
| 一句話 | 你的專屬月老先替你去相親：祂跟對方的月老對談、評分、過濾，只有雙方都點頭的人才會出現 |
| 目標用戶 | 社恐、沒時間滑交友軟體、想認真交往的 20-35 歲 |
| 核心機制 | 訪談編譯檔案 → agent 對談評分 → 雙門檻 70 分 → 配對報告 → 破冰話題 → 一對一聊天 |
| 現況 | MVP 完成且已驗證：真 LLM（DeepSeek V4.1 Flash）全流程、SSE 即時、AI 模擬用戶 |
| Demo 網址 | http://localhost:3000（`npm run setup && npm run dev`） |
| 下一步重點 | 真人註冊、安全機制（檢舉/封鎖）、通知、種子社群 |

---

## 1. 產品定位

### 價值主張
> 「霞海城隍廟太遠的話——這裡有一位 24 小時待命的線上月老。」

- **對社恐**：不用開場、不用滑卡、不用應付騷擾。最尷尬的「互相評估」階段由 agent 完成。
- **對沒時間的人**：每天 10 分鐘內看完 agent 的篩選結果；不合格的人根本不會打擾你。
- **差異化**：市面競品比的是「配對演算法」；我們賣的是**代理人協商**——連「為什麼適合」都用逐字稿佐證。

### 品牌
- 中文品牌：**賽博月老**（詳見 `docs` 的命名脈絡：月老＝全民戀愛文化梗、無「造假」暗示、紅線意象）
- 英文/專案代號：`siebo-yuelao`（舊名 Surrodate 保留為 repo 歷史）
- 語氣：溫暖、帶點幽默、像朋友不像客服；**不用 emoji 濫炸**、不自稱神明
- 視覺：暖紙白 `#f6f3ee`、墨黑 `#26221c`、陶土紅 `#d9542b`、襯線標題（宋體堆疊）、白紙卡＋暖灰細框、線性 SVG 圖示

---

## 2. 使用者旅程（已實作）

```
選擇身分 → 訪談 6 題 → 編譯檔案＋分享權限 → 「月老出發」
   → live 轉播 agent 對談（SSE）→ 配對收件匣（含過濾統計）
   → 看報告 → 我也願意 → 破冰話題 → 一對一聊天室（AI 模擬用戶會回話）
```

### 已實作功能清單

| 功能 | 位置 | 備註 |
|---|---|---|
| 身分選擇（demo） | `/` | 8 個約會身分（7 模擬 + Demo小陽） |
| 訪談式 onboarding | `/onboarding` | mock 腳本 / 真 LLM 兩模式，6 題後編譯 |
| 檔案審核＋分享權限 | `/profile` | 逐欄 visibility，關閉的欄位連對方 agent 都看不到 |
| 月老工作台 | `/agent` | 「月老出發」觸發配對；逐字稿 live 轉播、維度雷達、評分 |
| 配對收件匣 | `/matches` | proposals / matched / 已過濾（附「省下 N 分鐘」） |
| 配對報告 | `/matches/[id]` | 雙方評分 × 理由/留意事項/共同話題/破冰話題 |
| 即時聊天 | `/chat/[id]` | SSE、輸入中指示；模擬用戶以檔案生成回覆 |
| 事件匯流排 | `/api/bus/user` | 伺服器狀態變更 → 前端即時刷新 |

---

## 3. 系統架構

### 技術棧
Next.js 16 (App Router, Turbopack) · React 19 · Tailwind v4 · SQLite + Prisma 6 · SSE（EventEmitter）· OpenAI SDK（指向 OpenCode Go）

### 頁面與 API 全清單

| 頁面 | API |
|---|---|
| `/` 身份選擇 | `GET/POST /api/users`、`POST /api/session` |
| `/onboarding` | `POST /api/onboarding/message`、`POST /api/onboarding/compile` |
| `/profile` | `GET/PUT /api/profile` |
| `/agent` | `POST /api/matching/run`、`GET /api/agent/runs`、`GET /api/agent/runs/[id]/stream`（SSE） |
| `/matches` | `GET /api/matches` |
| `/matches/[id]` | `GET /api/matches/[id]`、`POST /api/matches/[id]`（approve/decline → 生成破冰） |
| `/chat/[id]` | `GET /api/chat/[id]/stream`（SSE）、`POST /api/chat/[id]/messages`、`POST /api/chat/[id]/typing` |
| 全域 | `GET /api/me`、`GET /api/bus/user`（SSE） |

### 資料模型（Prisma）

```prisma
User         { id, name, emoji, tagline, isBot, domain, createdAt }
AgentProfile { userId, status(draft|ready), interview Json, compiled Json, visibility Json }
MatchRun     { id, userAId, userBId, status, events Json, reportA Json, reportB Json }
Match        { id, runId, userAId, userBId, status(proposed|matched|declined),
               approvedA/B, scoreA/B, icebreakers Json }
Message      { id, matchId, senderId, content, createdAt }
```

### 核心邏輯位置

| 檔案 | 職責 |
|---|---|
| `lib/matching.ts` | 候選選擇（同 domain、去重、排除進行中）、背景配對、事件流發佈、Match 建立 |
| `lib/llm/index.ts` | provider 切換（mock/real）、統一介面 |
| `lib/llm/mock.ts` | 腳本引擎：訪談、編譯、提問、回答、評分、破冰、bot 回覆（全部以真實檔案內容為材料） |
| `lib/llm/real.ts` | OpenCode Go / DeepSeek prompts；JSON mode；重試 |
| `lib/bot.ts` | 配對後聊天室：模擬用戶回覆（延遲、typing 事件、關鍵字鏡像） |
| `lib/domains.ts` | Domain Pack（此專案只保留 `dating`） |

### 評分邏輯（mock，真 LLM 由 prompt 引導但語意相同）

```
score = 30 + 共同興趣×9 (≤40) + 共同價值×10 (≤30) + 意圖匹配 + 溝通匹配 + jitter
verdict: ≥70 recommend / ≥55 cautious / <55 pass
5 維度：興趣、價值觀、生活、溝通、意圖（各 0-100）
```
> 真 LLM 模式下分數由模型給，但**門檻 70 與雙向閘門由程式把關**，不交給模型。

---

## 4. LLM 整合（OpenCode Go）

```env
LLM_PROVIDER=real
LLM_BASE_URL=https://opencode.ai/zen/go/v1
LLM_API_KEY=sk-...
LLM_MODEL=deepseek-v4.1-flash
```

- **規範**：必帶專屬 `User-Agent: surrodate/1.0`；每段對話帶 `x-opencode-session`（onboarding=userId、配對=runId、聊天=matchId、破冰=matchId）
- 模型是推理模型：thinking 佔 completion 額度，`max_tokens: 6000`
- 全 JSON mode + 3 次指數退避重試 + 防禦性解析（去 ```json fence）
- **mock 模式**：`LLM_PROVIDER=mock`（預設測試路徑）——零成本、確定性、E2E 用

⚠️ 成本意識：一次「出擊」= 候選數(3) × 6 次呼叫。真 LLM 下約 1-2 分鐘、額度消耗極小（Go 訂閱 $60/月活動額度）。

---

## 5. 設計系統

| Token | 值 |
|---|---|
| 背景 / 卡片 | `#f6f3ee` / `#ffffff` |
| 文字 / 次要 / 弱 | `#26221c` / `#575146` / `#8d867a` |
| 主色（陶土紅） | `#d9542b`（深 `#b8431f`、淺底 `#fbeee8`） |
| 輔助 | sage `#6f7d62`（正面標籤）、amber `#a9751c`（留意） |
| 標題字體 | 襯線堆疊（Songti TC / Noto Serif TC）→ class `font-display` |
| 元件 utility | `.card` `.card-flat` `.btn-ink` `.btn-accent` `.btn-outline` `.chip` `.rise-in` |
| 圖示 | `components/Icons.tsx`（線性 SVG，1.7px，20px） |

**UX 原則**：不用漸層發光、不用玻璃擬態、不用 emoji 當圖示；分數用圓環、狀態用文字 chip；所有等待都有 typing 或進度提示。

---

## 6. 運維與測試

```bash
npm run setup        # 安裝 + migrate + seed
npm run dev          # localhost:3000
npm run db:seed      # 重建種子（冪等：會清掉 seed 用戶再建）
npm run demo:reset   # 清 demo 資料（種子保留）
npm run test:e2e     # Playwright（mock、port 3100、NEXT_DIST_DIR=.next-test）
npm run build        # production build
```

- 測試：`tests/demo.spec.ts` 走完整約會流程（17s）
- 已知警告：`react-hooks/set-state-in-effect` ×3（刻意降級為 warn，fetch-on-mount 模式）
- dev/測試並存機制：測試用獨立 distDir 與 port，不干擾真 LLM server

---

## 7. Demo 腳本（現場用）

**90 秒版**
1. 開場：「霞海城隍廟太遠，所以我們把月老搬進手機。」
2. 選 Demo小陽 → 「月老出發」→ 看兩位月老對談（指著逐字稿：「這些問題本人問會很尷尬，agent 問剛剛好」）
3. 配對頁：「**月老幫你擋掉了 2 個對象**，省下 90 分鐘尬聊。」
4. 點「想認識」→ 展示破冰話題（引用真實共同點）→ 進聊天室，小柚真的回你話

**3 分鐘版**：加上新建身分走 6 題訪談 → 檔案頁調分享權限（「地雷關掉，連 AI 都看不到」）→ 編譯後再次出擊。

---

## 8. 路線圖

### P0（上線前必須）
- 真帳號系統（Email/手機 OAuth）＋ 一人一帳號
- 檢舉/封鎖/敏感詞過濾；未成年排除
- 照片與個人檔案媒體（目前只有 emoji 頭像）
- 通知（web push/email：新配對、對方同意）
- 部署：Vercel + Postgres（Prisma provider 切換；SSE 在 serverless 需確認限制→可換 Pusher/Ably）

### P1（留存）
- 破冰引導式對話（agent 在聊天室適時給建議）
- 語音自我介紹（訪談錄音 → agent 節錄）
- 配對後續回饋（見面了嗎？→ 質量訊號回饋評分）
- 安全中心（約會建議、緊急聯絡人）

### P2（商業化）
- 訂閱：更多候選、每週精選報告、深度分析
- 企業/公部門合作（聯誼活動的 agent 前置篩選）
- 開放 Agent Card 匯出（接 A2A 生態：讓其他平台的 agent 也能跟月老對談）

---

## 9. 風險與倫理（不可跳過）

| 風險 | 對策 |
|---|---|
| agent 幻覺誇大相容性 | 報告必須引用對話原文；分數僅供參考；最終由人決定 |
| 隱私洩漏 | 分享權限投影 `publicProfile`；地雷預設不分享；逐字稿權限控制 |
| 模仿/冒充真人 | UI 全程標示「你的代理人在與對方代理人對話」；上線需同意條款 |
| 評價偏誤（職業/年齡） | 報告撰寫 prompt 明確禁止以敏感屬性降分；定期審計 |
| 情緒依賴 AI | 產品定位是「篩選與破冰」不是「代聊」；聊天室一定是真人上場 |

---

## 10. 品牌資產清單（改名時要動的檔案）

`src/app/layout.tsx`（metadata）· `src/components/AppHeader.tsx`（品牌列）· `src/app/page.tsx`（landing 文案）· `src/lib/domains.ts`（dating pack 文案）· `src/lib/llm/*（prompt 人設）` · `src/lib/mock/bot*`（模擬用戶訊息裡的「月老」稱呼）· `prisma/seed.ts`＋`personas.ts`（種子 tagline）· `README.md` · `tests/demo.spec.ts`（文案斷言）

---

## 11. 待決問題（需要產品負責人拍板）

1. **市場**：台灣首發還是繁中圈一起？金流（綠界/藍新 vs Stripe）？
2. **免費/付費界線**：免費每月幾次出擊？付費買什麼（候選數 vs 分析深度）？
3. **真人供給冷啟動**：先做校園/社群種子，還是買量？agent 訪談能否變成 SEO 內容（「你的戀愛檔案測驗」）？
4. **時間節奏**：每日一次「月老晨報」還是隨按隨查？
5. **A2A 開放性**：未來是否讓第三方 agent（如別的交友 app）能跟我們的月老協商？這會決定要不要做 Agent Card 標準化。
