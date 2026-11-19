package mn.bto.callbridge

// Pure rules of the probe, kept free of Android objects so the unit tests run on the JVM.
// The numbers mirror the platform's constants (android.telecom.CallEndpoint, CallAudioState,
// DisconnectCause); the tests pin them.

/** The probe's settings, as the owner sets them on the main screen. */
data class ProbeSettings(
    val autoAnswer: Boolean = false,
    val answerDelaySec: Int = DEFAULT_DELAY_SEC,
    val hangupAfterSec: Int = DEFAULT_HANGUP_SEC,
) {
    companion object {
        const val DEFAULT_DELAY_SEC = 3
        const val DEFAULT_HANGUP_SEC = 10
        const val MAX_DELAY_SEC = 60
        const val MAX_HANGUP_SEC = 600

        /** A typed delay: blank or unreadable keeps the default, the rest is held to 0…60. */
        fun delayOf(text: String): Int =
            text.trim().toIntOrNull()?.coerceIn(0, MAX_DELAY_SEC) ?: DEFAULT_DELAY_SEC

        /** A typed hang-up time: at least one second, at most ten minutes. */
        fun hangupOf(text: String): Int =
            text.trim().toIntOrNull()?.coerceIn(1, MAX_HANGUP_SEC) ?: DEFAULT_HANGUP_SEC
    }
}

object ProbeRules {
    const val KEEP_CALLS = 20

    // android.telecom.CallEndpoint.TYPE_* (API 34).
    const val ENDPOINT_EARPIECE = 1
    const val ENDPOINT_BLUETOOTH = 2
    const val ENDPOINT_WIRED_HEADSET = 3
    const val ENDPOINT_SPEAKER = 4
    const val ENDPOINT_STREAMING = 5

    // android.telecom.CallAudioState.ROUTE_* (below API 34).
    const val ROUTE_EARPIECE = 1
    const val ROUTE_BLUETOOTH = 2
    const val ROUTE_WIRED_HEADSET = 4
    const val ROUTE_SPEAKER = 8
    const val ROUTE_STREAMING = 16

    fun endpointTypeName(type: Int): String = when (type) {
        ENDPOINT_EARPIECE -> "EARPIECE"
        ENDPOINT_BLUETOOTH -> "BLUETOOTH"
        ENDPOINT_WIRED_HEADSET -> "WIRED_HEADSET"
        ENDPOINT_SPEAKER -> "SPEAKER"
        ENDPOINT_STREAMING -> "STREAMING"
        else -> "UNKNOWN($type)"
    }

    /** The endpoint a call answered by the AI goes to: a wired headset first, then Bluetooth. */
    fun pickAccessoryEndpoint(types: List<Int>): Int {
        val wired = types.indexOf(ENDPOINT_WIRED_HEADSET)
        return if (wired >= 0) wired else types.indexOf(ENDPOINT_BLUETOOTH)
    }

    fun isAccessoryEndpoint(type: Int): Boolean =
        type == ENDPOINT_WIRED_HEADSET || type == ENDPOINT_BLUETOOTH

    fun routeName(route: Int): String = when (route) {
        ROUTE_EARPIECE -> "EARPIECE"
        ROUTE_BLUETOOTH -> "BLUETOOTH"
        ROUTE_WIRED_HEADSET -> "WIRED_HEADSET"
        ROUTE_SPEAKER -> "SPEAKER"
        ROUTE_STREAMING -> "STREAMING"
        else -> "ROUTE($route)"
    }

    /** The routes a supported-route mask holds, by name. */
    fun routeNames(mask: Int): List<String> =
        listOf(ROUTE_EARPIECE, ROUTE_BLUETOOTH, ROUTE_WIRED_HEADSET, ROUTE_SPEAKER, ROUTE_STREAMING)
            .filter { mask and it != 0 }
            .map(::routeName)

    /** Below API 34: the route to ask for, a wired headset before Bluetooth, or null for none. */
    fun pickAccessoryRoute(mask: Int): Int? = when {
        mask and ROUTE_WIRED_HEADSET != 0 -> ROUTE_WIRED_HEADSET
        mask and ROUTE_BLUETOOTH != 0 -> ROUTE_BLUETOOTH
        else -> null
    }

    /** android.telecom.DisconnectCause codes, by name. */
    fun disconnectCodeName(code: Int): String = when (code) {
        0 -> "UNKNOWN"
        1 -> "ERROR"
        2 -> "LOCAL"
        3 -> "REMOTE"
        4 -> "CANCELED"
        5 -> "MISSED"
        6 -> "REJECTED"
        7 -> "BUSY"
        8 -> "RESTRICTED"
        9 -> "OTHER"
        10 -> "CONNECTION_MANAGER_NOT_SUPPORTED"
        11 -> "ANSWERED_ELSEWHERE"
        12 -> "CALL_PULLED"
        else -> "CODE($code)"
    }

    /** How a call ended: who hung up as the probe saw it, then the phone's own cause. */
    fun endedText(endedBy: String?, code: Int?, reason: String?): String {
        val cause = code?.let(::disconnectCodeName) ?: "?"
        val tail = if (reason.isNullOrBlank()) "" else " ($reason)"
        return if (endedBy == null) "$cause$tail" else "$endedBy: $cause$tail"
    }

    /** The newest record first, one record per id, at most [KEEP_CALLS]. */
    fun <T> upsertNewestFirst(list: List<T>, item: T, idOf: (T) -> String): List<T> {
        val id = idOf(item)
        val index = list.indexOfFirst { idOf(it) == id }
        val next = if (index >= 0) {
            list.toMutableList().also { it[index] = item }
        } else {
            listOf(item) + list
        }
        return next.take(KEEP_CALLS)
    }
}
