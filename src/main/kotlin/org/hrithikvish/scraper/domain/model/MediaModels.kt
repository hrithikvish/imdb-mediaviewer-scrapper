package org.hrithikvish.scraper.domain.model

import kotlinx.serialization.Serializable

/**
 * Categorization of media resources extracted from web pages or network traffic.
 */
@Serializable
enum class MediaType {
    IMAGE,
    VIDEO,
    AUDIO,
    UNKNOWN;

    companion object {
        fun fromMimeType(mimeType: String?): MediaType {
            if (mimeType == null) return UNKNOWN
            val lower = mimeType.lowercase()
            return when {
                lower.startsWith("image/") -> IMAGE
                lower.startsWith("video/") -> VIDEO
                lower.startsWith("audio/") -> AUDIO
                else -> UNKNOWN
            }
        }

        fun fromExtension(url: String): MediaType {
            val cleanUrl = url.substringBefore('?').substringBefore('#').lowercase()
            return when {
                cleanUrl.endsWith(".jpg") || cleanUrl.endsWith(".jpeg") || cleanUrl.endsWith(".png") ||
                        cleanUrl.endsWith(".webp") || cleanUrl.endsWith(".gif") || cleanUrl.endsWith(".svg") ||
                        cleanUrl.endsWith(".avif") || cleanUrl.endsWith(".ico") -> IMAGE
                cleanUrl.endsWith(".mp4") || cleanUrl.endsWith(".webm") || cleanUrl.endsWith(".mkv") ||
                        cleanUrl.endsWith(".mov") || cleanUrl.endsWith(".m3u8") || cleanUrl.endsWith(".ts") -> VIDEO
                cleanUrl.endsWith(".mp3") || cleanUrl.endsWith(".wav") || cleanUrl.endsWith(".ogg") ||
                        cleanUrl.endsWith(".aac") || cleanUrl.endsWith(".m4a") -> AUDIO
                else -> UNKNOWN
            }
        }
    }
}

/**
 * Domain entity representing an individual media item discovered either via DOM parsing or network interception.
 *
 * @property url Direct URL to the media asset.
 * @property type Classified [MediaType].
 * @property mimeType Reported MIME type (e.g. image/jpeg, video/mp4), if available.
 * @property title Optional human-readable title, caption, or alt-text.
 * @property width Optional pixel width.
 * @property height Optional pixel height.
 * @property sizeBytes Optional size in bytes.
 * @property metadata Arbitrary metadata key-value pairs (e.g. source DOM tag, HTTP headers, Next.js image ID).
 */
@Serializable
data class MediaItem(
    val url: String,
    val type: MediaType,
    val mimeType: String? = null,
    val title: String? = null,
    val width: Int? = null,
    val height: Int? = null,
    val sizeBytes: Long? = null,
    val metadata: Map<String, String> = emptyMap()
)

/**
 * Strips IMDb resize/crop URL parameters (e.g. `._V1_QL75_UX380_CR0,0,380,562_.jpg`)
 * to recover the original uncompressed source image.
 */
fun cleanImdbImageUrl(url: String): String {
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
 * Filter specification to query and slice extracted media assets.
 *
 * @property allowedTypes Filter by specific [MediaType]s (e.g., only IMAGE). Empty means all types.
 * @property minWidth Minimum width filter in pixels.
 * @property minHeight Minimum height filter in pixels.
 * @property urlPattern Optional regex pattern to filter asset URLs.
 * @property mimeTypeSubstring Optional substring to match MIME types (e.g., "jpeg", "webp").
 */
data class MediaFilter(
    val allowedTypes: Set<MediaType> = emptySet(),
    val minWidth: Int? = null,
    val minHeight: Int? = null,
    val urlPattern: Regex? = null,
    val mimeTypeSubstring: String? = null
) {
    fun matches(item: MediaItem): Boolean {
        if (allowedTypes.isNotEmpty() && item.type !in allowedTypes) return false
        if (minWidth != null && (item.width == null || item.width < minWidth)) return false
        if (minHeight != null && (item.height == null || item.height < minHeight)) return false
        if (urlPattern != null && !urlPattern.containsMatchIn(item.url)) return false
        if (mimeTypeSubstring != null && (item.mimeType == null || !item.mimeType.contains(mimeTypeSubstring, ignoreCase = true))) return false
        return true
    }

    companion object {
        val AMAZON_MEDIA_PATTERN = Regex("^https?://m\\.media-amazon\\.com/images/.*")

        fun amazonMediaOnly(): MediaFilter = MediaFilter(
            allowedTypes = setOf(MediaType.IMAGE),
            urlPattern = AMAZON_MEDIA_PATTERN
        )
    }
}

/**
 * Scraper extraction strategy options.
 */
@Serializable
enum class ScraperStrategy {
    /**
     * Fast & lightweight: Uses OkHttp and Jsoup to fetch HTML and extract DOM media tags
     * (img, picture, video, meta og:image).
     */
    HTTP_DOM,

    /**
     * Specialized for IMDb: Fetches page via OkHttp and extracts Next.js `__NEXT_DATA__` JSON
     * containing high-res media viewer images and gallery items.
     */
    IMDB_NEXT_DATA,

    /**
     * Real Browser Sniffing: Runs headless browser (Playwright) and intercepts all network responses
     * matching media/image resource types, exactly matching Chrome DevTools Network Tab.
     */
    NETWORK_SNIFFER,

    /**
     * Automatically attempts IMDB_NEXT_DATA if IMDb URL, otherwise HTTP_DOM, with fallback to NETWORK_SNIFFER.
     */
    AUTO
}

/**
 * Result wrapper for scraping operations.
 */
@Serializable
data class ScrapeResult(
    val targetUrl: String,
    val items: List<MediaItem>,
    val durationMs: Long,
    val strategyUsed: ScraperStrategy,
    val timestamp: Long = System.currentTimeMillis()
)

/**
 * Metadata record for a single scraped title in the titles.json master registry.
 */
@Serializable
data class TitleMetadata(
    val id: String,
    val name: String,
    val targetUrl: String,
    val itemCount: Int,
    val posterUrl: String? = null,
    val file: String,
    val lastUpdated: Long = System.currentTimeMillis()
)

/**
 * Dedicated gallery payload saved per IMDb title (e.g. titles/tt0056241.json).
 */
@Serializable
data class TitleGallery(
    val id: String,
    val name: String,
    val targetUrl: String,
    val items: List<MediaItem>,
    val durationMs: Long,
    val timestamp: Long = System.currentTimeMillis()
)
