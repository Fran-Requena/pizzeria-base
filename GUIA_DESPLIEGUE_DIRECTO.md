# Guía de Despliegue Directo en Producción (Cloud-Native Fast-Track)

**Módulo:** Despliegue de Aplicaciones Web (2º DAW) / Proyecto Intermodular (2º DAW & DAM)  
**Ciclo Formativo:** Desarrollo de Aplicaciones Web / Multiplataforma  
**Proyecto:** Pizzería Bella Napoli  
**Tiempo estimado de despliegue:** unos 40 minutos (la mitad, esperando a que AWS cree la base de datos) [POR VERIFICAR EN LAB LIMPIO]  

> **Antes de empezar:** lee la [Ficha de continuidad](FICHA_CONTINUIDAD.md). Ahí está el
> presupuesto del laboratorio (50 $) y cómo parar y arrancar todo sin gastar saldo ni perder trabajo.

> **Qué necesitas que te dé el profesor (en Aules):** tu **subdominio** y tu **token de túnel**.
>
> **Claves de laboratorio (solo para aprendizaje, iguales para todos):**
>
> | Para qué | Valor |
> | :--- | :--- |
> | Contraseña maestra de RDS y `DB_PASSWORD` | `pizzeria_pass_2026!` |
> | DbGate (`/dbgate/`, usuario `admin`) | `PizzeriaAdmin_2026!` |
>
> En producción real se elegirían otras. Si cambias alguna, tú eres responsable de recordarla.

---

## 1. Propósito de esta Guía

Esta guía está diseñada como un **camino directo ("Fast-Track")** para desplegar de una sola vez la arquitectura final en producción de la Pizzería Bella Napoli.

A diferencia del itinerario formativo progresivo ([Prácticas P01 a P08](P01_Despliegue_AWS.md)), pensado para que los alumnos descubran los problemas paso a paso mediante el contraste y la resolución iterativa de errores, este documento está dirigido a:
* **Docentes y compañeros de departamento:** Para desplegar el entorno de producción completo y validado sin necesidad de recorrer las prácticas secuenciales.
* **Alumnos de Proyecto Intermodular / Fin de Ciclo:** Para tomar como plantilla y memoria técnica de referencia un despliegue Cloud-Native profesional de 3 capas.
* **Metodología Didáctica "Top-Down" (Ingeniería Inversa):** Para arrancar el curso con el sistema completo ya funcionando en la nube y, a partir de ahí, diseccionar y estudiar cada componente en profundidad.

---

## 2. Arquitectura de Producción de 3 Capas

El despliegue implementa el estándar de la industria **Well-Architected Framework de AWS** y el modelo **Zero Trust** de Cloudflare:

```mermaid
graph TB
    subgraph CLIENTS ["1. Clientes y Perímetro Exterior"]
        Browser["Navegador Web / Móvil Clientes<br/>(https://TU-SUBDOMINIO)"]
        CF_Edge["Red Perimetral Anycast de Cloudflare<br/>(WAF, DDoS Shield, SSL Automático)"]
    end

    subgraph AWS_CLOUD ["2. Nube Pública Amazon Web Services (VPC us-east-1)"]
        subgraph EC2_INSTANCE ["Instancia AWS EC2 (t3.small - Ubuntu 24.04)"]
            subgraph DOCKER_NET ["Red Compartida Docker: pizzeria-network (bridge)"]
                Tunnel["pizzeria-prod-tunnel<br/>(cloudflared Zero Trust - Conexión Saliente)"]
                Nginx["pizzeria-prod-web<br/>(Nginx Proxy + Frontend Web + KDS)"]
                Backend["pizzeria-prod-backend<br/>(API REST Node.js Express :3000)"]
                QR["pizzeria-prod-qr<br/>(PWA Clientes Mesas :80)"]
                DbGate["pizzeria-prod-dbgate<br/>(Gestor Visual Web SQL :3000)"]
            end
        end

        subgraph RDS_CLUSTER ["3. Capa de Persistencia Gestionada: AWS RDS"]
            RDS["Amazon RDS PostgreSQL 16.15<br/>(pizzeria-db - db.t4g.micro)<br/>Publicly Accessible: NO<br/>Cifrado TLS/SSL Obligatorio"]
            Storage[("Almacenamiento gp3 20 GiB<br/>Copias automáticas (retención 1 día)")]
        end
    end

    Browser -->|HTTPS :443| CF_Edge
    CF_Edge <==|Túnel Cifrado Bidireccional| Tunnel
    Tunnel --> Nginx
    Nginx -->|/api/*| Backend
    Nginx -->|/app/*| QR
    Nginx -->|/dbgate/* (Basic Auth)| DbGate
    Backend ==>|Pool TLS/SSL :5432| RDS
    DbGate ==>|Admin TLS/SSL :5432| RDS
    RDS --- Storage
```

---

## FASE 1: Aprovisionamiento Cloud en AWS (7 minutos)

