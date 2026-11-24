import React from 'react';
import {createRoot, type Root} from 'react-dom/client';
import {call, hasNative, nativeInfo, onNative, request} from './native';
import {writeFile, mkdir} from './shims/fs-promises';
import {host} from './shims/electron';
import {setQuickWindow} from './bridge';
import './mobile.css';

/**
 * What only the phone/tablet needs around the shared interface: safe areas, the Back button, files received
 * from other apps, the quick-action sheet, readiness of the splash screen and the office fonts used to measure
 * and print text exactly as the desktop does.
 */
type Insets = {top: number; bottom: number; left: number; right: number; keyboard: boolean};
const root = document.documentElement;
let mainWindow = 0;

function applyInsets(insets: Insets) {
  for (const side of ['top', 'bottom', 'left', 'right'] as const) root.style.setProperty(`--safe-${side}`, `${insets[side]}px`);
  root.classList.toggle('keyboard-open', insets.keyboard);
}

function classify() {
  const info = nativeInfo(), shortSide = Math.min(innerWidth, innerHeight);
  root.classList.add('mobile');
  root.classList.toggle('tablet', info.tablet || shortSide >= 600);
  root.classList.toggle('phone', !(info.tablet || shortSide >= 600));
  root.classList.toggle('landscape', innerWidth > innerHeight);
}

/** Fonts that Office documents name (Calibri, Cambria, Arial, Times New Roman, Courier New) are the metric
 * twins bundled with the app; canvas measuring needs them loaded before the first conversion. */
async function preloadFonts() {
  const families = ['Carlito', 'Calibri', 'Caladea', 'Cambria', 'Liberation Sans', 'Arial', 'Helvetica', 'Liberation Serif', 'Times New Roman', 'Liberation Mono', 'Courier New'];
  for (const family of families) for (const weight of ['400', '700']) for (const style of ['normal', 'italic']) {
    await document.fonts.load(`${style} ${weight} 16px "${family}"`).catch(() => {});
  }
}

