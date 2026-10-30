import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import { resolve, basename } from "node:path";
import { mkdir, writeFile, access } from "node:fs/promises";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
await mkdir(".cache/home-smoke", { recursive: true });
await mkdir("evidence/home", { recursive: true });
const fixture = await PDFDocument.create(),
  font = await fixture.embedFont(StandardFonts.Helvetica);
for (let i = 0; i < 3; i++) {
  const p = fixture.addPage([595, 842]);
  p.drawText(`Documento cultural ${i + 1}`, {
    x: 55,
    y: 780,
    size: 20,
    font,
    color: rgb(0.2, 0.1, 0.4),
  });
  for (let row = 0; row < 20; row++)
    p.drawText(`Linha de leitura ${row + 1} da página ${i + 1}.`, {
      x: 55,
      y: 730 - row * 26,
      size: 12,
      font,
    });
}
const bytes = await fixture.save(),
  first = resolve(".cache/home-smoke/Cultura local.pdf"),
  second = resolve(".cache/home-smoke/Prestação de contas.pdf");
await writeFile(first, bytes);
await writeFile(second, bytes);
const env = {
  ...process.env,
  GCP_PDF_TEST_MODE: "1",
  GCP_PDF_DATA_DIR: resolve(".cache/home-smoke-profile"),
};
delete env.ELECTRON_RUN_AS_NODE;
const app = await electron.launch({
    executablePath: require("electron"),
    args: [resolve(".")],
    cwd: resolve("."),
    env,
    timeout: 90000,
  }),
  checks = [],
  errors = [];
