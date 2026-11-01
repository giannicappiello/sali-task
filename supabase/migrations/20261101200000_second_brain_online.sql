create table public.second_brain_connections (
 id uuid primary key, user_id uuid not null references public.utenti(id),auth_user_id uuid not null,
 client_id text not null,session_sealed text not null,session_expires_at timestamptz not null,
 created_at timestamptz not null default now(),expires_at timestamptz not null default now()+interval '30 days',revoked_at timestamptz,
 refresh_lock uuid,refresh_lock_until timestamptz
);
create table public.second_brain_oauth_codes (
 hash text primary key,connection_id uuid not null references public.second_brain_connections(id) on delete cascade,
 challenge text not null,redirect_uri text not null,resource text not null,
 expires_at timestamptz not null default now()+interval '2 minutes',consumed_at timestamptz
);
create table public.second_brain_oauth_tokens (
 hash text primary key,connection_id uuid not null references public.second_brain_connections(id) on delete cascade,
 kind text not null check(kind in ('access','refresh')),expires_at timestamptz not null,consumed_at timestamptz
);
create index on public.second_brain_oauth_tokens(connection_id);
create index on public.second_brain_connections(user_id);
alter table public.second_brain_connections enable row level security;
alter table public.second_brain_oauth_codes enable row level security;
alter table public.second_brain_oauth_tokens enable row level security;
revoke all on public.second_brain_connections,public.second_brain_oauth_codes,public.second_brain_oauth_tokens from public,anon,authenticated;
grant all on public.second_brain_connections,public.second_brain_oauth_codes,public.second_brain_oauth_tokens to service_role;

create function public.second_brain_exchange_oauth(p_grant text,p_hash text,p_client text,p_redirect text,p_challenge text,p_resource text,p_access_hash text,p_refresh_hash text)
returns uuid language plpgsql security definer set search_path=public as $$
declare v_connection uuid;c second_brain_connections;code second_brain_oauth_codes;tok second_brain_oauth_tokens;
begin
 if p_resource<>'https://workspace.progre.it/api/second-brain/mcp' then raise exception 'invalid_target'; end if;
 if p_grant='authorization_code' then
  select * into code from second_brain_oauth_codes where hash=p_hash for update;
  if not found or code.consumed_at is not null or code.expires_at<now() or code.redirect_uri<>p_redirect or code.challenge<>p_challenge or code.resource<>p_resource then raise exception 'invalid_grant'; end if;
  v_connection:=code.connection_id;
 elsif p_grant='refresh_token' then
  select * into tok from second_brain_oauth_tokens where hash=p_hash and kind='refresh' for update;
  if not found or tok.consumed_at is not null or tok.expires_at<now() then raise exception 'invalid_grant'; end if;
  v_connection:=tok.connection_id;
 else raise exception 'unsupported_grant_type'; end if;
 select * into c from second_brain_connections where id=v_connection for update;
 if not found or c.revoked_at is not null or c.expires_at<now() or c.client_id<>p_client then raise exception 'invalid_grant'; end if;
 if p_grant='authorization_code' then update second_brain_oauth_codes set consumed_at=now() where hash=p_hash;
 else update second_brain_oauth_tokens set consumed_at=now() where hash=p_hash; end if;
 insert into second_brain_oauth_tokens(hash,connection_id,kind,expires_at) values(p_access_hash,c.id,'access',least(now()+interval '15 minutes',c.expires_at)),(p_refresh_hash,c.id,'refresh',c.expires_at);
 return c.id;
end;$$;
revoke all on function public.second_brain_exchange_oauth(text,text,text,text,text,text,text,text) from public,anon,authenticated;
grant execute on function public.second_brain_exchange_oauth(text,text,text,text,text,text,text,text) to service_role;
