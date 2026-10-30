import {getLocale,t as translateUi} from "./i18n";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowRight,
  ArrowUpRight,
  Check,
  Clock3,
  FileText,
  FolderOpen,
  Heart,
  Layers3,
  LoaderCircle,
  Plus,
  Search,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import type { DocumentInfo } from "../shared/types";
import appIconUrl from "../../assets/icon.svg?url";
import "./Home.css";

const HISTORY_KEY = "gcp.recent-files";
const HISTORY_LIMIT = 300;
export interface RecentFile {
  path: string;
  name: string;
  openedAt: number;
  pageCount: number;
}
export function fileKey(path: string): string {
  return /^(?:[a-z]:[\\/]|\\\\)/i.test(path)
    ? path.replace(/\\/g, "/").toLocaleLowerCase("pt-BR")
    : path;
}
export function readRecentFiles(): RecentFile[] {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(HISTORY_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    const seen = new Set<string>();
    return raw
      .filter((item): item is RecentFile => {
        if (!item || typeof item !== "object") return false;
        const value = item as Partial<RecentFile>;
        if (
          typeof value.path !== "string" ||
          !value.path ||
          value.path.includes("\0") ||
          typeof value.name !== "string" ||
          !value.name ||
          !Number.isFinite(value.openedAt) ||
          !Number.isInteger(value.pageCount) ||
          value.pageCount! < 1
        )
          return false;
        const key = fileKey(value.path);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => b.openedAt - a.openedAt)
      .slice(0, HISTORY_LIMIT);
  } catch {
    return [];
  }
}
function saveRecentFiles(items: RecentFile[]) {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {}
}
export function useRecentFiles(documents: DocumentInfo[], activeId?: string) {
  const [items, setItems] = useState<RecentFile[]>(readRecentFiles);
  const observed = useRef(new Set<string>()),
    previousActive = useRef<string | undefined>(undefined);
  const metadata = JSON.stringify(
    documents.map(({ id, name, path, pageCount }) => ({
      id,
      name,
      path,
      pageCount,
    })),
  );
  useEffect(() => {
    const now = Date.now(),
      updates: RecentFile[] = [];
    for (const doc of documents) {
      if (!doc.path) continue;
      const token = `${doc.id}\n${doc.path}`;
      if (
        !observed.current.has(token) ||
        (doc.id === activeId && previousActive.current !== activeId)
      )
        updates.push({
          path: doc.path,
          name: doc.name,
          openedAt: now,
          pageCount: doc.pageCount,
        });
      observed.current.add(token);
    }
    previousActive.current = activeId;
    if (!updates.length) return;
    const changed = new Set(updates.map((item) => fileKey(item.path))),
      next = [
        ...updates,
        ...readRecentFiles().filter((item) => !changed.has(fileKey(item.path))),
      ]
        .sort((a, b) => b.openedAt - a.openedAt)
        .slice(0, HISTORY_LIMIT);
    saveRecentFiles(next);
    setItems(next);
  }, [metadata, activeId]);
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key === HISTORY_KEY || event.key === null)
        setItems(readRecentFiles());
    };
    window.addEventListener("storage", changed);
    return () => window.removeEventListener("storage", changed);
  }, []);
  const remove = useCallback((path: string) => {
    const next = readRecentFiles().filter(
      (item) => fileKey(item.path) !== fileKey(path),
    );
    saveRecentFiles(next);
    setItems(next);
  }, []);
  const clear = useCallback(() => {
    saveRecentFiles([]);
    setItems([]);
  }, []);
  return { items, remove, clear };
}
function folderName(path: string) {
  const slash = Math.max(path.lastIndexOf("/"), path.lastIndexOf("\\"));
  return slash > 0 ? path.slice(0, slash) : path;
}
function openedDate(value: number) {
  const date = new Date(value),
    now = new Date(),
    today = new Date(now.getFullYear(), now.getMonth(), now.getDate()),
    day = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const days = Math.round((today.getTime() - day.getTime()) / 86400000),
    time = date.toLocaleTimeString(getLocale(), {
      hour: "2-digit",
      minute: "2-digit",
    });
  return days === 0
    ? translateUi("Hoje, {time}",{time})
    : days === 1
      ? translateUi("Ontem, {time}",{time})
      : date.toLocaleDateString(getLocale(), {
          day: "2-digit",
          month: "2-digit",
          year: "numeric",
        });
}
function resumePage(path: string): number | null {
  try {
    const value = JSON.parse(localStorage.getItem("gcp.last-page") ?? "{}")[
      path.toLowerCase()
    ];
    return value && Number.isInteger(value.page) && value.page >= 0
      ? value.page
      : null;
  } catch {
    return null;
  }
}
interface HomeProps {
  files: RecentFile[];
  documents: DocumentInfo[];
  activeId?: string;
  currentPage: number;
  ready: boolean;
  onOpen: (paths?: string[]) => Promise<void>;
  onNew: () => void;
  onActivate: (id: string) => void;
  onRemove: (path: string) => void;
  onClear: () => void;
  onCombine: () => void;
  onConvert: () => void;
  onSupport: () => void;
}
export function Home({
  files,
  documents,
  activeId,
  currentPage,
  ready,
  onOpen,
  onNew,
  onActivate,
  onRemove,
  onClear,
  onCombine,
  onConvert,
  onSupport,
}: HomeProps) {
  const [query, setQuery] = useState(""),
    [opening, setOpening] = useState<string | null>(null),
    [error, setError] = useState("");
  const filtered = files.filter((item) =>
    `${item.name}\n${item.path}`
      .toLocaleLowerCase("pt-BR")
      .includes(query.trim().toLocaleLowerCase("pt-BR")),
  );
  const active = documents.find((item) => item.id === activeId),
    opened = new Map(
      documents
        .filter((item) => item.path)
        .map((item) => [fileKey(item.path!), item]),
    );
  async function openFile(file: RecentFile) {
    const existing = opened.get(fileKey(file.path));
    if (existing) {
      onActivate(existing.id);
      return;
    }
    setOpening(file.path);
    setError("");
    try {
      await onOpen([file.path]);
    } catch (cause) {
      setError(String(cause instanceof Error ? cause.message : cause));
    } finally {
      setOpening(null);
    }
  }
  return (
    <div className="home-screen" data-testid="home-screen">
      <section className="home-hero">
        <div>
          <div className="home-kicker">
            <img src={appIconUrl} alt="" />{" "}{translateUi("SEU ESPAÇO DE DOCUMENTOS")}{" "}</div>
          <h1>{" "}{translateUi("Seu próximo documento")}{" "}<br />
            <span>{translateUi("começa por aqui.")}</span>
          </h1>
          <p>{" "}{translateUi("Abra um arquivo, retome sua leitura ou reúna novas ideias.")}{" "}<br />{" "}{translateUi("Tudo organizado, com seus documentos no seu computador.")}{" "}</p>
          <div className="home-primary-actions">
            <button
              className="button primary"
              onClick={() =>
                void onOpen().catch((cause) =>
                  setError(
                    String(cause instanceof Error ? cause.message : cause),
                  ),
                )
              }
              disabled={!ready}
            >
              <FolderOpen size={18} />{" "}{translateUi("Abrir documentos")}{" "}<kbd>{translateUi("Ctrl+O")}</kbd>
            </button>
            <button
              className="button secondary"
              onClick={onNew}
              disabled={!ready}
            >
              <Plus size={18} />{" "}{translateUi("Novo PDF")}{" "}</button>
          </div>
        </div>
        <div className="home-side-card">
          {active ? (
            <>
              <span className="home-card-kicker">
                <Check size={14} />{" "}{translateUi("ABERTO NESTA JANELA")}{" "}</span>
              <div className="home-side-file">
                <div className="home-file-illustration">
                  <FileText size={26} />
                </div>
                <div>
                  <strong title={active.name}>{active.name}</strong>
                  <small>{translateUi("Página")}{" "}{currentPage + 1}{" "}{translateUi("de")}{" "}{active.pageCount}</small>
                </div>
              </div>
              <p>{translateUi("Suas abas e alterações continuam abertas.")}</p>
              <button
                className="button secondary"
                onClick={() => onActivate(active.id)}
              >{" "}{translateUi("Voltar ao documento")}{" "}<ArrowRight size={15} />
              </button>
            </>
          ) : (
            <>
              <span className="home-card-kicker">
                <ShieldCheck size={14} />{" "}{translateUi("LOCAL POR NATUREZA")}{" "}</span>
              <div className="home-side-file">
                <div className="home-file-illustration">
                  <ShieldCheck size={26} />
                </div>
                <div>
                  <strong>{translateUi("Seu trabalho. Seu controle.")}</strong>
                  <small>{translateUi("Leia, edite e assine sem cadastro.")}</small>
                </div>
              </div>
              <p>{translateUi("Você escolhe quando compartilhar.")}</p>
            </>
          )}
        </div>
      </section>
      {documents.length > 0 && (
        <section className="home-open-section">
          <div className="home-section-title">
            <h2>{" "}{translateUi("Continuar trabalhando")}{" "}<span>{documents.length}</span>
            </h2>
            <span>{translateUi("Os documentos permanecem nas abas.")}</span>
          </div>
          <div className="home-open-tabs">
            {documents.map((doc) => (
              <button
                key={doc.id}
                className={doc.id === activeId ? "current" : ""}
                onClick={() => onActivate(doc.id)}
                title={doc.path || doc.name}
              >
                <FileText size={16} />
                <span>{doc.name}</span>
                {doc.revision !== doc.savedRevision && (
                  <i title={translateUi("Alterações não salvas")} />
                )}
                <ArrowUpRight size={14} />
              </button>
            ))}
          </div>
        </section>
      )}
      <div className="home-main-grid">
        <section className="home-history">
          <div className="home-section-title">
            <h2>
              <Clock3 size={17} />{" "}{translateUi("Arquivos recentes")}{" "}<span>{files.length}</span>
            </h2>
            {files.length > 0 && (
              <button
                className="text-button"
                onClick={onClear}
                title={translateUi("Limpar somente o histórico. Os arquivos não serão excluídos.")}
              >
                <Trash2 size={13} />{" "}{translateUi("Limpar histórico")}{" "}</button>
            )}
          </div>
          <div className="home-search">
            <Search size={16} />
            <input
              aria-label={translateUi("Pesquisar arquivos recentes")}
              placeholder={translateUi("Pesquisar por nome ou pasta")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <button
                aria-label={translateUi("Limpar pesquisa de recentes")}
                onClick={() => setQuery("")}
              >
                <X size={15} />
              </button>
            )}
          </div>
          {error && (
            <p className="inline-error" role="alert">
              {error}
            </p>
          )}
          {filtered.length > 0 ? (
            <div className="home-recent-list">
              {filtered.map((file) => {
                const open = opened.get(fileKey(file.path)),
                  resume = resumePage(file.path);
                return (
                  <div
                    className="home-recent-row"
                    key={file.path}
                    data-recent-path={file.path}
                  >
                    <button
                      className="home-recent-open"
                      onClick={() => void openFile(file)}
                      disabled={!!opening}
                      title={`${file.path}\n${open ? "Voltar à aba aberta" : "Abrir arquivo"}`}
                    >
                      <span className="home-recent-icon">
                        {opening === file.path ? (
                          <LoaderCircle size={20} className="spin" />
                        ) : (
                          <FileText size={21} />
                        )}
                      </span>
                      <span className="home-recent-description">
                        <strong>{file.name}</strong>
                        <small title={folderName(file.path)}>
                          {folderName(file.path)}
                        </small>
                      </span>
                      <span className="home-recent-meta">
                        {open ? (
                          <b>{translateUi("Aberto")}</b>
                        ) : resume !== null && resume < file.pageCount ? (
                          <span>{translateUi("Continuar na página")}{" "}{resume + 1}</span>
                        ) : (
                          <span>
                            {file.pageCount}{" "}{translateUi("página")}{" "}{file.pageCount !== 1 ? translateUi("s") : ""}
                          </span>
                        )}
                        <small>{openedDate(file.openedAt)}</small>
                      </span>
                    </button>
                    <button
                      className="home-remove"
                      onClick={() => onRemove(file.path)}
                      aria-label={`Remover ${file.name} dos recentes`}
                      title={translateUi("Remover dos recentes sem excluir o arquivo")}
                    >
                      <X size={15} />
                    </button>
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="home-history-empty">
              <div>
                <Clock3 size={28} />
              </div>
              <h3>
                {query
                  ? translateUi("Nenhum arquivo corresponde à pesquisa")
                  : translateUi("Seu histórico começa no próximo arquivo")}
              </h3>
              <p>
                {query
                  ? translateUi("Experimente outra palavra ou procure pelo nome da pasta.")
                  : translateUi("Os documentos que você abrir aparecerão aqui para retomar quando quiser.")}
              </p>
              {query && (
                <button className="text-button" onClick={() => setQuery("")}>{" "}{translateUi("Limpar pesquisa")}{" "}</button>
              )}
            </div>
          )}
          <p className="home-history-note">
            <ShieldCheck size={12} />{" "}{translateUi("Histórico salvo somente neste computador. Remover da lista não exclui os arquivos.")}{" "}</p>
        </section>
        <aside className="home-shortcuts">
          <h2>{translateUi("Faça mais com seus PDFs")}</h2>
          <button onClick={onCombine}>
            <span className="home-shortcut-icon">
              <Layers3 size={22} />
            </span>
            <strong>{translateUi("Combinar arquivos")}</strong>
            <p>{translateUi("Reúna documentos e imagens em um só PDF.")}</p>
            <ArrowUpRight size={15} />
          </button>
          <button onClick={onConvert}>
            <span className="home-shortcut-icon">
              <FileText size={22} />
            </span>
            <strong>{translateUi("Converter para PDF")}</strong>
            <p>{translateUi("Prepare seus arquivos para compartilhar ou arquivar.")}</p>
            <ArrowUpRight size={15} />
          </button>
          <div className="home-support">
            <Heart size={20} />
            <strong>{translateUi("Desenvolvido por Bruno Albertini")}</strong>
            <button className="text-button" onClick={onSupport}>{" "}{translateUi("Apoie o projeto")}{" "}<ArrowUpRight size={13} />
            </button>
          </div>
        </aside>
      </div>
      <footer className="home-footer">{" "}{translateUi("Desenvolvido por")}{" "}<strong>{translateUi("Bruno Albertini")}</strong>
        <span>·</span>
        <button
          onClick={() =>
            void window.gcp.openExternal("https://gestaoculturalpro.com.br/")
          }
        >{" "}{translateUi("Gestão Cultural Pro")}{" "}<ArrowUpRight size={12} />
        </button>
      </footer>
    </div>
  );
}
