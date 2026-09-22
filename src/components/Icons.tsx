// 極簡線性圖示組（stroke: currentColor）
type P = { size?: number; className?: string };

const base = (size: number, className?: string) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.7,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  className,
});

export const IconHeart = ({ size = 20, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 20.5s-7.5-4.6-9.3-9.1C1.5 8.2 3.4 5 6.6 5c2 0 3.5 1.1 4.4 2.5.1.2.4.2.5 0C12.4 6.1 14 5 15.9 5c3.2 0 5.1 3.2 4 6.4-1.8 4.5-9.4 9.1-9.4 9.1Z" transform="translate(1 0)" />
  </svg>
);

export const IconChat = ({ size = 20, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M21 12a8 8 0 0 1-11.6 7.2L4 21l1.8-5.4A8 8 0 1 1 21 12Z" />
  </svg>
);

export const IconUser = ({ size = 20, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="8" r="3.6" />
    <path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4" />
  </svg>
);

export const IconCompass = ({ size = 20, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <path d="m15.5 8.5-2 5-5 2 2-5 5-2Z" />
  </svg>
);

export const IconArrowRight = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4 12h15M13 6l6 6-6 6" />
  </svg>
);

export const IconLock = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="5" y="10.5" width="14" height="9" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
  </svg>
);

export const IconCheck = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </svg>
);

export const IconFlag = ({ size = 15, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M6 21V4" />
    <path d="M6 4.5h11.5l-2.8 4 2.8 4H6" />
  </svg>
);

export const IconX = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);

export const IconPlus = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconShield = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M12 3.5 5 6v5.5c0 4.3 3 7.6 7 9 4-1.4 7-4.7 7-9V6l-7-2.5Z" />
    <path d="m9 12 2 2 4-4.5" />
  </svg>
);

export const IconLockKey = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <rect x="4.5" y="10.5" width="15" height="9" rx="2" />
    <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5M12 14.5v2" />
  </svg>
);

export const IconRadar = ({ size = 18, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="12" cy="12" r="8.5" />
    <circle cx="12" cy="12" r="4.5" />
    <circle cx="12" cy="12" r="0.8" fill="currentColor" stroke="none" />
  </svg>
);

export const IconEye = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M2.5 12S6 5.8 12 5.8 21.5 12 21.5 12 18 18.2 12 18.2 2.5 12 2.5 12Z" />
    <circle cx="12" cy="12" r="2.6" />
  </svg>
);

export const IconEyeOff = ({ size = 16, className }: P) => (
  <svg {...base(size, className)}>
    <path d="M4 4l16 16" />
    <path d="M9.9 5.9A9.6 9.6 0 0 1 12 5.8c6 0 9.5 6.2 9.5 6.2a17 17 0 0 1-3.2 3.9M6.1 6.9A16.6 16.6 0 0 0 2.5 12S6 18.2 12 18.2c1 0 2-.2 2.9-.5" />
  </svg>
);

export const IconUsers = ({ size = 20, className }: P) => (
  <svg {...base(size, className)}>
    <circle cx="9" cy="8.5" r="3.2" />
    <path d="M3 19.5c.7-3.2 3.2-4.8 6-4.8s5.3 1.6 6 4.8" />
    <path d="M16 5.5a3 3 0 0 1 0 6M18 15c2 .6 3.3 2.1 3.8 4.5" />
  </svg>
);
