#!/bin/bash
# ==============================================================================
# AUDITORÍA AUTOMATIZADA Y DIAGNÓSTICO DE CONEXIÓN A AWS RDS
# Proyecto: Pizzería Bella Napoli (IES La Mola)
# ==============================================================================
# Este script analiza la arquitectura completa de 3 capas:
# 1. Configuración de entorno (.env)
# 2. Resolución DNS y Reglas de Seguridad en AWS (Security Groups)
# 3. Estado de Contenedores Docker y variables cargadas en memoria
# 4. Configuración y Cifrado SSL en DbGate
# 5. Diagnóstico de Salud de la API (/api/health) y Base de Datos Lógica
# 6. Estado del Perímetro Cloudflare Zero Trust (Túnel)
# ==============================================================================

set +e

# Colores ANSI para terminal
CLR_RESET="\e[0m"
CLR_BOLD="\e[1m"
CLR_RED="\e[31m"
CLR_GREEN="\e[32m"
CLR_YELLOW="\e[33m"
CLR_BLUE="\e[34m"
CLR_MAGENTA="\e[35m"
CLR_CYAN="\e[36m"

# Contadores de auditoría
ERRORS_COUNT=0
WARNINGS_COUNT=0
PASSED_COUNT=0

print_header() {
    echo -e "${CLR_CYAN}${CLR_BOLD}======================================================================${CLR_RESET}"
    echo -e "${CLR_CYAN}${CLR_BOLD}  🔍 AUDITORÍA DE INFRAESTRUCTURA Y CONEXIÓN A AWS RDS${CLR_RESET}"
    echo -e "${CLR_CYAN}  Pizzería Bella Napoli - Despliegue Cloud-Native de 3 Capas${CLR_RESET}"
    echo -e "${CLR_CYAN}${CLR_BOLD}======================================================================${CLR_RESET}"
    echo ""
}

log_ok() {
    echo -e "  ${CLR_GREEN}✔ [OK]${CLR_RESET} $1"
    PASSED_COUNT=$((PASSED_COUNT + 1))
}

log_warn() {
    echo -e "  ${CLR_YELLOW}⚠ [AVISO]${CLR_RESET} $1"
    WARNINGS_COUNT=$((WARNINGS_COUNT + 1))
}

log_error() {
    echo -e "  ${CLR_RED}✖ [ERROR]${CLR_RESET} $1"
    ERRORS_COUNT=$((ERRORS_COUNT + 1))
}

print_solution_box() {
    local title="$1"
    shift
    echo ""
    echo -e "  ${CLR_YELLOW}${CLR_BOLD}┌─────────────────────────────────────────────────────────────────┐${CLR_RESET}"
    echo -e "  ${CLR_YELLOW}${CLR_BOLD}│ 💡 CÓMO SOLUCIONARLO: $title${CLR_RESET}"
    echo -e "  ${CLR_YELLOW}${CLR_BOLD}├─────────────────────────────────────────────────────────────────┘${CLR_RESET}"
    while [ "$#" -gt 0 ]; do
        echo -e "  ${CLR_YELLOW}│${CLR_RESET} $1"
        shift
    done
    echo -e "  ${CLR_YELLOW}${CLR_BOLD}└─────────────────────────────────────────────────────────────────┘${CLR_RESET}"
    echo ""
}

# ------------------------------------------------------------------------------
# 0. LOCALIZACIÓN DEL PROYECTO Y ARCHIVO .env
# ------------------------------------------------------------------------------
print_header

if [ -f ".env" ]; then
    ENV_PATH=".env"
    PROJECT_DIR="$(pwd)"
elif [ -f "../.env" ]; then
    ENV_PATH="../.env"
    PROJECT_DIR="$(cd .. && pwd)"
elif [ -f "$HOME/pizzeria-base/.env" ]; then
    ENV_PATH="$HOME/pizzeria-base/.env"
    PROJECT_DIR="$HOME/pizzeria-base"
else
    ENV_PATH=""
    PROJECT_DIR="$(pwd)"
fi

echo -e "${CLR_BOLD}[PASO 1/6] Comprobando Archivo de Configuración (.env)...${CLR_RESET}"

