import {t as translateUi} from "./i18n";
import { useEffect, useState, useRef } from "react";
import { BookA, Languages, Copy, Sparkles, LoaderCircle, Save, ArrowRightLeft } from "lucide-react";
import { Modal } from "./Dialogs";
import type { DictionaryLanguage, DictionaryPreferences, SynonymResult, TranslationResult } from "../shared/types";

export type LookupMode = "synonyms" | "translate";
const NAMES: Record<DictionaryLanguage, string> = { pt: "Português", en: "Inglês", es: "Espanhol" };
const terms = (value: string) => [...new Set(value.match(/[\p{L}\p{N}]+(?:[-'][\p{L}\p{N}]+)*/gu) ?? [])];
const firstTerm = (value: string) => terms(value).find(word => word.length > 2) ?? terms(value)[0] ?? value;
const LANGS = Object.keys(NAMES) as DictionaryLanguage[];

/** Revisar > Sinônimos / Traduzir: offline dictionaries for the selected text. A click on a word copies
 * it; the languages chosen here can be kept as the defaults. */
export function LookupDialog({ text: initial, mode: initialMode, onClose, onCopy, onError }: { text: string; mode: LookupMode; onClose: () => void; onCopy: (text: string) => Promise<void>; onError: (error: unknown) => void }) {
  const [mode, setMode] = useState(initialMode), [text, setText] = useState(initial), [query, setQuery] = useState(initial);
  const [synonymTerm, setSynonymTerm] = useState(firstTerm(initial));
  const [error, setError] = useState(""), [copied, setCopied] = useState("");
  const request = useRef(0);
  const [prefs, setPrefs] = useState<DictionaryPreferences | null>(null), [saved, setSaved] = useState<DictionaryPreferences | null>(null);
  const [synonyms, setSynonyms] = useState<SynonymResult | null>(null), [translation, setTranslation] = useState<TranslationResult | null>(null);
  const [busy, setBusy] = useState(false), [ai, setAi] = useState<string | null>(null), [aiBusy, setAiBusy] = useState(false);
  useEffect(() => { void window.gcp.getDictionaryPreferences().then((p) => { setPrefs(p); setSaved(p); }).catch(onError); }, []);
  useEffect(() => {
    setSynonyms(null); setTranslation(null); setError(""); setCopied(""); setAi(null); setAiBusy(false); request.current++;
    if (!prefs || !query.trim()) { setBusy(false); return; }
    let live = true; setBusy(true); setAi(null);
    const run = mode === "synonyms"
      ? window.gcp.lookupSynonyms(synonymTerm, prefs.synonyms).then((r) => { if (live) setSynonyms(r); })
      : window.gcp.lookupTranslation(query, prefs.from, prefs.to).then((r) => { if (live) setTranslation(r); });
    void run.catch((e) => { if (live) setError(String(e instanceof Error ? e.message : e)); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [mode, query, synonymTerm, prefs?.synonyms, prefs?.from, prefs?.to]);
  const changed = !!prefs && !!saved && JSON.stringify(prefs) !== JSON.stringify(saved);
  const words = query.trim().split(/\s+/).length;
  const pick = (word: string) => { void onCopy(word).then(() => setCopied(word)).catch(e => setError(String(e))); };
  useEffect(() => () => { request.current++; }, []);
  return (
    <Modal title={mode === "synonyms" ? translateUi("Sinônimos") : translateUi("Tradução")} description={translateUi("Dicionários abertos instalados com o GCP-PDF: funcionam sem internet. Clique numa palavra para copiar.")} onClose={onClose} wide>
      <div className="lookup">
        <div className="segmented lookup-modes" role="tablist">
          <button role="tab" aria-selected={mode === "synonyms"} className={mode === "synonyms" ? "active" : ""} onClick={() => setMode("synonyms")}><BookA size={14} />{" "}{translateUi("Sinônimos")}</button>
          <button role="tab" aria-selected={mode === "translate"} className={mode === "translate" ? "active" : ""} onClick={() => setMode("translate")}><Languages size={14} />{" "}{translateUi("Tradução")}</button>
        </div>
        <form className="lookup-query" onSubmit={(e) => { e.preventDefault(); setQuery(text.trim()); setSynonymTerm(firstTerm(text.trim())); }}>
          <input value={text} onChange={(e) => setText(e.target.value)} maxLength={mode === "synonyms" ? 200 : 2000} placeholder={translateUi("Palavra ou trecho")} aria-label={translateUi("Palavra ou trecho")} />
          <button className="button secondary" type="submit">{translateUi("Consultar")}</button>
        </form>
        {mode === "synonyms" && terms(query).length > 1 && <label className="field lookup-term">{translateUi("Escolha a palavra do trecho")}
          <select value={synonymTerm} onChange={e => setSynonymTerm(e.target.value)}>{[...new Set([query, ...terms(query)])].map(word => <option key={word} value={word}>{word}</option>)}</select>
        </label>}
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
        <div className="lookup-results" aria-live="polite" aria-busy={busy}>
          {error && <p role="alert" className="lookup-note">{error}</p>}
          {!query.trim() && <p className="lookup-note">{translateUi("Digite uma palavra ou trecho para consultar.")}</p>}
          {busy && <p className="lookup-note"><LoaderCircle size={14} className="spin" />{" "}{translateUi("Consultando o dicionário…")}</p>}
          {!busy && mode === "synonyms" && synonyms && (synonyms.meanings.length ? <>
            {synonyms.base && <p className="lookup-note">{translateUi("Forma do dicionário:")}{" "}<strong>{synonyms.base}</strong></p>}
            {synonyms.meanings.map((m, i) => (
              <div key={i} className="lookup-group">
                <div className="lookup-label">{translateUi("Sentido")} {i + 1}{m.label ? ` · ${m.label}` : ""}</div>
                <div className="lookup-words">{m.words.map((w) => <button key={w} className="chip" title={translateUi("Copiar")} onClick={() => pick(w)}>{w}</button>)}</div>
              </div>
            ))}
          </> : <p className="lookup-note">{translateUi("Nenhum sinônimo encontrado para")}{" "}“{synonyms.term}”.{words > 4 ? " " + translateUi("Selecione uma palavra ou expressão curta.") : ""}</p>)}
          {!busy && mode === "translate" && translation && <>
            <p className="lookup-note">{translateUi(NAMES[translation.from])}{" → "}{translateUi(NAMES[translation.to])}</p>
            {translation.from === translation.to && <p className="lookup-note">{translateUi("O texto já está no idioma de destino.")}</p>}
            {translation.entries.map((entry) => (
              <div key={entry.word} className="lookup-group">
                <div className="lookup-label">{entry.word}</div>
                <div className="lookup-words">{entry.translations.length ? entry.translations.map((w) => <button key={w} className="chip" onClick={() => pick(w)}>{w}</button>) : <span className="lookup-missing">{translateUi("sem tradução no dicionário")}</span>}</div>
              </div>
            ))}
            {words > 1 && translation.from !== translation.to && <div className="lookup-ai">
              <p className="lookup-note">{translateUi("Frases são traduzidas palavra por palavra pelo dicionário. Para uma tradução corrida, use a IA configurada (o trecho é enviado ao provedor).")}</p>
              <button className="button secondary" disabled={aiBusy} onClick={() => { const token = ++request.current; setAiBusy(true); setError(""); void window.gcp.translateWithAi(query, translation.to).then(value => { if (token === request.current) setAi(value); }).catch(e => { if (token === request.current) setError(String(e)); }).finally(() => { if (token === request.current) setAiBusy(false); }); }}>{aiBusy ? <LoaderCircle size={14} className="spin" /> : <Sparkles size={14} />}{" "}{translateUi("Traduzir frase com IA")}</button>
              {ai && <div className="lookup-ai-answer"><p>{ai}</p><button className="text-button" onClick={() => pick(ai)}><Copy size={13} />{" "}{translateUi("Copiar tradução")}</button></div>}
            </div>}
          </>}
        </div>
        <footer className="lookup-footer"><span>{translateUi(mode === "synonyms" ? "Sinônimos: OpenWN-PT / VERO · WordNet · OpenThesaurus" : "Tradução: WikDict · consulta local, palavra por palavra")}</span><span role="status">{copied ? translateUi("Copiado: {word}", {word: copied}) : translateUi("Clique em uma sugestão para copiar.")}</span></footer>
      </div>
    </Modal>
  );
}
