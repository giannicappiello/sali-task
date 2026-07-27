<?php
declare(strict_types=1);

return [
    // URL pubblico del Workspace, senza slash finale.
    'workspace_url' => 'https://workspace.progre.it',

    // Generare un valore casuale lungo e configurare lo stesso WORKER_SECRET su Vercel.
    'worker_secret' => '',

    // Il mittente deve appartenere al dominio ospitato su Aruba.
    'from_email' => '',
    'from_name' => 'Progre Workspace',

    // Sicurezza: lasciare false durante installazione e prova.
    'queue_enabled' => false,
    'test_enabled' => true,
    'test_recipient' => '',

    // Numero massimo di email reali elaborate da una singola esecuzione.
    'max_jobs_per_run' => 10,
];
