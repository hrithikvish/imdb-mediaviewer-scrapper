package org.hrithikvish.scraper.domain.repository

import kotlinx.coroutines.flow.Flow
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.ScrapeResult
import org.hrithikvish.scraper.domain.model.ScraperStrategy

/**
 * Repository interface defining operations for extracting media assets from web pages.
 * Follows Clean Architecture by decoupling business logic from underlying network or browser clients.
 */
interface MediaScraperRepository {

    /**
     * Scrapes media items from the specified [url] using the requested [strategy].
     *
     * @param url Target web page URL.
     * @param strategy The extraction strategy to employ.
     * @return [ScrapeResult] containing extracted media items and execution metadata.
     */
    suspend fun scrapeMedia(
        url: String,
        strategy: ScraperStrategy = ScraperStrategy.AUTO
    ): ScrapeResult

    /**
     * Streams media items as they are discovered (especially useful for network sniffing or long pages).
     */
    fun streamMedia(
        url: String,
        strategy: ScraperStrategy = ScraperStrategy.AUTO
    ): Flow<MediaItem>
}
