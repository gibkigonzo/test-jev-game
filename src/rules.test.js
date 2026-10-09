import assert from 'node:assert';
import { createBoard, drop, findWin, winningColumns, fallbackMove, HUMAN, AI, legalColumns } from './rules.js';
let b = createBoard();
for (let c = 0; c < 3; c++) drop(b, c, HUMAN);
assert.deepStrictEqual(winningColumns(b, HUMAN), [3]);
assert.strictEqual(fallbackMove(b), 3, 'AI powinno zablokować');
drop(b, 3, HUMAN); assert.ok(findWin(b, HUMAN));
b = createBoard(); for (let i = 0; i < 6; i++) drop(b, 0, i % 2 ? AI : HUMAN);
assert.ok(!legalColumns(b).includes(0));
b = createBoard(); [[0],[1,0],[2,0,0],[3,0,0,0]].forEach((col, c) => { col.forEach(() => drop(b, c, HUMAN)); });
// przekątna: (5,0),(4,1),(3,2),(2,3) wymaga krążków AI poniżej
b = createBoard(); drop(b,0,AI); drop(b,1,HUMAN); drop(b,1,AI); drop(b,2,HUMAN); drop(b,2,HUMAN); drop(b,2,AI);
drop(b,3,HUMAN); drop(b,3,HUMAN); drop(b,3,HUMAN); drop(b,3,AI); assert.ok(findWin(b, AI), 'przekątna');
console.log('rules OK');
