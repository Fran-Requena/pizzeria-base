# Práctica 2: Resolución DNS Dinámica y Persistencia con DuckDNS

**Módulo:** Despliegue de Aplicaciones Web (2º DAW)  
**Ciclo Formativo:** Desarrollo de Aplicaciones Web  
**Proyecto:** Pizzería Bella Napoli  
**Requisito previo:** Haber completado la [Práctica 1: Despliegue en AWS EC2](P01_Despliegue_AWS.md) y conocer el [Flujo de Trabajo (WORKFLOW.md)](WORKFLOW.md).

---

## 1. Contexto y Problema a Resolver en AWS Academy

En AWS Academy Learner Lab (y en entornos de nube pública sin IP elástica asignada), **cada vez que detienes y vuelves a arrancar tu instancia EC2 (`Stop` / `Start`), AWS le asigna una dirección IP pública IPv4 completamente distinta**.

Esto provoca tres problemas graves en producción:

1. Los clientes tendrían que cambiar de URL en cada sesión de clase.
2. No podemos emitir certificados SSL/TLS estables con Let's Encrypt sobre una IP cambiante.
3. Recordar direcciones IP numéricas no es un estándar web profesional.

### La Solución: Dynamic DNS (DDNS) con DuckDNS

Asociaremos un subdominio gratuito y permanente (ejemplo: `pizzeria-tunombre.duckdns.org`) a la máquina. Configuraremos un servicio desatendido en la propia instancia EC2 para que, de forma automática en el arranque y periódicamente mediante `cron`, notifique a DuckDNS la nueva IP pública de la máquina.

> ⚠️ **AVISO IMPORTANTE SOBRE LA RED DEL INSTITUTO:**  
> El cortafuegos/filtrado de contenidos de la red del centro educativo bloquea el acceso web al portal de DuckDNS (`duckdns.org`).  
> **¿Cómo lo resolvemos?**
>
> - El alta del dominio y la obtención del `token` se puede realizar **desde el móvil con datos 4G/5G** o en casa.
> - La instancia EC2 en AWS está en los centros de datos de Amazon (N. Virginia), por lo que **el servidor sí tiene acceso directo a la API de DuckDNS vía curl sin ninguna restricción**.

---

## FASE 1: Registro del Subdominio y Obtención del Token (DuckDNS)

> _Realiza este paso desde un dispositivo fuera del filtrado del centro (móvil con datos o en casa)._

