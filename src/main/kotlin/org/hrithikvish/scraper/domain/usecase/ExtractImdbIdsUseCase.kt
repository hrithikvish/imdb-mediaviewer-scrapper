package org.hrithikvish.scraper.domain.usecase

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
 */
class ExtractImdbIdsUseCase(
    private val client: OkHttpClient = HttpMediaDataSource.defaultOkHttpClient(),
    private val json: Json = Json { ignoreUnknownKeys = true; isLenient = true }
) {

    private val idRegex = Regex("""(tt\d{7,8})""")
    private val findQueryRegex = Regex("""find/\?q=([^&\s]+)""")

    operator fun invoke(input: String): List<ExtractedTitle> {
        val rawContent = runCatching {
            val file = File(input)
            if (file.exists() && file.isFile) file.readText() else input
        }.getOrDefault(input)

        val lines = rawContent.lines()
            .map { it.trim() }
            .filter { it.isNotBlank() }

        val results = mutableListOf<ExtractedTitle>()
        val seenIds = mutableSetOf<String>()

        for (line in lines) {
            // Case 1: Direct IMDb ID in the line (e.g. https://www.imdb.com/title/tt0038650/)
            val explicitMatch = idRegex.find(line)
            if (explicitMatch != null) {
                val id = explicitMatch.value
                if (seenIds.add(id)) {
                    val titleName = parseTitleNameFromLine(line, id)
                    results.add(ExtractedTitle(id = id, name = titleName, sourceText = line))
                }
                continue
            }

            // Case 2: IMDb search URL (e.g. https://www.imdb.com/find/?q=Miracle%20on%2034th%20Street%201947)
            val findMatch = findQueryRegex.find(line)
            if (findMatch != null) {
                val encodedQuery = findMatch.groupValues[1]
                val decodedQuery = runCatching {
                    URLDecoder.decode(encodedQuery, StandardCharsets.UTF_8.name())
                }.getOrDefault(encodedQuery)

                val resolved = resolveFromQuery(decodedQuery)
                if (resolved != null && seenIds.add(resolved.id)) {
                    val lineTitle = parseTitleNameFromLine(line, resolved.id) ?: resolved.name
                    results.add(resolved.copy(name = lineTitle, sourceText = line))
                }
                continue
            }

            // Case 3: Line containing a title query without a direct ID (e.g. "Miracle on 34th Street")
            val candidateQuery = line.substringBefore("http").trim().removeSuffix(":").trim()
            if (candidateQuery.length >= 3) {
                val resolved = resolveFromQuery(candidateQuery)
                if (resolved != null && seenIds.add(resolved.id)) {
                    results.add(resolved.copy(sourceText = line))
                }
            }
        }

        return results
    }

    private fun parseTitleNameFromLine(line: String, id: String): String? {
        val beforeUrl = line.substringBefore("http").trim().removeSuffix(":").trim()
        if (beforeUrl.isNotBlank() && !beforeUrl.equals(id, ignoreCase = true)) {
            return beforeUrl
        }
        return null
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
