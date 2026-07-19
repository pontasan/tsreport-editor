FROM amazonlinux:2023
# Configuration.
ENV PGDATA=/var/pgdata/data\
    DB_NAME=XXXX\
    DB_PORT=XXXX\
    DB_PASS=XXXX
# Update packages and install dependencies.
# Install util-linux because psql uses more.
RUN yum update -y; \
    yum install glibc-langpack-ja -y; \
    yum install tar gzip shadow-utils -y; \
    yum install make gcc readline-devel zlib-devel libicu-devel flex bison perl -y; \
    yum install procps -y; \
    yum install util-linux -y; \
    yum install git -y; \
    curl https://ftp.postgresql.org/pub/source/v17.2/postgresql-17.2.tar.gz --output /var/postgresql.tar.gz; \
    yum clean all; \
    rm -rf /var/cache/yum
# Configure locale.
ENV LANG=ja_JP.utf8
# Configure timezone.
RUN rm -f /etc/localtime; \
    ln -fs /usr/share/zoneinfo/Asia/Tokyo /etc/localtime
# 1. Compile and install PostgreSQL.
#    https://www.postgresql.org/docs/17/install-make.html#INSTALL-PROCEDURE-MAKE
# 2. Install pg_bigm and remove build artifacts.
RUN tar zxvf /var/postgresql.tar.gz -C /var/; \
    cd /var/postgresql-17.2; \
    ./configure; \
    make; \
    make install; \
    git clone https://github.com/pgbigm/pg_bigm.git; \
    cd pg_bigm; \
    make USE_PGXS=1 PG_CONFIG=/usr/local/pgsql/bin/pg_config; \
    make USE_PGXS=1 PG_CONFIG=/usr/local/pgsql/bin/pg_config install; \
    rm /var/postgresql.tar.gz; \
    rm -rf /var/postgresql-17.2
# Perl is required only for builds with PostgreSQL 17 or later.
# Remove it after the build because it is no longer required.
RUN yum remove -y perl
# Create the postgres group and user.
RUN groupadd -g 54321 postgres; \
    useradd -u 54321 -g 54321 postgres
RUN echo 'postgres:${DB_PASS}' | chpasswd
# Add PostgreSQL command paths to PATH.
ENV PATH $PATH:/usr/local/pgsql/bin
# Script directory.
RUN mkdir /scripts; \
    chmod 755 /scripts
# Copy scripts and update permissions.
COPY ./entrypoint.sh /scripts/
RUN chmod 755 /scripts/*.sh
# Expose the port required by this container.
EXPOSE 5432
# Runtime user inside the container.
USER postgres:postgres
# Entrypoint.
ENTRYPOINT ["/scripts/entrypoint.sh"]
# Default container command.
CMD ["postgres"]
