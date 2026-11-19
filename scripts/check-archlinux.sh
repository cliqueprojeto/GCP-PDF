#!/usr/bin/env bash
set -euo pipefail
cd /work
# This script is run only in the disposable official Arch Linux build container.
pacman -Syu --noconfirm --needed base-devel sudo git ca-certificates desktop-file-utils namcap xorg-server-xvfb xorg-xauth dbus unzip
source packaging/archlinux/gcp-pdf-bin/PKGBUILD
pacman -S --noconfirm --needed "${depends[@]}"
useradd --create-home --uid "$(stat -c '%u' /work)" builder
mkdir -p release/archlinux evidence/archlinux
chown -R builder:builder /work
runuser -u builder -- bash -euc '
  cd /work/packaging/archlinux/gcp-pdf-bin
  makepkg --verifysource --noconfirm
  makepkg --printsrcinfo > .SRCINFO
  makepkg --cleanbuild --noconfirm
  cp -- *.pkg.tar.zst /work/release/archlinux/
  tar -czf /work/release/archlinux/GCP-PDF-aur-recipe.tar.gz PKGBUILD .SRCINFO gcp-pdf-bin.install gcp-pdf-mirrorlist
'
pacman -U --noconfirm release/archlinux/*.pkg.tar.zst
pacman -Qi gcp-pdf-bin > evidence/archlinux/pacman.txt
# The package registers its pacman repository, so later versions arrive through pacman -Syu and Pamac.
grep -qxF '[gcp-pdf]' /etc/pacman.conf
grep -qxF 'Include = /etc/pacman.d/gcp-pdf-mirrorlist' /etc/pacman.conf
grep -q '^Server = https://github.com/cliqueprojeto/GCP-PDF/releases/download/archlinux-repo$' /etc/pacman.d/gcp-pdf-mirrorlist
# The repository published with this version: database plus package, read back by pacman itself.
mkdir -p release/archlinux-repo
cp release/archlinux/*.pkg.tar.zst release/archlinux-repo/
repo-add release/archlinux-repo/gcp-pdf.db.tar.gz release/archlinux-repo/*.pkg.tar.zst
# GitHub releases cannot hold symbolic links: pacman asks for gcp-pdf.db and gcp-pdf.files.
for name in gcp-pdf.db gcp-pdf.files; do cp --remove-destination "$(readlink -f "release/archlinux-repo/$name")" "release/archlinux-repo/$name"; done
cp /etc/pacman.d/gcp-pdf-mirrorlist /tmp/gcp-pdf-mirrorlist.published
echo 'Server = file:///work/release/archlinux-repo' > /etc/pacman.d/gcp-pdf-mirrorlist
pacman -Sy --noconfirm
pacman -Si gcp-pdf/gcp-pdf-bin > evidence/archlinux/repository.txt
grep -q "^Version *: $(pacman -Q gcp-pdf-bin | cut -d' ' -f2)\$" evidence/archlinux/repository.txt
cp /tmp/gcp-pdf-mirrorlist.published /etc/pacman.d/gcp-pdf-mirrorlist
pacman -Qkk gcp-pdf-bin > evidence/archlinux/files.txt
desktop-file-validate /usr/share/applications/gcp-pdf.desktop
grep -Eq '^Exec=.* %F([[:space:]]|$)' /usr/share/applications/gcp-pdf.desktop
test -x /usr/bin/gcp-pdf
test "$(stat -c '%a' /usr/lib/gcp-pdf/chrome-sandbox)" = 4755
ldd /usr/lib/gcp-pdf/gcp-pdf > evidence/archlinux/ldd-electron.txt
ldd /usr/lib/gcp-pdf/resources/app.asar.unpacked/assets/pdfcraft/pdfcraft-cli > evidence/archlinux/ldd-pdfcraft.txt
if grep -q 'not found' evidence/archlinux/ldd-*.txt; then cat evidence/archlinux/ldd-*.txt; exit 1; fi
/usr/lib/gcp-pdf/resources/app.asar.unpacked/assets/pdfcraft/pdfcraft-cli --version
namcap packaging/archlinux/gcp-pdf-bin/PKGBUILD release/archlinux/*.pkg.tar.zst > evidence/archlinux/namcap.txt 2>&1
cat evidence/archlinux/namcap.txt
runuser -u builder -- env PATH="$PATH" ELECTRON_SKIP_BINARY_DOWNLOAD=1 bash -euc '
  cd /work
  npx --yes npm@11.9.0 ci
  # xvfb-run on Arch defaults to a 640x480 screen; the window fits the screen it opens on, so test on a real size.
  dbus-run-session -- xvfb-run -a -s "-screen 0 1920x1080x24" node scripts/smoke-packaged.mjs /usr/bin/gcp-pdf arch
'
cd release/archlinux
sha256sum -- *.pkg.tar.zst GCP-PDF-aur-recipe.tar.gz > SHA256SUMS-ArchLinux.txt
cd /work
# Removing the package takes the repository out of pacman.conf again.
pacman -R --noconfirm gcp-pdf-bin
if grep -q 'gcp-pdf' /etc/pacman.conf; then echo 'O repositório ficou no pacman.conf depois da remoção.'; exit 1; fi
