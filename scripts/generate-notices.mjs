// Builds public/THIRD_PARTY_NOTICES.txt: the copyright notices and license
// texts of the code and libraries shipped inside the FRF Music apps. The file
// is bundled into the Android and Windows apps (Settings > App info) and
// attached to releases.
//
//   node scripts/generate-notices.mjs
//
// Rerun it after adding or updating libraries. It reads node_modules, the Rust
// crates (cargo metadata) and third_party/android-dependencies.txt, which comes
// from: gradlew app:dependencies --configuration releaseRuntimeClasspath
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const read = p => fs.readFileSync(path.join(ROOT, p), 'utf8');
const LICENSE_FILE = /^(licen[cs]e|copying|notice)([-._].*)?$/i;

// Groups packages that share the exact same license text, so long texts such
// as Apache-2.0 appear once.
class Section {
  constructor(title) {
    this.title = title;
    this.groups = new Map(); // normalized text -> { text, names: [] }
  }
  add(name, text) {
    const clean = (text || '').replace(/\r\n/g, '\n').trim();
    const key = clean.replace(/\s+/g, ' ');
    if (!this.groups.has(key)) this.groups.set(key, { text: clean, names: [] });
    const g = this.groups.get(key);
    if (!g.names.includes(name)) g.names.push(name);
  }
  render() {
    const out = [`${'='.repeat(78)}\n${this.title}\n${'='.repeat(78)}\n`];
    const groups = [...this.groups.values()].sort((a, b) => a.names[0].localeCompare(b.names[0]));
    for (const g of groups) {
      out.push(g.names.sort().join('\n'));
      out.push('-'.repeat(78));
      out.push(g.text || '(No license text was included with this package.)');
      out.push('');
    }
    return out.join('\n');
  }
}

// License texts fetched from a project's repository, for packages whose
// download does not include one (third_party/licenses/packages/<name>.txt).
function overrideText(name) {
  const file = path.join(ROOT, 'third_party', 'licenses', 'packages', name.replace(/^@/, '').split('/').join('-') + '.txt');
  return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
}

function licenseFilesIn(dir) {
  try {
    return fs.readdirSync(dir).filter(f => LICENSE_FILE.test(f) && fs.statSync(path.join(dir, f)).isFile());
  } catch {
    return [];
  }
}

// Dual-licensed packages ("MIT OR Apache-2.0") are used under MIT, so only the
// MIT text is reproduced when the package ships one.
function pickLicenseText(dir, spdx) {
  const files = licenseFilesIn(dir);
  const either = /\bOR\b|\//.test(spdx || '');
  if (either && /MIT/.test(spdx)) {
    const mit = files.find(f => /mit/i.test(f));
    if (mit) return fs.readFileSync(path.join(dir, mit), 'utf8');
  }
  if (files.length === 0) return '';
  return files
    .sort((a, b) => a.length - b.length)
    .map(f => (files.length > 1 ? `[${f}]\n` : '') + fs.readFileSync(path.join(dir, f), 'utf8').trim())
    .join('\n\n');
}

// ---------------------------------------------------------------- npm (all apps)
function npmSection() {
  const sec = new Section('Libraries in the app itself (Android and Windows)');
  const pkg = JSON.parse(read('package.json'));
  const seen = new Set();
  const visit = (name, fromDir) => {
    // Node's lookup: node_modules next to the requiring package, then upward.
    let dir = fromDir;
    let found = null;
    for (;;) {
      const cand = path.join(dir, 'node_modules', name);
      if (fs.existsSync(path.join(cand, 'package.json'))) { found = cand; break; }
      const up = path.dirname(dir);
      if (up === dir) break;
      dir = up;
    }
    if (!found || seen.has(found)) return;
    seen.add(found);
    const j = JSON.parse(fs.readFileSync(path.join(found, 'package.json'), 'utf8'));
    const spdx = typeof j.license === 'object' ? j.license.type : j.license || '';
    let text = pickLicenseText(found, spdx) || overrideText(j.name);
    if (!text) text = `License: ${spdx || 'unknown'}${j.author ? `\nAuthor: ${typeof j.author === 'string' ? j.author : j.author.name}` : ''}`;
    sec.add(`${j.name} ${j.version} (${spdx})`, text);
    for (const d of Object.keys(j.dependencies || {})) visit(d, found);
  };
  for (const d of Object.keys(pkg.dependencies || {})) visit(d, ROOT);
  return sec;
}

