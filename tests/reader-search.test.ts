import {test} from "node:test";
import assert from "node:assert/strict";
import {readerSearchUrl,isReaderSearchUrl} from "../src/shared/reader-search";

test("reader searches preserve selected text as query data in each language", () => {
  const text = "ação & café? # / = + 漫画";
  for (const locale of ["pt-BR", "en", "es"] as const) for (const source of ["wikipedia", "internet"] as const) {
    const value = readerSearchUrl(text, source, locale), url = new URL(value);
    assert.equal(url.searchParams.get(source === "wikipedia" ? "search" : "q"), text);
    assert.ok(isReaderSearchUrl(value));
  }
});

test("external reader search policy rejects unrelated addresses and extra parameters", () => {
  for (const url of ["https://evil.example/search?q=a", "http://www.google.com/search?q=a", "https://www.google.com.evil.example/search?q=a", "https://user@www.google.com/search?q=a", "https://www.google.com:444/search?q=a", "https://www.google.com/search?q=a&next=https://evil.example", "https://www.google.com/search?q=a&q=b", "https://pt.wikipedia.org/wiki/a", "https://pt.wikipedia.org/w/index.php?search=", "https://www.google.com/search?q=a#x", "file:///tmp/a", "invalid"]) assert.equal(isReaderSearchUrl(url), false, url);
});
