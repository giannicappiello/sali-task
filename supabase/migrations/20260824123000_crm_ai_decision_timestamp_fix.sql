begin;

create or replace function public.crm_set_decision_updated_at()
returns trigger language plpgsql set search_path=public as $$
begin
  new.aggiornata_il=now();
  return new;
end $$;

drop trigger if exists trg_crm_ai_decisions_updated on public.crm_ai_decisions;
create trigger trg_crm_ai_decisions_updated
before update on public.crm_ai_decisions
for each row execute function public.crm_set_decision_updated_at();

commit;
