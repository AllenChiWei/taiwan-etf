// Exercise the real sortTable() from the page against a minimal DOM stand-in.
// No jsdom available, so we build just enough of the API the function touches.
const fs = require('fs');
// usage: node test_sort.js [path/to/taiwan_etf_list.html]
const src = fs.readFileSync(process.argv[2] || 'taiwan_etf_list.html', 'utf8');
const fn = src.match(/function sortTable\(th\) \{[\s\S]*?\n\}/)[0];

// ---- tiny DOM ----
class Cls {
  constructor() { this.s = new Set(); }
  add(...v) { v.forEach(x => this.s.add(x)); }
  remove(...v) { v.forEach(x => this.s.delete(x)); }
  contains(v) { return this.s.has(v); }
}
// A real element's .dataset is a DOMStringMap: every value is coerced to a string
// on assignment, and deleting a key works. Emulate that or the test lies.
const domStringMap = () => new Proxy({}, {
  set(t, k, v) { t[k] = String(v); return true; },
  get(t, k) { return t[k]; },
  deleteProperty(t, k) { delete t[k]; return true; },
});
class El {
  constructor(tag) { this.tagName = tag; this.dataset = domStringMap(); this.classList = new Cls();
                     this.attrs = {}; this.children = []; }
  setAttribute(k, v) { this.attrs[k] = v; }
  removeAttribute(k) { delete this.attrs[k]; }
  closest() { return null; }
  querySelectorAll() { return []; }
  appendChild(c) { this.children.push(c); return c; }
}
class Row extends El {
  constructor(code, vals) { super('tr'); this.code = code;
    this.cells = [{ textContent: code }, {}, {}, {}].concat(vals.map(v => ({ textContent: v }))); }
}
class Frag { constructor() { this.kids = []; } appendChild(c) { this.kids.push(c); return c; } }
global.document = { createDocumentFragment: () => new Frag() };

function makeTable(rowSpec) {
  const tbody = new El('tbody');
  tbody.rowsArr = rowSpec.map(([c, v]) => new Row(c, v));
  Object.defineProperty(tbody, 'rows', { get() { return this.rowsArr; } });
  tbody.appendChild = function (x) {
    if (x instanceof Frag) { this.rowsArr = x.kids; return x; }
    return x;
  };
  const table = new El('table');
  table.tBodies = [tbody];
  const ths = [4, 5, 6, 7].map(i => { const t = new El('th'); t.cellIndex = i;
                                      t.classList.add('sortable'); t.closest = () => table; return t; });
  table.querySelectorAll = () => ths;
  return { table, tbody, ths };
}

eval(fn);

// ---- fixture: col 4 = 殖利率, 5/6/7 = returns ----
const spec = [
  ['A', ['5.00', '10.00', 'N/A', '3.0']],
  ['B', ['N/A', '-2.00', '5.00', '1.0']],
  ['C', ['12.34', '1,200.50', '2.00', '-4.0']],
  ['D', ['3.00', 'N/A', '8.00', '2.0']],
  ['E', ['12.34', '0.00', '1.00', '0.0']],
];
const { table, tbody, ths } = makeTable(spec);
const order = () => tbody.rows.map(r => r.code).join('');
const val = i => tbody.rows.map(r => r.cells[i].textContent).join(',');

let pass = 0, fail = 0;
function check(label, got, want) {
  if (got === want) { pass++; console.log(`  ok   ${label}: ${got}`); }
  else { fail++; console.log(`  FAIL ${label}: got ${got}, want ${want}`); }
}

console.log('original:', order());
check('yield desc (N/A last, ties keep original order)', (sortTable(ths[0]), order()), 'CEADB');
// asc: D(3.00) A(5.00) then C,E tie at 12.34 -> original order keeps C first, N/A last
check('yield asc  (N/A still last, ties stable)',        (sortTable(ths[0]), order()), 'DACEB');
check('third click restores original',                   (sortTable(ths[0]), order()), 'ABCDE');
check('comma parsed as thousands (1,200.50 tops)',       (sortTable(ths[1]), order()), 'CAEBD');
check('desc leaves aria/class set', ths[1].attrs['aria-sort'] + '/' + ths[1].classList.contains('sorted-desc'), 'descending/true');
sortTable(ths[2]);
check('switching column resets to desc',                 order(), 'DBCEA');
check('previous column indicator cleared',               String(ths[1].classList.contains('sorted-desc')), 'false');
check('negative values sort correctly (近1年 desc)',      (sortTable(ths[3]), val(7)), '3.0,2.0,1.0,0.0,-4.0');

console.log(`\n${fail ? 'FAILED' : 'all sort tests passed'}  (${pass} passed, ${fail} failed)`);
process.exit(fail ? 1 : 0);
