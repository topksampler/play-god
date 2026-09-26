// Headless Chrome smoke test over the DevTools protocol (no extra dependencies).
// Usage: node scripts/browser-smoke.mjs <steps.json>
// steps: [{ "wait": ms } | { "eval": "js expression", "label": "name" } | { "shot": "file.png" }]
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const chrome = process.env.CHROME ?? 'C:/Program Files/Google/Chrome/Application/chrome.exe';
const url = process.env.URL ?? 'http://localhost:5173/';
const steps = JSON.parse(readFileSync(process.argv[2], 'utf8'));
const port = 9300 + Math.floor(Math.random() * 500);
const profile = mkdtempSync(join(tmpdir(), 'pgchrome-'));
const proc = spawn(chrome, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--window-size=1600,1000', ...(process.env.CHROME_FLAGS ?? '--enable-unsafe-swiftshader').split(' ').filter(Boolean), 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let target;
for (let i = 0; i < 100 && !target; i++) {
  await sleep(200);
  try { target = (await (await fetch(`http://localhost:${port}/json`)).json()).find((t) => t.type === 'page'); } catch {}
}
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((r) => (ws.onopen = r));
let id = 0;
const pending = new Map();
const logs = [];
ws.onmessage = (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) { pending.get(msg.id)(msg); pending.delete(msg.id); }
  if (msg.method === 'Runtime.consoleAPICalled' && ['error', 'warning'].includes(msg.params.type))
    logs.push(`console.${msg.params.type}: ${msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 400)}`);
  if (msg.method === 'Runtime.exceptionThrown') logs.push(`EXCEPTION: ${(msg.params.exceptionDetails.exception?.description ?? msg.params.exceptionDetails.text).slice(0, 600)}`);
  if (msg.method === 'Log.entryAdded' && msg.params.entry.level === 'error') logs.push(`log.error: ${msg.params.entry.text} ${msg.params.entry.url ?? ''}`);
};
const send = (method, params = {}) => new Promise((r) => { const i = ++id; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });
const evaluate = async (expr) => {
  const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
  return r.result?.exceptionDetails ? `EVAL ERROR: ${r.result.exceptionDetails.exception?.description}` : r.result?.result?.value;
};

await send('Runtime.enable');
await send('Log.enable');
await send('Page.enable');
await send('Page.navigate', { url });
await sleep(1500);
for (const step of steps) {
  if (step.wait) await sleep(step.wait);
  if (step.eval) {
    const v = await evaluate(step.eval);
    console.log(`[${step.label ?? 'eval'}]`, typeof v === 'string' ? v : JSON.stringify(v));
  }
  if (step.shot) {
    const shot = await send('Page.captureScreenshot', { format: 'png' });
    writeFileSync(step.shot, Buffer.from(shot.result.data, 'base64'));
    console.log('[shot]', step.shot);
  }
}
console.log('--- browser errors/warnings ---\n' + (logs.join('\n') || '(none)'));
ws.close();
proc.kill();
process.exit(0);