### 1.1 Crear el Grupo de Seguridad de la Máquina Virtual (EC2)
1. En la consola de AWS (Región **N. Virginia `us-east-1`**), accede a **EC2** $\rightarrow$ **Grupos de seguridad** $\rightarrow$ **Crear grupo de seguridad**:
   * **Nombre:** `pizzeria-secgroup`
   * **Descripción:** `Acceso administrativo SSH para la pizzeria`
   * **Reglas de entrada:** Añade únicamente:
     * **Tipo:** `SSH` | **Puerto:** `22` | **Origen:** `Cualquier lugar - IPv4` (`0.0.0.0/0`)
2. Pulsa en **Crear grupo de seguridad**.  
*(Observa que **no** abrimos los puertos 80 ni 443; la web saldrá por el túnel de Cloudflare).*

---

### 1.2 Crear el Grupo de Seguridad de la Base de Datos (RDS)
1. En **EC2** $\rightarrow$ **Grupos de seguridad**, pulsa de nuevo en **Crear grupo de seguridad**:
   * **Nombre:** `pizzeria-rds-secgroup`
   * **Descripción:** `Acceso exclusivo a PostgreSQL desde la instancia EC2`
   * **Reglas de entrada:** Añade una regla con origen cruzado:
     * **Tipo:** `PostgreSQL` | **Puerto:** `5432`
     * **Origen:** Selecciona el identificador del grupo anterior: **`pizzeria-secgroup`** (ej. `sg-0295027...`).
2. Pulsa en **Crear grupo de seguridad**.

---

### 1.3 Lanzar la Instancia EC2
1. Ve a **EC2** $\rightarrow$ **Instancias** $\rightarrow$ **Lanzar instancias**:
   * **Nombre:** `Pizzeria-Produccion`
   * **AMI:** Selecciona **Ubuntu** (**Ubuntu Server 24.04 LTS**, 64-bit x86).  
     > [!TIP]
     > **Aviso de cambio de AMI:** Al cambiar de la opción por defecto (Amazon Linux) a Ubuntu, AWS mostrará una ventana emergente advirtiendo: *"Al cambiar la AMI, se restablecerán algunos ajustes configurados anteriormente a sus valores predeterminados..."*. Es un aviso normal de AWS: haz clic en **Confirmar / Continuar** con total tranquilidad.
   * **Tipo de instancia:** **`t3.small`** (2 vCPU, 2 GiB RAM).
   * **Par de claves:** `vockey` (o tu clave de AWS Academy).
   * **Configuración de red:** Pulsa *Editar* $\rightarrow$ *Seleccionar grupo de seguridad existente* $\rightarrow$ Selecciona **`pizzeria-secgroup`**.
   * **Almacenamiento:** **20 GiB** (gp3).
2. Pulsa **Lanzar instancia**.

---

### 1.4 Crear la Base de Datos Gestionada en Amazon RDS
1. En el buscador de AWS escribe **RDS** y accede a la sección **Bases de datos**.
2. Pulsa en el botón naranja **Crear base de datos** y selecciona **Configuración completa** (*Standard create*).  
   > [!WARNING]
   > **Evita "Configuración exprés" (*Easy create*):** Despliega el menú del botón naranja y asegúrate de elegir **Configuración completa**. La opción exprés intentará aprovisionar Aurora Serverless, no cubierto por la capa gratuita, y consumirá créditos rápidamente.
3. Configura los siguientes parámetros en el asistente:
   * **Método de creación:** **Configuración completa** (*Standard create*).
   * **Tipo de motor:** **PostgreSQL** (versión `PostgreSQL 16.X`).
   * **Plantillas:** **Capa gratuita** (*Free tier*).
   * **Identificador de instancia de base de datos:** `pizzeria-db`
   * **Usuario maestro:** `pizzeria_user`
   * **Gestión de credenciales:** Autogestionada (*Self managed*).
   * **Contraseña maestra:** `pizzeria_pass_2026!` (clave de laboratorio; la misma que ya trae el `.env.example`).  
     Si prefieres otra, AWS no admite `/`, `"`, `@` ni espacios, y para evitar problemas con Docker no uses `$`, `#` ni comillas.
   * **Configuración de la instancia:** `db.t4g.micro` (o `db.t3.micro`).
   * **Almacenamiento:**
     * **Tipo de almacenamiento:** SSD de uso general (`gp3`).
     * **Almacenamiento asignado:** `20` GiB.
     * **Desplegable `▼ Configuración de almacenamiento adicional`:**  
       Haz clic sobre él para expandirlo y **DESMARCA** la casilla **«Habilitar escalado automático de almacenamiento»** (*Enable storage autoscaling*).  
       *(¡Importante! AWS la marca por defecto con un umbral de 1000 GiB; desmarcarla garantiza que el disco no aumente de tamaño y protege los créditos del laboratorio).*
   * **Conectividad:**
     * **Recurso de computación:** `No se conecte a un recurso informático de EC2` (lo enlazamos mediante grupos de seguridad).
     * **Nube privada virtual (VPC):** Mantener la VPC por defecto (`default`).
     * **Acceso público:** **No** (Imprescindible para seguridad: la base de datos queda aislada dentro de la VPC privada).
     * **Grupo de seguridad de VPC:** Selecciona **`pizzeria-rds-secgroup`** (si aparece el grupo `default`, quítalo para que solo quede este).
   * **Configuración adicional (Despliega la sección `▼ Configuración adicional` al final de la página):**
     * **Nombre de la base de datos inicial:** `pizzeria_db` (¡Crítico! Si se deja vacío, PostgreSQL no creará la BBDD inicial y la aplicación fallará).
     * **Copias de seguridad:** deja **marcada** la opción *Habilitar copias de seguridad automáticas* y pon el **Periodo de retención de copia de seguridad** en **1 día**. [POR VERIFICAR EN LAB LIMPIO] (la consola puede ofrecer solo 1 día).
