This is a Kotlin Multiplatform project targeting Android.

* [/shared](./shared/src) is for code that will be shared across your Compose Multiplatform applications.
  It contains several subfolders:
  - [commonMain](./shared/src/commonMain/kotlin) is for code that’s common for all targets.
  - Other folders are for Kotlin code that will be compiled for only the platform indicated in the folder name.
    For example, if you want to use Apple’s CoreCrypto for the iOS part of your Kotlin app,
    the [iosMain](./shared/src/iosMain/kotlin) folder would be the right place for such calls.
    Similarly, if you want to edit the Desktop (JVM) specific part, the [jvmMain](./shared/src/jvmMain/kotlin)
    folder is the appropriate location.

### Running the apps

Use the run configurations provided by the run widget in your IDE's toolbar. You can also use these commands and options:

- Android app: `./gradlew :androidApp:assembleDebug`

### Running tests

Use the run button in your IDE's editor gutter, or run tests using Gradle tasks:

- Android tests: `./gradlew :shared:testAndroidHostTest`

---

Learn more about [Kotlin Multiplatform](https://www.jetbrains.com/help/kotlin-multiplatform-dev/get-started.html)…

---

## Servidor de la app (guía para cada alumno)

Cada alumno compila su propio APK en su propio repositorio, y la app debe apuntar a **su**
servidor (por ejemplo `https://dam-01.guillermofoix.org`). Hay dos formas:

- **Recomendada: fijarlo al compilar.** El APK trae el servidor y la app arranca sin pedirlo.
- **APK genérico:** si no se define nada, la app pide el servidor en su pantalla de
  configuración la primera vez.

### Cómo fijar el servidor en GitHub (una sola vez por repositorio)

1. Abre **tu** repositorio en GitHub.
2. Entra en **Settings** (Configuración).
3. En el menú de la izquierda: **Secrets and variables** → **Actions**.
4. Abre la pestaña **Variables** (no la de *Secrets*: la dirección no es secreta).
5. Pulsa **New repository variable**.
6. Nombre: `URL_SERVIDOR` (exactamente así, en mayúsculas).
7. Valor: la dirección de tu servidor, **empezando por `https://`** y sin espacios, comillas
   ni parámetros. Por ejemplo: `https://dam-01.guillermofoix.org`
8. Pulsa **Add variable**.
9. Lanza de nuevo el workflow *App Android* (en la pestaña **Actions**, **Run workflow**, o con un
   nuevo push). Descarga el APK nuevo: el anterior sigue llevando el valor antiguo.

Si cambias el valor de la variable, hay que compilar otro APK.

### Qué comprueba el CI

- Sin la variable (o vacía): se compila el APK genérico y el CI lo indica en el registro.
- Con un valor que no empiece por `https://` o que lleve espacios o comillas: **el CI falla** en el
  paso *Comprobar la variable URL_SERVIDOR* con el mensaje «URL_SERVIDOR no es válida».

### Qué servidor usa la app al arrancar

La app resuelve la dirección en este orden:

1. La que está **guardada en el teléfono** (si alguien la cambió en *Ajustes del servidor*).
2. La **fijada al compilar** (`URL_SERVIDOR`).
3. Ninguna: pide la dirección en la pantalla de configuración.

Con el servidor fijado al compilar, la app **no** propone cambiar de servidor: si no responde,
muestra el motivo y un botón **Reintentar**. Queda un enlace discreto «Ajustes del servidor» en el
inicio. Si una instalación antigua dejó guardada otra dirección en el teléfono, esa tiene prioridad:
se corrige desde ese enlace o borrando los datos de la app.

### Probarlo en local (opcional)

Con el JDK instalado, la variable se lee del entorno al compilar:
`URL_SERVIDOR=https://dam-01.guillermofoix.org ./gradlew :androidApp:assembleDebug`

### Pantalla de diagnóstico

Sirve para ver, sin herramientas de desarrollo, qué hace la app. Se abre desde el inicio:
**Ajustes del servidor** (o **Cambiar servidor**) → **Diagnóstico** (enlace pequeño al final).

Muestra:

- **Versión de la app** y el **hash corto del commit** con el que se compiló (el CI lo pasa en la
  variable `COMMIT_SHA`; en una compilación local aparece `local`).
- **Servidor activo** y su **origen**: guardado en el teléfono, fijado al compilar o ninguno.
- **Pedido guardado**: el número del pedido que la app sigue, o «ninguno».
- **Última comprobación al arrancar**: qué decidió (sin pedido, pedido vivo, terminado, no existe,
  sin conexión…), a qué hora y si olvidó el número del pedido y por qué.
- **Últimos sucesos** (los 80 más recientes, aunque la app se haya cerrado): proceso iniciado,
  actividad creada/visible/en segundo plano/destruida, pedido creado, número guardado, pago
  iniciado, navegación al seguimiento, números olvidados…

No muestra datos personales (ni nombre, ni teléfono, ni dirección): solo números de pedido, estados,
códigos y direcciones del servidor. El botón **Borrar sucesos** vacía el historial.
