package org.hrithikvish.scraper.di

import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import okhttp3.OkHttpClient
import org.hrithikvish.scraper.data.datasource.HttpMediaDataSource
import org.hrithikvish.scraper.data.datasource.ImdbJsonDataSource
import org.hrithikvish.scraper.data.datasource.NetworkSnifferDataSource
import org.hrithikvish.scraper.data.repository.MediaScraperRepositoryImpl
import org.hrithikvish.scraper.domain.repository.MediaScraperRepository
import org.hrithikvish.scraper.domain.usecase.ExportGalleryUseCase
import org.hrithikvish.scraper.domain.usecase.ExtractImdbIdsUseCase
import org.hrithikvish.scraper.domain.usecase.FilterMediaUseCase
import org.hrithikvish.scraper.domain.usecase.ScrapeMediaUseCase
import org.hrithikvish.scraper.domain.usecase.ValidateUrlUseCase
import org.hrithikvish.scraper.presentation.viewmodel.MediaScraperViewModel

/**
 * Dependency Injection Container wiring together Domain, Data, and Presentation layers.
 * Provides clean inversion of control and allows seamless substitution during testing.
 */
object AppContainer {

    val okHttpClient: OkHttpClient by lazy {
        HttpMediaDataSource.defaultOkHttpClient()
    }

    val httpMediaDataSource: HttpMediaDataSource by lazy {
        HttpMediaDataSource(client = okHttpClient)
    }

    val imdbJsonDataSource: ImdbJsonDataSource by lazy {
        ImdbJsonDataSource(client = okHttpClient)
    }

    val networkSnifferDataSource: NetworkSnifferDataSource by lazy {
        NetworkSnifferDataSource()
    }

    val mediaScraperRepository: MediaScraperRepository by lazy {
        MediaScraperRepositoryImpl(
            httpDataSource = httpMediaDataSource,
            imdbDataSource = imdbJsonDataSource,
            networkSnifferDataSource = lazy { networkSnifferDataSource }
        )
    }

    val validateUrlUseCase: ValidateUrlUseCase by lazy {
        ValidateUrlUseCase()
    }

    val filterMediaUseCase: FilterMediaUseCase by lazy {
        FilterMediaUseCase()
    }

    val scrapeMediaUseCase: ScrapeMediaUseCase by lazy {
        ScrapeMediaUseCase(
            repository = mediaScraperRepository,
            validateUrlUseCase = validateUrlUseCase,
            filterMediaUseCase = filterMediaUseCase
        )
    }

    val extractImdbIdsUseCase: ExtractImdbIdsUseCase by lazy {
        ExtractImdbIdsUseCase(client = okHttpClient)
    }

    val exportGalleryUseCase: ExportGalleryUseCase by lazy {
        ExportGalleryUseCase(extractImdbIdsUseCase = extractImdbIdsUseCase)
    }

    /**
     * Factory function creating a new [MediaScraperViewModel].
     */
    fun createViewModel(
        customScope: CoroutineScope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    ): MediaScraperViewModel {
        return MediaScraperViewModel(
            scrapeMediaUseCase = scrapeMediaUseCase,
            filterMediaUseCase = filterMediaUseCase,
            scope = customScope
        )
    }
}