4. Pulsa el botón final naranja **Crear base de datos**.
5. **Localizar y copiar el Punto de enlace (*Endpoint*):**
   * Espera 4-5 minutos hasta que el estado de la base de datos cambie de *Creando* a **Disponible** (*Available*).
   * Haz clic sobre el enlace azul del nombre: 👉 **`pizzeria-db`** para entrar en su panel de detalles.
   * En la pestaña **Conectividad y seguridad** (*Connectivity & security*), observa el apartado superior *"Conectarse mediante"*.
   * Si por defecto viene marcada la tarjeta *Fragmentos de código*, haz clic en la tercera tarjeta: 👉 **`Puntos de conexión`** (*"Úselo cuando se conecte a través de cualquier interfaz IDE"*).
   * Justo debajo, en la sección **Punto de enlace y puerto**, localiza el campo **Punto de enlace** (*Endpoint*) y haz clic en el icono de copiar. Tendrá un formato similar a:  
     `pizzeria-db.<identificador>.us-east-1.rds.amazonaws.com`  
     En el resto de la guía lo llamamos **`<ENDPOINT_RDS>`** (termina en `.com`, sin barra final).
   * Guarda este valor; lo utilizaremos a continuación en el archivo `.env` de la EC2 (`DB_HOST`) y en la configuración de DbGate.

---

## FASE 2: Conectividad Zero Trust con Cloudflare (3 minutos)

Para conectar tu máquina a Internet sin exponer IPs públicas ni abrir puertos en AWS, utilizaremos un **Cloudflare Tunnel**:

1. Obtén tu **Token de Túnel** asignado por el profesor en Aules. Si lo crearas tú en el panel de Cloudflare Zero Trust $\rightarrow$ *Networks* $\rightarrow$ *Tunnels*, asocia tu subdominio (ej: `daw-XX.tudominio.org`) al servicio **`http://frontend-web:80`**.
   > **Importante:** el túnel corre **dentro de un contenedor** (`pizzeria-prod-tunnel`), así que `localhost` sería ese mismo contenedor y no llegaría a Nginx. Hay que usar el nombre del servicio de Nginx en la red de Docker: `frontend-web`. [POR VERIFICAR EN LAB LIMPIO]
2. Guarda el valor del token para el siguiente paso.

---

## FASE 3: Despliegue Automatizado en la Instancia EC2 (7 minutos)

### 3.1 Conectar a la EC2 e Instalar Docker Engine
1. En la consola de EC2, selecciona tu instancia y pulsa **Conectar** $\rightarrow$ **Conexión de la instancia EC2** $\rightarrow$ **Conectar**.
2. Ejecuta el script oficial de instalación de Docker:
   ```bash
   curl -fsSL https://get.docker.com -o get-docker.sh
   sudo sh get-docker.sh
   rm get-docker.sh
   sudo usermod -aG docker $USER
   newgrp docker
   ```

---

### 3.2 Clonar el Repositorio y Configurar Variables de Entorno
1. Clona el repositorio del proyecto:
   ```bash
   git clone https://github.com/guillermofoix/pizzeria-base.git
   cd pizzeria-base
   ```

2. Crea el archivo de entorno `.env`:
   ```bash
   cp .env.example .env
   nano .env
   ```

