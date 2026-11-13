#!/usr/bin/env bash
# Construit Cut pour Windows x64 : dossier de l'application, installateur et version portable.
# Prérequis (téléchargés depuis GitHub) : Electron win32-x64, FFmpeg BtbN win64-gpl-shared,
# NSIS (electron-builder-binaries), bun (pour l'outil d'édition des ressources de l'exe).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
DL="${DL:-$HOME/dl}"
VERSION="$(node -p "require('$ROOT/app/package.json').version")"
STAGE="$ROOT/build/stage/Cut"
DIST="$ROOT/dist"

echo "==> Cut $VERSION"
rm -rf "$ROOT/build/stage" && mkdir -p "$STAGE" "$DIST"

echo "==> Electron"
unzip -q "$DL/electron-win.zip" -d "$STAGE"
mv "$STAGE/electron.exe" "$STAGE/Cut.exe"
rm -f "$STAGE/resources/default_app.asar"
find "$STAGE/locales" -name '*.pak' ! -name 'fr.pak' ! -name 'en-US.pak' -delete

echo "==> Application"
mkdir -p "$STAGE/resources/app"
cp -r "$ROOT/app/." "$STAGE/resources/app/"

echo "==> FFmpeg"
TMPFF="$(mktemp -d)"
unzip -q "$DL/ffmpeg-win.zip" -d "$TMPFF"
FFDIR="$(find "$TMPFF" -maxdepth 1 -mindepth 1 -type d | head -1)"
mkdir -p "$STAGE/resources/ffmpeg"
cp "$FFDIR"/bin/ffmpeg.exe "$FFDIR"/bin/ffprobe.exe "$FFDIR"/bin/*.dll "$STAGE/resources/ffmpeg/"
cp "$FFDIR/LICENSE.txt" "$STAGE/resources/ffmpeg/LICENSE-FFmpeg.txt"
printf 'FFmpeg 8.1 (build BtbN win64-gpl-shared)\nSource : https://github.com/BtbN/FFmpeg-Builds\nCode source FFmpeg : https://ffmpeg.org/download.html\n' > "$STAGE/resources/ffmpeg/README.txt"
rm -rf "$TMPFF"

echo "==> Icône et informations de version de Cut.exe"
(cd "$ROOT/tools" && bun patch-exe.ts "$STAGE/Cut.exe" "$ROOT/assets/icon.ico" "$VERSION")

echo "==> Liste des fichiers pour la désinstallation"
python3 "$ROOT/build/gen-uninstall-list.py" "$STAGE" > "$ROOT/build/uninstall-files.nsh"

echo "==> Installateur et version portable (en parallèle)"
export NSISDIR="$DL/nsis"
rm -f "$DIST"/Cut-*.exe
"$NSISDIR/linux/makensis" -V2 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DROOT="$ROOT" -DPLUGINS="$DL/nsisres/plugins/x86-unicode" "$ROOT/build/installer.nsi" &
P1=$!
"$NSISDIR/linux/makensis" -V2 -DVERSION="$VERSION" -DSTAGE="$STAGE" -DROOT="$ROOT" "$ROOT/build/portable.nsi" &
P2=$!
wait $P1; wait $P2
ls -la "$DIST"
