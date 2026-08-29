-- 新增第三種可見範圍：僅參與成員（私密專案）。獨立 migration，先 commit 才能於後續使用。
alter type public.visibility_scope add value if not exists 'members';;
