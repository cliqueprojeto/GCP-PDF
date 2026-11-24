import java.util.Properties

plugins {
    id("com.android.application")
}

// One version for every platform: read from the desktop package.json.
val packageJson = rootProject.file("../package.json").readText()
val appVersion = Regex("\"version\"\\s*:\\s*\"([^\"]+)\"").find(packageJson)!!.groupValues[1]
val versionParts = appVersion.split('.', '-').take(3).map { it.toIntOrNull() ?: 0 }
val appVersionCode = 1_000_000 + versionParts[0] * 100_000 + versionParts[1] * 1_000 + versionParts[2] * 10

// Release signing comes from android/signing.properties (private, ignored by Git):
// storeFile=/absolute/path.jks, storePassword=…, keyAlias=…, keyPassword=…
val signing = Properties().apply {
    val file = rootProject.file("signing.properties")
    if (file.isFile) file.inputStream().use { load(it) }
}

android {
    namespace = "br.com.gestaoculturalpro.pdf"
    compileSdk = 36

    defaultConfig {
        applicationId = "br.com.gestaoculturalpro.pdf"
        minSdk = 26
        targetSdk = 36
        versionCode = appVersionCode
        versionName = appVersion
    }

    signingConfigs {
        if (signing.getProperty("storeFile") != null) {
            create("release") {
                storeFile = file(signing.getProperty("storeFile"))
                storePassword = signing.getProperty("storePassword")
                keyAlias = signing.getProperty("keyAlias")
                keyPassword = signing.getProperty("keyPassword")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            isShrinkResources = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            signingConfigs.findByName("release")?.let { signingConfig = it }
        }
    }

    splits {
        abi {
            // One universal APK (shared by link or file) plus smaller per-ABI APKs.
            isEnable = providers.gradleProperty("gcp.splitAbi").orNull == "true"
            reset()
            include("arm64-v8a", "armeabi-v7a", "x86_64")
            isUniversalApk = true
        }
    }

    packaging {
        // The editing engine is an executable shipped as lib*.so: it must exist as a real file.
        jniLibs { useLegacyPackaging = true }
    }

    androidResources {
        // Dictionaries, OCR models, fonts and the web app are read in place, not inflated.
        noCompress += listOf("gz", "traineddata", "ttf", "otf", "wasm", "bcmap", "pfb", "woff2")
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        abortOnError = true
        checkReleaseBuilds = true
    }
}

dependencies {
    implementation("androidx.core:core-ktx:1.17.0")
    implementation("androidx.activity:activity-ktx:1.11.0")
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.core:core-splashscreen:1.0.1")
    implementation("androidx.exifinterface:exifinterface:1.4.1")
}
