const fs = require('fs');
const path = process.argv[2];
if (!path) { console.error('Usage: node check_balance.js <file>'); process.exit(2); }
const s = fs.readFileSync(path,'utf8');
console.log('chars', s.length, 'lines', s.split(/\n/).length);
let brace=0, paren=0, angle=0;
const stack = [];
for (let i=0;i<s.length;i++){
  const c = s[i];
  if (c==='{') { brace++; stack.push(i); }
  if (c==='}') { brace--; stack.pop(); }
  if (c==='(') paren++; if (c===')') paren--;
  if (c==='<') angle++; if (c==='>') angle--;
}
console.log('braceBalance', brace);
console.log('parenBalance', paren);
console.log('angleBalance', angle);
// print last 200 chars to help locate
console.log('tail:', s.slice(-200));
if (stack.length>0) {
  for (const idx of stack) {
    const lineNumber = s.slice(0, idx).split(/\n/).length;
    const before = s.slice(Math.max(0, idx-120), idx+120);
    console.log('unclosed "{" at index', idx, 'line', lineNumber, '\n', before);
  }
}
