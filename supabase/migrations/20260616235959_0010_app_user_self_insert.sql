-- 允許登入者建立「自己的」app_user profile(id 必須等於自己的 auth uid,且只能是 member,防止自我升權)
create policy app_user_self_insert on app_user
  for insert
  with check (id = auth.uid() and role = 'member');;
