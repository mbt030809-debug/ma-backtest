plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

android {
    namespace = "com.koolon.backtest"
    compileSdk = 34
    signingConfigs {
        // 고정 키: 빌드마다 서명이 같아야 덮어쓰기 설치(업데이트)가 됨
        getByName("debug") {
            storeFile = file("backtest-debug.jks")
            storePassword = "backtest1234"
            keyAlias = "backtest"
            keyPassword = "backtest1234"
        }
    }
    defaultConfig {
        applicationId = "com.koolon.backtest"
        minSdk = 26
        targetSdk = 34
        versionCode = (System.getenv("GITHUB_RUN_NUMBER") ?: "1").toInt()
        versionName = "1.0"
    }
    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
}
