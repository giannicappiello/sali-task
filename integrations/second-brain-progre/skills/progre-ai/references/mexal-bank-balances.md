# Saldi bancari Mexal in sola lettura

Eseguire BRAIN_STATUS e verificare identità e catalogo personale. Usare `MEXAL_BANK_BALANCES_READ` per un anno supportato (2000–2100), `accountCodes` bancari espliciti verificati con MEXAL_CASHFLOW_READ e `asOf` facoltativa nello stesso anno. Senza data, il limite è il 31 dicembre per gli anni passati e oggi Europe/Rome per l'anno corrente; una data futura è rifiutata. Il 2026 è un collaudo, non un limite applicativo.

Lettura riservata agli stessi accessi personali della finanza Mexal: internal_data, amministratore Workspace verificato live e ambito tutti. Il livello AI generico non prova il permesso. Nessuna modifica di autorizzazioni, connessioni, contabilità o memoria.

Per ogni conto leggere separatamente:

- `openingBalance`: somma esatta delle AP registrate al 1 gennaio, solo con prima nota completa e scritture bilanciate verificabili. La fonte conserva data, progressivo e importo. Apertura registrata non equivale a chiusura definitiva dell'anno precedente certificata. Nessuna AP non significa saldo zero.
- `movements`: variazioni dal 1 gennaio alla data, con il medesimo motore di MEXAL_CASHFLOW_READ, che esclude AP/BA/CH. Non sono saldi. I totali combinati compensano giroconti, quelli per conto ne conservano l'effetto sul conto.
- `closingBalance`: saldo contabile derivato soltanto da base AP attestata e movimenti completi. BA/CH entro la data, AP su altre date, righe invalide o fonti incomplete impediscono di attestarlo. Esercizi non solari richiedono una fonte ufficiale aggiuntiva.
- `currency.code` e `valueDate`: null se non attestati; non aggiungere EUR o data valuta per deduzione.
- `configuredFacilities`: eventuali campi originali fido_scoperto/fido_castel_eff, inclusi zeri espliciti, con data di lettura e validità storica non verificata. Non rappresentano affidamenti disponibili alla data richiesta. `creditFacilitiesAtDate`, `exposure`, `availableBalance` e `bankReconciledBalance` restano null in questo contratto.
- `completeness` per conto e `sources`: esaurimento dei cursori, ragioni dei null e impronte della lettura. Completezza dei movimenti può essere vera mentre quella dei saldi è falsa. Letture paginate non transazionali non attestano riconciliazione bancaria o scritture mancanti.

Il catalogo /help dell'installazione GRE verificato l'8 novembre 2026 non pubblica un endpoint dedicato ai saldi. /conti non contiene il saldo iniziale né quello alla data. Le AP sono una fonte contabile documentata nel [manuale ufficiale Mexal](https://www.edupass.it/manuali/manualistica-mexal/manuale-prodotto?a=manuale-prodotto/contabilita/stampe-contabili/bilanci/bilancio-di-verifica). Non inventare un nuovo endpoint, non sommare movimenti a una base zero presunta e non usare fatture o scadenziario al posto del saldo.

Nel collaudo 2026 sui conti 202.01003 (Unicredit C/C 603915), 202.01001 e 202.01006 (due anagrafiche Intesa distinte) non risultano AP: i saldi devono rimanere null. Non accorpare le due anagrafiche Intesa in un unico conto per somiglianza del nome. Novembre dopo la data di lettura e dicembre non sono consuntivi disponibili.

Se lo strumento è presente nel catalogo personale ma manca nella chat, aggiornare le azioni della connessione esistente dopo il rilascio autorizzato. Una patch o un pacchetto preparato non prova che lo strumento sia già distribuito.
