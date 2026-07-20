# Computo lavori: riorganizzazione a gruppi + colonna Prezzo IA

Data: 2026-07-20
Area: `src/App.jsx` (tab "Computo ristrutturazione")

## Contesto

Il tab di computo ristrutturazione (`dashTab === "ristrutturazione"`, `App.jsx:3791-3865`) mostra oggi le 43 voci di `RIST_INIT` (`App.jsx:534-578`) in un'unica tabella piatta, in ordine alfabetico. Si vuole:

1. Rinominare l'etichetta del tab in "Computo lavori".
2. Riorganizzare le voci in 3 macrogruppi per fase di lavorazione (Murature → Impianti → Rifiniture) invece dell'ordine alfabetico.
3. Aggiungere una colonna "Prezzo IA": un prezzo di riferimento di mercato, statico e non editabile, mostrato accanto al prezzo (editabile) già esistente, per permettere all'utente di confrontare la propria stima con un valore medio di mercato.

## 1. Rinomina tab

`App.jsx:3494` — label del tab in `tabs`:
```
{ id: "ristrutturazione", label: "Computo ristrutturazione" }
→ { id: "ristrutturazione", label: "Computo lavori" }
```
L'`id` resta invariato (è referenziato altrove come `dashTab === "ristrutturazione"`). Il titolo di sezione dentro la pagina (`App.jsx:3796`, "Computo ristrutturazione") resta invariato.

## 2. Riorganizzazione in 3 gruppi

`RIST_INIT` viene riordinato fisicamente (Murature, poi Impianti, poi Rifiniture) e ogni voce guadagna un campo `gruppo: "murature" | "impianti" | "rifiniture"`.

Assegnazione confermata (43 voci):

**Murature** (9): Assistenza muraria, Demolizione murature, Smontaggio e smaltimento infissi, Ricostruzione murature, Intonaco, Massetto alleggerito, Cappotto, Guaina terrazzo, Sistemazione balconi

**Impianti** (10): Idrico/fognante, Impianto elettrico, Impianto termico, Elementi radianti, Pompa di calore, Split, Canalizzato, Scaldabagno elettrico, Termo arredo, Termoarredo elettrico

**Rifiniture** (24): Battiscopa, Battiscopa balconi, Controsoffitto, Controsoffitto umidi (zone bagno), Infissi completi con tapparella e motore, Lavabo, Mobile bagno, Pavimento balconi e posa, Pavimento gres e posa, Pavimento parquet, Piatto doccia, Pitturazioni esterne, Porta blindata, Porta filo muro, Porta scrigno, Porte battente, Posa in opera sanitari, Posa porta, Posa porta blindata, Rivestimenti bagno e posa, Rubinetteria completa per sanitari e doccia, Soglie balconi, Tinteggiatura interna, Wc/Bidet

**UI**: nel `<tbody>` della tabella (`App.jsx:3814-3841`), quando l'iterazione passa a un `gruppo` diverso dal precedente si inserisce prima una riga di intestazione a tutta larghezza (`colSpan` su tutte le colonne), stile coerente con l'header `<thead>` (sfondo `C.navy`, testo bianco maiuscolo), con nome gruppo a sinistra e subtotale del gruppo a destra (somma di `qty * prezzo` delle sole voci di quel gruppo, formattato con `fmtEur`). Il totale generale in fondo alla tabella resta invariato.

## 3. Colonna "Prezzo IA"

Nuova colonna in tabella tra "Prezzo" e "Totale". Ogni voce di `RIST_INIT` guadagna un campo `prezzoIA` (numero, statico). Renderizzata come testo semplice non editabile (stile simile alla colonna U.M., colore `C.textLight`), formattata con `fmtEur`. Non influisce sui calcoli di `ristTotale` né su nessun altro totale — è puro riferimento visivo. Il campo `prezzo` esistente (editabile) non viene toccato.

