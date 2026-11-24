// Certificates of the ICP-Brasil hierarchy (roots and accredited authorities) and of the gov.br electronic
// signature, both published by the ITI, as one PEM
// bundle the signature engine trusts on every system. Without them, signatures made with ICP-Brasil
// certificates verify as intact but "chain not recognized" wherever the system lacks those authorities
// (Linux, macOS, Android and many Windows installations).
//
//   node scripts/prepare-icp-brasil.mjs [ACcompactado.zip] [Cadeia_GovBr-der.p7b]     (default: downloads both from the ITI)
//
// Writes assets/icp-brasil/icp-brasil.pem and assets/icp-brasil/fonte.json (source, date, SHA-256, count).
import {mkdir, readFile, writeFile} from 'node:fs/promises';
import {createHash, X509Certificate} from 'node:crypto';
import {unzipSync} from 'fflate';

const SOURCE = 'http://acraiz.icpbrasil.gov.br/credenciadas/CertificadosAC-ICP-Brasil/ACcompactado.zip';
// Assinatura eletrônica gov.br ("AC Final do Governo Federal do Brasil"), also accepted by the ITI validator.
const GOVBR = 'http://repo.iti.br/docs/Cadeia_GovBr-der.p7b';
const govbr = new Uint8Array(await (process.argv[3] ? readFile(process.argv[3]) : fetch(GOVBR, {signal: AbortSignal.timeout(120_000)}).then(r => r.arrayBuffer())));
if (govbr[0] !== 0x30 || govbr.length < 1000) throw new Error('A cadeia gov.br do ITI não foi obtida.');
const zip = process.argv[2] ? new Uint8Array(await readFile(process.argv[2])) : new Uint8Array(await (await fetch(SOURCE, {signal: AbortSignal.timeout(120_000)})).arrayBuffer());
const files = unzipSync(zip);
const certificates = new Map();
for (const [name, bytes] of Object.entries(files)) {
  if (!/\.(crt|cer|pem|der)$/i.test(name)) continue;
  const cert = new X509Certificate(Buffer.from(bytes));
  if (new Date(cert.validTo) < new Date()) continue;
  certificates.set(cert.fingerprint256, {name: name.split('/').pop(), subject: cert.subject.replace(/\n/g, ', '), pem: cert.toString().trim()});
}
if (certificates.size < 20 || ![...certificates.values()].some(c => /ICP-Brasil/i.test(c.subject) && /Raiz/i.test(c.subject)))
  throw new Error('O pacote do ITI não contém a cadeia ICP-Brasil esperada.');
const sorted = [...certificates.values()].sort((a, b) => a.name.localeCompare(b.name));
await mkdir('assets/icp-brasil', {recursive: true});
const p7b = `# Cadeia gov.br (${GOVBR})\n-----BEGIN PKCS7-----\n${Buffer.from(govbr).toString('base64').match(/.{1,64}/g).join('\n')}\n-----END PKCS7-----\n`;
await writeFile('assets/icp-brasil/icp-brasil.pem', sorted.map(c => `# ${c.name}\n${c.pem}`).join('\n') + '\n' + p7b);
await writeFile('assets/icp-brasil/fonte.json', JSON.stringify({
  fonte: SOURCE, fonteGovBr: GOVBR, sha256GovBr: createHash('sha256').update(govbr).digest('hex'), obtido: new Date().toISOString().slice(0, 10), sha256Zip: createHash('sha256').update(zip).digest('hex'), certificados: sorted.length,
  observacao: 'Certificados públicos das autoridades certificadoras da ICP-Brasil, publicados pelo ITI. Atualize ao surgirem novas ACs ou raízes.',
}, null, 2) + '\n');
console.log(`ICP-Brasil: ${sorted.length} certificados.`);