3. Modifica los siguientes parámetros (el resto déjalos como están):
   * **`CLOUDFLARE_TUNNEL_TOKEN=`** $\rightarrow$ Pega tu token de Cloudflare.
   * **`DB_HOST=db`** $\rightarrow$ Sustituye `db` por el **Punto de enlace (*Endpoint*) de AWS RDS** que copiaste en el paso 1.4.
   * **`DB_PASSWORD=`** ya viene con la clave de laboratorio `pizzeria_pass_2026!`, la misma que pusiste como contraseña maestra de RDS. No la toques.
     ```ini
     DB_HOST=<ENDPOINT_RDS>
     DB_PORT=5432
     DB_NAME=pizzeria_db
     DB_USER=pizzeria_user
     DB_PASSWORD=pizzeria_pass_2026!
     ```
     > Sustituye `<ENDPOINT_RDS>` por tu endpoint, **sin** los signos `<` `>`, sin comillas y sin espacios.
     > [!TIP]
     > **Recordatorio:** Este valor proviene de la consola de RDS $\rightarrow$ *pizzeria-db* $\rightarrow$ pestaña *Conectividad y seguridad* $\rightarrow$ tarjeta **`Puntos de conexión`** $\rightarrow$ campo **Punto de enlace**.
     > [!IMPORTANT]
     > Si borras `DB_PASSWORD` del `.env`, Docker se negará a arrancar con el mensaje *«Define DB_PASSWORD en el archivo .env»*. Es lo esperado: vuelve a poner la clave.
   *(Guarda en nano con `Ctrl + O`, `Enter` y sal con `Ctrl + X`).*

---

### 3.3 Crear la Red Docker Externa
En nuestra arquitectura desacoplada, los contenedores se comunican a través de una red virtual compartida:
```bash
docker network create pizzeria-network
```

---

### 3.4 Inyectar la Configuración de DbGate con Cifrado SSL
Amazon RDS exige conexiones cifradas con TLS/SSL y no utiliza el contenedor local `db`. Para arrancar DbGate y conectarlo de inmediato a AWS RDS:

1. Arranca el contenedor de DbGate (solo `dbgate`; el `db` local de ese archivo no se usa con RDS):
   ```bash
   docker compose -f docker-compose.db.yml up -d dbgate
   ```

2. Genera la conexión a RDS (con `"useSsl": true`) y reinicia DbGate. El script lee `DB_HOST`, `DB_USER`, `DB_PASSWORD`… de tu `.env`, así que **no tienes que escribir la clave** (y el `!` no da problemas):
   ```bash
   bash scripts/dbgate_conexion_rds.sh
   ```
   > [!IMPORTANT]
   > Si el script dice que `DB_HOST` debe ser el endpoint de RDS, vuelve al paso 3.2 y revisa el `.env`.
   > El endpoint debe terminar en `.com`; si le sobra una barra final, el script la quita.

3. Comprueba que el archivo se ha guardado correctamente (esta orden **muestra la clave en pantalla**; úsala solo si estás a solas y no compartas la captura):
   ```bash
   docker exec pizzeria-prod-dbgate cat /root/.dbgate/connections.jsonl
   ```
   *(Deberás ver una sola línea con tu endpoint limpio y `"useSsl":true`).*

> **Por qué no hay `CONNECTIONS` ni `SKIP_ALL_AUTH=false` en el compose de DbGate:** DbGate funciona sin login propio
> (`SKIP_ALL_AUTH=true`) porque la protección está delante, en Nginx (paso 3.5). Y la conexión a RDS se inyecta en
> `connections.jsonl` porque las conexiones definidas por variables de entorno no admiten SSL.

---

### 3.5 Proteger el acceso a `/dbgate/` con HTTP Basic Auth (Obligatorio por Seguridad)

Como DbGate otorga acceso administrativo directo a todas las tablas de PostgreSQL (incluyendo clientes, comandas y pedidos), en un entorno de producción accesible a través de Internet **es una vulnerabilidad crítica dejarlo abierto sin autenticación**.

La protección **ya viene en el repositorio**: `frontend-web/nginx.conf` exige usuario y contraseña en `/dbgate/` y
`docker-compose.app.yml` monta el archivo `.htpasswd` dentro de Nginx. **No edites ninguno de esos dos archivos.** Solo te falta crear el `.htpasswd`, y **antes** del `up` del paso 3.6:

1. Crea el archivo con el usuario `admin` y la clave de laboratorio `PizzeriaAdmin_2026!`:
   ```bash
   bash scripts/crear_htpasswd.sh
   ```
   El script pone los permisos `644`, necesarios para que Nginx (usuario `nginx` dentro del contenedor) pueda leer el archivo. Es un script y no un comando suelto porque el `!` de la clave da problemas al pegarlo en la terminal (bash lo interpreta como expansión del historial).
   Si quieres otra clave, pásala entre **comillas simples**: `bash scripts/crear_htpasswd.sh 'OtraClave_1!'` (y recuérdala).

2. Comprueba que es un **archivo** (empieza por `-`) y que contiene una línea que empieza por `admin:$apr1$`:
   ```bash
   ls -l .htpasswd
   cut -c1-14 .htpasswd
   ```

> [!WARNING]
> **El orden importa.** Si arrancas el stack sin que exista `.htpasswd`, Docker crea una **carpeta** con ese nombre y Nginx
> no podrá leer las claves (`/dbgate/` dará error 500). Si te pasa: `docker compose -f docker-compose.app.yml down`,
> `rm -r .htpasswd`, vuelve a crearlo con el comando de arriba y repite el paso 3.6.

