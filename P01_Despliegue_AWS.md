# Práctica 1: Despliegue de Aplicación Full-Stack en AWS Cloud
**Módulo:** Despliegue de Aplicaciones Web (2º DAW)  
**Proyecto:** Pizzería Bella Napoli  
**Infraestructura:** AWS Academy Learner Lab (Amazon EC2 + Docker Compose)

---

## 🎯 Objetivos de la Sesión
* Configurar el entorno de computación en la nube (AWS EC2) y su cortafuegos (Security Groups).
* Establecer el flujo de control de versiones mediante bifurcación (*Fork*) en GitHub.
* Automatizar la puesta en marcha de un stack multi-contenedor (Frontend, Backend, BD y Proxy Inverso).
* Verificar el enrutamiento web y la persistencia de datos en producción.

---

## Bloque 1: Registro y Activación del Laboratorio (15 min)

1. Abre tu bandeja de entrada del correo del instituto (`@alu.edu.gva.es`).
2. Localiza el correo de invitación de **Instructure Canvas / AWS Academy** y pulsa en **Get Started** o **Join**.
3. Completa el registro creando tu contraseña para acceder a la plataforma.
4. Dentro del curso, navega a **Modules** -> **Learner Lab**.
5. Pulsa el botón **Start Lab**.  
   > ⏳ Espera hasta que el círculo situado junto a la etiqueta **AWS** pase de rojo/amarillo a **verde**.
6. Haz clic sobre el texto **AWS** (con el círculo verde) para abrir la **Consola de Administración de AWS**.
7. Verifica en la esquina superior derecha que la región activa sea **N. Virginia (`us-east-1`)**.

---

## Bloque 2: Aprovisionamiento de la Instancia EC2 (20 min)

### 1. Creación del Security Group
1. En el buscador superior de la consola de AWS, escribe **EC2** y entra en el panel.
2. En el menú lateral izquierdo, ve a **Network & Security** -> **Security Groups** (*Grupos de seguridad*).
3. Haz clic en **Create security group**.
   * **Security group name:** `sg-pizzeria`
   * **Description:** `Acceso web y SSH para despliegue DAW`
   * **VPC:** Mantén la seleccionada por defecto.
4. En **Inbound rules** (*Reglas de entrada*), pulsa **Add rule** y añade las siguientes 4 reglas:

| Tipo | Protocolo | Rango de puertos | Origen (Source) | Justificación |
| :--- | :--- | :--- | :--- | :--- |
| **SSH** | TCP | `22` | `0.0.0.0/0` (Anywhere-IPv4) | Gestión remota por consola |
| **HTTP** | TCP | `80` | `0.0.0.0/0` (Anywhere-IPv4) | Tráfico web comercial y API |
| **HTTPS** | TCP | `443` | `0.0.0.0/0` (Anywhere-IPv4) | Tráfico cifrado SSL/TLS |
| **Custom TCP** | TCP | `8082` | `0.0.0.0/0` (Anywhere-IPv4) | Gestor visual de BD (Adminer) |

5. Desplázate al final de la página y pulsa **Create security group**.

### 2. Lanzamiento de la Máquina Virtual
1. En el menú lateral izquierdo, ve a **Instances** -> **Launch instances**.
2. Configura los parámetros de la máquina:
   * **Name:** `Pizzeria-[TuNombre]`
   * **Application and OS Images (AMI):** Selecciona **Ubuntu** (`Ubuntu Server 24.04 LTS` o `22.04 LTS`, 64-bit x86).
   * **Instance type:** Selecciona **`t3.small`** (o `t2.small`). *(Recomendado: 2 GiB de memoria para compilar y ejecutar los 5 contenedores sin cuellos de botella)*.
   * **Key pair (login):** Selecciona `vockey`.
   * **Network settings:** Haz clic en **Edit** -> Marca **Select existing security group** -> Selecciona `sg-pizzeria`.
   * **Configure storage:** Cambia el tamaño del disco a **20 GiB** (gp3).
3. Pulsa el botón naranja **Launch instance**.

---

## Bloque 3: Fork del Proyecto y Conexión a la Máquina (15 min)

