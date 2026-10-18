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
import org.hrithikvish.scraper.domain.model.cleanImdbImageUrl
import org.hrithikvish.scraper.domain.usecase.ExtractedTitle
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

                val targetUrl = if (url.contains("imdb.com") && url.contains("/title/")) {
                    val idMatch = Regex("(tt\\d+)").find(url)
                    if (idMatch != null) "https://www.imdb.com/title/${idMatch.value}/mediaindex/" else url
                } else {
                    url
                }

                println("🌐 [SNIFFER] Loading page in browser: $targetUrl...")
                page.navigate(targetUrl, Page.NavigateOptions().setTimeout(timeoutMs))

                // Wait for the gallery container or images to appear
                runCatching {
                    page.waitForSelector("img, [data-testid], main", Page.WaitForSelectorOptions().setTimeout(15000.0))
                }

                println("📜 [SNIFFER] Loading complete gallery photos...")
                scrollGallery(page)

                // Wait for network requests to settle
                runCatching {
                    page.waitForLoadState(
                        com.microsoft.playwright.options.LoadState.NETWORKIDLE,
                        Page.WaitForLoadStateOptions().setTimeout(4000.0)
                    )
                }

                // If this is an IMDb mediaindex page, extract exclusively from the movie gallery container
                // to exclude unrelated images (Editorial lists, User lists, User polls, More to explore)
                val isMediaIndex = targetUrl.contains("/mediaindex")
                val galleryElements = if (isMediaIndex) extractGalleryImages(page) else emptyList()

                val validItems = if (galleryElements.isNotEmpty()) {
                    println("🎯 [SNIFFER] Filtered strictly to ${galleryElements.size} official gallery images (excluded editorial/user lists/polls)")
                    galleryElements
                } else {
                    // Extract all photos directly from DOM elements as fallback
                    captured.addAll(extractDomImages(page))

                    // Also extract all photos from Next.js __NEXT_DATA__ rendered in the page
                    runCatching {
                        val pageContent = page.content()
                        val imdbExtractor = ImdbJsonDataSource()
                        val nextDataItems = imdbExtractor.extractFromHtml(pageContent, url)
                        println("📦 [SNIFFER] Extracted ${nextDataItems.size} photos from Next.js gallery data")
                        captured.addAll(nextDataItems)
                    }

                    val isImdb = url.contains("imdb.com", ignoreCase = true)
                    if (isImdb) {
                        captured.filter { it.url.contains("m.media-amazon.com/images/M/") }
                    } else {
                        captured
                    }
                }

                browser.close()
                return validItems
                    .distinctBy { cleanImdbImageUrl(it.url) }
                    .map { it.copy(url = cleanImdbImageUrl(it.url)) }
            }
        } catch (e: Exception) {
            if (e is ScraperException) throw e
            throw ScraperException.BrowserException(
                "Playwright network interception failed: ${e.message}",
                e
            )
        }
    }

    private fun scrollGallery(page: Page, maxIterations: Int = 15) {
        var lastPhotoCount = 0
        var noGrowthIterations = 0
        for (step in 1..maxIterations) {
            val currentCount = page.querySelectorAll("a[href*='/mediaviewer/rm'] img").size
            if (currentCount == lastPhotoCount && currentCount > 0) {
                noGrowthIterations++
                if (noGrowthIterations >= 2) break
            } else {
                noGrowthIterations = 0
                lastPhotoCount = currentCount
            }

            runCatching {
                page.evaluate("""
                    const loader = document.querySelector('.img_gallery_pagination_loader');
                    if (loader) {
                        loader.scrollIntoView();
                    } else {
                        window.scrollBy(0, window.innerHeight * 2);
                    }
                """)
                page.waitForTimeout(1000.0)
            }
        }
    }

    private fun extractGalleryImages(page: Page): List<MediaItem> {
        val galleryElements = page.querySelectorAll(
            "[data-testid='sub-section-images'] a[href*='/mediaviewer/rm'] img, [data-testid='section-images'] a[href*='/mediaviewer/rm'] img, a[href*='/mediaviewer/rm'] img"
        )
        return galleryElements.mapNotNull { imgEl ->
            val src = imgEl.getAttribute("src") ?: imgEl.getAttribute("data-src")
            if (!src.isNullOrBlank() && src.contains("m.media-amazon.com/images/M/")) {
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
                    metadata = mapOf("source" to "gallery_dom")
                )
            } else null
        }
    }

    private fun extractDomImages(page: Page): List<MediaItem> {
        return page.querySelectorAll("img").mapNotNull { imgEl ->
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
    }

    /**
     * Reuses a single Playwright Chromium session to batch-scrape multiple IMDb titles,
     * maintaining cookies and clearing WAF hurdles across all navigations.
     */
    suspend fun extractBatchMedia(
        titles: List<ExtractedTitle>,
        forceReScrape: Boolean = false,
        timeoutMs: Double = 35000.0,
        onTitleResult: suspend (ExtractedTitle, List<MediaItem>, Long) -> Unit
    ) {
        val titlesToScrape = if (forceReScrape) {
            titles
        } else {
            titles.filter { title ->
                val existing = java.io.File("docs/titles/${title.id}.json")
                if (existing.exists() && existing.length() > 500) {
                    println("⏩ [SKIP] ${title.name ?: title.id} (${title.id}) already scraped.")
                    false
                } else {
                    true
                }
            }
        }

        if (titlesToScrape.isEmpty()) {
            println("✨ All titles in batch are already scraped and present in docs/titles/.")
            return
        }

        println("🚀 Launching headless browser to batch scrape ${titlesToScrape.size} titles...")

        Playwright.create().use { playwright ->
            val browser = launchBrowser(playwright)
            try {
                val context = browser.newContext(
                    Browser.NewContextOptions()
                        .setUserAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36")
                        .setViewportSize(1440, 900)
                )
                context.addInitScript("Object.defineProperty(navigator, 'webdriver', {get: () => undefined})")

                for ((index, title) in titlesToScrape.withIndex()) {
                    val mediaindexUrl = "https://www.imdb.com/title/${title.id}/mediaindex/"
                    println("\n🎬 [${index + 1}/${titlesToScrape.size}] Scraping full gallery for ${title.name ?: title.id} (${title.id})...")

                    val startTime = System.currentTimeMillis()
                    val captured = CopyOnWriteArrayList<MediaItem>()
                    val page = context.newPage()

                    try {
                        page.onResponse { response ->
                            val item = parseNetworkResponse(response)
                            if (item != null) captured.add(item)
                        }

                        page.navigate(mediaindexUrl, Page.NavigateOptions().setTimeout(timeoutMs))

                        runCatching {
                            page.waitForSelector("img, [data-testid], main", Page.WaitForSelectorOptions().setTimeout(10000.0))
                        }

                        scrollGallery(page)

                        val galleryElements = extractGalleryImages(page)
                        val validItems = if (galleryElements.isNotEmpty()) {
                            galleryElements.distinctBy { cleanImdbImageUrl(it.url) }
                        } else {
                            captured.addAll(extractDomImages(page))
                            captured
                                .filter { it.url.contains("m.media-amazon.com/images/M/") }
                                .distinctBy { cleanImdbImageUrl(it.url) }
                                .map { it.copy(url = cleanImdbImageUrl(it.url)) }
                        }

                        val duration = System.currentTimeMillis() - startTime
                        println("✅ [${index + 1}/${titlesToScrape.size}] Found ${validItems.size} photos for ${title.name ?: title.id} (${duration}ms)")
                        onTitleResult(title, validItems, duration)
                    } catch (e: Exception) {
                        System.err.println("⚠️ [WARN] Error during scrape of ${title.id}: ${e.message}")
                        val duration = System.currentTimeMillis() - startTime
                        val validItems = captured
                            .filter { it.url.contains("m.media-amazon.com/images/M/") }
                            .distinctBy { cleanImdbImageUrl(it.url) }
                            .map { it.copy(url = cleanImdbImageUrl(it.url)) }
                        onTitleResult(title, validItems, duration)
                    } finally {
                        runCatching { page.close() }
                    }

                    // Polite delay between requests to stay under rate limits
                    kotlinx.coroutines.delay(400)
                }
            } finally {
                browser.close()
            }
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
