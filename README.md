# 730 Scan

App installabile (PWA) per raccogliere e classificare le spese detraibili del 730. Tutto resta sul dispositivo: lettura OCR locale (PaddleOCR ONNX), archivio IndexedDB, nessun server.

## Pubblicare su GitHub Pages
1. Crea un repository (es. `730scan`) e carica **tutto il contenuto di questa cartella** nella radice (esclusi `node_modules`, `package*.json`, `icons-proposals`, `ptest.html`).
2. Repository → Settings → Pages → Source: *Deploy from a branch* → `main` / `(root)`.
3. Apri `https://<utente>.github.io/730scan/` dal telefono e scegli *Aggiungi a schermata Home* (iPhone: Condividi → Aggiungi a Home; Android: menu → Installa app).
4. Alla prima apertura (con connessione) scarica i modelli OCR (~13 MB) e poi funziona offline.

## Aggiornare
Sostituisci i file, aumenta `VERSION` in `sw.js` e fai commit: l'app si aggiorna alla prima apertura con connessione.
