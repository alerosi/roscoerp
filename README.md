# RoscoERP

Gestionale semplificato per un negozio di vendita al dettaglio di ceramica artistica:
magazzino, carichi, vendite, incassi, spese, Conto Economico con stima delle imposte,
statistiche e grafici. È il porting in webapp del file `Reference/RoscoERP.xlsm`
(Excel + macro VBA), di cui replica tutti i comandi; i dati del file Excel sono già
importati in `data/roscoerp.json`.

## Avvio rapido

Serve solo [Node.js](https://nodejs.org) (versione 16 o successiva). Nessuna dipendenza da installare.

```bash
node server.js
```

Poi aprire il browser su <http://localhost:8787>. Con `npm start` si ottiene lo stesso risultato.
Per usare una porta diversa: `PORT=9000 node server.js` (su Windows PowerShell: `$env:PORT=9000; node server.js`).

Al primo avvio il server crea `config.json` accanto a sé con il percorso del database
(`data/roscoerp.json`). Il percorso si cambia da **Impostazioni → Database**: se il file indicato
esiste viene caricato, altrimenti si può crearlo vuoto (si riparte da zero) oppure copiarci il
database corrente. Il file può stare anche in una cartella condivisa in rete.

## Come sono salvati i dati

- Tutto il database è **un unico file JSON** (impostazioni, magazzino, movimenti, vendite, spese).
- Viene letto all'apertura della pagina e **riscritto ad ogni modifica** (dopo pochi decimi di
  secondo), quando la pagina passa in secondo piano e all'apertura.
- Prima di ogni scrittura il server salva la versione precedente in `backup_<nome>/` accanto al
  file (`<nome>.prev.json`) e conserva il primo salvataggio di ogni giornata per 90 giorni.
  I backup si ripristinano da **Impostazioni → Backup e integrità**.
- Se due finestre o due computer scrivono lo stesso file, la seconda scrittura viene bloccata e
  l'app chiede se ricaricare dal file o sovrascriverlo.
- Da Impostazioni si può scaricare una copia del database o importarne una.

### Senza server (GitHub Pages, anche da cellulare)

L'app funziona anche pubblicata come sito statico, ad esempio con GitHub Pages. Online c'è solo
il codice: i dati restano sui dispositivi di chi la usa e non passano da GitHub.

- **Computer con Chrome o Edge:** la prima volta si sceglie (o si crea) il file `roscoerp.json`,
  anche nella cartella OneDrive; il browser lo rilegge e lo riscrive da solo ad ogni modifica.
  Il file viene ricordato: alla riapertura il browser chiede di confermare l'accesso e, scegliendo
  **«Consenti a ogni visita»**, dalle volte successive i dati si rileggono senza fare nulla.
- **PC che deve solo consultare** (ad esempio con la cartella OneDrive condivisa dal PC del negozio):
  spuntare **«Questo PC è solo per consultare i dati»** nella schermata iniziale o in
  Impostazioni → Database. Quel PC legge il file all'apertura e ogni volta che si torna sulla
  pagina, ma **non lo scrive mai**: le modifiche fatte lì vengono annullate con un avviso. In OneDrive
  conviene impostare il file su «Mantieni sempre su questo dispositivo».
- **Telefono, tablet e altri browser:** i dati stanno nella memoria del browser. Nella barra in alto
  ci sono **Apri file** (carica `roscoerp.json`, ad esempio dall'app OneDrive) e **Salva file**
  (sul telefono apre il menu Condividi: si sceglie OneDrive e si sostituisce il file esistente;
  altrove scarica il file). La scritta accanto indica se ci sono modifiche **da salvare su file**.
  Aprendo un file, l'app avvisa se si perderebbero modifiche o se il file sembra più vecchio dei
  dati presenti (OneDrive non ancora sincronizzato).
- Non modificare i dati su due dispositivi nello stesso momento: vale l'ultimo file salvato.

La modalità con `server.js` resta quella consigliata per il negozio, perché fa i backup automatici
e blocca le scritture contemporanee.

#### Pubblicare su GitHub (consigliato: uno script fa tutto)

Il repository è **pubblico**: `data/`, `Reference/`, `config.json` e i backup sono esclusi da git
(`.gitignore`). Prima volta e ogni aggiornamento, dalla cartella del progetto:

```powershell
powershell -ExecutionPolicy Bypass -File tools\pubblica_github.ps1
```

Lo script fa accedere a GitHub dal browser (solo la prima volta), crea il commit con l'email anonima
di GitHub, **si blocca** se trova file di dati, nomi degli operatori o l'email di git nei file da
pubblicare, crea il repository `roscoerp` se manca, invia le modifiche e attiva GitHub Pages.
Con `-SoloControllo` mostra solo cosa verrebbe pubblicato, senza inviare nulla.

#### In alternativa, dal sito, senza git

1. `powershell -ExecutionPolicy Bypass -File tools\prepara_github.ps1` crea la cartella
   `pubblica_github` con i soli file da pubblicare (senza `data/`, `Reference/`, `config.json` e backup).
2. Su github.com: **New repository** (pubblico), poi **Add file → Upload files** e si trascina
   tutto il contenuto di `pubblica_github`; infine **Commit changes**.
3. **Settings → Pages**: *Source* "Deploy from a branch", branch `main`, cartella `/ (root)`.
   Dopo un minuto l'app è su `https://<utente>.github.io/<repository>/` (l'`index.html` della
   radice porta a `public/`).

Con un repository pubblico i test (`npm test`) non girano a chi scarica il codice, perché leggono
`data/roscoerp.json`, che non viene pubblicato.

## Struttura del progetto

