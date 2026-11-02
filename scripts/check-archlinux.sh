#!/usr/bin/env bash
set -euo pipefail
cd /work
# This script is run only in the disposable official Arch Linux build container.
pacman -Syu --noconfirm --needed base-devel sudo git ca-certificates desktop-file-utils namcap xorg-server-xvfb xorg-xauth dbus unzip
source packaging/archlinux/gcp-pdf-bin/PKGBUILD
pacman -S --noconfirm --needed "${depends[@]}"
useradd --create-home builder
mkdir -p release/archlinux evidence/archlinux
chown -R builder:builder /work
runuser -u builder -- bash -euc '
  cd /work/packaging/archlinux/gcp-pdf-bin
  makepkg --verifysource --noconfirm
  makepkg --printsrcinfo > .SRCINFO
  makepkg --cleanbuild --noconfirm
  cp -- *.pkg.tar.zst /work/release/archlinux/
  tar -czf /work/release/archlinux/GCP-PDF-aur-recipe.tar.gz PKGBUILD .SRCINFO
'
pacman -U --noconfirm release/archlinux/*.pkg.tar.zst
pacman -Qi gcp-pdf-bin > evidence/archlinux/pacman.txt
pacman -Qkk gcp-pdf-bin > evidence/archlinux/files.txt
desktop-file-validate /usr/share/applications/gcp-pdf.desktop
grep -Eq '^Exec=.* %F([[:space:]]|$)' /usr/share/applications/gcp-pdf.desktop
test -x /usr/bin/gcp-pdf
test "$(stat -c '%a' /opt/GCP-PDF/chrome-sandbox)" = 4755
ldd /opt/GCP-PDF/gcp-pdf > evidence/archlinux/ldd-electron.txt
ldd /opt/GCP-PDF/resources/app.asar.unpacked/assets/pdfcraft/pdfcraft-cli > evidence/archlinux/ldd-pdfcraft.txt
if grep -q 'not found' evidence/archlinux/ldd-*.txt; then cat evidence/archlinux/ldd-*.txt; exit 1; fi
/opt/GCP-PDF/resources/app.asar.unpacked/assets/pdfcraft/pdfcraft-cli --version
namcap packaging/archlinux/gcp-pdf-bin/PKGBUILD release/archlinux/*.pkg.tar.zst > evidence/archlinux/namcap.txt 2>&1
cat evidence/archlinux/namcap.txt
runuser -u builder -- env PATH="$PATH" ELECTRON_SKIP_BINARY_DOWNLOAD=1 bash -euc '
  cd /work
  npm ci
  dbus-run-session -- xvfb-run -a node scripts/smoke-packaged.mjs /usr/bin/gcp-pdf arch
'
cd release/archlinux
sha256sum -- *.pkg.tar.zst GCP-PDF-aur-recipe.tar.gz > SHA256SUMS-ArchLinux.txt
