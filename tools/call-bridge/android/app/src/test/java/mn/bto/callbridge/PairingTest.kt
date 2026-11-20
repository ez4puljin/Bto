package mn.bto.callbridge

import mn.bto.callbridge.LinkMachine.Phase
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class PairingTest {
    private val token = "t".repeat(40)
    private val pc = PcAddress("192.168.1.20", 8766)

    @Test
    fun readsTheAddressTheOwnerTypes() {
        assertEquals(pc, PcAddress.parse(" 192.168.1.20 "))
        assertEquals(PcAddress("192.168.1.20", 9000), PcAddress.parse("192.168.1.20:9000"))
        assertEquals(pc, PcAddress.parse("ws://192.168.1.20:8766/phone"))
        assertEquals(PcAddress("office-pc", 8766), PcAddress.parse("office-pc"))
        assertNull(PcAddress.parse(""))
        assertNull(PcAddress.parse("192.168.1.20:x"))
        assertNull(PcAddress.parse("192.168.1.20:70000"))
        assertNull(PcAddress.parse("a b"))
        assertNull(PcAddress.parse(":8766"))
        assertEquals("ws://192.168.1.20:8766/phone", pc.url)
        assertEquals("192.168.1.20", pc.text)
        assertEquals("192.168.1.20:9000", PcAddress("192.168.1.20", 9000).text)
    }

    @Test
    fun theCodeIsSixDigits() {
        assertEquals("123456", Pairing.normalizeCode("123 456"))
        assertEquals("123456", Pairing.normalizeCode("123-456"))
        assertNull(Pairing.normalizeCode("12345"))
        assertNull(Pairing.normalizeCode("1234567"))
        assertNull(Pairing.normalizeCode("12345a"))
    }

    @Test
    fun backoffIs1_2_5_10_30ThenEvery30Seconds() {
        assertEquals(1000, Pairing.backoffMs(0))
        assertEquals(2000, Pairing.backoffMs(1))
        assertEquals(5000, Pairing.backoffMs(2))
        assertEquals(10000, Pairing.backoffMs(3))
        assertEquals(30000, Pairing.backoffMs(4))
        assertEquals(30000, Pairing.backoffMs(5))
        assertEquals(30000, Pairing.backoffMs(500))
        assertEquals(1000, Pairing.backoffMs(-1))
    }

    @Test
    fun aNewPhoneHasNothingToConnectTo() {
        val m = LinkMachine()
        assertEquals(Phase.UNPAIRED, m.phase)
        assertFalse(m.onConnecting())
        assertFalse(m.isUp(0))
    }

    @Test
    fun pairingSendsTheCodeAndKeepsTheToken() {
        val m = LinkMachine()
        m.startPairing(pc, "123456")
        assertTrue(m.onConnecting())
        val first = JSONObject(m.onOpen(100, "dev", "0.2.0")!!)
        assertEquals("pair", first.getString("type"))
        assertEquals("123456", first.getString("code"))
        assertEquals(Phase.PAIRING, m.phase)
        assertFalse(m.isUp(100))
        assertTrue(m.onPaired(200, token))
        assertEquals(token, m.token)
        assertNull(m.code)
        assertEquals(Phase.UP, m.phase)
        assertTrue(m.isUp(200))
    }

    @Test
    fun aPairedPhoneSaysHelloWithItsToken() {
        val m = LinkMachine(pc, token)
        assertEquals(Phase.RETRY, m.phase)
        assertTrue(m.onConnecting())
        val first = JSONObject(m.onOpen(0, "dev", "0.2.0")!!)
        assertEquals("hello", first.getString("type"))
        assertEquals(token, first.getString("token"))
        assertEquals(Phase.HELLO, m.phase)
        assertTrue(m.onWelcome(10))
        assertTrue(m.isUp(10))
    }

    @Test
    fun aRefusedTokenNeedsANewCodeAndStopsRetrying() {
        val m = LinkMachine(pc, token)
        m.onConnecting()
        m.onOpen(0, "dev", "0.2.0")
        assertTrue(m.onError("BAD_TOKEN"))
        assertNull(m.token)
        assertEquals(Phase.NEED_PAIR, m.phase)
        assertEquals("BAD_TOKEN", m.lastError)
        assertFalse(m.onClosed())
        assertEquals(Phase.NEED_PAIR, m.phase)
        assertFalse(m.onConnecting())
        // A new code starts again.
        m.startPairing(pc, "654321")
        assertTrue(m.onConnecting())
        assertEquals("pair", JSONObject(m.onOpen(5, "dev", "0.2.0")!!).getString("type"))
    }

    @Test
    fun aWrongCodeWithoutATokenAsksForANewCode() {
        val m = LinkMachine()
        m.startPairing(pc, "111111")
        m.onConnecting()
        m.onOpen(0, "dev", "0.2.0")
        assertTrue(m.onError(Protocol.ERROR_BAD_CODE))
        assertNull(m.code)
        assertEquals(Phase.NEED_CODE, m.phase)
        assertFalse(m.onClosed())
        assertEquals(Phase.NEED_CODE, m.phase)
        assertFalse(m.onConnecting())
        assertEquals(Phase.NEED_CODE, m.phase)
    }

    /** The drop of 2026-11-20: paired, the socket dropped, the reconnect must say hello. */
    @Test
    fun aDropAfterPairingReconnectsWithHelloNotTheUsedCode() {
        val m = LinkMachine()
        m.startPairing(pc, "123456")
        assertTrue(m.onConnecting())
        assertEquals("pair", JSONObject(m.onOpen(0, "dev", "0.2.1")!!).getString("type"))
        assertTrue(m.onPaired(100, token))
        m.onPing(5_000)
        assertTrue(m.onClosed())
        assertEquals(Phase.RETRY, m.phase)
        assertEquals(1000, m.retryDelayMs())
        // Every later connection: hello with the token, never the code again.
        repeat(3) {
            assertTrue(m.onConnecting())
            val again = JSONObject(m.onOpen(30_000, "dev", "0.2.1")!!)
            assertEquals("hello", again.getString("type"))
            assertEquals(token, again.getString("token"))
            assertTrue(m.onClosed())
        }
        assertTrue(m.onConnecting())
        m.onOpen(40_000, "dev", "0.2.1")
        assertTrue(m.onWelcome(40_010))
        assertTrue(m.isUp(40_010))
    }

    @Test
    fun theCodeGoesOutOnceEvenWhenThePairIsNotAnswered() {
        val m = LinkMachine(pc, token)
        m.startPairing(pc, "123456")
        m.onConnecting()
        assertEquals("pair", JSONObject(m.onOpen(0, "dev", "0.2.1")!!).getString("type"))
        assertNull(m.code)
        // No answer, the socket closes: the older token says hello next.
        assertTrue(m.onClosed())
        m.onConnecting()
        assertEquals("hello", JSONObject(m.onOpen(1_000, "dev", "0.2.1")!!).getString("type"))

        // Without a token an unanswered code needs a new one.
        val n = LinkMachine()
        n.startPairing(pc, "123456")
        n.onConnecting()
        n.onOpen(0, "dev", "0.2.1")
        assertTrue(n.isStale(12_001))
        assertFalse(n.onClosed())
        assertEquals(Phase.NEED_CODE, n.phase)
    }

    @Test
    fun noPairingOrBadCodeWithATokenFallsBackToHello() {
        for (refusal in listOf(Protocol.ERROR_NO_PAIRING, Protocol.ERROR_BAD_CODE)) {
            val m = LinkMachine(pc, token)
            m.startPairing(pc, "123456")
            m.onConnecting()
            m.onOpen(0, "dev", "0.2.1")
            assertTrue(m.onError(refusal))
            assertEquals(refusal, m.lastError)
            assertEquals(token, m.token)
            assertTrue(m.onClosed())
            assertEquals(Phase.RETRY, m.phase)
            assertTrue(m.onConnecting())
            val next = JSONObject(m.onOpen(1_000, "dev", "0.2.1")!!)
            assertEquals("hello", next.getString("type"))
            assertEquals(token, next.getString("token"))
            assertTrue(m.onWelcome(1_010))
            assertEquals(Phase.UP, m.phase)
            assertNull(m.lastError)
        }
    }

    @Test
    fun anyOtherCloseRetriesForever() {
        val m = LinkMachine(pc, token)
        val waits = (1..8).map {
            assertTrue(m.onConnecting())
            assertTrue(m.onClosed())
            m.retryDelayMs()
        }
        assertEquals(listOf(1000L, 2000L, 5000L, 10000L, 30000L, 30000L, 30000L, 30000L), waits)
        // An error other than BAD_TOKEN after hello reconnects too.
        m.onConnecting()
        m.onOpen(0, "dev", "0.2.1")
        assertTrue(m.onError("BAD_MESSAGE"))
        assertEquals(token, m.token)
        assertTrue(m.onClosed())
        assertEquals(Phase.RETRY, m.phase)
        // The Wi-Fi came back: at once.
        m.resetBackoff()
        m.onConnecting()
        assertTrue(m.onClosed())
        assertEquals(1000, m.retryDelayMs())
    }

    @Test
    fun aDropRetriesWithBackoffAndAWelcomeResetsIt() {
        val m = LinkMachine(pc, token)
        m.onConnecting()
        assertTrue(m.onClosed())
        assertEquals(Phase.RETRY, m.phase)
        assertEquals(1000, m.retryDelayMs())
        m.onConnecting()
        assertTrue(m.onClosed())
        assertEquals(2000, m.retryDelayMs())
        m.onConnecting()
        m.onOpen(0, "dev", "0.2.0")
        m.onWelcome(0)
        assertEquals(0, m.attempts)
        // A pairing code is kept across a failed connect: the PC still shows it.
        val p = LinkMachine()
        p.startPairing(pc, "123456")
        p.onConnecting()
        assertTrue(p.onClosed())
        assertEquals("123456", p.code)
    }

    @Test
    fun theLinkIsDownAfter12SecondsWithoutAPing() {
        val m = LinkMachine(pc, token)
        m.onConnecting()
        m.onOpen(0, "dev", "0.2.0")
        m.onWelcome(1000)
        m.onPing(5000)
        assertTrue(m.isUp(17_000))
        assertFalse(m.isStale(17_000))
        assertFalse(m.isUp(17_001))
        assertTrue(m.isStale(17_001))
    }

    @Test
    fun aSilentPcAfterHelloIsStaleToo() {
        val m = LinkMachine(pc, token)
        m.onConnecting()
        m.onOpen(0, "dev", "0.2.0")
        assertFalse(m.isStale(12_000))
        assertTrue(m.isStale(12_001))
    }

    @Test
    fun aWelcomeOrPairedOutOfTurnIsIgnored() {
        val m = LinkMachine(pc, token)
        assertFalse(m.onWelcome(0))
        assertFalse(m.onPaired(0, token))
        m.onConnecting()
        m.onOpen(0, "dev", "0.2.0")
        assertFalse(m.onPaired(0, "x".repeat(40)))
        assertEquals(token, m.token)
    }
}
