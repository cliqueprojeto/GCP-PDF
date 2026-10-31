import {t as translateUi} from "./i18n";
import { useEffect, useState } from "react";
import { BookmarkPlus, X } from "lucide-react";

/** Colours the user kept from the colour picker (eyedropper included). The preferences file owns them;
 * every picker in the window shares this copy and hears changes through one event. */
let saved: string[] | null = null, loading: Promise<void> | null = null;
const CHANGED = "gcp:saved-colors";
const publish = (colors: string[]) => { saved = colors; window.dispatchEvent(new Event(CHANGED)); };

export function useSavedColors() {
  const [colors, setColors] = useState<string[]>(saved ?? []);
  useEffect(() => {
    const update = () => setColors(saved ?? []);
    window.addEventListener(CHANGED, update);
    loading ??= window.gcp.getSavedColors().then(publish).catch(() => { loading = null; });
    update();
    return () => window.removeEventListener(CHANGED, update);
  }, []);
  const store = async (next: string[]) => publish(await window.gcp.setSavedColors(next));
  return {
    colors,
    add: (color: string) => store([color.toLowerCase(), ...colors.filter((c) => c !== color.toLowerCase())].slice(0, 60)),
    remove: (color: string) => store(colors.filter((c) => c !== color)),
  };
}

/** Saved colours as swatches next to a picker: click applies, × (or right click) deletes, the bookmark
 * keeps the picker's current colour for next time. */
export function SavedColors({ value, onPick }: { value: string | null | undefined; onPick: (color: string) => void }) {
  const { colors, add, remove } = useSavedColors();
  const current = value && /^#[0-9a-f]{6}$/i.test(value) ? value.toLowerCase() : null;
  return (
    <span className="saved-colors" role="group" aria-label={translateUi("Minhas cores")}>
      {colors.map((color) => (
        <span key={color} className="saved-color">
          <button type="button" className={`swatch ${current === color ? "active" : ""}`} style={{ background: color }} title={`${color} · ${translateUi("clique com o botão direito para excluir")}`}
            onClick={() => onPick(color)} onContextMenu={(e) => { e.preventDefault(); void remove(color); }} />
          <button type="button" className="saved-color-remove" title={translateUi("Excluir cor salva")} aria-label={translateUi("Excluir cor salva")} onClick={() => void remove(color)}><X size={9} /></button>
        </span>
      ))}
      <button type="button" className="swatch save-color" disabled={!current || colors.includes(current)} title={translateUi("Salvar a cor atual em Minhas cores")} onClick={() => current && void add(current)}><BookmarkPlus size={13} /></button>
    </span>
  );
}
