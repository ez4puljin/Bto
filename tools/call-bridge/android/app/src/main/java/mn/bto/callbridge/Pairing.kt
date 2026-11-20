package mn.bto.callbridge

/** The PC bridge's LAN address as the owner typed it. */
data class PcAddress(val host: String, val port: Int) {
    val url: String get() = "ws://${hostForUrl()}:$port${Protocol.PATH}"
    val text: String get() = if (port == Protocol.DEFAULT_PORT) host else "$host:$port"

    private fun hostForUrl() = if (':' in host) "[$host]" else host

    companion object {
        private val HOST = Regex("^[A-Za-z0-9.-]+$")

        /**
         * «192.168.1.20», «192.168.1.20:8766», «ws://192.168.1.20:8766/phone» or a LAN name;
         * null when it cannot be one.
         */
        fun parse(text: String): PcAddress? {
            var s = text.trim()
            if (s.isEmpty()) return null
            s = s.removePrefix("ws://").removePrefix("http://")
            s = s.substringBefore('/')
            val host: String
            val port: Int
            val colon = s.lastIndexOf(':')
            if (colon >= 0) {
                host = s.substring(0, colon)
                port = s.substring(colon + 1).toIntOrNull() ?: return null
            } else {
                host = s
                port = Protocol.DEFAULT_PORT
            }
            if (host.isEmpty() || !HOST.matches(host) || host.startsWith('.') || host.endsWith('.')) return null
            if (port !in 1..65535) return null
            return PcAddress(host, port)
        }
    }
}

object Pairing {
    /** The six digits the PC shows; spaces and dashes typed between them are dropped. */
    fun normalizeCode(text: String): String? {
        val digits = text.filterNot { it == ' ' || it == '-' }
        return if (digits.length == 6 && digits.all { it in '0'..'9' }) digits else null
    }

    /** Reconnect waits: 1, 2, 5, 10, 30 s, then every 30 s for as long as the service runs. */
    private val BACKOFF_MS = longArrayOf(1_000, 2_000, 5_000, 10_000, 30_000)

    fun backoffMs(attempt: Int): Long = BACKOFF_MS[attempt.coerceIn(0, BACKOFF_MS.size - 1)]
}

/**
 * The link's state, free of sockets and Android: the service feeds it what the socket did and
 * does what it answers. Every method runs on one thread (the main looper).
 *
 * A code typed on «Компьютер холбох» goes out in exactly one `pair` frame, on the first socket
 * that opens after the button (a connect that fails before opening keeps it, since the PC never
 * saw it). Every later connection says `hello` with the token, which the service writes to disk
 * the moment `paired` arrives. A refused or unanswered pair falls back to `hello` when an older
 * token is there; without one the owner is asked for a new code.
 */
