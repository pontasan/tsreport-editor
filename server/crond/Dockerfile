FROM amazonlinux:2023
# Install the cron daemon (cronie provides crond/crontab). curl is already
# available via the base image's curl-minimal and is used to trigger the batch.
RUN yum update -y; \
    yum install -y cronie; \
    yum clean all; \
    rm -rf /var/cache/yum
# Configure timezone so cron schedules are interpreted in JST.
RUN rm -f /etc/localtime; \
    ln -fs /usr/share/zoneinfo/Asia/Tokyo /etc/localtime
# Script directory.
RUN mkdir /scripts; \
    chmod 755 /scripts
# Copy scripts and update permissions.
COPY ./entrypoint.sh /scripts/
RUN chmod 755 /scripts/*.sh
# Entrypoint installs the mounted crontab, then runs crond in the foreground.
ENTRYPOINT ["/scripts/entrypoint.sh"]
CMD ["crond", "-n"]
