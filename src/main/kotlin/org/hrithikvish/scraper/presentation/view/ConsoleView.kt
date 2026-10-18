package org.hrithikvish.scraper.presentation.view

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.flow.launchIn
import kotlinx.coroutines.flow.onEach
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.presentation.state.MediaScraperEffect
import org.hrithikvish.scraper.presentation.state.MediaScraperState
import org.hrithikvish.scraper.presentation.state.ScraperStatus
import org.hrithikvish.scraper.presentation.viewmodel.MediaScraperViewModel

/**
 * Console/CLI View implementation of the Presentation Layer.
 * In MVVM, the View only observes the ViewModel's StateFlow & SharedFlow
 * and dispatches user actions/intents to the ViewModel.
 */
class ConsoleView(
    private val viewModel: MediaScraperViewModel
) {

    fun attach(scope: CoroutineScope) {
        // Observe State changes
        viewModel.uiState
            .onEach { state -> renderState(state) }
            .launchIn(scope)

        // Observe Side Effects
        viewModel.effects
            .onEach { effect -> handleEffect(effect) }
            .launchIn(scope)
    }

    private fun renderState(state: MediaScraperState) {
        when (state.status) {
            ScraperStatus.IDLE -> {
                // Initial or reset state
            }

            ScraperStatus.LOADING -> {
                println("\n⏳ [VIEW] Fetching and filtering media from: ${state.currentUrl} (Strategy: ${state.strategy})...")
            }

            ScraperStatus.SUCCESS -> {
                println("\n✅ [VIEW] Extraction complete! Found ${state.filteredItems.size} items (Filtered from ${state.rawItems.size} total)")
                renderMediaTable(state.filteredItems)
            }

            ScraperStatus.ERROR -> {
                println("\n❌ [VIEW] Error: ${state.errorMessage}")
            }
        }
    }

    private fun handleEffect(effect: MediaScraperEffect) {
        when (effect) {
            is MediaScraperEffect.Success -> {
                println("🔔 [EFFECT] ${effect.message} in ${effect.durationMs}ms")
            }

            is MediaScraperEffect.Error -> {
                println("🚨 [EFFECT] Alert: ${effect.message}")
            }

            is MediaScraperEffect.Info -> {
                println("ℹ️ [EFFECT] Info: ${effect.message}")
            }
        }
    }

    private fun renderMediaTable(items: List<MediaItem>) {
        if (items.isEmpty()) {
            println("ℹ️ No media items matched current filters.")
            return
        }

        val separator = "─".repeat(110)
        println(separator)
        println(String.format("%-6s | %-8s | %-12s | %-12s | %s", "INDEX", "TYPE", "DIMENSIONS", "MIME TYPE", "MEDIA URL"))
        println(separator)

        items.take(100).forEachIndexed { idx, item ->
            val dims = if (item.width != null && item.height != null) "${item.width}x${item.height}" else "N/A"
            val mime = item.mimeType ?: "N/A"
            println(
                String.format(
                    "%-6d | %-8s | %-12s | %-12s | %s",
                    idx + 1,
                    item.type,
                    dims,
                    mime,
                    item.url
                )
            )
        }

        if (items.size > 100) {
            println("... and ${items.size - 100} more items.")
        }
        println(separator)
    }
}
