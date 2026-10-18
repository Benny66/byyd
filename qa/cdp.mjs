// Minimal CDP client for headless Chrome (Node 22 global WebSocket)
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';

export async function launch({ port = 9333, profile } = {}) {
  const userDataDir = profile || fs.mkdtempSync(`${os.tmpdir()}/qa-chrome-`);
  const proc = spawn(CHROME, [
    '--headless=new',
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${userDataDir}`,
    '--no-first-run',
    '--no-default-browser-check',
    '--no-sandbox',
    '--disable-gpu',
    '--hide-scrollbars',
    '--autoplay-policy=no-user-gesture-required',
    '--window-size=1920,1080',
    '--allow-file-access-from-files',
    'about:blank',
  ], { stdio: ['ignore', 'pipe', 'pipe'] });
  proc.stderr.on('data', () => {});
  proc.stdout.on('data', () => {});
  // wait for devtools endpoint
  let target = null;
  for (let i = 0; i < 100; i++) {
    try {
      const r = await fetch(`http://127.0.0.1:${port}/json/list`);
      const list = await r.json();
      const page = list.find(t => t.type === 'page');
      if (page && page.webSocketDebuggerUrl) { target = page; break; }
    } catch (e) { /* not up yet */ }
    await sleep(120);
  }
  if (!target) { proc.kill('SIGKILL'); throw new Error('devtools endpoint not ready'); }
  const client = new CDP(target.webSocketDebuggerUrl);
  await client.open();
  return { proc, client, port };
}

export function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

export class CDP {
  constructor(url) {
    this.url = url;
    this.id = 0;
    this.pending = new Map();
    this.listeners = [];
  }
  open() {
    return new Promise((resolve, reject) => {
      this.ws = new WebSocket(this.url);
      this.ws.onopen = () => resolve();
      this.ws.onerror = (e) => reject(new Error('ws error ' + (e.message || '')));
      this.ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data);
        if (msg.id && this.pending.has(msg.id)) {
          const { resolve: res, reject: rej } = this.pending.get(msg.id);
          this.pending.delete(msg.id);
          if (msg.error) rej(new Error(JSON.stringify(msg.error))); else res(msg.result);
        } else {
          this.listeners.forEach(fn => fn(msg));
        }
      };
    });
  }
  send(method, params = {}, sessionId) {
    const id = ++this.id;
    const payload = { id, method, params };
    if (sessionId) payload.sessionId = sessionId;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.ws.send(JSON.stringify(payload));
      setTimeout(() => {
        if (this.pending.has(id)) { this.pending.delete(id); reject(new Error('timeout ' + method)); }
      }, 30000);
    });
  }
  on(fn) { this.listeners.push(fn); }
  close() { try { this.ws.close(); } catch (e) {} }
}

/** evaluate expression, return value; throw on exception */
export async function evalJs(c, expression, { awaitPromise = true } = {}) {
  const r = await c.send('Runtime.evaluate', {
    expression,
    returnByValue: true,
    awaitPromise,
    userGesture: true,
    allowUnsafeEvalBlockedByCSP: true,
  });
  if (r.exceptionDetails) {
    const d = r.exceptionDetails;
    throw new Error('page exception: ' + (d.exception?.description || d.text));
  }
  return r.result.value;
}

export async function clickId(c, id) {
  return evalJs(c, `(function(){var e=document.getElementById(${JSON.stringify(id)}); if(!e) return 'NO_EL'; e.click(); return 'ok';})()`);
}

export async function readState(c) {
  return evalJs(c, `(function(){
    var g=function(id){var e=document.getElementById(id);return e?e.textContent:null;};
    return {
      phase: document.getElementById('app').getAttribute('data-phase'),
      tag: g('phaseTag'),
      countdown: g('countdown'),
      totalLeft: g('totalLeft'),
      status: g('statusText'),
      action: g('actionName'),
      tips: g('tipsBody'),
      tipsLabelDisplay: document.getElementById('tipsLabel').style.display,
      breathe: g('breatheBody'),
      next: g('nextLine'),
      playLabel: g('btnPlayLabel'),
      sound: g('btnSoundLabel'),
      voice: g('btnVoiceLabel'),
      finishShown: document.getElementById('finish').className.indexOf('show') >= 0,
      beeps: window.__qa ? window.__qa.beeps : -1,
      speaks: window.__qa ? window.__qa.speaks : -1
    };
  })()`);
}

export async function screenshot(c, file, { width, height, mobile = false, dsf = 1, fullPage = false } = {}) {
  await c.send('Emulation.setDeviceMetricsOverride', {
    width, height, deviceScaleFactor: dsf, mobile,
    screenWidth: width, screenHeight: height,
  });
  await sleep(450);
  const r = await c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: fullPage, fromSurface: true });
  fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
  return file;
}

export function saveJson(file, obj) { fs.writeFileSync(file, JSON.stringify(obj, null, 2)); }
