package org.hrithikvish.scraper.domain.usecase

import kotlinx.serialization.encodeToString
import kotlinx.serialization.json.Json
import org.hrithikvish.scraper.domain.model.ScrapeResult
import java.io.File

/**
 * UseCase responsible for exporting scraped media gallery results to a static JSON file.
 * Used by CI/CD and CLI pipelines to feed GitHub Pages static web viewers.
 */
class ExportGalleryUseCase(
    private val json: Json = Json {
        prettyPrint = true
        ignoreUnknownKeys = true
    }
) {

    operator fun invoke(result: ScrapeResult, destinationPath: String): File {
        val file = File(destinationPath)
        file.parentFile?.mkdirs()

        val jsonString = json.encodeToString(result)
        file.writeText(jsonString)
        return file
    }
}