if [ -z "$ENV_PATH" ] || [ ! -f "$ENV_PATH" ]; then
    log_error "No se encuentra el archivo .env en el directorio actual ni en ~/pizzeria-base."
    print_solution_box "Crear archivo .env" \
        "1. Asegúrate de estar en la carpeta del proyecto: cd ~/pizzeria-base" \
        "2. Copia la plantilla base: cp .env.example .env" \
        "3. Abre el archivo con 'nano .env' y añade tus credenciales y endpoint de AWS RDS."
    exit 1
fi

log_ok "Archivo .env localizado en: $ENV_PATH"

# Extracción y sanitización de variables (eliminando \r de Windows, espacios y comillas)
DB_HOST=$(grep '^DB_HOST=' "$ENV_PATH" | cut -d '=' -f2- | tr -d '\r"' | tr -d "'" | xargs)
DB_PORT=$(grep '^DB_PORT=' "$ENV_PATH" | cut -d '=' -f2- | tr -d '\r"' | tr -d "'" | xargs)
DB_NAME=$(grep '^DB_NAME=' "$ENV_PATH" | cut -d '=' -f2- | tr -d '\r"' | tr -d "'" | xargs)
DB_USER=$(grep '^DB_USER=' "$ENV_PATH" | cut -d '=' -f2- | tr -d '\r"' | tr -d "'" | xargs)
DB_PASSWORD=$(grep '^DB_PASSWORD=' "$ENV_PATH" | cut -d '=' -f2- | tr -d '\r"' | tr -d "'" | xargs)
CLOUDFLARE_TOKEN=$(grep '^CLOUDFLARE_TUNNEL_TOKEN=' "$ENV_PATH" | cut -d '=' -f2- | tr -d '\r"' | tr -d "'" | xargs)

DB_PORT=${DB_PORT:-5432}
DB_NAME=${DB_NAME:-pizzeria_db}
DB_USER=${DB_USER:-pizzeria_user}

# Validaciones de DB_HOST
if [ -z "$DB_HOST" ]; then
    log_error "La variable DB_HOST está vacía en el archivo .env."
    print_solution_box "Definir DB_HOST" \
        "Edita el archivo .env con 'nano .env' y define tu endpoint de AWS RDS:" \
        "DB_HOST=pizzeria-db.xxxx.us-east-1.rds.amazonaws.com"
elif [ "$DB_HOST" = "db" ] || [ "$DB_HOST" = "localhost" ] || [ "$DB_HOST" = "127.0.0.1" ]; then
    log_error "DB_HOST está configurado como '$DB_HOST' (apunta al contenedor local, no a la nube)."
    print_solution_box "Actualizar DB_HOST a AWS RDS" \
        "1. Entra en la consola de AWS RDS -> Bases de datos -> pizzeria-db." \
        "2. Copia el 'Punto de enlace' (Endpoint)." \
        "3. Edita .env con 'nano .env' y sustituye DB_HOST=db por tu endpoint."
elif [[ "$DB_HOST" == *"/"* ]]; then
    log_error "El endpoint contiene una barra '/' al final ($DB_HOST)."
    print_solution_box "Corregir formato de Endpoint" \
        "Los nombres de host DNS nunca llevan barra final ni protocolo http/https." \
        "Abre el archivo .env con 'nano .env' y borra la '/' del final de DB_HOST."
else
    log_ok "DB_HOST configurado correctamente: ${CLR_CYAN}$DB_HOST${CLR_RESET}"
    log_ok "Base de datos destino: ${CLR_CYAN}$DB_NAME${CLR_RESET} | Usuario: ${CLR_CYAN}$DB_USER${CLR_RESET} | Puerto: ${CLR_CYAN}$DB_PORT${CLR_RESET}"
fi

echo ""

# ------------------------------------------------------------------------------
# 2. RESOLUCIÓN DNS Y RED EN AWS (SECURITY GROUPS & ESTADO DE RDS)
# ------------------------------------------------------------------------------
echo -e "${CLR_BOLD}[PASO 2/6] Comprobando Resolución DNS y Red AWS (Security Groups)...${CLR_RESET}"

