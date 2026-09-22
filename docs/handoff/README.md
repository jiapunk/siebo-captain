# 交接文件索引：從 Surrodate 拆成兩個獨立產品

> 決策：**拆開開發**。共用同一套「代理人協商引擎」，但產品定位、TA、信任模型、GTM 完全不同，硬放在同一個 repo 只會互相牽制。
>
> 拆分日期：2026-09-18 ｜ 文件版本：v1

## 兩個產品

| | 🔮 賽博月老（約會局） | 🧊 賽博隊長（組隊局） |
|---|---|---|
| 一句話 | 你的月老先替你去相親，過關才見面 | 你的隊長先替你去破冰，聊得來才組隊 |
| 核心痛點 | 社恐不敢開口、沒時間篩選 | 一群人報名後互不認識、開場最難 |
| 交接型態 | 一對一聊天室 | N 對 N 團隊群聊 |
| 信任模型 | 情感隱私、分享權限 | 技能真實性、可驗證作品 |
| GTM | 消費者訂閱、社群傳播 | 黑客松主辦方、校園社群、企業活動 |
| 代號 | `siebo-yuelao` | `siebo-captain` |

## 三份文件怎麼用

1. **[HANDOFF-dating.md](./HANDOFF-dating.md)** — 賽博月老完整交接（產品、功能、架構、路線圖、demo 腳本）
2. **[HANDOFF-hackathon.md](./HANDOFF-hackathon.md)** — 賽博隊長完整交接（以「破冰優先」重新定位的產品設計）
3. 本文件 — 共用引擎說明、拆分步驟、兩邊各要搬哪些檔案

## 共用引擎（兩邊都需要的核心）

「訪談 → 代理人協商 → 雙向閘門 → 交接」這條管線是兩個產品共同的心臟。拆分時**兩邊各自複製一份**（複製而非共用套件，先求開發速度；未來穩定後再抽成 `@siebo/engine`）：

```
src/lib/domains.ts        # Domain Pack 設定（標籤/題庫/維度/指引）
src/lib/types.ts          # AnyProfile / MatchReport / RunEvent 等型別
src/lib/profile.ts        # 分享權限投影（publicProfile）
src/lib/matching.ts       # 配對引擎：候選選擇、對聊、評分、事件流
src/lib/llm/              # mock 腳本引擎 + real provider（OpenCode Go）
src/lib/bus.ts            # EventEmitter 匯流排
src/lib/sse.ts            # SSE Response 工廠
src/lib/db.ts             # Prisma singleton
src/lib/session.ts        # cookie 身分（demo 用，上線要換真 Auth）
src/lib/client.tsx        # fetch helper / useMe / useUserBus
src/components/           # AppHeader / Icons / ScoreRing / RunStream
```

### 拆分步驟（每個新專案）

```bash
# 1. 複製專案為新目錄
cp -R surrodate ../siebo-captain   # 以組隊為例
cd ../siebo-captain
rm -rf node_modules .next .next-test dev.db prisma/migrations

# 2. 依下方「檔案取捨」刪除不屬於該產品的檔案
# 3. 改品牌字串（見各交接文件的「品牌資產清單」）
# 4. 重建資料庫
npm i && npx prisma migrate dev --name init && npm run db:seed
```

### 檔案取捨

| 檔案／目錄 | 賽博月老 | 賽博隊長 | 說明 |
|---|---|---|---|
| `lib/teamAssembler.ts`, `lib/teamBot.ts` | ❌ 刪 | ✅ 留 | N 對 N 聯盟形成、團隊模擬隊友 |
| `app/teams/*`, `app/team/[id]/*`, `api/teams/*` | ❌ 刪 | ✅ 留 | 隊伍提案與群聊 |
| `app/matches/*`, `app/chat/[id]/*`, `api/matches/*`, `api/chat/*` | ✅ 留 | ❌ 刪 | 一對一配對與聊天 |
| `lib/bot.ts`（一對一聊天回覆） | ✅ 留 | ❌ 刪（由 teamBot 取代） | |
| `prisma` 的 `Match`/`Message` models | ✅ 留 | ❌ 刪 | |
| `prisma` 的 `Team`/`TeamMember`/`TeamMessage` | ❌ 刪 | ✅ 留 | |
| `lib/personas.ts` | 只留 dating 人設 | 只留 hacker 人設 | 兩邊都要重寫品牌種子 |
| `app/page.tsx` 的 domain 分頁切換 | 移除，直接單一 landing | 移除 | |
| `tests/demo.spec.ts` | ✅ 留 | ❌ | |
| `tests/hackathon.spec.ts` | ❌ | ✅ 留 | |
| `domains.ts` | 只留 `dating` pack | 只留 `hackathon` pack | 型別可簡化 |

