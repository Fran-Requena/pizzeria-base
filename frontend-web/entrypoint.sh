#!/bin/sh
set -e

# Crear directorio de certificados SSL si no existe
mkdir -p /etc/ssl/certs /etc/ssl/private

# Buscar si existen certificados oficiales de Let's Encrypt montados desde el host
LE_CERT=$(find /etc/letsencrypt/live -name fullchain.pem 2>/dev/null | head -n 1)
LE_KEY=$(find /etc/letsencrypt/live -name privkey.pem 2>/dev/null | head -n 1)

if [ -n "$LE_CERT" ] && [ -n "$LE_KEY" ]; then
    echo "============================================================"
    echo " [SSL] Certificados oficiales Let's Encrypt detectados:"
    echo "   Cert: $LE_CERT"
    echo "   Key:  $LE_KEY"
    echo "============================================================"
    cp -L "$LE_CERT" /etc/ssl/certs/pizzeria.crt
    cp -L "$LE_KEY" /etc/ssl/private/pizzeria.key
else
    echo "============================================================"
    echo " [SSL] Sin Let's Encrypt montado. Generando certificado"
    echo "       autofirmado TLS para desarrollo y pruebas..."
    echo "============================================================"
    openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
        -keyout /etc/ssl/private/pizzeria.key \
        -out /etc/ssl/certs/pizzeria.crt \
        -subj "/C=ES/ST=Alicante/L=Novelda/O=IESLaMola/CN=localhost" 2>/dev/null
fi

chmod 600 /etc/ssl/private/pizzeria.key
chmod 644 /etc/ssl/certs/pizzeria.crt

exec "$@"
