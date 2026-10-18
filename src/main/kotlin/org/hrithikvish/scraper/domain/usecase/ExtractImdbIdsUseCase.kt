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

    // Matches any http(s) URL or standalone tt ID
    private val tokenRegex = Regex("""(https?://[^\s,"'<>]+|\btt\d{7,8}\b)""")
    private val idRegex = Regex("""(tt\d{7,8})""")
    private val findQueryRegex = Regex("""find[/?].*?[?&]q=([^&\s]+)""")

    operator fun invoke(input: String): List<ExtractedTitle> {
        val rawContent = runCatching {
            val file = File(input)
            if (file.exists() && file.isFile) file.readText() else input
        }.getOrDefault(input)

        val results = mutableListOf<ExtractedTitle>()
        val seenIds = mutableSetOf<String>()

        val matches = tokenRegex.findAll(rawContent).toList()

        if (matches.isNotEmpty()) {
            var lastEndIndex = 0

            for (match in matches) {
                val token = match.value
                val textBefore = rawContent.substring(lastEndIndex, match.range.first)
                lastEndIndex = match.range.last + 1

                // If textBefore spans multiple lines, previous lines might be standalone title queries
                val beforeLines = textBefore.lines().map { it.trim() }.filter { it.isNotBlank() }
                if (beforeLines.size > 1) {
                    for (line in beforeLines.dropLast(1)) {
                        val cleaned = cleanLabel(line)
                        if (cleaned != null && cleaned.length >= 3) {
                            val resolved = resolveFromQuery(cleaned)
                            if (resolved != null && seenIds.add(resolved.id)) {
                                results.add(resolved.copy(sourceText = line))
                            }
                        }
                    }
                }

                val candidateLabel = beforeLines.lastOrNull()?.let { cleanLabel(it) }

                // Check 1: Token contains a direct tt ID
                val directIdMatch = idRegex.find(token)
                if (directIdMatch != null) {
                    val id = directIdMatch.value
                    if (seenIds.add(id)) {
                        results.add(
                            ExtractedTitle(
                                id = id,
                                name = candidateLabel,
                                sourceText = token
                            )
                        )
                    }
                    continue
                }

                // Check 2: Token is an IMDb find/search URL
                val findMatch = findQueryRegex.find(token)
                if (findMatch != null) {
                    val encodedQuery = findMatch.groupValues[1]
                    val decodedQuery = runCatching {
                        URLDecoder.decode(encodedQuery, StandardCharsets.UTF_8.name())
                    }.getOrDefault(encodedQuery).trimEnd('.', ')', ']', ';')

                    val resolved = resolveFromQuery(decodedQuery)
                    if (resolved != null && seenIds.add(resolved.id)) {
                        val titleName = candidateLabel ?: resolved.name
                        results.add(resolved.copy(name = titleName, sourceText = token))
                    }
                    continue
                }
            }

            // Check trailing text after the last match
            val trailingText = rawContent.substring(lastEndIndex)
            val trailingLines = trailingText.lines().map { it.trim() }.filter { it.isNotBlank() }
            for (line in trailingLines) {
                val cleaned = cleanLabel(line)
                if (cleaned != null && cleaned.length >= 3) {
                    val resolved = resolveFromQuery(cleaned)
                    if (resolved != null && seenIds.add(resolved.id)) {
                        results.add(resolved.copy(sourceText = line))
                    }
                }
            }
        } else {
            // No URLs or tt IDs found at all. Treat non-blank lines as title search queries.
            val lines = rawContent.lines()
                .map { it.trim() }
                .filter { it.isNotBlank() }

            for (line in lines) {
                val cleaned = cleanLabel(line) ?: line
                if (cleaned.length >= 3) {
                    val resolved = resolveFromQuery(cleaned)
                    if (resolved != null && seenIds.add(resolved.id)) {
                        results.add(resolved.copy(sourceText = line))
                    }
                }
            }
        }

        return results
    }

    private fun cleanLabel(text: String): String? {
        var cleaned = text.trim()
        // Strip leading list numbering like "1.", "1)", "1 -", "[1]"
        cleaned = cleaned.replace(Regex("""^(\[\d+]|\d+[\.)\-]|\s*-\s*)+"""), "").trim()
        // Strip trailing colons, dashes, equal signs
        cleaned = cleaned.replace(Regex("""[:\-=,\s]+$"""), "").trim()
        // Strip leading colons, dashes
        cleaned = cleaned.replace(Regex("""^[:\-=,\s]+"""), "").trim()

        if (cleaned.isBlank()) return null
        if (cleaned.startsWith("http://") || cleaned.startsWith("https://")) return null
        if (cleaned.matches(Regex("""^tt\d+$"""))) return null
        return cleaned
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