> El archivo `.htpasswd` está en el `.gitignore`: no se sube a Git. Si cambias la clave de administración, repite el paso 1 con la clave nueva y reinicia Nginx:
> `docker compose -f docker-compose.app.yml restart frontend-web`.


---

### 3.6 Compilar y Arrancar el Stack de Aplicación
Antes de lanzar nada, comprueba que ya existe el archivo `.htpasswd` (paso 3.5) y que la red del paso 3.3 está creada:

```bash
ls -l .htpasswd && docker network ls | grep pizzeria-network
```

Lanza la aplicación completa (Backend Node.js, Frontend Web, WebApp QR y Túnel Cloudflare):

```bash
docker compose -f docker-compose.app.yml up -d --build
```

Si aparece *«Define DB_PASSWORD en el archivo .env»*, falta la clave en el `.env` (paso 3.2). La primera compilación tarda un par de minutos.

> 💡 **Aprovisionamiento Automático de Datos:**  
> Al arrancar, el backend de Node.js se conecta a Amazon RDS mediante SSL, detecta que la base de datos está recién creada y ejecuta automáticamente la creación de tablas (`pizzas`, `ingredientes`, `mesas`, `pedidos`...) y la siembra de datos inicial. ¡No necesitas ejecutar scripts SQL manuales!

---

## FASE 4: Verificación y Auditoría de Salud (3 minutos)

Comprueba que la infraestructura está 100% operativa:

1. **Auditoría Automatizada de Salud y Diagnóstico (Recomendado):**
   Ejecuta el script de auditoría integral que valida de forma automatizada la arquitectura (variables `.env`, resolución DNS, reglas de entrada de Security Groups, contenedores Docker en vivo, cifrado SSL en DbGate, test de la API, túnel y, si lo activas, Stripe):
   ```bash
   bash scripts/audit_db_connection.sh
   ```
   *(Si el script detecta algún fallo, te indicará en pantalla la causa exacta y el comando para solucionarlo al instante).*

2. **Estado de los Contenedores:**
   ```bash
   docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
   ```
   *(Deberás ver activos: `pizzeria-prod-backend`, `pizzeria-prod-web`, `pizzeria-prod-qr`, `pizzeria-prod-tunnel` y `pizzeria-prod-dbgate`).*

3. **Diagnóstico de Salud de la API con conexión a RDS:**
   Desde la propia EC2 (Nginx publica el puerto 80 de la máquina según `HTTP_PORT=80` del `.env`; no hace falta abrirlo en el Security Group porque la llamada es local):
   ```bash
   curl -s http://localhost/api/health
   ```
   Si cambiaste `HTTP_PORT`, o no responde, pregúntaselo directamente al contenedor del backend:
   ```bash
   docker exec pizzeria-prod-backend wget -qO- http://localhost:3000/api/health
   ```
   **Salida esperada** (`connected:true` y `db_time` indican que responde RDS):
   ```json
   {"status":"UP","service":"pizzeria-backend","timestamp":"...","database":{"connected":true,"db_time":"..."}}
   ```

4. **Verificación en el Navegador** (sustituye `<TU_SUBDOMINIO>` por el que te dio el profesor, por ejemplo `daw-01.tudominio.org`):
   * 👉 **Web Comercial & Cocina KDS:** `https://<TU_SUBDOMINIO>/` $\rightarrow$ Catálogo de pizzas cargado desde AWS RDS y panel KDS para gestionar comandas en tiempo real.
   * 👉 **WebApp QR Mesas:** `https://<TU_SUBDOMINIO>/app/` $\rightarrow$ Interfaz móvil para comensales.
   * 👉 **Gestor Visual DbGate (`/dbgate/`):**
     1. Entra a `https://<TU_SUBDOMINIO>/dbgate/`. El navegador te pedirá usuario y contraseña (es la protección de Nginx).
     2. Introduce las credenciales de administración: Usuario `admin` | Contraseña `PizzeriaAdmin_2026!` (la del paso 3.5).
     3. En el panel izquierdo de **Conexiones**, haz doble clic sobre: 👉 **`AWS RDS Bella Napoli`**.
     4. Se conectará mediante SSL a Amazon RDS y desplegará la carpeta **Tablas**: verás `pizzas`, `ingredientes`, `mesas`, `pedidos` y `lineas_pedido`.
     5. Haz doble clic sobre cualquier tabla (ej. `pizzas` o `pedidos`) para ver y editar registros en vivo, o pulsa en **Nueva consulta** (*New Query*) para lanzar sentencias SQL directas contra PostgreSQL.

5. **Prueba Transaccional:**
   Haz un pedido desde la web (pago en efectivo) o desde la app móvil. Refresca la tabla `pedidos` en DbGate: el registro aparece guardado en tiempo real en la infraestructura gestionada de Amazon Web Services.

---

## FASE 5: Disección Didáctica y Matriz de Decisiones Arquitectónicas