// ---------------------------------------------------------------- Android
function androidSection() {
  const sec = new Section('Libraries in the Android app');
  const apache = read('third_party/licenses/Apache-2.0.txt');
  const deps = read('third_party/android-dependencies.txt').split(/\r?\n/).filter(Boolean);
  for (const coord of deps) {
    const [group, artifact, version] = coord.split(':');
    const name = `${group}:${artifact} ${version}`;
    if (group === 'org.chromium.net') {
      sec.add(`${name} (BSD-3-Clause)`, read('third_party/cronet/chromium-LICENSE.txt'));
    } else if (group === 'com.google.protobuf') {
      sec.add(`${name} (BSD-3-Clause)`, read('third_party/licenses/protobuf-LICENSE.txt'));
    } else {
      // AndroidX, ExoPlayer, Guava, Kotlin, kotlinx, JetBrains annotations,
      // JSpecify, JSR-305 and Apache Cordova are all Apache-2.0.
      sec.add(`${name} (Apache-2.0)`, apache);
    }
  }
  // Capacitor's Android runtime is built from source in this project.
  const cap = path.join(ROOT, 'node_modules', '@capacitor', 'android');
  const capVer = JSON.parse(fs.readFileSync(path.join(cap, 'package.json'), 'utf8')).version;
  sec.add(`@capacitor/android ${capVer} (MIT)`, pickLicenseText(cap, 'MIT'));
  // Components compiled into Cronet's native library (libcronet).
  const parts = [
    ['BoringSSL (in Cronet)', 'boringssl'],
    ['zlib (in Cronet)', 'zlib'],
    ['Brotli (in Cronet)', 'brotli'],
    ['ICU (in Cronet)', 'icu'],
    ['Abseil (in Cronet)', 'abseil'],
    ['double-conversion (in Cronet)', 'double-conversion'],
  ];
  for (const [label, file] of parts) sec.add(label, read(`third_party/cronet/${file}-LICENSE.txt`));
  return sec;
}

// ---------------------------------------------------------------- Windows
function windowsSection() {
  const sec = new Section('Libraries in the Windows app');
  const meta = JSON.parse(
    execFileSync('cargo', ['metadata', '--format-version', '1', '--filter-platform', 'x86_64-pc-windows-msvc'], {
      cwd: path.join(ROOT, 'src-tauri'),
      maxBuffer: 256 * 1024 * 1024,
    }).toString()
  );
  const nodes = new Map(meta.resolve.nodes.map(n => [n.id, n]));
  const keep = new Set();
  const stack = [meta.resolve.root];
  while (stack.length) {
    const id = stack.pop();
    if (keep.has(id)) continue;
    keep.add(id);
    for (const d of nodes.get(id).deps) {
      // Only code that ends up in the program (not build scripts or tests).
      if (d.dep_kinds.some(k => k.kind === null)) stack.push(d.pkg);
    }
  }
  for (const p of meta.packages) {
    if (!keep.has(p.id) || p.id === meta.resolve.root) continue;
    const dir = path.dirname(p.manifest_path);
    let text = pickLicenseText(dir, p.license || '') || overrideText(p.name);
    if (!text) text = `License: ${p.license || 'unknown'}${p.authors?.length ? `\nAuthors: ${p.authors.join(', ')}` : ''}`;
    sec.add(`${p.name} ${p.version} (${p.license || 'unknown'})`, text);
  }
  return sec;
}

// ---------------------------------------------------------------- output
const header = `FRF Music
Copyright (C) 2026 zaxs

FRF Music is free software: you can redistribute it and/or modify it under the
terms of the GNU General Public License as published by the Free Software
Foundation, either version 3 of the License, or (at your option) any later
version. It is distributed in the hope that it will be useful, but WITHOUT ANY
WARRANTY. See the LICENSE file for details. Source code:
https://github.com/zaxslikesu456-ship-it/FRF-Music

FRF Music is not affiliated with YouTube or Google.

This file lists the third-party code included in FRF Music, with each
project's copyright notice and license. Libraries offered under a choice of
licenses (for example "MIT OR Apache-2.0") are used under the MIT license.
The source code of the MPL-2.0 libraries (cssparser, selectors, dtoa-short,
option-ext) is available unchanged from https://crates.io.
`;

const code = new Section('Code included in FRF Music');
code.add(
  'BgUtils (https://github.com/LuanRT/BgUtils): proof-of-origin token flow, used in src/utils/poToken.ts, the Android NativePoTokenMinter and the Windows po_token.rs (MIT)',
  read('third_party/BgUtils-LICENSE.txt')
);

const sections = [code, npmSection(), androidSection()];
try {
  sections.push(windowsSection());
} catch (e) {
  console.error('Windows section skipped (cargo not available?):', e.message);
  process.exitCode = 1;
}

const text = header + '\n' + sections.map(s => s.render()).join('\n');
fs.writeFileSync(path.join(ROOT, 'public', 'THIRD_PARTY_NOTICES.txt'), text);
const counts = sections.map(s => `${s.title}: ${[...s.groups.values()].reduce((n, g) => n + g.names.length, 0)}`);
console.log(`public/THIRD_PARTY_NOTICES.txt written (${Math.round(text.length / 1024)} KB)\n  ${counts.join('\n  ')}`);
