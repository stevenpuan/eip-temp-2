-- 「你看得到那個實體，才看得到／才能掛它的連結」。
-- 必須是 SECURITY INVOKER，才會沿用各表自己的 RLS（definer 會整個穿透）。
create or replace function public.eip_url_link_visible(p_entity_type text, p_entity_id uuid)
 returns boolean
 language sql
 stable
 set search_path to 'public'
as $function$
  select case p_entity_type
    when 'task'     then public.eip_can_see_task(p_entity_id)
    when 'work_log' then exists (select 1 from public.work_log  w where w.id = p_entity_id)
    when 'anomaly'  then exists (select 1 from public.eip_anomaly a where a.id = p_entity_id)
    when 'project'  then exists (select 1 from public.project   p where p.id = p_entity_id)
    when 'meeting'  then exists (select 1 from public.meeting   m where m.id = p_entity_id)
    when 'document' then exists (select 1 from public.eip_document d where d.id = p_entity_id)
    else false
  end;
$function$;

revoke all on function public.eip_url_link_visible(text, uuid) from public, anon;
grant execute on function public.eip_url_link_visible(text, uuid) to authenticated, service_role;;
