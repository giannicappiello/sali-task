begin;
-- A non-economic flag is needed for the same breakdown in personal/admin exports.
-- Existing employee scope and the exclusion of contract/payroll data stay intact.
do $flag$
declare original text; updated text;
begin
 original:=pg_get_functiondef('public.workspace_hr_snapshot(date,boolean)'::regprocedure);
 updated:=replace(original,'''break_minutes'',c.break_minutes)',
  '''break_minutes'',c.break_minutes,''overtime_separate'',c.overtime_separate)');
 if updated=original then raise exception 'Unexpected HR presence schedule contract'; end if;
 execute updated;
end $flag$;
notify pgrst,'reload schema';
commit;
