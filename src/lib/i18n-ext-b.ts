/**
 * i18n 擴充字典 B（前端組 B 專用）。
 * 新增的 key 只寫在這裡，不要改 i18n-dict.ts 主字典；合併時 ext 會覆蓋主字典同名 key。
 * 四個語系都要補齊（cn = 簡體中文）。
 *
 * 命名：新 key 一律 b.* 開頭（避免跟 EXT_A 撞名）；沒有 b. 前綴的是「覆蓋主字典」的既有 key，
 * 用來修正與實際行為不符的文案（分享範圍、GitHub 比對、聊天室外送 AI、邀請／同意流程）。
 */
import type { Locale } from "./i18n-dict";

export const EXT_B: Record<Locale, Record<string, string>> = {
  zh: {
    // ---- 覆蓋主字典：修正不實或過時的說法 ----
    "prof.exposureHint":
      "關閉的欄位不會出現在其他參賽者與他們的隊長看得到的內容裡（互盤逐字稿、報告、破冰卡、組隊提案）。注意：你的訪談與檔案仍會交給本服務使用的第三方 AI（例如 DeepSeek、Jev）處理——分享範圍控制的是「其他參賽者」看得到什麼，不是 AI 供應商。",
    "prof.nogo": "合作地雷（預設不公開）",
    "prof.verify": "GitHub 公開資料比對（技能防誇大）",
    "prof.vfVerified": "公開資料比對 @{u}",
    "prof.ghHint":
      "只比對這個 GitHub 帳號的公開資料（主要語言、公開專案數），不證明帳號屬於你。對方隊長會在互盤時看到比對結果。",
    "pcard.verified": "GITHUB 公開資料",
    "conn.direct":
      "DIRECT CHANNEL // 只有你們兩人看得到；對象是 AI 模擬隊友時，最近 20 則訊息會送到 AI 供應商生成回覆",
    "conn.lockedDesc": "等對方接受邀請後即可開啟。",
    "tc.secure":
      "SECURE CHANNEL // 只有隊伍成員看得到；隊伍中有 AI 模擬隊友時，最近 20 則訊息會送到 AI 供應商生成回覆",
    "tc.lockedDesc": "所有真人隊友都按下「加入這隊」後，聊天室就會開啟。",

    // ---- 頁面 metadata ----
    "b.meta.title": "賽博隊長 · 黑客松破冰組隊 | SIEBO CAPTAIN",
    "b.meta.desc":
      "黑客松最難的不是寫 Code，是開場十分鐘沒人講話。你的專屬隊長先替你去破冰：技能互補、目標一致、投入時間對得上，才推薦成隊伍。",

    // ---- 通用 ----
    "b.listSep": "、",
    "b.retry": "重試",
    "b.loading": "載入中…",
    "b.cancel": "取消",

    // ---- API 錯誤碼 ----
    "b.err.generic": "發生問題，請稍後再試。",
    "b.err.rateLimited": "操作太頻繁了，請稍後再試。",
    "b.err.rateLimitedSec": "操作太頻繁了，請 {sec} 秒後再試。",
    "b.err.unauthorized": "身分已失效，請回首頁重新選擇或登入。",
    "b.err.inProgress": "上一個請求還在處理，請稍候。",
    "b.err.alreadyRunning": "上一輪還在進行，完成後再試。",
    "b.err.contentTooLong": "內容太長了，最多 {max} 字。",
    "b.err.interviewTooLong": "訪談回答已達上限，請直接完成訪談。",
    "b.err.forbidden": "你沒有權限查看或操作這個項目。",
    "b.err.locked": "這裡還不能傳訊息。",
    "b.err.notFound": "找不到這個項目，可能已被刪除。",
    "b.err.payloadTooLarge": "送出的內容太大了。",
    "b.err.tooManyStreams": "開啟的即時連線太多，請關掉其他分頁再試。",
    "b.err.badOrigin": "請求來源不符，請重新整理頁面後再試。",
    "b.err.network": "連線失敗，請檢查網路後再試。",
    "b.err.notInvitee": "只有被邀請的一方可以接受。",

    // ---- 身分切換（只剩示範身分） ----
    "b.identity.errSessionActive": "你已用真帳號登入；要切換示範身分，請先登出。",
    "b.identity.errNotDemo": "這不是示範身分，請從登入頁用 Email 登入。",
    "b.identity.errDemoOff": "示範身分切換已關閉，請用 Email 註冊或登入。",
    "b.identity.sessionNote": "你正在使用真帳號。示範身分只能在登出後切換。",
    "b.identity.demoHint":
      "這裡只列示範身分（沒有 Email、密碼，任何人都能切換）。真帳號請從登入頁登入。",
    "b.identity.toLogin": "前往登入 →",
    "b.landing.demoOnly":
      "名冊只列示範身分：沒有 Email、密碼，任何人都能點進去。真帳號不會出現在這裡，請從登入頁登入。",

    // ---- 登入／驗證 ----
    "b.auth.resendSent": "已送出驗證信申請（本 demo 尚未接 Email 服務）。",
    "b.auth.forgotAck":
      "已收到申請。如果這個 Email 有帳號，會寄出重設連結（本 demo 尚未接 Email 服務）。",
    "b.auth.pwMismatch": "兩次輸入的密碼不一致。",

    // ---- 手機底部 Dock（短標籤） ----
    "b.dock.aria": "主要導覽",
    "b.dock.ops": "我的隊長",
    "b.dock.radar": "破冰雷達",
    "b.dock.squad": "隊伍",
    "b.dock.compare": "對照",
    "b.dock.id": "我的檔案",

    // ---- 訪談前的隱私告知 ----
    "b.onb.privacyTitle": "開始前，先說清楚你的資料會去哪",
    "b.onb.privacyAi":
      "你的回答會送到本服務使用的第三方 AI 服務（例如 DeepSeek、Jev）處理，用來產生隊長的提問與你的選手檔案；這些服務的伺服器可能位於你所在地區以外。",
    "b.onb.privacyScope":
      "「分享範圍」控制的是其他參賽者與他們的隊長看得到什麼，不會阻止上述 AI 服務處理你的資料。",
    "b.onb.privacyDelete": "你可以隨時在「我的檔案」刪除帳號與所有資料。",
    "b.onb.privacyMock": "目前是展示模式：回答由內建腳本處理，不會送到外部 AI。",
    "b.onb.agree": "我已了解，並同意以上處理方式。",
    "b.onb.start": "開始訪談",
    "b.onb.privacyRetention":
      "訪談原文只用來編譯你的選手檔案，編譯完成就刪除（只留下你同意的時間）；活動結束 30 天後，所有參賽者帳號與相關資料會一併清除。",
    "b.onb.consentRequired": "請先閱讀上面的說明並勾選同意，才能開始訪談。",

    // ---- 持續聯絡（邀請／接受） ----
    "b.conn.missing": "找不到這個聯絡",
    "b.conn.missingDesc": "它可能已被刪除，或你不是這段聯絡的當事人。",
    "b.conn.incomingTitle": "{name} 想跟你保持聯絡",
    "b.conn.incomingDesc": "接受後雙方就能開始私訊。",
    "b.conn.pendingOutgoing": "已送出邀請，等待 {name} 接受。對方接受後這裡就會開啟。",
    "b.conn.accept": "接受邀請",
    "b.conn.incomingShort": "待你接受",
    "b.conn.outgoingShort": "等待對方接受",

    // ---- 組隊同意 ----
    "b.team.missing": "找不到這支隊伍",
    "b.team.missingDesc": "提案可能已被收回（有成員加入了別隊），或你不是成員。",
    "b.team.waitingFor": "你已同意，等待 {names} 同意",
    "b.team.botAccepted": "AI 隊友 · 已同意",
    "b.team.accepted": "已同意 ✓",
    "b.team.pending": "等待同意",
    "b.team.unknownSender": "未知成員",

    // ---- 合作網絡面板 ----
    "b.net.title": "合作網絡",
    "b.net.simDesc": "同一批 {n} 組假設、兩種選人信號",
    "b.net.social": "社交模式",
    "b.net.competence": "能力模式",
    "b.net.edgesCross": "{edges} 條邊 · 跨群 {cross}",
    "b.net.simNote":
      "聚類越低＝越願意跨圈層連結（EvoX 實驗二：0.53 → 0.28）。切換 ASSEMBLY_SIGNAL 環境變數可改變正式組隊信號。",

    // ---- 我的檔案 ----
    "b.prof.fNickname": "暱稱",
    "b.prof.fVibe": "風格標語",
    "b.prof.cardErr": "選手卡產生失敗，請稍後再試。",
    "b.prof.errInvalid": "「{field}」格式不符或太長，請修改後再儲存。",
    "b.prof.cardScope":
      "匯出選手卡時，只會畫出上方開啟（ON）的欄位；暱稱、風格標語與簡介一律會出現在卡片上。",
    "b.prof.removeChip": "移除「{v}」",
    "b.prof.addChipAria": "新增{field}",
    "b.gh.errInvalid": "請輸入 GitHub 使用者名稱，例如 torvalds。",
    "b.gh.errProfile": "請先完成隊長訪談，再比對 GitHub。",
    "b.gh.errRate": "GitHub 暫時限制查詢次數，請稍後再試。",
    "b.gh.errRateSec": "GitHub 暫時限制查詢次數，請 {sec} 秒後再試。",
    "b.gh.ownership": "只比對公開資料，不證明帳號屬於你",
    "b.gh.repos": "公開專案 {n} 個，主要語言：{langs}。",
    "b.gh.noRepos": "這個帳號沒有公開專案。",
    "b.gh.matched": "技能主張相符：{list}。",
    "b.gh.unmatched": "主要語言中找不到對應：{list}——建議面談時確認。",
    "b.gh.unverifiable": "無法由 GitHub 判斷：{list}（非程式語言技能）。",
    "b.del.title": "刪除我的帳號與資料",
    "b.del.desc":
      "永久刪除你的帳號、選手檔案與訪談、互盤紀錄、破冰卡、持續聯絡（含私訊）與你在隊伍聊天室的發言，無法復原。",
    "b.del.seed":
      "示範固定角色（種子角色／AI 模擬隊友）不能刪除；自己建立的示範身分與 Email 帳號可以。",
    "b.del.button": "刪除我的帳號與資料",
    "b.del.confirm": "確定要永久刪除嗎？這個動作無法復原。",
    "b.del.confirmBtn": "確認永久刪除",
    "b.del.deleting": "刪除中…",
  },

  cn: {
    "prof.exposureHint":
      "关闭的栏位不会出现在其他参赛者与他们的队长看得到的内容里（互盘逐字稿、报告、破冰卡、组队提案）。注意：你的访谈与文件仍会交给本服务使用的第三方 AI（例如 DeepSeek、Jev）处理——分享范围控制的是「其他参赛者」看得到什么，不是 AI 供应商。",
    "prof.nogo": "合作地雷（默认不公开）",
    "prof.verify": "GitHub 公开数据比对（技能防夸大）",
    "prof.vfVerified": "公开数据比对 @{u}",
    "prof.ghHint":
      "只比对这个 GitHub 账号的公开数据（主要语言、公开项目数），不证明账号属于你。对方队长会在互盘时看到比对结果。",
    "pcard.verified": "GITHUB 公开数据",
    "conn.direct":
      "DIRECT CHANNEL // 只有你们两人看得到；对象是 AI 模拟队友时，最近 20 条消息会发送到 AI 供应商生成回复",
    "conn.lockedDesc": "等对方接受邀请后即可开启。",
    "tc.secure":
      "SECURE CHANNEL // 只有队伍成员看得到；队伍中有 AI 模拟队友时，最近 20 条消息会发送到 AI 供应商生成回复",
    "tc.lockedDesc": "所有真人队友都按下「加入这队」后，聊天室就会开启。",

    "b.meta.title": "赛博队长 · 黑客松破冰组队 | SIEBO CAPTAIN",
    "b.meta.desc":
      "黑客松最难的不是写 Code，是开场十分钟没人讲话。你的专属队长先替你去破冰：技能互补、目标一致、投入时间对得上，才推荐成队伍。",

    "b.listSep": "、",
    "b.retry": "重试",
    "b.loading": "加载中…",
    "b.cancel": "取消",

    "b.err.generic": "出了点问题，请稍后再试。",
    "b.err.rateLimited": "操作太频繁了，请稍后再试。",
    "b.err.rateLimitedSec": "操作太频繁了，请 {sec} 秒后再试。",
    "b.err.unauthorized": "身份已失效，请回首页重新选择或登录。",
    "b.err.inProgress": "上一个请求还在处理，请稍候。",
    "b.err.alreadyRunning": "上一轮还在进行，完成后再试。",
    "b.err.contentTooLong": "内容太长了，最多 {max} 字。",
    "b.err.interviewTooLong": "访谈回答已达上限，请直接完成访谈。",
    "b.err.forbidden": "你没有权限查看或操作这个项目。",
    "b.err.locked": "这里还不能发消息。",
    "b.err.notFound": "找不到这个项目，可能已被删除。",
    "b.err.payloadTooLarge": "发送的内容太大了。",
    "b.err.tooManyStreams": "打开的实时连接太多，请关掉其他标签页再试。",
    "b.err.badOrigin": "请求来源不符，请刷新页面后再试。",
    "b.err.network": "连接失败，请检查网络后再试。",
    "b.err.notInvitee": "只有被邀请的一方可以接受。",

    "b.identity.errSessionActive": "你已用真账号登录；要切换示范身分，请先退出登录。",
    "b.identity.errNotDemo": "这不是示范身分，请从登录页用 Email 登录。",
    "b.identity.errDemoOff": "示范身分切换已关闭，请用 Email 注册或登录。",
    "b.identity.sessionNote": "你正在使用真账号。示范身分只能在退出登录后切换。",
    "b.identity.demoHint":
      "这里只列示范身分（没有 Email、密码，任何人都能切换）。真账号请从登录页登录。",
    "b.identity.toLogin": "前往登录 →",
    "b.landing.demoOnly":
      "名册只列示范身分：没有 Email、密码，任何人都能点进去。真账号不会出现在这里，请从登录页登录。",

    "b.auth.resendSent": "已提交验证邮件申请（本 demo 尚未接入邮件服务）。",
    "b.auth.forgotAck":
      "已收到申请。如果这个 Email 有账号，会发送重置链接（本 demo 尚未接入邮件服务）。",
    "b.auth.pwMismatch": "两次输入的密码不一致。",

    "b.dock.aria": "主要导航",
    "b.dock.ops": "我的队长",
    "b.dock.radar": "破冰雷达",
    "b.dock.squad": "队伍",
    "b.dock.compare": "对比",
    "b.dock.id": "我的文件",

    "b.onb.privacyTitle": "开始前，先说清楚你的数据会去哪",
    "b.onb.privacyAi":
      "你的回答会发送到本服务使用的第三方 AI 服务（例如 DeepSeek、Jev）处理，用来生成队长的提问与你的选手文件；这些服务的服务器可能位于你所在地区以外。",
    "b.onb.privacyScope":
      "「分享范围」控制的是其他参赛者与他们的队长看得到什么，不会阻止上述 AI 服务处理你的数据。",
    "b.onb.privacyDelete": "你可以随时在「我的文件」删除账号与所有数据。",
    "b.onb.privacyMock": "目前是展示模式：回答由内置脚本处理，不会发送到外部 AI。",
    "b.onb.agree": "我已了解，并同意以上处理方式。",
    "b.onb.start": "开始访谈",
    "b.onb.privacyRetention":
      "访谈原文只用来编译你的选手文件，编译完成就删除（只留下你同意的时间）；活动结束 30 天后，所有参赛者账号与相关数据会一并清除。",
    "b.onb.consentRequired": "请先阅读上面的说明并勾选同意，才能开始访谈。",

    "b.conn.missing": "找不到这个联系",
    "b.conn.missingDesc": "它可能已被删除，或你不是这段联系的当事人。",
    "b.conn.incomingTitle": "{name} 想跟你保持联系",
    "b.conn.incomingDesc": "接受后双方就能开始私信。",
    "b.conn.pendingOutgoing": "已发送邀请，等待 {name} 接受。对方接受后这里就会开启。",
    "b.conn.accept": "接受邀请",
    "b.conn.incomingShort": "待你接受",
    "b.conn.outgoingShort": "等待对方接受",

    "b.team.missing": "找不到这支队伍",
    "b.team.missingDesc": "提案可能已被收回（有成员加入了别队），或你不是成员。",
    "b.team.waitingFor": "你已同意，等待 {names} 同意",
    "b.team.botAccepted": "AI 队友 · 已同意",
    "b.team.accepted": "已同意 ✓",
    "b.team.pending": "等待同意",
    "b.team.unknownSender": "未知成员",

    "b.net.title": "合作网络",
    "b.net.simDesc": "同一批 {n} 组假设、两种选人信号",
    "b.net.social": "社交模式",
    "b.net.competence": "能力模式",
    "b.net.edgesCross": "{edges} 条边 · 跨群 {cross}",
    "b.net.simNote":
      "聚类越低＝越愿意跨圈层连结（EvoX 实验二：0.53 → 0.28）。切换 ASSEMBLY_SIGNAL 环境变量可改变正式组队信号。",

    "b.prof.fNickname": "昵称",
    "b.prof.fVibe": "风格标语",
    "b.prof.cardErr": "选手卡生成失败，请稍后再试。",
    "b.prof.errInvalid": "「{field}」格式不符或太长，请修改后再保存。",
    "b.prof.cardScope":
      "导出选手卡时，只会画出上方开启（ON）的栏位；昵称、风格标语与简介一律会出现在卡片上。",
    "b.prof.removeChip": "移除「{v}」",
    "b.prof.addChipAria": "新增{field}",
    "b.gh.errInvalid": "请输入 GitHub 用户名，例如 torvalds。",
    "b.gh.errProfile": "请先完成队长访谈，再比对 GitHub。",
    "b.gh.errRate": "GitHub 暂时限制查询次数，请稍后再试。",
    "b.gh.errRateSec": "GitHub 暂时限制查询次数，请 {sec} 秒后再试。",
    "b.gh.ownership": "只比对公开数据，不证明账号属于你",
    "b.gh.repos": "公开项目 {n} 个，主要语言：{langs}。",
    "b.gh.noRepos": "这个账号没有公开项目。",
    "b.gh.matched": "技能主张相符：{list}。",
    "b.gh.unmatched": "主要语言中找不到对应：{list}——建议面谈时确认。",
    "b.gh.unverifiable": "无法由 GitHub 判断：{list}（非编程语言技能）。",
    "b.del.title": "删除我的账号与数据",
    "b.del.desc":
      "永久删除你的账号、选手文件与访谈、互盘记录、破冰卡、持续联系（含私信）与你在队伍聊天室的发言，无法恢复。",
    "b.del.seed":
      "示范固定角色（种子角色／AI 模拟队友）不能删除；自己建立的示范身分与 Email 账号可以。",
    "b.del.button": "删除我的账号与数据",
    "b.del.confirm": "确定要永久删除吗？这个操作无法恢复。",
    "b.del.confirmBtn": "确认永久删除",
    "b.del.deleting": "删除中…",
  },

  en: {
    "prof.exposureHint":
      "Fields set to OFF never appear in what other participants and their captains see (match transcripts, reports, icebreaker cards, squad proposals). Note: your interview and profile are still processed by the third-party AI services this app uses (e.g. DeepSeek, Jev) — sharing scope controls what other participants see, not the AI providers.",
    "prof.nogo": "NO-GO (private by default)",
    "prof.verify": "GitHub public-data check",
    "prof.vfVerified": "PUBLIC DATA MATCHED @{u}",
    "prof.ghHint":
      "Compares this GitHub account's public data only (top languages, public repos) — it doesn't prove the account is yours. Other captains see the result during cross-check.",
    "pcard.verified": "GITHUB PUBLIC DATA",
    "conn.direct":
      "DIRECT CHANNEL // only you two can see this; with an AI teammate, the last 20 messages are sent to the AI provider to generate replies",
    "conn.lockedDesc": "Opens once they accept your invite.",
    "tc.secure":
      "SECURE CHANNEL // members only; if the squad has AI teammates, the last 20 messages are sent to the AI provider to generate replies",
    "tc.lockedDesc": "The chat opens once every human member presses “Join this squad”.",

    "b.meta.title": "SIEBO CAPTAIN · Hackathon icebreaking & team-up",
    "b.meta.desc":
      "The hardest part of a hackathon isn't the code — it's the first ten silent minutes. Your AI Captain breaks the ice first and only recommends a squad when skills, goals and time commitment line up.",

    "b.listSep": ", ",
    "b.retry": "Retry",
    "b.loading": "Loading…",
    "b.cancel": "Cancel",

    "b.err.generic": "Something went wrong. Please try again.",
    "b.err.rateLimited": "Too many requests. Please try again shortly.",
    "b.err.rateLimitedSec": "Too many requests. Try again in {sec}s.",
    "b.err.unauthorized": "Your session has expired. Go back home to pick an ID or sign in.",
    "b.err.inProgress": "Still processing your previous request — hang on.",
    "b.err.alreadyRunning": "The previous round is still running.",
    "b.err.contentTooLong": "Too long — {max} characters max.",
    "b.err.interviewTooLong": "The interview has reached its answer limit. Please finish it.",
    "b.err.forbidden": "You don't have access to this.",
    "b.err.locked": "Messaging isn't open here yet.",
    "b.err.notFound": "Not found — it may have been removed.",
    "b.err.payloadTooLarge": "That request is too large.",
    "b.err.tooManyStreams": "Too many live connections open. Close other tabs and retry.",
    "b.err.badOrigin": "Request origin rejected. Reload the page and try again.",
    "b.err.network": "Network error. Check your connection and retry.",
    "b.err.notInvitee": "Only the invited person can accept.",

    "b.identity.errSessionActive":
      "You're signed in with a real account. Log out first to switch to a demo ID.",
    "b.identity.errNotDemo": "That isn't a demo ID. Sign in with email on the login page.",
    "b.identity.errDemoOff": "Demo ID switching is turned off. Please sign up or sign in with email.",
    "b.identity.sessionNote": "You're using a real account. Demo IDs are available after you log out.",
    "b.identity.demoHint":
      "Only demo IDs are listed here (no email or password — anyone can switch to them). Real accounts sign in on the login page.",
    "b.identity.toLogin": "Go to sign in →",
    "b.landing.demoOnly":
      "The roster lists demo IDs only — no email or password, anyone can use them. Real accounts never appear here; sign in on the login page.",

    "b.auth.resendSent": "Verification requested (this demo has no email service yet).",
    "b.auth.forgotAck":
      "Request received. If an account exists for that email, a reset link will be sent (this demo has no email service yet).",
    "b.auth.pwMismatch": "Passwords don't match.",

    "b.dock.aria": "Main navigation",
    "b.dock.ops": "Captain",
    "b.dock.radar": "Radar",
    "b.dock.squad": "Squads",
    "b.dock.compare": "Compare",
    "b.dock.id": "Profile",

    "b.onb.privacyTitle": "Before we start: where your answers go",
    "b.onb.privacyAi":
      "Your answers are processed by third-party AI services this app uses (e.g. DeepSeek, Jev) to generate your captain's questions and your player profile. Their servers may be outside your region.",
    "b.onb.privacyScope":
      "“Sharing scope” controls what other participants and their captains can see; it doesn't stop the AI services above from processing your data.",
    "b.onb.privacyDelete": "You can delete your account and all its data anytime from your Profile.",
    "b.onb.privacyMock":
      "Sandbox mode right now: answers are handled by a built-in script and are not sent to any external AI.",
    "b.onb.agree": "I understand and agree to this processing.",
    "b.onb.start": "Start interview",
    "b.onb.privacyRetention":
      "Your interview transcript is only used to compile your player profile and is deleted once that's done (we keep only the time you agreed). 30 days after the event ends, all participant accounts and their data are deleted.",
    "b.onb.consentRequired": "Please read the notice above and tick the box to agree before starting the interview.",

    "b.conn.missing": "Contact not found",
    "b.conn.missingDesc": "It may have been removed, or you're not part of it.",
    "b.conn.incomingTitle": "{name} wants to keep in touch",
    "b.conn.incomingDesc": "Accept to start messaging each other.",
    "b.conn.pendingOutgoing":
      "Invite sent — waiting for {name} to accept. This chat opens once they do.",
    "b.conn.accept": "Accept",
    "b.conn.incomingShort": "NEEDS YOUR OK",
    "b.conn.outgoingShort": "WAITING",

    "b.team.missing": "Squad not found",
    "b.team.missingDesc":
      "The proposal may have been withdrawn (a member joined another squad), or you're not a member.",
    "b.team.waitingFor": "You're in — waiting for {names} to accept",
    "b.team.botAccepted": "AI · ACCEPTED",
    "b.team.accepted": "ACCEPTED ✓",
    "b.team.pending": "PENDING",
    "b.team.unknownSender": "UNKNOWN",

    "b.net.title": "Collaboration network",
    "b.net.simDesc": "same {n} hypotheses, two selection signals",
    "b.net.social": "Social",
    "b.net.competence": "Competence",
    "b.net.edgesCross": "{edges} edges · cross-group {cross}",
    "b.net.simNote":
      "Lower clustering = more cross-circle links (EvoX experiment 2: 0.53 → 0.28). Set the ASSEMBLY_SIGNAL env var to change the live assembly signal.",

    "b.prof.fNickname": "Nickname",
    "b.prof.fVibe": "Vibe",
    "b.prof.cardErr": "Couldn't render the player card. Please try again.",
    "b.prof.errInvalid": "“{field}” is invalid or too long. Please fix it and save again.",
    "b.prof.cardScope":
      "The exported player card only shows fields set to ON above; nickname, vibe and bio always appear.",
    "b.prof.removeChip": "Remove “{v}”",
    "b.prof.addChipAria": "Add to {field}",
    "b.gh.errInvalid": "Enter a GitHub username, e.g. torvalds.",
    "b.gh.errProfile": "Finish the captain interview first.",
    "b.gh.errRate": "GitHub is rate-limiting lookups. Try again later.",
    "b.gh.errRateSec": "GitHub is rate-limiting lookups. Try again in {sec}s.",
    "b.gh.ownership": "PUBLIC DATA ONLY — ACCOUNT OWNERSHIP NOT VERIFIED",
    "b.gh.repos": "{n} public repos; top languages: {langs}.",
    "b.gh.noRepos": "No public repos on this account.",
    "b.gh.matched": "Matches claimed skills: {list}.",
    "b.gh.unmatched": "Not reflected in top languages: {list} — worth asking about.",
    "b.gh.unverifiable": "Can't be checked via GitHub: {list} (non-language skills).",
    "b.del.title": "Delete my account and data",
    "b.del.desc":
      "Permanently deletes your account, player profile and interview, match runs, icebreaker cards, contacts (including DMs) and your squad chat messages. This can't be undone.",
    "b.del.seed":
      "Built-in demo characters (seed IDs / AI teammates) can't be deleted; demo IDs you created and email accounts can.",
    "b.del.button": "Delete my account and data",
    "b.del.confirm": "Delete permanently? This can't be undone.",
    "b.del.confirmBtn": "Yes, delete permanently",
    "b.del.deleting": "Deleting…",
  },

  ja: {
    "prof.exposureHint":
      "オフにした項目は、他の参加者とその隊長が見る内容（マッチ記録・レポート・アイスブレイクカード・チーム提案）に表示されません。ただし、インタビューとプロフィールは本サービスが利用する第三者AI（例：DeepSeek、Jev）で処理されます。公開範囲が制御するのは他の参加者に見える内容で、AIプロバイダーではありません。",
    "prof.nogo": "NG事項（デフォルト非公開）",
    "prof.verify": "GitHub公開データ照合（スキル検証）",
    "prof.vfVerified": "公開データ照合 @{u}",
    "prof.ghHint":
      "このGitHubアカウントの公開データ（主な言語・公開リポジトリ数）だけを照合します。アカウントがあなたのものかは確認しません。結果は相手の隊長が交差チェック時に見ます。",
    "pcard.verified": "GITHUB 公開データ",
    "conn.direct":
      "DIRECT CHANNEL // 二人だけの回線。相手がAI模擬メンバーの場合、直近20件がAIプロバイダーに送信され返信が生成されます",
    "conn.lockedDesc": "相手が招待を承認すると開きます。",
    "tc.secure":
      "SECURE CHANNEL // メンバー限定。AI模擬メンバーがいる場合、直近20件がAIプロバイダーに送信され返信が生成されます",
    "tc.lockedDesc": "人間のメンバー全員が「このチームに参加」を押すとチャットが開きます。",

    "b.meta.title": "賽博隊長 · ハッカソンのアイスブレイク＆チーム編成 | SIEBO CAPTAIN",
    "b.meta.desc":
      "ハッカソンで一番難しいのはコードではなく、最初の10分の沈黙。あなた専属の隊長が先に他の参加者の隊長と話し、スキル・目標・稼働時間が噛み合う相手だけをチームとして推薦します。",

    "b.listSep": "、",
    "b.retry": "再試行",
    "b.loading": "読み込み中…",
    "b.cancel": "キャンセル",

    "b.err.generic": "問題が発生しました。しばらくしてから再試行してください。",
    "b.err.rateLimited": "操作が多すぎます。しばらくしてから再試行してください。",
    "b.err.rateLimitedSec": "操作が多すぎます。{sec} 秒後に再試行してください。",
    "b.err.unauthorized": "セッションが切れました。ホームでIDを選ぶかログインしてください。",
    "b.err.inProgress": "前のリクエストを処理中です。少々お待ちください。",
    "b.err.alreadyRunning": "前のラウンドがまだ進行中です。",
    "b.err.contentTooLong": "長すぎます（最大 {max} 文字）。",
    "b.err.interviewTooLong": "回答数の上限に達しました。インタビューを完了してください。",
    "b.err.forbidden": "この項目へのアクセス権がありません。",
    "b.err.locked": "ここではまだメッセージを送れません。",
    "b.err.notFound": "見つかりません（削除された可能性があります）。",
    "b.err.payloadTooLarge": "送信内容が大きすぎます。",
    "b.err.tooManyStreams": "リアルタイム接続が多すぎます。他のタブを閉じて再試行してください。",
    "b.err.badOrigin": "リクエスト元が一致しません。ページを再読み込みしてください。",
    "b.err.network": "通信に失敗しました。接続を確認して再試行してください。",
    "b.err.notInvitee": "招待された側だけが承認できます。",

    "b.identity.errSessionActive":
      "本アカウントでログイン中です。デモIDに切り替えるには先にログアウトしてください。",
    "b.identity.errNotDemo": "これはデモIDではありません。ログインページからメールでログインしてください。",
    "b.identity.errDemoOff": "デモID切替は無効です。メールで登録またはログインしてください。",
    "b.identity.sessionNote": "本アカウントを使用中です。デモIDはログアウト後に切り替えられます。",
    "b.identity.demoHint":
      "ここにはデモID（メール・パスワードなし、誰でも切替可）だけが表示されます。本アカウントはログインページから。",
    "b.identity.toLogin": "ログインへ →",
    "b.landing.demoOnly":
      "名簿はデモIDのみ（メール・パスワードなし、誰でも利用可）。本アカウントはここに表示されません。ログインページからログインしてください。",

    "b.auth.resendSent": "確認メールをリクエストしました（このデモにはメール送信機能がありません）。",
    "b.auth.forgotAck":
      "受け付けました。アカウントが存在する場合はリセットリンクを送信します（このデモにはメール送信機能がありません）。",
    "b.auth.pwMismatch": "パスワードが一致しません。",

    "b.dock.aria": "メインナビゲーション",
    "b.dock.ops": "隊長",
    "b.dock.radar": "レーダー",
    "b.dock.squad": "チーム",
    "b.dock.compare": "対照",
    "b.dock.id": "プロフィール",

    "b.onb.privacyTitle": "はじめる前に：回答データの行き先",
    "b.onb.privacyAi":
      "回答は本サービスが利用する第三者のAIサービス（例：DeepSeek、Jev）で処理され、隊長の質問と選手プロフィールの生成に使われます。サーバーはお住まいの地域外にある場合があります。",
    "b.onb.privacyScope":
      "「公開範囲」は他の参加者とその隊長に見える内容を制御するもので、上記AIサービスによる処理は止めません。",
    "b.onb.privacyDelete": "「プロフィール」からいつでもアカウントと全データを削除できます。",
    "b.onb.privacyMock":
      "現在はデモモードです：回答は内蔵スクリプトで処理され、外部AIには送信されません。",
    "b.onb.agree": "内容を理解し、上記の処理に同意します。",
    "b.onb.start": "インタビュー開始",
    "b.onb.privacyRetention":
      "インタビューの原文は選手プロフィールの生成にだけ使い、生成が終わると削除します（同意した日時のみ残ります）。イベント終了から30日後に、すべての参加者アカウントと関連データを削除します。",
    "b.onb.consentRequired": "上の説明を読み、同意にチェックしてからインタビューを始めてください。",

    "b.conn.missing": "連絡先が見つかりません",
    "b.conn.missingDesc": "削除されたか、あなたが当事者ではない可能性があります。",
    "b.conn.incomingTitle": "{name} さんがつながりを希望しています",
    "b.conn.incomingDesc": "承認するとメッセージをやり取りできます。",
    "b.conn.pendingOutgoing": "招待を送りました。{name} さんの承認待ちです。承認されるとここが開きます。",
    "b.conn.accept": "承認する",
    "b.conn.incomingShort": "あなたの承認待ち",
    "b.conn.outgoingShort": "相手の承認待ち",

    "b.team.missing": "チームが見つかりません",
    "b.team.missingDesc":
      "提案が取り下げられた（メンバーが別チームに参加した）か、あなたがメンバーではない可能性があります。",
    "b.team.waitingFor": "参加済み。{names} さんの同意待ち",
    "b.team.botAccepted": "AI · 同意済み",
    "b.team.accepted": "同意済み ✓",
    "b.team.pending": "同意待ち",
    "b.team.unknownSender": "不明なメンバー",

    "b.net.title": "協働ネットワーク",
    "b.net.simDesc": "同じ {n} 通りの仮説・2種類の選抜シグナル",
    "b.net.social": "ソーシャル",
    "b.net.competence": "能力",
    "b.net.edgesCross": "辺 {edges} · 越境 {cross}",
    "b.net.simNote":
      "クラスタ係数が低いほど、異なる輪をまたいでつながる（EvoX 実験2：0.53 → 0.28）。ASSEMBLY_SIGNAL 環境変数で本番の編成シグナルを切り替えられます。",

    "b.prof.fNickname": "ニックネーム",
    "b.prof.fVibe": "キャッチコピー",
    "b.prof.cardErr": "選手カードを生成できませんでした。しばらくしてから再試行してください。",
    "b.prof.errInvalid": "「{field}」の形式が正しくないか長すぎます。修正して保存してください。",
    "b.prof.cardScope":
      "書き出す選手カードには、上で ON の項目だけが描かれます（ニックネーム・キャッチコピー・自己紹介は常に表示）。",
    "b.prof.removeChip": "「{v}」を削除",
    "b.prof.addChipAria": "{field}を追加",
    "b.gh.errInvalid": "GitHub のユーザー名を入力してください（例：torvalds）。",
    "b.gh.errProfile": "先に隊長インタビューを完了してください。",
    "b.gh.errRate": "GitHub の回数制限中です。しばらくしてから再試行してください。",
    "b.gh.errRateSec": "GitHub の回数制限中です。{sec} 秒後に再試行してください。",
    "b.gh.ownership": "公開データのみ照合・アカウント所有は未確認",
    "b.gh.repos": "公開リポジトリ {n} 件、主な言語：{langs}。",
    "b.gh.noRepos": "公開リポジトリはありません。",
    "b.gh.matched": "スキル申告と一致：{list}。",
    "b.gh.unmatched": "主要言語に見当たらない：{list}——面談で確認を。",
    "b.gh.unverifiable": "GitHub では判断不可：{list}（言語以外のスキル）。",
    "b.del.title": "アカウントとデータを削除",
    "b.del.desc":
      "アカウント、選手プロフィールとインタビュー、マッチ記録、アイスブレイクカード、つながり（DMを含む）、チームチャットでのあなたの発言を完全に削除します。元に戻せません。",
    "b.del.seed":
      "固定のデモキャラクター（シードID／AI模擬メンバー）は削除できません。自分で作ったデモIDとメールアカウントは削除できます。",
    "b.del.button": "アカウントとデータを削除",
    "b.del.confirm": "完全に削除しますか？元に戻せません。",
    "b.del.confirmBtn": "完全に削除する",
    "b.del.deleting": "削除中…",
  },
};