Valori (fonte: ricerca web su prezzari e portali italiani 2025/2026 — instapro.it, cronoshare.it, prontopro.it, homedeal.it, ernesto.it, edilnet.it, ediliziacrobatica.com, studiomadera.it e altri; per le voci "a corpo" generiche relative a impianti/lavorazioni sull'intero appartamento, stima da costi aggregati di ristrutturazione completa 70-90mq):

| Voce | Gruppo | U.M. | Prezzo attuale | Prezzo IA |
|---|---|---|---|---|
| Assistenza muraria | murature | Corpo | 2000 | 2500 |
| Demolizione murature | murature | Mq | 15 | 35 |
| Smontaggio e smaltimento infissi | murature | Corpo | 50 | 70 |
| Ricostruzione murature | murature | Mq | 70 | 55 |
| Intonaco | murature | Mq | 10 | 15 |
| Massetto alleggerito | murature | Mq | 30 | 20 |
| Cappotto | murature | Mq | 50 | 70 |
| Guaina terrazzo | murature | Mq | 35 | 35 |
| Sistemazione balconi | murature | Corpo | 400 | 450 |
| Idrico/fognante | impianti | Corpo | 150 | 180 |
| Impianto elettrico | impianti | Corpo | 3250 | 6500 |
| Impianto termico | impianti | Corpo | 2500 | 5000 |
| Elementi radianti | impianti | Corpo | 250 | 350 |
| Pompa di calore | impianti | Corpo | 800 | 900 |
| Split | impianti | Corpo | 400 | 1200 |
| Canalizzato | impianti | Corpo | 3500 | 5500 |
| Scaldabagno elettrico | impianti | Corpo | 350 | 400 |
| Termo arredo | impianti | Corpo | 150 | 200 |
| Termoarredo elettrico | impianti | Corpo | 180 | 300 |
| Battiscopa | rifiniture | Ml | 17 | 20 |
| Battiscopa balconi | rifiniture | Ml | 7 | 10 |
| Controsoffitto | rifiniture | Mq | 30 | 40 |
| Controsoffitto umidi (zone bagno) | rifiniture | Mq | 40 | 60 |
| Infissi completi con tapparella e motore | rifiniture | Mq | 550 | 600 |
| Lavabo | rifiniture | Corpo | 100 | 150 |
| Mobile bagno | rifiniture | Corpo | 250 | 400 |
| Pavimento balconi e posa | rifiniture | Mq | 35 | 40 |
| Pavimento gres e posa | rifiniture | Mq | 35 | 45 |
| Pavimento parquet | rifiniture | Mq | 90 | 80 |
| Piatto doccia | rifiniture | Corpo | 230 | 350 |
| Pitturazioni esterne | rifiniture | Mq | 15 | 20 |
| Porta blindata | rifiniture | Corpo | 1000 | 1100 |
| Porta filo muro | rifiniture | Corpo | 350 | 500 |
| Porta scrigno | rifiniture | Corpo | 380 | 450 |
| Porte battente | rifiniture | Corpo | 350 | 350 |
| Posa in opera sanitari | rifiniture | Corpo | 30 | 50 |
| Posa porta | rifiniture | Corpo | 60 | 90 |
| Posa porta blindata | rifiniture | Corpo | 100 | 300 |
| Rivestimenti bagno e posa | rifiniture | Corpo | 45 | 50 |
| Rubinetteria completa per sanitari e doccia | rifiniture | Corpo | 50 | 350 |
| Soglie balconi | rifiniture | Mq | 10 | 40 |
| Tinteggiatura interna | rifiniture | Mq | 10 | 10 |
| Wc/Bidet | rifiniture | Corpo | 150 | 200 |

Nota: "Pompa di calore" è confermata come unità singola (900€), coerente con l'unità di misura "Corpo".

## 4. Fix necessario: ordine alfabetico al caricamento progetto

`App.jsx:2282` oggi riordina alfabeticamente le voci ogni volta che si apre un progetto salvato (`.sort((a, b) => a.nome.localeCompare(b.nome))`), il che vanificherebbe l'ordine a gruppi appena introdotto. Stesso problema, in forma più lieve, per il ripristino da `localStorage` in modalità lead (`App.jsx:1946`, che oggi usa l'array salvato così com'è).

**Soluzione**: funzione `mergeRistItems(saved)` che, dato un array di voci salvate (o `undefined`), restituisce sempre le voci nell'ordine e con gruppo/prezzoIA/unità del master `RIST_INIT` corrente, riprendendo da `saved` solo `qty`, `prezzo` e `selApp` per le voci che matchano per `nome`:

```js
function mergeRistItems(saved) {
  const bySaved = new Map((saved || []).map(it => [it.nome, it]));
  return RIST_INIT.map(master => {
    const s = bySaved.get(master.nome);
    return { ...master, qty: s?.qty ?? 0, prezzo: s?.prezzo ?? master.prezzo, selApp: s?.selApp ?? false };
  });
}
```

Usata in:
- `App.jsx:2282` (`handleLoadProject`) al posto del `.sort(...)` attuale.
- `App.jsx:1946` (stato iniziale da `leadSaved?.ristItems`).

Voci presenti nel salvataggio ma non più nel master vengono scartate; voci nuove del master assenti nel salvataggio prendono i default. Non serve alcuna migrazione DB: `gruppo` e `prezzoIA` sono sempre letti dal master in memoria, mai persistiti.

## 5. Link condivisi: da indice a nome

Il formato compatto dei link condivisi (`saveProjectSnapshot`/`loadProjectSnapshot`, `App.jsx:583-611`) identifica oggi ogni voce con il suo indice in `RIST_INIT` (`i: idx`). Riordinando l'array, gli indici salvati in passato puntano a voci diverse da quelle originarie.

**Soluzione**: sostituire l'indice con il nome della voce come identificatore:

- `saveProjectSnapshot` (`App.jsx:586-589`): `{ i: idx, q, p }` → `{ n: it.nome, q: it.qty, p: it.prezzo }`, rimuovendo il `findIndex`.
- `loadProjectSnapshot` (`App.jsx:599-603`): invece di indicizzare `ristItems[i]`, cerca la voce master per `nome === n` e applica `qty`/`prezzo`.

**Effetto collaterale accettato**: i link `?s=...` già condivisi in passato mostreranno quantità/prezzi associati alla voce sbagliata (perché generati con il vecchio formato a indice). Non recuperabili. Da questo rilascio in poi il formato è stabile rispetto a futuri riordini.

## Fuori scope

- Export Excel del computo (`App.jsx:2512`) ed export Word del contratto d'appalto: non modificati. Beneficiano comunque implicitamente del nuovo ordine a gruppi di `ristItems` (nessuna riga di intestazione gruppo aggiunta lì, solo l'ordine delle voci cambia).
- Nessuna chiamata API/IA a runtime: "Prezzo IA" è un dato statico nel codice, non generato dinamicamente.
- Nessuna modifica allo schema Supabase: `prezzoIA` e `gruppo` non vengono mai salvati per-progetto, sempre derivati dal master `RIST_INIT`.
