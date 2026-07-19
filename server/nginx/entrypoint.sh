#!/bin/bash
cp -f /var/config/nginx.conf /etc/nginx/nginx.conf
cp -f /var/config/app.conf /etc/nginx/app.conf
if [ ! -e /var/cert/server.key ]; then
  cat <<EOF > /var/cert/test_san.txt
subjectAltName = DNS:localhost, IP:127.0.0.1
EOF
  openssl genrsa 4096 > /var/cert/server.key
  openssl req -new -key /var/cert/server.key -subj "/C=JP/ST=XXXX/L=XXXX/O=XXXX/CN=localhost" > /var/cert/server.csr
  openssl x509 -days 365 -req -extfile /var/cert/test_san.txt -signkey /var/cert/server.key < /var/cert/server.csr > /var/cert/server.crt
  rm /var/cert/test_san.txt
  rm /var/cert/server.csr
fi
exec "$@"