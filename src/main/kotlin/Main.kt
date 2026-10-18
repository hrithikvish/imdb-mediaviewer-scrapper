package org.hrithikvish

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.runBlocking
import org.hrithikvish.scraper.di.AppContainer
import org.hrithikvish.scraper.domain.model.ScrapeResult
import org.hrithikvish.scraper.domain.model.ScraperStrategy
import org.hrithikvish.scraper.presentation.state.MediaScraperIntent
import org.hrithikvish.scraper.presentation.state.ScraperStatus
import org.hrithikvish.scraper.presentation.view.ConsoleView
import java.io.File
import kotlin.system.exitProcess

fun main(args: Array<String>) {
    println("================================================================")
    println("🚀 Starting IMDb Media Scraper")
    println("================================================================")

    val outputPath = "docs/gallery.json"
    val forceReScrape = args.contains("--force") || args.contains("-f")

    // Determine input source
    val rawInput = when {
        args.isEmpty() -> "https://www.imdb.com/title/tt0038650/?ref_=tttrv_ov_i"
        args[0] == "--input" || args[0] == "-i" -> {
            val file = File(args.getOrNull(1) ?: error("Missing input file path"))
            if (!file.exists()) error("Input file not found: ${file.absolutePath}")
            file.readText()
        }
        File(args[0]).exists() && File(args[0]).isFile -> {
            File(args[0]).readText()
        }
        else -> {
            // Join arguments or treat as free text
            args.filter { !it.startsWith("-") }.joinToString("\n")
        }
    }

    // 1. Extract all unique IMDb IDs from input text
    val extractedTitles = AppContainer.extractImdbIdsUseCase(rawInput)

    if (extractedTitles.isEmpty()) {
        System.err.println("❌ No valid IMDb IDs, titles, or links found in input text!")
        exitProcess(1)
    }

    // 2. Prominently display all discovered unique IMDb IDs
    println("\n================================================================")
    println("📋 Discovered ${extractedTitles.size} Unique IMDb Titles from Input:")
    println("================================================================")
    extractedTitles.forEachIndexed { index, title ->
        val num = (index + 1).toString().padStart(3, ' ')
        val name = title.name ?: "Unknown Title"
        println(" [$num] ${title.id} — $name")
    }
    println("================================================================\n")

    var exitCode = 0

    runBlocking {
        if (extractedTitles.size == 1) {
            // Single Title Flow
            val title = extractedTitles.first()
            val targetUrl = "https://www.imdb.com/title/${title.id}/mediaviewer"
            println("🎯 Scraping single title: ${title.name ?: title.id} ($targetUrl)")

            val viewJob = Job()
            val viewScope = CoroutineScope(Dispatchers.Default + viewJob)
            val viewModel = AppContainer.createViewModel(viewScope)
            val view = ConsoleView(viewModel)
            view.attach(viewScope)

            viewModel.processIntent(
                MediaScraperIntent.ScrapeUrl(
                    url = targetUrl,
                    strategy = ScraperStrategy.AUTO
                )
            )

            val completedState = viewModel.uiState.first {
                it.status == ScraperStatus.SUCCESS || it.status == ScraperStatus.ERROR
            }

            if (completedState.status == ScraperStatus.ERROR) {
                System.err.println("❌ Scraping failed: ${completedState.errorMessage}")
                exitCode = 1
            } else if (completedState.hasItems) {
                println("\n✨ Total photos discovered: ${completedState.filteredItems.size}")
                val result = completedState.lastResult
                if (result != null) {
                    val exported = AppContainer.exportGalleryUseCase(result, outputPath, nameOverride = title.name)
                    println("💾 [EXPORT] Successfully saved gallery JSON to: ${exported.path} for GitHub Pages")
                }
            }
            viewJob.cancel()
        } else {
            // Batch Scraping Flow
            println("⚡ Starting batch scrape for ${extractedTitles.size} unique titles...")
            var successCount = 0
            var failCount = 0

            AppContainer.networkSnifferDataSource.extractBatchMedia(
                titles = extractedTitles,
                forceReScrape = forceReScrape
            ) { title, rawItems, durationMs ->
                val filteredItems = AppContainer.filterMediaUseCase(rawItems)
                if (filteredItems.isNotEmpty()) {
                    val scrapeResult = ScrapeResult(
                        targetUrl = "https://www.imdb.com/title/${title.id}/mediaviewer",
                        items = filteredItems,
                        durationMs = durationMs,
                        strategyUsed = ScraperStrategy.NETWORK_SNIFFER
                    )
                    val exported = AppContainer.exportGalleryUseCase(
                        result = scrapeResult,
                        targetFilePath = outputPath,
                        nameOverride = title.name
                    )
                    println("💾 [SAVED] ${title.name ?: title.id} (${filteredItems.size} photos) -> ${exported.path}")
                    successCount++
                } else {
                    println("⚠️ [EMPTY] No media images found for ${title.name ?: title.id}")
                    failCount++
                }
            }

            println("\n================================================================")
            println("🎉 Batch Scraping Finished!")
            println("   - Successfully scraped: $successCount titles")
            println("   - Skipped / Failed:     $failCount titles")
            println("   - Total unique titles:  ${extractedTitles.size}")
            println("================================================================")
        }
    }

    println("\n🏁 Done.")
    exitProcess(exitCode)
}