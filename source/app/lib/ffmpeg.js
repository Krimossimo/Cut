/*
 * Cut — pilotage de FFmpeg / FFprobe.
 *
 * Principe : par défaut, découpe en "stream copy" (-c copy). Aucun flux n'est
 * décodé ni réencodé : codecs, résolution, framerate, débit et audio sont
 * conservés à l'identique. Le mode "précis" (réencodage du clip uniquement)
 * n'est utilisé que s'il est explicitement demandé.
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const IS_WIN = process.platform === 'win32';
const EXE = IS_WIN ? '.exe' : '';

let cachedBins = null;

/** Localise ffmpeg/ffprobe : intégrés à l'application, sinon dans le PATH. */
function resolveBinaries() {
  if (cachedBins) return cachedBins;
  const candidates = [
    process.env.CUT_FFMPEG_DIR,
    process.resourcesPath && path.join(process.resourcesPath, 'ffmpeg'),
    path.join(__dirname, '..', '..', 'vendor', 'ffmpeg'),
  ].filter(Boolean);
  for (const dir of candidates) {
    const ffmpeg = path.join(dir, 'ffmpeg' + EXE);
    const ffprobe = path.join(dir, 'ffprobe' + EXE);
    if (fs.existsSync(ffmpeg) && fs.existsSync(ffprobe)) {
      cachedBins = { ffmpeg, ffprobe, bundled: true, dir };
      return cachedBins;
    }
  }
  cachedBins = { ffmpeg: 'ffmpeg', ffprobe: 'ffprobe', bundled: false, dir: null };
  return cachedBins;
}

function run(bin, args, { onStdoutLine, onSpawn } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawn(bin, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (err) {
      reject(err);
      return;
    }
    if (onSpawn) onSpawn(child);
    const out = [];
    let err = '';
    let lineBuf = '';
    child.stdout.on('data', (d) => {
      if (onStdoutLine) {
        lineBuf += d.toString('utf8');
        let idx;
        while ((idx = lineBuf.indexOf('\n')) >= 0) {
          onStdoutLine(lineBuf.slice(0, idx).trim());
          lineBuf = lineBuf.slice(idx + 1);
        }
      } else {
        out.push(d);
      }
    });
    child.stderr.on('data', (d) => {
      err += d.toString('utf8');
      if (err.length > 64000) err = err.slice(-32000);
    });
    child.on('error', reject);
    child.on('close', (code, signal) => {
      resolve({ code, signal, stdout: Buffer.concat(out).toString('utf8'), stderr: err });
    });
  });
}

function num(v) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : null;
}

function parseRate(r) {
  if (!r || r === '0/0') return null;
  const [a, b] = String(r).split('/').map(Number);
  if (!b) return num(a);
  const v = a / b;
  return Number.isFinite(v) && v > 0 ? v : null;
}

const CODEC_LABELS = {
  h264: 'H.264', hevc: 'HEVC (H.265)', av1: 'AV1', vp9: 'VP9', vp8: 'VP8',
  prores: 'ProRes', mpeg4: 'MPEG-4', mpeg2video: 'MPEG-2', dnxhd: 'DNxHD',
  aac: 'AAC', mp3: 'MP3', opus: 'Opus', vorbis: 'Vorbis', flac: 'FLAC',
  ac3: 'AC-3', eac3: 'E-AC-3', dts: 'DTS', truehd: 'TrueHD', alac: 'ALAC',
};
function codecLabel(name) {
  if (!name) return '?';
  if (name.startsWith('pcm_')) return 'PCM';
  return CODEC_LABELS[name] || name.toUpperCase();
}

// Codecs que le lecteur intégré (Chromium) sait décoder pour l'aperçu.
const PREVIEW_VIDEO = new Set(['h264', 'vp8', 'vp9', 'av1', 'hevc', 'theora']);
const PREVIEW_AUDIO = new Set(['aac', 'mp3', 'opus', 'vorbis', 'flac']);

