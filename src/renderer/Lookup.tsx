import {t as translateUi} from "./i18n";
import { useEffect, useState } from "react";
import { BookA, Languages, Copy, Sparkles, LoaderCircle, Save, ArrowRightLeft } from "lucide-react";
import { Modal } from "./Dialogs";
import type { DictionaryLanguage, DictionaryPreferences, SynonymResult, TranslationResult } from "../shared/types";

export type LookupMode = "synonyms" | "translate";
const NAMES: Record<DictionaryLanguage, string> = { pt: "Português", en: "Inglês", es: "Espanhol" };
const LANGS = Object.keys(NAMES) as DictionaryLanguage[];

/** Revisar > Sinônimos / Traduzir: offline dictionaries for the selected text. A click on a word copies
 * it; the languages chosen here can be kept as the defaults. */
export function LookupDialog({ text: initial, mode: initialMode, onClose, onCopy, onError }: { text: string; mode: LookupMode; onClose: () => void; onCopy: (text: string) => void; onError: (error: unknown) => void }) {
  const [mode, setMode] = useState(initialMode), [text, setText] = useState(initial), [query, setQuery] = useState(initial);
  const [prefs, setPrefs] = useState<DictionaryPreferences | null>(null), [saved, setSaved] = useState<DictionaryPreferences | null>(null);
  const [synonyms, setSynonyms] = useState<SynonymResult | null>(null), [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [busy, setBusy] = useState(false), [ai, setAi] = useState<string | null>(null), [aiBusy, setAiBusy] = useState(false);
  useEffect(() => { void window.gcp.getDictionaryPreferences().then((p) => { setPrefs(p); setSaved(p); }).catch(onError); }, []);
  useEffect(() => {
    if (!prefs || !query.trim()) return;
    let live = true; setBusy(true); setAi(null);
    const run = mode === "synonyms"
      ? window.gcp.lookupSynonyms(query.split(/\s+/).slice(0, 4).join(" "), prefs.synonyms).then((r) => { if (live) setSynonyms(r); })
      : window.gcp.lookupTranslation(query, prefs.from, prefs.to).then((r) => { if (live) setTranslation(r); });
    void run.catch(onError).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [mode, query, prefs?.synonyms, prefs?.from, prefs?.to]);
  const changed = !!prefs && !!saved && JSON.stringify(prefs) !== JSON.stringify(saved);
  const words = query.trim().split(/\s+/).length;
  const pick = (word: string) => onCopy(word);
  return (
    <Modal title={mode === "synonyms" ? translateUi("Sinônimos") : translateUi("Tradução")} description={translateUi("Dicionários abertos instalados com o GCP-PDF: funcionam sem internet. Clique numa palavra para copiar.")} onClose={onClose}>
      <div className="lookup">
        <div className="segmented lookup-modes" role="tablist">
          <button role="tab" aria-selected={mode === "synonyms"} className={mode === "synonyms" ? "active" : ""} onClick={() => setMode("synonyms")}><BookA size={14} />{" "}{translateUi("Sinônimos")}</button>
          <button role="tab" aria-selected={mode === "translate"} className={mode === "translate" ? "active" : ""} onClick={() => setMode("translate")}><Languages size={14} />{" "}{translateUi("Tradução")}</button>
        </div>
        <form className="lookup-query" onSubmit={(e) => { e.preventDefault(); setQuery(text.trim()); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} placeholder={translateUi("Palavra ou trecho")} aria-label={translateUi("Palavra ou trecho")} />
          <button className="button secondary" type="submit">{translateUi("Consultar")}</button>
        </form>
        {prefs && <div className="lookup-langs">
          {mode === "synonyms" ? (
            <label className="field inline">{translateUi("Idioma")}<select value={prefs.synonyms} onChange={(e) => setPrefs({ ...prefs, synonyms: e.target.value as DictionaryLanguage })}>{LANGS.map((l) => <option key={l} value={l}>{translateUi(NAMES[l])}</option>)}</select></label>
          ) : (<>
            <label className="field inline">{translateUi("De")}<select value={prefs.from} onChange={(e) => setPrefs({ ...prefs, from: e.target.value as DictionaryPreferences["from"] })}><option value="auto">{translateUi("Detectar")}</option>{LANGS.map((l) => <option key={l} value={l}>{translateUi(NAMES[l])}</option>)}</select></label>
            <button className="icon-button" title={translateUi("Inverter idiomas")} disabled={prefs.from === "auto" && !translation} onClick={() => { const from = prefs.from === "auto" ? translation!.from : prefs.from; setPrefs({ ...prefs, from: prefs.to, to: from }); }}><ArrowRightLeft size={14} /></button>
            <label className="field inline">{translateUi("Para")}<select value={prefs.to} onChange={(e) => setPrefs({ ...prefs, to: e.target.value as DictionaryLanguage })}>{LANGS.map((l) => <option key={l} value={l}>{translateUi(NAMES[l])}</option>)}</select></label>
          </>)}
          {changed && <button className="text-button" onClick={() => void window.gcp.setDictionaryPreferences(prefs).then((p) => { setPrefs(p); setSaved(p); }).catch(onError)}><Save size={13} />{" "}{translateUi("Usar sempre estes idiomas")}</button>}
        </div>}
        <div className="lookup-results" aria-live="polite">
          {busy && <p className="lookup-note"><LoaderCircle size={14} className="spin" />{" "}{translateUi("Consultando o dicionário…")}</p>}
          {!busy && mode === "synonyms" && synonyms && (synonyms.meanings.length ? <>
            {synonyms.base && <p className="lookup-note">{translateUi("Forma do dicionário:")}{" "}<strong>{synonyms.base}</strong></p>}
            {synonyms.meanings.map((m, i) => (
              <div key={i} className="lookup-group">
                {m.label && <div className="lookup-label">{m.label}</div>}
                <div className="lookup-words">{m.words.slice(0, 40).map((w) => <button key={w} className="chip" title={translateUi("Copiar")} onClick={() => pick(w)}>{w}</button>)}</div>
              </div>
            ))}
          </> : <p className="lookup-note">{translateUi("Nenhum sinônimo encontrado para")}{" "}“{synonyms.term}”.{words > 4 ? " " + translateUi("Selecione uma palavra ou expressão curta.") : ""}</p>)}
          {!busy && mode === "translate" && translation && <>
            <p className="lookup-note">{translateUi(NAMES[translation.from])}{" → "}{translateUi(NAMES[translation.to])}</p>
            {translation.entries.length === 0 && <p className="lookup-note">{translateUi("O texto já está no idioma de destino.")}</p>}
            {translation.entries.map((entry) => (
              <div key={entry.word} className="lookup-group">
                <div className="lookup-label">{entry.word}</div>
                <div className="lookup-words">{entry.translations.length ? entry.translations.map((w) => <button key={w} className="chip" onClick={() => pick(w)}>{w}</button>) : <span className="lookup-missing">{translateUi("sem tradução no dicionário")}</span>}</div>
              </div>
            ))}
            {words > 1 && <div className="lookup-ai">
              <p className="lookup-note">{translateUi("Frases são traduzidas palavra por palavra pelo dicionário. Para uma tradução corrida, use a IA configurada (o trecho é enviado ao provedor).")}</p>
              <button className="button secondary" disabled={aiBusy} onClick={() => { setAiBusy(true); void window.gcp.translateWithAi(query, translation.to).then(setAi).catch(onError).finally(() => setAiBusy(false)); }}>{aiBusy ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{" "}{translateUi("Traduzir frase com IA")}</button>
              {ai && <div className="lookup-ai-answer"><p>{ai}</p><button className="text-button" onClick={() => pick(ai)}><Copy size={13} />{" "}{translateUi("Copiar tradução")}</button></div>}
            </div>}
          </>}
        </div>
      </div>
    </Modal>
  );
}
