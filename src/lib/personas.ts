import type { HackathonProfile } from "./types";

export interface PersonaSeed {
  name: string;
  emoji: string;
  tagline: string;
  isBot: boolean;
  profile: HackathonProfile;
}

export const EVENT_SEED = {
  name: "TRAE 黑客松 2026 秋",
  code: "TRAE26FALL",
  startsAt: new Date("2026-10-24T09:00:00+08:00"),
};

export const HACK_PERSONAS: PersonaSeed[] = [
  {
    name: "里歐",
    emoji: "🦁",
    tagline: "全端 · Next.js/Node · 目標：拿獎",
    isBot: true,
    profile: {
      nickname: "里歐",
      role: "全端",
      skills: ["Next.js", "TypeScript", "Node", "PostgreSQL", "Prisma", "Vercel"],
      timezone: "Asia/Taipei",
      availability: "全程投入（48 小時都在）",
      goal: "想拿獎",
      workingStyle: "先畫架構再動手，晚上除非必要不熬夜",
      vibe: "架構控，Demo 前一小時還在重構的人是我不會",
      dealbreakers: ["報名後消失", "不寫 README", "不做任何測試"],
      bio: "打過 6 場黑客松，拿過 2 次獎。擅長把大家做的東西在最後一晚接起來。這次想找會做設計或簡報的隊友。",
    },
  },
  {
    name: "小滿",
    emoji: "🍞",
    tagline: "前端 · React/TS · 目標：學習",
    isBot: true,
    profile: {
      nickname: "小滿",
      role: "前端",
      skills: ["React", "TypeScript", "Tailwind", "Figma", "Vite"],
      timezone: "Asia/Taipei",
      availability: "全程投入（48 小時都在）",
      goal: "學習新東西",
      workingStyle: "邊做邊改，喜歡先求有再求好",
      vibe: "手速很快的 UI 工人，看到漂亮介面會自己截圖存檔",
      dealbreakers: ["只想出嘴不動手", "不溝通就自己改需求"],
      bio: "第三次黑客松，前兩次都倒在 demo 前。這次想找到能 cover 後端的隊友，我負責把畫面做到評審記得住。",
    },
  },
  {
    name: "阿哲",
    emoji: "🛠️",
    tagline: "後端 · Python/AWS · 平日晚上+週末",
    isBot: true,
    profile: {
      nickname: "阿哲",
      role: "後端",
      skills: ["Python", "FastAPI", "AWS", "Docker", "PostgreSQL", "Redis"],
      timezone: "Asia/Taipei",
      availability: "下班後 + 週末（約 20 小時）",
      goal: "想拿獎",
      workingStyle: "先講清楚 API 規格再動手，不喜歡半夜被 tag",
      vibe: "API 開好開滿，但請不要叫我做 UI",
      dealbreakers: ["需求臨時大改不講", "週五晚上才開始動工"],
      bio: "白天寫後端，晚上來過過癮。擅長把資料流跟部署搞定，這次希望找前端跟設計一起打。",
    },
  },
  {
    name: "霓霓",
    emoji: "🎨",
    tagline: "設計 · Figma/UX · 目標：認識人",
    isBot: true,
    profile: {
      nickname: "霓霓",
      role: "設計",
      skills: ["Figma", "UI/UX", "Prototyping", "插畫", "簡報設計"],
      timezone: "Asia/Taipei",
      availability: "全程投入（48 小時都在）",
      goal: "認識厲害的人",
      workingStyle: "邊做邊改，靠用戶訪談跟原型找方向",
      vibe: "兩小時內把醜介面變好看，順手包 demo 視覺",
      dealbreakers: ["不尊重設計專業", "工程師自己改設計不講"],
      bio: "產品設計師，第一次打黑客松。想體驗那種「一群人 48 小時做出一件事」的感覺，獎不獎其次。",
    },
  },
  {
    name: "老吳",
    emoji: "🎲",
    tagline: "PM · 商業模式/簡報 · 目標：拿獎",
    isBot: true,
    profile: {
      nickname: "老吳",
      role: "PM",
      skills: ["商業模式", "簡報", "市場研究", "專案管理", "Pitch"],
      timezone: "Asia/Taipei",
      availability: "全程投入（48 小時都在）",
      goal: "想拿獎",
      workingStyle: "先畫架構再動手，行程表精確到小時",
      vibe: "負責讓評審在 3 分鐘內聽懂你們做了什麼",
      dealbreakers: ["開會沒結論", "Demo 前一天才知道做了什麼"],
      bio: "在正職帶產品團隊。黑客松的樂趣是可以在 48 小時內完整跑一遍從問題到 pitch 的流程。",
    },
  },
  {
    name: "Kiwi",
    emoji: "🥝",
    tagline: "資料 · PyTorch/RAG · 下班後投入",
    isBot: true,
    profile: {
      nickname: "Kiwi",
      role: "資料",
      skills: ["Python", "PyTorch", "RAG", "LangChain", "Pandas"],
      timezone: "Asia/Taipei",
      availability: "下班後 + 週末（約 20 小時）",
      goal: "學習新東西",
      workingStyle: "先做最小實驗再擴大，相信數據說話",
      vibe: "模型調參狂，會半夜跑實驗但早上起不來",
      dealbreakers: ["把 AI 當魔法許願", "沒有資料也在硬做"],
      bio: "資料科學家。這次想試試把 agent 跟 RAG 玩進產品裡，需要有人幫我把成果變成能 demo 的樣子。",
    },
  },
  {
    name: "阿宏",
    emoji: "📱",
    tagline: "App · Flutter/Firebase · 目標：認識人",
    isBot: true,
    profile: {
      nickname: "阿宏",
      role: "全端",
      skills: ["Flutter", "Firebase", "Dart", "Supabase", "UI 實作"],
      timezone: "Asia/Taipei",
      availability: "全程投入（48 小時都在）",
      goal: "認識厲害的人",
      workingStyle: "邊做邊改，先做出能跑的東西再說",
      vibe: "一個人可以出一個 App 的那種，但想要隊友一起興奮",
      dealbreakers: ["只報名不出現", "不願意學新東西"],
      bio: "接案 App 工程師。打過線上黑客松，這次想試實體的，希望隊友是能一起喊「衝了」的那種。",
    },
  },
  {
    name: "小綠",
    emoji: "🌿",
    tagline: "AI 應用 · Agent/RAG · 目標：拿獎",
    isBot: true,
    profile: {
      nickname: "小綠",
      role: "AI",
      skills: ["LLM", "Agent", "Prompt Engineering", "Python", "API 整合"],
      timezone: "Asia/Taipei",
      availability: "全程投入（48 小時都在）",
      goal: "想拿獎",
      workingStyle: "先畫架構再動手，喜歡把流程寫成文件",
      vibe: "把 LLM 接進任何東西的人，prompt 檔比程式碼多",
      dealbreakers: ["把 API key 上傳到 GitHub", "開天窗"],
      bio: "在做 AI 產品的新創打滾過。這次想找能把 AI 包成產品的前端跟設計，一起做個評審會記得的 demo。",
    },
  },
];

// 預建的示範身分
export const DEMO_HACKER: PersonaSeed = {
  name: "Demo阿飛",
  emoji: "🛩️",
  tagline: "示範身分 · 全端工程師，已建好隊長檔案",
  isBot: false,
  profile: {
    nickname: "阿飛",
    role: "全端",
    skills: ["TypeScript", "React", "Node", "Next.js", "PostgreSQL", "Tailwind"],
    timezone: "Asia/Taipei",
    availability: "全程投入（48 小時都在）",
    goal: "想拿獎",
    workingStyle: "邊做邊改，但專案結構會先定好",
    vibe: "什麼都能接一點的全端，敗點是話不多",
    dealbreakers: ["報名後消失", "開天窗不講"],
    bio: "寫網站的全端工程師，打過 4 場黑客松。想找設計或 PM 的隊友一起把 demo 做完整。",
  },
};
