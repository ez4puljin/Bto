// The same Android Gradle Plugin and Kotlin as the staff app's build (apps/mobile), so the
// Gradle cache in ~/Android/gradle already holds them and the build works offline.
buildscript {
    repositories {
        google()
        mavenCentral()
    }
    dependencies {
        classpath("com.android.tools.build:gradle:8.12.0")
        classpath("org.jetbrains.kotlin:kotlin-gradle-plugin:2.1.20")
    }
}

allprojects {
    repositories {
        google()
        mavenCentral()
        // OkHttp 4.12.0 and Okio 3.6.0 sit in ~/Android/gradle's cache under the Plugin Portal
        // (the staff app's build tools fetched them there), so the build stays offline.
        gradlePluginPortal {
            content { includeGroup("com.squareup.okhttp3"); includeGroup("com.squareup.okio") }
        }
    }
}
