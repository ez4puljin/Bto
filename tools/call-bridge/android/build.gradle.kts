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
    }
}
