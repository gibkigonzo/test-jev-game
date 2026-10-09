// Czysta logika Connect Four (bez Phasera) — łatwa do testowania.
export const ROWS = 6;
export const COLS = 7;
export const EMPTY = 0, HUMAN = 1, AI = 2;

export const createBoard = () => Array.from({ length: ROWS }, () => Array(COLS).fill(EMPTY));
export const cloneBoard = (b) => b.map((r) => [...r]);

export const legalColumns = (b) => [...Array(COLS).keys()].filter((c) => b[0][c] === EMPTY);

// Zwraca wiersz, w którym wylądował krążek, albo -1.
export function drop(b, col, player) {
  for (let r = ROWS - 1; r >= 0; r--) {
    if (b[r][col] === EMPTY) { b[r][col] = player; return r; }
  }
  return -1;
}

// Zwraca listę 4 pól [r,c] tworzących wygraną linię albo null.
export function findWin(b, player) {
  const dirs = [[0, 1], [1, 0], [1, 1], [1, -1]];
  for (let r = 0; r < ROWS; r++)
    for (let c = 0; c < COLS; c++)
      for (const [dr, dc] of dirs) {
        const cells = [];
        for (let k = 0; k < 4; k++) {
          const rr = r + dr * k, cc = c + dc * k;
          if (rr < 0 || rr >= ROWS || cc < 0 || cc >= COLS || b[rr][cc] !== player) break;
          cells.push([rr, cc]);
        }
        if (cells.length === 4) return cells;
      }
  return null;
}

export const isFull = (b) => legalColumns(b).length === 0;

// Kolumny, w których `player` wygrywa jednym ruchem.
export function winningColumns(b, player) {
  return legalColumns(b).filter((c) => {
    const t = cloneBoard(b); drop(t, c, player); return !!findWin(t, player);
  });
}

// Tekstowy opis stanu dla modelu decyzyjnego.
export function boardToText(b) {
  const sym = ['.', 'X', 'O'];
  const lines = b.map((row, i) => `Row ${ROWS - i}: ${row.map((v) => sym[v]).join(' ')}`);
  lines.push('       ' + [...Array(COLS).keys()].map((c) => c + 1).join(' '));
  return lines.join('\n');
}

// Prosty fallback, gdy Ollama nie odpowiada: wygraj > zablokuj > środek > losowo.
export function fallbackMove(b) {
  const win = winningColumns(b, AI); if (win.length) return win[0];
  const block = winningColumns(b, HUMAN); if (block.length) return block[0];
  const legal = legalColumns(b);
  const order = [3, 2, 4, 1, 5, 0, 6].filter((c) => legal.includes(c));
  return Math.random() < 0.6 ? order[0] : legal[Math.floor(Math.random() * legal.length)];
}
