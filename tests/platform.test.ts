import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import fontkit from '@pdf-lib/fontkit';
import { PDFDocument } from 'pdf-lib';
import { faceFromCollection, fontFolders } from '../src/main/fonts';
import { libreOfficeCandidates } from '../src/main/system';
import { installerPattern, linuxPackaging } from '../src/main/update-target';

test('pastas de fontes cobrem sistema, usuário, Office e pastas declaradas pelo ambiente em cada sistema', () => {
  const windows = fontFolders('win32', { WINDIR: 'C:\\Windows', LOCALAPPDATA: 'C:\\Users\\ana\\AppData\\Local' }, 'C:\\Users\\ana');
  assert.ok(windows.includes('C:\\Windows\\Fonts')); assert.ok(windows.includes('C:\\Users\\ana\\AppData\\Local\\Microsoft\\Windows\\Fonts')); assert.ok(windows.some((f) => f.endsWith('CloudFonts')));
  const mac = fontFolders('darwin', {}, '/Users/ana');
  assert.ok(mac.includes('/Users/ana/Library/Fonts')); assert.ok(mac.includes('/Applications/Microsoft Word.app/Contents/Resources/DFonts'));
  const linux = fontFolders('linux', { XDG_DATA_HOME: '/home/ana/dados', XDG_DATA_DIRS: '/opt/share:/usr/share' }, '/home/ana');
  for (const folder of ['/home/ana/dados/fonts', '/opt/share/fonts', '/usr/share/fonts', '/usr/local/share/fonts', '/home/ana/.fonts', '/home/ana/.nix-profile/share/fonts']) assert.ok(linux.includes(folder), folder);
  assert.equal(new Set(linux).size, linux.length);
});

test('uma face de coleção (.ttc) vira um arquivo de fonte próprio que o PDF consegue embutir', async () => {
  const font = readFileSync('assets/Inter-Regular.ttf');
  // A two-face collection: the header, two offsets, then the same font twice with its table offsets moved.
  const header = Buffer.alloc(20); header.write('ttcf', 0, 'latin1'); header.writeUInt32BE(0x00010000, 4); header.writeUInt32BE(2, 8);
  const moved = (base: number) => { const copy = Buffer.from(font), tables = copy.readUInt16BE(4); for (let i = 0; i < tables; i++) copy.writeUInt32BE(copy.readUInt32BE(12 + i * 16 + 8) + base, 12 + i * 16 + 8); return copy; };
  header.writeUInt32BE(20, 12); header.writeUInt32BE(20 + font.length, 16);
  const collection = Buffer.concat([header, moved(20), moved(20 + font.length)]);
  const face = faceFromCollection(new Uint8Array(collection), 20 + font.length);
  assert.equal((fontkit.create(Buffer.from(face)) as { familyName: string }).familyName, 'Inter');
  const doc = await PDFDocument.create(); doc.registerFontkit(fontkit);
  const embedded = await doc.embedFont(face, { subset: true });
  doc.addPage([200, 100]).drawText('Coleção — ação', { x: 10, y: 50, size: 12, font: embedded });
  assert.ok((await doc.save()).length > 1000);
  assert.throws(() => faceFromCollection(new Uint8Array(collection), collection.length), /inválido/);
});

test('LibreOffice é procurado na escolha do usuário, nas pastas usuais e no PATH de cada sistema', () => {
  const linux = libreOfficeCandidates('linux', { PATH: '/opt/lo/program:/usr/bin', GCP_PDF_LIBREOFFICE: '/meu/soffice' }, '/home/ana');
  assert.equal(linux[0], '/meu/soffice');
  for (const path of ['/usr/bin/soffice', '/opt/lo/program/soffice', '/snap/bin/libreoffice', '/usr/lib/libreoffice/program/soffice']) assert.ok(linux.includes(path), path);
  assert.ok(libreOfficeCandidates('darwin', { PATH: '' }, '/Users/ana').includes('/opt/homebrew/bin/soffice'));
  const windows = libreOfficeCandidates('win32', { ProgramFiles: 'C:\\Program Files', Path: 'D:\\LO\\program;C:\\Windows' }, 'C:\\Users\\ana');
  assert.ok(windows.includes('C:\\Program Files\\LibreOffice\\program\\soffice.exe')); assert.ok(windows.includes('D:\\LO\\program\\soffice.exe'));
});

test('no Linux a atualização oferece o pacote do formato instalado', () => {
  const assets = ['GCP-PDF-0.12.0-linux-x86_64.AppImage', 'GCP-PDF-0.12.0-linux-amd64.deb', 'GCP-PDF-0.12.0-linux-x86_64.rpm'];
  const pick = (packaging: 'appimage' | 'deb' | 'rpm') => assets.filter((a) => installerPattern('linux', 'x64', packaging).test(a));
  assert.deepEqual(pick('deb'), [assets[1]]); assert.deepEqual(pick('rpm'), [assets[2]]); assert.deepEqual(pick('appimage'), [assets[0]]);
  assert.equal(linuxPackaging({ APPIMAGE: '/tmp/app.AppImage' }, () => true), 'appimage');
  assert.equal(linuxPackaging({}, (p) => p === '/etc/debian_version'), 'deb');
  assert.equal(linuxPackaging({}, (p) => p === '/etc/fedora-release'), 'rpm');
  assert.equal(linuxPackaging({}, () => false), 'appimage');
});