# Prueba 2.1: Resolución DNS
DNS_RESOLVED=false
if getent hosts "$DB_HOST" >/dev/null 2>&1; then
    RDS_IP=$(getent hosts "$DB_HOST" | awk '{ print $1 }' | head -n 1)
    log_ok "Resolución DNS correcta: $DB_HOST -> IP Privada AWS: ${CLR_CYAN}$RDS_IP${CLR_RESET}"
    DNS_RESOLVED=true
else
    log_error "Fallo de resolución DNS para el host: '$DB_HOST'."
    print_solution_box "Endpoint Incorrecto o Instancia Inexistente" \
        "1. Comprueba si has copiado el endpoint completo sin faltar letras ni añadir espacios." \
        "2. Verifica en la consola de AWS RDS que la base de datos realmente existe y no fue eliminada." \
        "3. Asegúrate de estar en la región correcta de AWS (ej. N. Virginia us-east-1)."
fi

# Prueba 2.2: Conectividad TCP al puerto 5432 (Socket nativo Bash con timeout 5s)
if [ "$DNS_RESOLVED" = true ]; then
    echo -e "  ⏳ Probando socket TCP contra $DB_HOST:$DB_PORT (tiempo de espera: 5s)..."
    
    if timeout 5 bash -c "cat < /dev/null > /dev/tcp/$DB_HOST/$DB_PORT" 2>/dev/null; then
        log_ok "Socket TCP conectado con éxito al puerto $DB_PORT en AWS RDS."
    else
        log_error "No se pudo conectar al puerto $DB_PORT tras 5 segundos (TIMEOUT)."
        print_solution_box "Revisar Estado de RDS y Reglas de Security Group" \
            "Esta incidencia se debe a una de las siguientes dos causas:" \
            "" \
            "CAUSA 1: La base de datos está DETENIDA (FinOps)" \
            "  -> Ve a AWS RDS -> Bases de datos." \
            "  -> Si el estado es 'Detenida' (Stopped), selecciónala y pulsa 'Acciones' -> 'Iniciar'." \
            "  -> Espera 2-3 minutos hasta que vuelva a estar 'Disponible'." \
            "" \
            "CAUSA 2: El Security Group de RDS no autoriza a la máquina EC2" \
            "  -> Ve a AWS EC2 -> Grupos de seguridad (Security Groups)." \
            "  -> Localiza el Grupo de Seguridad asignado a tu RDS." \
            "  -> En 'Reglas de entrada' (Inbound rules) -> 'Editar reglas de entrada':" \
            "     1. Asegúrate de que la regla sea de tipo: PostgreSQL (puerto 5432)." \
            "     2. En Origen (Source), selecciona el Grupo de Seguridad de tu EC2." \
            "        (No uses tu IP pública; debe ser el ID del grupo de la EC2, ej: sg-xxxx)." \
            "     3. Haz clic en 'Guardar reglas'."
    fi
fi

echo ""

# ------------------------------------------------------------------------------
# 3. ESTADO DE LOS CONTENEDORES DOCKER
# ------------------------------------------------------------------------------
echo -e "${CLR_BOLD}[PASO 3/6] Comprobando Estado de Contenedores Docker...${CLR_RESET}"

if ! command -v docker >/dev/null 2>&1; then
    log_error "Docker no está instalado o no se encuentra en el PATH."