/** Analyse un fichier vidéo avec ffprobe. */
async function probe(file) {
  const { ffprobe } = resolveBinaries();
  const res = await run(ffprobe, [
    '-v', 'error', '-hide_banner',
    '-show_format', '-show_streams',
    '-of', 'json', file,
  ]);
  if (res.code !== 0) {
    const msg = res.stderr.trim().split('\n').pop() || 'Fichier illisible';
    throw new Error(`Impossible d'analyser ce fichier : ${msg}`);
  }
  let data;
  try {
    data = JSON.parse(res.stdout);
  } catch {
    throw new Error("Réponse inattendue de ffprobe");
  }
  const streams = data.streams || [];
  const fmt = data.format || {};
  const video = streams.find((s) => s.codec_type === 'video' && !(s.disposition && s.disposition.attached_pic));
  const audios = streams.filter((s) => s.codec_type === 'audio');
  const subs = streams.filter((s) => s.codec_type === 'subtitle');
  if (!video && audios.length === 0) {
    throw new Error("Ce fichier ne contient aucun flux vidéo ou audio.");
  }

  let duration = num(fmt.duration);
  if (!duration && video) duration = num(video.duration);
  if (!duration) duration = await measureDuration(file, video ? video.index : null);
  if (!duration) throw new Error("Durée de la vidéo introuvable.");

  const fps = video ? (parseRate(video.avg_frame_rate) || parseRate(video.r_frame_rate)) : null;
  let rotation = 0;
  if (video) {
    if (video.tags && video.tags.rotate) rotation = parseInt(video.tags.rotate, 10) || 0;
    for (const sd of video.side_data_list || []) if (sd.rotation != null) rotation = sd.rotation;
  }

  const ext = path.extname(file).slice(1).toLowerCase();
  const info = {
    path: file,
    name: path.basename(file),
    dir: path.dirname(file),
    base: path.basename(file, path.extname(file)),
    ext,
    size: num(fmt.size),
    duration,
    startTime: num(fmt.start_time) || 0,
    formatName: fmt.format_name || '',
    bitRate: num(fmt.bit_rate),
    video: video ? {
      index: video.index,
      codec: video.codec_name,
      codecLabel: codecLabel(video.codec_name),
      profile: video.profile || null,
      width: video.width,
      height: video.height,
      fps,
      pixFmt: video.pix_fmt || null,
      bitRate: num(video.bit_rate),
      rotation,
      previewable: PREVIEW_VIDEO.has(video.codec_name),
    } : null,
    audio: audios.map((a) => ({
      index: a.index,
      codec: a.codec_name,
      codecLabel: codecLabel(a.codec_name),
      channels: a.channels,
      sampleRate: num(a.sample_rate),
      bitRate: num(a.bit_rate),
      language: (a.tags && a.tags.language) || null,
      previewable: PREVIEW_AUDIO.has(a.codec_name) || String(a.codec_name).startsWith('pcm_'),
    })),
    subtitleCount: subs.length,
  };
  return info;
}

/**
 * Repli quand le fichier n'indique pas sa durée (MKV d'un enregistrement interrompu…) :
 * lit tous les paquets sans les décoder et retient le dernier horodatage.
 */
async function measureDuration(file, videoIndex) {
  const { ffmpeg } = resolveBinaries();
  let last = null;
  const args = ['-hide_banner', '-nostdin', '-v', 'error', '-i', file];
  if (videoIndex != null) args.push('-map', `0:${videoIndex}`);
  args.push('-c', 'copy', '-f', 'null', '-progress', 'pipe:1', '-nostats', '-');
  try {
    await run(ffmpeg, args, {
      onStdoutLine: (line) => {
        const m = line.match(/^out_time_us=(\d+)/);
        if (m) last = parseInt(m[1], 10) / 1e6;
      },
    });
  } catch { return null; }
  return last && last > 0 ? last : null;
}

