FROM amazonlinux:2023
# Update packages and install dependencies.
RUN yum update -y; \
    yum install glibc-langpack-ja -y; \
    yum install glibc-langpack-en -y; \
    yum install -y shadow-utils -y; \
    yum install procps -y; \
    yum install tar -y; \
    yum install gzip -y; \
    yum install zip -y; \
    yum install unzip -y; \
    yum clean all; \
    rm -rf /var/cache/yum
# Create the node group and user.
RUN groupadd --gid 1000 node \
    && useradd --uid 1000 --gid node --shell /bin/bash --create-home node
RUN mkdir -p /var/node/node_modules \
    && chown -R node:node /var/node \
    && ln -s /var/node /var/src
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
USER node
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
    . ~/.nvm/nvm.sh && \
    nvm install --lts && \
    npm install -g npm && \
    npm install -g pm2
# Entrypoint.
ENTRYPOINT ["/scripts/entrypoint.sh"]
# Default container command.
CMD ["node"]
