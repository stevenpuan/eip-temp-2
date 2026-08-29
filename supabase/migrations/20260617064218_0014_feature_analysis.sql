-- =====================================================================
-- 0014_feature_analysis — 需求許願池的「AI 可行性分析」結果表
-- 綁需求,可重複分析留歷程。先不鎖角色權限(僅 tenant 隔離),讓用戶先看功能。
-- 工作量以「點數」估(1 點=多少成本由內部定義)。
-- =====================================================================

create table eip_feature_analysis (
  id                 uuid primary key default gen_random_uuid(),
  tenant_id          uuid not null references tenant(id) on delete cascade,
  feature_request_id uuid not null references eip_feature_request(id) on delete cascade,
  feasibility        text,        -- high / medium / low
  complexity         text,        -- low / medium / high
  confidence         int,         -- 0-100,AI 對自身判斷的把握
  relevance          int,         -- 0-100,與平台目標/既有功能關聯度
  estimated_points   int,         -- 預估工作量(點數,越大越多工)
  recommendation     text,        -- execute / evaluate / hold / reject
  reason             text,        -- 評估理由
  approach           text,        -- 建議做法
  risks              text,        -- 風險/注意事項
  similar_notes      text,        -- 重複/相似提醒
  dev_brief          text,        -- 開發交辦摘要(決定執行後可交給 Claude Code)
  model              text,
  raw                jsonb,       -- 模型完整輸出
  created_by         uuid references app_user(id),
  created_at         timestamptz not null default now()
);
create index idx_fa_request on eip_feature_analysis(feature_request_id);
create index idx_fa_tenant  on eip_feature_analysis(tenant_id);

alter table eip_feature_analysis enable row level security;
-- 先不鎖角色:同租戶登入者皆可讀/寫(之後要改「僅管理者看」一行就改)
create policy fa_read on eip_feature_analysis
  for select using (tenant_id = current_tenant_id());
create policy fa_insert on eip_feature_analysis
  for insert with check (tenant_id = current_tenant_id());;
