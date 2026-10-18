package org.hrithikvish.scraper.domain.usecase

import kotlinx.coroutines.CoroutineDispatcher
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import org.hrithikvish.scraper.domain.model.MediaFilter
import org.hrithikvish.scraper.domain.model.ScrapeResult
import org.hrithikvish.scraper.domain.model.ScraperStrategy
import org.hrithikvish.scraper.domain.repository.MediaScraperRepository

/**
 * Primary UseCase coordinating URL validation, media extraction, and filtering.
 */
class ScrapeMediaUseCase(
    private val repository: MediaScraperRepository,
    private val validateUrlUseCase: ValidateUrlUseCase = ValidateUrlUseCase(),
    private val filterMediaUseCase: FilterMediaUseCase = FilterMediaUseCase(),
    private val defaultDispatcher: CoroutineDispatcher = Dispatchers.IO
) {

    suspend operator fun invoke(
        rawUrl: String,
        strategy: ScraperStrategy = ScraperStrategy.AUTO,
        filter: MediaFilter? = null
    ): Result<ScrapeResult> = withContext(defaultDispatcher) {
        runCatching {
            val validatedUrl = validateUrlUseCase(rawUrl)
            val result = repository.scrapeMedia(validatedUrl, strategy)

            if (filter != null) {
                val filteredItems = filterMediaUseCase(result.items, filter)
                result.copy(items = filteredItems)
            } else {
                result
            }
        }
    }
}
