package org.hrithikvish.scraper.domain.usecase

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.runBlocking
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import org.hrithikvish.scraper.data.datasource.HttpMediaDataSource
import java.io.File
import java.net.URLDecoder
import java.nio.charset.StandardCharsets
import java.util.concurrent.ConcurrentHashMap

/**
 * Model representing an IMDb title extracted from free-form user input text.
 */
data class ExtractedTitle(
    val id: String,
    val name: String?,
    val sourceText: String
)

/**
 * UseCase responsible for extracting all unique IMDb IDs from arbitrary free-form text,
 * files, lists of URLs, or search links (e.g. /find/?q=...).
 *
 * Uses IMDb's Suggestion API as the single canonical source of truth for movie names
 * and release years, eliminating fragile regex/text-parsing misattribution bugs.
 */
class ExtractImdbIdsUseCase(
    private val client: OkHttpClient = HttpMediaDataSource.defaultOkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true; isLenient = true }
) {

    private val titleCache = ConcurrentHashMap<String, String>()

    // Matches any http(s) URL or standalone tt ID
    private val tokenRegex = Regex("""(https?://[^\s,"'<>]+|\btt\d{7,8}\b)""")
    private val idRegex = Regex("""(tt\d{7,8})""")
    private val findQueryRegex = Regex("""find[/?].*?[?&]q=([^&\s]+)""")

    operator fun invoke(input: String): List<ExtractedTitle> {
        val rawContent = runCatching {
            val file = File(input)
            if (file.exists() && file.isFile) file.readText() else input
        }.getOrDefault(input)

        val seenIds = mutableSetOf<String>()
        val pendingDirect = mutableListOf<Pair<String, String>>()
        val searchResolved = mutableListOf<ExtractedTitle>()

        val matches = tokenRegex.findAll(rawContent).toList()

        if (matches.isNotEmpty()) {
            for (match in matches) {
                val token = match.value

                // 1. Direct tt ID match (e.g. tt0038650 or https://www.imdb.com/title/tt0038650/...)
                val directIdMatch = idRegex.find(token)
                if (directIdMatch != null) {
                    val id = directIdMatch.value
                    if (seenIds.add(id)) {
                        pendingDirect.add(id to token)
                    }
                    continue
                }

                // 2. IMDb find/search URL match (e.g. https://www.imdb.com/find/?q=Miracle...)
                val findMatch = findQueryRegex.find(token)
                if (findMatch != null) {
                    val encodedQuery = findMatch.groupValues[1]
                    val decodedQuery = runCatching {
                        URLDecoder.decode(encodedQuery, StandardCharsets.UTF_8.name())
                    }.getOrDefault(encodedQuery).trimEnd('.', ')', ']', ';')

                    val resolved = resolveFromQuery(decodedQuery)
                    if (resolved != null && seenIds.add(resolved.id)) {
                        searchResolved.add(resolved.copy(sourceText = token))
                    }
                }
            }
        } else {
            // No tokens/IDs matched. Treat non-blank lines as title search queries.
            val lines = rawContent.lines()
                .map { it.trim() }
                .filter { it.isNotBlank() }

            for (line in lines) {
                val resolved = resolveFromQuery(line)
                if (resolved != null && seenIds.add(resolved.id)) {
                    searchResolved.add(resolved.copy(sourceText = line))
                }
            }
        }

        // Concurrently fetch canonical movie names for all direct IDs from IMDb Suggestion API
        val directResolved = runBlocking(Dispatchers.IO) {
            pendingDirect.map { (id, sourceToken) ->
                async {
                    val canonicalName = fetchTitleById(id) ?: id
                    ExtractedTitle(
                        id = id,
                        name = canonicalName,
                        sourceText = sourceToken
                    )
                }
            }.awaitAll()
        }

        // Return combined in the exact order they were discovered in the input
        val allMap = (directResolved + searchResolved).associateBy { it.id }
        return seenIds.mapNotNull { allMap[it] }
    }

    fun fetchTitleById(id: String): String? {
        val cached = titleCache[id]
        if (cached != null) return cached

        val prefix = id.first().lowercase()
        val url = "https://v3.sg.media-imdb.com/suggestion/$prefix/$id.json"
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val body = response.body?.string() ?: return null
                val root = json.parseToJsonElement(body).jsonObject
                val items = root["d"]?.jsonArray ?: return null
                val targetObj = items
                    .mapNotNull { it.jsonObject }
                    .firstOrNull { it["id"]?.jsonPrimitive?.content == id }
                    ?: items.firstOrNull()?.jsonObject
                    ?: return null

                val title = targetObj["l"]?.jsonPrimitive?.content ?: return null
                val year = targetObj["y"]?.jsonPrimitive?.content ?: ""
                val formatted = if (year.isNotBlank()) "$title ($year)" else title
                titleCache[id] = formatted
                formatted
            }
        } catch (_: Exception) {
            null
        }
    }

    private fun resolveFromQuery(query: String): ExtractedTitle? {
        val sanitized = query.replace("[^a-zA-Z0-9 ]".toRegex(), " ")
            .split("\\s+".toRegex())
            .filter { it.isNotBlank() }
            .joinToString("_")
            .lowercase()

        val firstChar = sanitized.firstOrNull()?.toString() ?: return null
        val url = "https://v3.sg.media-imdb.com/suggestion/$firstChar/$sanitized.json"

        return try {
            val req = Request.Builder()
                .url(url)
                .header("User-Agent", "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36")
                .build()

            client.newCall(req).execute().use { res ->
                if (!res.isSuccessful) return null
                val body = res.body?.string() ?: return null
                val root = json.parseToJsonElement(body).jsonObject
                val items = root["d"]?.jsonArray ?: return null
                for (item in items) {
                    val obj = item.jsonObject
                    val id = obj["id"]?.jsonPrimitive?.content ?: continue
                    if (id.startsWith("tt")) {
                        val title = obj["l"]?.jsonPrimitive?.content ?: ""
                        val year = obj["y"]?.jsonPrimitive?.content ?: ""
                        val name = if (year.isNotBlank()) "$title ($year)" else title
                        titleCache[id] = name
                        return ExtractedTitle(id = id, name = name, sourceText = query)
                    }
                }
                null
            }
        } catch (_: Exception) {
            null
        }
    }
}