/** Lit les paquets vidéo d'un intervalle et retourne les images clés (temps relatifs). */
async function readKeyframes(file, info, intervals) {
  const { ffprobe } = resolveBinaries();
  const start0 = info.startTime || 0;
  const args = ['-v', 'error', '-hide_banner',
    '-select_streams', info.video ? String(info.video.index) : 'v:0'];
  if (intervals) args.push('-read_intervals', intervals);
  args.push('-show_entries', 'packet=pts_time,dts_time,flags', '-of', 'csv=p=0', file);
  const res = await run(ffprobe, args);
  if (res.code !== 0) throw new Error("Lecture des images clés impossible.");
  const list = [];
  const dts = {};
  let firstPts = null;
  for (const line of res.stdout.split(/\r?\n/)) {
    const [p, d, flags] = line.split(',');
    if (!flags) continue;
    let v = parseFloat(p);
    const dv = parseFloat(d);
    if (!Number.isFinite(v)) v = dv;
    if (!Number.isFinite(v)) continue;
    if (firstPts === null) firstPts = v - start0;
    if (flags[0] !== 'K') continue;
    list.push(v - start0);
    // Horodatage de décodage : avec des B-frames il précède l'instant d'affichage,
    // et c'est lui que FFmpeg compare lors de la découpe en copie.
    if (Number.isFinite(dv)) dts[(v - start0).toFixed(6)] = dv - start0;
  }
  list.sort((a, b) => a - b);
  return { list, dts, firstPts };
}

// Index complet des images clés, pour les fichiers dont l'index de recherche est défaillant.
const fullIndexCache = new Map();

function pickAround(list, t) {
  const eps = 0.0005;
  let prev = null;
  let next = null;
  for (const k of list) {
    if (k <= t + eps) prev = k;
    else if (next === null) next = k;
  }
  return { prev, next };
}

/**
 * Recherche les images clés autour de `t` (secondes, relatives au début du fichier).
 * Retourne { prev, next, list, dts }. Ne lit qu'une petite fenêtre du fichier (sans
 * décodage). Si l'index du fichier ne permet pas d'y sauter, analyse une fois tout le
 * fichier et garde le résultat en mémoire.
 */
async function keyframesAround(file, t, info) {
  const key = `${file}|${info.size}|${info.duration}`;
  const cached = fullIndexCache.get(key);
  if (cached) {
    const { prev, next } = pickAround(cached.list, t);
    return { prev: Math.max(0, prev == null ? 0 : prev), next, list: cached.list, dts: cached.dts, fullScan: true };
  }
  const start0 = info.startTime || 0;
  let found = null;
  for (const span of [20, 90, 400]) {
    const from = Math.max(0, t - span);
    const to = t + span;
    // Bornes absolues (« début%fin ») : correctes même si FFprobe doit repartir du début.
    const r = await readKeyframes(file, info, `${(start0 + from).toFixed(3)}%${(start0 + to).toFixed(3)}`);
    if (from > 5 && r.firstPts !== null && r.firstPts < from - Math.max(30, span)) {
      // FFprobe n'a pas pu sauter au bon endroit : l'index du fichier est incomplet.
      const full = await readKeyframes(file, info, null);
      fullIndexCache.set(key, full);
      const { prev, next } = pickAround(full.list, t);
      return { prev: Math.max(0, prev == null ? 0 : prev), next, list: full.list, dts: full.dts, fullScan: true };
    }
    const { prev, next } = pickAround(r.list, t);
    found = { prev, next, list: r.list, dts: r.dts };
    const prevOk = prev !== null || from <= 0;
    const nextOk = next !== null || to >= info.duration;
    if (prevOk && nextOk) break;
  }
  return { prev: Math.max(0, found.prev == null ? 0 : found.prev), next: found.next, list: found.list, dts: found.dts };
}

const SAME_CONTAINER = {
  mp4: ['mp4', 'm4v'], m4v: ['mp4', 'm4v'], mov: ['mov'], mkv: ['mkv'], webm: ['webm', 'mkv'],
};

function chooseEncoder(info, outExt) {
  const codec = info.video && info.video.codec;
  const args = [];
  let label;
  if (codec === 'hevc') {
    args.push('-c:v', 'libx265', '-crf', '18', '-preset', 'medium', '-x265-params', 'log-level=error');
    if (outExt === 'mp4' || outExt === 'mov') args.push('-tag:v', 'hvc1');
    label = 'HEVC (libx265, CRF 18)';
  } else {
    args.push('-c:v', 'libx264', '-crf', '16', '-preset', 'medium');
    label = 'H.264 (libx264, CRF 16)';
  }
  // Conserver le format de pixels quand l'encodeur le permet.
  const pf = info.video && info.video.pixFmt;
  const okPix = ['yuv420p', 'yuv420p10le', 'yuv422p', 'yuv422p10le', 'yuv444p', 'yuv444p10le'];
  if (pf === 'yuvj420p') args.push('-pix_fmt', 'yuv420p');
  else if (pf && okPix.includes(pf)) args.push('-pix_fmt', pf);
  else args.push('-pix_fmt', 'yuv420p');
  return { args, label };
}

