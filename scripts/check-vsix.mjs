import { readFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { resolve } from 'node:path';

const file = resolve(process.argv[2] ?? 'diff-boss.vsix');
const failures = [];
const fail = (m) => failures.push(m);

function readZip(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 65535); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('not a zip file (no end-of-central-directory record)');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const entries = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error('corrupt central directory');
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    entries.set(name, { method, csize, local });
    p += 46 + nameLen + extraLen + commentLen;
  }
  const read = (name) => {
    const e = entries.get(name);
    const lp = e.local;
    const start = lp + 30 + buf.readUInt16LE(lp + 26) + buf.readUInt16LE(lp + 28);
    const data = buf.subarray(start, start + e.csize);
    if (e.method === 0) return data;
    if (e.method === 8) return inflateRawSync(data);
    throw new Error(`unsupported compression method ${e.method} for ${name}`);
  };
  return { names: [...entries.keys()], read };
}

let zip;
try {
  zip = readZip(readFileSync(file));
} catch (e) {
  console.error(`check-vsix: cannot read ${file}: ${e.message}`);
  process.exit(1);
}

const names = new Set(zip.names);
const required = [
  'extension/package.json',
  'extension/dist/extension.js',
  'extension/dist/webview/index.html',
];
for (const r of required) if (!names.has(r)) fail(`missing ${r}`);
if (!zip.names.some((n) => /^extension\/dist\/webview\/assets\/[^/]+\.js$/.test(n))) {
  fail('missing extension/dist/webview/assets/*.js');
}

for (const dir of ['src/', 'test/', 'docs/', 'webview/', 'node_modules/', '.claude/']) {
  const hit = zip.names.find((n) => n.startsWith(`extension/${dir}`));
  if (hit) fail(`forbidden path included: ${hit}`);
}

if (names.has('extension/package.json')) {
  try {
    const pkg = JSON.parse(zip.read('extension/package.json').toString('utf8'));
    const events = pkg.activationEvents ?? [];
    for (const ev of ['onUri']) {
      if (!events.includes(ev)) fail(`package.json activationEvents lacks ${ev}`);
    }
  } catch (e) {
    fail(`cannot read package.json from the vsix: ${e.message}`);
  }
}

if (failures.length) {
  console.error(`check-vsix: ${file} failed:`);
  for (const f of failures) console.error(`  - ${f}`);
  process.exit(1);
}
console.log(`check-vsix: ${file} ok (${zip.names.length} files)`);