Esta sección proporciona la justificación de ingeniería requerida en las **memorias técnicas de proyectos de fin de ciclo (DAW/DAM)**:

### 1. Capa de Cómputo: ¿Por qué Docker en EC2 frente a otras opciones?

| Solución Evaluada | Pros | Contras | Decisión Didáctica |
| :--- | :--- | :--- | :--- |
| **Docker Engine en AWS EC2 (Elegida)** | Control total del sistema operativo, coste fijo mínimo (`t3.small`), visibilidad directa de procesos Linux y red Docker bridge. | Mantenimiento manual del SO y parches de seguridad. | **Óptima para FP:** Los alumnos deben dominar la terminal Linux, comandos Docker y configuración de redes virtuales. |
| **AWS ECS con AWS Fargate (Serverless Containers)** | Cero gestión de instancias EC2, escalado automático horizontal según tráfico web. | Mayor coste por contenedor en reposo, abstracción excesiva que oculta el funcionamiento de la red. | Excelente para producción corporativa de alto tráfico; descartada aquí para mantener el control directo de la terminal. |
| **AWS Elastic Beanstalk** | Despliegue PaaS rápido tipo "subir y ejecutar". | Arquitectura "caja negra" poco flexible, errores difíciles de depurar en entornos multi-contenedor. | Desfasada frente a los enfoques modernos de orquestación con Docker Compose. |
| **Kubernetes (AWS EKS)** | Estándar absoluto para grandes corporaciones y microservicios complejos. | Complejidad cognitiva y técnica desmesurada, coste mínimo prohibitivo para laboratorios (~75$/mes solo por el plano de control). | Inviable para un taller de 20 minutos; reservado para cursos de especialización en Cloud/DevOps. |

---

### 2. Capa de Datos: ¿Por qué AWS RDS PostgreSQL frente a Base de Datos en Contenedor?

| Aspecto | PostgreSQL en Contenedor Docker (Local) | Amazon RDS PostgreSQL (Gestionada) |
| :--- | :--- | :--- |
| **Punto Único de Fallo (SPOF)** | Si la máquina virtual EC2 se apaga o se corrompe el disco EBS, la base de datos se destruye. | La base de datos vive en un clúster desacoplado e independiente de la máquina EC2. |
| **Alta Disponibilidad** | Manual y compleja de implementar. | Activación con un clic de **Multi-AZ** (réplica síncrona en otro centro de datos físico con failover < 60s). |
| **Copias de Seguridad (Backups)** | Requiere programar tareas cron con `pg_dump` y scripts bash. | Automatizadas por AWS (aquí con retención de 1 día) y restauración a cualquier instante de ese periodo (*Point-in-Time Recovery*). |
| **Seguridad de Red** | Comparte el mismo host y red que el servidor web. | Aislada en subredes privadas con cortafuegos por Security Group y forzado obligatorio de SSL/TLS. |
| **Rendimiento** | Compite por la memoria RAM y CPU de la EC2 con Nginx y Node.js. | Memoria RAM, CPU y disco NVMe dedicados exclusivamente al motor de base de datos. |

---

### 3. Capa Perimetral: ¿Por qué Cloudflare Tunnels frente a la Exposición Clásica (ALB + IP Pública)?

En el modelo tradicional de despliegue en AWS, se abrirían los puertos 80/443 en el Security Group, se asignaría una IP Elástica y se contrataría un **Application Load Balancer (ALB)** de AWS con certificados de **AWS Certificate Manager (ACM)**.

Hemos elegido **Cloudflare Zero Trust Tunnels** por motivos de peso:

```
Arquitectura Tradicional (ALB)      VS     Arquitectura Zero Trust (Cloudflare)
[Internet]                                 [Internet]
    │                                          │
    ▼ (Puertos 80/443 abiertos al mundo)       ▼ (WAF global de Cloudflare)
[AWS Security Group: 0.0.0.0/0]            [Cloudflare Edge]
    │                                          ▲
    ▼ (Expuesto a escaneos Shodan/DDoS)        ║ (Túnel saliente cifrado)
[AWS EC2 / ALB]                            [pizzeria-prod-tunnel (EC2)]
                                           * CERO puertos de entrada en AWS *
```

1. **Ahorro Radical de Costes (FinOps):** Un AWS ALB cuesta aproximadamente **18 a 22 $ al mes** solo por existir, sin contar el tráfico procesado. Cloudflare Tunnels es **100% gratuito** dentro del plan Zero Trust.
2. **Superficie de Ataque Cero:** En el Security Group de AWS solo se permite SSH (puerto 22). Los puertos 80 y 443 no existen; es matemáticamente imposible que un bot de Shodan o un ataque DDoS alcance la IP del servidor.
3. **Gestión de Certificados SSL:** Cloudflare emite y renueva automáticamente certificados TLS/SSL de borde sin necesidad de configurar Certbot ni tocar archivos de certificados en el servidor.