/**
 * Construit la ligne de commande FFmpeg.
 * opts: { input, output, start, end, mode: 'copy'|'precise', snap: 'prev'|'next', keyframes, info }
 * Retourne { args, effectiveStart, clipDuration, reencode, encoderLabel }.
 */
function buildExportArgs(opts) {
  const { input, output, info } = opts;
  const mode = opts.mode === 'precise' ? 'precise' : 'copy';
  if (opts.mode === 'smart') throw new Error('Utiliser planExport pour le mode « début exact ».');
  const start = Math.max(0, Number(opts.start) || 0);
  const end = Math.min(info.duration, Number(opts.end));
  if (!(end > start)) throw new Error('La fin doit être après le début.');
  const outExt = path.extname(output).slice(1).toLowerCase();
  const inExt = info.ext;
  const sameContainer = (SAME_CONTAINER[inExt] || [inExt]).includes(outExt);
  const toEnd = end >= info.duration - 0.0005;

  const maps = [];
  if (info.video) maps.push('-map', '0:V?');
  maps.push('-map', '0:a?');
  if (sameContainer && info.subtitleCount > 0) maps.push('-map', '0:s?');

  const common = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
  const tail = ['-map_metadata', '0', '-avoid_negative_ts', 'make_zero',
    '-progress', 'pipe:1', '-nostats', output];

  if (mode === 'copy') {
    // En copie de flux, le clip commence forcément sur une image clé : on choisit
    // explicitement laquelle (précédente ou suivante).
    //
    // Recherche en deux temps, comme pour le mode précis :
    //   -ss <cible - 30 s> AVANT -i  : saut rapide grâce à l'index du fichier ;
    //   -ss <reste>        APRÈS -i  : FFmpeg écarte tous les paquets antérieurs à l'image clé.
    // Si l'index du fichier est incomplet (fréquent sur certaines VOD et enregistrements),
    // le saut rapide retombe au début de la vidéo ; la seconde recherche garantit malgré
    // tout que le clip démarre exactement sur l'image clé choisie, au lieu de recopier
    // tout le début.
    let effectiveStart = 0;
    const kf = opts.keyframes;
    if (start > 0.0005) {
      if (!kf) throw new Error('Images clés inconnues pour ce point de début.');
      let target = kf.prev;
      if (opts.snap === 'next' && kf.next != null && kf.next < end) target = kf.next;
      effectiveStart = target;
    }
    const args = [...common];
    if (effectiveStart > 0.0005) {
      // FFmpeg compare l'horodatage de DÉCODAGE des paquets : on vise 1 ms avant celui de
      // l'image clé (un peu avant son instant d'affichage quand la vidéo a des B-frames).
      // Les paquets non-clés situés juste avant sont écartés d'office par FFmpeg.
      const kdts = kf.dts && kf.dts[effectiveStart.toFixed(6)];
      const keyDts = Number.isFinite(kdts) ? Math.min(kdts, effectiveStart) : effectiveStart;
      const aim = Math.max(0, keyDts - 0.001);
      const coarse = Math.max(0, aim - 30);
      if (coarse > 0.0005) args.push('-ss', coarse.toFixed(6));
      args.push('-i', input);
      args.push('-ss', (aim - coarse).toFixed(6));
      if (!toEnd) args.push('-t', (end - aim).toFixed(6));
    } else {
      args.push('-i', input);
      if (!toEnd) args.push('-t', end.toFixed(6));
    }
    args.push(...maps, '-c', 'copy');
    if (!sameContainer && (outExt === 'mp4' || outExt === 'mov') && info.video && info.video.codec === 'hevc') {
      args.push('-tag:v', 'hvc1');
    }
    args.push(...tail);
    return { args, effectiveStart, clipDuration: end - effectiveStart, reencode: false, encoderLabel: null };
  }

  // Mode précis : recherche rapide jusqu'à ~30 s avant, puis recherche exacte.
  const pre = Math.min(start, 30);
  const coarse = start - pre;
  const enc = chooseEncoder(info, outExt);
  const args = [...common];
  if (coarse > 0.0005) args.push('-ss', coarse.toFixed(6));
  args.push('-i', input);
  if (pre > 0.0005) args.push('-ss', pre.toFixed(6));
  if (!toEnd) args.push('-t', (end - start).toFixed(6));
  args.push(...maps);
  if (info.video) args.push(...enc.args);
  args.push('-c:a', 'copy');
  if (sameContainer && info.subtitleCount > 0) args.push('-c:s', 'copy');
  args.push(...tail);
  return { args, effectiveStart: start, clipDuration: end - start, reencode: true, encoderLabel: enc.label };
}

