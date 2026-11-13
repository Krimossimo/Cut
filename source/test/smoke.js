const { _electron } = require('playwright');
const path = require('path'); const fs = require('fs'); const os = require('os');
(async () => {
  const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'cutud-'));
  const args = ['--no-sandbox', '/root/cut/app'];
  if (process.argv[2]) args.push(process.argv[2]);
  const app = await _electron.launch({ executablePath: '/root/el-linux/electron', args,
    env: { ...process.env, CUT_USER_DATA: ud, CUT_FFMPEG_DIR: '/root/dl/fflinux/bin' } });
  const win = await app.firstWindow();
  const logs = [];
  win.on('console', m => logs.push(m.type() + ': ' + m.text()));
  win.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  await win.setViewportSize({ width: 1280, height: 860 }).catch(()=>{});
  await win.waitForTimeout(2500);
  await win.screenshot({ path: '/tmp/shot1.png' });
  console.log(logs.join('\n'));
  await app.close();
})().catch(e => { console.error(e); process.exit(1); });
