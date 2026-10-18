plugins {
    kotlin("jvm") version "2.2.21"
    kotlin("plugin.serialization") version "2.2.21"
    application
}

group = "org.hrithikvish"
version = "1.0-SNAPSHOT"

application {
    mainClass.set("org.hrithikvish.MainKt")
}

repositories {
    mavenCentral()
}

dependencies {
    // Coroutines & Reactive Architecture
    implementation("org.jetbrains.kotlinx:kotlinx-coroutines-core:1.9.0")

    // HTTP & Networking
    implementation("com.squareup.okhttp3:okhttp:4.12.0")
    implementation("com.squareup.okhttp3:logging-interceptor:4.12.0")

    // HTML Parsing
    implementation("org.jsoup:jsoup:1.18.3")

    // Serialization
    implementation("org.jetbrains.kotlinx:kotlinx-serialization-json:1.7.3")

    // Headless Browser for Network Tab Interception
    implementation("com.microsoft.playwright:playwright:1.49.0")

    // Logging
    implementation("org.slf4j:slf4j-simple:2.0.16")

    // Testing
    testImplementation(kotlin("test"))
    testImplementation("org.jetbrains.kotlinx:kotlinx-coroutines-test:1.9.0")
    testImplementation("io.mockk:mockk:1.13.13")
}

kotlin {
    jvmToolchain(17)
}

tasks.test {
    useJUnitPlatform()
}