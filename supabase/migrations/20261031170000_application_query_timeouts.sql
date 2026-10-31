begin;
set local lock_timeout='5s';
-- All Data API roles use the maximum supported Supabase API query duration.
alter role anon set statement_timeout='60s';
alter role authenticated set statement_timeout='60s';
alter role authenticator set statement_timeout='60s';
alter role authenticator set lock_timeout='60s';
alter role service_role set statement_timeout='60s';
notify pgrst, 'reload config';
commit;
