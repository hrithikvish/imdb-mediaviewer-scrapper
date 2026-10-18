package org.hrithikvish.scraper.domain.usecase

import org.hrithikvish.scraper.domain.model.ScraperException
import java.net.URI

/**
 * UseCase to validate, normalize, and construct mediaviewer URLs from any IMDb link or ID.
 */
class ValidateUrlUseCase {

    companion object {
        private val TITLE_ID_REGEX = Regex("(tt\\d+)")
        private val PERSON_ID_REGEX = Regex("(nm\\d+)")
    }

    operator fun invoke(rawUrl: String): String {
        val trimmed = rawUrl.trim()
        if (trimmed.isBlank()) {
            throw ScraperException.InvalidUrlException(rawUrl, "URL cannot be blank")
        }

        // 1. Direct ID shortcut: e.g. "tt0038650" or "nm0000123"
        if (TITLE_ID_REGEX.matches(trimmed)) {
            return "https://www.imdb.com/title/$trimmed/mediaindex/"
        }
        if (PERSON_ID_REGEX.matches(trimmed)) {
            return "https://www.imdb.com/name/$trimmed/mediaindex/"
        }

        // 2. Ensure scheme
        val urlWithScheme = if (!trimmed.startsWith("http://") && !trimmed.startsWith("https://")) {
            "https://$trimmed"
        } else {
            trimmed
        }

        // 3. Parse URI
        val uri = try {
            URI(urlWithScheme)
        } catch (e: Exception) {
            throw ScraperException.InvalidUrlException(rawUrl, "Malformed URL format: $rawUrl (${e.message})")
        }

        if (uri.host.isNullOrBlank()) {
            throw ScraperException.InvalidUrlException(rawUrl, "URL missing host name: $rawUrl")
        }

        val cleanUrl = uri.toASCIIString().substringBefore('?').substringBefore('#')

        // 4. Transform IMDb URLs to target the mediaindex
        if (uri.host.contains("imdb.com", ignoreCase = true)) {
            // If it's a specific individual photo like /mediaviewer/rm... preserve it
            if (cleanUrl.contains("/mediaviewer/rm")) {
                return cleanUrl.ensureTrailingSlash()
            }

            val titleMatch = TITLE_ID_REGEX.find(cleanUrl)
            if (titleMatch != null) {
                val titleId = titleMatch.value
                return "https://www.imdb.com/title/$titleId/mediaindex/"
            }

            val personMatch = PERSON_ID_REGEX.find(cleanUrl)
            if (personMatch != null) {
                val personId = personMatch.value
                return "https://www.imdb.com/name/$personId/mediaindex/"
            }
        }

        return cleanUrl
    }

    private fun String.ensureTrailingSlash(): String = if (endsWith("/")) this else "$this/"
}
