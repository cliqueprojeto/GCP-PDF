import {t} from './i18n';
import {THEMES, themeMode, type Theme} from '../shared/themes';
import {Modal} from './Dialogs';

export function applyTheme(theme: Theme) {
  document.documentElement.dataset.theme = themeMode(theme);
  document.documentElement.dataset.palette = theme;
}
export function ThemeOptions({theme, onTheme}: {theme: Theme; onTheme: (theme: Theme) => void}) {
  return <div className="theme-gallery">{(['light', 'dark'] as const).map(mode => <section key={mode}>
    <h4>{t(mode === 'light' ? 'Temas claros' : 'Temas escuros')}</h4>
    <div className="theme-options">{THEMES.filter(item => item.mode === mode).map(item => <button key={item.id} aria-pressed={theme === item.id} className={theme === item.id ? 'selected' : ''} onClick={() => onTheme(item.id)}>
      <span className="palette-preview" style={{background: item.bg, borderColor: item.accent}}><i style={{background: item.accent}}/><i style={{background: item.surface}}/><i style={{background: item.accent}}/></span>
      <span>{t(item.name)}</span>{theme === item.id && <span aria-hidden="true"> ✓</span>}
    </button>)}</div>
  </section>)}</div>;
}
export function ThemeWelcome({theme, onTheme, onClose}: {theme: Theme; onTheme: (theme: Theme) => void; onClose: () => void}) {
  return <Modal title={t('Seu espaço, suas cores')} description={t('Escolha o tema para começar. Você pode mudar depois em Configurações › Aparência.')} onClose={onClose} wide>
    <ThemeOptions theme={theme} onTheme={onTheme}/>
    <div className="modal-footer"><button className="button primary" onClick={onClose}>{t('Começar a usar')}</button></div>
  </Modal>;
}
