package org.hrithikvish.scraper.data.repository

import kotlinx.coroutines.flow.Flow
import org.hrithikvish.scraper.data.datasource.HttpMediaDataSource
import org.hrithikvish.scraper.data.datasource.ImdbJsonDataSource
import org.hrithikvish.scraper.data.datasource.NetworkSnifferDataSource
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.ScrapeResult
import org.hrithikvish.scraper.domain.model.ScraperException
import org.hrithikvish.scraper.domain.model.ScraperStrategy
import org.hrithikvish.scraper.domain.repository.MediaScraperRepository

/**
 * Concrete implementation of [MediaScraperRepository].
 * Dynamically dispatches between HTTP DOM parsing, IMDb JSON data extraction,
 * and Playwright Network Tab interception.
 */
class MediaScraperRepositoryImpl(
    private val httpDataSource: HttpMediaDataSource = HttpMediaDataSource(),
    private val imdbDataSource: ImdbJsonDataSource = ImdbJsonDataSource(),
    private val networkSnifferDataSource: Lazy<NetworkSnifferDataSource> = lazy { NetworkSnifferDataSource() }
) : MediaScraperRepository {

    override suspend fun scrapeMedia(url: String, strategy: ScraperStrategy): ScrapeResult {
        val startTime = System.currentTimeMillis()
        val (items, resolvedStrategy) = when (strategy) {
            ScraperStrategy.HTTP_DOM -> {
                httpDataSource.extractMedia(url) to ScraperStrategy.HTTP_DOM
            }

            ScraperStrategy.IMDB_NEXT_DATA -> {
                imdbDataSource.extractMedia(url) to ScraperStrategy.IMDB_NEXT_DATA
            }

            ScraperStrategy.NETWORK_SNIFFER -> {
                networkSnifferDataSource.value.extractMedia(url) to ScraperStrategy.NETWORK_SNIFFER
            }

            ScraperStrategy.AUTO -> {
                executeAutoStrategy(url)
            }
        }

        val duration = System.currentTimeMillis() - startTime
        return ScrapeResult(
            targetUrl = url,
            items = items,
            durationMs = duration,
            strategyUsed = resolvedStrategy
        )
    }

    override fun streamMedia(url: String, strategy: ScraperStrategy): Flow<MediaItem> {
        return networkSnifferDataSource.value.streamMedia(url)
    }

    private suspend fun executeAutoStrategy(url: String): Pair<List<MediaItem>, ScraperStrategy> {
        val isImdb = url.contains("imdb.com", ignoreCase = true)
        val isMediaViewer = url.contains("mediaviewer", ignoreCase = true)

        // For media viewer galleries, prioritize the browser network sniffer to capture all photos
        if (isMediaViewer) {
            val snifferResult = runCatching { networkSnifferDataSource.value.extractMedia(url) }.getOrNull()
            if (!snifferResult.isNullOrEmpty()) {
                return snifferResult to ScraperStrategy.NETWORK_SNIFFER
            }
        }

        if (isImdb) {
            // First attempt: Fast IMDb JSON extraction
            val jsonResult = runCatching { imdbDataSource.extractMedia(url) }.getOrNull()
            if (!jsonResult.isNullOrEmpty()) {
                return jsonResult to ScraperStrategy.IMDB_NEXT_DATA
            }
        }

        // Second attempt: Standard DOM parsing via OkHttp + Jsoup
        val domResult = runCatching { httpDataSource.extractMedia(url) }.getOrNull()
        if (!domResult.isNullOrEmpty()) {
            return domResult to ScraperStrategy.HTTP_DOM
        }

        // Third attempt: Fallback to real browser network sniffing
        val snifferResult = runCatching { networkSnifferDataSource.value.extractMedia(url) }.getOrNull()
        if (!snifferResult.isNullOrEmpty()) {
            return snifferResult to ScraperStrategy.NETWORK_SNIFFER
        }

        // If all returned empty, return whatever domResult had or throw
        return (domResult ?: emptyList()) to ScraperStrategy.AUTO
    }
}
