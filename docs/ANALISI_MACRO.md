# Analisi delle macro VBA di RoscoERP.xlsm

Analisi completa del codice VBA (circa 7.000 righe: `Modulo1`, `Modulo2`, `Modulo_tipo`,
`Modulo_check`, `Modulo_data`, `Modulo_plot_NEW`, `Modulo_statistiche_NEW`, le UserForm
`carica`, `seleziona`, `vendita`, `incasso`, `spesa`, `getdata`, `pwd`) e dei dati presenti nel
file al 6 novembre 2026 (1.137 righe di magazzino, 7.201 movimenti, 5.243 vendite, 410 spese).

Obiettivo: capire perché "ogni tanto sparisce qualcosa dal magazzino" e verificare la logica
prima di replicarla nella webapp.

## Verifica dei dati: cosa risulta davvero "sparito"

Confronto fra la colonna *Giacenza* del foglio Magazzino e la somma dei *Movimenti* di ogni codice:

| Controllo | Risultato |
|---|---|
| Codici con giacenza diversa dalla somma dei movimenti | **1 su 1.137** (PIA00041) |
| Codici duplicati nel foglio Magazzino | **1** (PIA00041, righe 219 e 220) |
| Movimenti che puntano a codici inesistenti | 0 |
| Vendite senza il movimento di scarico corrispondente | 0 |
| Movimenti di carico duplicati entro pochi secondi | 1 (PIA00004, 24/01/2023, doppio clic) |
| Righe di Magazzino con tipologia scritta diversa dalla lista (POSATE/Posate) | 10 |
| Righe di Spese fuori ordine cronologico | 2 |
| Movimenti di carico con costo diverso dal costo attuale dell'articolo | 211 (normale: prezzi cambiati nel tempo) |

**Il caso PIA00041 (Piatto 25 cm, decoro CONTRADA) spiega il sintomo.** Il codice compare due
volte: la riga 219 ha giacenza 0, la riga 220 ha giacenza 6 (che è il valore corretto secondo i
movimenti). La macro di vendita (`carica_vend`) cerca il codice e si ferma alla **prima** riga
trovata, quindi vede giacenza 0 e risponde *"Quantità richiesta non disponibile in magazzino"*
anche se in negozio ci sono 6 piatti: per chi usa il programma i piatti sono "spariti". Nella
finestra di vendita l'articolo compare due volte, una con 0 e una con 6, e la riga giusta è
selezionabile solo per caso. Anche il valore di magazzino e il Conto Economico leggono la prima riga.

Come si crea un duplicato in Excel? Nessuna macro controlla l'unicità del codice:
`modifica_code` accetta qualsiasi codice digitato (anche già esistente), `mod_tipo` rinomina i
prefissi senza verificare collisioni, e `modifica_foglio` (protetta da password) sblocca le celle per
la scrittura manuale. Nell'importazione le due righe sono state **unite** (giacenza 6).

## Bachi e fragilità trovati nelle macro

1. **Codici duplicati non impediti** (`modifica_code`, `mod_tipo`, modifica manuale). Vedi sopra.
   *Webapp:* il cambio codice rifiuta un codice già esistente; la rinomina del prefisso verifica le
   collisioni prima di toccare i dati; la "Verifica coerenza" segnala eventuali duplicati.

2. **Costo scorporato dell'IVA due volte nella modifica articolo.** `UserForm_carica` divide il
   costo per (1 + IVA) quando la casella IVA è spuntata; la casella è preimpostata con il flag
   `check_iva_carmag`. In `modifica_mag` il campo è precompilato con il costo già netto, quindi se
   il flag è attivo ogni salvataggio riduce il costo del 18% (e con esso il valore del magazzino).
   *Webapp:* nella modifica la casella parte sempre disattivata e il costo è inteso netto.

3. **Annullare la conferma "Aggiornarlo?" annulla silenziosamente tutto il carico.** In
   `carica_mag`, se a una qualsiasi delle tre domande (costo, fornitore, prezzo diversi) si risponde
   *Annulla*, la giacenza non viene aggiornata e non viene creato il movimento, ma il ciclo
   prosegue senza avviso: l'operatore crede di aver caricato i pezzi. *Webapp:* un'unica finestra
   con caselle "cosa aggiornare" e messaggio esplicito "Carico annullato".

