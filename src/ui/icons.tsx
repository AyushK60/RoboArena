// Minimal inline SVG icon set (16px grid, stroke-based).
interface P {
  size?: number;
}
const S = ({ children, size = 16 }: { children: React.ReactNode; size?: number }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    {children}
  </svg>
);

export const IconCursor = () => <S><path d="M4 2l8 6-3.5.8L10 13l-2-.9-1.5 2z" /></S>;
export const IconMove = () => <S><path d="M8 1v14M1 8h14M8 1L6 3m2-2l2 2M8 15l-2-2m2 2l2-2M1 8l2-2m-2 2l2 2M15 8l-2-2m2 2l-2 2" /></S>;
export const IconRack = () => <S><rect x="3" y="2" width="10" height="12" rx="1" /><path d="M3 8h10M8 2v12" /></S>;
export const IconBox = () => <S><path d="M8 2l5 2.5v7L8 14l-5-2.5v-7L8 2z" /><path d="M3 4.5L8 7l5-2.5M8 7v7" /></S>;
export const IconErase = () => <S><path d="M6 13L2.5 9.5a1 1 0 010-1.4l5.6-5.6a1 1 0 011.4 0l4 4a1 1 0 010 1.4L8 13H6z" /><path d="M5 6l5 5M14 13H8" /></S>;
export const IconPan = () => <S><path d="M8 8V3.5a1 1 0 012 0V8m0-1.5a1 1 0 012 0V8m0-.5a1 1 0 012 0V10a4 4 0 01-4 4h-1a5 5 0 01-5-5V7a1 1 0 012 0v1" /></S>;
export const IconPlay = () => <S><path d="M5 3l8 5-8 5V3z" fill="currentColor" /></S>;
export const IconPause = () => <S><path d="M5.5 3v10M10.5 3v10" strokeWidth="2" /></S>;
export const IconStep = () => <S><path d="M3 3l6 5-6 5V3z" fill="currentColor" /><path d="M12 3v10" strokeWidth="2" /></S>;
export const IconReset = () => <S><path d="M2 8a6 6 0 116 6" /><path d="M2 12V8h4" /></S>;
export const IconSkipStart = () => <S><path d="M13 3L6 8l7 5V3z" fill="currentColor" /><path d="M4 3v10" strokeWidth="2" /></S>;
export const IconSave = () => <S><path d="M3 3h8l3 3v7a1 1 0 01-1 1H3a1 1 0 01-1-1V4a1 1 0 011-1z" /><path d="M5 3v3h5V3M5 13v-4h6v4" /></S>;
export const IconExport = () => <S><path d="M8 2v8m0-8L5.5 4.5M8 2l2.5 2.5" /><path d="M3 9v3a1.5 1.5 0 001.5 1.5h7A1.5 1.5 0 0013 12V9" /></S>;
export const IconClose = () => <S><path d="M4 4l8 8M12 4l-8 8" /></S>;
export const IconCheck = () => <S><path d="M3 8.5L6.5 12 13 4.5" /></S>;
export const IconAlert = () => <S><path d="M8 2L1.5 13.5h13L8 2z" /><path d="M8 7v3m0 2v.5" /></S>;
export const IconClock = () => <S><circle cx="8" cy="8" r="6" /><path d="M8 5v3.5l2.5 1.5" /></S>;
export const IconRoute = () => <S><circle cx="3.5" cy="12.5" r="1.8" /><circle cx="12.5" cy="3.5" r="1.8" /><path d="M5 12.5h4a3 3 0 003-3v-2" strokeDasharray="2 2" /></S>;
export const IconChart = () => <S><path d="M2 13.5h12" /><path d="M4 13V8m4 5V4m4 9V6.5" strokeWidth="2" /></S>;
export const IconBook = () => <S><path d="M2 3.5A1.5 1.5 0 013.5 2H7a2 2 0 012 2v10a2 2 0 00-2-2H2v-8.5z" /><path d="M14 3.5A1.5 1.5 0 0012.5 2H9a2 2 0 00-2 2v10a2 2 0 012-2h5V3.5z" /></S>;
export const IconFit = () => <S><path d="M2 6V2h4M14 6V2h-4M2 10v4h4M14 10v4h-4" /><rect x="5.5" y="5.5" width="5" height="5" rx="0.5" /></S>;
export const IconPlus = () => <S><path d="M8 3v10M3 8h10" /></S>;
export const IconMinus = () => <S><path d="M3 8h10" /></S>;
export const IconRobot = () => <S><rect x="3" y="5" width="10" height="8" rx="2" /><path d="M8 2v3M6 9h.01M10 9h.01M6 11.5h4" /></S>;
export const IconShield = () => <S><path d="M8 2l5.5 2v4.5c0 3-2.3 5.5-5.5 7-3.2-1.5-5.5-4-5.5-7V4L8 2z" /><path d="M6 8l1.5 1.5L10.5 6.5" /></S>;
export const IconBattery = () => <S><rect x="2" y="5" width="10" height="6" rx="1.5" /><path d="M14 7v2" strokeWidth="2" /><path d="M4.5 7.5h3v1h-3z" fill="currentColor" /></S>;
export const IconList = () => <S><path d="M5.5 4h8m-8 4h8m-8 4h8" /><path d="M2.5 4h.01M2.5 8h.01M2.5 12h.01" strokeWidth="2" /></S>;
export const IconZoomIn = () => <S><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14M7 5v4M5 7h4" /></S>;
export const IconZoomOut = () => <S><circle cx="7" cy="7" r="4.5" /><path d="M10.5 10.5L14 14M5 7h4" /></S>;
export const IconUndo = () => <S><path d="M3 6h7a3.5 3.5 0 010 7H6" /><path d="M3 6l3-3M3 6l3 3" /></S>;
export const IconRedo = () => <S><path d="M13 6H6a3.5 3.5 0 000 7h4" /><path d="M13 6l-3-3m3 3l-3 3" /></S>;
export const IconSun = () => <S><circle cx="8" cy="8" r="3" /><path d="M8 1.5v1.5M8 13v1.5M1.5 8H3M13 8h1.5M3.4 3.4l1 1M11.6 11.6l1 1M12.6 3.4l-1 1M4.4 11.6l-1 1" /></S>;
export const IconMoon = () => <S><path d="M13.5 9.5A5.5 5.5 0 016.5 2.5a5.5 5.5 0 107 7z" /></S>;
export const IconLogo = () => (
  <svg width="28" height="28" viewBox="0 0 26 26" fill="none" aria-hidden="true">
    <rect x="1" y="1" width="24" height="24" rx="5" stroke="currentColor" strokeWidth="1.5" />
    <rect x="6.5" y="10.5" width="13" height="8" rx="1.8" stroke="currentColor" strokeWidth="1.6" />
    <path d="M13 8v2.5" stroke="currentColor" strokeWidth="1.6" />
    <circle cx="13" cy="6.3" r="1.9" fill="#ff6b3d" />
    <circle cx="10.4" cy="14.5" r="1.1" fill="currentColor" />
    <circle cx="15.6" cy="14.5" r="1.1" fill="currentColor" />
  </svg>
);
