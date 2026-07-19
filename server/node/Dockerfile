FROM amazonlinux:2023 AS runtime
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
RUN mkdir -p /var/node \
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
COPY server/node/entrypoint.sh /scripts/
RUN chmod 755 /scripts/*.sh
USER node
ARG TSREPORT_NODE_VERSION=24.11.0
ARG TSREPORT_NPM_VERSION=11.18.0
ARG TSREPORT_PM2_VERSION=7.0.3
RUN curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.3/install.sh | bash && \
    . ~/.nvm/nvm.sh && \
    nvm install "${TSREPORT_NODE_VERSION}" && \
    nvm alias default "${TSREPORT_NODE_VERSION}" && \
    npm install -g "npm@${TSREPORT_NPM_VERSION}" && \
    npm install -g "pm2@${TSREPORT_PM2_VERSION}" && \
    ln -s "$(dirname "$(command -v node)")" ~/.nvm/current
ENV PATH="/home/node/.nvm/current:${PATH}"
# Entrypoint.
ENTRYPOINT ["/scripts/entrypoint.sh"]
# Default container command.
CMD ["node"]

FROM runtime AS development

ARG APP_SOURCE=src

WORKDIR /var/node

COPY --chown=node:node ${APP_SOURCE}/package.json ${APP_SOURCE}/package-lock.json ./
RUN . ~/.nvm/nvm.sh && npm ci

COPY --chown=node:node ${APP_SOURCE}/ ./
