package org.hrithikvish.scraper.presentation.state

import org.hrithikvish.scraper.domain.model.MediaFilter
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.ScrapeResult
import org.hrithikvish.scraper.domain.model.ScraperStrategy

enum class ScraperStatus {
    IDLE,
    LOADING,
    SUCCESS,
    ERROR
}

/**
 * Immutable UI State observed by Views in MVVM.
 */
data class MediaScraperState(
    val status: ScraperStatus = ScraperStatus.IDLE,
    val currentUrl: String = "",
    val strategy: ScraperStrategy = ScraperStrategy.AUTO,
    val filter: MediaFilter = MediaFilter(),
    val rawItems: List<MediaItem> = emptyList(),
    val filteredItems: List<MediaItem> = emptyList(),
    val lastResult: ScrapeResult? = null,
    val errorMessage: String? = null
) {
    val isLoading: Boolean get() = status == ScraperStatus.LOADING
    val isSuccess: Boolean get() = status == ScraperStatus.SUCCESS
    val hasItems: Boolean get() = filteredItems.isNotEmpty()
}

/**
 * User/Caller intents triggering state transitions in ViewModel.
 */
sealed interface MediaScraperIntent {
    data class ScrapeUrl(
        val url: String,
        val strategy: ScraperStrategy = ScraperStrategy.AUTO
    ) : MediaScraperIntent

    data class UpdateFilter(val filter: MediaFilter) : MediaScraperIntent
    data object ClearFilter : MediaScraperIntent
    data object Reset : MediaScraperIntent
}

/**
 * Single-fire side effects emitted to the View layer (e.g., alerts, completions).
 */
sealed interface MediaScraperEffect {
    data class Success(val message: String, val count: Int, val durationMs: Long) : MediaScraperEffect
    data class Error(val message: String) : MediaScraperEffect
    data class Info(val message: String) : MediaScraperEffect
}
