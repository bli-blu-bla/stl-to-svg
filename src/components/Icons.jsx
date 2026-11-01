import React from 'react';

// Stroke icons drawn on a 16-unit grid; they inherit the text colour.
const Icon = ({ size = 16, children, ...rest }) => (
  <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor"
    strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" {...rest}>
    {children}
  </svg>
);

export const Logo = () => (
  <svg width="28" height="28" viewBox="0 0 28 28" aria-hidden="true" className="logo">
    <rect x="1" y="1" width="26" height="26" rx="6" className="logo-bg" />
    <path d="M8 19 L14 7 L20 19 Z" fill="none" className="logo-fg" strokeWidth="1.6" strokeLinejoin="round" />
    <path d="M6 21.5 H22" className="logo-cut" strokeWidth="1.6" strokeLinecap="round" />
  </svg>
);

export const Upload = (p) => <Icon size={28} {...p}><path d="M8 10.3 V2.9 M4.9 6 L8 2.9 L11.1 6 M2.9 10.3 V12.6 H13.1 V10.3" /></Icon>;
export const Close = (p) => <Icon size={14} {...p}><path d="M3.5 3.5 L12.5 12.5 M12.5 3.5 L3.5 12.5" /></Icon>;
export const Download = (p) => <Icon {...p}><path d="M8 2 V10 M4.5 6.5 L8 10 L11.5 6.5 M3 13.5 H13" /></Icon>;
export const Ruler = (p) => <Icon {...p}><path d="M1.5 10.5 L10.5 1.5 L14.5 5.5 L5.5 14.5 Z M5 7 L6.5 8.5 M7 5 L8.5 6.5 M9 3 L10.5 4.5" strokeWidth="1.4" /></Icon>;
export const Shield = (p) => <Icon size={14} {...p}><path d="M8 1.8 L13.5 4 V8 C13.5 11.1 11.2 13.4 8 14.2 C4.8 13.4 2.5 11.1 2.5 8 V4 Z" strokeWidth="1.4" /></Icon>;
export const Code = (p) => <Icon {...p}><path d="M5.5 4 L1.5 8 L5.5 12 M10.5 4 L14.5 8 L10.5 12" /></Icon>;
export const Back = (p) => <Icon {...p}><path d="M10 3 L5 8 L10 13" strokeWidth="1.6" /></Icon>;
export const Distance = (p) => <Icon {...p}><path d="M2 8 H14 M2 5 V11 M14 5 V11" /></Icon>;
export const Angle = (p) => <Icon {...p}><path d="M2 13 H14 M2 13 L11 3 M7 13 A5 5 0 0 0 5.4 9.3" /></Icon>;
export const Snap45 = (p) => <Icon {...p}><path d="M2 14 H14 M2 14 L12 4" /></Icon>;
export const Plus = (p) => <Icon {...p}><path d="M8 3 V13 M3 8 H13" strokeWidth="1.6" /></Icon>;
export const Minus = (p) => <Icon {...p}><path d="M3 8 H13" strokeWidth="1.6" /></Icon>;
export const Sun = (p) => <Icon {...p}><circle cx="8" cy="8" r="3" /><path d="M8 1.5 V3 M8 13 V14.5 M1.5 8 H3 M13 8 H14.5 M3.4 3.4 L4.5 4.5 M11.5 11.5 L12.6 12.6 M3.4 12.6 L4.5 11.5 M11.5 4.5 L12.6 3.4" /></Icon>;
export const Moon = (p) => <Icon {...p}><path d="M13.5 9.6 A5.8 5.8 0 1 1 6.4 2.5 A4.6 4.6 0 0 0 13.5 9.6 Z" /></Icon>;
export const Auto = (p) => <Icon {...p}><circle cx="8" cy="8" r="5.8" /><path d="M8 2.2 A5.8 5.8 0 0 1 8 13.8 Z" fill="currentColor" stroke="none" /></Icon>;
