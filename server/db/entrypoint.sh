#!/bin/bash
if [ -e ${PGDATA} ]; then
echo 'skipped initdb'
else
initdb --encoding=UTF-8 --locale=ja_JP.UTF-8 -D ${PGDATA}
cat <<EOF >> ${PGDATA}/postgresql.conf
port = ${DB_PORT}
listen_addresses = '*'
# max_worker_processes = 4
# max_parallel_workers_per_gather = 2
# log_min_duration_statement = 0
deadlock_timeout = 10000ms
shared_preload_libraries = 'pg_bigm'
EOF
cat <<EOF > ${PGDATA}/pg_hba.conf
local   all         all                               trust
host    all         all         0.0.0.0/0             md5
host    all         all         ::1/128               md5
EOF
pg_ctl start -D ${PGDATA}
psql -U postgres -p ${DB_PORT} <<-EOSQL
    alter user postgres with encrypted password '${DB_PASS}';
EOSQL
psql -U postgres -p ${DB_PORT} <<-EOSQL
    CREATE DATABASE "${DB_NAME}" owner postgres ENCODING 'UTF8' LC_COLLATE='ja_JP.UTF8' LC_CTYPE='ja_JP.UTF8' TEMPLATE=template0;
    CREATE EXTENSION pg_bigm;
EOSQL
psql -U postgres -p 15432 ${DB_NAME} -f /var/ddl/data_model_ddl.sql
# Seed data (accounts, API client, sample workspace, published tag) is created
# by the application itself on first boot (instrumentation.ts -> SystemInitLogic).
pg_ctl stop -D ${PGDATA}
fi
# Additional runtime configuration.
cat <<EOF >> ${PGDATA}/postgresql.conf
EOF
exec "$@"