// ---------------------------------------------------------------- Début exact
//
// Le clip doit commencer exactement au point choisi, sans réencoder la vidéo :
//   1. tête  : de votre point jusqu'à la première image clé (≈ 2 s au plus sur Twitch),
//              réencodée en très haute qualité ;
//   2. corps : de cette image clé jusqu'à la fin, copié tel quel (identique bit à bit) ;
//   3. audio : copié tel quel, coupé à votre point ;
//   4. assemblage sans réencodage, puis vérification du décodage à la jonction.

const SMART_CODECS = new Set(['h264', 'hevc']);

const X264_PROFILES = {
  'Baseline': 'baseline', 'Constrained Baseline': 'baseline', 'Main': 'main', 'High': 'high',
  'High 10': 'high10', 'High 4:2:2': 'high422', 'High 4:4:4 Predictive': 'high444',
};

/** Décide comment sera produit le clip en mode « début exact ». */
function decideSmart(info, start, end, kf) {
  const fps = (info.video && info.video.fps) || 30;
  const half = 0.5 / fps;
  if (!info.video || start <= 0.0005) return { kind: 'copy', target: 0 };
  if (!kf) throw new Error('Images clés inconnues pour ce point de début.');
  if (Math.abs(kf.prev - start) <= half) return { kind: 'copy', target: kf.prev };
  const v = info.video;
  if (!SMART_CODECS.has(v.codec) || (v.rotation && v.rotation % 360 !== 0)) {
    return { kind: 'precise', reason: 'codec' };
  }
  if (kf.next == null || kf.next >= end - half) return { kind: 'precise', reason: 'short' };
  return { kind: 'smart', key: kf.next };
}

function headEncoderArgs(info) {
  const v = info.video;
  const pf = v.pixFmt === 'yuvj420p' ? 'yuv420p' : v.pixFmt;
  const okPix = ['yuv420p', 'yuv420p10le', 'yuv422p', 'yuv422p10le', 'yuv444p', 'yuv444p10le'];
  const pix = okPix.includes(pf) ? pf : 'yuv420p';
  if (v.codec === 'hevc') {
    return {
      args: ['-c:v', 'libx265', '-preset', 'medium', '-crf', '16', '-pix_fmt', pix,
        '-x265-params', 'log-level=error:bframes=0:repeat-headers=1'],
      label: 'HEVC (libx265, CRF 16)',
    };
  }
  const args = ['-c:v', 'libx264', '-preset', 'medium', '-crf', '14', '-bf', '0', '-pix_fmt', pix];
  const prof = X264_PROFILES[v.profile];
  if (prof && !(prof === 'high' && pix !== 'yuv420p') && prof !== 'baseline') args.push('-profile:v', prof);
  return { args, label: 'H.264 (libx264, CRF 14)' };
}

function concatQuote(name) {
  return `'${name.replace(/'/g, "'\\''")}'`;
}

/**
 * Prépare l'export : retourne un plan { kind, steps[], effectiveStart, clipDuration,
 * reencode, reencodedSeconds, encoderLabel, tmpDir }.
 */
