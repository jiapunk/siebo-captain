import type { Locale } from "./i18n-dict";

/** 動態內容包：隊長訪談、互盤對談、報告、破冰卡、團隊訊息、引擎文案 */
export interface ContentData {
  listSep: string;
  interview: string[];
  closing: string; // {answer}
  echo: string; // {answer}
  jobFallback: string;
  vibeTemplate: string; // {topic}
  bioTemplate: string; // {vibe}
  defaultInterests: string[];
  defaultValues: string[];
  defaultDealbreakers: string[];
  lookingFor: { slow: string; fast: string; orDefault: string };
  lifestyle: { tired: string; active: string };
  comms: { text: string; meet: string };
  interests: [string, string][]; // [regex, label]
  jobs: [string, string][];
  roles: [string, string][]; // hack: [regex, canonical role]
  roleLabels: Record<string, string>; // canonical -> display
  options: {
    availability: { full: string; part: string; flex: string };
    goal: { win: string; learn: string; network: string; build: string };
    style: { architect: string; iterative: string; flex: string };
  };
  mq: [string, string, string]; // {name} {landmine}
  ma: [string, string, string]; // {name} {role} {skills} {goal} {availability} {style} {landmines} {verified}
  verdict: { recommend: string; cautious: string; pass: string };
  reasons: {
    shared: string; // {list}
    values: string; // {v}
    commsSame: string; // {type}
    intent: string;
    fallback: string;
    verified: string; // {repos} {langs}
    unverified: string;
    comp: string; // {a} {b}
    commonTech: string; // {list}
    fullTime: string;
    goalSame: string; // {goal}
    styleSame: string;
  };
  redFlags: {
    commsDiff: string; // {theirType}
    intentDiff: string;
    none: string;
    sameRole: string; // {role}
    availDiff: string;
    goalDiff: string; // {mine} {theirs}
  };
  topicsFallback: string[];
  summary: { recommend: string; cautious: string; pass: string }; // {top} {reason}
  icebreakers: [string, string, string]; // {t0} {t1} {name}
  dm: string[];
  teamOpeners: Record<string, string[]>;
  teamFollowups: string[];
  phaseLink: string; // {name}
  phaseInterview: string; // {name}
  phaseReturn: string; // {name}
  phaseReport: string;
  doneYes: string;
  doneNo: string;
  doneError: string;
  asm: {
    groups: Record<string, string>; // engineering/design/product/data/other labels
    rationaleSkill: string; // {a} {b} {c}
    rationaleFull: string;
    rationaleMixed: string; // {goals}
    rationaleSame: string; // {goal}
    riskOverlap: string;
    riskPartTime: string;
    riskNone: string;
  };
  card: {
    complementDiff: string; // {a} {name} {b}
    complementSame: string; // {role}
    riskGoal: string; // {mine} {theirs}
    riskAvail: string;
    riskNone: string;
    openers: [string, string, string]; // {role} {t0} {name} {goal} {theirGoal} {style}
    sharedFallback: string[];
  };
  // 跨語系正規化關鍵字（用於不同語系檔案混用時的比對）
  canon: {
    win: string[];
    learn: string[];
    network: string[];
    build: string[];
    fulltime: string[];
    parttime: string[];
    architect: string[];
    iterative: string[];
  };
}

