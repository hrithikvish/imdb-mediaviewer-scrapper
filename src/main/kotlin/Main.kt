package org.hrithikvish

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.hrithikvish.scraper.di.AppContainer
import org.hrithikvish.scraper.domain.model.ScraperStrategy
import org.hrithikvish.scraper.presentation.state.MediaScraperIntent
import org.hrithikvish.scraper.presentation.state.ScraperStatus
import org.hrithikvish.scraper.presentation.view.ConsoleView
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    println("================================================================")
    println("🚀 Starting Media Scraper")
    println("================================================================")

    var exitCode = 0

    runBlocking {
        val viewJob = Job()
        val viewScope = CoroutineScope(Dispatchers.Default + viewJob)

        // 1. Initialize Dependency Injection Container & ViewModel
        val viewModel = AppContainer.createViewModel(viewScope)

        // 2. Attach View to ViewModel
        val view = ConsoleView(viewModel)
        view.attach(viewScope)

        // 3. Determine target URL & output path (CLI arguments or defaults)
        val targetUrl = args.getOrNull(0) ?: "https://www.imdb.com/title/tt0038650/?ref_=tttrv_ov_i"
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

        if (completedState.status == ScraperStatus.ERROR) {
            System.err.println("❌ Scraping failed: ${completedState.errorMessage}")
            exitCode = 1
        } else if (completedState.hasItems) {
            println("\n✨ Total photos discovered: ${completedState.filteredItems.size}")

            // 5. Automatically export for GitHub Pages web app
            val result = completedState.lastResult
            if (result != null) {
                val exported = AppContainer.exportGalleryUseCase(result, outputPath)
                println("💾 [EXPORT] Successfully saved gallery JSON to: ${exported.path} for GitHub Pages")
            }
        }

        // 6. Cancel view collector coroutines so runBlocking finishes
        viewJob.cancel()
    }

    println("\n🏁 Done.")
    exitProcess(exitCode)
}