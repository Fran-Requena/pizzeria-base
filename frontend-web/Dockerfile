# ==============================================================================
# DOCKERFILE - FRONTEND WEB (DAW) - Nginx Alpine con Soporte SSL/TLS
# ==============================================================================
FROM nginx:alpine

# Instalar OpenSSL y herramientas necesarias para gestión de certificados
RUN apk add --no-cache openssl bash

# Eliminar la configuración por defecto de Nginx
RUN rm -rf /etc/nginx/conf.d/default.conf

# Copiar la configuración personalizada con reverse proxy y SSL
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Copiar los archivos estáticos de la aplicación
COPY src /usr/share/nginx/html

# Copiar script de arranque con autoconfiguración de certificados SSL
COPY entrypoint.sh /docker-entrypoint.d/99-ssl-init.sh
RUN chmod +x /docker-entrypoint.d/99-ssl-init.sh

# Exponer los puertos estándar HTTP y HTTPS
EXPOSE 80 443

ENTRYPOINT ["/docker-entrypoint.d/99-ssl-init.sh"]
CMD ["nginx", "-g", "daemon off;"]