const zh: ContentData = {
  listSep: "、",
  interview: [
    "嗨，我是你的專屬隊長。你負責寫 Code，我負責幫你找到對的隊友。先從最實際的開始——這次黑客松，你打算用什麼技術棧打？平常最擅長哪一塊？",
    "收到。這次參賽你的目標是什麼？想拿獎、想學新東西、還是想認識厲害的人？",
    "了解。時間是最現實的——你能投入多少？全程 48 小時都在，還是下班後跟週末？",
    "那你最怕遇到什麼樣的隊友？反過來，你覺得自己最罩的地方是什麼？",
    "喜歡什麼樣的合作節奏？先畫架構再動手，還是邊做邊改？",
    "最後一題——有作品連結或過去參賽紀錄想讓隊長知道的嗎？（沒有也可以）",
  ],
  closing: "「{answer}」——收到，你的選手檔案我正在整理，晚點到「我的檔案」確認我要拿去用的版本。",
  echo: "「{answer}」——筆記。",
  jobFallback: "上班族",
  vibeTemplate: "{role}，主武裝 {topic}，{goal}型選手",
  bioTemplate: "{vibe}。這次想找互補的隊友一起把 demo 做完整。",
  defaultInterests: ["自學中"],
  defaultValues: ["真誠"],
  defaultDealbreakers: ["不寫文件", "不測試"],
  lookingFor: { slow: "筆友式慢溫，先舒服再說", fast: "看感覺，聊得來可以直接約", orDefault: "先當朋友開始，以認真交往為前提" },
  lifestyle: { tired: "工作很吃能量，假日偏歸巢型充電", active: "作息規律，假日喜歡出門走走" },
  comms: { text: "文字派，回訊穩定，喜歡分享生活小片段", meet: "喜歡直接約見面聊，線上會認真回但偏慢" },
  interests: [
    ["貓|猫", "貓"], ["狗", "狗"], ["咖啡", "咖啡"], ["露營|露营", "露營"],
    ["爬山|登山|健行", "爬山"], ["追劇|追剧", "追劇"], ["遊戲|游戏", "遊戲"],
    ["健身|重訓|重训", "健身"], ["跑步|路跑", "跑步"], ["看展|展覽|展览", "看展"],
    ["插畫|插画|畫畫|画画", "插畫"], ["吉他", "吉他"], ["桌遊|桌游", "桌遊"],
    ["旅行|旅遊|旅游", "旅行"], ["溫泉|温泉", "溫泉"], ["甜點|甜点", "甜點"],
    ["料理|做菜|烹飪|烹饪", "料理"], ["閱讀|阅读|看書|看书", "閱讀"], ["電影|电影", "電影"],
    ["攝影|摄影", "攝影"], ["投資|投资|理財|理财", "投資理財"], ["冥想|瑜伽|瑜珈", "冥想"],
    ["爵士", "爵士樂"], ["看海|海邊|海边", "看海"], ["羽球|籃球|篮球|運動|运动", "運動"],
  ],
  jobs: [
    ["工程師|工程师|寫程式|写程式|coding|後端|后端|前端", "工程師"],
    ["設計|设计|UI|UX|美術|美术", "設計師"],
    ["老師|老师|教學|教学|教育", "教職"],
    ["護理|护理|醫護|医护|醫師|医师", "醫護"],
    ["行銷|行销|企劃|企划|廣告|广告", "行銷企劃"],
    ["產品經理|产品经理|PM", "產品經理"],
    ["學生|学生|上課|上课|研究所", "學生"],
  ],
  roles: [
    ["全端|full.?stack|前後端都|前后端都", "fullstack"],
    ["前端|frontend|react|vue|ui 實作|ui 实作", "frontend"],
    ["後端|后端|backend|api|伺服器|server", "backend"],
    ["設計|设计|design|figma|ui\\/ux", "design"],
    ["pm|產品經理|产品经理|企劃|企划|簡報|简报|pitch", "pm"],
    ["資料|资料|data|機器學習|机器学习|ml|pytorch|分析", "data"],
    ["ai|llm|agent|提示詞|提示词|prompt", "ai"],
  ],
  roleLabels: {
    fullstack: "全端", frontend: "前端", backend: "後端",
    design: "設計", pm: "PM", data: "資料", ai: "AI",
  },
  mq: [
    "{name} 擅長哪一塊？技能跟我們家互補嗎？",
    "{name} 這次的目標跟可投入時間？",
    "{name} 的合作節奏？會不會踩到「{landmine}」這種雷？",
  ],
  ma: [
    "{name} 是{role}，主力 {skills}。{verified}",
    "目標是「{goal}」，可投入：{availability}。",
    "合作節奏：{style}。地雷是{landmines}。",
  ],
  verdict: { recommend: "值得一談", cautious: "保留觀察", pass: "建議跳過" },
  reasons: {
    shared: "你們都重視「{list}」——聊起來不會沒話講",
    values: "你把「{v}」看得很重，對方也一樣",
    commsSame: "溝通節奏相容（都是{type}）",
    intent: "目標一致，不會一個想衝一個想慢",
    fallback: "基本條件對得上，先聊聊看合作感覺",
    verified: "技能有 GitHub 驗證（{repos} 個公開專案，主要 {langs}）",
    unverified: "技能主張尚未附第三方驗證，合作前記得聊聊實作經驗",
    comp: "角色互補：{a} × {b}，技能線不打架、能互相 cover",
    commonTech: "有共同技術（{list}），溝通成本低",
    fullTime: "兩邊都是全程投入，48 小時不會開天窗",
    goalSame: "參賽目標一致：{goal}",
    styleSame: "協作節奏接近，不會一個要文件一個要衝刺",
  },
  redFlags: {
    commsDiff: "對方偏{theirType}，前期節奏需要一點磨合",
    intentDiff: "對關係節奏的期待有明顯落差，建議先講清楚",
    none: "暫時沒有需要留意的部分",
    sameRole: "同為{role}，注意分工重疊、別兩個人做同一件事",
    availDiff: "投入時間有落差，任務分配要先講清楚",
    goalDiff: "目標不同（{mine} vs {theirs}），對齊一下期待",
  },
  topicsFallback: ["分工方式", "Demo 腳本", "技術棧選擇"],
  summary: {
    recommend: "我的判斷：值得認識。你們在「{top}」有明顯共鳴，聊天起始溫度比陌生人高不少。開場話題我已經備好了。",
    cautious: "可以認識，但不用急。{reason}。如果聊得來再推進，我會繼續幫你觀察。",
    pass: "我建議先跳過：{reason}。省下你的時間，這是我的工作。",
  },
  icebreakers: [
    "哈囉！我家隊長說我們都喜歡「{t0}」，它逼我來問：你最近一次為了{t0}做出最瘋狂的事是什麼？",
    "正式認識一下，我是{name}。聽說我們在「{t0}」頻率很像——你入坑多久了？",
    "我家隊長說要幫我開場，結果它只擠出這句：我們都喜歡{t1}。這題不用急著回，想到再說就好。",
  ],
  dm: [
    "嗨！活動那天很可惜沒多聊到——之後有專案或聚會都可以揪我。",
    "最近在整理當時的專案，有想一起繼續做的話跟我說。",
    "你上次提到的技術我後來去試了，真的不錯，謝啦。",
    "有空的話找個時間線上聊一下？不一定要聊工作。",
    "之後有黑客松或揪團缺人，直接丟訊息給我就好。",
  ],
  teamOpeners: {
    frontend: ["前端我先開一個 Next.js 專案、把路由切好，大家把 API 介面丟過來我就能接。", "介面我先照 wireframe 刻一版能跑的，晚上大家看實機再調。"],
    backend: ["我把資料庫 schema 先畫出來，今晚前把 API 骨架 deploy 上去。", "API 我先開三支給前端用，資料格式我貼在頻道裡。"],
    fullstack: ["repo 我開好了，先讓大家都能跑起來，再來拆任務。", "我可以先做登入跟資料流那條線，其他部分大家認領。"],
    design: ["我先出三個主要畫面的 wireframe，大家看一下流程有沒有斷點。", "Demo 用的視覺跟簡報我來包，你們專心寫功能。"],
    pm: ["我把問題定義跟 demo 腳本寫成一頁，等下開個十分鐘對齊？", "時間表我先排一版：幾點前要有什麼，大家可以砍但不要遲。"],
    data: ["我先跑一版 baseline，數據不好我們還有時間換題目。", "資料源我先探一遍，順便把 RAG 的 chunk 策略試出來。"],
    ai: ["我把 agent 流程畫成圖，接哪個 API 先講好，我來刻 prompt。", "prompt 我先寫三版丟出來給大家盲測，選一版接進產品。"],
  },
  teamFollowups: [
    "好，我十分鐘後推第一版上去，大家看到再留言。",
    "同意，先做能 demo 的最小版本，有時間再 polish。",
    "+1，任務我認領這段，有卡住會直接說。",
    "這個分工我可以。先把介面講死，免得後面打架。",
    "我先照這版走，有問題直接在這邊 tag 我。",
  ],
  phaseLink: "已與 {name} 的隊長建立對談",
  phaseInterview: "你的隊長開始訪談 {name} 的隊長",
  phaseReturn: "{name} 的隊長開始回訪",
  phaseReport: "雙方正在整理評估報告",
  doneYes: "雙方隊長達成共識：這組合值得談",
  doneNo: "至少一位隊長覺得先緩緩，已列入觀察",
  doneError: "對談中斷，請稍後再試",
  asm: {
    groups: { engineering: "工程", design: "設計", product: "產品", data: "資料", other: "其他" },
    rationaleSkill: "技能線：{a} × {b} × {c}",
    rationaleFull: "三人都能全程投入，48 小時不缺人",
    rationaleMixed: "投入時間有落差，建議先把關鍵時段敲定",
    rationaleSame: "目標一致：{goal}",
    riskOverlap: "角色有重疊，分工要先講死",
    riskPartTime: "有人只能兼職，任務分配要保守一點",
    riskNone: "暫無明顯風險",
  },
  card: {
    complementDiff: "你是{a}、{name}是{b} — 技能線互補，能互相 cover",
    complementSame: "你們都是{role} — 同角色好溝通，但要先把分工講死",
    riskGoal: "目標不同（你{mine}、他{theirs}）→ 開場先對齊期待",
    riskAvail: "投入時間有落差 → 先講好關鍵時段",
    riskNone: "暫無明顯風險，直接聊",
    openers: [
      "嗨！我也是{availability}。{shared}你這次最想練哪一塊？我{role}，可以 cover 我這邊。",
      "{goalLine}想先問你期待這次的黑客松長什麼樣子？講開比較好合作。",
      "先加個 Discord/Line？我把我的{t0}經驗跟專案結構丟給你，五分鐘就能知道合不合。{styleLine}",
    ],
    sharedFallback: ["分工方式", "Demo 節奏"],
  },
  options: {
    availability: { full: "全程投入（48 小時都在）", part: "下班後 + 週末（約 20 小時）", flex: "彈性，會盡量配合" },
    goal: { win: "想拿獎", learn: "學習新東西", network: "認識厲害的人", build: "做出滿意的作品" },
    style: { architect: "先畫架構再動手", iterative: "邊做邊改，先求有再求好", flex: "看情況調整" },
  },
  canon: {
    win: ["拿獎", "拿奖", "贏", "赢", "第一", "得名", "win", "prize", "1位", "優勝", "優勝を"],
    learn: ["學習", "学习", "學", "学", "新手", "嘗試", "尝试", "learn", "学び", "勉強"],
    network: ["認識", "认识", "人脈", "人脉", "朋友", "社群", "network", "meet", "つながり", "人脈"],
    build: ["做", "作品", "build", "make", "作る", "作品"],
    fulltime: ["全程", "整天", "整場", "整场", "48", "full", "ずっと", "全日"],
    parttime: ["下班", "晚上", "週末", "周末", "兼職", "兼职", "20", "part", "夜", "週末"],
    architect: ["架構", "架构", "規劃", "规划", "文件", "流程", "architect", "plan", "設計図", "設計"],
    iterative: ["邊做邊改", "边做边改", "先求有", "iterate", "agile", "試作", "反復"],
  },
};

