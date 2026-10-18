package org.hrithikvish.scraper.data.datasource

import org.hrithikvish.scraper.domain.model.MediaType
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ImdbJsonDataSourceTest {

    private val dataSource = ImdbJsonDataSource()

    @Test
    fun `extracts images and strips resize parameters from Next_js payload`() {
        val html = """
            <!DOCTYPE html>
            <html>
            <body>
                <script id="__NEXT_DATA__" type="application/json">
                {
                    "props": {
                        "pageProps": {
                            "mediaViewerModel": {
                                "caption": "The Shawshank Redemption",
                                "url": "https://m.media-amazon.com/images/M/MV5BMDFkYTc0MGEt._V1_QL75_UX380_CR0,0,380,562_.jpg",
                                "width": 1920,
                                "height": 1080
                            }
                        }
                    }
                }
                </script>
            </body>
            </html>
        """.trimIndent()

        val items = dataSource.extractFromHtml(html, "https://www.imdb.com/title/tt0111161/mediaviewer/rm10105600/")

        assertEquals(1, items.size)
        val item = items.first()
        assertEquals("https://m.media-amazon.com/images/M/MV5BMDFkYTc0MGEt._V1_.jpg", item.url)
        assertEquals(MediaType.IMAGE, item.type)
        assertEquals(1920, item.width)
        assertEquals(1080, item.height)
        assertEquals("The Shawshank Redemption", item.title)
    }
}