> 小提醒：拆分後建議把 `DomainId` union 拿掉、直接寫死單一 pack，讓型別更單純。

## 共用決策紀錄（為什麼是現在這樣）

- **為什麼用「代理人協商」而不是表單＋演算法**：真正的篩選發生在軟性訊號（價值觀、協作風格、靠譜度），這些只有「一問一答」問得出來；而且代理人問比本人問不尷尬。
- **為什麼是雙向閘門（雙方 ≥ 70/60 分）**：避免單方騷擾，也讓「被過濾」有台階下（是雙方的 agent 的判斷，不是人的拒絕）。
- **為什麼保留逐字稿與評分**：透明是信任的來源；報告可回放也是產品最好的傳播素材。
- **為什麼 mock 模式是預設測試路徑**：E2E 零成本、零延遲、確定性；真 LLM 走 OpenCode Go 訂閱。

## 兩邊共同的下一步（拆分後各自執行）

1. 換真 Auth（目前 cookie 選身分只是 demo 機制）
2. 檢舉/封鎖與內容安全
3. 通知系統（web push / email）
4. 部署（Vercel + 托管 SQLite→Postgres）
5. 觀測（LLM 成本、配對成功率、留存）

---

*有任何一項交接上的模糊地帶，直接看對應文件的「待決問題」章節；那裡列的是「還沒決定的事」，不是「沒寫完的事」。*

---

## 後續演進（2026-09-22，拆分後新增）

> 拆分後兩站各自長出完整能力的紀錄；細節見各 repo README 的 P0–P3 章節。

### 共同引擎（兩站都有）
- **P0 蜂群 Part 底座**：原子拆分、每個 part 隔離執行、per-part 重試、覆蓋率/保留率可稽核（`PARTS 6/6 · RETAIN 100%`）
- **決策層三段鏈**：Jev → LLM → 本地規則，逐題 fallback + 斷路器；每份報告附 `決策 // JEV · 規則 X → Y Δ` 對照
- **四語系**：繁中 / 简中 / EN / 日本語（UI 與動態內容）

### 賽博隊長（siebo-captain）
- **P1 假設評估式組隊**：`team_eval` 併發隔離評估、硬約束（角色缺口/死局）、不重疊貪婪選隊
- **P2 Agent Ledger + 能力加權 + 合作網絡圖**：行為記帳→能力分；`ASSEMBLY_SIGNAL=competence`（互盤 0.75＋帳本 0.25）；網絡聚類/樞紐＋社交 vs 能力雙信號模擬
- **P3 EvoMap GEP-A2A（opt-in）**：節點註冊、Gene+Capsule+EvolutionEvent 發佈（v1→v2）、`fetch` 學習 promoted 基因、`evomap:status` 儀表板、launchd 心跳

### 賽博月老（surrodate）
- **P2 互動回饋記憶**：見面回饋→代理人記憶→下次配對權重（Jev state 或規則層加權）
- **P2.5 見面後續約閉環**：正向回饋→Jev 挑第二次約會企劃→接受→聊天室置頂
- **P2.6 第二次約會回饋**：`Feedback.round=2`，權重 ×2，記憶曲線第二段

### Demo 與運維
- 兩站 10 分鐘評審動線：`~/Documents/DEMO.md`
- `demo:snapshot` / `demo:restore`：demo 資料 SQLite 一致性快照
