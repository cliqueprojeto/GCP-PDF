/** Stable preference IDs. The two original IDs keep existing installations unchanged. */
export const THEMES = [
  {id: 'light', name: 'Lavanda', mode: 'light', bg: '#f7f6fa', surface: '#ffffff', accent: '#7446e8'},
  {id: 'light-ocean', name: 'Brisa', mode: 'light', bg: '#edf5fa', surface: '#ffffff', accent: '#196b9d'},
  {id: 'light-sand', name: 'Areia', mode: 'light', bg: '#f7f3eb', surface: '#fffcf5', accent: '#906027'},
  {id: 'dark', name: 'Ametista', mode: 'dark', bg: '#14131b', surface: '#1d1b27', accent: '#a282ff'},
  {id: 'dark-ocean', name: 'Oceano', mode: 'dark', bg: '#101b25', surface: '#172735', accent: '#6cc8ef'},
  {id: 'dark-forest', name: 'Floresta', mode: 'dark', bg: '#131e1b', surface: '#1c2b25', accent: '#86d9b0'},
] as const;
export type Theme = typeof THEMES[number]['id'];
export function isTheme(value: unknown): value is Theme { return THEMES.some(theme => theme.id === value); }
export function themeMode(value: Theme): 'light' | 'dark' { return THEMES.find(theme => theme.id === value)!.mode; }