class LinkMachine(
    address: PcAddress? = null,
    token: String? = null,
) {
    enum class Phase {
        /** No address, or neither a token nor a code: nothing to connect to. */
        UNPAIRED,
        /** The PC refused the token (BAD_TOKEN): a new code is needed («Дахин холбох»). */
        NEED_PAIR,
        /** The code was refused or went unanswered and there is no token: «Кодоо дахин авна уу». */
        NEED_CODE,
        CONNECTING,
        /** Socket open, `pair` sent, waiting for `paired`. */
        PAIRING,
        /** Socket open, `hello` sent, waiting for `welcome`. */
        HELLO,
        UP,
        /** Closed; a reconnect is scheduled. */
        RETRY,
    }

    var address: PcAddress? = address
        private set
    var token: String? = token
        private set
    /** A code typed for pairing and not sent yet: memory only, cleared as it goes out. */
    var code: String? = null
        private set
    var phase: Phase = if (canConnect()) Phase.RETRY else Phase.UNPAIRED
        private set
    /** The PC's last refusal code, for the screen. */
    var lastError: String? = null
        private set
    /** Failed connects since the last good one, for the backoff. */
    var attempts: Int = 0
        private set
    private var lastAliveAt: Long = 0

    fun canConnect(): Boolean = address != null && (code != null || token != null)

    /** The owner pressed «Компьютер холбох» with an address and a code. */
    fun startPairing(address: PcAddress, code: String) {
        this.address = address
        this.code = code
        lastError = null
        attempts = 0
        phase = Phase.CONNECTING
    }

    /** About to open a socket. False: there is nothing to connect to. */
    fun onConnecting(): Boolean {
        if (!canConnect()) {
            if (phase != Phase.NEED_PAIR && phase != Phase.NEED_CODE) phase = Phase.UNPAIRED
            return false
        }
        phase = Phase.CONNECTING
        return true
    }

    /**
     * The socket opened: the first frame to send, `pair` when a code waits (the code is used up
     * here, whatever the PC answers), else `hello`.
     */
    fun onOpen(now: Long, device: String, app: String): String? {
        lastAliveAt = now
        val c = code
        val t = token
        return when {
            c != null -> {
                code = null
                phase = Phase.PAIRING
                Protocol.pair(c, device, app)
            }
            t != null -> {
                phase = Phase.HELLO
                Protocol.hello(t, device, app)
            }
            else -> null
        }
    }

    /** `paired`: the token to keep (the caller saves it at once). The link is up. */
    fun onPaired(now: Long, newToken: String): Boolean {
        if (phase != Phase.PAIRING) return false
        token = newToken
        up(now)
        return true
    }

    fun onWelcome(now: Long): Boolean {
        if (phase != Phase.HELLO && phase != Phase.UP) return false
        up(now)
        return true
    }

    /**
     * `error` (the PC closes after it). On a pair attempt (BAD_CODE, NO_PAIRING): with a token
     * the next connection says `hello`, without one a new code is needed. After `hello`,
     * BAD_TOKEN drops the token and stops the reconnects; another error reconnects. True when
     * the link must close.
     */
    fun onError(errorCode: String): Boolean {
        lastError = errorCode.ifEmpty { "ERROR" }
        return when (phase) {
            Phase.PAIRING -> {
                if (token == null) phase = Phase.NEED_CODE
                true
            }
            Phase.HELLO -> {
                if (errorCode == Protocol.ERROR_BAD_TOKEN) token = null
                if (token == null) phase = Phase.NEED_PAIR
                true
            }
            else -> false
        }
    }

    fun onPing(now: Long) {
        if (phase == Phase.UP) lastAliveAt = now
    }

    /** The socket closed or failed. True when a reconnect should be scheduled. */
    fun onClosed(): Boolean {
        if (phase == Phase.NEED_PAIR || phase == Phase.NEED_CODE || phase == Phase.UNPAIRED) return false
        if (phase == Phase.PAIRING && token == null) {
            // The code went out and no token came back: it cannot be sent again.
            phase = Phase.NEED_CODE
            return false
        }
        if (!canConnect()) {
            phase = Phase.UNPAIRED
            return false
        }
        attempts++
        phase = Phase.RETRY
        return true
    }

    /** Nothing from the PC for 12 s (no ping since the last one, or no answer to pair/hello). */
    fun isStale(now: Long): Boolean =
        (phase == Phase.PAIRING || phase == Phase.HELLO || phase == Phase.UP) &&
            now - lastAliveAt > Protocol.LINK_DEAD_AFTER_MS

    fun isUp(now: Long): Boolean = phase == Phase.UP && now - lastAliveAt <= Protocol.LINK_DEAD_AFTER_MS

    fun retryDelayMs(): Long = Pairing.backoffMs(attempts - 1)

    /** A network came back: retry at once. */
    fun resetBackoff() {
        attempts = 0
    }

    private fun up(now: Long) {
        phase = Phase.UP
        attempts = 0
        lastError = null
        lastAliveAt = now
    }
}
