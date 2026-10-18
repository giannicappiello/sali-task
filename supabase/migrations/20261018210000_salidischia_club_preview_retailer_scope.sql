begin;
-- Admin preview is read-only and remains usable before public enrollment opens.
create or replace function public.club_admin_retailer_lookup(vat_number text) returns jsonb language plpgsql stable security definer set search_path=public as $$
declare vat text;codes text[];customer jsonb;email text;begin
 perform club_require_staff('negozi');
 vat:=regexp_replace(upper(coalesce(vat_number,'')),'[^A-Z0-9]','','g');vat:=regexp_replace(vat,'^IT','');
 if length(coalesce(vat_number,''))>32 or vat !~ '^[0-9]{11}$' then raise exception 'Inserisci una partita IVA italiana di 11 cifre.';end if;
 select array_agg(c.codice_cliente) into codes from ordini_clienti_cache c
 where regexp_replace(regexp_replace(upper(coalesce(c.partita_iva,'')),'[^A-Z0-9]','','g'),'^IT','')=vat and club_retailer_customer(c.codice_cliente) is not null
 and c.codice_cliente in(select club_staff_store_codes());
 if coalesce(cardinality(codes),0)<>1 then raise exception 'Partita IVA non riconosciuta in modo univoco tra i rivenditori attivi. Contatta il backoffice.';end if;
 customer:=club_retailer_customer(codes[1]);email:=customer->>'email';
 if coalesce(email,'') !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' then raise exception 'Per questa anagrafica manca un’email valida. Contatta il backoffice per aggiornarla.';end if;
 return (customer-'email'-'store_code')||jsonb_build_object('masked_email',left(email,1)||repeat('.',length(split_part(email,'@',1))-1)||substring(email from position('@' in email)));
end $$;
revoke all on function public.club_admin_retailer_lookup(text) from public,anon,authenticated;
grant execute on function public.club_admin_retailer_lookup(text) to authenticated;
commit;

