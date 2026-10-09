import java.net.URI

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// Supply only the public application URL. API keys stay on the server.
val configuredUrl = providers.gradleProperty("APP_URL").orElse("").get()
val appUri = runCatching { URI(configuredUrl) }.getOrNull()
require(appUri != null && appUri.scheme == "https" && appUri.host != null &&
    appUri.rawUserInfo == null && appUri.rawFragment == null && appUri.rawQuery == null &&
    appUri.port in listOf(-1, 443) && !appUri.host.endsWith(".invalid") &&
    !appUri.host.equals("localhost", ignoreCase = true)) {
    "Set -PAPP_URL=https://YOUR-DEPLOYED-APP-HOST/ to a real HTTPS origin. HTTP, credentials, queries, fragments, non-443 ports and placeholder hosts are rejected."
}
val verifiedAppUrl = appUri.toASCIIString()
require(!verifiedAppUrl.contains('"') && !verifiedAppUrl.contains('\\') &&
    !verifiedAppUrl.any { it.code < 32 }) { "APP_URL contains unsafe characters." }

android {
    namespace = "com.aibotjock.familymedicinestudycoach"
    compileSdk = 36
    defaultConfig {
        applicationId = "com.aibotjock.familymedicinestudycoach"
        minSdk = 26
        targetSdk = 36
        versionCode = 1
        versionName = "1.1.0"
        buildConfigField("String", "APP_URL", "\"$verifiedAppUrl\"")
        buildConfigField("String", "PLAY_PRODUCT_ID", "\"family_medicine_monthly\"")
    }
    buildFeatures { buildConfig = true }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            // Signing is deliberately supplied by the owner in Android Studio.
        }
    }
}

dependencies {
    implementation("androidx.webkit:webkit:1.17.1")
    implementation("com.android.billingclient:billing:8.3.0")
}
