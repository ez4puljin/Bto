package mn.bto.callbridge

import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.DisconnectCause
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class ProbeRulesTest {
    @Test
    fun settingsHoldTypedNumbersInRange() {
        assertEquals(3, ProbeSettings.delayOf(""))
        assertEquals(3, ProbeSettings.delayOf("abc"))
        assertEquals(0, ProbeSettings.delayOf("-5"))
        assertEquals(60, ProbeSettings.delayOf("999"))
        assertEquals(7, ProbeSettings.delayOf(" 7 "))
        assertEquals(10, ProbeSettings.hangupOf(""))
        assertEquals(1, ProbeSettings.hangupOf("0"))
        assertEquals(600, ProbeSettings.hangupOf("100000"))
    }

    @Test
    fun constantsMatchThePlatform() {
        assertEquals(CallEndpoint.TYPE_EARPIECE, ProbeRules.ENDPOINT_EARPIECE)
        assertEquals(CallEndpoint.TYPE_BLUETOOTH, ProbeRules.ENDPOINT_BLUETOOTH)
        assertEquals(CallEndpoint.TYPE_WIRED_HEADSET, ProbeRules.ENDPOINT_WIRED_HEADSET)
        assertEquals(CallEndpoint.TYPE_SPEAKER, ProbeRules.ENDPOINT_SPEAKER)
        assertEquals(CallEndpoint.TYPE_STREAMING, ProbeRules.ENDPOINT_STREAMING)
        assertEquals(CallAudioState.ROUTE_EARPIECE, ProbeRules.ROUTE_EARPIECE)
        assertEquals(CallAudioState.ROUTE_BLUETOOTH, ProbeRules.ROUTE_BLUETOOTH)
        assertEquals(CallAudioState.ROUTE_WIRED_HEADSET, ProbeRules.ROUTE_WIRED_HEADSET)
        assertEquals(CallAudioState.ROUTE_SPEAKER, ProbeRules.ROUTE_SPEAKER)
        assertEquals(CallAudioState.ROUTE_STREAMING, ProbeRules.ROUTE_STREAMING)
        assertEquals("REMOTE", ProbeRules.disconnectCodeName(DisconnectCause.REMOTE))
        assertEquals("LOCAL", ProbeRules.disconnectCodeName(DisconnectCause.LOCAL))
        assertEquals("MISSED", ProbeRules.disconnectCodeName(DisconnectCause.MISSED))
        assertEquals("ANSWERED_ELSEWHERE", ProbeRules.disconnectCodeName(DisconnectCause.ANSWERED_ELSEWHERE))
    }

    @Test
    fun aWiredHeadsetWinsOverBluetoothAndNothingElseIsPicked() {
        val e = ProbeRules
        assertEquals(2, e.pickAccessoryEndpoint(listOf(e.ENDPOINT_EARPIECE, e.ENDPOINT_BLUETOOTH, e.ENDPOINT_WIRED_HEADSET)))
        assertEquals(1, e.pickAccessoryEndpoint(listOf(e.ENDPOINT_SPEAKER, e.ENDPOINT_BLUETOOTH)))
        assertEquals(-1, e.pickAccessoryEndpoint(listOf(e.ENDPOINT_EARPIECE, e.ENDPOINT_SPEAKER)))
        assertEquals(e.ROUTE_WIRED_HEADSET, e.pickAccessoryRoute(e.ROUTE_BLUETOOTH or e.ROUTE_WIRED_HEADSET))
        assertEquals(e.ROUTE_BLUETOOTH, e.pickAccessoryRoute(e.ROUTE_EARPIECE or e.ROUTE_BLUETOOTH or e.ROUTE_SPEAKER))
        assertNull(e.pickAccessoryRoute(e.ROUTE_EARPIECE or e.ROUTE_SPEAKER))
        assertEquals(listOf("EARPIECE", "SPEAKER"), e.routeNames(e.ROUTE_EARPIECE or e.ROUTE_SPEAKER))
    }

    @Test
    fun endedTextNamesWhoAndWhy() {
        assertEquals("probe: LOCAL", ProbeRules.endedText("probe", 2, null))
        assertEquals("REMOTE (busy)", ProbeRules.endedText(null, 3, "busy"))
        assertEquals("?", ProbeRules.endedText(null, null, ""))
    }

    @Test
    fun theListKeepsTheNewest20AndUpdatesInPlace() {
        var list = emptyList<Pair<String, Int>>()
        for (i in 1..25) list = ProbeRules.upsertNewestFirst(list, "c$i" to 0) { it.first }
        assertEquals(20, list.size)
        assertEquals("c25", list.first().first)
        assertEquals("c6", list.last().first)
        list = ProbeRules.upsertNewestFirst(list, "c10" to 1) { it.first }
        assertEquals(20, list.size)
        assertEquals(1, list.first { it.first == "c10" }.second)
        assertEquals("c25", list.first().first)
    }
}