function check(label, value, detail) {
  assert.ok(value, `${label}: ${JSON.stringify(detail)}`);
  checks.push({ label, detail });
  console.log("OK", label, detail ?? "");
}
try {
  const page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  await page.waitForFunction(() => !!window.gcp);
  await page.evaluate(() => {
    localStorage.removeItem("gcp.last-page");
    localStorage.removeItem("gcp.recent-files");
  });
  await page.reload();
  await page.waitForSelector(".home-screen");
  await page.evaluate((paths) => window.gcp.openFiles(paths), [first, second]);
  await page.waitForSelector(
    ".home-document-view:not([hidden]) .page-sheet:not(.loading)",
  );
  const ws = () => page.evaluate(() => window.gcp.getWorkspace());
  let state = await ws();
  const doc1 = state.documents.find((d) => d.path === first),
    doc2 = state.documents.find((d) => d.path === second);
  await page
    .locator(".document-tab")
    .filter({ hasText: basename(first) })
    .click();
  await page.waitForTimeout(700);
  await page
    .locator(".home-document-view .canvas-scroll")
    .evaluate((node) => (node.scrollTop = 170));
  await page.waitForFunction((path) => {
    const saved = JSON.parse(localStorage.getItem("gcp.last-page") || "{}")[
      path.toLowerCase()
    ];
    return saved?.page === 0 && saved.top > 100;
  }, first);
  const read = () =>
    page.evaluate(
      (path) =>
        JSON.parse(localStorage.getItem("gcp.last-page") || "{}")[
          path.toLowerCase()
        ],
      first,
    );
  const firstPosition = await read();
  check(
    "rolagem na mesma página é persistida",
    firstPosition.page === 0 && firstPosition.top > 100,
    firstPosition,
  );
  await page
    .getByRole("button", { name: "Ir para a página inicial", exact: true })
    .click();
  await page.waitForSelector(".home-screen");
  check(
    "logo abre início sem fechar abas",
    (await ws()).documents.length === 2,
  );
  check(
    "recentes registram arquivos abertos",
    (await page.locator(".home-recent-row").count()) === 2,
  );
  await page.getByLabel("Pesquisar arquivos recentes").fill("Prestação");
  check(
    "pesquisa filtra por nome",
    (await page.locator(".home-recent-row").count()) === 1,
  );
  await page
    .getByRole("button", {
      name: "Remover Prestação de contas.pdf dos recentes",
      exact: true,
    })
    .click();
  check(
    "remover recente não fecha documento",
    (await ws()).documents.length === 2,
  );
  await access(second);
  await page.getByLabel("Limpar pesquisa de recentes").click();
  check(
    "remover mantém apenas o outro recente",
    (await page.locator(".home-recent-row").count()) === 1,
  );
  await page
    .getByRole("button", { name: "Limpar histórico", exact: true })
    .click();
  check(
    "limpar histórico não fecha abas",
    (await page.locator(".home-recent-row").count()) === 0 &&
      (await ws()).documents.length === 2,
  );
  await page
    .getByRole("button", { name: "Voltar ao documento", exact: true })
    .click();
  await page.waitForSelector(
    ".home-document-view:not([hidden]) .page-sheet:not(.loading)",
  );
  await page.waitForTimeout(500);
  const topBack = await page
    .locator(".home-document-view .canvas-scroll")
    .evaluate((node) => node.scrollTop);
  check(
    "retorno ao documento preserva offset da página1",
    topBack > 100,
    topBack,
  );
  await page
    .getByRole("button", { name: "Página inicial", exact: true })
    .click();
  await page.waitForSelector(".home-screen");
  check(
    "casinha retorna ao início sem fechar abas",
    (await ws()).documents.length === 2,
  );
  await page.evaluate(
    async (ids) => {
      for (const id of ids) await window.gcp.closeDocument(id);
    },
    [doc2.id, doc1.id],
  );
  await page.waitForSelector(".home-screen");
  await page.evaluate((path) => window.gcp.openFiles([path]), first);
  await page.waitForSelector(
    ".home-document-view:not([hidden]) .page-sheet:not(.loading)",
  );
  await page.waitForTimeout(700);
  const afterReopen = await page
    .locator(".home-document-view .canvas-scroll")
    .evaluate((node) => node.scrollTop);
  check(
    "reabrir arquivo restaura offset na página1",
    afterReopen > 100,
    afterReopen,
  );
  await page.getByRole("textbox", { name: "Número da página" }).fill("2");
  await page.getByRole("textbox", { name: "Número da página" }).press("Enter");
  await page.waitForTimeout(500);
  await page.locator(".home-document-view .canvas-scroll").evaluate((node) => {
    const p = node.querySelector('.page-sheet[data-page="2"]');
    node.scrollTop = p.offsetTop - 16 + 125;
  });
  await page.waitForFunction((path) => {
    const saved = JSON.parse(localStorage.getItem("gcp.last-page") || "{}")[
      path.toLowerCase()
    ];
    return saved?.page === 1 && saved.top > 80;
  }, first);
  await page
    .getByRole("button", { name: "Página inicial", exact: true })
    .click();
  state = await ws();
  await page.evaluate(
    (id) => window.gcp.closeDocument(id),
    state.documents[0].id,
  );
  await page
    .locator(".home-recent-open")
    .filter({ hasText: basename(first) })
    .click();
  await page.waitForSelector(
    '.home-document-view:not([hidden]) .page-sheet[data-page="2"]:not(.loading)',
  );
  await page.waitForTimeout(600);
  check(
    "abrir pela lista retoma outra página",
    (await page
      .getByRole("textbox", { name: "Número da página" })
      .inputValue()) === "2",
  );
  const missing = resolve(".cache/home-smoke/Arquivo inexistente.pdf");
  await page
    .getByRole("button", { name: "Página inicial", exact: true })
    .click();
  await page.evaluate((path) => {
    const values = JSON.parse(localStorage.getItem("gcp.recent-files") || "[]");
    values.unshift({
      path,
      name: "Arquivo inexistente.pdf",
      openedAt: Date.now(),
      pageCount: 1,
    });
    localStorage.setItem("gcp.recent-files", JSON.stringify(values));
  }, missing);
  await page.reload();
  await page.waitForFunction(() => !!window.gcp);
  await page
    .getByRole("button", { name: "Página inicial", exact: true })
    .click();
  await page
    .locator(".home-recent-open")
    .filter({ hasText: "Arquivo inexistente.pdf" })
    .click();
  await page.waitForSelector(".home-history .inline-error");
  const missingMessage = await page
    .locator(".home-history .inline-error")
    .innerText();
  check(
    "recente ausente mostra mensagem em português",
    /arquivo não foi encontrado/i.test(missingMessage),
    missingMessage,
  );
  await page.screenshot({ path: "evidence/home/recente-ausente.png" });
  await page
    .getByRole("button", { name: "Voltar ao documento", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Página inicial", exact: true })
    .click();
  await page.locator(".home-screen").evaluate((node) => (node.scrollTop = 0));
  await page.screenshot({ path: "evidence/home/inicio.png" });
  check("nenhum erro de página", errors.length === 0, errors);
} finally {
  await writeFile(
    "evidence/home/smoke.json",
    JSON.stringify({ checks, errors }, null, 2),
  );
  await app
    .evaluate(() => {
      for (const view of globalThis.__gcpTest.views.values())
        view.allowClose = true;
    })
    .catch(() => {});
  await app.close();
}
