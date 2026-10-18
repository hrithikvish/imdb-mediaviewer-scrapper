package org.hrithikvish.scraper.domain.model

sealed class ScraperException(message: String, cause: Throwable? = null) : RuntimeException(message, cause) {
    class InvalidUrlException(val url: String, message: String = "Invalid or unsupported URL: $url") : ScraperException(message)
    class NetworkException(message: String, cause: Throwable? = null) : ScraperException(message, cause)
    class ParsingException(message: String, cause: Throwable? = null) : ScraperException(message, cause)
    class BrowserException(message: String, cause: Throwable? = null) : ScraperException(message, cause)
    class NoMediaFoundException(url: String) : ScraperException("No media could be extracted from: $url")
}
