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
        // Above the probe's 1: installs over it (same package, same debug key).
        versionCode = 3
        versionName = "0.2.1"
    }

    buildTypes {
        release {
            isMinifyEnabled = false
        }
    }

    buildFeatures {
        buildConfig = true
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    lint {
        // Built offline by hand; lint runs by hand too (README).
        checkReleaseBuilds = false
        abortOnError = false
    }
}

kotlin {
    compilerOptions {
        jvmTarget.set(org.jetbrains.kotlin.gradle.dsl.JvmTarget.JVM_17)
    }
}

// Plain Android views and the platform's own APIs, no AndroidX. OkHttp for the WebSocket: the
// same version the staff app's build already put in the Gradle cache, so it builds offline.
configurations.configureEach {
    // Empty shells since Kotlin 1.8 (kotlin-stdlib 2.1.20 holds their classes); OkHttp asks for
    // versions the offline cache does not have.
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk7")
    exclude(group = "org.jetbrains.kotlin", module = "kotlin-stdlib-jdk8")
}

dependencies {
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    testImplementation("junit:junit:4.13.2")
    // The JVM tests parse frames with org.json, which android.jar has only as stubs.
    testImplementation("org.json:json:20180813")
}
