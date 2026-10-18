package org.hrithikvish.scraper.presentation.viewmodel

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.hrithikvish.scraper.domain.model.MediaFilter
import org.hrithikvish.scraper.domain.model.ScraperStrategy
import org.hrithikvish.scraper.domain.usecase.FilterMediaUseCase
import org.hrithikvish.scraper.domain.usecase.ScrapeMediaUseCase
import org.hrithikvish.scraper.presentation.state.MediaScraperEffect
import org.hrithikvish.scraper.presentation.state.MediaScraperIntent
import org.hrithikvish.scraper.presentation.state.MediaScraperState
import org.hrithikvish.scraper.presentation.state.ScraperStatus

/**
 * ViewModel managing the business state of media scraping and filtering.
 * Bridges UseCases with presentation views through reactive StateFlow & SharedFlow.
 */
class MediaScraperViewModel(
    private val scrapeMediaUseCase: ScrapeMediaUseCase,
    private val filterMediaUseCase: FilterMediaUseCase = FilterMediaUseCase(),
    private val scope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
) {

    private val _uiState = MutableStateFlow(MediaScraperState())
    val uiState: StateFlow<MediaScraperState> = _uiState.asStateFlow()

    private val _effects = MutableSharedFlow<MediaScraperEffect>()
    val effects: SharedFlow<MediaScraperEffect> = _effects.asSharedFlow()

    fun processIntent(intent: MediaScraperIntent) {
        when (intent) {
            is MediaScraperIntent.ScrapeUrl -> scrape(intent.url, intent.strategy)
            is MediaScraperIntent.UpdateFilter -> updateFilter(intent.filter)
            is MediaScraperIntent.ClearFilter -> clearFilter()
            is MediaScraperIntent.Reset -> reset()
        }
    }

    fun scrape(url: String, strategy: ScraperStrategy = ScraperStrategy.AUTO) {
        _uiState.update {
            it.copy(
                status = ScraperStatus.LOADING,
                currentUrl = url,
                strategy = strategy,
                errorMessage = null
            )
        }

        scope.launch {
            val result = scrapeMediaUseCase(rawUrl = url, strategy = strategy)

            result.fold(
                onSuccess = { scrapeResult ->
                    val filtered = filterMediaUseCase(scrapeResult.items, _uiState.value.filter)
                    _uiState.update {
                        it.copy(
                            status = ScraperStatus.SUCCESS,
                            rawItems = scrapeResult.items,
                            filteredItems = filtered,
                            lastResult = scrapeResult,
                            errorMessage = null
                        )
                    }
                    _effects.emit(
                        MediaScraperEffect.Success(
                            message = "Successfully scraped ${scrapeResult.items.size} assets via ${scrapeResult.strategyUsed}",
                            count = scrapeResult.items.size,
                            durationMs = scrapeResult.durationMs
                        )
                    )
                },
                onFailure = { throwable ->
                    val message = throwable.message ?: "An unexpected error occurred"
                    _uiState.update {
                        it.copy(
                            status = ScraperStatus.ERROR,
                            errorMessage = message
                        )
                    }
                    _effects.emit(MediaScraperEffect.Error(message))
                }
            )
        }
    }

    fun updateFilter(newFilter: MediaFilter) {
        _uiState.update { current ->
            val updatedFiltered = filterMediaUseCase(current.rawItems, newFilter)
            current.copy(
                filter = newFilter,
                filteredItems = updatedFiltered
            )
        }
    }

    fun clearFilter() {
        updateFilter(MediaFilter())
    }

    fun reset() {
        _uiState.value = MediaScraperState()
    }
}
