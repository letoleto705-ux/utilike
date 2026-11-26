-- UTI LIKE — SOMENTE LEITURA. Não exclui nem modifica nenhum dado.
-- Verifique também no painel Neon o recurso que chegou a 85%: storage,
-- compute, transferência, histórico de recuperação ou outro limite do plano.
SELECT current_database() AS banco,
       pg_size_pretty(pg_database_size(current_database())) AS tamanho_aproximado;
SELECT n.nspname AS esquema, c.relname AS tabela,
       pg_size_pretty(pg_relation_size(c.oid)) AS dados,
       pg_size_pretty(pg_indexes_size(c.oid)) AS indices,
       pg_size_pretty(pg_total_relation_size(c.oid)) AS total,
       pg_total_relation_size(c.oid) AS total_bytes
FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
WHERE c.relkind IN ('r','m') AND n.nspname NOT IN ('pg_catalog','information_schema')
ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 40;
SELECT schemaname, tablename, n_live_tup AS linhas_estimadas,
       n_dead_tup AS linhas_mortas_estimadas,
       last_autovacuum, last_autoanalyze
FROM pg_stat_user_tables ORDER BY n_dead_tup DESC LIMIT 40;
