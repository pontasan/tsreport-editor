FROM amazonlinux:2023
# Update packages and install dependencies.
RUN yum update -y; \
    yum install glibc-langpack-ja -y; \
    yum install openssl -y; \
    yum install -y shadow-utils -y; \
    yum install procps -y; \
    yum install nginx -y; \
    yum clean all; \
    rm -rf /var/cache/yum
# Configure locale.
ENV LANG=ja_JP.utf8
# Configure timezone.
RUN rm -f /etc/localtime; \
    ln -fs /usr/share/zoneinfo/Asia/Tokyo /etc/localtime
# Script directory.
RUN mkdir /scripts ; \
    chmod 755 /scripts
# Copy scripts and update permissions.
COPY ./entrypoint.sh /scripts/
RUN chmod 755 /scripts/*.sh
# Entrypoint.
ENTRYPOINT ["/scripts/entrypoint.sh"]
# Default container command.
CMD ["nginx", "-g", "daemon off;"]