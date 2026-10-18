package org.hrithikvish.scraper.domain.usecase

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.OkHttpClient
import okhttp3.Request
import org.hrithikvish.scraper.data.datasource.HttpMediaDataSource
import org.hrithikvish.scraper.domain.model.ScrapeResult
import org.hrithikvish.scraper.domain.model.TitleGallery
import org.hrithikvish.scraper.domain.model.TitleMetadata
import java.io.File

/**
 * UseCase responsible for exporting scraped media gallery results into:
 * 1. Dedicated per-title gallery JSON (docs/titles/{titleId}.json) so JSONs stay lightweight.
 * 2. Master title index (docs/titles.json) used by the web app title selector.
 * 3. docs/gallery.json for backwards compatibility.
 */
class ExportGalleryUseCase(
    private val client: OkHttpClient = HttpMediaDataSource.defaultOkHttpClient(),
    private val json: Json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
        isLenient = true
    }
) {

    private val idRegex = Regex("(tt\\d+|nm\\d+)")

    operator fun invoke(
        result: ScrapeResult,
        targetFilePath: String = "docs/gallery.json",
        nameOverride: String? = null
    ): File {
        val targetFile = File(targetFilePath)
        val docsDir = if (targetFile.name.endsWith(".json")) {
            targetFile.parentFile ?: File("docs")
        } else {
            targetFile
        }

        val titlesDir = File(docsDir, "titles")
        titlesDir.mkdirs()

        // 1. Identify Title ID (e.g. tt0056241)
        val titleId = idRegex.find(result.targetUrl)?.value ?: "generic_${System.currentTimeMillis()}"

        // 2. Discover Title Name (e.g. "The Miracle Worker (1962)")
        val titleName = nameOverride ?: fetchTitleName(titleId) ?: titleId

        // 3. Save dedicated per-title JSON (e.g. docs/titles/tt0056241.json)
        val titleGalleryFile = File(titlesDir, "$titleId.json")
        val titleGallery = TitleGallery(
            id = titleId,
            name = titleName,
            targetUrl = result.targetUrl,
            items = result.items,
            durationMs = result.durationMs,
            timestamp = result.timestamp
        )
        titleGalleryFile.writeText(json.encodeToString(titleGallery))

        // 4. Update master titles.json registry
        val titlesIndexFile = File(docsDir, "titles.json")
        updateTitlesManifest(titlesIndexFile, titleGallery, "titles/$titleId.json")

        // 5. Also write docs/gallery.json for backwards compatibility
        val galleryFile = if (targetFile.name.endsWith(".json")) targetFile else File(docsDir, "gallery.json")
        galleryFile.parentFile?.mkdirs()
        galleryFile.writeText(json.encodeToString(result))

        return titleGalleryFile
    }

    private fun updateTitlesManifest(manifestFile: File, gallery: TitleGallery, relativePath: String) {
        val existingList = if (manifestFile.exists()) {
            runCatching {
                json.decodeFromString<List<TitleMetadata>>(manifestFile.readText())
            }.getOrDefault(emptyList())
        } else {
            emptyList()
        }

        val newMetadata = TitleMetadata(
            id = gallery.id,
            name = gallery.name,
            targetUrl = gallery.targetUrl,
            itemCount = gallery.items.size,
            posterUrl = gallery.items.firstOrNull()?.url,
            file = relativePath,
            lastUpdated = gallery.timestamp
        )

        // Prepend current title and remove previous duplicates
        val updatedList = listOf(newMetadata) + existingList.filter { it.id != gallery.id }
        manifestFile.writeText(json.encodeToString(updatedList))
    }

    private fun fetchTitleName(id: String): String? {
        val prefix = id.first().lowercase()
        val url = "https://v3.sg.media-imdb.com/suggestion/$prefix/$id.json"
        val request = Request.Builder()
            .url(url)
            .header("User-Agent", "Mozilla/5.0")
            .build()

        return try {
            client.newCall(request).execute().use { response ->
                if (!response.isSuccessful) return null
                val body = response.body?.string() ?: return null
                val root = json.parseToJsonElement(body).jsonObject
                val data = root["d"]?.jsonArray?.firstOrNull()?.jsonObject ?: return null
                val title = data["l"]?.jsonPrimitive?.content ?: return null
                val year = data["y"]?.jsonPrimitive?.content ?: ""

                if (year.isNotBlank()) "$title ($year)" else title
            }
        } catch (_: Exception) {
            null
        }
    }
}
