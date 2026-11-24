#!/bin/bash
# Builds the editing engine of the desktop (PdfCraft CLI 0.15.0, MIT OR Apache-2.0) for Android, from its
# official source tag, for the three ABIs the APK ships. The result is <out>/<abi>/libpdfcraft.so: an
# executable named like a library so Android installs it in the app's native library folder, where it may run.
#
#   scripts/build-android-engine.sh [out-dir]
#
# Needs: git, a Rust toolchain with the Android targets (rustup target add aarch64-linux-android
# armv7-linux-androideabi x86_64-linux-android) and the Android NDK (ANDROID_NDK or ~/Android/Sdk/ndk/<version>).
# The engine only edits objects, forms, bookmarks, compression, protection, PDF/A and certificate signing:
# conversions (Word, Excel, PowerPoint, EPUB, OCR) never use it.
set -euo pipefail
VERSION=0.15.0
COMMIT=75360d1d7db06fed974f48c914d4c04132757187
OUT=${1:-$HOME/.cache/gcp-pdf-toolchains/engine-$VERSION}
WORK=${GCP_ENGINE_WORK:-$HOME/.cache/gcp-pdf-toolchains/pdfcraft-src-$VERSION}
NDK=${ANDROID_NDK:-$(ls -d "$HOME"/Android/Sdk/ndk/* 2>/dev/null | sort -V | tail -1)}
[ -d "$NDK" ] || { echo "Android NDK não encontrado (defina ANDROID_NDK)." >&2; exit 1; }
BIN=$NDK/toolchains/llvm/prebuilt/linux-x86_64/bin
if [ ! -d "$WORK/.git" ]; then git clone --quiet --depth 1 --branch "v$VERSION" https://github.com/storytold/pdfcraft.git "$WORK"; fi
[ "$(git -C "$WORK" rev-parse HEAD)" = "$COMMIT" ] || { echo "O código do PdfCraft não corresponde à versão $VERSION ($COMMIT)." >&2; exit 1; }
cd "$WORK"
for pair in aarch64-linux-android:arm64-v8a armv7-linux-androideabi:armeabi-v7a x86_64-linux-android:x86_64; do
  target=${pair%%:*}; abi=${pair##*:}
  case $target in armv7-linux-androideabi) cc=armv7a-linux-androideabi26-clang;; *) cc=${target}26-clang;; esac
  up=$(echo "$target" | tr 'a-z-' 'A-Z_'); low=$(echo "$target" | tr '-' '_')
  export "CARGO_TARGET_${up}_LINKER=$BIN/$cc" "CC_${low}=$BIN/$cc" "CXX_${low}=$BIN/${cc}++" "AR_${low}=$BIN/llvm-ar"
  echo "== $abi"
  cargo build --release --locked -p pdfcraft-cli --target "$target" -j "${JOBS:-8}"
  mkdir -p "$OUT/$abi"
  "$BIN/llvm-strip" -o "$OUT/$abi/libpdfcraft.so" "target/$target/release/pdfcraft-cli"
done
for name in LICENSE-APACHE LICENSE-MIT NOTICE; do cp "$WORK/$name" "$OUT/"; done
echo "Motor de edição para Android em $OUT"
