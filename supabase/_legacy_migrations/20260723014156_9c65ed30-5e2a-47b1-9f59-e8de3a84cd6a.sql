
DO $$
declare a public.announcement; v_setting public.notification_setting; v_user_ids uuid[]; v_msg text;
begin
  for a in
    select ann.* from public.announcement ann
    where ann.published_at is not null
      and not exists (
        select 1 from public.notification n
        where n.entity_id = ann.id and n.type = 'announcement'::notification_type
      )
  loop
    select * into v_setting
    from public.notification_setting s
    where s.tenant_id = a.tenant_id
      and s.event_code = 'announcement_published'
      and s.is_active and s.department_id is null
    limit 1;
    if not found or not v_setting.in_app_enabled then continue; end if;

    if a.audience_type = 'all' then
      v_user_ids := array(select id from public.app_user where tenant_id = a.tenant_id and status='active');
    elsif a.audience_type = 'department' then
      v_user_ids := array(
        select u.id from public.app_user u
        join public.announcement_target t on t.department_id = u.department_id
        where t.announcement_id = a.id and u.tenant_id = a.tenant_id and u.status='active');
    elsif a.audience_type = 'users' then
      v_user_ids := array(
        select u.id from public.app_user u
        join public.announcement_target t on t.user_id = u.id
        where t.announcement_id = a.id and u.tenant_id = a.tenant_id and u.status='active');
    else v_user_ids := '{}';
    end if;

    v_msg := '新公告：' || a.title;

    insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message, line_pending)
    select a.tenant_id, uid, 'announcement'::notification_type, 'announcement'::notification_entity,
           a.id, v_msg, coalesce(v_setting.line_enabled, false)
    from unnest(v_user_ids) as uid
    where uid is not null
      and uid <> coalesce(a.created_by, '00000000-0000-0000-0000-000000000000'::uuid);
  end loop;
end$$;
