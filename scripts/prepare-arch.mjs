import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {mkdir,writeFile} from 'node:fs/promises';
import {readFileSync} from 'node:fs';

// Repackage the verified upstream binary; never compile a different app under the same version.
const version=process.argv[2];
if(!/^\d+\.\d+\.\d+$/.test(version??''))throw new Error('Uso: node scripts/prepare-arch.mjs 0.10.0');
const repo='cliqueprojeto/GCP-PDF',tag=`v${version}`;
const release=JSON.parse(execFileSync('gh',['release','view',tag,'--repo',repo,'--json','isDraft,assets'],{encoding:'utf8',windowsHide:true}));
if(release.isDraft)throw new Error('A release de origem precisa ser pública.');
const asset=release.assets.find(asset=>asset.name===`GCP-PDF-${version}-linux-amd64.deb`);
if(!asset||asset.state!=='uploaded'||!/^sha256:[a-f0-9]{64}$/.test(asset.digest??''))throw new Error('DEB publicado sem digest SHA-256 verificável.');
const license=execFileSync('git',['show',`${tag}:LICENSE`],{windowsHide:true});
const licenseHash=createHash('sha256').update(license).digest('hex');
// The pacman repository address ships with the package; its install script adds the repository to pacman.conf.
const mirrorlist=readFileSync('packaging/archlinux/gcp-pdf-bin/gcp-pdf-mirrorlist');
const mirrorHash=createHash('sha256').update(mirrorlist).digest('hex');
const text=`# Maintainer: Bruno Albertini <cliqueprojeto@users.noreply.github.com>
# Official upstream binary, repackaged for pacman. See packaging/archlinux/README.md.
pkgname=gcp-pdf-bin
pkgver=${version}
pkgrel=1
pkgdesc='Local PDF editor and reader with OCR, forms and signatures'
arch=('x86_64')
url='https://github.com/cliqueprojeto/GCP-PDF'
license=('GPL-3.0-or-later')
depends=('alsa-lib' 'at-spi2-core' 'cairo' 'dbus' 'expat' 'gcc-libs' 'glib2' 'glibc' 'gtk3' 'libcups' 'libdrm' 'libx11' 'libxcb' 'libxcomposite' 'libxdamage' 'libxext' 'libxfixes' 'libxkbcommon' 'libxrandr' 'mesa' 'nspr' 'nss' 'pango' 'systemd-libs' 'fontconfig' 'freetype2' 'xdg-utils')
optdepends=('libreoffice-fresh: import Office documents as PDF' 'sane: scanimage and scanner drivers for PDF scanning')
provides=('gcp-pdf')
conflicts=('gcp-pdf')
options=('!strip' '!debug')
install=gcp-pdf-bin.install
backup=('etc/pacman.d/gcp-pdf-mirrorlist')
source=("https://github.com/cliqueprojeto/GCP-PDF/releases/download/v\$pkgver/GCP-PDF-\$pkgver-linux-amd64.deb"
        "LICENSE-\$pkgver::https://raw.githubusercontent.com/cliqueprojeto/GCP-PDF/v\$pkgver/LICENSE"
        'gcp-pdf-mirrorlist')
sha256sums=('${asset.digest.slice(7)}'
            '${licenseHash}'
            '${mirrorHash}')

prepare() {
  mkdir -p upstream
  bsdtar -xf data.tar.* -C upstream
}

package() {
  install -dm755 "\$pkgdir/usr/lib"
  cp -a upstream/opt/GCP-PDF "\$pkgdir/usr/lib/gcp-pdf"
  cp -a upstream/usr "\$pkgdir/"
  install -dm755 "\$pkgdir/usr/bin"
  ln -s /usr/lib/gcp-pdf/gcp-pdf "\$pkgdir/usr/bin/gcp-pdf"
  sed -i 's|/opt/GCP-PDF/gcp-pdf|/usr/bin/gcp-pdf|g' "\$pkgdir/usr/share/applications/gcp-pdf.desktop"
  # Debian's maintainer script is not run by pacman. Set the helper's required permissions here.
  chmod 4755 "\$pkgdir/usr/lib/gcp-pdf/chrome-sandbox"
  install -Dm644 "LICENSE-\$pkgver" "\$pkgdir/usr/share/licenses/\$pkgname/LICENSE"
  install -Dm644 gcp-pdf-mirrorlist "\$pkgdir/etc/pacman.d/gcp-pdf-mirrorlist"
  # Arch container policy excludes /usr/share/doc. Keep upstream notices with the licenses.
  if [[ -d "\$pkgdir/usr/share/doc" ]]; then
    mv "\$pkgdir/usr/share/doc" "\$pkgdir/usr/share/licenses/\$pkgname/upstream-doc"
  fi
}
`;
await mkdir('packaging/archlinux/gcp-pdf-bin',{recursive:true});
await writeFile('packaging/archlinux/gcp-pdf-bin/PKGBUILD',text);
console.log(`PKGBUILD ${version}: DEB SHA-256 ${asset.digest.slice(7)}, LICENSE SHA-256 ${licenseHash}`);
