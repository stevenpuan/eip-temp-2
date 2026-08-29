-- 讓 PostgREST 能嵌入 profiles ↔ user_roles:新增指向 profiles 的外鍵(與既有指向 auth.users 的並存)
alter table user_roles
  add constraint user_roles_user_profile_fkey
  foreign key (user_id) references profiles(id) on delete cascade;;