function planExport(opts) {
  const { input, output, info } = opts;
  if (opts.mode !== 'smart') {
    const p = buildExportArgs(opts);
    return { kind: opts.mode === 'precise' ? 'precise' : 'copy', steps: [{ args: p.args, weight: 1, duration: p.clipDuration }],
      effectiveStart: p.effectiveStart, clipDuration: p.clipDuration, reencode: p.reencode,
      reencodedSeconds: p.reencode ? p.clipDuration : 0, encoderLabel: p.encoderLabel, args: p.args };
  }
  const start = Math.max(0, Number(opts.start) || 0);
  const end = Math.min(info.duration, Number(opts.end));
  if (!(end > start)) throw new Error('La fin doit être après le début.');
  const kf = opts.keyframes;
  const d = decideSmart(info, start, end, kf);
  if (d.kind === 'copy') {
    const p = planExport({ ...opts, mode: 'copy', snap: 'prev' });
    return { ...p, kind: 'copy' };
  }
  if (d.kind === 'precise') {
    const p = planExport({ ...opts, mode: 'precise' });
    return { ...p, kind: 'precise', reason: d.reason };
  }

  const K = d.key;
  const fps = info.video.fps || 30;
  const outExt = path.extname(output).slice(1).toLowerCase();
  const toEnd = end >= info.duration - 0.0005;
  const kdtsRaw = kf.dts && kf.dts[K.toFixed(6)];
  const kdts = Number.isFinite(kdtsRaw) ? Math.min(kdtsRaw, K) : K;
  const delay = Math.max(0, K - kdts); // décalage de décodage dû aux B-frames
  const vidx = info.video.index;
  const tmpDir = path.join(path.dirname(output), `.cut-tmp-${process.pid}-${Date.now()}`);
  const headF = path.join(tmpDir, 'tete.ts');
  const bodyF = path.join(tmpDir, 'corps.ts');
  const audioF = path.join(tmpDir, 'audio.mka');
  const listF = path.join(tmpDir, 'liste.txt');
  const common = ['-hide_banner', '-nostdin', '-y', '-loglevel', 'error'];
  const progress = ['-progress', 'pipe:1', '-nostats'];
  const seekPair = (target) => {
    const coarse = Math.max(0, target - 30);
    const a = [];
    if (coarse > 0.0005) a.push('-ss', coarse.toFixed(6));
    return { pre: a, fine: (target - coarse).toFixed(6) };
  };
  const enc = headEncoderArgs(info);
  const steps = [];

  // 1. Tête réencodée [start, K) — sans B-frames, horodatages de décodage avancés du
  //    même décalage que le corps pour que la jonction reste monotone.
  {
    const sp = seekPair(start);
    const args = [...common, ...sp.pre, '-i', input, '-ss', sp.fine,
      '-t', (K - start - 0.5 / fps).toFixed(6),
      '-map', `0:${vidx}`, '-an', '-sn', '-dn', ...enc.args, '-fps_mode', 'passthrough'];
    if (delay > 0.0001) args.push('-bsf:v', `setts=dts=DTS-round(${delay.toFixed(6)}/TB)`);
    args.push('-f', 'mpegts', ...progress, headF);
    steps.push({ label: 'tete', args, weight: 0.15, duration: K - start });
  }
  // 2. Corps copié [K, end]
  {
    const sp = seekPair(Math.max(0, kdts - 0.001));
    const args = [...common, ...sp.pre, '-i', input, '-ss', sp.fine];
    if (!toEnd) args.push('-t', (end - K).toFixed(6));
    args.push('-map', `0:${vidx}`, '-c:v', 'copy', '-f', 'mpegts', ...progress, bodyF);
    steps.push({ label: 'corps', args, weight: 0.45, duration: end - K });
  }
  // 3. Audio (et sous-titres en MKV) copiés [start, end]
  const hasAudio = info.audio.length > 0;
  const subs = outExt === 'mkv' && info.subtitleCount > 0;
  if (hasAudio || subs) {
    const sp = seekPair(start);
    const args = [...common, ...sp.pre, '-i', input, '-ss', sp.fine];
    if (!toEnd) args.push('-t', (end - start).toFixed(6));
    if (hasAudio) args.push('-map', '0:a');
    if (subs) args.push('-map', '0:s?');
    args.push('-c', 'copy', '-f', 'matroska', ...progress, audioF);
    steps.push({ label: 'audio', args, weight: 0.05, duration: end - start });
  }
  // 4. Assemblage
  {
    const args = [...common, '-f', 'concat', '-safe', '0', '-i', listF];
    let n = 1;
    if (hasAudio || subs) { args.push('-i', audioF); n++; }
    args.push('-i', input); // métadonnées d'origine uniquement
    args.push('-map', '0:v');
    if (hasAudio || subs) args.push('-map', '1');
    args.push('-c', 'copy', '-map_metadata', String(n), '-map_chapters', '-1');
    // Paramètres du flux réencodé et du flux copié transmis dans le flux (hev1) pour HEVC.
    if (info.video.codec === 'hevc' && (outExt === 'mp4' || outExt === 'mov')) args.push('-tag:v', 'hev1');
    args.push('-avoid_negative_ts', 'make_zero', ...progress, output);
    steps.push({ label: 'assemblage', args, weight: 0.35, duration: end - start,
      before: () => {
        fs.writeFileSync(listF, `ffconcat version 1.0\nfile ${concatQuote('tete.ts')}\nduration ${(K - start).toFixed(6)}\nfile ${concatQuote('corps.ts')}\n`, 'utf8');
      } });
  }
  return {
    kind: 'smart', steps, tmpDir, effectiveStart: start, clipDuration: end - start, reencode: false,
    reencodedSeconds: K - start, keyframe: K, encoderLabel: enc.label,
    args: steps.flatMap((st) => ['#', ...st.args]),
  };
}

