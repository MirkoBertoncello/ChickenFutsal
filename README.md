# ChickenFutsal — Cloudflare Pages + Supabase

Sito mobile per un gruppo privato di calcetto. Codice pronto per la configurazione;
nessun account cloud, database o sito pubblico è stato creato in questo passaggio.

## Cosa contiene

- Rosa, esagoni da 1 a 99, statistiche annuali e classifiche.
- Due squadre da 5, selezione di 10 giocatori distinti e scambio delle formazioni.
- Tabellini correggibili: i totali derivano dalle partite, senza incrementi duplicati.
- Account Supabase e inviti tramite associazione email da parte degli admin.
- Controlli server: admin, visibilità delle statistiche del gruppo, dati personali sempre visibili.
- Pollone e Bidone con 1–4 turni indipendenti per stagione; primo turno con tutti;
  turni successivi con candidati scelti dall'admin; un voto a persona per turno,
  autovoto consentito e voti azzerati; gli eliminati continuano a votare.
- Risultati aggregati dei voti visibili solo a turno chiuso. Eventuali pari merito
  restano espliciti; fino al terzo turno è possibile aprire uno spareggio.
- Avvisi personali alla convocazione; notifiche Web Push quando configurate.
- Download calendario .ics con orario Europe/Rome.
- PWA aggiungibile alla Home; richiede connessione per account e dati condivisi.
- Controllo quotidiano del database, esclusivamente in lettura.

La segretezza è verso gli admin dell'app. Il proprietario del progetto Supabase
può leggere le tabelle tecniche, comprese le schede: non è anonimato verso l'operatore.
L'esagono è un profilo corrente; gol, autogol e presenze sono separati per stagione.
Un solo gruppo per progetto. Ruoli di gioco e nomi vengono impostati all'aggiunta.

## 1. Provare la demo

Dal terminale nella cartella del progetto:

```sh
python3 -m http.server 8080 --directory web
```

Aprire http://localhost:8080 sullo stesso computer. La demo usa dati fittizi locali,
con selettore di identità. Gli account reali e le notifiche non sono attivi.
`web/config.js` vuoto mantiene la demo: non pubblicarla come gruppo reale.

## 2. Creare il progetto Supabase

1. Creare un account su https://supabase.com/dashboard e una organizzazione Free.
2. Creare il progetto `chicken-futsal`, scegliendo una regione europea.
3. Salvare la password del database nel proprio gestore password, senza inviarla in chat.
4. Nel SQL Editor eseguire `supabase/schema.sql` una sola volta.
5. Eseguire `supabase/migrations/20261006_invite_only_signup.sql`, poi in
   Authentication > Hooks aggiungere **Before User Created**, tipo Postgres,
   funzione `public.club_before_user_created`. Solo dopo il salvataggio del hook
   le registrazioni sono limitate alle email associate ai giocatori.
6. Modificare nome ed email in `supabase/setup-admin.sql` ed eseguirlo.
7. Copiare Project URL e chiave **publishable**, o la vecchia chiave **anon**,
   nei due campi corrispondenti di `web/config.js`.
   Non inserire mai `service_role`, secret key, password o chiavi VAPID private nel sito.

Le tabelle sono nello schema privato `club_private`; nessun accesso client diretto.
Le funzioni RPC controllano membership e permessi. Non aggiungere `club_private`
agli schemi esposti dalle API. Non concedere agli amici accesso alla console Supabase.

## 3. Configurare gli account

Scegliere una delle opzioni prima di invitare gli amici:

- **Google:** configurare il provider Google in Authentication > Providers,
  seguendo https://supabase.com/docs/guides/auth/social-login/auth-google.
  Impostare `googleOAuthEnabled: true` in `web/config.js`. L'accesso Google
  consente di evitare l'invio di email di conferma; restano obbligatori gli inviti
  tramite email associata al giocatore.
- **Email e password:** configurare un SMTP proprio in Supabase Authentication.
  Il mittente SMTP predefinito Supabase non invia liberamente agli amici:
  è limitato agli indirizzi del team del progetto e a poche email per ora.
  Scegliere un provider/mittente già disponibile o un piano gratuito compatibile.
  Mantenere la conferma email attiva. Non disattivarla per aggirare i limiti.

