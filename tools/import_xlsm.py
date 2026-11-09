#!/usr/bin/env python3
"""Importa il file Excel RoscoERP.xlsm nel database JSON usato dalla webapp.

Uso:  python tools/import_xlsm.py Reference/RoscoERP.xlsm data/roscoerp.json

Richiede openpyxl (pip install openpyxl).
Replica fedelmente i fogli Impostazioni, Tasse, Magazzino, Movimenti, Vendite, Spese,
Pannello di controllo (periodo) e Statistiche (opzioni) del file Excel.
Le colonne calcolate (Consumo, Valore totale, Prezzo totale, Costo totale, MU)
non vengono salvate: la webapp le ricalcola.
"""
import sys, json, datetime, collections, os
import openpyxl


def iso(v):
    if isinstance(v, datetime.datetime):
        return v.strftime("%Y-%m-%dT%H:%M:%S")
    if isinstance(v, datetime.date):
        return v.strftime("%Y-%m-%dT00:00:00")
    return None


def day(v):
    if isinstance(v, (datetime.datetime, datetime.date)):
        return v.strftime("%Y-%m-%d")
    return None


def num(v, default=None):
    if v is None or v == "":
        return default
    try:
        return float(v)
    except (TypeError, ValueError):
        return default


def txt(v):
    if v is None:
        return ""
    if isinstance(v, float) and v.is_integer():
        return str(int(v))
    return str(v).strip()


