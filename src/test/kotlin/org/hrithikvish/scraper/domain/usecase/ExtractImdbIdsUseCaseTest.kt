package org.hrithikvish.scraper.domain.usecase

import org.junit.jupiter.api.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ExtractImdbIdsUseCaseTest {

    private val useCase = ExtractImdbIdsUseCase()

    @Test
    fun `extracts unique imdb ids from multiline text with movie names`() {
        val input = """
            It's a Wonderful Life: https://www.imdb.com/title/tt0038650/
            To Kill a Mockingbird: https://www.imdb.com/title/tt0056592/
            Schindler's List: https://www.imdb.com/title/tt0108052/
            Duplicate Wonderful Life: tt0038650
        """.trimIndent()

        val results = useCase(input)

        assertEquals(3, results.size)
        assertEquals("tt0038650", results[0].id)
        assertTrue(results[0].name?.contains("It's a Wonderful Life") == true)
        assertEquals("tt0056592", results[1].id)
        assertTrue(results[1].name?.contains("To Kill a Mockingbird") == true)
        assertEquals("tt0108052", results[2].id)
        assertTrue(results[2].name?.contains("Schindler's List") == true)
    }

    @Test
    fun `resolves search queries to imdb title id`() {
        val input = "Miracle on 34th Street: https://www.imdb.com/find/?q=Miracle%20on%2034th%20Street%201947"
        val results = useCase(input)

        assertEquals(1, results.size)
        assertEquals("tt0039628", results[0].id)
        assertTrue(results[0].name?.contains("Miracle on 34th Street") == true)
    }

    @Test
    fun `handles single raw ID or URL`() {
        val results = useCase("https://www.imdb.com/title/tt0075148/?ref_=ext")
        assertEquals(1, results.size)
        assertEquals("tt0075148", results[0].id)
    }

    @Test
    fun `handles comma-separated and whitespace-separated raw IDs and URLs`() {
        val input = "tt0038650, https://www.imdb.com/title/tt0056592/, tt0108052"
        val results = useCase(input)
        assertEquals(3, results.size)
        assertEquals("tt0038650", results[0].id)
        assertEquals("tt0056592", results[1].id)
        assertEquals("tt0108052", results[2].id)
    }

    @Test
    fun `extracts all 100 unique movies from the user dataset`() {
        val input = """
            It's a Wonderful Life: https://www.imdb.com/title/tt0038650/
            To Kill a Mockingbird: https://www.imdb.com/title/tt0056592/
            Schindler's List: https://www.imdb.com/title/tt0108052/
            Rocky: https://www.imdb.com/title/tt0075148/
            Mr. Smith Goes to Washington: https://www.imdb.com/title/tt0031679/
            E.T. the Extra-Terrestrial: https://www.imdb.com/title/tt0083866/
            The Grapes of Wrath: https://www.imdb.com/title/tt0032551/
            Breaking Away: https://www.imdb.com/title/tt0078902/
            Miracle on 34th Street: https://www.imdb.com/find/?q=Miracle%20on%2034th%20Street%201947
            Saving Private Ryan: https://www.imdb.com/title/tt0120815/
            The Best Years of Our Lives: https://www.imdb.com/title/tt0036868/
            Apollo 13: https://www.imdb.com/title/tt0112384/
            Hoosiers: https://www.imdb.com/title/tt0091217/
            The Bridge on the River Kwai: https://www.imdb.com/title/tt0050212/
            The Miracle Worker: https://www.imdb.com/title/tt0056241/
            Norma Rae: https://www.imdb.com/title/tt0079638/
            One Flew Over the Cuckoo's Nest: https://www.imdb.com/title/tt0073486/
            The Diary of Anne Frank: https://www.imdb.com/title/tt0052738/
            The Right Stuff: https://www.imdb.com/title/tt0086197/
            Philadelphia: https://www.imdb.com/title/tt0107818/
            In the Heat of the Night: https://www.imdb.com/title/tt0061811/
            The Pride of the Yankees: https://www.imdb.com/title/tt0035211/
            The Shawshank Redemption: https://www.imdb.com/title/tt0111161/
            National Velvet: https://www.imdb.com/title/tt0037120/
            Sullivan's Travels: https://www.imdb.com/title/tt0034240/
            The Wizard of Oz: https://www.imdb.com/title/tt0032138/
            High Noon: https://www.imdb.com/title/tt0044706/
            Field of Dreams: https://www.imdb.com/title/tt0097351/
            Gandhi: https://www.imdb.com/title/tt0083987/
            Lawrence of Arabia: https://www.imdb.com/title/tt0056172/
            Glory: https://www.imdb.com/title/tt0097441/
            Casablanca: https://www.imdb.com/title/tt0034583/
            City Lights: https://www.imdb.com/title/tt0021749/
            All the President's Men: https://www.imdb.com/title/tt0074119/
            Guess Who's Coming to Dinner: https://www.imdb.com/title/tt0061735/
            On the Waterfront: https://www.imdb.com/title/tt0047296/
            Forrest Gump: https://www.imdb.com/title/tt0109830/
            Pinocchio: https://www.imdb.com/title/tt0032910/
            Star Wars: https://www.imdb.com/title/tt0076759/
            Mrs. Miniver: https://www.imdb.com/title/tt0035093/
            The Sound of Music: https://www.imdb.com/title/tt0059742/
            12 Angry Men: https://www.imdb.com/title/tt0050083/
            Gone with the Wind: https://www.imdb.com/title/tt0031381/
            Spartacus: https://www.imdb.com/title/tt0054331/
            On Golden Pond: https://www.imdb.com/title/tt0082846/
            Lilies of the Field: https://www.imdb.com/title/tt0057251/
            2001: A Space Odyssey: https://www.imdb.com/title/tt0062622/
            The African Queen: https://www.imdb.com/title/tt0043265/
            Meet John Doe: https://www.imdb.com/title/tt0033891/
            Seabiscuit: https://www.imdb.com/title/tt0329575/
            The Color Purple: https://www.imdb.com/title/tt0088939/
            Dead Poets Society: https://www.imdb.com/title/tt0097165/
            Shane: https://www.imdb.com/title/tt0046303/
            Rudy: https://www.imdb.com/title/tt0108002/
            The Defiant Ones: https://www.imdb.com/title/tt0051525/
            Ben-Hur: https://www.imdb.com/title/tt0052618/
            Sergeant York: https://www.imdb.com/title/tt0034167/
            Close Encounters of the Third Kind: https://www.imdb.com/title/tt0075860/
            Dances with Wolves: https://www.imdb.com/title/tt0099348/
            The Killing Fields: https://www.imdb.com/title/tt0087553/
            Sounder: https://www.imdb.com/title/tt0069303/
            Braveheart: https://www.imdb.com/title/tt0112573/
            Rain Man: https://www.imdb.com/title/tt0095953/
            The Black Stallion: https://www.imdb.com/title/tt0078872/
            A Raisin in the Sun: https://www.imdb.com/title/tt0055353/
            Silkwood: https://www.imdb.com/title/tt0086312/
            The Day the Earth Stood Still: https://www.imdb.com/title/tt0043456/
            An Officer and a Gentleman: https://www.imdb.com/title/tt0084434/
            The Spirit of St. Louis: https://www.imdb.com/title/tt0051003/
            Coal Miner's Daughter: https://www.imdb.com/title/tt0080549/
            Cool Hand Luke: https://www.imdb.com/title/tt0061512/
            Dark Victory: https://www.imdb.com/title/tt0031210/
            Erin Brockovich: https://www.imdb.com/title/tt0195685/
            Gunga Din: https://www.imdb.com/title/tt0031398/
            The Verdict: https://www.imdb.com/title/tt0084855/
            Birdman of Alcatraz: https://www.imdb.com/title/tt0055798/
            Driving Miss Daisy: https://www.imdb.com/title/tt0097239/
            Thelma & Louise: https://www.imdb.com/title/tt0103074/
            The Ten Commandments: https://www.imdb.com/title/tt0049833/
            Babe: https://www.imdb.com/title/tt0112431/
            Boys Town: https://www.imdb.com/title/tt0030116/
            Fiddler on the Roof: https://www.imdb.com/title/tt0067093/
            Mr. Deeds Goes to Town: https://www.imdb.com/title/tt0027996/
            Serpico: https://www.imdb.com/title/tt0070666/
            What's Love Got to Do with It: https://www.imdb.com/title/tt0108551/
            Stand and Deliver: https://www.imdb.com/title/tt0094027/
            Working Girl: https://www.imdb.com/title/tt0096463/
            Yankee Doodle Dandy: https://www.imdb.com/title/tt0035575/
            Harold and Maude: https://www.imdb.com/title/tt0067185/
            Hotel Rwanda: https://www.imdb.com/title/tt0395169/
            The Paper Chase: https://www.imdb.com/title/tt0070509/
            Fame: https://www.imdb.com/title/tt0080716/
            A Beautiful Mind: https://www.imdb.com/title/tt0268978/
            Captains Courageous: https://www.imdb.com/title/tt0028691/
            Places in the Heart: https://www.imdb.com/title/tt0087921/
            Searching for Bobby Fischer: https://www.imdb.com/title/tt0108065/
            Madame Curie: https://www.imdb.com/title/tt0036126/
            The Karate Kid: https://www.imdb.com/title/tt0087538/
            Ray: https://www.imdb.com/title/tt0350258/
            Chariots of Fire: https://www.imdb.com/title/tt0082158/
        """.trimIndent()

        val results = useCase(input)
        assertEquals(100, results.size)
        // Verify every single extracted item has a valid tt ID
        assertTrue(results.all { it.id.matches(Regex("tt\\d+")) })
        // Verify unique IDs
        assertEquals(100, results.map { it.id }.toSet().size)
    }

    @Test
    fun `extracts all 100 unique movies when flattened to single line with spaces like in GitHub Actions UI`() {
        val input = """
            It's a Wonderful Life: https://www.imdb.com/title/tt0038650/
            To Kill a Mockingbird: https://www.imdb.com/title/tt0056592/
            Schindler's List: https://www.imdb.com/title/tt0108052/
            Rocky: https://www.imdb.com/title/tt0075148/
            Mr. Smith Goes to Washington: https://www.imdb.com/title/tt0031679/
            E.T. the Extra-Terrestrial: https://www.imdb.com/title/tt0083866/
            The Grapes of Wrath: https://www.imdb.com/title/tt0032551/
            Breaking Away: https://www.imdb.com/title/tt0078902/
            Miracle on 34th Street: https://www.imdb.com/find/?q=Miracle%20on%2034th%20Street%201947
            Saving Private Ryan: https://www.imdb.com/title/tt0120815/
            The Best Years of Our Lives: https://www.imdb.com/title/tt0036868/
            Apollo 13: https://www.imdb.com/title/tt0112384/
            Hoosiers: https://www.imdb.com/title/tt0091217/
            The Bridge on the River Kwai: https://www.imdb.com/title/tt0050212/
            The Miracle Worker: https://www.imdb.com/title/tt0056241/
            Norma Rae: https://www.imdb.com/title/tt0079638/
            One Flew Over the Cuckoo's Nest: https://www.imdb.com/title/tt0073486/
            The Diary of Anne Frank: https://www.imdb.com/title/tt0052738/
            The Right Stuff: https://www.imdb.com/title/tt0086197/
            Philadelphia: https://www.imdb.com/title/tt0107818/
            In the Heat of the Night: https://www.imdb.com/title/tt0061811/
            The Pride of the Yankees: https://www.imdb.com/title/tt0035211/
            The Shawshank Redemption: https://www.imdb.com/title/tt0111161/
            National Velvet: https://www.imdb.com/title/tt0037120/
            Sullivan's Travels: https://www.imdb.com/title/tt0034240/
            The Wizard of Oz: https://www.imdb.com/title/tt0032138/
            High Noon: https://www.imdb.com/title/tt0044706/
            Field of Dreams: https://www.imdb.com/title/tt0097351/
            Gandhi: https://www.imdb.com/title/tt0083987/
            Lawrence of Arabia: https://www.imdb.com/title/tt0056172/
            Glory: https://www.imdb.com/title/tt0097441/
            Casablanca: https://www.imdb.com/title/tt0034583/
            City Lights: https://www.imdb.com/title/tt0021749/
            All the President's Men: https://www.imdb.com/title/tt0074119/
            Guess Who's Coming to Dinner: https://www.imdb.com/title/tt0061735/
            On the Waterfront: https://www.imdb.com/title/tt0047296/
            Forrest Gump: https://www.imdb.com/title/tt0109830/
            Pinocchio: https://www.imdb.com/title/tt0032910/
            Star Wars: https://www.imdb.com/title/tt0076759/
            Mrs. Miniver: https://www.imdb.com/title/tt0035093/
            The Sound of Music: https://www.imdb.com/title/tt0059742/
            12 Angry Men: https://www.imdb.com/title/tt0050083/
            Gone with the Wind: https://www.imdb.com/title/tt0031381/
            Spartacus: https://www.imdb.com/title/tt0054331/
            On Golden Pond: https://www.imdb.com/title/tt0082846/
            Lilies of the Field: https://www.imdb.com/title/tt0057251/
            2001: A Space Odyssey: https://www.imdb.com/title/tt0062622/
            The African Queen: https://www.imdb.com/title/tt0043265/
            Meet John Doe: https://www.imdb.com/title/tt0033891/
            Seabiscuit: https://www.imdb.com/title/tt0329575/
            The Color Purple: https://www.imdb.com/title/tt0088939/
            Dead Poets Society: https://www.imdb.com/title/tt0097165/
            Shane: https://www.imdb.com/title/tt0046303/
            Rudy: https://www.imdb.com/title/tt0108002/
            The Defiant Ones: https://www.imdb.com/title/tt0051525/
            Ben-Hur: https://www.imdb.com/title/tt0052618/
            Sergeant York: https://www.imdb.com/title/tt0034167/
            Close Encounters of the Third Kind: https://www.imdb.com/title/tt0075860/
            Dances with Wolves: https://www.imdb.com/title/tt0099348/
            The Killing Fields: https://www.imdb.com/title/tt0087553/
            Sounder: https://www.imdb.com/title/tt0069303/
            Braveheart: https://www.imdb.com/title/tt0112573/
            Rain Man: https://www.imdb.com/title/tt0095953/
            The Black Stallion: https://www.imdb.com/title/tt0078872/
            A Raisin in the Sun: https://www.imdb.com/title/tt0055353/
            Silkwood: https://www.imdb.com/title/tt0086312/
            The Day the Earth Stood Still: https://www.imdb.com/title/tt0043456/
            An Officer and a Gentleman: https://www.imdb.com/title/tt0084434/
            The Spirit of St. Louis: https://www.imdb.com/title/tt0051003/
            Coal Miner's Daughter: https://www.imdb.com/title/tt0080549/
            Cool Hand Luke: https://www.imdb.com/title/tt0061512/
            Dark Victory: https://www.imdb.com/title/tt0031210/
            Erin Brockovich: https://www.imdb.com/title/tt0195685/
            Gunga Din: https://www.imdb.com/title/tt0031398/
            The Verdict: https://www.imdb.com/title/tt0084855/
            Birdman of Alcatraz: https://www.imdb.com/title/tt0055798/
            Driving Miss Daisy: https://www.imdb.com/title/tt0097239/
            Thelma & Louise: https://www.imdb.com/title/tt0103074/
            The Ten Commandments: https://www.imdb.com/title/tt0049833/
            Babe: https://www.imdb.com/title/tt0112431/
            Boys Town: https://www.imdb.com/title/tt0030116/
            Fiddler on the Roof: https://www.imdb.com/title/tt0067093/
            Mr. Deeds Goes to Town: https://www.imdb.com/title/tt0027996/
            Serpico: https://www.imdb.com/title/tt0070666/
            What's Love Got to Do with It: https://www.imdb.com/title/tt0108551/
            Stand and Deliver: https://www.imdb.com/title/tt0094027/
            Working Girl: https://www.imdb.com/title/tt0096463/
            Yankee Doodle Dandy: https://www.imdb.com/title/tt0035575/
            Harold and Maude: https://www.imdb.com/title/tt0067185/
            Hotel Rwanda: https://www.imdb.com/title/tt0395169/
            The Paper Chase: https://www.imdb.com/title/tt0070509/
            Fame: https://www.imdb.com/title/tt0080716/
            A Beautiful Mind: https://www.imdb.com/title/tt0268978/
            Captains Courageous: https://www.imdb.com/title/tt0028691/
            Places in the Heart: https://www.imdb.com/title/tt0087921/
            Searching for Bobby Fischer: https://www.imdb.com/title/tt0108065/
            Madame Curie: https://www.imdb.com/title/tt0036126/
            The Karate Kid: https://www.imdb.com/title/tt0087538/
            Ray: https://www.imdb.com/title/tt0350258/
            Chariots of Fire: https://www.imdb.com/title/tt0082158/
        """.trimIndent().replace("\n", " ")

        val results = useCase(input)
        assertEquals(100, results.size)
        assertEquals(100, results.map { it.id }.toSet().size)
        assertEquals("tt0038650", results[0].id)
        assertTrue(results[0].name?.contains("It's a Wonderful Life") == true)
        assertEquals("tt0056592", results[1].id)
        assertTrue(results[1].name?.contains("To Kill a Mockingbird") == true)
        assertEquals("tt0039628", results[8].id) // Miracle on 34th Street resolved from search URL
        assertTrue(results[8].name?.contains("Miracle on 34th Street") == true)
        assertEquals("tt0082158", results[99].id)
        assertTrue(results[99].name?.contains("Chariots of Fire") == true)
    }

    @Test
    fun `handles URLs followed by movie names with colons and spaces without misattribution`() {
        val input = "https://www.imdb.com/title/tt0120815/: Saving Private Ryan tt0039628: Miracle on 34th Street (1947)"
        val results = useCase(input)

        assertEquals(2, results.size)
        assertEquals("tt0120815", results[0].id)
        assertTrue(results[0].name?.contains("Saving Private Ryan") == true)

        assertEquals("tt0039628", results[1].id)
        assertTrue(results[1].name?.contains("Miracle on 34th Street") == true)
    }
}