Documentazione: https://supabase.com/docs/guides/auth/auth-smtp.
Nella prima configurazione è possibile provare l'account del proprietario,
ma non aggiungere gli amici al team tecnico Supabase solo per ricevere email.

## 4. Pubblicare Cloudflare Pages

1. Creare un account gratuito su https://dash.cloudflare.com.
2. Aprire Workers & Pages e creare un progetto Pages tramite **Direct Upload**.
3. Caricare la cartella `web/`, oppure lo ZIP dei soli file web, con `index.html`
   alla radice. Il sito non richiede installazioni o build.
4. Verrà assegnato un URL HTTPS `https://NOME-SCELTO.pages.dev`.
5. In Supabase Authentication > URL Configuration impostare quell'URL come Site URL
   e autorizzare lo stesso URL con `/` finale tra i Redirect URLs.
6. Accedere con l'email indicata nel setup admin. Nel caso email/password, creare
   l'account e confermarlo prima di accedere.
7. Aggiungere i giocatori e le loro email dalla sezione Giocatori / Gestione.
   Ogni amico crea il proprio account o usa Google con la stessa email.

L'associazione email NON invia un'email di invito. Condividere il link del sito
agli amici; nessun messaggio viene inviato automaticamente agli amici dal progetto.
Gli account esterni al gruppo ricevono un errore di accesso anche se registrati.
Tutti consultano gli stessi dati; il pulsante Aggiorna ricarica lo stato dal server.

Direct Upload: https://developers.cloudflare.com/pages/get-started/direct-upload/.
Conservare una copia privata del codice e del database. I backup automatici non sono
inclusi nel piano Supabase Free: pianificare esportazioni periodiche tramite CLI.

## 5. Notifiche Web Push (opzionali per il primo collaudo)

Gli avvisi personali nel sito sono già creati quando l'admin convoca la partita.
Per riceverli anche con il sito chiuso:

1. Sul proprio computer eseguire `node operations/generate-vapid.cjs`.
   Le chiavi e un CRON_SECRET sono salvati in `operations/local-secrets/vapid.env`,
   escluso da Git. Non condividere il file, non caricarlo su Pages.
2. Sostituire il contatto email in VAPID_SUBJECT. Salvare VAPID_PUBLIC_KEY,
   VAPID_PRIVATE_KEY, VAPID_SUBJECT e CRON_SECRET nei Secrets delle Edge Functions
   Supabase. SUPABASE_URL e SUPABASE_SERVICE_ROLE_KEY sono forniti dal runtime.
3. Inserire SOLO VAPID_PUBLIC_KEY in `web/config.js` come `vapidPublicKey`.
4. Distribuire `supabase/functions/send-push` come Edge Function, rispettando
   `supabase/config.toml`. Il controllo JWT gateway è disattivato per questa sola
   funzione, che verifica invece CRON_SECRET. Esempio con CLI collegata:
   `supabase functions deploy send-push --no-verify-jwt`.
5. Per restare interamente nel cloud, configurare Cron, pg_net e Vault in Supabase
   e poi eseguire `operations/schedule-push.sql`: invoca la funzione ogni 5 minuti.
   In alternativa pianificare `operations/send-push.py` sul QNAP, passando
   SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY e CRON_SECRET mediante un ambiente protetto. Nessuna porta
   in ingresso sul NAS se scegli questa alternativa: effettua soltanto una richiesta HTTPS in uscita.
   In alternativa programmare lo stesso POST con un servizio cron che custodisca
   il segreto; non usare un URL pubblico contenente il segreto.
6. Ripubblicare `web/` e premere Attiva notifiche sul dispositivo di ogni utente.

Pianificazione cloud: https://supabase.com/docs/guides/functions/schedule-functions.
Il cron interno non gira se il progetto è in pausa; il controllo quotidiano esterno
resta distinto.

La consegna dipende dal consenso, dal browser e dal servizio push; il polling della
coda introduce fino a circa 5 minuti di attesa, più eventuali ritardi/retry.
Su iPhone aggiungere prima il sito alla Home (iOS 16.4 o successivo).
Ogni dispositivo si iscrive separatamente. I recapiti push non sono mostrati agli admin.
Le consegne fallite vengono riprovate fino a 3 volte; gli avvisi restano nel sito.
La funzione Web Push è predisposta ma non verificata contro provider reali in questa sessione.

