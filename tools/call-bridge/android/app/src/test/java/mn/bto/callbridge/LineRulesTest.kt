package mn.bto.callbridge

import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.DisconnectCause
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class LineRulesTest {
    @Test
    fun fallbackSecondsAreHeldTo1500To5000Ms() {
        assertEquals(3000, LineSettings.fallbackOf(""))
        assertEquals(3000, LineSettings.fallbackOf("abc"))
        assertEquals(2500, LineSettings.fallbackOf("2.5"))
        assertEquals(2500, LineSettings.fallbackOf(" 2,5 "))
        assertEquals(1500, LineSettings.fallbackOf("0"))
        assertEquals(1500, LineSettings.fallbackOf("-3"))
        assertEquals(5000, LineSettings.fallbackOf("60"))
        assertEquals(4000, LineSettings.fallbackOf("4"))
        assertEquals("3", LineSettings.secondsText(3000))
        assertEquals("2.5", LineSettings.secondsText(2500))
        assertFalse(LineSettings().aiAnswer)
    }

    @Test
    fun constantsMatchThePlatform() {
        assertEquals(CallEndpoint.TYPE_EARPIECE, LineRules.ENDPOINT_EARPIECE)
        assertEquals(CallEndpoint.TYPE_BLUETOOTH, LineRules.ENDPOINT_BLUETOOTH)
        assertEquals(CallEndpoint.TYPE_WIRED_HEADSET, LineRules.ENDPOINT_WIRED_HEADSET)
        assertEquals(CallEndpoint.TYPE_SPEAKER, LineRules.ENDPOINT_SPEAKER)
        assertEquals(CallEndpoint.TYPE_STREAMING, LineRules.ENDPOINT_STREAMING)
        assertEquals(CallAudioState.ROUTE_EARPIECE, LineRules.ROUTE_EARPIECE)
        assertEquals(CallAudioState.ROUTE_BLUETOOTH, LineRules.ROUTE_BLUETOOTH)
        assertEquals(CallAudioState.ROUTE_WIRED_HEADSET, LineRules.ROUTE_WIRED_HEADSET)
        assertEquals(CallAudioState.ROUTE_SPEAKER, LineRules.ROUTE_SPEAKER)
        assertEquals(CallAudioState.ROUTE_STREAMING, LineRules.ROUTE_STREAMING)
        assertEquals("REMOTE", LineRules.disconnectCodeName(DisconnectCause.REMOTE))
        assertEquals("LOCAL", LineRules.disconnectCodeName(DisconnectCause.LOCAL))
        assertEquals("MISSED", LineRules.disconnectCodeName(DisconnectCause.MISSED))
        assertEquals("ANSWERED_ELSEWHERE", LineRules.disconnectCodeName(DisconnectCause.ANSWERED_ELSEWHERE))
    }

    @Test
    fun theAiAnswersOnlyOnTheAskedEndpoint() {
        assertTrue(LineRules.canAnswerOn("BLUETOOTH", listOf("EARPIECE", "SPEAKER", "BLUETOOTH")))
        assertFalse(LineRules.canAnswerOn("BLUETOOTH", listOf("EARPIECE", "SPEAKER")))
        assertFalse(LineRules.canAnswerOn("BLUETOOTH", emptyList()))
        assertTrue(LineRules.canAnswerOn("WIRED_HEADSET", listOf("WIRED_HEADSET", "SPEAKER")))
        assertFalse(LineRules.canAnswerOn("WIRED_HEADSET", listOf("BLUETOOTH")))
        assertFalse(LineRules.canAnswerOn("EARPIECE", listOf("EARPIECE")))
        assertEquals(LineRules.ENDPOINT_BLUETOOTH, LineRules.endpointTypeOf("BLUETOOTH"))
        assertEquals(LineRules.ROUTE_WIRED_HEADSET, LineRules.audioRouteOf("WIRED_HEADSET"))
        assertNull(LineRules.endpointTypeOf("SPEAKER"))
    }

    @Test
    fun itAsksAgainOnceWhenMovedBackToTheEarpiece() {
        val e = LineRules
        assertTrue(e.shouldReRequest(reachedWanted = true, alreadyReRequested = false, newType = e.ENDPOINT_EARPIECE))
        assertFalse(e.shouldReRequest(reachedWanted = true, alreadyReRequested = true, newType = e.ENDPOINT_EARPIECE))
        assertFalse(e.shouldReRequest(reachedWanted = false, alreadyReRequested = false, newType = e.ENDPOINT_EARPIECE))
        assertFalse(e.shouldReRequest(reachedWanted = true, alreadyReRequested = false, newType = e.ENDPOINT_SPEAKER))
    }

    @Test
    fun speakerButtonPrefersAWiredHeadsetThenBluetooth() {
        val e = LineRules
        assertEquals(2, e.pickAccessoryEndpoint(listOf(e.ENDPOINT_EARPIECE, e.ENDPOINT_BLUETOOTH, e.ENDPOINT_WIRED_HEADSET)))
        assertEquals(1, e.pickAccessoryEndpoint(listOf(e.ENDPOINT_SPEAKER, e.ENDPOINT_BLUETOOTH)))
        assertEquals(-1, e.pickAccessoryEndpoint(listOf(e.ENDPOINT_EARPIECE, e.ENDPOINT_SPEAKER)))
        assertEquals(listOf("EARPIECE", "SPEAKER"), e.routeNames(e.ROUTE_EARPIECE or e.ROUTE_SPEAKER))
        assertTrue(e.isReportedEndpoint("SPEAKER"))
        assertFalse(e.isReportedEndpoint("STREAMING"))
    }

    @Test
    fun endedTextNamesWhoAndWhy() {
        assertEquals("probe: LOCAL", LineRules.endedText("probe", 2, null))
        assertEquals("REMOTE (busy)", LineRules.endedText(null, 3, "busy"))
        assertEquals("?", LineRules.endedText(null, null, ""))
    }

    @Test
    fun theListKeepsTheNewest20AndUpdatesInPlace() {
        var list = emptyList<Pair<String, Int>>()
        for (i in 1..25) list = LineRules.upsertNewestFirst(list, "c$i" to 0) { it.first }
        assertEquals(20, list.size)
        assertEquals("c25", list.first().first)
        assertEquals("c6", list.last().first)
        list = LineRules.upsertNewestFirst(list, "c10" to 1) { it.first }
        assertEquals(20, list.size)
        assertEquals(1, list.first { it.first == "c10" }.second)
        assertEquals("c25", list.first().first)
    }
}
