import type { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

function iconDefaults(p: IconProps, defaultSize = 22) {
  const { size, ...rest } = p;
  const s = size ?? defaultSize;
  return { width: s, height: s, ...rest };
}

export function CupGlyph({ size = 22, color = "currentColor", ...rest }: IconProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" {...rest}>
      <path d="M11 4 Q12 6 11 8 M16 3 Q17 5.5 16 8 M21 4 Q22 6 21 8"
        stroke={color} strokeWidth="1.4" strokeLinecap="round" fill="none" opacity="0.55"/>
      <path d="M6 11 H22 V18 Q22 24 14 24 Q6 24 6 18 Z" fill={color}/>
      <path d="M22 13 Q27 13 27 16.5 Q27 20 22 20" stroke={color} strokeWidth="1.8" fill="none"/>
      <ellipse cx="14" cy="26" rx="11" ry="1.5" fill={color} opacity="0.45"/>
    </svg>
  );
}

export function CupOutline({ size = 22, color = "currentColor", sw = 1.6 }: IconProps & { color?: string; sw?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none">
      <path d="M11 4 Q12 6 11 8 M16 3 Q17 5.5 16 8 M21 4 Q22 6 21 8"
        stroke={color} strokeWidth={sw - 0.2} strokeLinecap="round" opacity="0.7"/>
      <path d="M6 11 H22 V18 Q22 24 14 24 Q6 24 6 18 Z"
        stroke={color} strokeWidth={sw} strokeLinejoin="round" fill="none"/>
      <path d="M22 13 Q27 13 27 16.5 Q27 20 22 20"
        stroke={color} strokeWidth={sw} fill="none"/>
    </svg>
  );
}

export function Bean({ size = 16, color = "currentColor" }: IconProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <ellipse cx="12" cy="12" rx="6" ry="9" transform="rotate(-30 12 12)" fill={color}/>
      <path d="M9 6 Q12 12 15 18" stroke="var(--bg-elev)" strokeWidth="1.2" strokeLinecap="round"
        transform="rotate(-30 12 12)" />
    </svg>
  );
}

export function Sakura({ size = 28, color = "currentColor" }: IconProps & { color?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32">
      {Array.from({ length: 5 }).map((_, i) => (
        <g key={i} transform={`rotate(${i * 72} 16 16)`}>
          <path d="M16 6 Q12 9 12 13 Q12 16 16 16 Q20 16 20 13 Q20 9 16 6Z" fill={color}/>
          <path d="M16 9 L16 14" stroke="var(--bg-elev)" strokeWidth="0.8" opacity="0.6"/>
        </g>
      ))}
      <circle cx="16" cy="16" r="2.2" fill="#f4d96a"/>
    </svg>
  );
}

const sw = 1.6;

export function IconHome(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M3.5 11 L12 4 L20.5 11" /><path d="M5.5 10 V20 H10 V14 H14 V20 H18.5 V10" />
    </svg>
  );
}

export function IconStamp(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <rect x="4" y="4" width="16" height="16" rx="2"/>
      <path d="M9 9 L9 9.01 M15 9 L15 9.01 M9 15 L9 15.01 M15 15 L15 15.01"/>
      <circle cx="12" cy="12" r="2.2"/>
    </svg>
  );
}

export function IconGift(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <rect x="3.5" y="9" width="17" height="11" rx="1.5"/><path d="M3.5 13 H20.5"/><path d="M12 9 V20"/>
      <path d="M12 9 C9 9, 7 7.5, 7.5 5.5 C8 4, 10.5 4.5, 12 9 Z"/>
      <path d="M12 9 C15 9, 17 7.5, 16.5 5.5 C16 4, 13.5 4.5, 12 9 Z"/>
    </svg>
  );
}

export function IconSettings(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <circle cx="12" cy="12" r="3"/>
      <path d="M12 2 V5 M12 19 V22 M2 12 H5 M19 12 H22 M4.5 4.5 L6.5 6.5 M17.5 17.5 L19.5 19.5 M4.5 19.5 L6.5 17.5 M17.5 6.5 L19.5 4.5"/>
    </svg>
  );
}

export function IconBell(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M6 16 V11 a6 6 0 0 1 12 0 V16 L19 18 H5 Z"/><path d="M10 21 a2 2 0 0 0 4 0"/>
    </svg>
  );
}

export function IconBack(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M15 5 L8 12 L15 19"/>
    </svg>
  );
}

export function IconChevron(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M9 5 L16 12 L9 19"/>
    </svg>
  );
}

export function IconSpark(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...a}>
      <path d="M12 3 L13.5 10.5 L21 12 L13.5 13.5 L12 21 L10.5 13.5 L3 12 L10.5 10.5 Z"/>
    </svg>
  );
}

export function IconFire(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...a}>
      <path d="M13 2 C13 5 16 7 16 11 C16 13 15 14 13.5 14.5 C14 13 14 12 13 11 C12 13 8 14 8 17 C8 20 10 22 13 22 C16.5 22 19 19.5 19 16 C19 11 14 8 13 2 Z"/>
    </svg>
  );
}

export function IconShare(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M12 3 V15 M8 7 L12 3 L16 7"/><path d="M5 12 V20 H19 V12"/>
    </svg>
  );
}

export function IconCalendar(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <rect x="3.5" y="5" width="17" height="16" rx="2"/><path d="M3.5 10 H20.5"/><path d="M8 3 V7 M16 3 V7"/>
    </svg>
  );
}

export function IconMap(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M12 22 C7 16 4 13 4 9 a8 8 0 0 1 16 0 C20 13 17 16 12 22 Z"/><circle cx="12" cy="9" r="2.5"/>
    </svg>
  );
}

export function IconScan(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M4 8 V5 a1 1 0 0 1 1 -1 H8"/><path d="M20 8 V5 a1 1 0 0 0 -1 -1 H16"/>
      <path d="M4 16 V19 a1 1 0 0 0 1 1 H8"/><path d="M20 16 V19 a1 1 0 0 1 -1 1 H16"/>
      <path d="M3 12 H21"/>
    </svg>
  );
}

export function IconPlus(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" {...a}>
      <path d="M12 5 V19 M5 12 H19"/>
    </svg>
  );
}

export function IconCheck(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M5 12 L10 17 L19 7"/>
    </svg>
  );
}

export function IconTrophy(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M7 4 H17 V11 a5 5 0 0 1 -10 0 Z"/>
      <path d="M7 6 H4 V8 a3 3 0 0 0 3 3"/><path d="M17 6 H20 V8 a3 3 0 0 1 -3 3"/>
      <path d="M9 20 H15"/><path d="M12 16 V20"/>
    </svg>
  );
}

export function IconLogout(p: IconProps) {
  const a = iconDefaults(p, 24);
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={sw} strokeLinecap="round" strokeLinejoin="round" {...a}>
      <path d="M9 21 H5 a2 2 0 0 1 -2 -2 V5 a2 2 0 0 1 2 -2 H9" />
      <polyline points="16 17 21 12 16 7" />
      <line x1="21" y1="12" x2="9" y2="12" />
    </svg>
  );
}