### 1. Fork en GitHub
1. Inicia sesión en tu cuenta personal de [GitHub](https://github.com).
2. Entra al repositorio base oficial:  
   `https://github.com/guillermofoix/pizzeria-base.git`
3. En la esquina superior derecha, haz clic en **Fork**.
4. Asegúrate de marcar **Copy the `main` branch only** y pulsa **Create fork**.
5. Ahora dispones de tu propia copia independiente en:  
   `https://github.com/TU_USUARIO/pizzeria-base`

### 2. Conexión a la Instancia
1. Vuelve a la consola de AWS -> **Instances**.
2. Espera a que el estado de tu instancia sea **Running**.
3. Selecciónala con el checkbox y haz clic en el botón superior **Connect**.
4. En la pestaña **EC2 Instance Connect**, pulsa el botón **Connect**. Se abrirá una terminal web de Linux en una pestaña nueva del navegador.

---

## Bloque 4: Despliegue de la Aplicación en AWS (35 min)

Ejecuta los siguientes comandos en la terminal de tu máquina virtual:

### 1. Instalación del Motor de Docker y Compose
```bash
# Descargar y ejecutar el instalador oficial de Docker
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
rm get-docker.sh

# Añadir el usuario ubuntu al grupo docker
sudo usermod -aG docker $USER

# Aplicar permisos al grupo sin cerrar la sesión
newgrp docker
```

Verifica la instalación con:
```bash
docker --version
docker compose version
```

---

### 2. Clonación de tu Fork
Clona tu propio repositorio bifurcado (sustituye `TU_USUARIO` por tu usuario real de GitHub):
```bash
git clone https://github.com/TU_USUARIO/pizzeria-base.git
cd pizzeria-base
```

---

### 3. Configuración de Variables de Entorno
Copia la plantilla `.env.example` para generar tu archivo `.env` de producción:
```bash
cp .env.example .env
```
*(Nota: El archivo ya viene preconfigurado con `HTTP_PORT=80` y `HTTPS_PORT=443`. Si deseas personalizar tu contraseña de PostgreSQL, puedes editarla con `nano .env` en la variable `DB_PASSWORD`)*.

---

### 4. Compilación y Arranque de Contenedores en Producción
Lanza el stack completo en segundo plano:
```bash
docker compose -f docker-compose.prod.yml up -d --build
```
> ⏳ El proceso descargará las imágenes base (PostgreSQL 16, Node 20, Nginx Alpine) y compilará la API y el Frontend. Suele tardar de 1 a 2 minutos.

---

### 5. Verificación de Servicios
Comprueba que los 5 contenedores estén en estado **Up**:
```bash
docker compose -f docker-compose.prod.yml ps
```

Si necesitas consultar los logs del backend o de la base de datos para depurar:
```bash
docker compose -f docker-compose.prod.yml logs -f backend
```
*(Pulsa `Ctrl + C` para salir de la vista de logs)*.

---

## Bloque 5: Comprobación en Navegador y URLs de Producción

Obtén la IP pública de tu máquina EC2 ejecutando:
```bash
curl -s ifconfig.me
```

Abre tu navegador habitual (en PC o teléfono móvil) y accede a las siguientes rutas:

| Servicio | URL de Acceso | Descripción |
| :--- | :--- | :--- |
| **Portal Web & Cocina KDS** | `http://<TU_IP_PUBLICA>` | Menú comercial, toma de comandas y pantalla táctil de cocina. |
| **API REST Healthcheck** | `http://<TU_IP_PUBLICA>/api/health` | Diagnóstico de salud; debe responder `status: UP` y `connected: true`. |
| **WebApp Móvil Clientes** | `http://<TU_IP_PUBLICA>/app/` | Aplicación PWA para clientes y lectura de QR en mesas. |
| **Gestor Visual Adminer** | `http://<TU_IP_PUBLICA>:8082` | Gestor web de PostgreSQL (Servidor: `db`, Usuario: `pizzeria_user`). |

---

## Bloque 6: Cierre de la Sesión y Persistencia (Importante)

Para evitar consumir créditos de forma innecesaria en AWS Academy sin perder tus datos:

1. **NO ejecutes `docker compose down -v`:** El volumen `pizzeria_prod_pgdata` almacena las pizzas y pedidos creados. Si destruyes los volúmenes perderás los cambios.
2. Si deseas pausar los contenedores en la máquina:
   ```bash
   docker compose -f docker-compose.prod.yml stop
   ```
3. En la consola de AWS: Selecciona tu instancia -> **Instance state** -> **Stop instance** (*Detener instancia*).
4. En el panel de Canvas / AWS Academy: Pulsa en **End Lab** o **Stop Lab**.
