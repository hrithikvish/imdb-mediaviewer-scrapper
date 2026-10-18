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

    @Test
    fun `extracts plainText markdown captions and master resolutions from ImageEdge`() {
        val html = """
            <!DOCTYPE html>
            <html>
            <body>
                <script id="__NEXT_DATA__" type="application/json">
                {
                    "props": {
                        "pageProps": {
                            "contentData": {
                                "edges": [
                                    {
                                        "node": {
                                            "id": "rm1218288898",
                                            "caption": {
                                                "plainText": "Joey King at an event for It's a Wonderful Life (1946)",
                                                "__typename": "Markdown"
                                            },
                                            "height": 3635,
                                            "width": 2450,
                                            "url": "https://m.media-amazon.com/images/M/MV5BNWE2Y2M0ZTIt._V1_QL75_UX400_.jpg"
                                        }
                                    }
                                ]
                            }
                        }
                    }
                }
                </script>
            </body>
            </html>
        """.trimIndent()

        val items = dataSource.extractFromHtml(html, "https://www.imdb.com/title/tt0038650/mediaindex/")

        assertEquals(1, items.size)
        val item = items.first()
        assertEquals("https://m.media-amazon.com/images/M/MV5BNWE2Y2M0ZTIt._V1_.jpg", item.url)
        assertEquals("Joey King at an event for It's a Wonderful Life (1946)", item.title)
        assertEquals(2450, item.width)
        assertEquals(3635, item.height)
    }

    @Test
    fun `filters out generic View Poster captions`() {
        val html = """
            <!DOCTYPE html>
            <html>
            <body>
                <script id="__NEXT_DATA__" type="application/json">
                {
                    "props": {
                        "pageProps": {
                            "image": {
                                "title": "View Poster",
                                "url": "https://m.media-amazon.com/images/M/MV5BNzQx._V1_.jpg"
                            }
                        }
                    }
                }
                </script>
            </body>
            </html>
        """.trimIndent()

        val items = dataSource.extractFromHtml(html, "https://www.imdb.com/")

        assertEquals(1, items.size)
        assertEquals(null, items.first().title)
    }

    @Test
    fun `extracts media items from GraphQL pagination response`() {
        val graphQlResponse = """
            {
                "data": {
                    "title": {
                        "images": {
                            "edges": [
                                {
                                    "node": {
                                        "id": "rm3151421697",
                                        "caption": {
                                            "plainText": "James Stewart and Donna Reed in It's a Wonderful Life (1946)"
                                        },
                                        "height": 2048,
                                        "width": 1600,
                                        "url": "https://m.media-amazon.com/images/M/MV5BMjAy._V1_QL75_UX200_.jpg"
                                    }
                                }
                            ]
                        }
                    }
                }
            }
        """.trimIndent()

        val items = dataSource.extractFromGraphQl(graphQlResponse)

        assertEquals(1, items.size)
        val item = items.first()
        assertEquals("https://m.media-amazon.com/images/M/MV5BMjAy._V1_.jpg", item.url)
        assertEquals("James Stewart and Donna Reed in It's a Wonderful Life (1946)", item.title)
        assertEquals(1600, item.width)
        assertEquals(2048, item.height)
    }
}
