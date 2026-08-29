-- =====================================================================
-- 0029 EIP 內建 AI 助理:對話/訊息 + 選單(全員)
-- 助理 edge function 用「呼叫者 JWT」查 EIP,天生知道使用者身分、套 RLS。
-- =====================================================================
create table eip_assistant_conversation (
  id         uuid primary key default gen_random_uuid(),
  tenant_id  uuid not null references tenant(id) on delete cascade,
  user_id    uuid not null references app_user(id) on delete cascade,
  title      text,
  created_at timestamptz not null default now()
);
create index idx_asst_conv_user on eip_assistant_conversation(user_id);
alter table eip_assistant_conversation enable row level security;
create policy asst_conv_rw on eip_assistant_conversation
  for all using (tenant_id = current_tenant_id() and user_id = auth.uid())
  with check (tenant_id = current_tenant_id() and user_id = auth.uid());

create table eip_assistant_message (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references eip_assistant_conversation(id) on delete cascade,
  role            text not null,    -- user / assistant
  content         text not null,
  created_at      timestamptz not null default now()
);
create index idx_asst_msg_conv on eip_assistant_message(conversation_id);
alter table eip_assistant_message enable row level security;
create policy asst_msg_rw on eip_assistant_message
  for all using (exists (select 1 from eip_assistant_conversation c
                         where c.id = conversation_id and c.user_id = auth.uid()))
  with check (exists (select 1 from eip_assistant_conversation c
                      where c.id = conversation_id and c.user_id = auth.uid()));

-- 選單:AI 助理(全員可用,放 EIP 平台分組最前)
insert into role_module_permissions (role_id, module_key, can_view, can_create, can_edit, can_delete, can_export)
select r.id, 'eip_assistant', true, true, true, false, false
from roles r
where not exists (select 1 from role_module_permissions p where p.role_id=r.id and p.module_key='eip_assistant');

insert into menus (menu_key, parent_id, title, icon, route, module_key, sort_order, is_active)
select 'eip_assistant', (select id from menus where menu_key='eip_group'),
       'AI 助理', 'Sparkles', '/dashboard/eip/assistant', 'eip_assistant', 100, true
where not exists (select 1 from menus where menu_key='eip_assistant');;