4. **Giacenza salvata come numero, non derivata dai movimenti.** Qualsiasi modifica manuale
   alla colonna Giacenza (celle sbloccate con `modifica_foglio`) cambia il magazzino senza lasciare
   traccia. *Webapp:* nessuna modifica diretta; ogni variazione passa da Carico, Vendita o
   Correzione, e la "Verifica coerenza" confronta giacenze e movimenti con un clic.

5. **Cancellazioni distruttive.** `canc_code` elimina l'articolo **e tutte le sue vendite e
   movimenti**; `canc_tipo` lo fa per tutti i codici di una tipologia. Oltre a far sparire il
   codice, riducono retroattivamente i ricavi storici. In Excel, dopo che un `Worksheet_Change`
   ha riordinato il foglio (`ordina`), la riga selezionata può non essere più quella che si crede.
   *Webapp:* l'eliminazione mostra codice, descrizione, giacenza e il numero di movimenti/vendite che
   verranno eliminati; il file ha backup automatici.

6. **Filtro automatico "congelato".** L'intervallo del filtro del foglio Magazzino è
   `$A$1:$K$893`, ma i dati arrivano alla riga 1.138: filtrando per tipologia o decoro, le ultime
   245 righe non vengono filtrate (compaiono sempre o mai), un'altra causa di articoli "introvabili".

7. **Calcolo dei debiti verso i fornitori basato sull'ordine delle righe.** `aggiorna` scorre
   Spese e Movimenti e si ferma (`Exit Do`) alla prima riga con data oltre il limite, assumendo
   l'ordine cronologico. Le spese inserite con data retroattiva (`crea_spesa` gira con `auto=True`,
   quindi senza riordino) vengono saltate. Oggi riguarda 2 righe senza fornitore (effetto nullo),
   ma è una bomba a orologeria. *Webapp:* filtri per data indipendenti dall'ordine.

8. **"Check" riscrive la storia.** `check_mov` propone di sovrascrivere il costo dei movimenti
   passati con il costo attuale dell'articolo: cambia retroattivamente il debito verso i fornitori
   calcolato dal Conto Economico. Le 211 differenze presenti sono aumenti di listino legittimi.
   *Webapp:* la funzione esiste ma avverte dell'effetto.

9. **Le correzioni di giacenza entrano nel debito fornitori.** I movimenti "Correzione" portano
   costo e fornitore e `aggiorna` li somma come acquisti: una correzione di −3 pezzi riduce il
   debito verso il fornitore anche se si tratta di una rottura. *Webapp:* stesso comportamento di
   default (per avere gli stessi numeri di Excel) ma disattivabile in Tasse.

10. **Doppio inserimento.** `UserForm_carica` chiama `ok_button` sia dal pulsante che dal doppio
    clic sulla lista tipologie: un doppio clic può registrare due carichi (caso PIA00004).

11. Minori: la quantità 0 è accettata nel carico (`Val(qty) < 0`); l'anno bisestile è
    calcolato con `anno/4` (sbaglia il 2100); `mese_piu` somma i giorni del mese sbagliato quando
    il periodo non parte dal primo del mese; `Spedizione` esiste sia come tipologia (prefisso SPE)
    sia come codice speciale `SPEDIZIONE` degli incassi; nelle prime 1.038 vendite il flag IVA è
    vero ma l'aliquota è 0.

## Cosa fa diversamente la webapp

- Ogni codice è unico; ogni variazione di giacenza genera un movimento.
- Il Conto Economico replica `aggiorna` voce per voce (verificato: coincide al centesimo con il
  foglio Excel sul periodo 1/1/2026 – 6/11/2026) ma non dipende dall'ordine delle righe.
- Il database è un unico file JSON, salvato ad ogni modifica, con copia della versione precedente
  e un backup al giorno nella cartella `backup_<nome>` accanto al file.
- La "Verifica coerenza" (Magazzino, Movimenti, Impostazioni) elenca giacenze incoerenti, codici
  duplicati, movimenti orfani e vendite senza scarico, e permette di correggere con tracciamento.

## Normalizzazioni applicate nell'importazione

- PIA00041: le due righe sono state unite (giacenza 0 + 6 = 6, coerente con i movimenti).
- Tipologia `POSATE` (10 righe) → `Posate`; spesa `donazione` → `Donazione`.
- Le colonne calcolate (Consumo, Valore totale, Prezzo totale, Costo totale, MU) non sono salvate:
  vengono ricalcolate dall'app.