else
    # Comprobar backend
    BACKEND_STATUS=$(docker inspect --format '{{.State.Status}}' pizzeria-prod-backend 2>/dev/null || echo "not_found")
    if [ "$BACKEND_STATUS" = "running" ]; then
        log_ok "Contenedor 'pizzeria-prod-backend' en ejecución (Up)."
        
        # Comprobar qué DB_HOST tiene cargado en su memoria
        RUNNING_DB_HOST=$(docker inspect pizzeria-prod-backend --format '{{range .Config.Env}}{{println .}}{{end}}' 2>/dev/null | grep '^DB_HOST=' | cut -d '=' -f2-)
        
        if [ "$RUNNING_DB_HOST" = "$DB_HOST" ]; then
            log_ok "El contenedor backend tiene sincronizado el DB_HOST correcto en memoria."
        else
            log_error "Desfase detectado: El contenedor backend tiene cargado DB_HOST='$RUNNING_DB_HOST', pero en .env tienes '$DB_HOST'."
            print_solution_box "Recrear contenedor Backend" \
                "Has editado el archivo .env pero no has recompilado/reiniciado el contenedor." \
                "Ejecuta en tu terminal:" \
                "docker compose -f docker-compose.app.yml up -d --build backend"
        fi
    elif [ "$BACKEND_STATUS" = "restarting" ]; then
        log_error "El contenedor 'pizzeria-prod-backend' está en bucle de reinicio continuo (crasheando)."
    elif [ "$BACKEND_STATUS" = "not_found" ]; then
        log_error "El contenedor 'pizzeria-prod-backend' no existe."
        print_solution_box "Arrancar Contenedores" \
            "Ejecuta el arranque de la capa de aplicación:" \
            "docker compose -f docker-compose.app.yml up -d --build"
    else
        log_error "El contenedor 'pizzeria-prod-backend' está detenido (Estado: $BACKEND_STATUS)."
    fi

    # Comprobar proxy web (Nginx)
    WEB_STATUS=$(docker inspect --format '{{.State.Status}}' pizzeria-prod-web 2>/dev/null || echo "not_found")
    if [ "$WEB_STATUS" = "running" ]; then
        log_ok "Contenedor 'pizzeria-prod-web' (Nginx) en ejecución."
    else
        log_warn "Contenedor 'pizzeria-prod-web' no está en ejecución ($WEB_STATUS)."
    fi

    # Comprobar si el PostgreSQL local antiguo sigue encendido
    LOCAL_DB_STATUS=$(docker inspect --format '{{.State.Status}}' pizzeria-prod-db 2>/dev/null || echo "not_found")
    if [ "$LOCAL_DB_STATUS" = "running" ]; then
        log_warn "El contenedor local antiguo 'pizzeria-prod-db' sigue encendido."
        echo -e "     ${CLR_YELLOW}💡 Recuerda: Para certificar que no dependes de la base de datos local de Docker, ejecutas:${CLR_RESET}"
        echo -e "        ${CLR_CYAN}docker stop pizzeria-prod-db${CLR_RESET}"
    else
        log_ok "Base de datos local 'pizzeria-prod-db' apagada (la persistencia depende de AWS RDS)."
    fi
fi

echo ""

# ------------------------------------------------------------------------------
# 4. CONFIGURACIÓN Y CIFRADO SSL EN DBGATE
# ------------------------------------------------------------------------------
echo -e "${CLR_BOLD}[PASO 4/6] Comprobando Gestor Web DbGate y Soporte SSL...${CLR_RESET}"

DBGATE_STATUS=$(docker inspect --format '{{.State.Status}}' pizzeria-prod-dbgate 2>/dev/null || echo "not_found")

if [ "$DBGATE_STATUS" != "running" ]; then
    log_warn "El contenedor 'pizzeria-prod-dbgate' no está en ejecución (Estado: $DBGATE_STATUS)."
    print_solution_box "Arrancar DbGate" \
        "Para tener activo el gestor visual de base de datos, ejecuta:" \
        "docker compose -f docker-compose.db.yml up -d dbgate"
