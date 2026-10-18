package org.hrithikvish.scraper.domain.usecase

import org.hrithikvish.scraper.domain.model.ScraperException
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ValidateUrlUseCaseTest {

    private val validateUrlUseCase = ValidateUrlUseCase()

    @Test
    fun `extracts title ID from any IMDb title URL and constructs mediaindex URL`() {
        val rawUrl = "https://www.imdb.com/title/tt0038650/?ref_=tttrv_ov_i"
        val expected = "https://www.imdb.com/title/tt0038650/mediaindex/"
        assertEquals(expected, validateUrlUseCase(rawUrl))
    }

    @Test
    fun `constructs mediaindex URL from bare title ID`() {
        assertEquals(
            "https://www.imdb.com/title/tt0038650/mediaindex/",
            validateUrlUseCase("tt0038650")
        )
    }

    @Test
    fun `constructs mediaindex URL from bare person ID`() {
        assertEquals(
            "https://www.imdb.com/name/nm0000123/mediaindex/",
            validateUrlUseCase("nm0000123")
        )
    }

    @Test
    fun `preserves existing mediaviewer photo URL and strips query parameters`() {
        val specificPhotoUrl = "https://www.imdb.com/title/tt0038650/mediaviewer/rm12345678/?ref_=tt_pv_vi_1"
        assertEquals(
            "https://www.imdb.com/title/tt0038650/mediaviewer/rm12345678/",
            validateUrlUseCase(specificPhotoUrl)
        )
    }

    @Test
    fun `preserves non-IMDb URLs`() {
        val genericUrl = "http://example.com/gallery"
        assertEquals(genericUrl, validateUrlUseCase(genericUrl))
    }

    @Test
    fun `throws InvalidUrlException on blank or whitespace url`() {
        assertFailsWith<ScraperException.InvalidUrlException> {
            validateUrlUseCase("   ")
        }
    }
}
