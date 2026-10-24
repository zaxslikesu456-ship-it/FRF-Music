// A rough structural check for Swift files when no Swift compiler is available
// (for example on Windows): balanced braces, parentheses and brackets, ignoring
// strings and comments. It cannot find type errors; the GitHub iOS build does that.
const fs = require('fs');
const file = process.argv[2];
if (!file) {
  console.error('usage: node scripts/check-swift-syntax.cjs <file.swift>');
  process.exit(2);
}
const src = fs.readFileSync(file, 'utf8');
const counts = { '{': 0, '(': 0, '[': 0 };
const pairs = { '}': '{', ')': '(', ']': '[' };
const stack = [];
let line = 1;
let problem = '';
for (let i = 0; i < src.length && !problem; i++) {
  const c = src[i];
  const n = src[i + 1];
  if (c === '\n') line++;
  if (c === '/' && n === '/') { while (i < src.length && src[i] !== '\n') i++; line++; continue; }
  if (c === '/' && n === '*') {
    i += 2;
    while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) { if (src[i] === '\n') line++; i++; }
    i++;
    continue;
  }
  if (c === '"') {
    i++;
    while (i < src.length && src[i] !== '"') { if (src[i] === '\\') i++; if (src[i] === '\n') line++; i++; }
    continue;
  }
  if (counts[c] !== undefined) { counts[c]++; stack.push({ c, line }); }
  else if (pairs[c]) {
    const top = stack.pop();
    if (!top || top.c !== pairs[c]) problem = `unexpected '${c}' at line ${line}`;
    else counts[top.c]--;
  }
}
if (!problem && stack.length) problem = `unclosed '${stack[stack.length - 1].c}' opened at line ${stack[stack.length - 1].line}`;
if (problem) { console.error('NOT BALANCED: ' + problem); process.exit(1); }
console.log(`${file}: braces, parentheses and brackets are balanced`);
