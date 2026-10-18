package org.hrithikvish.scraper.presentation.viewmodel

import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.TestScope
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import org.hrithikvish.scraper.domain.model.MediaFilter
import org.hrithikvish.scraper.domain.model.MediaItem
import org.hrithikvish.scraper.domain.model.MediaType
import org.hrithikvish.scraper.domain.model.ScrapeResult
import org.hrithikvish.scraper.domain.model.ScraperStrategy
import org.hrithikvish.scraper.domain.repository.MediaScraperRepository
import org.hrithikvish.scraper.domain.usecase.FilterMediaUseCase
import org.hrithikvish.scraper.domain.usecase.ScrapeMediaUseCase
import org.hrithikvish.scraper.presentation.state.MediaScraperIntent
import org.hrithikvish.scraper.presentation.state.ScraperStatus
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

@OptIn(ExperimentalCoroutinesApi::class)
class MediaScraperViewModelTest {

    private val testDispatcher = StandardTestDispatcher()
    private val testScope = TestScope(testDispatcher)

    private val mockRepository = mockk<MediaScraperRepository>()
    private val filterUseCase = FilterMediaUseCase()
    private lateinit var scrapeUseCase: ScrapeMediaUseCase
    private lateinit var viewModel: MediaScraperViewModel

    @BeforeTest
    fun setUp() {
        Dispatchers.setMain(testDispatcher)
        scrapeUseCase = ScrapeMediaUseCase(
            repository = mockRepository,
            filterMediaUseCase = filterUseCase,
            defaultDispatcher = testDispatcher
        )
        viewModel = MediaScraperViewModel(
            scrapeMediaUseCase = scrapeUseCase,
            filterMediaUseCase = filterUseCase,
            scope = testScope
        )
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    @Test
    fun `initial state is idle`() {
        val state = viewModel.uiState.value
        assertEquals(ScraperStatus.IDLE, state.status)
        assertTrue(state.filteredItems.isEmpty())
        assertFalse(state.isLoading)
    }

    @Test
    fun `scrape intent updates state to success with extracted items`() = runTest(testDispatcher) {
        val sampleItems = listOf(
            MediaItem("https://example.com/banner.png", MediaType.IMAGE),
            MediaItem("https://example.com/trailer.mp4", MediaType.VIDEO)
        )
        val expectedResult = ScrapeResult(
            targetUrl = "https://example.com",
            items = sampleItems,
            durationMs = 150,
            strategyUsed = ScraperStrategy.HTTP_DOM
        )

        coEvery { mockRepository.scrapeMedia("https://example.com", any()) } returns expectedResult

        viewModel.processIntent(MediaScraperIntent.ScrapeUrl("https://example.com"))
        advanceUntilIdle()

        val finalState = viewModel.uiState.value
        assertEquals(ScraperStatus.SUCCESS, finalState.status)
        assertEquals(2, finalState.filteredItems.size)
    }

    @Test
    fun `update filter dynamically filters state items without re-fetching`() = runTest(testDispatcher) {
        val sampleItems = listOf(
            MediaItem("https://example.com/pic.jpg", MediaType.IMAGE),
            MediaItem("https://example.com/sound.mp3", MediaType.AUDIO)
        )
        coEvery { mockRepository.scrapeMedia(any(), any()) } returns ScrapeResult(
            targetUrl = "https://example.com",
            items = sampleItems,
            durationMs = 100,
            strategyUsed = ScraperStrategy.HTTP_DOM
        )

        viewModel.processIntent(MediaScraperIntent.ScrapeUrl("https://example.com"))
        advanceUntilIdle()

        assertEquals(2, viewModel.uiState.value.filteredItems.size)

        // Apply filter for only AUDIO
        viewModel.processIntent(MediaScraperIntent.UpdateFilter(MediaFilter(allowedTypes = setOf(MediaType.AUDIO))))

        val stateAfterFilter = viewModel.uiState.value
        assertEquals(1, stateAfterFilter.filteredItems.size)
        assertEquals(MediaType.AUDIO, stateAfterFilter.filteredItems.first().type)
    }
}
