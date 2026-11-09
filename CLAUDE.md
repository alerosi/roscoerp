# RoscoERP: guida per Claude

Webapp (porting di `Reference/RoscoERP.xlsm`, Excel + macro VBA) per un negozio al dettaglio di
**ceramica artistica**. Utenti: poche persone del negozio (gli operatori sono solo nel file dei dati,
`settings.operatori`: non scriverne i nomi nel codice o nella documentazione). UI,
documentazione e messaggi sono **in italiano**. Il repository è privato su GitHub.
Leggere anche `README.md` (uso) e `docs/ANALISI_MACRO.md` (bachi delle macro originali).

## Avvio e test

```bash
node server.js      # http://localhost:8787 (PORT=9000 per cambiare porta)
npm test            # node --test tests/logic.test.mjs (8 test, devono restare verdi)
```

I test leggono il database reale `data/roscoerp.json` (confronto con i valori dell'Excel sul periodo
1/1/2026 - 6/11/2026): senza quel file, o se vi si aggiungono vendite o spese datate in quel periodo,
il test del Conto Economico non torna. Se il file non è nel repository, chiederlo all'utente.

Serve solo Node >= 16. **Nessuna dipendenza npm, nessun build**: frontend in ES modules puri.
Chart.js 4.4.7 è incluso in `public/vendor/`. Python (openpyxl) serve solo per
`tools/import_xlsm.py`, che rigenera il database dall'Excel.

## Architettura

- `server.js`: server HTTP senza dipendenze. Serve `public/` e l'API:
  `GET/PUT /api/config` (percorso DB, mode load|create|copy), `GET/PUT /api/db`,
  `GET /api/backups`, `POST /api/restore`. Scrittura atomica (tmp + rename), copia `.prev.json`,
  backup giornaliero per 90 giorni in `backup_<nome>/` accanto al DB. Concorrenza ottimistica:
  `meta.revision` / `meta.baseRevision`, risposta 409 se non coincidono (salvo `?force`).
  Il percorso del DB sta in `config.json` (ignorato da git); default `data/roscoerp.json`.
- `public/js/store.js`: classe `Store`. Tre modalità: `server` (normale), `fs` (File System Access
  API, per hosting statico in Chrome/Edge **solo su computer**, vedi `isMobile()`; con `readOnly`,
  impostazione per browser in localStorage, il PC legge il file e non lo scrive mai: `commit()` annulla
  la modifica ricaricando il file, `refreshIfChanged()` rilegge quando la pagina torna visibile), `local` (IndexedDB,
  telefoni e altri browser: "Apri file" / "Salva file" nella barra, `localInfo.unsaved` dice se ci sono
  modifiche non ancora salvate su file; "Salva file" usa il menu Condividi sul telefono). L'`index.html`
  della radice serve solo a GitHub Pages (rimanda a `public/`); `tools/prepara_github.ps1` crea
  `pubblica_github/` senza dati da caricare dal sito. Salvataggio con debounce 300 ms
  (`commit()`), al caricamento, quando la pagina va in background, e con beacon alla chiusura
  solo se il payload è < 60 KB.
- `public/js/logic.js`: **tutto il dominio** (porting delle macro VBA): carico, vendita, incasso,
  spese, cancellazioni, tipologie, periodo, Conto Economico (`contoEconomico`, equivalente di
  `aggiorna`), statistiche, `analisiNegozio`, `verificaIntegrita`. Nessun accesso al DOM.
  La scheda Statistiche usa solo `statisticheNegozio` (un passaggio sulle vendite: periodo, confronto,
  filtro tipologie) e `statisticheMagazzino`; `statisticheTipologie`, `serieTemporali`, `andamento*` e
  `analisiNegozio` restano per i test e per confronto. I filtri della scheda stanno in localStorage
  (`roscoerp.statistiche`), non nel database.
- `public/js/forms.js`: le UserForm Excel (carica, seleziona, vendita, incasso, spesa) come modali.
- `public/js/ui.js`: modali, dialog, campi, `dataTable`. `util.js`: date, formati, `el()` DOM builder.
- `public/js/charts.js`: Chart.js, palette "maiolica" validata. `public/js/views/*.js`: le schede
  (pannello, magazzino, registri = vendite/movimenti/spese, statistiche, tasse, impostazioni).
