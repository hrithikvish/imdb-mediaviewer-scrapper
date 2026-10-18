package org.hrithikvish.scraper.data.datasource

import com.microsoft.playwright.Browser
import com.microsoft.playwright.BrowserType
import com.microsoft.playwright.Page
import com.microsoft.playwright.Playwright
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.MediaType
import org.hrithikvish.scraper.domain.model.ScraperException
import java.util.Collections
import java.util.concurrent.CopyOnWriteArrayList

/**
 * Intercepts real browser network traffic using Playwright.
 * This directly replicates the Chrome DevTools Network Tab media/images filter in Kotlin.
 */
class NetworkSnifferDataSource {

    /**
     * Navigates to [url] in a headless browser, waits for network idle,
     * and returns all captured media responses.
     */
    suspend fun extractMedia(url: String, timeoutMs: Double = 45000.0): List<MediaItem> {
        val captured = CopyOnWriteArrayList<MediaItem>()

        try {
            Playwright.create().use { playwright ->
                val browser = launchBrowser(playwright)
                val context = browser.newContext(
                    Browser.NewContextOptions()
                        .setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                        .setViewportSize(1440, 900)
                )

                // Bypass navigator.webdriver detection for AWS WAF & anti-bot
                context.addInitScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")
                val page = context.newPage()

                // DevTools Network Tab listener: intercepts all media/image responses
                page.onResponse { response ->
                    val item = parseNetworkResponse(response)
                    if (item != null) {
                        captured.add(item)
                    }
                }

                println("🌐 [SNIFFER] Loading page in browser: $url...")
                page.navigate(url, Page.NavigateOptions().setTimeout(timeoutMs))

                // Wait for the gallery container or images to appear
                runCatching {
                    page.waitForSelector("img, [data-testid], main", Page.WaitForSelectorOptions().setTimeout(15000.0))
                }

                println("📜 [SNIFFER] Scrolling page to trigger lazy-loaded photos...")
                // Scroll progressively to trigger all lazy-loaded image network requests in the gallery
                runCatching {
                    for (step in 1..6) {
                        page.evaluate("window.scrollBy(0, window.innerHeight * 1.5)")
                        page.waitForTimeout(700.0)
                    }
                }

                // Wait for network requests to settle
                runCatching {
                    page.waitForLoadState(
                        com.microsoft.playwright.options.LoadState.NETWORKIDLE,
                        Page.WaitForLoadStateOptions().setTimeout(6000.0)
                    )
                }

                // Extract all photos directly from DOM elements
                val domImages = page.querySelectorAll("img").mapNotNull { imgEl ->
                    val src = imgEl.getAttribute("src") ?: imgEl.getAttribute("data-src")
                    if (!src.isNullOrBlank() && (src.startsWith("http://") || src.startsWith("https://"))) {
                        val width = imgEl.getAttribute("width")?.toIntOrNull()
                        val height = imgEl.getAttribute("height")?.toIntOrNull()
                        val alt = imgEl.getAttribute("alt")
                        MediaItem(
                            url = cleanImdbImageUrl(src),
                            type = MediaType.IMAGE,
                            mimeType = "image/jpeg",
                            title = alt,
                            width = width,
                            height = height,
                            metadata = mapOf("source" to "browser_dom")
                        )
                    } else null
                }
                captured.addAll(domImages)

                // Also extract all photos from Next.js __NEXT_DATA__ rendered in the page
                runCatching {
                    val pageContent = page.content()
                    val imdbExtractor = ImdbJsonDataSource()
                    val nextDataItems = imdbExtractor.extractFromHtml(pageContent, url)
                    println("📦 [SNIFFER] Extracted ${nextDataItems.size} photos from Next.js gallery data")
                    captured.addAll(nextDataItems)
                }

                browser.close()
            }
        } catch (e: Exception) {
            if (e is ScraperException) throw e
            throw ScraperException.BrowserException(
                "Playwright network interception failed: ${e.message}",
                e
            )
        }

        val isImdb = url.contains("imdb.com", ignoreCase = true)
        val validItems = if (isImdb) {
            // Keep strictly movie media photos hosted on m.media-amazon.com/images/M/ (excluding UI favicons/banners in /G/)
            captured.filter { it.url.contains("m.media-amazon.com/images/M/") }
        } else {
            captured
        }

        return validItems
            .distinctBy { cleanImdbImageUrl(it.url) }
            .map { it.copy(url = cleanImdbImageUrl(it.url)) }
    }