// ---------- Back button: close the topmost layer first, then leave a document, then the app ----------
function visible(selector: string) { return [...document.querySelectorAll<HTMLElement>(selector)].some(el => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'); }
function back() {
  if (quickRoot) { closeQuick(); return; }
  const active = document.activeElement as HTMLElement | null;
  if (active && /INPUT|TEXTAREA|SELECT/.test(active.tagName) || active?.isContentEditable) { active.blur(); return; }
  // Readers handle Escape themselves: their menus, notes and panels first, then they close.
  if (visible('.modal, .modal-backdrop, .dropdown-menu, .context-menu, .popover, .m-sheet.open, .palette, .book-reader')) {
    for (const target of [window, document, document.body]) target.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', code: 'Escape', bubbles: true, cancelable: true}));
    return;
  }
  const handler = (window as unknown as {__gcpMobileBack?: () => boolean}).__gcpMobileBack;
  if (handler?.()) return;
  if (hasNative) call('exit');
}

// ---------- quick actions (Combinar / Converter para PDF) as a full-screen sheet ----------
let quickRoot: Root | null = null, quickHost: HTMLDivElement | null = null, quickId: number | null = null;
async function openQuick(id: number) {
  closeQuick(false);
  quickId = id; setQuickWindow(id);
  quickHost = document.createElement('div');
  quickHost.className = 'm-quick';
  document.body.appendChild(quickHost);
  const {default: Quick} = await import('../renderer/Quick');
  quickRoot = createRoot(quickHost);
  quickRoot.render(<React.StrictMode><div className="m-quick-frame"><button className="m-quick-close" aria-label="Fechar" onClick={() => closeQuick()}>×</button><Quick /></div></React.StrictMode>);
}
function closeQuick(closeWindow = true) {
  quickRoot?.unmount(); quickRoot = null;
  quickHost?.remove(); quickHost = null;
  if (closeWindow && quickId !== null) host.close(quickId);
  quickId = null; setQuickWindow(null);
}

async function openLaunched() {
  if (!hasNative) return;
  const paths = call<string[]>('launches');
  if (!paths.length) return;
  try { await host.invoke(mainWindow, 'gcp:openFiles', [paths]); }
  catch (error) { host.invoke(mainWindow, 'gcp:getWorkspace', []).catch(() => {}); console.error(error); window.dispatchEvent(new CustomEvent('gcp-mobile-error', {detail: String((error as Error).message ?? error)})); }
}

/** Shares the open document exactly as it is now (unsaved edits included) with any app on the device. */
async function share(id: string, name: string) {
  const bytes = await host.invoke(mainWindow, 'gcp:getComparisonPdf', [id]) as Uint8Array;
  const folder = `${nativeInfo().cache}/share/${Date.now()}`, file = `${folder}/${name.replace(/[\\/:*?"<>|]/g, '_').replace(/(\.pdf)?$/i, '.pdf')}`;
  await mkdir(folder, {recursive: true});
  await writeFile(file, bytes);
  await request('share', {paths: [file], mime: 'application/pdf', title: name});
}

/** Comics turn with a horizontal swipe, like books (the reader's own arrows and keys stay). */
function comicSwipes() {
  let start: {x: number; y: number; t: number} | null = null;
  document.addEventListener('touchstart', e => {
    const stage = (e.target as HTMLElement).closest?.('.comic-stage:not(.vertical):not(.hand)');
    start = stage && e.touches.length === 1 ? {x: e.touches[0]!.clientX, y: e.touches[0]!.clientY, t: Date.now()} : null;
  }, {passive: true});
  document.addEventListener('touchend', e => {
    if (!start) return;
    const touch = e.changedTouches[0]!, dx = touch.clientX - start.x, dy = touch.clientY - start.y;
    if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5 && Date.now() - start.t < 700)
      document.body.dispatchEvent(new KeyboardEvent('keydown', {key: dx < 0 ? 'ArrowRight' : 'ArrowLeft', bubbles: true}));
    start = null;
  }, {passive: true});
}

/**
 * Text on touch screens: a long press selects a word natively (Chrome's handles extend it). The page's own
 * text menu is the desktop right-click menu; it opens here once the selection rests, with the same actions.
 */
function touchTextSelection() {
  let touching = false, timer = 0;
  const synthetic = new WeakSet<Event>();
  addEventListener('touchstart', () => { touching = true; clearTimeout(timer); }, {passive: true, capture: true});
  // Chrome cancels the touch when it starts a native selection: that also ends the gesture.
  for (const type of ['touchend', 'touchcancel', 'pointercancel']) addEventListener(type, () => { touching = false; schedule(); }, {passive: true, capture: true});
  // The long press itself must not open the menu (it would cancel the native word selection).
  addEventListener('contextmenu', event => {
    if (synthetic.has(event)) return;
    if ((event.target as HTMLElement).closest?.('.textLayer')) event.stopPropagation();
  }, true);
  document.addEventListener('selectionchange', schedule);
  // Small text (a whole page fitted to a phone's width) is below what Chrome's own long press can hit: the app
  // selects the word under the finger itself, and dragging without lifting extends the selection.
  let press: {x: number; y: number; timer: number} | null = null, anchor: {node: Node; offset: number} | null = null;
  const caret = (x: number, y: number) => {
    const range = document.caretRangeFromPoint?.(x, y);
    return range && range.startContainer.nodeType === Node.TEXT_NODE && (range.startContainer.parentElement?.closest('.textLayer')) ? range : null;
  };
  addEventListener('touchstart', e => {
    clearTimeout(press?.timer); press = null; anchor = null;
    if (e.touches.length !== 1 || !(e.target as HTMLElement).closest?.('.page-sheet.tool-select .textLayer, .page-sheet.tool-markup .textLayer')) return;
    const {clientX: x, clientY: y} = e.touches[0]!;
    press = {x, y, timer: window.setTimeout(() => {
      // Chrome did select (a touchcancel came, or a selection exists): nothing to add.
      const selection = getSelection();
      if (!press || (selection && !selection.isCollapsed)) return;
      const range = caret(press.x, press.y);
      if (!range) return;
      const node = range.startContainer as Text, text = node.data;
      let start = range.startOffset, end = range.startOffset;
      while (start > 0 && /[\p{L}\p{N}@._/-]/u.test(text[start - 1]!)) start--;
      while (end < text.length && /[\p{L}\p{N}@._/-]/u.test(text[end]!)) end++;
      if (start === end) end = Math.min(text.length, end + 1);
      selection?.setBaseAndExtent(node, start, node, end);
      anchor = {node, offset: start};
      navigator.vibrate?.(12);
    }, 520)};
  }, {passive: true, capture: true});
  addEventListener('touchmove', e => {
    if (anchor && e.touches.length === 1) {
      e.preventDefault();
      const range = caret(e.touches[0]!.clientX, e.touches[0]!.clientY);
      if (range) getSelection()?.setBaseAndExtent(anchor.node, anchor.offset, range.startContainer, range.startOffset);
      return;
    }
    if (press && Math.hypot(e.touches[0]!.clientX - press.x, e.touches[0]!.clientY - press.y) > 10) { clearTimeout(press.timer); press = null; }
  }, {passive: false, capture: true});
  for (const type of ['touchend', 'touchcancel']) addEventListener(type, () => { clearTimeout(press?.timer); press = null; anchor = null; }, {passive: true, capture: true});
  function schedule() {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (touching) { schedule(); return; }
      const selection = getSelection();
      if (!selection || selection.isCollapsed || !selection.rangeCount) { window.dispatchEvent(new Event('gcp-selection-cleared')); return; }
      const layer = (selection.anchorNode instanceof Element ? selection.anchorNode : selection.anchorNode?.parentElement)?.closest('.textLayer');
      if (!layer || !selection.toString().trim()) return;
      const box = selection.getRangeAt(0).getBoundingClientRect();
      const event = new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: box.left + box.width / 2, clientY: box.bottom});
      synthetic.add(event);
      // The page shows its compact selection bar (not the full menu) for a selection made by touch.
      (window as unknown as {__gcpTouchSelection?: boolean}).__gcpTouchSelection = true;
      try { layer.dispatchEvent(event); } finally { (window as unknown as {__gcpTouchSelection?: boolean}).__gcpTouchSelection = false; }
    }, 350);
  }
}

