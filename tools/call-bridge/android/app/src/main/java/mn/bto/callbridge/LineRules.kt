package mn.bto.callbridge

// Pure rules of the line's phone, kept free of Android objects so the unit tests run on the JVM.
// The numbers mirror the platform's constants (android.telecom.CallEndpoint, CallAudioState,
// DisconnectCause); the tests pin them.

/** The owner's settings on the main screen. */
data class LineSettings(
    /** «AI хариулах»: off, every call rings for staff and nothing is sent to the PC. */
    val aiAnswer: Boolean = false,
    /** How long the phone waits for the PC's answer or ignore before it rings normally. */
    val fallbackMs: Int = DEFAULT_FALLBACK_MS,
) {
    companion object {
        const val DEFAULT_FALLBACK_MS = 3000
        const val MIN_FALLBACK_MS = 1500
        const val MAX_FALLBACK_MS = 5000

        /**
         * Typed seconds («3», «2.5», «2,5»): blank or unreadable keeps the default, the rest is
         * held to 1.5…5 s.
         */
        fun fallbackOf(text: String): Int {
            val secs = text.trim().replace(',', '.').toDoubleOrNull()
            if (secs == null || secs.isNaN()) return DEFAULT_FALLBACK_MS
            return (secs * 1000).toLong()
                .coerceIn(MIN_FALLBACK_MS.toLong(), MAX_FALLBACK_MS.toLong()).toInt()
        }

        /** Milliseconds as the field shows them: «3», «2.5». */
        fun secondsText(ms: Int): String =
            if (ms % 1000 == 0) (ms / 1000).toString() else (ms / 1000.0).toString()
    }
}

object LineRules {
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

    /** The endpoint type of a protocol route name (BLUETOOTH, WIRED_HEADSET), or null. */
    fun endpointTypeOf(route: String): Int? = when (route) {
        Protocol.ROUTE_BLUETOOTH -> ENDPOINT_BLUETOOTH
        Protocol.ROUTE_WIRED_HEADSET -> ENDPOINT_WIRED_HEADSET
        else -> null
    }

    /** Below API 34: the CallAudioState route of a protocol route name, or null. */
    fun audioRouteOf(route: String): Int? = when (route) {
        Protocol.ROUTE_BLUETOOTH -> ROUTE_BLUETOOTH
        Protocol.ROUTE_WIRED_HEADSET -> ROUTE_WIRED_HEADSET
        else -> null
    }

    /**
     * The AI answers only when the endpoint the PC asked for is there now (owner 2026-11-20: the
     * AI never talks into the earpiece). [availableTypes] are endpoint type names; an empty list
     * (the phone has not said yet) is not enough.
     */
    fun canAnswerOn(route: String, availableTypes: Collection<String>): Boolean =
        route in Protocol.ANSWER_ROUTES && route in availableTypes

    /** The endpoint names the protocol carries; anything else (STREAMING) is not reported. */
    fun isReportedEndpoint(name: String): Boolean = name in Protocol.ENDPOINTS

    /** For the speaker button: a wired headset first, then Bluetooth, or -1. */
    fun pickAccessoryEndpoint(types: List<Int>): Int {
        val wired = types.indexOf(ENDPOINT_WIRED_HEADSET)
        return if (wired >= 0) wired else types.indexOf(ENDPOINT_BLUETOOTH)
    }

    /**
     * After the AI's call reached the endpoint the PC asked for, the system moved it to [newType].
     * The phone asks again once, and only when it fell back to the earpiece.
     */
    fun shouldReRequest(reachedWanted: Boolean, alreadyReRequested: Boolean, newType: Int): Boolean =
        reachedWanted && !alreadyReRequested && newType == ENDPOINT_EARPIECE

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

    /** How a call ended: who hung up as the phone saw it, then the phone's own cause. */
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
