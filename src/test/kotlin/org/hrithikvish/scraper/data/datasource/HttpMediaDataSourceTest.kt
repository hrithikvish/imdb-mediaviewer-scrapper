package org.hrithikvish.scraper.data.datasource

import org.hrithikvish.scraper.domain.model.MediaType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class HttpMediaDataSourceTest {

    private val dataSource = HttpMediaDataSource()

    @Test
    fun `parses standard img tags and og-image meta tags correctly`() {
        val html = """
            <!DOCTYPE html>
            <html>
            <head>
                <meta property="og:image" content="https://example.com/og-banner.jpg">
            </head>
            <body>
                <img src="/images/photo.png" alt="Profile" width="400" height="400">
                <img data-src="https://cdn.example.com/lazy.webp">
                <video src="https://example.com/intro.mp4" poster="/posters/intro.jpg"></video>
            </body>
            </html>
        """.trimIndent()

        val items = dataSource.parseHtml(html, "https://example.com/gallery/")

        assertEquals(5, items.size)

        val img = items.find { it.url == "https://example.com/images/photo.png" }
        assertTrue(img != null)
        assertEquals(MediaType.IMAGE, img.type)
        assertEquals(400, img.width)
        assertEquals("Profile", img.title)

        val og = items.find { it.url == "https://example.com/og-banner.jpg" }
        assertTrue(og != null)
        assertEquals(MediaType.IMAGE, og.type)

        val video = items.find { it.url == "https://example.com/intro.mp4" }
        assertTrue(video != null)
        assertEquals(MediaType.VIDEO, video.type)
    }

    @Test
    fun `parses srcset attributes with responsive widths`() {
        val html = """
            <img srcset="/small.jpg 300w, /medium.jpg 600w, /large.jpg 1200w" src="/small.jpg">
        """.trimIndent()

        val items = dataSource.parseHtml(html, "https://example.com/")

        val large = items.find { it.url == "https://example.com/large.jpg" }
        assertTrue(large != null)
        assertEquals(1200, large.width)
    }
}