    private fun cleanImdbImageUrl(url: String): String {
        val regex = Regex("\\._V1_.*(\\.[a-zA-Z]+)$")
        return if (regex.containsMatchIn(url)) {
            regex.replace(url) { matchResult ->
                val ext = matchResult.groupValues[1]
                "._V1_$ext"
            }
        } else {
            url
        }
    }

    /**
     * Streams intercepted media items reactively as they arrive over the wire.
     */
    fun streamMedia(url: String): Flow<MediaItem> = callbackFlow {
        var playwright: Playwright? = null
        var browser: Browser? = null

        try {
            playwright = Playwright.create()
            browser = launchBrowser(playwright)
            val page = browser.newPage()

            page.onResponse { response ->
                val item = parseNetworkResponse(response)
                if (item != null) {
                    trySend(item)
                }
            }

            page.navigate(url)
            page.waitForLoadState()
        } catch (e: Exception) {
            close(ScraperException.BrowserException("Error streaming network responses: ${e.message}", e))
        }

        awaitClose {
            runCatching { browser?.close() }
            runCatching { playwright?.close() }
        }
    }

    private fun launchBrowser(playwright: Playwright): Browser {
        val launchOptions = BrowserType.LaunchOptions()
            .setHeadless(true)
            .setArgs(
                listOf(
                    "--disable-blink-features=AutomationControlled",
                    "--no-sandbox",
                    "--disable-setuid-sandbox"
                )
            )

        val localBrowser = findLocalBrowserExecutable()
        if (localBrowser != null) {
            launchOptions.setExecutablePath(localBrowser.toPath())
        }

        return playwright.chromium().launch(launchOptions)
    }

    private fun findLocalBrowserExecutable(): java.io.File? {
        val candidates = listOf(
            "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
            "/Applications/Brave Browser.app/Contents/MacOS/Brave Browser",
            "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
            "/Applications/Chromium.app/Contents/MacOS/Chromium",
            "/usr/bin/google-chrome",
            "/usr/bin/chromium",
            "/usr/bin/chromium-browser"
        )
        return candidates.map { java.io.File(it) }.firstOrNull { it.exists() && it.canExecute() }
    }

    /**
     * Inspects a Playwright network response, replicating DevTools Network tab resource filtering.
     */
    private fun parseNetworkResponse(response: com.microsoft.playwright.Response): MediaItem? {
        val request = response.request()
        val resourceType = request.resourceType().lowercase()
        val contentType = response.headers()["content-type"]?.lowercase() ?: ""
        val url = response.url()

        val isImage = resourceType == "image" || contentType.startsWith("image/")
        val isVideo = resourceType == "media" || contentType.startsWith("video/")
        val isAudio = contentType.startsWith("audio/")

        if (!isImage && !isVideo && !isAudio) {
            // Also check URL extension as a heuristic
            val extensionType = MediaType.fromExtension(url)
            if (extensionType == MediaType.UNKNOWN) return null
        }

        val type = when {
            isImage -> MediaType.IMAGE
            isVideo -> MediaType.VIDEO
            isAudio -> MediaType.AUDIO
            else -> MediaType.fromExtension(url)
        }

        val contentLength = response.headers()["content-length"]?.toLongOrNull()

        return MediaItem(
            url = url,
            type = type,
            mimeType = contentType.substringBefore(';').trim().ifBlank { null },
            sizeBytes = contentLength,
            metadata = mapOf(
                "status" to response.status().toString(),
                "resourceType" to resourceType,
                "sniffer" to "playwright_network_tab"
            )
        )
    }
}
