# Cut

Logiciel Windows minimaliste pour découper rapidement des VOD Twitch et des vidéos, **sans réencodage et sans perte de qualité**.

## Installation

| Fichier | Usage |
|---|---|
| `dist/Cut-Setup-1.1.0.exe` | Installateur. Aucun droit administrateur requis. Installe Cut dans `%LOCALAPPDATA%\Programs\Cut` et crée un raccourci sur le Bureau et dans le menu Démarrer. |
| `dist/Cut-1.1.0-Portable.exe` | Version portable en un seul fichier, sans installation. Le premier lancement prépare l'application en quelques secondes, les suivants sont immédiats. |

FFmpeg 8.1 est inclus : il n'y a rien d'autre à installer.

**Désinstallation** : Paramètres Windows → Applications → Cut → Désinstaller. Les fichiers, les raccourcis et l'entrée de registre sont supprimés. La désinstallation propose aussi de supprimer les paramètres.

**Paramètres** : `%APPDATA%\Cut\settings.json` (dossier d'export, volume, taille de la fenêtre). Les caches sont dans `%LOCALAPPDATA%\Cut`.

> Windows SmartScreen peut afficher « Windows a protégé votre ordinateur » au premier lancement, car l'exécutable n'est pas signé avec un certificat commercial. Cliquez sur **Informations complémentaires**, puis **Exécuter quand même**.

## Utilisation

1. Glissez une vidéo dans la fenêtre, ou cliquez sur **Choisir une vidéo…** (MP4, MKV, MOV, TS, WebM…).
2. Placez-vous dans la vidéo, puis cliquez sur **Définir** pour le début (`I`) et la fin (`O`). Vous pouvez aussi saisir les temps directement : `1:02:03.5`, `02:03`, `95.5`, `1h02m03s`…
3. **Prévisualiser** (`P`) lit exactement le passage qui sera exporté.
4. Choisissez le dossier et le nom, puis cliquez sur **Exporter**.
5. **Nouvelle découpe** repart de la même vidéo, sans la recharger.

| Raccourci | Action |
|---|---|
| Espace | Lecture / pause |
| `I` / `O` | Définir le début / la fin à la position actuelle |
| `P` / Échap | Prévisualiser / arrêter l'aperçu |
| ← / → | −1 s / +1 s (Maj : ±10 s) |
| `,` / `.` | Image précédente / suivante |
| Origine / Fin | Aller au début / à la fin du clip |
| Molette sur la timeline | Zoom (Maj + molette : défilement) |
| Ctrl+O / Ctrl+E | Ouvrir / Exporter |

## Qualité : ce que fait Cut

Une vidéo compressée n'enregistre une image complète, appelée **image clé**, que toutes les 1 à 2 secondes. Sans réencodage, un clip ne peut commencer que sur l'une d'elles. La fin, elle, est toujours précise. Cut propose deux modes :

- **Début exact (par défaut, recommandé)** : le clip commence exactement là où vous avez placé le début.
  - Cut réencode en très haute qualité (H.264 CRF 14, ou HEVC CRF 16) **uniquement** le court passage entre votre point et la première image clé, soit 2 secondes au plus sur une VOD Twitch.
  - **Tout le reste est copié tel quel**, identique bit à bit à la source. L'audio original est copié sans modification.
  - L'export reste quasi instantané.
  - Après l'export, Cut décode la jonction entre les deux parties pour vérifier qu'elle est propre.
  - Si votre point tombe déjà sur une image clé, rien n'est réencodé du tout.
  - Cas particuliers, toujours indiqués avant et après l'export :
    - clip plus court que l'écart jusqu'à la première image clé : le clip entier est réencodé ;
    - codec autre que H.264 ou HEVC : le clip entier est réencodé ;
    - jonction impossible à raccorder proprement (HEVC à « GOP ouvert », par exemple) : réencodage du clip s'il dure 5 min ou moins, sinon copie sans perte depuis l'image clé.
- **Sans perte** : rien n'est réencodé, et le clip commence sur une image clé.
  - Par défaut, c'est l'image clé précédente : la partie hachurée est incluse.
  - Vous pouvez choisir l'image clé suivante : la partie hachurée est alors exclue.
  - Ce choix n'est pas mémorisé : chaque vidéo repart sur l'image clé précédente.

Dans tous les cas :
- Cut conserve les codecs, la résolution, le framerate, le format de pixels et l'audio.
- Cut ne réencode jamais rien sans l'indiquer, et n'écrase jamais la vidéo source.
- **Fichiers à l'index incomplet** : certaines VOD et certains enregistrements n'indexent pas correctement leurs images clés. Cut ne dépend pas de cet index : si besoin, il analyse une fois les images clés du fichier. Après chaque export, la durée réelle du fichier est comparée au clip demandé.
- Le détail du dernier export est noté dans `%APPDATA%\Cut\logs\dernier-export.txt`.

## Architecture

- **Electron 44**, sans aucune dépendance npm : `main.js` (processus principal), `preload.js` (pont sécurisé, sandbox activée), `renderer/` (interface HTML/CSS/JS), `lib/ffmpeg.js` (pilotage de FFmpeg et FFprobe), `lib/settings.js`.
- Le lecteur intégré (Chromium) lit nativement le H.264/AAC, le VP9, l'AV1 et le HEVC (si votre PC le prend en charge). Pour un codec non lisible (ProRes, audio AC-3…), Cut le signale et la découpe fonctionne quand même.
- Police : Inter (licence SIL OFL, `renderer/fonts`).

```
app/            code de l'application
assets/         logo (SVG), icône .ico, images de l'installateur
build/          build-win.sh, scripts NSIS (installateur et version portable)
tools/          patch-exe.ts : applique l'icône et les infos de version à Cut.exe (bibliothèque resedit)
test/           tests de bout en bout (Playwright + Electron)
```

## Reconstruire

Le build se fait sous Linux (ou WSL), avec les éléments téléchargés dans `$DL` :

- `electron-win.zip` : Electron v44.10.1 win32-x64 ;
- `ffmpeg-win.zip` : BtbN `ffmpeg-n8.1-latest-win64-gpl-shared-8.1.zip` ;
- `nsis/` et `nsisres/` : electron-builder-binaries `nsis-3.0.4.1` et `nsis-resources-3.4.1` ;
- `bun`, ainsi que les sources de `resedit` et `pe-library` dans `tools/node_modules`.

```bash
DL=~/dl ./build/build-win.sh
```

Tests : `xvfb-run node test/e2e.js` (Electron Linux et FFmpeg 8.1 requis). Ils couvrent :
- l'import, la lecture, la navigation, la saisie des temps et l'aperçu ;
- le début exact : nombre d'images exact, partie copiée vérifiée bit à bit, jonction décodée sans erreur et lue par le lecteur intégré ;
- l'export sans perte, l'image clé suivante et le clip très court ;
- l'annulation, le glisser-déposer, les formats MKV et MOV ;
- les VOD à index incomplet, l'absence d'image clé proche, la tête de lecture, la protection de la source et les paramètres.

## Licences

FFmpeg (GPL, build BtbN) : voir `resources/ffmpeg/LICENSE-FFmpeg.txt`. Electron/Chromium : `LICENSE` et `LICENSES.chromium.html` dans le dossier d'installation.
