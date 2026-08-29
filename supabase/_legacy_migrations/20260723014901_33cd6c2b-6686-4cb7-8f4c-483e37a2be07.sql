
create or replace function public.eip_notify_meeting_invited()
returns trigger language plpgsql security definer set search_path=public as $$
declare v_m public.meeting; v_setting public.notification_setting; v_msg text; v_when text;
begin
  select * into v_m from public.meeting where id = NEW.meeting_id;
  if v_m.id is null then return NEW; end if;

  select * into v_setting
  from public.notification_setting s
  where s.tenant_id = v_m.tenant_id
    and s.event_code = 'meeting_invited'
    and s.is_active
    and (s.department_id = v_m.department_id or s.department_id is null)
  order by (s.department_id is not null) desc
  limit 1;
  if not found or not v_setting.in_app_enabled then return NEW; end if;

  if NEW.user_id = coalesce(v_m.created_by, '00000000-0000-0000-0000-000000000000'::uuid) then
    return NEW;
  end if;

  v_when := coalesce(to_char(v_m.meeting_date, 'MM/DD'), '');
  v_msg := '【會議邀請】' || coalesce(v_m.title,'') ||
           case when v_when <> '' then '（' || v_when || '）' else '' end;

  insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message, line_pending)
  select v_m.tenant_id, NEW.user_id, 'assigned'::notification_type,
         'meeting'::notification_entity, v_m.id, v_msg, coalesce(v_setting.line_enabled,false)
  where not exists (
    select 1 from public.notification n
    where n.user_id = NEW.user_id and n.entity_id = v_m.id
      and n.entity_type = 'meeting'::notification_entity
      and n.type = 'assigned'::notification_type
  );
  return NEW;
end$$;

drop trigger if exists trg_meeting_attendee_notify on public.meeting_attendee;
create trigger trg_meeting_attendee_notify
after insert on public.meeting_attendee
for each row execute function public.eip_notify_meeting_invited();

do $$
declare rec record; v_setting public.notification_setting; v_msg text; v_when text;
begin
  for rec in
    select ma.meeting_id, ma.user_id, m.tenant_id, m.department_id, m.title, m.meeting_date, m.created_by
    from public.meeting_attendee ma
    join public.meeting m on m.id = ma.meeting_id
    where not exists (
      select 1 from public.notification n
      where n.user_id = ma.user_id and n.entity_id = m.id
        and n.entity_type = 'meeting'::notification_entity
        and n.type = 'assigned'::notification_type
    )
  loop
    select * into v_setting from public.notification_setting s
    where s.tenant_id = rec.tenant_id and s.event_code = 'meeting_invited' and s.is_active
      and (s.department_id = rec.department_id or s.department_id is null)
    order by (s.department_id is not null) desc limit 1;
    if not found or not v_setting.in_app_enabled then continue; end if;
    if rec.user_id = coalesce(rec.created_by, '00000000-0000-0000-0000-000000000000'::uuid) then continue; end if;

    v_when := coalesce(to_char(rec.meeting_date, 'MM/DD'), '');
    v_msg := '【會議邀請】' || coalesce(rec.title,'') ||
             case when v_when <> '' then '（' || v_when || '）' else '' end;

    insert into public.notification(tenant_id, user_id, type, entity_type, entity_id, message, line_pending)
    values (rec.tenant_id, rec.user_id, 'assigned'::notification_type,
            'meeting'::notification_entity, rec.meeting_id, v_msg, coalesce(v_setting.line_enabled,false));
  end loop;
end$$;
