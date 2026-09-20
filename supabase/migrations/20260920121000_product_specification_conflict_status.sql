-- Business conflicts must not be retried as PostgreSQL serialization failures.
-- PT409 gives PostgREST an immediate HTTP 409 and preserves the existing revision.
create or replace function public.save_workspace_product_specification(
  p_article_code text, p_expected_version integer, p_data jsonb, p_attachments jsonb,
  p_user_id uuid, p_user_label text
) returns jsonb language plpgsql security definer set search_path = public as $$
declare saved public.workspace_product_specifications;
begin
  if p_expected_version = 0 then
    insert into workspace_product_specifications(article_code, version, data, attachments, updated_by, updated_by_label)
    values(p_article_code, 1, p_data, p_attachments, p_user_id, p_user_label)
    on conflict (article_code) do nothing returning * into saved;
  else
    update workspace_product_specifications
    set version = version + 1, data = p_data, attachments = p_attachments,
        updated_at = now(), updated_by = p_user_id, updated_by_label = p_user_label
    where article_code = p_article_code and version = p_expected_version
    returning * into saved;
  end if;
  if saved.article_code is null then
    raise exception 'Capitolato modificato da un altro utente' using errcode = 'PT409';
  end if;
  insert into workspace_product_specification_revisions
    (article_code, version, data, attachments, updated_at, updated_by, updated_by_label)
    values(saved.article_code, saved.version, saved.data, saved.attachments,
      saved.updated_at, saved.updated_by, saved.updated_by_label);
  return to_jsonb(saved);
end $$;