---

### 4. Matriz Resumen de Costes Mensuales Estimados (FinOps)

| Componente | Nivel Gratuito (AWS Free Tier / Lab) | Producción Pequeña Empresa (On-Demand) |
| :--- | :--- | :--- |
| **Cómputo:** Instancia EC2 `t3.small` (Ubuntu) | Incluida en créditos de laboratorio (~0.0208 $/hora) | ~15.00 $/mes |
| **Almacenamiento EC2:** 20 GiB EBS gp3 | Gratuito (hasta 30 GB en Free Tier) | ~1.60 $/mes |
| **Base de Datos:** AWS RDS `db.t4g.micro` | Incluida en créditos / 750h gratis primer año | ~13.50 $/mes |
| **Almacenamiento RDS:** 20 GiB gp3 | Gratuito (hasta 20 GB en Free Tier) | ~2.30 $/mes |
| **Perímetro:** Cloudflare Zero Trust Tunnel | **0.00 $ (Gratuito)** | **0.00 $ (Gratuito)** |
| **Balanceador AWS ALB (Evitado):** | **0.00 $ (Ahorrado)** | **~20.00 $/mes (Ahorrado)** |
| **TOTAL ESTIMADO:** | **0.00 $ (Cubierto por Lab / Free Tier)** | **~32.40 $/mes** |
| **Presupuesto del laboratorio:** | **50 $ por alumno** (ver [Ficha de continuidad](FICHA_CONTINUIDAD.md)) | — |
| **Consumo aproximado con todo encendido 24/7:** | **≈ 1 $ al día** (≈ 7 $ por semana); parado, ≈ 0,3 $ al día. [POR VERIFICAR EN LAB LIMPIO] | — |

---

## FASE 6: Protocolo FinOps de Apagado y Ahorro de Créditos

El presupuesto del laboratorio (50 $) y las rutinas completas de parada y arranque están en la
[Ficha de continuidad](FICHA_CONTINUIDAD.md). Resumen para cuando termines la sesión:

1. **Detener la instancia RDS** en la consola de AWS: **RDS** $\rightarrow$ **Bases de datos** $\rightarrow$ `pizzeria-db` $\rightarrow$ **Acciones** $\rightarrow$ **Detener temporalmente** (*Stop temporarily*).
   > ⚠️ **AWS vuelve a encender sola una RDS parada a los 7 días.** Si no vas a volver en una semana, anótalo y vuelve a detenerla; si no, seguirá gastando saldo.
2. **Detener la instancia EC2** en la consola de AWS: **EC2** $\rightarrow$ **Instancias** $\rightarrow$ tu máquina $\rightarrow$ **Estado de la instancia** $\rightarrow$ **Detener instancia** (*Stop instance*).
3. **No pulses nunca «End Lab»**: borraría la EC2, los discos y la base de datos.

**No hace falta parar los contenedores a mano.** Todos los servicios tienen `restart: unless-stopped`: al arrancar de nuevo la EC2,
Docker los levanta solo (Nginx reintenta hasta que `dbgate` y `backend` están listos). Solo se quedan apagados los que tú pares
expresamente con `docker compose ... stop` o `docker stop`; si lo hiciste, vuelve a levantarlos con:
```bash
cd ~/pizzeria-base
docker compose -f docker-compose.db.yml up -d dbgate
docker compose -f docker-compose.app.yml up -d
```

**Al empezar la siguiente sesión:** *Start Lab*, arranca **primero RDS** (espera a que esté *Disponible*), después la EC2, y a los 1-2 minutos comprueba con `docker ps` que están los cinco contenedores. [POR VERIFICAR EN LAB LIMPIO]

---

## FASE 7: Actualizar a una versión nueva del proyecto

Las actualizaciones **no se traen con `git pull`** (chocaría con cualquier archivo que hayas tocado). Se vuelve a clonar el proyecto
y se copian tus claves:

```bash
cd ~
mv pizzeria-base pizzeria-base.anterior
git clone https://github.com/guillermofoix/pizzeria-base.git
cp pizzeria-base.anterior/.env pizzeria-base/.env
cp pizzeria-base.anterior/.htpasswd pizzeria-base/.htpasswd
cd pizzeria-base
docker compose -f docker-compose.db.yml up -d dbgate
docker compose -f docker-compose.app.yml up -d --build
```

* Los datos no se pierden: están en RDS. Los contenedores se recrean con los mismos nombres y la misma red.
* Si la versión nueva añade variables al `.env`, compara con la plantilla (`diff pizzeria-base/.env pizzeria-base/.env.example`) y añade las que falten.
* Cuando compruebes que todo funciona, puedes borrar la carpeta antigua: `rm -rf ~/pizzeria-base.anterior`.

---

## APÉNDICE A (opcional): Activar pagos con Stripe (modo test)

