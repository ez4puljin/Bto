plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "mn.bto.callbridge"
    compileSdk = 36

    defaultConfig {
        applicationId = "mn.bto.callbridge"
        // RoleManager.ROLE_DIALER needs Android 10.
        minSdk = 29
        targetSdk = 36
        versionCode = 1
        versionName = "0.1-probe"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // The probe is built offline by hand; lint would fetch its own rule jars.
        checkReleaseBuilds = false
        abortOnError = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Plain Android views and the platform's own APIs only: no AndroidX, nothing else to download.
dependencies {
    testImplementation("junit:junit:4.13.2")
}
