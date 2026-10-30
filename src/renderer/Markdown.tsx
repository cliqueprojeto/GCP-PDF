import React from "react";
/** Renders the Markdown subset AI providers answer with (headings, emphasis, lists, tables, quotes,
 * code). It builds React elements only, so provider text can never inject HTML. */
function inline(text: string, key = 0): React.ReactNode[] {
  const out: React.ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|__[^_]+__|\*[^*\s][^*]*\*|_[^_\s][^_]*_|`[^`]+`|\[[^\]]+\]\([^)]+\))/g;
  let last = 0, n = key;
  for (const match of text.matchAll(pattern)) {
    if (match.index! > last) out.push(text.slice(last, match.index));
    const token = match[0];
    if (token.startsWith("**") || token.startsWith("__")) out.push(<strong key={n++}>{inline(token.slice(2, -2), n * 10)}</strong>);
    else if (token.startsWith("`")) out.push(<code key={n++}>{token.slice(1, -1)}</code>);
    else if (token.startsWith("[")) out.push(<span key={n++} className="md-link">{token.slice(1, token.indexOf("]"))}</span>);
    else out.push(<em key={n++}>{inline(token.slice(1, -1), n * 10)}</em>);
    last = match.index! + token.length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
const cells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => cell.trim());
export function Markdown({ text }: { text: string }) {
  const lines = text.replace(/\r\n/g, "\n").split("\n"), blocks: React.ReactNode[] = [];
  for (let i = 0; i < lines.length; ) {
    const line = lines[i]!;
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("```")) {
      const code: string[] = [];
      for (i++; i < lines.length && !lines[i]!.startsWith("```"); i++) code.push(lines[i]!);
      i++;
      blocks.push(<pre key={blocks.length}><code>{code.join("\n")}</code></pre>);
      continue;
    }
    const heading = /^(#{1,4})\s+(.*)$/.exec(line);
    if (heading) {
      const Tag = (`h${Math.min(6, heading[1]!.length + 2)}`) as "h3";
      blocks.push(<Tag key={blocks.length}>{inline(heading[2]!)}</Tag>);
      i++;
      continue;
    }
    if (/^\s*\|.*\|\s*$/.test(line) && /^\s*\|?[\s:-]+\|[\s|:-]*$/.test(lines[i + 1] ?? "")) {
      const head = cells(line), rows: string[][] = [];
      for (i += 2; i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i]!); i++) rows.push(cells(lines[i]!));
      blocks.push(
        <div className="md-table" key={blocks.length}>
          <table>
            <thead><tr>{head.map((cell, c) => <th key={c}>{inline(cell)}</th>)}</tr></thead>
            <tbody>{rows.map((row, r) => <tr key={r}>{row.map((cell, c) => <td key={c}>{inline(cell)}</td>)}</tr>)}</tbody>
          </table>
        </div>,
      );
      continue;
    }
    if (/^\s*([-*•]|\d+[.)])\s+/.test(line)) {
      const ordered = /^\s*\d+[.)]/.test(line), items: React.ReactNode[] = [];
      for (; i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i]!); i++) {
        const nested = /^\s{2,}/.test(lines[i]!);
        items.push(<li key={items.length} className={nested ? "nested" : undefined}>{inline(lines[i]!.replace(/^\s*([-*•]|\d+[.)])\s+/, ""))}</li>);
      }
      blocks.push(ordered ? <ol key={blocks.length}>{items}</ol> : <ul key={blocks.length}>{items}</ul>);
      continue;
    }
    if (line.startsWith(">")) {
      const quote: string[] = [];
      for (; i < lines.length && lines[i]!.startsWith(">"); i++) quote.push(lines[i]!.replace(/^>\s?/, ""));
      blocks.push(<blockquote key={blocks.length}>{inline(quote.join(" "))}</blockquote>);
      continue;
    }
    if (/^(-{3,}|\*{3,})$/.test(line.trim())) { blocks.push(<hr key={blocks.length} />); i++; continue; }
    const paragraph: string[] = [];
    for (; i < lines.length && lines[i]!.trim() && !/^(#{1,4}\s|```|>|\s*([-*•]|\d+[.)])\s)/.test(lines[i]!); i++) paragraph.push(lines[i]!);
    if (!paragraph.length) paragraph.push(lines[i++]!);
    blocks.push(<p key={blocks.length}>{inline(paragraph.join(" "))}</p>);
  }
  return <div className="markdown">{blocks}</div>;
}