def boolean(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v != 0
    return str(v).strip().lower() in ("true", "vero", "x", "1", "si", "sì")


def column(ws, header_row, col, stop_blank=True):
    out = []
    r = header_row + 1
    while True:
        v = ws.cell(r, col).value
        if v is None or txt(v) == "":
            break
        out.append(r)
        r += 1
    return out


def main(src, dst):
    print(f"Lettura {src} ...")
    wb = openpyxl.load_workbook(src, data_only=True)
    wf = openpyxl.load_workbook(src, data_only=False)
    report = []

    # ------------------------------------------------------------ Impostazioni
    shi = wb["Impostazioni"]
    num_digit = int(num(shi["B1"].value, 5))
    tipologie = [{"nome": txt(shi.cell(r, 1).value), "prefisso": txt(shi.cell(r, 2).value).upper()}
                 for r in column(shi, 3, 1)]
    fornitori = [{
        "nome": txt(shi.cell(r, 4).value),
        "default": txt(shi.cell(r, 5).value) != "",
        "debito": num(shi.cell(r, 6).value, 0),
        "dataDebito": day(shi.cell(r, 7).value) or "2023-01-01",
    } for r in column(shi, 3, 4)]
    zone = [txt(shi.cell(r, 9).value) for r in column(shi, 3, 9)]
    pagamenti = [txt(shi.cell(r, 11).value) for r in column(shi, 3, 11)]
    clienti = [txt(shi.cell(r, 13).value) for r in column(shi, 3, 13)]
    tipologie_spese = [{"nome": txt(shi.cell(r, 15).value), "diretta": txt(shi.cell(r, 16).value) != ""}
                       for r in column(shi, 3, 15)]
    operatori = [txt(shi.cell(r, 18).value) for r in column(shi, 3, 18)]
    flags = {
        "mostraGiacenzaZero": boolean(shi["AF2"].value),   # check_giac0
        "soloConPrezzo": boolean(shi["AF3"].value),        # check_soloprezzo
        "spesaAutoCarico": boolean(shi["AF5"].value),      # check_spesa_carico
        "ivaSuCostoCarico": boolean(shi["AF6"].value),     # check_iva_carmag
    }

    # ------------------------------------------------------------------ Tasse
    sht = wb["Tasse"]
    scaglioni = []
    for r in range(6, 11):
        lim = num(sht.cell(r, 1).value)
        aliq = num(sht.cell(r, 2).value)
        add = num(sht.cell(r, 4).value, 0)
        if aliq is None:
            continue
        scaglioni.append({"limite": lim, "aliquota": aliq, "addRegionale": add})
    tasse = {
        "forzaIva": boolean(sht["O1"].value),
        "percIvaForzata": num(sht["B1"].value, 0.5),
        "aumentoPrezziNonIva": num(sht["B3"].value, 0),
        "regime": int(num(sht["O2"].value, 1)),
        "addizionaleRegionale": boolean(sht["D5"].value),
        "scaglioniIrpef": scaglioni,
        "minInps": num(sht["B12"].value, 0),
        "aliqInps": num(sht["B13"].value, 0),
        "coeffRedditivita": num(sht["B14"].value, 0),
        "aliqForfettario": num(sht["B15"].value, 0),
        "riduzioneInpsForf": num(sht["B16"].value, 0),
        "speseDaDedurre": num(sht["B18"].value, 0),
        "speseDaDetrarre": num(sht["B19"].value, 0),
    }

    # ------------------------------------------------- Pannello di controllo
    shp = wb["Pannello di controllo"]
    fp = wf["Pannello di controllo"]
    def date_mode(cell):
        f = fp[cell].value
        if isinstance(f, str) and f.startswith("="):
            f = f.upper().replace(" ", "")
            if f == "=TODAY()":
                return "today", None
            if "WEEKDAY" in f:
                return "weekStart", None
            if "MONTH(TODAY())" in f:
                return "monthStart", None
            if f.startswith("=DATE(YEAR(TODAY()),1,1)"):
                return "yearStart", None
        return "fixed", day(shp[cell].value)
    mode_in, fixed_in = date_mode("B12")
    mode_end, fixed_end = date_mode("B13")
    periodo = {"dataInMode": mode_in, "dataIn": fixed_in or day(shp["B12"].value),
               "dataEndMode": mode_end, "dataEnd": fixed_end or day(shp["B13"].value)}

    # ------------------------------------------------------------ Statistiche
    shs = wb["Statistiche"]
    statistiche = {
        "periodo": int(num(shs["H1"].value, 30)),
        "media": boolean(shs["J1"].value),
        "criterio": int(num(shs["K1"].value, 1)),
        "tutteLeVendite": boolean(shs["Q1"].value),
    }

    # -------------------------------------------------------------- Magazzino
    shm = wb["Magazzino"]
    tip_by_lower = {t["nome"].lower(): t["nome"] for t in tipologie}
    magazzino = []
    by_code = {}
    r = 2
    while txt(shm.cell(r, 1).value) != "":
        code = txt(shm.cell(r, 1).value)
        tipo = txt(shm.cell(r, 2).value)
        tipo_norm = tip_by_lower.get(tipo.lower(), tipo)
        if tipo_norm != tipo:
            report.append(f"Magazzino riga {r}: tipologia '{tipo}' normalizzata in '{tipo_norm}'")
        row = {
            "codice": code,
            "tipologia": tipo_norm,
            "descrizione": txt(shm.cell(r, 3).value),
            "dimensioni": txt(shm.cell(r, 4).value),
            "decoro": txt(shm.cell(r, 5).value),
            "giacenza": num(shm.cell(r, 7).value, 0),
            "costo": num(shm.cell(r, 8).value, 0),
            "fornitore": txt(shm.cell(r, 10).value),
            "prezzo": num(shm.cell(r, 11).value),
        }
        if code in by_code:
            prev = by_code[code]
            report.append(f"Magazzino riga {r}: CODICE DUPLICATO {code} (giacenze {prev['giacenza']} + {row['giacenza']}): righe unite, giacenza sommata")
            prev["giacenza"] += row["giacenza"]
            for k in ("descrizione", "dimensioni", "decoro", "fornitore"):
                if not prev[k] and row[k]:
                    prev[k] = row[k]
            if not prev["costo"] and row["costo"]:
                prev["costo"] = row["costo"]
        else:
            by_code[code] = row
            magazzino.append(row)
        r += 1

    # -------------------------------------------------------------- Movimenti
    shmv = wb["Movimenti"]
    movimenti = []
    r = 2
    while shmv.cell(r, 1).value not in (None, ""):
        movimenti.append({
            "data": iso(shmv.cell(r, 1).value),
            "utente": txt(shmv.cell(r, 2).value),
            "codice": txt(shmv.cell(r, 3).value),
            "movimento": num(shmv.cell(r, 4).value, 0),
            "costo": num(shmv.cell(r, 5).value),
            "fornitore": txt(shmv.cell(r, 6).value),
            "tipo": txt(shmv.cell(r, 7).value),
        })
        r += 1

    # ---------------------------------------------------------------- Vendite
    shv = wb["Vendite"]
    vendite = []
    r = 2
    while shv.cell(r, 1).value not in (None, ""):
        vendite.append({
            "data": iso(shv.cell(r, 1).value),
            "codice": txt(shv.cell(r, 2).value),
            "qta": num(shv.cell(r, 3).value, 0),
            "prezzo": num(shv.cell(r, 4).value, 0),
            "costo": num(shv.cell(r, 6).value),
            "iva": boolean(shv.cell(r, 9).value),
            "ivaVal": num(shv.cell(r, 10).value, 0),
            "cliente": txt(shv.cell(r, 11).value),
            "zona": txt(shv.cell(r, 12).value),
            "pagamento": txt(shv.cell(r, 13).value),
            "operatore": txt(shv.cell(r, 14).value),
        })
        r += 1

    # ------------------------------------------------------------------ Spese
    shs2 = wb["Spese"]
    spese_by_lower = {t["nome"].lower(): t["nome"] for t in tipologie_spese}
    spese = []
    r = 2
    while shs2.cell(r, 1).value not in (None, ""):
        tipo = txt(shs2.cell(r, 3).value)
        tipo_norm = spese_by_lower.get(tipo.lower(), tipo)
        if tipo_norm != tipo:
            report.append(f"Spese riga {r}: tipologia '{tipo}' normalizzata in '{tipo_norm}'")
        spese.append({
            "data": iso(shs2.cell(r, 1).value),
            "utente": txt(shs2.cell(r, 2).value),
            "tipologia": tipo_norm,
            "descrizione": txt(shs2.cell(r, 4).value),
            "spesa": num(shs2.cell(r, 5).value, 0),
            "fornitore": txt(shs2.cell(r, 6).value),
            "iva": boolean(shs2.cell(r, 7).value),
            "ivaVal": num(shs2.cell(r, 8).value, 0),
        })
        r += 1

    # ids
    for coll, prefix in ((magazzino, "a"), (movimenti, "m"), (vendite, "v"), (spese, "s")):
        for i, row in enumerate(coll, start=1):
            row["id"] = f"{prefix}{i}"

    now = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    db = {
        "schema": 1,
        "meta": {"app": "RoscoERP", "createdAt": now, "savedAt": now, "revision": 1,
                 "source": os.path.basename(src), "nextId": {"a": len(magazzino) + 1, "m": len(movimenti) + 1,
                                                              "v": len(vendite) + 1, "s": len(spese) + 1}},
        "settings": {
            "numDigit": num_digit,
            "tipologie": tipologie,
            "fornitori": fornitori,
            "zone": zone,
            "pagamenti": pagamenti,
            "clienti": clienti,
            "tipologieSpese": tipologie_spese,
            "operatori": operatori,
            "flags": flags,
            "ivaDefault": 22,
            "tasse": tasse,
            "statistiche": statistiche,
            "periodo": periodo,
            "nomeNegozio": "RoscoERP",
        },
        "magazzino": magazzino,
        "movimenti": movimenti,
        "vendite": vendite,
        "spese": spese,
    }
    os.makedirs(os.path.dirname(os.path.abspath(dst)), exist_ok=True)
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(db, f, ensure_ascii=False, indent=1)
    print(f"Scritto {dst}: {len(magazzino)} articoli, {len(movimenti)} movimenti, {len(vendite)} vendite, {len(spese)} spese")
    if report:
        print("\nNote di importazione:")
        for line in report:
            print(" -", line)


if __name__ == "__main__":
    if len(sys.argv) < 3:
        print(__doc__)
        sys.exit(1)
    main(sys.argv[1], sys.argv[2])
