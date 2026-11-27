export interface AppAccentTheme {
  id: string;
  name: string;
  subtitle: string;
  accent: string;
  accentHover: string;
  accentFg: string;
  accentText: string;
  accentSoft: string;
  accentBorder: string;
}

export const APP_ACCENT_THEMES: AppAccentTheme[] = [
  {
    id: 'spotify-green',
    name: 'Spotify Green',
    subtitle: 'Vibrant signature green',
    accent: '#1db954',
    accentHover: '#1ed760',
    accentFg: '#000000',
    accentText: '#1ed760',
    accentSoft: 'rgba(29, 185, 84, 0.18)',
    accentBorder: 'rgba(29, 185, 84, 0.58)',
  },
  {
    id: 'apple-music-red',
    name: 'Apple Music Red',
    subtitle: 'Bold crimson rose',
    accent: '#fa243c',
    accentHover: '#ff3b53',
    accentFg: '#ffffff',
    accentText: '#ff4d63',
    accentSoft: 'rgba(250, 36, 60, 0.18)',
    accentBorder: 'rgba(250, 36, 60, 0.58)',
  },
  {
    id: 'tidal-blue',
    name: 'Tidal Blue',
    subtitle: 'Electric cyan blue',
    accent: '#00c8ff',
    accentHover: '#38d6ff',
    accentFg: '#000000',
    accentText: '#38d6ff',
    accentSoft: 'rgba(0, 200, 255, 0.18)',
    accentBorder: 'rgba(0, 200, 255, 0.58)',
  },
  {
    id: 'cobalt-blue',
    name: 'Cobalt Blue',
    subtitle: 'Deep studio blue',
    accent: '#2563eb',
    accentHover: '#3b82f6',
    accentFg: '#ffffff',
    accentText: '#60a5fa',
    accentSoft: 'rgba(37, 99, 235, 0.22)',
    accentBorder: 'rgba(59, 130, 246, 0.6)',
  },
];

export function getAppAccentTheme(themeId?: string): AppAccentTheme {
  const found = APP_ACCENT_THEMES.find((t) => t.id === themeId);
  return found || APP_ACCENT_THEMES[0];
}

export function applyAppAccentTheme(themeId?: string): void {
  if (typeof document === 'undefined') return;
  const theme = getAppAccentTheme(themeId);
  const root = document.documentElement;
  root.style.setProperty('--accent', theme.accent);
  root.style.setProperty('--accent-hover', theme.accentHover);
  root.style.setProperty('--accent-fg', theme.accentFg);
  root.style.setProperty('--accent-text', theme.accentText);
  root.style.setProperty('--accent-soft', theme.accentSoft);
  root.style.setProperty('--accent-border', theme.accentBorder);
}
