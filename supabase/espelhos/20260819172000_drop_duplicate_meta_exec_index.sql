-- Drop duplicate unique index on meta_execution_config (advisor duplicate_index).

drop index if exists public.uq_meta_exec_config_company;
