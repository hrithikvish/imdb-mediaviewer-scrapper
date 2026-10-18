package org.hrithikvish.scraper.domain.usecase

import org.hrithikvish.scraper.domain.model.MediaFilter
import org.hrithikvish.scraper.domain.model.MediaItem

/**
 * UseCase to filter and sort media items according to user-defined criteria.
 */
class FilterMediaUseCase {

    operator fun invoke(items: List<MediaItem>, filter: MediaFilter): List<MediaItem> {
        return items
            .filter { filter.matches(it) }
            .distinctBy { it.url }
    }
}
