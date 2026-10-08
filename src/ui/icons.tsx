import type { SVGProps } from 'react';

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size: number): SVGProps<SVGSVGElement> => ({
  width: size,
  height: size,
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 2.2,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
});

export const IconBack = ({ size = 24, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M15 5l-7 7 7 7" />
  </svg>
);
export const IconUp = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M6 15l6-6 6 6" />
  </svg>
);
export const IconDown = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);
export const IconClose = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M6 6l12 12M18 6L6 18" />
  </svg>
);
export const IconPlus = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);
export const IconMinus = ({ size = 22, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M5 12h14" />
  </svg>
);
export const IconMenu = ({ size = 24, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M4 7h16M4 12h16M4 17h10" />
  </svg>
);
export const IconGear = ({ size = 24, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <circle cx="12" cy="12" r="3.2" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z" />
  </svg>
);
export const IconDrop = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M12 3s6 6.6 6 11a6 6 0 0 1-12 0c0-4.4 6-11 6-11z" />
  </svg>
);
export const IconNoDrive = ({ size = 26, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M5 13l1.6-4.2A2 2 0 0 1 8.5 7.5h7a2 2 0 0 1 1.9 1.3L19 13" />
    <rect x="3.5" y="13" width="17" height="4.5" rx="1.5" />
    <path d="M6.5 17.5V19M17.5 17.5V19" />
    <path d="M3 3l18 18" />
  </svg>
);
export const IconPause = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M9 6v12M15 6v12" />
  </svg>
);
export const IconArrowUp = ({ size = 26, ...p }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.8} {...p}>
    <path d="M12 19V5M6 11l6-6 6 6" />
  </svg>
);
export const IconArrowDown = ({ size = 26, ...p }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.8} {...p}>
    <path d="M12 5v14M6 13l6 6 6-6" />
  </svg>
);
export const IconChevron = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M9 5l7 7-7 7" />
  </svg>
);
export const IconCrown = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <path d="M4 18h16M5 15l-1.5-8 5 3.5L12 5l3.5 5.5 5-3.5L19 15z" />
  </svg>
);
export const IconCheck = ({ size = 18, ...p }: IconProps) => (
  <svg {...base(size)} strokeWidth={2.8} {...p}>
    <path d="M5 12.5l4.5 4.5L19 7" />
  </svg>
);
export const IconCards = ({ size = 20, ...p }: IconProps) => (
  <svg {...base(size)} {...p}>
    <rect x="8" y="4" width="11" height="15" rx="2" />
    <path d="M5.5 7.5l-1 .3a1.6 1.6 0 0 0-1.1 2l2.6 9.4a1.6 1.6 0 0 0 2 1.1l3.5-1" />
  </svg>
);
