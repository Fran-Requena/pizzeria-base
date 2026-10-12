#!/usr/bin/env bash
# ==============================================================================
# CONECTAR DBGATE A AWS RDS (con SSL) SIN ESCRIBIR LA CLAVE EN LA TERMINAL
# ==============================================================================
# Uso (desde la raiz del proyecto, con el contenedor pizzeria-prod-dbgate en marcha):
#   bash scripts/dbgate_conexion_rds.sh
#
# Lee DB_HOST, DB_PORT, DB_NAME, DB_USER y DB_PASSWORD del archivo .env, genera la
# conexion de DbGate (connections.jsonl) con "useSsl": true y reinicia DbGate.
# La clave nunca pasa por la linea de comandos ni queda en el historial, y los
# caracteres especiales (como "!") no dan problemas.
# ==============================================================================

set -euo pipefail

if [ ! -f .env ]; then
  echo "No se encuentra el archivo .env. Ejecuta este script desde la raiz del proyecto." >&2
  exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
  echo "Hace falta python3 (viene instalado en Ubuntu Server)." >&2
  exit 1
fi

if ! docker inspect -f '{{.State.Running}}' pizzeria-prod-dbgate 2>/dev/null | grep -q true; then
  echo "El contenedor pizzeria-prod-dbgate no esta en marcha. Arrancalo con:" >&2
  echo "  docker compose -f docker-compose.db.yml up -d dbgate" >&2
  exit 1
fi

# El JSON se escribe primero en un archivo temporal privado (solo lectura para tu usuario) y
# se borra al terminar: si algo falla, no se toca la configuracion actual de DbGate.
umask 077
TEMPORAL="$(mktemp)"
trap 'rm -f "$TEMPORAL"' EXIT

# El JSON lo construye Python leyendo el .env: asi se escapan bien las comillas y los
# caracteres especiales de la clave. Si falta algo, termina con un mensaje claro.
python3 - > "$TEMPORAL" <<'PYTHON'
import json
import sys

valores = {}
with open(".env", encoding="utf-8") as archivo:
    for linea in archivo:
        linea = linea.strip()
        if not linea or linea.startswith("#") or "=" not in linea:
            continue
        clave, valor = linea.split("=", 1)
        valores[clave.strip()] = valor.strip().strip('"').strip("'")

servidor = valores.get("DB_HOST", "").rstrip("/")
if not servidor or servidor == "db":
    sys.exit("DB_HOST del .env debe ser el endpoint de RDS (no 'db'). Revisalo y vuelve a ejecutar.")
if not valores.get("DB_PASSWORD"):
    sys.exit("DB_PASSWORD esta vacia en el .env. Revisalo y vuelve a ejecutar.")

conexion = {
    "_id": "pizzeria_rds",
    "engine": "postgres@dbgate-plugin-postgres",
    "server": servidor,
    "port": int(valores.get("DB_PORT") or 5432),
    "user": valores.get("DB_USER", "pizzeria_user"),
    "password": valores["DB_PASSWORD"],
    "defaultDatabase": valores.get("DB_NAME", "pizzeria_db"),
    "displayName": "AWS RDS Bella Napoli",
    "useSsl": True,
}
print(json.dumps(conexion))
PYTHON

docker exec -i pizzeria-prod-dbgate sh -c 'cat > /root/.dbgate/connections.jsonl' < "$TEMPORAL"
docker compose -f docker-compose.db.yml restart dbgate
echo "Listo. Abre /dbgate/ y haz doble clic en 'AWS RDS Bella Napoli'."
