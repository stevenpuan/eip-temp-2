-- 部門主管查「管轄範圍外」的某個人的績效時，原本不會報錯，
-- 而是靠 CTE 的 where 把那個人濾掉 → 回 0 列。
-- 畫面上就變成「這個人本期沒有任何資料」，跟真的沒資料長得一樣。
-- 這正是這次客訴的同一類問題（看起來正常，其實是權限）。改成 fail-closed。
--
-- 用字串改寫既有定義而不是整支重貼，是為了不動到那支函式其餘幾十行統計邏輯。
-- 末端有 assert 確認替換真的發生，沒發生就整筆 migration 失敗。

do $$
declare
  v_sig text := 'public.eip_performance_summary(date,date,uuid,uuid)';
  v_def text;
  v_old text := 'elsif p_user_id <> v_me then raise exception ''權限不足：只能查看自己的績效''; end if;
  end if;';
  v_new text := 'elsif p_user_id <> v_me then raise exception ''權限不足：只能查看自己的績效''; end if;
  else
    -- 0151：主管指定了查詢對象時，先確認那個人在管轄範圍內。
    -- 原本沒有這段，範圍外的人只是被下面的 where 濾掉、回 0 列，
    -- 畫面會顯示成「本期沒有資料」而不是「沒有權限」。
    if p_user_id is not null and p_user_id <> v_me
       and v_role <> ''company_admin''
       and not exists (
         select 1 from public.app_user a
          where a.id = p_user_id
            and a.department_id is not null
            and public.eip_user_can_scope_dept(a.department_id))
    then
      raise exception ''權限不足：這位同仁不在你的管轄範圍內'';
    end if;
    if p_department_id is not null
       and v_role <> ''company_admin''
       and not public.eip_user_can_scope_dept(p_department_id)
    then
      raise exception ''權限不足：這個部門不在你的管轄範圍內'';
    end if;
  end if;';
begin
  v_def := pg_get_functiondef(v_sig::regprocedure);
  if position(v_old in v_def) = 0 then
    raise exception '找不到要替換的守衛片段，eip_performance_summary 的內容跟預期不同，請人工檢查';
  end if;
  v_def := replace(v_def, v_old, v_new);
  execute v_def;
end $$;

-- CREATE OR REPLACE 會重設 ACL，收回來
revoke all on function public.eip_performance_summary(date,date,uuid,uuid) from public, anon;
grant execute on function public.eip_performance_summary(date,date,uuid,uuid) to authenticated;;
