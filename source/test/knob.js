const { _electron } = require('playwright'); const fs=require('fs'), os=require('os'), path=require('path');
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'cutud-'));
  const app = await _electron.launch({ executablePath: '/root/el-linux/electron', args: ['--no-sandbox', '/root/cut/app', '/root/work/media/twitch.mp4'], env: { ...process.env, CUT_USER_DATA: ud, CUT_FFMPEG_DIR: '/root/dl/fflinux/bin' } });
  const win = await app.firstWindow();
  win.on('console', m => console.log('console:', m.text()));
  await win.waitForFunction(() => document.getElementById('video').readyState >= 2);
  await win.evaluate(() => { document.getElementById('video').currentTime = 20; }); await win.waitForTimeout(400);
  const k = await win.locator('.ph-knob.top').boundingBox();
  console.log('knob', k);
  console.log('at point:', await win.evaluate(([x,y]) => { const e = document.elementFromPoint(x,y); return e && (e.className || e.id || e.tagName); }, [k.x+k.width/2, k.y+k.height/2]));
  await win.mouse.move(k.x+k.width/2, k.y+k.height/2); await win.mouse.down();
  await win.mouse.move(k.x+200, k.y+5, {steps: 5}); await win.mouse.up(); await win.waitForTimeout(300);
  console.log('t after', await win.evaluate(() => document.getElementById('video').currentTime));
  await app.close();
})();