const en: ContentData = {
  listSep: ", ",
  interview: [
    "Hey — I'm your Captain. You write the code; I find the right teammates. Let's start with the practical stuff: what's your stack, and which part are you best at?",
    "Got it. What's your goal for this hackathon — win prizes, learn something new, or meet great people?",
    "Understood. Time is the real constraint: how much can you commit — all 48 hours, or evenings and weekends?",
    "What kind of teammate do you dread most? And what are you most reliable at?",
    "How do you like to work — plan the architecture first, or iterate as you go?",
    "Last one — any portfolio links or past hackathon records your Captain should know? (Optional)",
  ],
  closing: "“{answer}” — noted. I'm compiling your unit file; check “My Profile” later to review it.",
  echo: "“{answer}” — noted. ",
  jobFallback: "Professional",
  vibeTemplate: "{role}, main weapon {topic}, {goal} type",
  bioTemplate: "{vibe}. Looking for complementary teammates to finish a solid demo.",
  defaultInterests: ["self-learner"],
  defaultValues: ["honesty"],
  defaultDealbreakers: ["No docs", "No tests"],
  lookingFor: { slow: "Slow-burn, comfort first", fast: "Vibes-based, meet fast", orDefault: "Friends first, serious intent" },
  lifestyle: { tired: "Work drains me; home-body on weekends", active: "Regular schedule; out and about on weekends" },
  comms: { text: "Text-first, steady replies", meet: "Prefers meeting in person; slow online" },
  interests: [
    ["cat|猫|貓", "Cats"], ["dog", "Dogs"], ["coffee|咖啡", "Coffee"],
    ["camp|camping|露營", "Camping"], ["hik|hiking|登山", "Hiking"],
    ["game|gaming|遊戲", "Gaming"], ["gym|fitness|健身", "Fitness"],
    ["run|jog|跑步", "Running"], ["exhibit|museum|看展", "Exhibits"],
    ["draw|illustration|插畫", "Illustration"], ["guitar|吉他", "Guitar"],
    ["board.?game|桌遊", "Board games"], ["travel|旅行", "Travel"],
    ["photo|攝影", "Photography"], ["movie|film|電影", "Movies"],
    ["read|book|閱讀", "Reading"], ["invest|finance|投資", "Investing"],
    ["meditat|yoga|冥想", "Meditation"], ["jazz|爵士", "Jazz"],
    ["beach|sea|看海", "Beach"],
  ],
  jobs: [
    ["engineer|coding|developer|後端|前端", "Engineer"],
    ["design|ui|ux", "Designer"],
    ["teacher|education|老師", "Education"],
    ["nurse|doctor|medical|醫護", "Medical"],
    ["marketing|行銷", "Marketing"],
    ["product manager|pm|產品經理", "Product manager"],
    ["student|學生", "Student"],
  ],
  roles: [
    ["full.?stack|全端", "fullstack"],
    ["front.?end|react|vue|前端", "frontend"],
    ["back.?end|api|server|後端", "backend"],
    ["design|figma|ui.?ux|設計", "design"],
    ["pm|product manager|pitch|briefing|產品經理", "pm"],
    ["data|ml|pytorch|analyst|資料", "data"],
    ["\\bai\\b|llm|agent|prompt|提示詞", "ai"],
  ],
  roleLabels: {
    fullstack: "Full-stack", frontend: "Frontend", backend: "Backend",
    design: "Design", pm: "PM", data: "Data", ai: "AI",
  },
  mq: [
    "What is {name} best at? Are their skills complementary to ours?",
    "What are {name}'s goals and available time?",
    "How does {name} like to collaborate? Any risk of hitting “{landmine}”?",
  ],
  ma: [
    "{name} is a {role}, main stack: {skills}. {verified}",
    "Goal: “{goal}”; availability: {availability}.",
    "Work style: {style}. Dealbreakers: {landmines}.",
  ],
  verdict: { recommend: "PROMISING", cautious: "WATCH", pass: "PASS" },
  reasons: {
    shared: "You both value “{list}” — conversation won't stall",
    values: "“{v}” matters to both of you",
    commsSame: "Compatible communication rhythm ({type})",
    intent: "Aligned goals — no one sprinting while the other walks",
    fallback: "Basic fit checks out — talk and feel it out",
    verified: "Skills are GitHub-verified ({repos} public repos, mainly {langs})",
    unverified: "Skills are not third-party verified yet — check real experience before teaming",
    comp: "Complementary roles: {a} × {b} — no collision, mutual coverage",
    commonTech: "Shared tech ({list}) lowers communication cost",
    fullTime: "Both are all-in — nobody vanishes mid-48h",
    goalSame: "Same goal: {goal}",
    styleSame: "Similar work rhythm — no docs-vs-sprint clash",
  },
  redFlags: {
    commsDiff: "They lean {theirType}; expect some early friction on rhythm",
    intentDiff: "Clearly different relationship pacing — talk it out first",
    none: "Nothing to watch out for right now",
    sameRole: "Both are {role} — define the split to avoid duplicate work",
    availDiff: "Different availability — lock the key hours first",
    goalDiff: "Different goals ({mine} vs {theirs}) — align expectations first",
  },
  topicsFallback: ["work split", "demo script", "stack choices"],
  summary: {
    recommend: "My call: worth meeting. You clearly resonate on “{top}” — much warmer than a cold start. Openers are ready.",
    cautious: "Worth a chat, no rush. {reason}. I'll keep watching if it warms up.",
    pass: "I'd skip this one: {reason}. Saving your time is my job.",
  },
  icebreakers: [
    "Hi! My Captain says we both like “{t0}” — it made me ask: what's the craziest thing you've done for {t0}?",
    "Nice to meet you — I'm {name}. Apparently we vibe on “{t0}” — how long have you been into it?",
    "My Captain tried to write an opener and only managed: we both like {t1}. No rush to reply. 😌",
  ],
  dm: [
    "Hey! We didn't get to talk much at the event — ping me anytime for projects or meetups.",
    "I've been organizing our hackathon repo. Down to keep building if you are.",
    "Tried that tech you mentioned — it's genuinely good, thanks.",
    "Free for a quick call sometime? Doesn't have to be about work.",
    "If you need a teammate for the next hackathon, just message me.",
  ],
  teamOpeners: {
    frontend: ["I'll spin up the Next.js project and wire the routes — send me your API shapes and I'll hook them up.", "I'll code the UI to wireframe tonight; we can adjust on real devices later."],
    backend: ["I'll draft the DB schema and get an API skeleton deployed by tonight.", "I'll expose three API endpoints for the frontend and pin the data formats in the channel."],
    fullstack: ["Repo's up — everyone get it running first, then we split tasks.", "I'll take auth and the data flow; claim the rest."],
    design: ["I'll produce wireframes for the three main screens — check the flow for dead ends.", "I'll own demo visuals and the deck; you focus on features."],
    pm: ["I'll write the problem statement and demo script on one page — 10-minute sync after?", "Drafting the timeline: what's due when. Cut scope if needed, but don't be late."],
    data: ["I'll run a baseline first — if data looks bad we still have time to pivot.", "Mapping data sources and testing the RAG chunking strategy."],
    ai: ["I'll diagram the agent flow; agree on the APIs and I'll craft the prompts.", "Three prompt versions incoming for blind testing — we ship the best one."],
  },
  teamFollowups: [
    "OK — first version in 10 minutes, comment when you see it.",
    "Agreed: minimal demo-able version first, polish if time allows.",
    "+1, I'll take that slice and speak up if blocked.",
    "Works for me. Lock the interfaces now to avoid clashes later.",
    "Going with this. Tag me here if anything breaks.",
  ],
  phaseLink: "Link established with {name}'s Captain",
  phaseInterview: "Your Captain starts interviewing {name}'s Captain",
  phaseReturn: "{name}'s Captain is returning the questions",
  phaseReport: "Both sides are compiling reports",
  doneYes: "Both Captains agree: this combo is worth talking about",
  doneNo: "At least one Captain says hold — flagged for review",
  doneError: "Link interrupted — try again later",
  asm: {
    groups: { engineering: "Eng", design: "Design", product: "Product", data: "Data", other: "Other" },
    rationaleSkill: "Skill line: {a} × {b} × {c}",
    rationaleFull: "All three are all-in — nobody missing for 48h",
    rationaleMixed: "Availability differs — lock the critical hours first",
    rationaleSame: "Same goal: {goal}",
    riskOverlap: "Roles overlap — define the split early",
    riskPartTime: "Someone is part-time — assign conservatively",
    riskNone: "No obvious risks",
  },
  card: {
    complementDiff: "You're {a}, {name} is {b} — complementary lines, mutual coverage",
    complementSame: "Both of you are {role} — easy to talk, but split work explicitly",
    riskGoal: "Goals differ (you: {mine}, them: {theirs}) → align first",
    riskAvail: "Availability gap → agree on core hours first",
    riskNone: "No obvious risk — just talk",
    openers: [
      "Hi! I'm {availability} too.{shared} What do you most want to level up this time? I do {role} and can cover my side.",
      "{goalLine}What do you want this hackathon to look like? Better to say it upfront.",
      "Add me on Discord/Line? I'll send my {t0} experience and project structure — five minutes to see if we fit.{styleLine}",
    ],
    sharedFallback: ["work split", "demo rhythm"],
  },
  options: {
    availability: { full: "Full-time (all 48 hours)", part: "Evenings + weekends (~20 hours)", flex: "Flexible, will accommodate" },
    goal: { win: "Trying to win", learn: "Here to learn", network: "Meeting great people", build: "Building something solid" },
    style: { architect: "Architecture first, then code", iterative: "Build and iterate, ship early", flex: "Adapt as needed" },
  },
  canon: {
    win: ["win", "prize", "first", "拿獎", "贏", "優勝"],
    learn: ["learn", "new", "beginner", "學", "勉強"],
    network: ["network", "meet", "people", "認識", "人脈", "つながり"],
    build: ["build", "make", "作品", "作る"],
    fulltime: ["full", "all", "48", "全程", "ずっと"],
    parttime: ["evening", "weekend", "part", "下班", "週末", "夜"],
    architect: ["architect", "plan", "design doc", "架構", "規劃", "設計図"],
    iterative: ["iterate", "agile", "poc", "邊做邊改", "試作"],
  },
};