else
    log_ok "Contenedor 'pizzeria-prod-dbgate' en ejecución."
    
    # Comprobar archivo de conexiones interno
    DBGATE_JSONL=$(docker exec pizzeria-prod-dbgate cat /root/.dbgate/connections.jsonl 2>/dev/null || echo "")
    
    if [ -z "$DBGATE_JSONL" ]; then
        log_error "No se encontró el archivo de conexión /root/.dbgate/connections.jsonl en DbGate."
        NEED_DBGATE_FIX=true
    elif ! echo "$DBGATE_JSONL" | grep -qi '"useSsl"[[:space:]]*:[[:space:]]*true'; then
        log_error "DbGate no tiene habilitado el cifrado obligatorio SSL ('\"useSsl\":true')."
        NEED_DBGATE_FIX=true
    elif ! echo "$DBGATE_JSONL" | grep -Fq "$DB_HOST"; then
        log_error "DbGate no tiene configurado el endpoint actual de RDS ($DB_HOST)."
        NEED_DBGATE_FIX=true
    else
        log_ok "Conexión en DbGate configurada con endpoint de AWS RDS y SSL activado ('useSsl: true')."
        NEED_DBGATE_FIX=false
    fi

    if [ "$NEED_DBGATE_FIX" = true ]; then
        print_solution_box "Inyectar Conexión SSL en DbGate" \
            "Ejecuta este bloque completo en tu terminal para inyectar la configuración correcta:" \
            "" \
            "docker exec -i pizzeria-prod-dbgate sh -c 'cat > /root/.dbgate/connections.jsonl' << 'EOF'" \
            "{\"_id\":\"pizzeria_rds\",\"engine\":\"postgres@dbgate-plugin-postgres\",\"server\":\"$DB_HOST\",\"port\":$DB_PORT,\"user\":\"$DB_USER\",\"password\":\"$DB_PASSWORD\",\"defaultDatabase\":\"$DB_NAME\",\"displayName\":\"AWS RDS Bella Napoli\",\"useSsl\":true}" \
            "EOF" \
            "docker compose -f docker-compose.db.yml restart dbgate"
    fi
fi

echo ""

# ------------------------------------------------------------------------------
# 5. DIAGNÓSTICO DE SALUD DE LA API Y BASE DE DATOS LÓGICA
# ------------------------------------------------------------------------------
echo -e "${CLR_BOLD}[PASO 5/6] Diagnóstico de Salud de la API (/api/health) y Base de Datos...${CLR_RESET}"

