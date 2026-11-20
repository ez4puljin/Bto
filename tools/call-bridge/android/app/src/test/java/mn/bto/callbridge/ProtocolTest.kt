package mn.bto.callbridge

import mn.bto.callbridge.Protocol.Inbound
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ProtocolTest {
    private val token = "a".repeat(32)

    @Test
    fun parsesEveryFrameThePcSends() {
        assertEquals(Inbound.Paired(token), Protocol.parse("""{"type":"paired","token":"$token"}"""))
        assertEquals(Inbound.Welcome, Protocol.parse("""{"type":"welcome"}"""))
        assertEquals(Inbound.Error("BAD_TOKEN"), Protocol.parse("""{"type":"error","code":"BAD_TOKEN"}"""))
        assertEquals(
            Inbound.Answer("r1", "BLUETOOTH"),
            Protocol.parse("""{"type":"answer","callRef":"r1","route":"BLUETOOTH"}"""),
        )
        assertEquals(
            Inbound.Answer("r1", "WIRED_HEADSET"),
            Protocol.parse("""{"type":"answer","callRef":"r1","route":"WIRED_HEADSET"}"""),
        )
        assertEquals(Inbound.Ignore("r2"), Protocol.parse("""{"type":"ignore","callRef":"r2"}"""))
        assertEquals(Inbound.Hangup("r3"), Protocol.parse("""{"type":"hangup","callRef":"r3"}"""))
        assertEquals(Inbound.Ping(7), Protocol.parse("""{"type":"ping","id":7}"""))
    }

    @Test
    fun refusesBrokenFramesAndSkipsUnknownOnes() {
        assertTrue(Protocol.parse("not json") is Inbound.Bad)
        assertTrue(Protocol.parse("[1,2]") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"callRef":"r1"}""") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"type":"answer","route":"BLUETOOTH"}""") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"type":"answer","callRef":"r1"}""") is Inbound.Bad)
        // The AI never answers into the earpiece or the speaker.
        assertTrue(Protocol.parse("""{"type":"answer","callRef":"r1","route":"EARPIECE"}""") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"type":"answer","callRef":"r1","route":"SPEAKER"}""") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"type":"ignore","callRef":""}""") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"type":"hangup"}""") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"type":"ping","id":"x"}""") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"type":"paired","token":"short"}""") is Inbound.Bad)
        assertTrue(Protocol.parse("""{"type":"paired"}""") is Inbound.Bad)
        assertEquals(Inbound.Unknown("audio"), Protocol.parse("""{"type":"audio","x":1}"""))
        assertEquals(Inbound.Error(""), Protocol.parse("""{"type":"error"}"""))
    }

    @Test
    fun buildsThePhonesFrames() {
        val pair = JSONObject(Protocol.pair("123456", "samsung SM-S711N", "0.2.0"))
        assertEquals("pair", pair.getString("type"))
        assertEquals("123456", pair.getString("code"))
        assertEquals("samsung SM-S711N", pair.getString("device"))
        assertEquals("0.2.0", pair.getString("app"))

        val hello = JSONObject(Protocol.hello(token, "d", "0.2.0"))
        assertEquals("hello", hello.getString("type"))
        assertEquals(token, hello.getString("token"))

        val ringing = JSONObject(Protocol.ringing("r1", "", 1_700_000_000_000))
        assertEquals("ringing", ringing.getString("type"))
        assertEquals("r1", ringing.getString("callRef"))
        assertEquals("", ringing.getString("number"))
        assertEquals(1_700_000_000_000, ringing.getLong("at"))

        val state = JSONObject(Protocol.state("r1", Protocol.STATE_ENDED, "REMOTE", 5))
        assertEquals("state", state.getString("type"))
        assertEquals("ended", state.getString("state"))
        assertEquals("REMOTE", state.getString("cause"))
        assertEquals(5, state.getLong("at"))

        val route = JSONObject(Protocol.route("r1", "BLUETOOTH", listOf("EARPIECE", "BLUETOOTH")))
        assertEquals("route", route.getString("type"))
        assertEquals("BLUETOOTH", route.getString("endpoint"))
        assertEquals(2, route.getJSONArray("available").length())
        assertEquals("EARPIECE", route.getJSONArray("available").getString(0))

        val pong = JSONObject(Protocol.pong(42))
        assertEquals("pong", pong.getString("type"))
        assertEquals(42, pong.getLong("id"))
    }

    @Test
    fun aNumberWithQuotesStaysOneString() {
        val ringing = JSONObject(Protocol.ringing("r1", "+976\"99", 1))
        assertEquals("+976\"99", ringing.getString("number"))
    }
}
