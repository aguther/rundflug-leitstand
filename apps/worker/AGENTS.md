# Worker-Anwendung

- Jede Schreibroute benötigt Gerätekontext, Idempotenz-ID und Expected-Version.
- Persistenz und Event Ledger vor Realtime-Broadcast abschließen.
- Keine Telefonnummern, Ticket-Tokens, PINs oder Request-Bodies in Logs.
- Öffentliche Routen strikt von operativen Routen trennen.
- Cloudflare-Adapterschicht darf Domänenregeln nicht neu erfinden.
- Das technische Demo-Kommando ist kein Produktionsworkflow und muss vor Produktivfreigabe ersetzt werden.
