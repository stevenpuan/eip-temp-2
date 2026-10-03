-- 系統開發／設定帳號不出現在公司人員的選人清單（2026-10-03 Steven 指示）
alter table public.app_user
  add column if not exists hide_from_pickers boolean not null default false;
comment on column public.app_user.hide_from_pickers is
  '系統帳號（開發者／設定者）：不列入前端選人清單與人數統計；姓名對照仍保留，歷史紀錄不會變空白';
-- 目前持有「系統設計師」角色（roles.code=admin）的帳號
update public.app_user set hide_from_pickers = true where public.is_admin(id);