/** Décode le début du clip (jonction comprise) et signale toute erreur de décodage. */
async function verifyJunction(file, upTo) {
  const { ffmpeg } = resolveBinaries();
  const res = await run(ffmpeg, ['-hide_banner', '-nostdin', '-v', 'error', '-t', upTo.toFixed(3),
    '-i', file, '-map', '0:v:0', '-f', 'null', '-']);
  return res.code === 0 && !res.stderr.trim();
}

function samePath(a, b) {
  const ra = path.resolve(a);
  const rb = path.resolve(b);
  return IS_WIN ? ra.toLowerCase() === rb.toLowerCase() : ra === rb;
}

/**
 * Lance l'export. onProgress({ ratio, outTime, speed }).
 * Retourne un objet { promise, cancel }.
 */
function exportClip(opts, onProgress) {
  const { ffmpeg } = resolveBinaries();
  if (samePath(opts.input, opts.output)) {
    throw new Error('Le fichier exporté ne peut pas remplacer la vidéo source.');
  }
  let plan = planExport(opts);
  const firstPlan = plan;
  let child = null;
  let cancelled = false;
  const startedAt = Date.now();
  let speed = null;

  const cleanupTmp = (pl) => {
    if (pl.tmpDir) { try { fs.rmSync(pl.tmpDir, { recursive: true, force: true }); } catch { /* ignore */ } }
  };

  // Exécute les étapes d'un plan ; la progression couvre [base, base + span].
  async function runPlan(pl, base, span) {
    if (pl.tmpDir) fs.mkdirSync(pl.tmpDir, { recursive: true });
    let done = 0;
    try {
      for (const step of pl.steps) {
        if (cancelled) return { cancelled: true };
        if (step.before) step.before();
        const res = await run(ffmpeg, step.args, {
          onSpawn: (c) => { child = c; },
          onStdoutLine: (line) => {
            const eq = line.indexOf('=');
            if (eq < 0) return;
            const key = line.slice(0, eq);
            const val = line.slice(eq + 1);
            if (key === 'speed') speed = parseFloat(val) || null;
            if (key === 'out_time_us' || key === 'out_time_ms') {
              const t = parseInt(val, 10) / 1e6;
              if (Number.isFinite(t) && t >= 0 && onProgress) {
                const r = Math.min(1, t / Math.max(0.001, step.duration));
                onProgress({ ratio: Math.min(1, base + (done + r * step.weight) * span), outTime: t, speed });
              }
            }
          },
        });
        if (cancelled) return { cancelled: true };
        if (res.code !== 0) return { error: res.stderr };
        done += step.weight;
      }
      return {};
    } finally {
      cleanupTmp(pl);
    }
  }

  const promise = (async () => {
    let r = await runPlan(plan, 0, plan.kind === 'smart' ? 0.9 : 1);
    if (r.cancelled || cancelled) { safeUnlink(opts.output); return { ok: false, cancelled: true }; }
    if (r.error) {
      safeUnlink(opts.output);
      const detail = r.error.trim().split('\n').slice(-3).join('\n');
      return { ok: false, error: explainError(detail, opts.output), detail, args: plan.args };
    }

    // Début exact : la jonction doit se décoder sans aucune erreur. Sinon (GOP ouvert,
    // fréquent en HEVC), repli automatique et clairement signalé.
    let fallback = null;
    if (plan.kind === 'smart') {
      const ok = await verifyJunction(opts.output, plan.reencodedSeconds + 1.5);
      if (cancelled) { safeUnlink(opts.output); return { ok: false, cancelled: true }; }
      if (!ok) {
        safeUnlink(opts.output);
        fallback = plan.clipDuration <= 300 ? 'precise' : 'copy';
        plan = planExport({ ...opts, mode: fallback, snap: 'prev' });
        r = await runPlan(plan, 0.9, 0.1);
        if (r.cancelled || cancelled) { safeUnlink(opts.output); return { ok: false, cancelled: true }; }
        if (r.error) {
          safeUnlink(opts.output);
          const detail = r.error.trim().split('\n').slice(-3).join('\n');
          return { ok: false, error: explainError(detail, opts.output), detail, args: plan.args };
        }
      }
    }

    if (onProgress) onProgress({ ratio: 1, outTime: plan.clipDuration, speed });
    let size = null;
    try { size = fs.statSync(opts.output).size; } catch { /* ignore */ }
    let outInfo = null;
    try { outInfo = await probe(opts.output); } catch { /* ignore */ }
    // Contrôle final : la durée réelle du fichier doit correspondre au clip demandé.
    let warning = null;
    if (outInfo) {
      const diff = outInfo.duration - plan.clipDuration;
      if (Math.abs(diff) > Math.max(1, plan.clipDuration * 0.02)) {
        warning = `La durée du fichier exporté (${outInfo.duration.toFixed(2)} s) ne correspond pas `
          + `au clip demandé (${plan.clipDuration.toFixed(2)} s). Vérifiez le résultat.`;
      }
    }
    let notice = null;
    if (fallback === 'precise') {
      notice = 'Cette vidéo ne permet pas de raccorder proprement une partie réencodée et une partie copiée : '
        + 'le clip a été entièrement réencodé en très haute qualité pour commencer exactement à votre point.';
    } else if (fallback === 'copy') {
      notice = 'Cette vidéo ne permet pas de raccorder proprement une partie réencodée et une partie copiée : '
        + `le clip a été copié sans perte à partir de l'image clé ${plan.effectiveStart.toFixed(2)} s.`;
    }
    return {
      ok: true,
      warning,
      notice,
      fallback,
      args: fallback ? [...firstPlan.args, '#', 'repli', ...plan.args] : plan.args,
      kind: plan.kind,
      output: opts.output,
      size,
      elapsedMs: Date.now() - startedAt,
      effectiveStart: plan.effectiveStart,
      clipDuration: outInfo ? outInfo.duration : plan.clipDuration,
      reencode: plan.reencode,
      reencodedSeconds: plan.reencodedSeconds,
      encoderLabel: plan.encoderLabel,
      outInfo,
    };
  })();

  return {
    plan: firstPlan,
    promise,
    cancel() {
      cancelled = true;
      if (child && !child.killed) child.kill();
    },
  };
}

function explainError(detail, output) {
  const d = detail.toLowerCase();
  const ext = path.extname(output).slice(1).toUpperCase();
  if (d.includes('could not find tag for codec') || d.includes('not currently supported in container')
    || d.includes('codec not currently supported')) {
    return `Un des flux de cette vidéo n'est pas compatible avec le format ${ext}. Choisissez MKV, qui accepte presque tous les codecs.`;
  }
  if (d.includes('permission denied') || d.includes('access is denied')) {
    return "Accès refusé au dossier de destination. Choisissez un autre dossier.";
  }
  if (d.includes('no space left')) return "Espace disque insuffisant sur la destination.";
  return "FFmpeg n'a pas pu exporter ce passage.";
}

function safeUnlink(p) {
  try { fs.unlinkSync(p); } catch { /* ignore */ }
}

async function version() {
  const { ffmpeg } = resolveBinaries();
  try {
    const res = await run(ffmpeg, ['-hide_banner', '-version']);
    const m = res.stdout.match(/ffmpeg version (\S+)/);
    return m ? m[1] : null;
  } catch {
    return null;
  }
}

module.exports = { resolveBinaries, probe, keyframesAround, buildExportArgs, planExport, decideSmart, exportClip, version, samePath };
