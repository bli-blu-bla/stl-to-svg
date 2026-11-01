import { useEffect, useState } from 'react';

// 'auto' follows the operating system; 'light' / 'dark' pin a theme.
const KEY = 'stl-to-svg:theme';
const ORDER = ['auto', 'light', 'dark'];

const readPref = () => {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'auto';
  } catch {
    return 'auto';
  }
};

const darkQuery = () => (typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null);

export function useTheme() {
  const [pref, setPref] = useState(readPref);
  const [systemDark, setSystemDark] = useState(() => !!darkQuery()?.matches);

  useEffect(() => {
    const mq = darkQuery();
    if (!mq) return undefined;
    const on = (e) => setSystemDark(e.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useEffect(() => {
    const root = document.documentElement;
    if (pref === 'auto') delete root.dataset.theme;
    else root.dataset.theme = pref;
    try {
      if (pref === 'auto') localStorage.removeItem(KEY);
      else localStorage.setItem(KEY, pref);
    } catch { /* not persisted — still applies for this visit */ }
  }, [pref]);

  const resolved = pref === 'auto' ? (systemDark ? 'dark' : 'light') : pref;
  const cycle = () => setPref((p) => ORDER[(ORDER.indexOf(p) + 1) % ORDER.length]);
  return { pref, resolved, cycle };
}