## 6. Controllo giornaliero del database

`operations/healthcheck.py` esegue una sola lettura tecnica `club_health()`.
Non restituisce dati personali e non scrive dati.

- **QNAP:** pianificarlo una volta al giorno con SUPABASE_URL e
  SUPABASE_PUBLISHABLE_KEY nel suo ambiente.
- **GitHub Actions:** in un repository privato copiare `operations/daily-health.yml`
  in `.github/workflows/daily-health.yml`, aggiungere i due valori come Secrets
  e conservare `operations/healthcheck.py` nel repository. Controllare le quote Actions.
  L'esecuzione è alle 08:17 UTC: 09:17 in inverno / 10:17 in estate in Italia.
  I workflow pianificati possono essere ritardati, non sono un servizio garantito.

Questo controllo NON garantisce l'esclusione dalla pausa del piano Free: Supabase
valuta la scarsa attività su 7 giorni senza pubblicare una soglia esatta.
Controllare gli avvisi del proprietario e riattivare dalla console se necessario.

## Verifica eseguita

- Sintassi JavaScript e rendering/logica delle schermate mediante test Node.
- Script SQL eseguito con PostgreSQL locale tramite PGlite.
- Permessi per membri/admin/anonimi, dati personali, inviti, voti duplicati,
  autovoto, eliminati che votano, quattro turni, premi indipendenti e nuove stagioni.
- Correzioni tabellino senza duplicare totali e coda push accessibile solo al servizio.

Per ripetere: `npm install` e `npm test` (Node 20+).
Non sono stati eseguiti collaudi in un browser reale, su Supabase remoto o di push
reali. Prima di invitare tutto il gruppo, collaudare con un admin e un giocatore
su due dispositivi, verificando i permessi, una partita e un turno completo.

## Registrazioni solo su invito — progetto già attivo

Eseguire soltanto `supabase/migrations/20261006_invite_only_signup.sql` nel SQL Editor.
Poi attivare Authentication > Hooks > Before User Created usando la funzione Postgres
`public.club_before_user_created`. Il controllo usa le email esatte presenti in
`club_private.members`, ignorando maiuscole/minuscole. Nessun intero dominio è autorizzato.
Non assegnare l'esecuzione della funzione agli utenti del sito.

Gli admin invitano dal sito aggiungendo l'email del giocatore in Gestione o quando
creano il giocatore. Dopo questo passaggio la persona può registrarsi con quell'email.
Il hook non elimina né blocca l'autenticazione tecnica degli account già esistenti:
i controlli delle RPC impediscono comunque l'accesso ai dati agli account non invitati.
Collaudare un nuovo account invitato e uno non invitato per verificare l'attivazione.

## Aggiornamento: annullamenti e occasionali

Per un progetto già attivo eseguire SOLO
`supabase/migrations/20261006_cancel_matches_and_guests.sql` nel SQL Editor.
Lo script aggiunge campi e aggiorna le funzioni; conserva partite, giocatori e voti.
Non rieseguire `schema.sql`.

- Partite > Dettagli > Annulla partita: solo admin, conferma e motivo facoltativo.
  La partita resta nello storico, sparisce dalla prossima partita in home e non
  contribuisce a gol, autogol o presenze, anche se già conclusa. Il tabellino è
  conservato ma non modificabile. L'annullamento non è reversibile dall'interfaccia.
- Vengono creati avvisi per i convocati; push solo se già configurato e autorizzato.
  Le convocazioni ancora in coda sono fermate; push già inviati non possono essere ritirati.
- Giocatori > Giocatore > Tipo > Occasionale, senza account: nessuna email,
  nessuna registrazione, ma esagono, statistiche, selezione nelle formazioni e classifiche.
  Non riceve notifiche né può votare senza account. Può comunque essere candidato
  ai premi, come gli altri giocatori. Va avvisato personalmente delle partite.
- Gestione > Abilita account: associare una email trasforma l'occasionale in membro
  senza perdere i dati. La registrazione sarà ammessa dal controllo sugli inviti.

## Eliminazione giocatori

Per il database esistente eseguire solo `supabase/migrations/20261006_delete_player.sql`,
DOPO la migrazione annullamenti e occasionali. Gli admin possono aprire un profilo
in Giocatori e scegliere Elimina giocatore, confermando con ELIMINA.
Non è possibile eliminare il proprio profilo admin né un giocatore convocato in
partite ancora in programma: prima occorre annullarle.

