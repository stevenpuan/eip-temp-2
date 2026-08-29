-- 收斂 eip_qr_set_department（BEFORE INSERT trigger 函式）的 REST 暴露。
-- trigger 觸發不依賴 EXECUTE 權限，故 revoke 後 trigger 照常運作，只關掉 anon/public 的 RPC 入口。
revoke execute on function public.eip_qr_set_department() from public, anon;;