1. Accede a [https://www.duckdns.org](https://www.duckdns.org).
2. Inicia sesión con tu cuenta de **GitHub** (la misma que usas en clase).
3. En la parte superior verás tu identificador de seguridad: **`token`** (una cadena alfanumérica similar a `a1b2c3d4-e5f6-7890-abcd-ef1234567890`). **Copia y guarda este token.**
4. En el apartado **domains**, introduce el nombre de subdominio que elijas para tu pizzería:
   - Formato recomendado: `pizzeria-<tualias>` o `pizzeria-<tunombre>` (todo en minúsculas, sin espacios ni caracteres especiales).
   - Pulsa **add domain**.
5. Deja la IP temporal que aparezca por defecto (la actualizaremos inmediatamente desde AWS).

---

## FASE 2: Configuración del Agente de Actualización en AWS EC2

Conéctate a tu instancia EC2 mediante la consola de AWS (**EC2 Instance Connect**).

### 1. Crear el directorio de configuración

En la terminal de la máquina Ubuntu:

```bash
mkdir -p ~/duckdns
cd ~/duckdns
```

### 2. Crear el script de sincronización dinámica

Crea el script ejecutable:

```bash
nano duck.sh
```

Pega el siguiente contenido, **sustituyendo estrictamente tus datos**:

- Sustituye `TU_SUBDOMINIO` por el nombre de tu subdominio (sin el `.duckdns.org`).
- Sustituye `TU_TOKEN` por el token copiado en la Fase 1.

```bash
#!/bin/bash
DOMAIN="TU_SUBDOMINIO"
TOKEN="TU_TOKEN"

# Notificar a DuckDNS dejando el parámetro 'ip=' vacío:
# La API de DuckDNS autodetecta la IP pública emisora de la petición HTTP/TCP
RESPONSE=$(curl -s "https://www.duckdns.org/update?domains=${DOMAIN}&token=${TOKEN}&ip=")

# Registrar en log con fecha y hora
echo "$(date '+%Y-%m-%d %H:%M:%S') - Respuesta DuckDNS: ${RESPONSE}" >> /home/ubuntu/duckdns/duck.log
```

> **¿Por qué dejamos `ip=` vacío?**  
> Según la especificación oficial de la API de DuckDNS, si el parámetro `ip=` se omite o se deja en blanco, el servidor de DuckDNS lee la dirección IP pública directamente de los paquetes TCP/HTTP entrantes. Esto elimina dependencias de servicios externos (`checkip`, `ifconfig.me`) y hace el script mucho más rápido y fiable.

Guarda y sal del editor (`Ctrl + O`, `Enter`, `Ctrl + X`).

### 3. Asignar permisos de ejecución y prueba manual

Otorga permisos de ejecución al script:

```bash
chmod 700 duck.sh
```

Ejecuta el script para probar la conexión con DuckDNS:

```bash
./duck.sh
```

Inspecciona el fichero de log generado para verificar el resultado:

```bash
cat duck.log
```

> **Salida esperada:**
>
> ```text
> 2026-09-17 12:35:10 - Respuesta DuckDNS: OK
> ```
>
> Si la respuesta es `OK`, el subdominio ya apunta con éxito a tu máquina de AWS. Si responde `KO`, revisa que el nombre de dominio y el token estén escritos con exactitud.

---

## FASE 3: Automatización del Demonio con Cron

Para que la IP se actualice automáticamente cada 5 minutos y sobre todo **cada vez que la máquina vuelva a encenderse en futuras sesiones de clase**, programaremos una tarea en el planificador del sistema (`cron`).

1. Abre el editor de tareas cron del usuario `ubuntu`:

   ```bash
   crontab -e
   ```

   _(Si es la primera vez que lo abres, selecciona la opción recomendada `1` para usar `nano`)._

2. Desplázate al final del archivo y añade las siguientes dos directivas:

   ```bash
   # 1. Actualizar DuckDNS inmediatamente al arrancar la máquina
   @reboot /home/ubuntu/duckdns/duck.sh >/dev/null 2>&1

   # 2. Actualizar DuckDNS periódicamente cada 5 minutos
   */5 * * * * /home/ubuntu/duckdns/duck.sh >/dev/null 2>&1
   ```

3. Guarda y sal (`Ctrl + O`, `Enter`, `Ctrl + X`).

4. Comprueba que la tarea ha quedado instalada:
   ```bash
   crontab -l
   ```

---

## FASE 4: Parametrización en el Repositorio del Alumno (Flujo DevOps)

Siguiendo el estándar aprendido en [WORKFLOW.md](WORKFLOW.md), los cambios de configuración deben quedar registrados formalmente en el proyecto.

### 1. En tu puesto local del instituto (o en tu repositorio)

Añade a tu archivo `.env` la referencia a tu nuevo nombre de dominio:

```bash
# Dominio asignado en DuckDNS
APP_DOMAIN=pizzeria-tunombre.duckdns.org
```

Si modificas algún ajuste en el frontend o en variables de entorno para adaptarlo a tu nombre de dominio:

```bash
git add .
git commit -m "feat(dns): configurar integracion con subdominio duckdns"
git push origin main
```

### 2. En la instancia EC2

Descarga y sincroniza:

```bash
cd ~/pizzeria-base
git pull origin main
docker compose -f docker-compose.prod.yml up -d
```

---

## FASE 5: Comprobación de Resolución DNS y Acceso

Desde la terminal del servidor (o desde tu teléfono móvil fuera de la red escolar), comprueba que el nombre resuelve hacia la IP de tu servidor:

```bash
dig +short TU_SUBDOMINIO.duckdns.org
# o usando ping / nslookup:
nslookup TU_SUBDOMINIO.duckdns.org
```

Comprueba el acceso a los servicios utilizando el nombre de dominio en lugar de la IP:

| Servicio                  | Nueva URL con Dominio                         | Función                           |
| :------------------------ | :-------------------------------------------- | :-------------------------------- |
| **Portal Web Pizzería**   | `http://TU_SUBDOMINIO.duckdns.org`            | Catálogo comercial y pedidos.     |
| **Diagnóstico API**       | `http://TU_SUBDOMINIO.duckdns.org/api/health` | Estado del backend y PostgreSQL.  |
| **WebApp Móvil Clientes** | `http://TU_SUBDOMINIO.duckdns.org/app/`       | Carta digital y comandas.         |
| **Gestión BD (Adminer)**  | `http://TU_SUBDOMINIO.duckdns.org:8082`       | Administración de tablas y datos. |

---

## FASE 6: Simulación de Reinicio y Verificación de Resiliencia

Para comprobar que la solución resuelve de forma definitiva el problema del aula:

1. Ve a la consola de AWS EC2.
2. Selecciona la instancia $\rightarrow$ **Estado de la instancia** $\rightarrow$ **Reiniciar instancia** (o _Detener_ y volver a _Iniciar_).
3. Espera 1 minuto a que el estado cambie a _En ejecución_.
4. Observa que la **IP pública IPv4 ha cambiado**.
5. Abre la terminal o consulta tu subdominio `http://TU_SUBDOMINIO.duckdns.org`.
6. Verifica en el log que el script se ejecutó en el arranque:
   ```bash
   tail -n 5 ~/duckdns/duck.log
   ```
   **Resultado:** El dominio responderá a la nueva IP de forma 100% autónoma, sin necesidad de que el alumno vuelva a reconfigurar nada.
