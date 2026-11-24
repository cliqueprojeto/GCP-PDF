import type {GcpBridge} from '../shared/types';
import {host} from './shims/electron';

/** window.gcp on Android: the preload's contract, served in-process by the desktop main process. Quick actions
 * (combine/convert) belong to the quick window the mobile shell shows over the workspace. */
const LISTENERS: Record<string, string> = {onLanguage: 'language', onWorkspace: 'workspace', onAction: 'action', onQuickState: 'quick', onPrompt: 'prompt'};
const QUICK = new Set(['getQuickState', 'quickAddFiles', 'quickRun', 'quickChooseFolder', 'quickReveal', 'quickOpen']);
let quickWindow: number | null = null;
const quickWatchers = new Set<() => void>();
function onQuickChange(listener: () => void) { quickWatchers.add(listener); return () => { quickWatchers.delete(listener); }; }
export function setQuickWindow(id: number | null) { quickWindow = id; for (const watcher of quickWatchers) watcher(); }

function message(error: unknown) { return error instanceof Error ? error.message : 'Não foi possível concluir a operação.'; }

export function createBridge(mainWindow: number): GcpBridge {
  const cache = new Map<string, unknown>();
  return new Proxy({} as GcpBridge, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      if (cache.has(property)) return cache.get(property);
      let value: unknown;
      if (property === 'pathsForFiles') value = () => [];
      else if (LISTENERS[property]) {
        const channel = 'gcp:' + LISTENERS[property];
        value = (listener: (value: unknown) => void) => {
          // Both the workspace window and an open quick window speak on these channels.
          const stops = new Map<number, () => void>([[mainWindow, host.listen(mainWindow, channel, listener)]]);
          const attach = () => { if (quickWindow !== null && !stops.has(quickWindow)) stops.set(quickWindow, host.listen(quickWindow, channel, listener)); };
          attach();
          const stopWatching = onQuickChange(attach);
          return () => { stopWatching(); for (const stop of stops.values()) stop(); };
        };
      } else {
        value = async (...args: unknown[]) => {
          const target = QUICK.has(property) ? quickWindow : mainWindow;
          if (target === null) { if (property === 'getQuickState') return null; throw new Error('A janela de ação rápida foi fechada.'); }
          try { return await host.invoke(target, 'gcp:' + property, args); }
          catch (error) { throw new Error(message(error)); }
        };
      }
      cache.set(property, value);
      return value;
    },
  });
}
