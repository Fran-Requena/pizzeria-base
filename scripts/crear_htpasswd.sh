#!/usr/bin/env bash
# ==============================================================================
# CREAR EL .htpasswd QUE PROTEGE /dbgate/ (HTTP Basic Auth de Nginx)
# ==============================================================================
# Uso (desde la raiz del proyecto, ANTES del 'docker compose up'):
#   bash scripts/crear_htpasswd.sh                 # usuario admin, clave de laboratorio
#   bash scripts/crear_htpasswd.sh 'OtraClave_1!'  # otra clave (entre comillas simples)
#
# Clave de laboratorio por defecto: PizzeriaAdmin_2026! (solo para aprendizaje; en
# produccion real se elegiria otra). Quien use otra clave es responsable de recordarla.
#
# Al ser un script, el "!" de la clave no lo interpreta el bash interactivo. La clave
# se pasa por stdin a openssl, asi que no aparece en la lista de procesos.
# ==============================================================================

set -euo pipefail

CLAVE="${1:-PizzeriaAdmin_2026!}"

if ! command -v openssl >/dev/null 2>&1; then
  echo "Hace falta openssl (viene instalado en Ubuntu Server)." >&2
  exit 1
fi

# Si Docker ya creo una carpeta .htpasswd (por arrancar antes de tiempo), se retira si esta vacia.
if [ -d .htpasswd ]; then
  rmdir .htpasswd 2>/dev/null || { echo ".htpasswd es una carpeta no vacia. Revisala y borrala a mano." >&2; exit 1; }
fi

printf 'admin:%s\n' "$(printf '%s' "$CLAVE" | openssl passwd -apr1 -stdin)" > .htpasswd
# Nginx (usuario 'nginx' dentro del contenedor) necesita poder leer el archivo.
chmod 644 .htpasswd
echo "Listo: .htpasswd creado para el usuario admin."
