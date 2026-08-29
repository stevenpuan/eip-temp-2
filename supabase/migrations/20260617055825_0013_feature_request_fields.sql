-- 需求許願池:補上參考設計需要的欄位
alter table eip_feature_request
  add column scope        text,          -- 應用範圍:前台/後台/全站...
  add column request_type text,          -- 需求類型:新增功能/修改功能/修正問題/其他
  add column completed_at  timestamptz;  -- 完成時間(用於「處理時長」統計)

-- 狀態改 6 段:pending 待處理 / evaluating 評估中 / preparing 準備中 /
--             in_progress 進行中 / done 已完成 / rejected 不採用
alter table eip_feature_request alter column status set default 'pending';;