HEALTH_RESPONSE=$(curl -s --max-time 4 http://localhost/api/health 2>/dev/null || echo "")

if echo "$HEALTH_RESPONSE" | grep -qi '"connected"[[:space:]]*:[[:space:]]*true'; then
    log_ok "Endpoint /api/health respondió exitosamente: ${CLR_GREEN}Base de datos CONECTADA${CLR_RESET}."
    DB_TIME=$(echo "$HEALTH_RESPONSE" | grep -o '"db_time"[^,}]*' | cut -d ':' -f2- | tr -d '"')
    [ -n "$DB_TIME" ] && log_ok "Marca de tiempo de AWS RDS: ${CLR_CYAN}$DB_TIME${CLR_RESET}"
else
    log_error "El endpoint /api/health no devuelve conexión positiva con la base de datos."
    [ -n "$HEALTH_RESPONSE" ] && echo -e "     ${CLR_YELLOW}Respuesta recibida:${CLR_RESET} $HEALTH_RESPONSE"
    
    # Análisis forense de los logs recientes del backend
    BACKEND_LOGS=$(docker logs pizzeria-prod-backend --tail 50 2>&1 || echo "")
    
    if echo "$BACKEND_LOGS" | grep -qi 'database.*does not exist'; then
        log_error "¡ERROR DETECTADO EN LOGS! La base de datos '$DB_NAME' NO existe en AWS RDS."
        print_solution_box "Crear la Base de Datos Faltante en AWS RDS" \
            "Al crear la instancia RDS en AWS olvidaste el campo 'Nombre de la base de datos inicial'." \
            "¡No hace falta borrar la instancia! Puedes crearla en 2 segundos con este comando:" \
            "" \
            "docker run --rm -e PGPASSWORD='$DB_PASSWORD' postgres:16-alpine psql -h '$DB_HOST' -U '$DB_USER' -d postgres -c 'CREATE DATABASE $DB_NAME;'" \
            "docker compose -f docker-compose.app.yml restart backend"
    elif echo "$BACKEND_LOGS" | grep -qi 'password authentication failed'; then
        log_error "¡ERROR DETECTADO EN LOGS! Fallo de autenticación para el usuario '$DB_USER'."
        print_solution_box "Credenciales Incorrectas" \
            "El usuario maestro o la contraseña en .env no coinciden con los que configuraste en AWS RDS." \
            "1. Abre .env con 'nano .env'." \
            "2. Verifica DB_USER y DB_PASSWORD (asegúrate de que coincida con la que pusiste en AWS)." \
            "3. Reinicia el backend: docker compose -f docker-compose.app.yml restart backend"
    elif echo "$BACKEND_LOGS" | grep -qi 'no pg_hba.conf entry.*no encryption'; then
        log_error "¡ERROR DETECTADO EN LOGS! AWS RDS exige conexión cifrada SSL."
        print_solution_box "Activar SSL en Backend" \
            "Asegúrate de que en .env tienes DB_HOST configurado con el endpoint de RDS" \
            "y recompila el backend: docker compose -f docker-compose.app.yml up -d --build backend"
    else
        echo -e "  ${CLR_YELLOW}Últimas líneas del registro del backend:${CLR_RESET}"
        docker logs pizzeria-prod-backend --tail 10 2>&1 | sed 's/^/     /'
    fi
fi

echo ""

# ------------------------------------------------------------------------------
# 6. ESTADO DEL TÚNEL CLOUDFLARE ZERO TRUST
# ------------------------------------------------------------------------------
echo -e "${CLR_BOLD}[PASO 6/6] Comprobando Perímetro Cloudflare Zero Trust (Túnel)...${CLR_RESET}"

TUNNEL_STATUS=$(docker inspect --format '{{.State.Status}}' pizzeria-prod-tunnel 2>/dev/null || echo "not_found")

if [ "$TUNNEL_STATUS" = "running" ]; then
    log_ok "Contenedor 'pizzeria-prod-tunnel' en ejecución."
    
    TUNNEL_LOGS=$(docker logs pizzeria-prod-tunnel --tail 30 2>&1 || echo "")
    if echo "$TUNNEL_LOGS" | grep -qi 'Registered tunnel connection'; then
        log_ok "Túnel Cloudflare registrado y conectado con los servidores perimetrales Anycast."
    elif echo "$TUNNEL_LOGS" | grep -qi 'Cannot determine default configuration path'; then
        log_warn "El túnel está corriendo pero verifica que el token esté correctamente configurado."
    else
        log_ok "Contenedor de túnel activo."
    fi
else
    log_warn "El contenedor 'pizzeria-prod-tunnel' no está en ejecución ($TUNNEL_STATUS)."
    print_solution_box "Arrancar Túnel Cloudflare" \
        "Asegúrate de tener la variable CLOUDFLARE_TUNNEL_TOKEN en .env y ejecuta:" \
        "docker compose -f docker-compose.app.yml up -d tunnel"
fi

echo ""

# ------------------------------------------------------------------------------
# RESUMEN FINAL DE LA AUDITORÍA
# ------------------------------------------------------------------------------
echo -e "${CLR_CYAN}${CLR_BOLD}======================================================================${CLR_RESET}"
echo -e "${CLR_CYAN}${CLR_BOLD}  RESUMEN DE LA AUDITORÍA${CLR_RESET}"
echo -e "${CLR_CYAN}${CLR_BOLD}======================================================================${CLR_RESET}"
echo -e "  Pruebas superadas : ${CLR_GREEN}${CLR_BOLD}$PASSED_COUNT${CLR_RESET}"
echo -e "  Avisos            : ${CLR_YELLOW}${CLR_BOLD}$WARNINGS_COUNT${CLR_RESET}"
echo -e "  Errores críticos  : ${CLR_RED}${CLR_BOLD}$ERRORS_COUNT${CLR_RESET}"
echo ""

if [ "$ERRORS_COUNT" -eq 0 ]; then
    echo -e "${CLR_GREEN}${CLR_BOLD}🎉 ¡ENHORABUENA! La infraestructura y conexión a AWS RDS están 100% operativas.${CLR_RESET}"
    echo -e "   Puedes acceder a la aplicación web a través del túnel seguro de tu subdominio"
    echo -e "   y gestionar la base de datos visualmente en: ${CLR_CYAN}https://<tu-subdominio>/dbgate/${CLR_RESET}"
    echo ""
    exit 0
else
    echo -e "${CLR_RED}${CLR_BOLD}❌ Se han detectado $ERRORS_COUNT problema(s) que impiden el funcionamiento óptimo.${CLR_RESET}"
    echo -e "   Sigue los cuadros de solución sugeridos más arriba y vuelve a ejecutar:"
    echo -e "   ${CLR_CYAN}bash scripts/audit_db_connection.sh${CLR_RESET}"
    echo ""
    exit 1
fi