Sin este apéndice la pizzería funciona igual con pagos en **efectivo y datáfono**. Con él, el cliente puede pagar con tarjeta de **prueba**.
Todo se hace en **modo de prueba** de Stripe: no se mueve dinero real. **No pulses nunca «Activar pagos»** en el panel de Stripe.

1. Crea una cuenta gratuita en [dashboard.stripe.com/register](https://dashboard.stripe.com/register), confirma el correo y comprueba que arriba a la derecha está activado **Modo de prueba** (*Test mode*).
2. **Clave secreta de prueba:** *Desarrolladores* $\rightarrow$ *Claves de API* $\rightarrow$ *Clave secreta* $\rightarrow$ **Revelar clave de prueba**. Empieza por `sk_test_`.
3. **Webhook:** *Desarrolladores* $\rightarrow$ *Webhooks* $\rightarrow$ **Añadir destino**:
   * Evento: `checkout.session.completed`.
   * Tipo de destino: **Punto de conexión de webhook**.
   * URL: `https://<TU_SUBDOMINIO>/api/pagos/webhook` (sin barra al final).
   * Al crearlo, copia el **Secreto de firma** (*Signing secret*). Empieza por `whsec_`.
4. En la EC2 edita el `.env` (con `nano`, para que las claves no queden en el historial) y rellena estas tres variables, sin comillas ni espacios:
   ```ini
   STRIPE_SECRET_KEY=sk_test_<CLAVE_STRIPE_DE_PRUEBA>
   STRIPE_WEBHOOK_SECRET=whsec_<TU_SECRETO_DE_FIRMA>
   FRONTEND_URL=https://<TU_SUBDOMINIO>
   ```
   `FRONTEND_URL` es la dirección a la que Stripe devuelve al cliente tras pagar. Con el secreto del webhook definido, el servidor **rechaza** (error 400) los avisos sin firma válida.
5. Recrea el backend para que lea las variables (un `restart` no las relee):
   ```bash
   docker compose -f docker-compose.app.yml up -d backend
   ```
6. Comprueba que la pasarela está activa:
   ```bash
   docker logs pizzeria-prod-backend --tail 20
   docker exec pizzeria-prod-backend wget -qO- http://localhost:3000/api/pagos/config
   ```
   Debes ver `Pasarela de pagos inicializada en modo activo` en el registro y, en el segundo comando, `"stripe_configured":true` y `"webhook_configured":true`.
7. **Prueba:** haz un pedido eligiendo pago con tarjeta y paga con la tarjeta de prueba `4242 4242 4242 4242`, cualquier fecha futura, CVC `123`. Tras pagar, el pedido debe aparecer como pagado.

**Cosas que conviene saber** (no hace falta tocar nada para que funcionen):
* **Reconciliación automática:** si el aviso del webhook se pierde, el servidor revisa cada **2 minutos** los pedidos con tarjeta pendientes de las últimas 24 horas y marca como pagados los que Stripe ya cobró. Se ajusta con `RECONCILIACION_MINUTOS` en el `.env` (`0` la desactiva).
* **Importe mínimo:** Stripe no admite cobros de menos de **0,50 €**; en ese caso el pedido se cobra en efectivo o con datáfono.
* **Un pedido, una sola sesión de pago viva:** si el cliente vuelve a pulsar «Pagar», se cierra la sesión anterior y se crea otra.
* **Pedidos cancelados o ya pagados** no se pueden volver a cobrar.
* **La app Android** abre el pago en el navegador del móvil; al terminar, vuelve a la app a mano y esta consulta el estado del pedido.
* Si algo falla, `bash scripts/audit_db_connection.sh` incluye una comprobación de Stripe (paso 7).

---

## APÉNDICE B: Errores frecuentes

| Síntoma | Causa probable | Solución |
| :--- | :--- | :--- |
| `docker compose` dice *«Define DB_PASSWORD en el archivo .env»* | Falta la clave en el `.env` | Paso 3.2 |
| `/dbgate/` da error 500 | `.htpasswd` no existía al hacer el `up` (Docker creó una carpeta) o no es legible | Aviso del paso 3.5; comprueba `ls -l .htpasswd` y `chmod 644 .htpasswd` |
| `/dbgate/` te deja entrar pero la conexión «AWS RDS Bella Napoli» falla | Clave o endpoint mal en el `.env`, o el Security Group de RDS no admite a la EC2 | Revisa el `.env` y la fase 1.2; vuelve a ejecutar `bash scripts/dbgate_conexion_rds.sh` |
| Cloudflare muestra error 530 o 1033 | El túnel acaba de arrancar o la ruta del túnel no apunta a `http://frontend-web:80` | Espera 30 s; revisa la fase 2 y `docker logs pizzeria-prod-tunnel` |
| Error 502 al abrir la web | El backend no ha arrancado (suele ser la conexión con RDS) | `docker logs pizzeria-prod-backend --tail 30` |
| Tras arrancar la EC2 no hay contenedores | Los habías parado a mano | Fase 6: `up -d` de los dos archivos |
