import type { Locale } from "./locale";

/** Explicit reader actions; selected text is always encoded as a query value. */
export function readerSearchUrl(text: string, source: "wikipedia" | "internet", locale: Locale): string {
  const language = locale === "pt-BR" ? "pt" : locale === "es" ? "es" : "en";
  const url = new URL(source === "wikipedia" ? `https://${language}.wikipedia.org/w/index.php` : "https://www.google.com/search");
  url.searchParams.set(source === "wikipedia" ? "search" : "q", text);
  return url.href;
}

/** Keep openExternal limited to the exact search destinations offered by the reader. */
export function isReaderSearchUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    const wikipedia = ["pt.wikipedia.org", "en.wikipedia.org", "es.wikipedia.org"].includes(url.hostname) && url.pathname === "/w/index.php";
    const google = url.hostname === "www.google.com" && url.pathname === "/search";
    const key = wikipedia ? "search" : "q";
    return (wikipedia || google) && [...url.searchParams].length === 1 && !!url.searchParams.get(key)?.trim();
  } catch { return false; }
}