```
server.js              server HTTP locale (senza dipendenze) + API del database
public/                webapp (HTML/CSS/JS, nessun build)
  js/logic.js          logica di dominio: porting delle macro VBA
  js/store.js          caricamento/salvataggio del JSON
  js/forms.js          finestre di carico, vendita, incasso, spesa (le UserForm)
  js/views/            le schede: pannello, magazzino, vendite, movimenti, spese, statistiche, tasse, impostazioni
  vendor/chart.umd.js  Chart.js 4 (grafici), incluso per funzionare offline
data/roscoerp.json     database con tutti i dati importati dall'Excel
tools/import_xlsm.py   script di importazione da RoscoERP.xlsm (richiede Python + openpyxl)
tests/logic.test.mjs   test della logica (node --test)
docs/ANALISI_MACRO.md  analisi delle macro e dei bachi trovati
Reference/             il file Excel originale
```

## Corrispondenza con il file Excel

| Foglio / macro Excel | Nella webapp |
|---|---|
| Pannello di controllo: Carico a Magazzino, Vendita Diretta, Incasso, Aggiungi Spesa | Scheda **Pannello di controllo**, riquadri in alto |
| Oggi / Sett. / Mese / Anno, ± giorno/settimana/mese/anno, CAL | Barra del periodo (le date sono modificabili direttamente) |
| Conto Economico, valore magazzino, debiti fornitori, % IVA, imponibile, credito IVA | Stesse voci, stesso calcolo (`aggiorna`) |
| Magazzino: Modifica, Mod. codice, Canc., Ordina su/giù | Scheda **Magazzino**: pulsanti, doppio clic per modificare, clic sulle intestazioni per ordinare |
| Movimenti: Check | Scheda **Movimenti → Check** e **Verifica coerenza** |
| Vendite: Canc. | Scheda **Vendite** (più la modifica dei campi che non toccano il magazzino) |
| Spese: Canc. | Scheda **Spese** (più la modifica) |
| Statistiche: tabella per tipologia, Plot, G/S/M, Media, Quantità/Valore/Incassi totali, Andam. Sett./Giorn./Ann., Tutte le vendite, Canc., PDF | Scheda **Statistiche**, riorganizzata da capo (vedi sotto). Il plot per tipologia diventa il filtro "Tipologie"; gli andamenti settimanale, giornaliero e annuale diventano "Giorno della settimana", "Ora del giorno" e "Mese per mese, anno per anno". Si stampa in PDF dal browser |
| Tasse: Forza IVA, regime, IRPEF, INPS, spese deducibili/detraibili | Scheda **Tasse** |
| Impostazioni: digit codice, tipologie (Agg./Mod./Canc.), fornitori, zone, pagamenti, clienti, tipologie spese, operatori, caselle di opzione | Scheda **Impostazioni**, una sezione per ogni lista |
| Utente di Windows registrato su movimenti e spese | Operatore scelto nella barra in alto (in mancanza, l'utente del computer) |

### Scheda Statistiche

In alto una sola barra di filtri, che vale per tutta la pagina (preferenze del browser, non del
database): **Periodo** (questo mese, mese scorso, ultimi 3 o 12 mesi, quest'anno, anno scorso, tutto lo
storico, come nel Pannello, date a scelta), **Confronta con** (stesse date dell'anno prima, periodo
precedente, nessuno), **Tipologie** (tutte o alcune; anche con un clic sulla tabella) e **Mostra**
(incasso € o pezzi). Sotto, sei sezioni:

- **Riepilogo**: incasso netto, scontrini, scontrino medio, pezzi, pezzi per scontrino, margine lordo,
  giorni con vendite, incasso medio al giorno, ognuno con la variazione rispetto al confronto.
- **Andamento**: incasso (o pezzi) nel tempo con la linea del confronto e il passo automatico o a scelta;
  progressivo dall'inizio dell'anno, anno per anno; mese per mese negli ultimi anni.
- **Cosa si vende**: tabella per tipologia (pezzi, incasso, quota, prezzo medio, margine, variazione),
  quota per tipologia, margine per tipologia, articoli e decori più venduti.
- **Quando si vende**: media per giorno della settimana nei giorni di apertura, ora del giorno, mappa giorno×ora.
- **Cassa e operatori**: fasce di importo degli scontrini, per operatore; per pagamento e zona solo
  quando questi campi sono compilati nelle vendite.
- **Magazzino oggi** (non dipende dal periodo): valore, pezzi, codici, merce ferma, tabella per tipologia
  con i **mesi di scorta**, articoli fermi e da riordinare.

In più rispetto a Excel: la scheda Statistiche descritta sopra, la **Verifica coerenza** del
magazzino, i backup automatici e l'export CSV di ogni tabella.

## Bachi trovati nelle macro

L'analisi completa è in [docs/ANALISI_MACRO.md](docs/ANALISI_MACRO.md). In sintesi: nel file
c'era un **codice duplicato** (PIA00041, una riga con giacenza 0 e una con 6) che faceva dire
alla macro di vendita "quantità non disponibile" anche se i pezzi c'erano; le macro non
impediscono i duplicati, la modifica di un articolo scorpora l'IVA dal costo una seconda volta,
annullare una conferma nel carico annulla il carico senza avviso, il filtro del foglio Magazzino
copre solo le prime 893 righe e le cancellazioni di codici e tipologie eliminano anche lo storico.
La webapp impedisce i duplicati, traccia ogni variazione con un movimento e offre una verifica
di coerenza con un clic.

## Reimportare i dati dall'Excel

```bash
pip install openpyxl
python tools/import_xlsm.py Reference/RoscoERP.xlsm data/roscoerp.json
```

Lo script stampa le normalizzazioni applicate (righe duplicate unite, nomi uniformati).

## Test

```bash
npm test
```

Verifica, fra l'altro, che il Conto Economico calcolato dall'app coincida con quello del foglio Excel.
