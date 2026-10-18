package org.hrithikvish.scraper.domain.usecase

import org.hrithikvish.scraper.domain.model.MediaFilter
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.MediaType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class FilterMediaUseCaseTest {

    private val filterMediaUseCase = FilterMediaUseCase()

    private val sampleItems = listOf(
        MediaItem(
            url = "https://example.com/small.jpg",
            type = MediaType.IMAGE,
            mimeType = "image/jpeg",
            width = 300,
            height = 200
        ),
        MediaItem(
            url = "https://example.com/large.jpg",
            type = MediaType.IMAGE,
            mimeType = "image/jpeg",
            width = 1920,
            height = 1080
        ),
        MediaItem(
            url = "https://example.com/trailer.mp4",
            type = MediaType.VIDEO,
            mimeType = "video/mp4",
            width = 1920,
            height = 1080
        ),
        MediaItem(
            url = "https://example.com/podcast.mp3",
            type = MediaType.AUDIO,
            mimeType = "audio/mpeg"
        )
    )

    @Test
    fun `filters by allowed media types`() {
        val filter = MediaFilter(allowedTypes = setOf(MediaType.VIDEO))
        val result = filterMediaUseCase(sampleItems, filter)

        assertEquals(1, result.size)
        assertEquals("https://example.com/trailer.mp4", result.first().url)
    }

    @Test
    fun `filters by minimum width and height`() {
        val filter = MediaFilter(minWidth = 500, minHeight = 500)
        val result = filterMediaUseCase(sampleItems, filter)

        assertEquals(2, result.size)
        assertTrue(result.all { it.width != null && it.width!! >= 500 })
    }

    @Test
    fun `filters by regex url pattern`() {
        val filter = MediaFilter(urlPattern = Regex(".*large.*"))
        val result = filterMediaUseCase(sampleItems, filter)

        assertEquals(1, result.size)
        assertEquals("https://example.com/large.jpg", result.first().url)
    }

    @Test
    fun `removes duplicate urls`() {
        val duplicates = listOf(
            MediaItem("https://example.com/img.jpg", MediaType.IMAGE),
            MediaItem("https://example.com/img.jpg", MediaType.IMAGE)
        )
        val result = filterMediaUseCase(duplicates, MediaFilter())

        assertEquals(1, result.size)
    }
}
