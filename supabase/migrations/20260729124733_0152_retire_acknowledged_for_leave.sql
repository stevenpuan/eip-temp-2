-- ============================================================
-- 稽核第七輪：把 'acknowledged' 這個值從「請假」身上退場
--
-- 舊制請假要主管核准，acknowledged = 主管已確認。新制（定案第 14 條）
-- 主管不核准、只收通知，這個值已無意義，但正式庫 13 張請假單有 11 張還是它。
-- 後果：新的「我的請假交接」把它當已結案，quick-reports 頁把它當處理中，
-- 同一份資料兩頁講不同的話。只在前端特判會一直漂移，所以從資料層拿掉歧義。
--
-- 實查這 13 張的共同特徵：全部單日假、0 筆代辦、沒有代理人、假期都已結束，
-- 也就是沒有任何未完成的交接，正確狀態是「已結案」。
-- 用 'closed'（沒有代辦、直接結案）而非 'done'（代辦全部完成），
-- 讓兩種結案原因在資料上分得出來。
--
-- 全庫只有 eip_lhi_rollup 提到 acknowledged，且是在註解裡說明「不要用它」，
-- 沒有任何函式會寫入這個值，加約束不會打到現有流程。
-- ============================================================

-- 1) 已結束且沒有代辦的請假 → closed
update public.eip_quick_report qr
   set status = 'closed',
       done_at = coalesce(qr.done_at, qr.leave_to, qr.created_at)
 where qr.type = 'leave'
   and qr.deleted_at is null
   and qr.status in ('acknowledged', 'open')
   and (qr.leave_to at time zone 'Asia/Taipei')::date < (now() at time zone 'Asia/Taipei')::date
   and not exists (select 1 from public.eip_leave_handover_item i
                    where i.quick_report_id = qr.id);

-- 2) 還沒結束、或有代辦的舊 acknowledged → open（交回新制的完成度推導）
update public.eip_quick_report
   set status = 'open'
 where type = 'leave' and deleted_at is null and status = 'acknowledged';

-- 3) 結構性防線：請假不再允許 acknowledged
--    （late／other 保留這個值，那邊「主管已確認」是有意義的）
alter table public.eip_quick_report
  drop constraint if exists eip_quick_report_leave_no_acknowledged;
alter table public.eip_quick_report
  add constraint eip_quick_report_leave_no_acknowledged
  check (not (type = 'leave' and status = 'acknowledged'));

comment on constraint eip_quick_report_leave_no_acknowledged on public.eip_quick_report is
  '請假沒有核准流程（定案第 14 條），status 只會是 open / done / closed。acknowledged 是舊制殘留，0152 退場。';;
