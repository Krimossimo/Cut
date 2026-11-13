/*
 * Test de bout en bout de Cut : import, lecture, découpe, aperçu, export.
 * Lance l'application Electron réelle (build Linux, même code que Windows).
 */
const { _electron } = require('playwright');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');

const FF = process.env.FFBIN || '/root/dl/fflinux/bin';
const MEDIA = '/root/work/media';
const OUT = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-out-'));
const SHOTS = '/root/cut/test/shots';
fs.mkdirSync(SHOTS, { recursive: true });

let failures = 0;
function check(cond, label, extra = '') {
  console.log(`${cond ? '  ✔' : '  ✘'} ${label}${extra ? '  — ' + extra : ''}`);
  if (!cond) failures++;
}
function ffprobe(file) {
  return JSON.parse(execFileSync(`${FF}/ffprobe`, ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', file]).toString());
}
function frameMd5(file, ss) {
  const args = ['-v', 'error'];
  if (ss != null) args.push('-ss', String(ss));
  // 30 premières images décodées, flux vidéo seul
  args.push('-i', file, '-map', '0:v:0', '-an', '-frames:v', '30', '-f', 'md5', '-');
  return execFileSync(`${FF}/ffmpeg`, args).toString().trim();
}
function psnrValue(a, b, ssB) {
  const { spawnSync } = require('child_process');
  const r = spawnSync(`${FF}/ffmpeg`, ['-v', 'info', '-i', a, '-ss', String(ssB), '-i', b,
    '-frames:v', '1', '-lavfi', '[0:v][1:v]psnr', '-f', 'null', '-']);
  const m = r.stderr.toString().match(/average:([\d.]+|inf)/);
  return m ? (m[1] === 'inf' ? Infinity : parseFloat(m[1])) : null;
}

async function main() {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'cut-ud-'));
  const app = await _electron.launch({
    executablePath: '/root/el-linux/electron',
    args: ['--no-sandbox', '/root/cut/app'],
    env: { ...process.env, CUT_USER_DATA: ud, CUT_FFMPEG_DIR: FF },
  });
  const win = await app.firstWindow();
  const errors = [];
  win.on('pageerror', (e) => errors.push(e.message));
  win.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await win.waitForLoadState('domcontentloaded');
  await win.waitForTimeout(800);

  const S = () => win.evaluate(() => {
    const s = window.__cutState; const v = document.getElementById('video');
    return { in: s.in, out: s.out, mode: s.mode, snap: s.snap, kf: s.keyframes, exporting: s.exporting,
      previewing: s.previewing, t: v.currentTime, paused: v.paused, ready: v.readyState, vdur: v.duration,
      info: s.info && { duration: s.info.duration, name: s.info.name } };
  });
  const text = (sel) => win.locator(sel).innerText();

  // Bouchons des boîtes de dialogue natives (le reste est réel).
  async function stubOpen(file) {
    await app.evaluate(({ dialog }, f) => {
      dialog.showOpenDialog = async (_w, o) => ({ canceled: false, filePaths: [o && o.properties && o.properties.includes('openDirectory') ? global.__cutDir : f] });
    }, file);
  }
  await app.evaluate((_e, dir) => { global.__cutDir = dir; }, OUT);

  console.log('\n1. Écran d\'accueil');
  check(await win.locator('#emptyState').isVisible(), 'zone de dépôt affichée');
  await win.screenshot({ path: `${SHOTS}/01-accueil.png` });

  console.log('\n2. Import par l\'explorateur (MP4)');
  const src = `${MEDIA}/twitch.mp4`;
  await stubOpen(src);
  await win.click('#btnOpenEmpty');
  await win.waitForSelector('#editor:not([hidden])');
  await win.waitForFunction(() => document.getElementById('video').readyState >= 2, null, { timeout: 10000 });
  let st = await S();
  check(Math.abs(st.info.duration - 60) < 0.05, 'durée analysée', st.info.duration.toFixed(3));
  check(st.ready >= 2, 'vidéo chargée dans le lecteur');
  check((await text('#fileChips')).includes('1280×720'), 'métadonnées affichées', await text('#fileChips'));

  console.log('\n3. Lecture / pause');
  await win.click('#btnPlay');
  await win.waitForTimeout(1500);
  st = await S();
  check(!st.paused && st.t > 0.8, 'lecture en cours', `t=${st.t.toFixed(2)}`);
  await win.keyboard.press('Space');
  await win.waitForTimeout(200);
  st = await S();
  check(st.paused, 'pause (Espace)');
  const shownTime = await text('#timeCurrent');
  check(/^\d\d:\d\d:\d\d\.\d{3}$/.test(shownTime), 'timestamp affiché', shownTime);

  console.log('\n4. Navigation');
  const box = await win.locator('#tlTrack').boundingBox();
  await win.mouse.click(box.x + box.width * 0.5, box.y + box.height / 2);
  await win.waitForTimeout(400);
  st = await S();
  check(Math.abs(st.t - 30) < 0.6, 'clic sur la barre → ~30 s', st.t.toFixed(2));
  await win.keyboard.press('ArrowRight');
  await win.waitForTimeout(300);
  const t1 = (await S()).t;
  check(Math.abs(t1 - st.t - 1) < 0.05, 'flèche droite → +1 s', t1.toFixed(3));
  await win.click('.step-btn[data-frame="1"]');
  await win.waitForTimeout(300);
  const t2 = (await S()).t;
  check(Math.abs(t2 - t1 - 1 / 60) < 0.01, '+1 image', (t2 - t1).toFixed(4));

  console.log('\n5. Début / fin : bouton « Définir » et saisie manuelle');
  await win.evaluate(() => { document.getElementById('video').currentTime = 20; });
  await win.waitForTimeout(400);
  await win.click('#btnSetIn');
  st = await S();
  check(Math.abs(st.in - 20) < 0.02, 'début défini à la position actuelle', st.in.toFixed(3));
  await win.fill('#inStart', '00:00:11.300');
  await win.press('#inStart', 'Enter');
  await win.fill('#inEnd', '16.3');
  await win.press('#inEnd', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 11.3) < 1e-6; });
  st = await S();
  check(Math.abs(st.in - 11.3) < 1e-6 && Math.abs(st.out - 16.3) < 1e-6, 'saisie manuelle 00:00:11.300 → 16.3', `${st.in} → ${st.out}`);
  check(Math.abs(st.kf.prev - 10) < 0.01 && Math.abs(st.kf.next - 12) < 0.01, 'images clés détectées', `${st.kf.prev} / ${st.kf.next}`);
  // Mode par défaut : « Début exact »
  check((await win.getAttribute('.segmented button[data-mode="smart"]', 'aria-checked')) === 'true', 'mode « Début exact » par défaut');
  const info = await text('#modeInfo');
  check(info.includes('exactement à votre point') && info.includes('0,70 s'), 'explication : seules 0,70 s réencodées', info.replace(/\s+/g, ' ').slice(0, 130));
  check((await text('#clipDuration')) === '00:00:05.000', 'durée du clip = sélection exacte', await text('#clipDuration'));
  check(await win.locator('#tlGhost').isHidden(), 'aucune zone hachurée en « Début exact »');
  await win.fill('#inStart', 'n\'importe quoi');
  await win.press('#inStart', 'Enter');
  check(await win.locator('#inStart.invalid').count() === 1, 'saisie invalide signalée');
  await win.press('#inStart', 'Escape');
  check((await win.inputValue('#inStart')) === '00:00:11.300', 'valeur restaurée');
  await win.screenshot({ path: `${SHOTS}/02-selection.png` });

  console.log('\n6. Prévisualisation');
  await win.click('#btnPreview');
  await win.waitForTimeout(250);
  st = await S();
  check(st.previewing && st.t >= 11.29 && st.t < 11.9, 'aperçu démarre exactement au point de début (11,3 s)', st.t.toFixed(3));
  await win.screenshot({ path: `${SHOTS}/03-apercu.png` });
  await win.waitForFunction(() => !window.__cutState.previewing, null, { timeout: 15000 });
  st = await S();
  check(st.paused && Math.abs(st.t - 16.3) < 0.1, 'aperçu s\'arrête à la fin du clip', st.t.toFixed(3));

  console.log('\n7. Export « Début exact »');
  await stubOpen(src);
  await win.click('#btnChangeDir');
  await win.waitForFunction((d) => document.getElementById('exportDir').title === d, OUT);
  await win.fill('#exportName', 'clip-exact');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus.done', { timeout: 30000 });
  await win.screenshot({ path: `${SHOTS}/04-export-ok.png` });
  const out1 = path.join(OUT, 'clip-exact.mp4');
  check(fs.existsSync(out1), 'fichier créé', out1);
  const p0 = ffprobe(src); const p1 = ffprobe(out1);
  const v0 = p0.streams.find((s) => s.codec_type === 'video'); const v1 = p1.streams.find((s) => s.codec_type === 'video');
  const a0 = p0.streams.find((s) => s.codec_type === 'audio'); const a1 = p1.streams.find((s) => s.codec_type === 'audio');
  check(v1.codec_name === v0.codec_name && v1.profile === v0.profile, 'codec vidéo conservé', `${v1.codec_name} ${v1.profile}`);
  check(v1.width === v0.width && v1.height === v0.height, 'résolution conservée', `${v1.width}×${v1.height}`);
  check(v1.r_frame_rate === v0.r_frame_rate && v1.pix_fmt === v0.pix_fmt, 'framerate & format de pixels conservés', `${v1.r_frame_rate} ${v1.pix_fmt}`);
  check(a1.codec_name === a0.codec_name && a1.sample_rate === a0.sample_rate && a1.channels === a0.channels, 'audio original conservé', `${a1.codec_name} ${a1.sample_rate} Hz`);
  check(Math.abs(parseFloat(v1.duration) - 5.0) < 0.05 && parseInt(v1.nb_frames, 10) === 300, 'durée exacte : 300 images (11,3 → 16,3 s)', `${v1.duration} s, ${v1.nb_frames} images`);
  const psE = psnrValue(out1, src, 11.3);
  check(psE != null && psE > 45, '1re image = 11,300 s exactement (partie réencodée, PSNR)', `${psE && psE.toFixed(1)} dB`);
  const tailOut = execFileSync(`${FF}/ffmpeg`, ['-v', 'error', '-i', out1, '-map', '0:v:0', '-f', 'framemd5', '-']).toString().split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split(',').pop().trim()).slice(42, 102);
  const tailSrc = execFileSync(`${FF}/ffmpeg`, ['-v', 'error', '-ss', '12', '-i', src, '-map', '0:v:0', '-frames:v', '60', '-f', 'framemd5', '-']).toString().split('\n').filter((l) => l && l[0] !== '#').map((l) => l.split(',').pop().trim());
  check(tailOut.length === 60 && tailOut.every((m, k) => m === tailSrc[k]), 'à partir de l\'image clé 12 s : identique bit à bit à la source');
  const decErr = require('child_process').spawnSync(`${FF}/ffmpeg`, ['-v', 'error', '-i', out1, '-f', 'null', '-']).stderr.toString().trim();
  check(!decErr, 'décodage complet sans erreur (jonction propre)', decErr.slice(0, 80));
  check((await text('#statusTitle')).includes('début exact'), 'message de réussite', await text('#statusTitle'));

  console.log('\n7b. Lecture du clip exporté dans le lecteur intégré (jonction)');
  await win.click('#statusActions .btn.primary');
  await stubOpen(out1);
  await win.click('#btnOpen');
  await win.waitForFunction(() => window.__cutState.info && window.__cutState.info.name === 'clip-exact.mp4');
  await win.waitForFunction(() => document.getElementById('video').readyState >= 2);
  await win.evaluate(() => { const v = document.getElementById('video'); v.muted = true; v.currentTime = 0; return v.play(); });
  await win.waitForTimeout(1600);
  const pv = await win.evaluate(() => { const v = document.getElementById('video'); const q = v.getVideoPlaybackQuality(); v.pause(); return { t: v.currentTime, err: v.error && v.error.message, frames: q.totalVideoFrames, dropped: q.droppedVideoFrames }; });
  check(!pv.err && pv.t > 1.2, 'lecture fluide au-delà de la jonction (0,70 s)', `t=${pv.t.toFixed(2)} images=${pv.frames} perdues=${pv.dropped}`);
  await stubOpen(src);
  await win.click('#btnOpen');
  await win.waitForFunction(() => window.__cutState.info && window.__cutState.info.name === 'twitch.mp4');
  await win.waitForFunction(() => document.getElementById('video').readyState >= 2);

  console.log('\n7c. Export « Sans perte » (copie intégrale, calé sur une image clé)');
  await win.click('.segmented button[data-mode="copy"]');
  await win.fill('#inStart', '11.3'); await win.press('#inStart', 'Enter');
  await win.fill('#inEnd', '16.3'); await win.press('#inEnd', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 11.3) < 1e-6; });
  const infoC = await text('#modeInfo');
  check(infoC.includes('00:00:10.000') && infoC.includes('1,30 s'), 'limite d\'image clé expliquée', infoC.replace(/\s+/g, ' ').slice(0, 110));
  check((await text('#clipDuration')) === '00:00:06.300' && await win.locator('#tlGhost').isVisible(), 'durée réelle + zone hachurée', await text('#clipDuration'));
  await win.fill('#exportName', 'clip-copie');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus.done', { timeout: 20000 });
  const outC = path.join(OUT, 'clip-copie.mp4');
  check(Math.abs(parseFloat(ffprobe(outC).format.duration) - 6.37) < 0.06, 'durée du fichier', ffprobe(outC).format.duration);
  check(frameMd5(outC) === frameMd5(src, 10), '30 premières images identiques bit à bit (dès 10,000 s) : aucune perte');
  const brSrc = parseInt(v0.bit_rate, 10); const brOut = parseInt(ffprobe(outC).streams.find((x) => x.codec_type === 'video').bit_rate, 10);
  check(Math.abs(brOut / brSrc - 1) < 0.15, 'débit vidéo conservé', `${Math.round(brSrc / 1000)} → ${Math.round(brOut / 1000)} kb/s`);
  check((await text('#statusTitle')).includes('sans perte'), 'message de réussite', await text('#statusTitle'));

  console.log('\n8. Nouvelle découpe sans recharger');
  await win.click('#statusActions .btn.primary');
  st = await S();
  check(st.in === 0 && Math.abs(st.out - 60) < 0.01 && await win.locator('#exportRow').isVisible(), 'sélection réinitialisée, vidéo toujours chargée');

  console.log('\n9. Image clé suivante (sans perte)');
  await win.fill('#inStart', '11.3'); await win.press('#inStart', 'Enter');
  await win.fill('#inEnd', '20'); await win.press('#inEnd', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 11.3) < 1e-6; });
  await win.click('#modeInfo [data-act="snap-next"]');
  check((await text('#clipDuration')) === '00:00:08.000', 'durée recalculée (12 → 20 s)', await text('#clipDuration'));
  await win.fill('#exportName', 'clip-suivante');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus.done', { timeout: 20000 });
  const out2 = path.join(OUT, 'clip-suivante.mp4');
  check(frameMd5(out2) === frameMd5(src, 12), '1re image = image clé suivante (12,000 s), identique bit à bit');
  check(Math.abs(parseFloat(ffprobe(out2).format.duration) - 8.0) < 0.1, 'durée 8 s', ffprobe(out2).format.duration);
  await win.click('#statusActions .btn.primary');
  const settingsNow = JSON.parse(fs.readFileSync(path.join(ud, 'settings.json'), 'utf8'));
  check(settingsNow.snap !== 'next', 'le choix « image clé suivante » n\'est pas mémorisé');

  console.log('\n10. Clip très court (avant la 1re image clé) : réencodé et signalé');
  await win.click('.segmented button[data-mode="smart"]');
  await win.fill('#inStart', '11.3'); await win.press('#inStart', 'Enter');
  await win.fill('#inEnd', '11.8'); await win.press('#inEnd', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 11.3) < 1e-6; });
  check((await text('#btnExport')) === 'Exporter (réencodage)', 'bouton signale le réencodage');
  check((await text('#modeInfo')).includes('entièrement réencodé'), 'explication visible', (await text('#modeInfo')).slice(0, 90));
  await win.screenshot({ path: `${SHOTS}/05-clip-court.png` });
  await win.fill('#exportName', 'clip-court');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus.done', { timeout: 60000 });
  const out3 = path.join(OUT, 'clip-court.mp4');
  const v3 = ffprobe(out3).streams.find((x) => x.codec_type === 'video');
  check(parseInt(v3.nb_frames, 10) === 30, '30 images exactement (11,3 → 11,8 s)', v3.nb_frames);
  const ps = psnrValue(out3, src, 11.3);
  check(ps != null && ps > 40, '1re image = 11,300 s (PSNR élevé)', `${ps && ps.toFixed(1)} dB`);
  check((await text('#statusTitle')).includes('réencodé'), 'résultat identifié comme réencodé');
  await win.click('#statusActions .btn.primary');

  console.log('\n11. Annulation d\'un export');
  await stubOpen(`${MEDIA}/onekey.mp4`); // une seule image clé : le clip entier doit être réencodé (long)
  await win.click('#btnOpen');
  await win.waitForFunction(() => window.__cutState.info && window.__cutState.info.name === 'onekey.mp4');
  await win.fill('#inStart', '1'); await win.press('#inStart', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 1) < 1e-6; });
  await win.fill('#exportName', 'clip-annule');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus:not([hidden]) #statusActions button');
  await win.waitForTimeout(700);
  await win.click('#statusActions button');
  await win.waitForSelector('#exportRow:not([hidden])', { timeout: 10000 });
  check(!fs.existsSync(path.join(OUT, 'clip-annule.mp4')), 'fichier incomplet supprimé');
  check(fs.readdirSync(OUT).every((f) => !f.startsWith('.cut-tmp')), 'fichiers temporaires nettoyés');

  console.log('\n12. Glisser-déposer (MKV) puis MOV');
  const cdp = await win.context().newCDPSession(win);
  const dropAt = async (file) => {
    const data = { items: [], files: [file], dragOperationsMask: 1 };
    for (const type of ['dragEnter', 'dragOver', 'drop']) {
      await cdp.send('Input.dispatchDragEvent', { type, x: 600, y: 300, data });
    }
  };
  await dropAt(`${MEDIA}/twitch.mkv`);
  await win.waitForFunction(() => window.__cutState.info && window.__cutState.info.name === 'twitch.mkv', null, { timeout: 10000 });
  await win.waitForFunction(() => document.getElementById('video').readyState >= 2, null, { timeout: 10000 });
  check(true, 'MKV ouvert par glisser-déposer et lisible');
  check((await win.inputValue('#exportExt')) === 'mkv', 'format de sortie = format d\'origine (mkv)');
  await win.click('.segmented button[data-mode="copy"]');
  await win.fill('#inStart', '00:00:30'); await win.press('#inStart', 'Enter');
  await win.fill('#inEnd', '00:00:40'); await win.press('#inEnd', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 30) < 1e-6; });
  await win.fill('#exportName', 'clip-mkv');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus.done', { timeout: 20000 });
  const outMkv = path.join(OUT, 'clip-mkv.mkv');
  const kfMkv = (await S()).kf.prev;
  check(fs.existsSync(outMkv) && frameMd5(outMkv) === frameMd5(`${MEDIA}/twitch.mkv`, kfMkv), 'export MKV sans perte', `début ${kfMkv}`);

  await stubOpen(`${MEDIA}/twitch.mov`);
  await win.click('#btnOpen');
  await win.waitForFunction(() => window.__cutState.info && window.__cutState.info.name === 'twitch.mov');
  await win.waitForFunction(() => document.getElementById('video').readyState >= 2, null, { timeout: 10000 });
  await win.click('.segmented button[data-mode="copy"]');
  await win.fill('#inStart', '0:41.5'); await win.press('#inStart', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 41.5) < 1e-6; });
  await win.fill('#exportName', 'clip-mov');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus.done', { timeout: 20000 });
  const outMov = path.join(OUT, 'clip-mov.mov');
  check(fs.existsSync(outMov) && frameMd5(outMov) === frameMd5(`${MEDIA}/twitch.mov`, 40), 'export MOV sans perte (début 40 s)');
  check(Math.abs(parseFloat(ffprobe(outMov).format.duration) - 20) < 0.06, 'MOV jusqu\'à la fin de la vidéo', ffprobe(outMov).format.duration);

  console.log('\n13. Écrasement de la source refusé');
  await win.click('#statusActions .btn.primary');
  await win.fill('#exportName', 'twitch');
  await win.selectOption('#exportExt', 'mov');
  const before = fs.statSync(`${MEDIA}/twitch.mov`).mtimeMs;
  await win.click('#btnExport');
  await win.waitForTimeout(600);
  check(fs.statSync(`${MEDIA}/twitch.mov`).mtimeMs === before, 'la vidéo source n\'est jamais remplacée');

  console.log('\n15. VOD à index incomplet (le bug du « début ignoré »)');
  await win.click('#statusActions .btn.primary').catch(() => {});
  // VOD réaliste : B-frames + index de recherche incomplet
  await stubOpen(`${MEDIA}/unflagged_b.mp4`);
  await win.click('#btnOpen');
  await win.waitForFunction(() => window.__cutState.info && window.__cutState.info.name === 'unflagged_b.mp4');
  await win.fill('#inStart', '41.3'); await win.press('#inStart', 'Enter');
  await win.fill('#inEnd', '50'); await win.press('#inEnd', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 41.3) < 1e-6; }, null, { timeout: 20000 });
  check(Math.abs((await S()).kf.prev - 40) < 0.001, 'image clé correcte malgré l\'index incomplet', String((await S()).kf.prev));
  await win.click('.segmented button[data-mode="copy"]');
  await win.fill('#exportName', 'clip-index-incomplet');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus.done', { timeout: 30000 });
  const outU = path.join(OUT, 'clip-index-incomplet.mp4');
  const durU = parseFloat(ffprobe(outU).format.duration);
  check(Math.abs(durU - 10) < 0.1, 'le début est respecté (10 s et non 50 s)', durU.toFixed(2));
  check(frameMd5(outU) === frameMd5(`${MEDIA}/twitch.mp4`, 40), 'commence à l\'image clé 00:00:40.000, identique bit à bit');
  const log = fs.readFileSync(path.join(ud, 'logs', 'dernier-export.txt'), 'utf8');
  check(log.includes('Commande : ffmpeg') && log.includes('41.3'), 'journal du dernier export écrit');

  console.log('\n16. Aucune image clé proche : avertissement explicite');
  await win.click('#statusActions .btn.primary');
  await stubOpen(`${MEDIA}/onekey.mp4`);
  await win.click('#btnOpen');
  await win.waitForFunction(() => window.__cutState.info && window.__cutState.info.name === 'onekey.mp4');
  await win.click('.segmented button[data-mode="copy"]');
  await win.fill('#inStart', '60.7'); await win.press('#inStart', 'Enter');
  await win.fill('#inEnd', '80'); await win.press('#inEnd', 'Enter');
  await win.waitForFunction(() => { const s = window.__cutState; return s.keyframes && Math.abs(s.keyframes.forIn - 60.7) < 1e-6; });
  check((await text('#modeInfo')).includes('Pas d\'image clé proche'), 'avertissement affiché', (await text('#modeInfo')).slice(0, 80));
  let asked = null;
  await app.evaluate(({ dialog }) => { global.__asked = null; dialog.showMessageBox = async (_w, o) => { global.__asked = o.message; return { response: 0 }; }; });
  await win.fill('#exportName', 'clip-sans-cle');
  await win.click('#btnExport');
  await win.waitForSelector('#exportStatus.done', { timeout: 60000 });
  asked = await app.evaluate(() => global.__asked);
  check(!!asked && asked.includes('image clé'), 'boîte de dialogue proposée avant l\'export', asked || '');
  const outK = path.join(OUT, 'clip-sans-cle.mp4');
  const durK = parseFloat(ffprobe(outK).format.duration);
  check(Math.abs(durK - 19.3) < 0.1 && (await text('#statusTitle')).includes('réencodé'), '« Début exact » choisi : début exact', durK.toFixed(2));
  await win.click('#statusActions .btn.primary');
  await win.click('.segmented button[data-mode="copy"]');

  console.log('\n17. Tête de lecture');
  await stubOpen(src);
  await win.click('#btnOpen');
  await win.waitForFunction(() => window.__cutState.info && window.__cutState.info.name === 'twitch.mp4');
  await win.waitForFunction(() => document.getElementById('video').readyState >= 2);
  await win.fill('#inStart', '20'); await win.press('#inStart', 'Enter');
  await win.press('#inStart', 'Escape').catch(() => {});
  await win.evaluate(() => new Promise((r) => { const v = document.getElementById('video'); v.addEventListener('seeked', r, { once: true }); v.currentTime = 20; }));
  await win.waitForTimeout(200);
  const tb = await win.locator('#tlTrack').boundingBox();
  const kTop = await win.locator('.ph-knob.top').boundingBox();
  const kBot = await win.locator('.ph-knob.bottom').boundingBox();
  const hb = await win.locator('#hIn').boundingBox();
  check(kTop.y + kTop.height <= tb.y + 2 && kBot.y >= tb.y + tb.height - 2, 'dépasse au-dessus et en dessous de la barre',
    `poignées ${Math.round(kTop.y)}–${Math.round(kBot.y + kBot.height)} / barre ${Math.round(tb.y)}–${Math.round(tb.y + tb.height)}`);
  check(Math.abs((kTop.x + kTop.width / 2) - (hb.x + hb.width / 2)) < 12, 'superposée à la borne de début (cas difficile)');
  const inBefore = (await S()).in;
  await win.mouse.move(kTop.x + kTop.width / 2, kTop.y + kTop.height / 2);
  await win.mouse.down();
  await win.mouse.move(kTop.x + kTop.width / 2 + tb.width * 0.25, kTop.y + 4, { steps: 8 });
  await win.mouse.up();
  await win.waitForTimeout(400);
  st = await S();
  check(st.in === inBefore && Math.abs(st.t - (20 + 15)) < 1, 'la poignée déplace la lecture, pas la borne', `t=${st.t.toFixed(2)}, début=${st.in}`);
  await win.screenshot({ path: `${SHOTS}/06-tete-de-lecture.png` });

  console.log('\n14. Paramètres enregistrés localement');
  await app.evaluate(() => new Promise((r) => setTimeout(r, 500)));
  const settingsFile = path.join(ud, 'settings.json');
  const saved = fs.existsSync(settingsFile) ? JSON.parse(fs.readFileSync(settingsFile, 'utf8')) : {};
  check(saved.exportDir === OUT, 'dossier d\'export mémorisé', settingsFile);

  check(errors.length === 0, 'aucune erreur JavaScript', errors.join(' | '));
  await app.close();
  console.log(`\n${failures === 0 ? 'TOUS LES TESTS PASSENT' : failures + ' ÉCHEC(S)'}`);
  process.exit(failures ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
