const { _electron } = require('playwright'); const fs=require('fs'), os=require('os'), path=require('path');
(async () => {
  for (const f of ['prores.mov','ac3.mkv']) {
    const ud = fs.mkdtempSync(path.join(os.tmpdir(), 'cutud-'));
    const app = await _electron.launch({ executablePath: '/root/el-linux/electron', args: ['--no-sandbox', '/root/cut/app', '/root/work/media/'+f], env: { ...process.env, CUT_USER_DATA: ud, CUT_FFMPEG_DIR: '/root/dl/fflinux/bin' } });
    const win = await app.firstWindow();
    await win.waitForSelector('#editor:not([hidden])'); await win.waitForTimeout(1500);
    await win.screenshot({ path: `/tmp/u_${f}.png` });
    await win.fill('#inStart', '2'); await win.press('#inStart', 'Enter');
    await win.fill('#inEnd', '6'); await win.press('#inEnd', 'Enter');
    await win.waitForTimeout(500);
    await app.evaluate(({dialog}) => { dialog.showOpenDialog = async () => ({canceled:false, filePaths:['/tmp']}); });
    await win.click('#btnChangeDir'); await win.waitForTimeout(300);
    await win.click('#btnExport');
    await win.waitForSelector('#exportStatus.done, #exportStatus.error', {timeout: 20000});
    console.log(f, await win.innerText('#statusTitle'), '|', await win.innerText('#statusDetail'), '|', await win.innerText('#stageBanner').catch(()=>''));
    await app.close();
  }
})();
