-- Signed-in API requests have a 15s ceiling; anonymous requests retain their existing limit.
alter role authenticated set statement_timeout='15s';
alter role authenticator set statement_timeout='15s';
notify pgrst,'reload config';
