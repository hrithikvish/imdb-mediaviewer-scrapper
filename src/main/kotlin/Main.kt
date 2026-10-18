package org.hrithikvish

import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.hrithikvish.scraper.di.AppContainer
import org.hrithikvish.scraper.domain.model.MediaFilter
import org.hrithikvish.scraper.domain.model.MediaType
import org.hrithikvish.scraper.domain.model.ScraperStrategy
import org.hrithikvish.scraper.presentation.state.MediaScraperIntent
import org.hrithikvish.scraper.presentation.state.ScraperStatus
import org.hrithikvish.scraper.presentation.view.ConsoleView

fun main(args: Array<String>) = runBlocking {
    println("================================================================")
    println("🚀 Starting Media Scraper")
    println("================================================================")

    // 1. Initialize Dependency Injection Container
    val viewModel = AppContainer.createViewModel(this)

    // 2. Attach View to ViewModel
    val view = ConsoleView(viewModel)
    view.attach(this)

    // 3. Determine target URL & output path (CLI arguments or defaults)
    val targetUrl = args.getOrNull(0) ?: "https://www.imdb.com/title/tt0056241/mediaviewer"
    val outputPath = args.getOrNull(1) ?: "docs/gallery.json"

    println("\n🎯 Submitting scrape intent for: $targetUrl")

    // 4. Dispatch Intent to ViewModel (Auto strategy tries IMDb JSON, falls back to DOM/Sniffer)
    viewModel.processIntent(
        MediaScraperIntent.ScrapeUrl(
            url = targetUrl,
            strategy = ScraperStrategy.AUTO
        )
    )

    // Reactively wait until scraping completes (SUCCESS or ERROR)
    val completedState = viewModel.uiState.first {
        it.status == ScraperStatus.SUCCESS || it.status == ScraperStatus.ERROR
    }

    // 5. Allow ConsoleView to finish rendering all scraped items
    if (completedState.hasItems) {
        println("\n✨ Total photos discovered: ${completedState.filteredItems.size}")

        // 6. Automatically export for GitHub Pages web app
        val result = completedState.lastResult
        if (result != null) {
            val exported = AppContainer.exportGalleryUseCase(result, outputPath)
            println("💾 [EXPORT] Successfully saved gallery JSON to: ${exported.path} for GitHub Pages")
        }
    }

    println("\n🏁 Done.")
}