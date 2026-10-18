package org.hrithikvish.scraper.data.datasource

import kotlinx.serialization.json.*
import okhttp3.OkHttpClient
import okhttp3.Request
import org.jsoup.Jsoup
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.MediaType
import org.hrithikvish.scraper.domain.model.ScraperException
import org.hrithikvish.scraper.domain.model.cleanImdbImageUrl
import java.io.IOException

/**
 * Specialized extractor for IMDb MediaViewer pages.
 * Extracts Next.js data (<script id="__NEXT_DATA__">) to recover high-resolution
 * gallery assets and metadata directly without running a browser.
 */
class ImdbJsonDataSource(
    private val client: OkHttpClient = HttpMediaDataSource.defaultOkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true; isLenient = true }
) {

    companion object {
        private const val USER_AGENT =
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36"
    }

    suspend fun extractMedia(imdbUrl: String): List<MediaItem> {
        val htmlResult = runCatching {
            val html = fetchHtml(imdbUrl)
            extractFromHtml(html, imdbUrl)
        }.getOrNull()

        if (!htmlResult.isNullOrEmpty()) {
            return htmlResult
        }

        // If HTML was blocked by AWS WAF, extract title/name ID and query IMDb API directly
        val idMatch = Regex("(tt\\d+|nm\\d+)").find(imdbUrl)?.value
        if (idMatch != null) {
            val apiItems = fetchFromSuggestionApi(idMatch)
            if (apiItems.isNotEmpty()) {
                return apiItems
            }
        }

        throw ScraperException.ParsingException("Could not extract IMDb media from HTML or API")
    }

    private fun fetchFromSuggestionApi(id: String): List<MediaItem> {
        val prefix = id.first().lowercase()
        val apiUrl = "https://v3.sg.media-imdb.com/suggestion/$prefix/$id.json"
        val request = Request.Builder()
            .url(apiUrl)
            .header("User-Agent", USER_AGENT)
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return emptyList()
                val body = response.body?.string() ?: return emptyList()
                val root = json.parseToJsonElement(body).jsonObject
                val dataArray = root["d"]?.jsonArray ?: return emptyList()

                dataArray.mapNotNull { entry ->
                    val obj = entry.jsonObject
                    val imgObj = obj["i"]?.jsonObject ?: return@mapNotNull null
                    val rawUrl = imgObj["imageUrl"]?.jsonPrimitive?.contentOrNull ?: return@mapNotNull null
                    val width = imgObj["width"]?.jsonPrimitive?.intOrNull
                    val height = imgObj["height"]?.jsonPrimitive?.intOrNull
                    val title = obj["l"]?.jsonPrimitive?.contentOrNull

                    MediaItem(
                        url = cleanImdbImageUrl(rawUrl),
                        type = MediaType.IMAGE,
                        mimeType = "image/jpeg",
                        title = title,
                        width = width,
                        height = height,
                        metadata = mapOf(
                            "id" to id,
                            "source" to "imdb_suggestion_api"
                        )
                    )
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun extractFromHtml(html: String, baseUri: String): List<MediaItem> {
        val doc = Jsoup.parse(html, baseUri)
        val scriptTag = doc.selectFirst("script#__NEXT_DATA__")
            ?: throw ScraperException.ParsingException("Could not locate __NEXT_DATA__ script block in IMDb page")

        val rawJson = scriptTag.data()
        if (rawJson.isBlank()) {
            throw ScraperException.ParsingException("__NEXT_DATA__ script block was empty")
        }

        return try {
            val rootElement = json.parseToJsonElement(rawJson)
            val extractedItems = mutableListOf<MediaItem>()
            traverseAndExtract(rootElement, extractedItems)
            extractedItems.distinctBy { it.url }
        } catch (e: Exception) {
            throw ScraperException.ParsingException("Failed to parse IMDb JSON payload: ${e.message}", e)
        }
    }

    private fun fetchHtml(url: String): String {
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", USER_AGENT)
            .header("Accept-Language", "en-US,en;q=0.9")
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                response.body?.string() ?: throw ScraperException.NetworkException("Empty body from IMDb")
            }
        } catch (e: IOException) {
            throw ScraperException.NetworkException("Failed to fetch IMDb page: ${e.message}", e)
        }
    }

    /**
     * Recursively traverses JSON searching for image nodes or URLs hosted on Amazon/IMDb CDNs.
     */
    private fun traverseAndExtract(element: JsonElement, results: MutableList<MediaItem>) {
        when (element) {
            is JsonObject -> {
                // Check if this object itself represents an image node
                val urlElement = element["url"] ?: element["src"]
                if (urlElement is JsonPrimitive && urlElement.isString) {
                    val url = urlElement.content
                    if (isMediaUrl(url)) {
                        val width = (element["width"] as? JsonPrimitive)?.intOrNull
                        val height = (element["height"] as? JsonPrimitive)?.intOrNull
                        val caption = (element["caption"] as? JsonPrimitive)?.contentOrNull
                            ?: (element["title"] as? JsonPrimitive)?.contentOrNull

                        results.add(
                            MediaItem(
                                url = cleanImdbImageUrl(url),
                                type = MediaType.fromExtension(url).let { if (it == MediaType.UNKNOWN) MediaType.IMAGE else it },
                                title = caption,
                                width = width,
                                height = height,
                                metadata = mapOf("source" to "imdb_json")
                            )
                        )
                    }
                }

                // Continue recursion through all object properties
                element.values.forEach { child ->
                    traverseAndExtract(child, results)
                }
            }

            is JsonArray -> {
                element.forEach { child ->
                    traverseAndExtract(child, results)
                }
            }

            else -> Unit
        }
    }

    private fun isMediaUrl(url: String): Boolean {
        val lower = url.lowercase()
        return lower.startsWith("https://m.media-amazon.com/images") ||
                lower.startsWith("http://m.media-amazon.com/images")
    }
}