- `public/js/app.js`: routing a schede via hash, operatore, stato di salvataggio, conflitti.
- `tests/logic.test.mjs`: test della logica con i globali del browser simulati.

## Modello dati (un solo file JSON)

```
{ schema, meta{revision,savedAt,nextId{a,m,v,s}},
  settings{numDigit,nomeNegozio,tipologie[{nome,prefisso}],fornitori[{nome,default,debito,dataDebito}],
           zone,pagamenti,clienti,tipologieSpese[{nome,diretta}],operatori,flags{...},ivaDefault,
           tasse{...},statistiche{...},periodo{...}},
  magazzino[], movimenti[], vendite[], spese[] }
```

- Id con prefisso: `a` articoli, `m` movimenti, `v` vendite, `s` spese (contatori in `meta.nextId`).
- Date come stringa ISO **locale** `YYYY-MM-DDTHH:MM:SS`, senza fuso (mai `toISOString()`).
- Colonne calcolate (consumo, valore, prezzo totale, costo totale, MU) **non salvate**: si ricalcolano.
- Codice articolo = prefisso della tipologia + numero con `numDigit` cifre. Codici speciali
  `INCASSO` e `SPEDIZIONE` nelle vendite.

## Regole da rispettare

1. **Il codice articolo è unico.** Era la causa della merce "sparita" in Excel (PIA00041 duplicato).
   `cambiaCodice` e la rinomina dei prefissi rifiutano le collisioni.
2. **Ogni variazione di giacenza crea un movimento** (Carico, Vendita, Correzione). Nessuna modifica
   diretta della giacenza; `verificaIntegrita` confronta giacenze e movimenti.
3. **Il Conto Economico deve restare fedele alla macro `aggiorna`**: il test confronta i valori con
   quelli dell'Excel al centesimo (periodo 1/1/2026 - 6/11/2026). Le correzioni di giacenza entrano
   nel debito fornitori come in Excel (impostazione `tasse.correzioniNelDebito`, default true).
4. **Non aggiungere `keepalive: true` al fetch di salvataggio**: il DB pesa ~3 MB e il limite è 64 KB.
5. Chi scrive stili inline con variabili CSS usa `el()`, che gestisce `--custom` con `setProperty`.
6. Il file `data/roscoerp.json` contiene dati reali del negozio e viene riscritto a ogni modifica:
   non committarlo (è in `.gitignore`, il repository è pubblico), non modificarlo a mano
   mentre il server gira, e per i test usare una **copia** (impostare il percorso in Impostazioni).
7. Niente dipendenze o strumenti di build nuovi senza una buona ragione: la semplicità è voluta.

## Bachi delle macro originali (già risolti nella webapp)

Duplicati di codice non impediti; IVA scorporata due volte in `modifica_mag`; Annulla nel carico
che annulla tutto senza avviso; giacenza modificabile a mano; `canc_code`/`canc_tipo` che cancellano
lo storico; filtro automatico fermo a 893 righe; debiti fornitori dipendenti dall'ordine delle righe;
`check_mov` che riscrive i costi storici; doppio inserimento da doppio clic. Dettagli e rimedi in
`docs/ANALISI_MACRO.md`.

## Mappa Excel -> webapp

La tabella completa (pulsanti e macro -> schede e funzioni) è nel `README.md`, sezione
"Corrispondenza con il file Excel". Nome macro VBA -> funzione in `logic.js` (es. `carica_mag` ->
`eseguiCarico`, `carica_vend` -> `eseguiVendita`, `canc_vend` -> `cancellaVendita`, `aggiorna` ->
`contoEconomico`, `check_mov` -> `checkMovimenti`).

## Stato del progetto

Funzionalmente completo (novembre 2026): importati 1.136 articoli, 7.201 movimenti, 5.243 vendite,
410 spese. Il repository GitHub è **pubblico** (GitHub Pages): commit e
pubblicazione li fa l'utente con `tools/pubblica_github.ps1`, che rifiuta di pubblicare dati, nomi
degli operatori ed email. `data/`, `Reference/` e `docs/GUIDA_GITHUB.pdf` (vecchia guida, contiene
un'email personale) sono esclusi da git e non vanno mai pubblicati. Idee non fatte: autenticazione utenti (oggi l'operatore si sceglie dal menu),
esportazione PDF dei report, modifica massiva dei prezzi.
