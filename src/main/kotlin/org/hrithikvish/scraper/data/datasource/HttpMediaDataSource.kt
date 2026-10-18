package org.hrithikvish.scraper.data.datasource

import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup
import org.jsoup.nodes.Document
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.MediaType
import org.hrithikvish.scraper.domain.model.ScraperException
import java.io.IOException
import java.net.URI
import java.util.concurrent.TimeUnit

/**
 * Extracts media by performing an HTTP GET request with OkHttp and parsing HTML via Jsoup.
 * Extracts <img>, <picture>, <source>, <video>, <audio>, and OpenGraph meta tags.
 */
class HttpMediaDataSource(
    private val client: OkHttpClient = defaultOkHttpClient()
) {

    companion object {
        fun defaultOkHttpClient(): OkHttpClient = OkHttpClient.Builder()
            .connectTimeout(15, TimeUnit.SECONDS)
            .readTimeout(20, TimeUnit.SECONDS)
            .followRedirects(true)
            .followSslRedirects(true)
            .build()

        private const val DEFAULT_USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }

    suspend fun extractMedia(targetUrl: String): List<MediaItem> {
        val html = fetchHtml(targetUrl)
        return parseHtml(html, targetUrl)
    }

    private fun fetchHtml(url: String): String {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", DEFAULT_USER_AGENT)
            .header("Accept", "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8")
            .header("Accept-Language", "en-US,en;q=0.9")
            .header("Sec-Ch-Ua", "\"Chromium\";v=\"122\", \"Not(A:Brand\";v=\"24\", \"Google Chrome\";v=\"122\"")
            .header("Sec-Ch-Ua-Mobile", "?0")
            .header("Sec-Ch-Ua-Platform", "\"macOS\"")
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful && response.code != 202) {
                    throw ScraperException.NetworkException("HTTP request failed with status ${response.code}: ${response.message}")
                }
                response.body?.string() ?: throw ScraperException.NetworkException("Response body is empty")
            }
        } catch (e: IOException) {
            throw ScraperException.NetworkException("Network error while connecting to $url: ${e.message}", e)
        }
    }

    fun parseHtml(html: String, baseUri: String): List<MediaItem> {
        val doc: Document = Jsoup.parse(html, baseUri)
        val items = mutableListOf<MediaItem>()

        // 1. <img> tags
        doc.select("img").forEach { img ->
            val rawSrc = img.attr("src")
                .ifBlank { img.attr("data-src") }
                .ifBlank { img.attr("data-original") }
            val src = resolveUrl(baseUri, rawSrc)

            if (!src.isNullOrBlank()) {
                val width = img.attr("width").toIntOrNull()
                val height = img.attr("height").toIntOrNull()
                val alt = img.attr("alt").takeIf { it.isNotBlank() }

                val inferredMime = MediaType.fromExtension(src)
                    .takeIf { it == MediaType.IMAGE }
                    ?.let { "image/unknown" }

                items.add(
                    MediaItem(
                        url = src,
                        type = MediaType.IMAGE,
                        mimeType = inferredMime,
                        title = alt,
                        width = width,
                        height = height,
                        metadata = mapOf("sourceTag" to "img")
                    )
                )
            }

            // Also parse srcset attributes if present
            val srcset = img.attr("srcset")
            if (srcset.isNotBlank()) {
                items.addAll(parseSrcSet(srcset, baseUri))
            }
        }

        // 2. <picture> <source> tags
        doc.select("picture source, source").forEach { source ->
            val src = resolveUrl(baseUri, source.attr("src"))
            val srcset = source.attr("srcset")
            val mimeType = source.attr("type").takeIf { it.isNotBlank() }
            val determinedType = MediaType.fromMimeType(mimeType)

            if (!src.isNullOrBlank()) {
                val resolvedType = if (determinedType != MediaType.UNKNOWN) {
                    determinedType
                } else {
                    MediaType.fromExtension(src)
                }

                items.add(
                    MediaItem(
                        url = src,
                        type = resolvedType,
                        mimeType = mimeType,
                        metadata = mapOf("sourceTag" to "source")
                    )
                )
            }

            if (srcset.isNotBlank()) {
                items.addAll(parseSrcSet(srcset, baseUri, mimeType))
            }
        }

        // 3. <video> tags
        doc.select("video").forEach { video ->
            val src = resolveUrl(baseUri, video.attr("src"))
            val poster = resolveUrl(baseUri, video.attr("poster"))

            if (!src.isNullOrBlank()) {
                items.add(
                    MediaItem(
                        url = src,
                        type = MediaType.VIDEO,
                        mimeType = MediaType.fromExtension(src).let { if (it == MediaType.VIDEO) "video/mp4" else null },
                        metadata = mapOf("sourceTag" to "video")
                    )
                )
            }

            if (!poster.isNullOrBlank()) {
                items.add(
                    MediaItem(
                        url = poster,
                        type = MediaType.IMAGE,
                        title = "Video Poster",
                        metadata = mapOf("sourceTag" to "video-poster")
                    )
                )
            }
        }

        // 4. OpenGraph and Twitter card meta images
        doc.select("meta[property=og:image], meta[name=twitter:image], meta[property=og:video]").forEach { meta ->
            val content = resolveUrl(baseUri, meta.attr("content"))
            val property = meta.attr("property").ifBlank { meta.attr("name") }
            if (!content.isNullOrBlank()) {
                val type = if (property.contains("video")) MediaType.VIDEO else MediaType.IMAGE
                items.add(
                    MediaItem(
                        url = content,
                        type = type,
                        title = "Meta $property",
                        metadata = mapOf("sourceTag" to "meta:$property")
                    )
                )
            }
        }

        return items.distinctBy { it.url }
    }

    private fun parseSrcSet(srcset: String, baseUri: String, explicitMimeType: String? = null): List<MediaItem> {
        return srcset.split(",")
            .mapNotNull { entry ->
                val parts = entry.trim().split("\\s+".toRegex())
                val rawUrl = parts.firstOrNull() ?: return@mapNotNull null
                val resolved = resolveUrl(baseUri, rawUrl) ?: return@mapNotNull null
                val descriptor = parts.getOrNull(1)

                val width = if (descriptor?.endsWith("w") == true) {
                    descriptor.dropLast(1).toIntOrNull()
                } else null

                MediaItem(
                    url = resolved,
                    type = MediaType.IMAGE,
                    mimeType = explicitMimeType,
                    width = width,
                    metadata = mapOf(
                        "sourceTag" to "srcset",
                        "descriptor" to (descriptor ?: "")
                    )
                )
            }
    }

    private fun resolveUrl(baseUri: String, path: String?): String? {
        if (path.isNullOrBlank() || path.startsWith("data:")) return null
        return try {
            val base = URI(baseUri)
            base.resolve(path.trim()).toASCIIString()
        } catch (_: Exception) {
            if (path.startsWith("http://") || path.startsWith("https://")) path else null
        }
    }
}