const ja: ContentData = {
  listSep: "、",
  interview: [
    "こんにちは、専属キャプテンです。コードはあなた、仲間探しは私が担当します。まず実務的なところから——今回のハッカソン、どの技術スタックで行きますか？一番得意な領域は？",
    "了解です。今回の目標は？優勝・学び・人脈づくりのどれですか？",
    "わかりました。時間が一番リアルです——どれくらい稼働できますか？48時間ずっと？それとも仕事の後と週末？",
    "一緒に組んで一番困るのはどんな人ですか？逆に、自分が一番頼れる部分は？",
    "どんな进め方が好きですか？先に設計してから動く？それとも作りながら直す？",
    "最後の質問——作品リンクや過去の参戦記録でキャプテンに知らせておくことは？（なくてもOK）",
  ],
  closing: "「{answer}」——了解。選手ファイルを編集中です。「マイプロフィール」で後ほど確認してください。",
  echo: "「{answer}」——メモしました。",
  jobFallback: "会社員",
  vibeTemplate: "{role}、主力は{topic}、{goal}タイプ",
  bioTemplate: "{vibe}。補完できる仲間と一緒にdemoを完成させたい。",
  defaultInterests: ["独学中"],
  defaultValues: ["誠実"],
  defaultDealbreakers: ["ドキュメントなし", "テストなし"],
  lookingFor: { slow: "ゆっくり距離を縮めたい", fast: "直感優先、会ってみたい", orDefault: "友達から、真剣交際前提" },
  lifestyle: { tired: "仕事で消耗、休日は家で充電", active: "規則正しい、休日は外出派" },
  comms: { text: "テキスト派、返信は安定", meet: "直接会うのが好き、オンラインはゆっくり" },
  interests: [
    ["猫|ねこ", "猫"], ["犬|いぬ", "犬"], ["コーヒー|カフェ", "コーヒー"],
    ["キャンプ|camp", "キャンプ"], ["登山|ハイキング", "登山"],
    ["ゲーム|game", "ゲーム"], ["筋トレ|ジム|gym", "筋トレ"],
    ["ランニング|run|マラソン", "ランニング"], ["展覧会|美術館|exhibit", "展覧会"],
    ["イラスト|描く|draw", "イラスト"], ["ギター|guitar", "ギター"],
    ["ボードゲーム|board", "ボードゲーム"], ["旅行|travel", "旅行"],
    ["写真|photo", "写真"], ["映画|movie|film", "映画"],
    ["読書|本|read", "読書"], ["投資|finance", "投資"],
    ["瞑想|ヨガ|meditation", "瞑想"], ["ジャズ|jazz", "ジャズ"],
    ["海|beach", "海"],
  ],
  jobs: [
    ["エンジニア|programming|開発|後端|前端", "エンジニア"],
    ["デザイン|design|ui|ux", "デザイナー"],
    ["教師|教育|teacher", "教育"],
    ["看護|医療|nurse|doctor", "医療"],
    ["マーケ|広告|marketing", "マーケティング"],
    ["pm|プロダクト|product", "プロダクト"],
    ["学生|student", "学生"],
  ],
  roles: [
    ["フルスタック|full.?stack|全端", "fullstack"],
    ["フロント|front.?end|react|vue|前端", "frontend"],
    ["バック|back.?end|api|server|後端", "backend"],
    ["デザイン|design|figma|ui.?ux", "design"],
    ["pm|プロダクト|企画|pitch", "pm"],
    ["データ|data|ml|機械学習|pytorch", "data"],
    ["ai|llm|agent|プロンプト|prompt", "ai"],
  ],
  roleLabels: {
    fullstack: "フルスタック", frontend: "フロント", backend: "バック",
    design: "デザイン", pm: "PM", data: "データ", ai: "AI",
  },
  mq: [
    "{name} さんの得意領域は？うちと補完できますか？",
    "{name} さんの目標と稼働可能時間は？",
    "{name} さんの協働スタイルは？「{landmine}」に当たるリスクは？",
  ],
  ma: [
    "{name} は{role}、主力スタックは {skills}。{verified}",
    "目標は「{goal}」、稼働時間は {availability}。",
    "進め方：{style}。NG事項：{landmines}。",
  ],
  verdict: { recommend: "有望", cautious: "様子見", pass: "見送り" },
  reasons: {
    shared: "「{list}」を互いに大事にしている——会話が止まらない",
    values: "「{v}」は二人とも重視している",
    commsSame: "コミュニケーションのテンポが合う（{type}）",
    intent: "目標が一致、一人が突っ走る心配なし",
    fallback: "基本条件は合致、まず話してみましょう",
    verified: "GitHub検証済み（公開リポジトリ {repos} 件、主に {langs}）",
    unverified: "スキルは第三者検証なし——組む前に実績を確認しましょう",
    comp: "役割の補完：{a} × {b}、衝突せず相互カバー",
    commonTech: "共通技術（{list}）でコミュニケーションコストが低い",
    fullTime: "両者ともフル稼働——48時間で消えません",
    goalSame: "目標一致：{goal}",
    styleSame: "進め方が近い、資料派とスプリント派の衝突なし",
  },
  redFlags: {
    commsDiff: "相手は{theirType}寄り——序盤はテンポのすり合わせが必要",
    intentDiff: "関係のペースに差——先に話し合いを",
    none: "今のところ注意点はなし",
    sameRole: "同じ{role}——分担を明確に、作業の重複に注意",
    availDiff: "稼働時間に差——先にコア時間を決める",
    goalDiff: "目標が違う（{mine} vs {theirs}）——期待値をすり合わせ",
  },
  topicsFallback: ["分担方法", "demo脚本", "スタック選定"],
  summary: {
    recommend: "私の判断：会う価値あり。「{top}」で明確に共鳴しています。会話の初期温度が高い。切り出しも用意済み。",
    cautious: "話してみる価値はありますが急がずに。{reason}。温まったらまた見ます。",
    pass: "今回は見送りをおすすめ：{reason}。時間を守るのも私の仕事です。",
  },
  icebreakers: [
    "こんにちは！キャプテンが「{t0}」で一緒と言うので聞きます——{t0}のために一番無茶したことは？",
    "はじめまして、{name}です。「{t0}」の波長が合うらしい——どのくらい続けてる？",
    "キャプテンが切り出しを考えて、出たのがこれ：二人とも{t1}が好き。急がなくて大丈夫。😌",
  ],
  dm: [
    "こんにちは！あの日はあまり話せませんでしたね——プロジェクトでも飲み会でも、いつでも声かけてください。",
    "ハッカソンのリポジトリを整理しています。続きをやる気があれば一緒にどう？",
    "前に話してた技術、試してみたら本当に良かったです。ありがとう。",
    "近いうちにオンラインで雑談しませんか？仕事の話じゃなくても全然OK。",
    "次のハッカソンで人手が足りなければ、気軽にメッセージを。",
  ],
  teamOpeners: {
    frontend: ["Next.js プロジェクトを立ててルートを整えます。API仕様を投げてくれれば繋ぎます。", "ワイヤーフレーム通りにUIを今夜実装、実機で調整しましょう。"],
    backend: ["DBスキーマを先に描き、今夜までにAPI雛形をデプロイします。", "フロント用にAPIを3本開けます。データ形式はチャンネルに貼ります。"],
    fullstack: ["リポジトリ作成済み。まず全員動かしてから分担しましょう。", "認証とデータフローは私が。残りは各自で。"],
    design: ["主要3画面のワイヤーを出します。フローの抜けを確認して。", "demoのビジュアルと資料は私が。機能に集中して。"],
    pm: ["課題定義とdemo脚本を1枚にまとめます。10分だけ同期しますか？", "タイムライン草案：締切と成果物。削るのはOK、遅れはNG。"],
    data: ["まずbaselineを回します。数値が悪ければ題材変更の時間はまだあります。", "データ源を確認しがらRAGのchunk戦略を試します。"],
    ai: ["agentフローを図にします。APIを決めてからpromptを書きます。", "promptを3版作って盲測——最良を製品に入れます。"],
  },
  teamFollowups: [
    "了解、10分後に初版をpushします。見たらコメントを。",
    "同意、まずdemoできる最小版。時間があればpolish。",
    "+1、その分担は私が担当。詰まったらすぐ言います。",
    "この分担でOK。インターフェースは先に固めましょう。",
    "この方針で進めます。問題があればtagを。",
  ],
  phaseLink: "{name} のキャプテンと回線を確立",
  phaseInterview: "あなたのキャプテンが {name} のキャプテンへ聴取を開始",
  phaseReturn: "{name} のキャプテンが質問を返しています",
  phaseReport: "双方が評価レポートを作成中",
  doneYes: "両キャプテン合意：話す価値のある組み合わせ",
  doneNo: "少なくとも一方が待ったをかけ、経過観察に",
  doneError: "回線が途切れました。後でもう一度",
  asm: {
    groups: { engineering: "エンジニア", design: "デザイン", product: "プロダクト", data: "データ", other: "その他" },
    rationaleSkill: "スキルライン：{a} × {b} × {c}",
    rationaleFull: "三人ともフル稼働——48時間で欠員なし",
    rationaleMixed: "稼働に差——重要時間帯を先に確定",
    rationaleSame: "目標一致：{goal}",
    riskOverlap: "役割が重複——分業を先に明文化",
    riskPartTime: "兼務の人がいます——余裕を持った割当を",
    riskNone: "明確なリスクなし",
  },
  card: {
    complementDiff: "あなたは{a}、{name}は{b} — スキルライン補完、相互カバー",
    complementSame: "二人とも{role} — 話しやすいが分業は明確に",
    riskGoal: "目標が違う（あなた{mine}、相手{theirs}）→ まずすり合わせ",
    riskAvail: "稼働時間に差 → コア時間を先に合意",
    riskNone: "目立ったリスクなし、そのまま話しましょう",
    openers: [
      "どうも！私も{availability}です。{shared}今回一番伸ばしたいのは？私は{role}、自分の担当はカバーできます。",
      "{goalLine}今回のハッカソン、どんな形にしたいか先に聞きたいです。",
      "Discord/LINE 交換しませんか？{t0}の経験と構成を送ります。5分で合うか分かります。{styleLine}",
    ],
    sharedFallback: ["分担方法", "demoのテンポ"],
  },
  options: {
    availability: { full: "フル参加（48時間ずっと）", part: "平日夜＋週末（約20時間）", flex: "柔軟、できる限り合わせます" },
    goal: { win: "優勝を狙う", learn: "学びたい", network: "すごい人と出会いたい", build: "満足できる作品を作る" },
    style: { architect: "先に設計してから着手", iterative: "作りながら改善、早く動く", flex: "状況に応じて" },
  },
  canon: {
    win: ["優勝", "勝", "賞", "win", "prize", "拿獎"],
    learn: ["学", "学び", "勉強", "learn", "学習"],
    network: ["人脈", "つながり", "出会い", "network", "meet", "認識"],
    build: ["作る", "作品", "build", "make"],
    fulltime: ["ずっと", "全日", "48", "full", "all", "全程"],
    parttime: ["夜", "週末", "仕事の後", "part", "evening"],
    architect: ["設計", "図", "plan", "architect", "架構"],
    iterative: ["試作", "反復", "agile", "iterate", "辺作", "邊做"],
  },
};

