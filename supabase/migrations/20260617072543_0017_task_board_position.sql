-- 看板欄內手動排序用的位置欄位
alter table task add column board_position int not null default 0;

-- 回填:同一狀態欄內依建立時間給間隔位置(留空隙方便日後插入)
with ordered as (
  select id, row_number() over (partition by status_id order by created_at) * 1000 as pos
  from task
)
update task t set board_position = o.pos
from ordered o where o.id = t.id;

create index idx_task_board_pos on task(status_id, board_position);;
