package org.hrithikvish.scraper.domain.usecase

import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.MediaType
import org.hrithikvish.scraper.domain.model.ScrapeResult
import org.hrithikvish.scraper.domain.model.ScraperStrategy
import java.io.File
import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertTrue

class ExportGalleryUseCaseTest {

    private val exportGalleryUseCase = ExportGalleryUseCase()
    private val testFile = File("build/test-gallery.json")

    @AfterTest
    fun tearDown() {
        if (testFile.exists()) {
            testFile.delete()
        }
    }

    @Test
    fun `exports scrape result to valid json file on disk`() {
        val result = ScrapeResult(
            targetUrl = "https://imdb.com/title/tt0056241/mediaviewer",
            items = listOf(
                MediaItem(
                    url = "https://m.media-amazon.com/images/M/test.jpg",
                    type = MediaType.IMAGE,
                    width = 1920,
                    height = 1080,
                    title = "Test Image"
                )
            ),
            durationMs = 500,
            strategyUsed = ScraperStrategy.IMDB_NEXT_DATA
        )

        val exported = exportGalleryUseCase(result, testFile.path)

        assertTrue(exported.exists())
        val text = exported.readText()
        assertTrue(text.contains("https://m.media-amazon.com/images/M/test.jpg"))
        assertTrue(text.contains("1920"))
        assertTrue(text.contains("Test Image"))
    }
}
