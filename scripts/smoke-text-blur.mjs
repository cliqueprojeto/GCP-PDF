import { _electron as electron } from "playwright-core";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { mkdir, writeFile } from "node:fs/promises";
import assert from "node:assert/strict";
const require = createRequire(import.meta.url);
await mkdir("evidence/home", { recursive: true });
const env = {
  ...process.env,
  GCP_PDF_TEST_MODE: "1",
  GCP_PDF_DATA_DIR: resolve(".cache/blur-smoke-profile"),
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
  await page.evaluate(() => localStorage.removeItem("gcp.last-page"));
  await page.evaluate(
    (path) => window.gcp.openFiles([path]),
    resolve(".cache/home-smoke/Cultura local.pdf"),
  );
  await page.waitForSelector(
    ".home-document-view:not([hidden]) .page-sheet:not(.loading)",
  );
  const ws = async () =>
    (await page.evaluate(() => window.gcp.getWorkspace())).documents[0];
  let doc = await ws();
  const sources = () =>
    page.evaluate(({ id, ref }) => window.gcp.getSourceObjects(id, ref), {
      id: doc.id,
      ref: doc.pages[0].id,
    });
  let source = await sources(),
    title = source.paragraphs.find((p) =>
      p.text.includes("Documento cultural"),
    );
  assert.ok(title, "Título de teste");
  await page
    .locator(".ribbon-tabs button", { hasText: "Editar" })
    .first()
    .click();
  const sheet = page.locator('.home-document-view .page-sheet[data-page="1"]'),
    editor = page.locator(".source-editor-content");
  const openTitle = async () => {
    source = await sources();
    title = source.paragraphs.find((p) =>
      p.text.includes("Documento cultural"),
    );
    const box = sheet.locator(`[data-source="text:${title.index}"]`);
    await box.waitFor({ timeout: 30000 });
    await box.click({ position: { x: 20, y: 8 } });
    await editor.waitFor();
  };
  const blank = async () => {
    const bounds = await sheet.boundingBox();
    await page.mouse.click(bounds.x + bounds.width - 23, bounds.y + 170);
  };
  await openTitle();
  const firstRevision = (await ws()).revision;
  await editor.fill("Documento cultural 9");
  await blank();
  await page.waitForFunction(
    async (revision) =>
      (await window.gcp.getWorkspace()).documents[0].revision > revision,
    firstRevision,
    { timeout: 30000 },
  );
  await editor.waitFor({ state: "detached" });
  check(
    "clicar em área vazia aplica o texto sem Ctrl+Enter",
    (await sources()).paragraphs.some((p) =>
      p.text.includes("Documento cultural 9"),
    ),
  );
  await openTitle();
  const secondRevision = (await ws()).revision;
  await editor.fill("Documento cultural 8");
  const other = source.paragraphs.find((p) => p.index !== title.index);
  await sheet
    .locator(`[data-source="text:${other.index}"]`)
    .click({ position: { x: 20, y: 8 } });
  await page.waitForFunction(
    async (revision) =>
      (await window.gcp.getWorkspace()).documents[0].revision > revision,
    secondRevision,
    { timeout: 30000 },
  );
  check(
    "clicar em outro parágrafo aplica antes de trocar de caixa",
    (await sources()).paragraphs.some((p) =>
      p.text.includes("Documento cultural 8"),
    ),
  );
  await page.waitForTimeout(300);
  await openTitle();
  const formatRevision = (await ws()).revision;
  await editor.fill("Documento cultural 7");
  await page.locator(".property-bar .property-title").click();
  await page.waitForTimeout(200);
  check(
    "clicar na barra de fontes conserva o rascunho",
    (await editor.isVisible()) &&
      (await editor.innerText()).includes("Documento cultural 7") &&
      (await ws()).revision === formatRevision,
  );
  await page.locator(".property-bar select").first().selectOption("helvetica");
  await page.waitForFunction(
    async (revision) =>
      (await window.gcp.getWorkspace()).documents[0].revision > revision,
    formatRevision,
    { timeout: 30000 },
  );
  check(
    "alterar fonte aplica texto e formatação juntos",
    (await sources()).paragraphs.some((p) =>
      p.text.includes("Documento cultural 7"),
    ),
  );
  await openTitle();
  const failureRevision = (await ws()).revision,
    draft =
      "Documento cultural 7\nLINHA EXTRA QUE NÃO CABE NA CAIXA ORIGINAL\nOUTRA LINHA DE VALIDAÇÃO";
  await editor.fill(draft);
  await blank();
  await page.waitForFunction(
    () =>
      document.querySelector(".toast")?.textContent?.includes("novas linhas"),
    { timeout: 30000 },
  );
  check(
    "motor rejeita reflow sem alterar o documento",
    (await ws()).revision === failureRevision,
  );
  check(
    "falha mantém seleção e texto digitado",
    (await editor.isVisible()) &&
      (await editor.innerText()).includes("OUTRA LINHA DE VALIDAÇÃO"),
  );
  await page
    .getByRole("button", { name: "Ir para a página inicial", exact: true })
    .click();
  await page.waitForTimeout(500);
  check(
    "navegação não descarta rascunho rejeitado",
    (await editor.isVisible()) &&
      (await page.locator(".home-screen").count()) === 0,
  );
  await editor.focus();
  await editor.press("Escape");
  await editor.waitFor({ state: "detached" });
  check(
    "Escape cancela o rascunho e conserva o PDF",
    (await ws()).revision === failureRevision,
  );
  await page.screenshot({ path: "evidence/home/texto-aplicado.png" });
  check("nenhum erro de página", errors.length === 0, errors);
} finally {
  await writeFile(
    "evidence/home/blur-smoke.json",
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