const cn: ContentData = {
  "listSep": "、",
  "interview": [
    "嗨，我是你的专属队长。你负责写 Code，我负责帮你找到对的队友。先从最实际的开始——这次黑客松，你打算用什么技术栈打？平常最擅长哪一块？",
    "收到。这次参赛你的目标是什么？想拿奖、想学新东西、还是想认识厉害的人？",
    "了解。时间是最现实的——你能投入多少？全程 48 小时都在，还是下班后跟周末？",
    "那你最怕遇到什么样的队友？反过来，你觉得自己最罩的地方是什么？",
    "喜欢什么样的合作节奏？先画架构再动手，还是边做边改？",
    "最后一题——有作品连结或过去参赛纪录想让队长知道的吗？（没有也可以）"
  ],
  "closing": "「{answer}」——收到，你的选手文件我正在整理，晚点到「我的文件」确认我要拿去用的版本。",
  "echo": "「{answer}」——笔记。",
  "jobFallback": "上班族",
  "vibeTemplate": "{role}，主武装 {topic}，{goal}型选手",
  "bioTemplate": "{vibe}。这次想找互补的队友一起把 demo 做完整。",
  "defaultInterests": [
    "自学中"
  ],
  "defaultValues": [
    "真诚"
  ],
  "defaultDealbreakers": [
    "不写文件",
    "不测试"
  ],
  "lookingFor": {
    "slow": "笔友式慢温，先舒服再说",
    "fast": "看感觉，聊得来可以直接约",
    "orDefault": "先当朋友开始，以认真交往为前提"
  },
  "lifestyle": {
    "tired": "工作很吃能量，假日偏归巢型充电",
    "active": "作息规律，假日喜欢出门走走"
  },
  "comms": {
    "text": "文字派，回讯稳定，喜欢分享生活小片段",
    "meet": "喜欢直接约见面聊，线上会认真回但偏慢"
  },
  "interests": [
    [
      "猫|猫",
      "猫"
    ],
    [
      "狗",
      "狗"
    ],
    [
      "咖啡",
      "咖啡"
    ],
    [
      "露营|露营",
      "露营"
    ],
    [
      "爬山|登山|健行",
      "爬山"
    ],
    [
      "追剧|追剧",
      "追剧"
    ],
    [
      "游戏|游戏",
      "游戏"
    ],
    [
      "健身|重训|重训",
      "健身"
    ],
    [
      "跑步|路跑",
      "跑步"
    ],
    [
      "看展|展览|展览",
      "看展"
    ],
    [
      "插画|插画|画画|画画",
      "插画"
    ],
    [
      "吉他",
      "吉他"
    ],
    [
      "桌游|桌游",
      "桌游"
    ],
    [
      "旅行|旅游|旅游",
      "旅行"
    ],
    [
      "温泉|温泉",
      "温泉"
    ],
    [
      "甜点|甜点",
      "甜点"
    ],
    [
      "料理|做菜|烹饪|烹饪",
      "料理"
    ],
    [
      "阅读|阅读|看书|看书",
      "阅读"
    ],
    [
      "电影|电影",
      "电影"
    ],
    [
      "摄影|摄影",
      "摄影"
    ],
    [
      "投资|投资|理财|理财",
      "投资理财"
    ],
    [
      "冥想|瑜伽|瑜珈",
      "冥想"
    ],
    [
      "爵士",
      "爵士乐"
    ],
    [
      "看海|海边|海边",
      "看海"
    ],
    [
      "羽球|篮球|篮球|运动|运动",
      "运动"
    ]
  ],
  "jobs": [
    [
      "工程师|工程师|写程序|写程序|coding|后端|后端|前端",
      "工程师"
    ],
    [
      "设计|设计|UI|UX|美术|美术",
      "设计师"
    ],
    [
      "老师|老师|教学|教学|教育",
      "教职"
    ],
    [
      "护理|护理|医护|医护|医师|医师",
      "医护"
    ],
    [
      "行销|行销|企划|企划|广告|广告",
      "行销企划"
    ],
    [
      "产品经理|产品经理|PM",
      "产品经理"
    ],
    [
      "学生|学生|上课|上课|研究所",
      "学生"
    ]
  ],
  "roles": [
    [
      "全端|full.?stack|前后端都|前后端都",
      "fullstack"
    ],
    [
      "前端|frontend|react|vue|ui 实作|ui 实作",
      "frontend"
    ],
    [
      "后端|后端|backend|api|伺服器|server",
      "backend"
    ],
    [
      "设计|设计|design|figma|ui\\/ux",
      "design"
    ],
    [
      "pm|产品经理|产品经理|企划|企划|简报|简报|pitch",
      "pm"
    ],
    [
      "数据|资料|data|机器学习|机器学习|ml|pytorch|分析",
      "data"
    ],
    [
      "ai|llm|agent|提示词|提示词|prompt",
      "ai"
    ]
  ],
  "roleLabels": {
    "fullstack": "全端",
    "frontend": "前端",
    "backend": "后端",
    "design": "设计",
    "pm": "PM",
    "data": "数据",
    "ai": "AI"
  },
  "mq": [
    "{name} 擅长哪一块？技能跟我们家互补吗？",
    "{name} 这次的目标跟可投入时间？",
    "{name} 的合作节奏？会不会踩到「{landmine}」这种雷？"
  ],
  "ma": [
    "{name} 是{role}，主力 {skills}。{verified}",
    "目标是「{goal}」，可投入：{availability}。",
    "合作节奏：{style}。地雷是{landmines}。"
  ],
  "verdict": {
    "recommend": "值得一谈",
    "cautious": "保留观察",
    "pass": "建议跳过"
  },
  "reasons": {
    "shared": "你们都重视「{list}」——聊起来不会没话讲",
    "values": "你把「{v}」看得很重，对方也一样",
    "commsSame": "沟通节奏相容（都是{type}）",
    "intent": "目标一致，不会一个想冲一个想慢",
    "fallback": "基本条件对得上，先聊聊看合作感觉",
    "verified": "技能有 GitHub 验证（{repos} 个公开项目，主要 {langs}）",
    "unverified": "技能主张尚未附第三方验证，合作前记得聊聊实作经验",
    "comp": "角色互补：{a} × {b}，技能线不打架、能互相 cover",
    "commonTech": "有共同技术（{list}），沟通成本低",
    "fullTime": "两边都是全程投入，48 小时不会开天窗",
    "goalSame": "参赛目标一致：{goal}",
    "styleSame": "协作节奏接近，不会一个要文件一个要冲刺"
  },
  "redFlags": {
    "commsDiff": "对方偏{theirType}，前期节奏需要一点磨合",
    "intentDiff": "对关系节奏的期待有明显落差，建议先讲清楚",
    "none": "暂时没有需要留意的部分",
    "sameRole": "同为{role}，注意分工重叠、别两个人做同一件事",
    "availDiff": "投入时间有落差，任务分配要先讲清楚",
    "goalDiff": "目标不同（{mine} vs {theirs}），对齐一下期待"
  },
  "topicsFallback": [
    "分工方式",
    "Demo 脚本",
    "技术栈选择"
  ],
  "summary": {
    "recommend": "我的判断：值得认识。你们在「{top}」有明显共鸣，聊天起始温度比陌生人高不少。开场话题我已经备好了。",
    "cautious": "可以认识，但不用急。{reason}。如果聊得来再推进，我会继续帮你观察。",
    "pass": "我建议先跳过：{reason}。省下你的时间，这是我的工作。"
  },
  "icebreakers": [
    "哈啰！我家队长说我们都喜欢「{t0}」，它逼我来问：你最近一次为了{t0}做出最疯狂的事是什么？",
    "正式认识一下，我是{name}。听说我们在「{t0}」频率很像——你入坑多久了？",
    "我家队长说要帮我开场，结果它只挤出这句：我们都喜欢{t1}。这题不用急着回，想到再说就好。"
  ],
  "dm": [
    "嗨！活动那天可惜没多聊到——之后有项目或聚会都可以叫我。",
    "最近在整理当时的项目，想一起继续做的话跟我说。",
    "你上次提到的技术我后来去试了，真的不错，谢啦。",
    "有空的话找个时间线上聊一下？不一定要聊工作。",
    "之后有黑客松或组队缺人，直接私信我就好。"
  ],
  "teamOpeners": {
    "frontend": [
      "前端我先开一个 Next.js 项目、把路由切好，大家把 API 介面丢过来我就能接。",
      "介面我先照 wireframe 刻一版能跑的，晚上大家看实机再调。"
    ],
    "backend": [
      "我把数据库 schema 先画出来，今晚前把 API 骨架 deploy 上去。",
      "API 我先开三支给前端用，数据格式我贴在频道里。"
    ],
    "fullstack": [
      "repo 我开好了，先让大家都能跑起来，再来拆任务。",
      "我可以先做登录跟数据流那条线，其他部分大家认领。"
    ],
    "design": [
      "我先出三个主要画面的 wireframe，大家看一下流程有没有断点。",
      "Demo 用的视觉跟简报我来包，你们专心写功能。"
    ],
    "pm": [
      "我把问题定义跟 demo 脚本写成一页，等下开个十分钟对齐？",
      "时间表我先排一版：几点前要有什么，大家可以砍但不要迟。"
    ],
    "data": [
      "我先跑一版 baseline，数据不好我们还有时间换题目。",
      "数据源我先探一遍，顺便把 RAG 的 chunk 策略试出来。"
    ],
    "ai": [
      "我把 agent 流程画成图，接哪个 API 先讲好，我来刻 prompt。",
      "prompt 我先写三版丢出来给大家盲测，选一版接进产品。"
    ]
  },
  "teamFollowups": [
    "好，我十分钟后推第一版上去，大家看到再留言。",
    "同意，先做能 demo 的最小版本，有时间再 polish。",
    "+1，任务我认领这段，有卡住会直接说。",
    "这个分工我可以。先把介面讲死，免得后面打架。",
    "我先照这版走，有问题直接在这边 tag 我。"
  ],
  "phaseLink": "已与 {name} 的队长建立对谈",
  "phaseInterview": "你的队长开始访谈 {name} 的队长",
  "phaseReturn": "{name} 的队长开始回访",
  "phaseReport": "双方正在整理评估报告",
  "doneYes": "双方队长达成共识：这组合值得谈",
  "doneNo": "至少一位队长觉得先缓缓，已列入观察",
  "doneError": "对谈中断，请稍后再试",
  "asm": {
    "groups": {
      "engineering": "工程",
      "design": "设计",
      "product": "产品",
      "data": "数据",
      "other": "其他"
    },
    "rationaleSkill": "技能线：{a} × {b} × {c}",
    "rationaleFull": "三人都能全程投入，48 小时不缺人",
    "rationaleMixed": "投入时间有落差，建议先把关键时段敲定",
    "rationaleSame": "目标一致：{goal}",
    "riskOverlap": "角色有重叠，分工要先讲死",
    "riskPartTime": "有人只能兼职，任务分配要保守一点",
    "riskNone": "暂无明显风险"
  },
  "card": {
    "complementDiff": "你是{a}、{name}是{b} — 技能线互补，能互相 cover",
    "complementSame": "你们都是{role} — 同角色好沟通，但要先把分工讲死",
    "riskGoal": "目标不同（你{mine}、他{theirs}）→ 开场先对齐期待",
    "riskAvail": "投入时间有落差 → 先讲好关键时段",
    "riskNone": "暂无明显风险，直接聊",
    "openers": [
      "嗨！我也是{availability}。{shared}你这次最想练哪一块？我{role}，可以 cover 我这边。",
      "{goalLine}想先问你期待这次的黑客松长什么样子？讲开比较好合作。",
      "先加个 Discord/Line？我把我的{t0}经验跟项目结构丢给你，五分钟就能知道合不合。{styleLine}"
    ],
    "sharedFallback": [
      "分工方式",
      "Demo 节奏"
    ]
  },
  "options": {
    "availability": { "full": "全程投入（48 小时都在）", "part": "下班后 + 周末（约 20 小时）", "flex": "弹性，会尽量配合" },
    "goal": { "win": "想拿奖", "learn": "学习新东西", "network": "认识厉害的人", "build": "做出满意的作品" },
    "style": { "architect": "先画架构再动手", "iterative": "边做边改，先有再求好", "flex": "看情况调整" }
  },
  "canon": {
    "win": [
      "拿奖",
      "拿奖",
      "赢",
      "赢",
      "第一",
      "得名",
      "win",
      "prize",
      "1位",
      "优胜",
      "优胜を"
    ],
    "learn": [
      "学习",
      "学习",
      "学",
      "学",
      "新手",
      "尝试",
      "尝试",
      "learn",
      "学び",
      "勉强"
    ],
    "network": [
      "认识",
      "认识",
      "人脉",
      "人脉",
      "朋友",
      "社区",
      "network",
      "meet",
      "つながり",
      "人脉"
    ],
    "build": [
      "做",
      "作品",
      "build",
      "make",
      "作る",
      "作品"
    ],
    "fulltime": [
      "全程",
      "整天",
      "整场",
      "整场",
      "48",
      "full",
      "ずっと",
      "全日"
    ],
    "parttime": [
      "下班",
      "晚上",
      "周末",
      "周末",
      "兼职",
      "兼职",
      "20",
      "part",
      "夜",
      "周末"
    ],
    "architect": [
      "架构",
      "架构",
      "规划",
      "规划",
      "文件",
      "流程",
      "architect",
      "plan",
      "设计図",
      "设计"
    ],
    "iterative": [
      "边做边改",
      "边做边改",
      "先求有",
      "iterate",
      "agile",
      "试作",
      "反复"
    ]
  }
};

export const CONTENT: Record<Locale, ContentData> = { zh, cn, en, ja };

export function canonical(
  kind: "goal" | "availability" | "style",
  value: string,
  fallbackLocale: Locale = "zh",
): string {
  const c = CONTENT[fallbackLocale].canon;
  const has = (keys: string[]) =>
    keys.some((k) => value.toLowerCase().includes(k.toLowerCase()));
  if (kind === "goal") {
    if (has(c.win)) return "win";
    if (has(c.learn)) return "learn";
    if (has(c.network)) return "network";
    return "build";
  }
  if (kind === "availability") return has(c.fulltime) ? "fulltime" : has(c.parttime) ? "parttime" : "flex";
  return has(c.architect) ? "architect" : has(c.iterative) ? "iterative" : "flex";
}


/** 角色字串（任意語系）→ 當前語系的顯示名稱 */
export function roleDisplay(locale: Locale, role: string): string {
  const hit = CONTENT.zh.roles.find(([re]) => {
    try {
      return new RegExp(re, "i").test(role);
    } catch {
      return false;
    }
  })?.[1];
  return CONTENT[locale].roleLabels[hit ?? role] ?? role;
}