export function startShell(windowId: number) {
  comicSwipes();
  if (navigator.maxTouchPoints > 0) touchTextSelection();
  mainWindow = windowId;
  (window as unknown as {gcpMobile: unknown}).gcpMobile = {share};
  classify();
  addEventListener('resize', classify);
  onNative<Insets>('insets', applyInsets);
  onNative('back', back);
  onNative('launch', () => void openLaunched());
  host.onEvent(event => {
    if (event.type === 'window' && event.hash === 'quick') void openQuick(event.id);
    else if (event.type === 'closed' && event.id === quickId) closeQuick(false);
    else if (event.type === 'error') window.dispatchEvent(new CustomEvent('gcp-mobile-error', {detail: `${event.title}: ${event.message}`}));
    else if (event.type === 'fullscreen') root.classList.toggle('immersive', event.value);
  });
  void preloadFonts();
  // The chosen tool category slides to the middle of the bottom bar.
  document.addEventListener('click', event => {
    const tab = (event.target as HTMLElement).closest?.('.ribbon-tabs > button');
    if (!tab) return;
    // Tapping the open category again folds its tools away (more room to read); any category unfolds them.
    const chrome = tab.closest('.chrome');
    if (chrome) chrome.classList.toggle('collapsed-tools', tab.classList.contains('active') && !chrome.classList.contains('collapsed-tools'));
    setTimeout(() => tab.scrollIntoView({inline: 'center', block: 'nearest', behavior: 'smooth'}), 30);
  }, true);
  // The interface is on screen once React renders the workspace for the first time.
  const ready = new MutationObserver(() => {
    if (!document.querySelector('#root > *')) return;
    ready.disconnect();
    requestAnimationFrame(() => { if (hasNative) call('ready'); void openLaunched(); });
  });
  ready.observe(document.getElementById('root')!, {childList: true, subtree: false});
}
