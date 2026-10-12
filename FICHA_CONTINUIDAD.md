# Ficha de continuidad: presupuesto, parada y arranque del laboratorio

Esta ficha es **el único sitio** donde se escribe el presupuesto y las rutinas de parada y
arranque. El resto de guías enlazan aquí; si algo cambia, se corrige solo en este archivo.

## 1. Presupuesto

| Dato | Valor |
| :--- | :--- |
| Presupuesto por laboratorio (AWS Academy Learner Lab) | **50 $** |
| Duración de una sesión del laboratorio | 4 horas (se puede volver a pulsar **Start Lab**) |

Consulta el saldo restante en el panel de Vocareum (**AWS Details** o el indicador de créditos).
Si llegas al 80 % del saldo, avisa al profesor antes de crear nada nuevo.

## 2. Consumo aproximado

Cifras orientativas en la región `us-east-1`. [POR VERIFICAR EN LAB LIMPIO] con el saldo real
de Vocareum antes y después de un día de uso.

| Componente | Encendido 24/7 (por día) | Parado |
| :--- | :--- | :--- |
| EC2 `t3.small` (≈ 0,0208 $/h) | ≈ 0,50 $ | solo el disco EBS (≈ 0,05 $) |
| RDS `db.t4g.micro` | ≈ 0,40 $ | solo el almacenamiento (≈ 0,08 $) |
| Discos y copias automáticas (20 GiB + 20 GiB) | ≈ 0,15 $ | ≈ 0,15 $ |
| **Total aproximado** | **≈ 1 $ al día (≈ 7 $ a la semana)** | **≈ 0,3 $ al día** |

Con esas cifras, los 50 $ dan para unas 7 semanas con todo encendido 24/7 y para varios meses si
lo paras al terminar cada sesión. **Lo que más gasta es dejar RDS y la EC2 encendidas sin usarlas.**

## 3. Al terminar la sesión (parada)

1. **Detén la instancia RDS** (consola de AWS → RDS → `pizzeria-db` → **Acciones** → **Detener temporalmente**).
2. **Detén la instancia EC2** (consola de AWS → EC2 → **Estado de la instancia** → **Detener instancia**).
3. Cierra la pestaña. **NUNCA pulses «End Lab»**: borraría la EC2, los discos y la base de datos.

No hace falta parar los contenedores a mano. Al detener la EC2, Docker los apaga limpiamente.

> **Importante:** AWS **vuelve a encender sola** una instancia RDS parada a los **7 días**. Si no
> la vas a usar en más de una semana, anota la fecha y vuelve a detenerla, o te seguirá gastando
> saldo sin que te des cuenta.

## 4. Al empezar la sesión (arranque)

1. En Vocareum pulsa **Start Lab** y espera al indicador verde.
2. **Arranca primero RDS** (**Acciones** → **Iniciar**) y espera a que esté **Disponible** (unos minutos).
3. Arranca la EC2. Su IP pública **cambia**; da igual, la web entra por tu subdominio.
4. Espera 1 o 2 minutos y comprueba que los contenedores han vuelto solos:
   ```bash
   docker ps --format "table {{.Names}}\t{{.Status}}"
   ```
   Todos los servicios usan `restart: unless-stopped`, así que Docker los levanta al arrancar la
   máquina. Deben aparecer `pizzeria-prod-backend`, `pizzeria-prod-web`, `pizzeria-prod-qr`,
   `pizzeria-prod-tunnel`, `pizzeria-prod-dbgate`.
5. **Si falta alguno** es porque lo habías detenido tú con `docker compose ... stop` o `docker stop`
   (`unless-stopped` respeta esa orden). Levántalos con:
   ```bash
   cd ~/pizzeria-base
   docker compose -f docker-compose.db.yml up -d dbgate
   docker compose -f docker-compose.app.yml up -d
   ```
6. Si la web da un error de Cloudflare (530 o 1033), espera 30 segundos: el túnel tarda en registrarse.

## 5. Qué sobrevive a detener y arrancar

| Recurso | ¿Se conserva? |
| :--- | :--- |
| Disco de la EC2, repositorio, `.env` y `.htpasswd` | Sí |
| Datos de la base de datos (RDS) | Sí |
| Contenedores e imágenes de Docker | Sí |
| Dirección IP pública de la EC2 | **No** (cambia; el túnel lo resuelve) |
| Todo, si pulsas **End Lab** | **No** |
