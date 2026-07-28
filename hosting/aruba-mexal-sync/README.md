# Worker sincronizzazioni Mexal su Aruba

1. Caricare la cartella sul dominio `aps.progre.it`.
2. Copiare `config.example.php` in `config.php`.
3. Inserire lo stesso `WORKER_SECRET` usato dal worker email.
4. Creare un cron PHP ogni 10 minuti verso `worker.php`.

Ogni esecuzione elabora un singolo avanzamento della coda. I processi lunghi
vengono ripresi dal cursore salvato al cron successivo.
