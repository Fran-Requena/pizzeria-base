import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.androidApplication)
    alias(libs.plugins.composeCompiler)
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_11
    }
}

// URL del servidor fijada al compilar. Viene de la variable de entorno URL_SERVIDOR (en el
// CI, la variable de repositorio del mismo nombre; ver app/README.md). Vacía o ausente:
// APK genérico, que pide el servidor en la configuración.
val urlServidor: String = providers.environmentVariable("URL_SERVIDOR").orElse("").get().trim()
if (urlServidor.isNotEmpty() &&
    (!urlServidor.startsWith("https://") || urlServidor.any { it.isWhitespace() || it == '"' || it == '\\' })
) {
    throw GradleException(
        "URL_SERVIDOR no es válida: debe empezar por https:// y no llevar espacios ni comillas " +
            "(valor recibido: $urlServidor)."
    )
}
dependencies {
    implementation(project(":shared"))

    implementation(libs.androidx.activity.compose)

    implementation(libs.compose.uiToolingPreview)
    debugImplementation(libs.compose.uiTooling)
}

android {
    namespace = "es.fpmola.pizzeria"
    compileSdk = libs.versions.android.compileSdk.get().toInt()

    defaultConfig {
        applicationId = "es.fpmola.pizzeria"
        minSdk = libs.versions.android.minSdk.get().toInt()
        targetSdk = libs.versions.android.targetSdk.get().toInt()
        versionCode = 1
        versionName = "1.0"
        buildConfigField("String", "URL_SERVIDOR", "\"$urlServidor\"")
    }
    packaging {
        resources {
            excludes += "/META-INF/{AL2.0,LGPL2.1}"
        }
    }
    buildTypes {
        release {
            isMinifyEnabled = false
            proguardFiles(
                getDefaultProguardFile("proguard-android-optimize.txt"),
                "proguard-rules.pro"
            )
        }
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_11
        targetCompatibility = JavaVersion.VERSION_11
    }
    buildFeatures {
        compose = true
        buildConfig = true
    }
}