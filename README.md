# Człowiek vs model decyzyjny — Phaser + Ollama

Dwie gry: **Connect Four** (`/`) i **Arena shooter 1v1** (`/arena/`).
Model ustawiasz w pliku `.env` (domyślnie `VITE_NIMBLE_MODEL=tev1:4b`).

## Arena (`/arena/`)
WASD — ruch, mysz — celowanie, LPM — strzał, Spacja — dash, R — restart. Pierwszy do 5 fragów.
Model co chwilę wybiera taktykę bota (`choice`: atak, flanka L/P, odwrót, osłona, apteczka, power-up)
i poziom agresji (`score`: tempo i celność ognia, dystans). Silnik wykonuje taktykę płynnie w każdej
klatce (ruch, omijanie przeszkód, celowanie z wyprzedzeniem, uniki), więc wolniejszy model nie zatrzymuje gry —
bot po prostu rzadziej zmienia plan. `VITE_FAST=1` pomija pytanie o agresję (krótsze zapytanie).

---

## Connect Four (`/`)

Gra w „Czwórki” dla dwóch graczy: Ty (żółte, X) kontra lokalny model decyzyjny
**nimble** (czerwone, O), wywoływany przez Ollama z endpointu `/v1/systemone`
(modele decyzyjne w stylu Jev, Ollama 0.35+).

## Uruchomienie

```bash
ollama -v               # wymagane 0.35+ (starsze dają błąd 412)
ollama pull tev1:4b     # 4.5 GB — domyślny model (szybszy od nimble)
ollama serve            # jeśli Ollama nie działa już w tle
npm install
npm run dev             # http://localhost:5173
```

Inny model (np. mniejszy): `VITE_NIMBLE_MODEL=tev1 npm run dev`
Inny host Ollama: `OLLAMA_HOST=http://192.168.1.10:11434 npm run dev`

## Jak to działa

W każdej turze gra wysyła do `/v1/systemone` stan planszy jako tekst i trzy pytania:

| pytanie  | typ      | do czego służy                                 |
|----------|----------|------------------------------------------------|
| `move`   | `choice` | wybór kolumny (tylko legalne kolumny w criteria) |
| `threat` | `noul`   | czy X grozi wygraną w następnym ruchu          |
| `eval`   | `score`  | kto wygrywa (pasek oceny w panelu)             |

Prawdopodobieństwa dla każdej kolumny są rysowane jako słupki nad planszą.
Jeśli Ollama/model nie odpowiada, AI przechodzi na prosty fallback (wygraj › zablokuj › środek),
a status w lewym górnym rogu to pokazuje.

Pliki: `src/rules.js` (logika), `src/nimble.js` (klient Ollama), `src/main.js` (scena Phaser).
Testy logiki: `npm test`.
# test-jev-game
# test-jev-game