Il profilo viene cancellato fisicamente: nome, email associata, esagono, membership,
avvisi, recapiti push e schede espresse/ricevute sono rimossi. Le candidature e i
risultati delle votazioni vengono aggiornati. Le partite conservano il contributo
anonimo al tabellino (identificativo storico senza nome, visualizzato come Giocatore
eliminato), preservando punteggio e statistiche degli altri. Questo non è cancellazione
integrale di tutte le tracce storiche. L'eventuale account tecnico Supabase Auth
resta esistente ma non può più accedere ai dati; può essere cancellato separatamente
in Authentication > Users. I controlli degli inviti impediranno una nuova registrazione
finché l'email non viene nuovamente associata a un giocatore.

### Stagioni personalizzate
Eseguire in Supabase SQL Editor `supabase/migrations/20261006_custom_seasons.sql` dopo le migrazioni precedenti. Gli admin trovano “Inizia nuova stagione” nella barra superiore: nome libero (es. 2026/2027) e data d’inizio. La chiusura precedente è atomica, conserva i dati e chiude i turni aperti senza assegnare automaticamente i premi. Le partite pendenti vanno prima registrate o annullate. Lo storico è consultabile nel selettore stagioni; le operazioni su partite e votazioni delle stagioni chiuse sono bloccate dal server. I giocatori, permessi e sei valutazioni restano; gol, autogol, presenze e voti sono distinti per stagione. Le partite possono attraversare il 31 dicembre.

Per rinominare la stagione attiva in **2025/2026**, eseguire `supabase/migrations/20261006_current_season_label.sql`. L’apertura delle votazioni di ciascun premio è riservata agli admin, anche sul server; non è automatica al cambio stagione.

### Configurazione push guidata (senza terminale)
Aprire `https://chickenfutsal.pages.dev/push-setup.html` oppure Impostazioni → Configura notifiche push (admin). La pagina genera le chiavi P-256 nel browser, senza inviare i valori privati. Salvare il file `.env` privato, configurare i quattro Secrets su Supabase, pubblicare `send-push` dall’editor con Verify JWT disattivato e infine eseguire l’SQL generato. La chiave pubblica è letta tramite `club_push_config`, perciò non serve modificarla su GitHub. Il primo avvio scarta la vecchia coda, mantenendo gli avvisi nel sito. Il job parte ogni cinque minuti. Conservare e riutilizzare il file `.env`: la guida impedisce di sostituire accidentalmente una chiave già attiva. Non pubblicare il file `.env` né l’SQL generato, che contiene il segreto del job.

`web/send-push-source.txt` deve essere mantenuto identico a `supabase/functions/send-push/index.ts`; il test verifica questa corrispondenza. La configurazione cloud richiede accesso amministrativo alla dashboard Supabase: non è stata applicata né collaudata con push reali da questo ambiente.

### Modifica partita
Eseguire `supabase/migrations/20261006_edit_matches.sql` dopo le migrazioni delle stagioni. Gli admin possono usare Dettagli → Modifica partita per data, ora, campo e dieci partecipanti nelle due squadre. La stagione resta quella della partita; le stagioni chiuse e le partite annullate sono bloccate dal server. Nei tabellini già registrati i dati dei giocatori mantenuti restano, quelli rimossi vengono esclusi e i nuovi iniziano assenti con zero gol: usare Correggi risultato per completare la correzione. Gli avvisi di aggiornamento arrivano ai convocati con account e quelli di revoca ai rimossi; vengono sostituiti gli invii precedenti ancora in coda. Chi ha importato un file .ics dovrà aggiornare anche il proprio calendario. Campo predefinito per le nuove partite: Oratorio Don Bosco Arena.

Per rendere visibili a tutti i membri i vincitori di Scarpa d’oro, Coppa Jumbo e 4 Pollari delle stagioni chiuse, eseguire `supabase/migrations/20261006_closed_award_winners.sql`. Il server restituisce solo nomi e ID dei vincitori, compresi i pari merito; gli altri dati restano soggetti ai permessi. Nessun vincitore viene indicato se il totale del premio è zero. Le stagioni attive conservano i permessi precedenti.
