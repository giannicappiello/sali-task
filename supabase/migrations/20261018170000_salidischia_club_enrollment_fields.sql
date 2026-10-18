begin;
alter table public.club_members add column first_name text,add column last_name text;
-- Keep the previous enrollment implementation private; cached clients cannot
-- bypass the new identity fields and explicit profiling choice.
alter function public.club_enroll_member(text,text,boolean,boolean,boolean,text,text) rename to club_enroll_member_v1;
revoke all on function public.club_enroll_member_v1(text,text,boolean,boolean,boolean,text,text) from public,anon,authenticated;
create function public.club_enrollment_identity() returns jsonb language plpgsql stable security definer set search_path=public as $$
declare identity uuid;begin
 identity:=public.club_verified_identity();
 return(select jsonb_build_object('email',email,'first_name',coalesce(raw_user_meta_data->>'first_name',''),'last_name',coalesce(raw_user_meta_data->>'last_name','')) from auth.users where id=identity);
end $$;
create function public.club_enroll_member(first_name text,last_name text,email_address text,phone_number text,accept_program boolean,profiling boolean,expected_terms_url text,expected_privacy_url text)
returns uuid language plpgsql security definer set search_path=public as $$
declare identity uuid;verified_email text;enrolled_id uuid;given_name text;family_name text;begin
 identity:=public.club_verified_identity();given_name:=btrim(coalesce(first_name,''));family_name:=btrim(coalesce(last_name,''));
 perform pg_advisory_xact_lock(hashtext(identity::text));
 if length(given_name) not between 1 and 100 or length(family_name) not between 1 and 100 or length(given_name||' '||family_name)>200 then raise exception 'Inserisci nome e cognome nei due campi.';end if;
 select email into verified_email from auth.users where id=identity;
 if email_address is null or length(btrim(email_address)) not between 3 and 254 or position('@' in email_address)<2 or lower(btrim(email_address)) is distinct from lower(btrim(verified_email)) then raise exception 'Inserisci l’indirizzo email verificato del tuo account Club.';end if;
 if accept_program is distinct from true then raise exception 'Leggi e accetta le condizioni del programma.';end if;
 if profiling is distinct from true then raise exception 'Per continuare, seleziona il consenso alla profilazione per proposte personalizzate.';end if;
 enrolled_id:=public.club_enroll_member_v1(given_name||' '||family_name,phone_number,accept_program,false,profiling,expected_terms_url,expected_privacy_url);
 -- A retried enrollment must not overwrite an existing member's profile.
 update public.club_members m set first_name=given_name,last_name=family_name where m.id=enrolled_id and m.first_name is null and m.last_name is null;
 if found then
  update public.crm_accounts a set metadati=coalesce(a.metadati,'{}'::jsonb)||jsonb_build_object('club_first_name',given_name,'club_last_name',family_name)
  from public.club_members m where m.id=enrolled_id and a.id=m.crm_account_id;
 end if;
 return enrolled_id;
end $$;
revoke all on function public.club_enrollment_identity(),public.club_enroll_member(text,text,text,text,boolean,boolean,text,text) from public,anon,authenticated;
grant execute on function public.club_enrollment_identity(),public.club_enroll_member(text,text,text,text,boolean,boolean,text,text) to authenticated;
do $$declare original text;revised text;begin
 select pg_get_functiondef('public.club_api_boundary()'::regprocedure) into original;
 revised:=replace(original,'''/rpc/club_enroll_member''','''/rpc/club_enroll_member'',''/rpc/club_enrollment_identity''');
 if revised=original then raise exception 'Unexpected Club API boundary.';end if;execute revised;
end $$;
notify pgrst,'reload schema';
commit;
