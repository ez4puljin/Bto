package mn.bto.callbridge

import android.content.Context
import android.net.Network
import android.os.Build
import android.os.SystemClock
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.concurrent.TimeUnit

/**
 * The WebSocket to the PC bridge, kept by [LinkService]. One per process; every state change runs
 * on the main looper ([CallTracker.handler]), OkHttp's callbacks are posted there, so the link,
 * the calls and the screens share one thread. Rules of the link live in [LinkMachine].
 */
object BridgeLink {
    /** What the PC asks of a call: given to the in-call service while one is bound. */
    interface CallControl {
        fun onAnswer(callRef: String, route: String)
        fun onIgnore(callRef: String)
        fun onHangup(callRef: String)
        fun onLinkDown()
    }

    var callControl: CallControl? = null

    private val handler = CallTracker.handler
    private lateinit var app: Context
    private var machine = LinkMachine()
    private var started = false

    private val client: OkHttpClient by lazy {
        OkHttpClient.Builder()
            .connectTimeout(5, TimeUnit.SECONDS)
            .readTimeout(0, TimeUnit.MILLISECONDS) // The PC's own pings keep it alive.
            .writeTimeout(5, TimeUnit.SECONDS)
            .retryOnConnectionFailure(false)
            .build()
    }
    private var socket: WebSocket? = null
    /** Raised on every new socket, so callbacks of an old one are dropped. */
    private var generation = 0

    private val listeners = mutableSetOf<() -> Unit>()
    fun addListener(l: () -> Unit) { listeners.add(l) }
    fun removeListener(l: () -> Unit) { listeners.remove(l) }
    private fun changed() { listeners.toList().forEach { it() } }

    private val retryTask = Runnable { connect() }
    private val watchdog = object : Runnable {
        override fun run() {
            if (machine.isStale(now())) {
                val secs = Protocol.LINK_DEAD_AFTER_MS / 1000
                drop(if (machine.phase == LinkMachine.Phase.UP) "no ping for $secs s" else "no answer for $secs s")
            } else if (socket != null) {
                handler.postDelayed(this, 1000)
            }
        }
    }

    val phase: LinkMachine.Phase get() = machine.phase
    val address: PcAddress? get() = machine.address
    val lastError: String? get() = machine.lastError
    /** The last reason the link went down, for the log and the screen. */
    var lastDrop: String? = null
        private set

    fun isUp(): Boolean = machine.isUp(now())

    /** Called by the service (and the screen): load the saved PC and connect if not already. */
    fun start(context: Context) {
        app = context.applicationContext
        if (!started) {
            started = true
            machine = LinkMachine(LineStore.address(app), LineStore.token(app))
            log("service start (${machine.phase})")
        }
        if (socket == null && !handler.hasCallbacks(retryTask)) connect()
    }

    fun stop() {
        handler.removeCallbacks(retryTask)
        if (started) log("service stopped")
        closeSocket()
        started = false
        changed()
    }

    /** «Компьютер холбох»: pair with the code the PC shows, on the next socket only. */
    fun pair(context: Context, address: PcAddress, code: String) {
        app = context.applicationContext
        started = true
        machine.startPairing(address, code)
        LineStore.saveLink(app, address, machine.token)
        log("pair with a new code (${address.text})")
        handler.removeCallbacks(retryTask)
        closeSocket()
        connect()
    }

    /**
     * The Wi-Fi network the socket is bound to: when the office Wi-Fi has no internet, Android
     * may keep mobile data as the default network, and the PC is reached only over the Wi-Fi.
     */
    private var wifi: Network? = null
    /** The network the current socket was opened on (null: the default one). */
    private var socketNet: Network? = null

    /** A Wi-Fi network went away: a socket opened on it is dead, reconnect (over another). */
    fun networkLost(network: Network) {
        if (wifi == network) wifi = null
        if (started && socket != null && socketNet == network) drop("Wi-Fi lost")
    }

    /**
     * A Wi-Fi network came up: a waiting reconnect happens now, over it, and a connect still
     * hanging on another network starts again over this one.
     */
    fun networkAvailable(network: Network) {
        val isNew = wifi != network
        wifi = network
        if (!started) return
        if (socket == null && machine.phase == LinkMachine.Phase.RETRY) {
            log("Wi-Fi back: reconnect now")
            machine.resetBackoff()
            handler.removeCallbacks(retryTask)
            handler.post(retryTask)
        } else if (socket != null && isNew && socketNet != network &&
            machine.phase == LinkMachine.Phase.CONNECTING
        ) {
            log("Wi-Fi back: connect again over it")
            closeSocket()
            connect()
        }
    }

    /** Sends a frame when the link is up. False: not sent. */
    fun send(text: String): Boolean {
        val ws = socket ?: return false
        if (!isUp()) return false
        return ws.send(text)
    }

    private fun connect() {
        handler.removeCallbacks(retryTask)
        // Never two sockets: an old one left open would pair or say hello on its own.
        if (socket != null) closeSocket()
        if (!machine.onConnecting()) {
            changed()
            return
        }
        val address = machine.address ?: return
        val gen = ++generation
        val request = try {
            Request.Builder().url(address.url).build()
        } catch (e: IllegalArgumentException) {
            lastDrop = "bad address"
            log("bad address ${address.text}")
            if (machine.onClosed()) scheduleRetry()
            changed()
            return
        }
        val net = wifi
        val c = if (net != null) client.newBuilder().socketFactory(net.socketFactory).build() else client
        socketNet = net
        socket = c.newWebSocket(request, Listener(gen))
        handler.removeCallbacks(watchdog)
        handler.postDelayed(watchdog, 1000)
        changed()
    }

    private fun closeSocket() {
        generation++
        socket?.cancel()
        socket = null
        socketNet = null
        handler.removeCallbacks(watchdog)
    }

    /** The link is gone: tell the calls, schedule a reconnect if there is anything to retry. */
    private fun drop(why: String) {
        val wasUp = machine.phase == LinkMachine.Phase.UP
        lastDrop = why
        closeSocket()
        if (machine.onClosed()) {
            scheduleRetry()
            log("down: $why; retry in ${machine.retryDelayMs() / 1000} s")
        } else {
            log("down: $why; no retry (${machine.phase})")
        }
        if (wasUp) callControl?.onLinkDown()
        changed()
    }

    private fun scheduleRetry() {
        handler.removeCallbacks(retryTask)
        handler.postDelayed(retryTask, machine.retryDelayMs())
    }

    private fun openOn(ws: WebSocket) {
        val first = machine.onOpen(now(), device(), BuildConfig.VERSION_NAME)
        when {
            first == null -> drop("nothing to send")
            !ws.send(first) -> drop("could not send ${machine.phase.firstFrame()}")
            else -> log("open: ${machine.phase.firstFrame()} sent")
        }
        changed()
    }

    private fun LinkMachine.Phase.firstFrame() = if (this == LinkMachine.Phase.PAIRING) "pair" else "hello"

    private fun onText(ws: WebSocket, text: String) {
        when (val m = Protocol.parse(text)) {
            is Protocol.Inbound.Paired -> if (machine.onPaired(now(), m.token)) {
                val saved = LineStore.saveLink(app, machine.address, machine.token)
                log(if (saved) "paired: token saved" else "paired: TOKEN NOT SAVED")
            }
            Protocol.Inbound.Welcome -> {
                val wasHello = machine.phase == LinkMachine.Phase.HELLO
                if (machine.onWelcome(now()) && wasHello) log("welcome")
            }
            is Protocol.Inbound.Error -> {
                log("PC error ${m.code.ifEmpty { "-" }} (${machine.phase})")
                if (machine.onError(m.code)) {
                    LineStore.saveLink(app, machine.address, machine.token)
                    drop("PC: ${m.code}")
                    return
                }
            }
            is Protocol.Inbound.Ping -> {
                machine.onPing(now())
                ws.send(Protocol.pong(m.id))
            }
            is Protocol.Inbound.Answer ->
                if (machine.phase == LinkMachine.Phase.UP) callControl?.onAnswer(m.callRef, m.route)
            is Protocol.Inbound.Ignore ->
                if (machine.phase == LinkMachine.Phase.UP) callControl?.onIgnore(m.callRef)
            is Protocol.Inbound.Hangup ->
                if (machine.phase == LinkMachine.Phase.UP) callControl?.onHangup(m.callRef)
            is Protocol.Inbound.Unknown, is Protocol.Inbound.Bad -> Unit
        }
        changed()
    }

    private class Listener(private val gen: Int) : WebSocketListener() {
        private fun onMain(block: () -> Unit) {
            CallTracker.handler.post { if (gen == generation) block() }
        }

        override fun onOpen(webSocket: WebSocket, response: Response) =
            onMain { openOn(webSocket) }

        override fun onMessage(webSocket: WebSocket, text: String) =
            onMain { onText(webSocket, text) }

        override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
            webSocket.close(1000, null)
            onMain { drop("closed by PC ($code${reason.short()})") }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) =
            onMain { drop("closed ($code${reason.short()})") }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
            onMain {
                val http = response?.let { " HTTP ${it.code}" }.orEmpty()
                drop("${t.javaClass.simpleName}${t.message.short()}$http")
            }

        private fun String?.short(): String =
            if (isNullOrBlank()) "" else " " + take(80)
    }

    private val clock = SimpleDateFormat("HH:mm:ss", Locale.US)

    /** One line in the phone's link log (shown on the main screen and sent with «Илгээх»). */
    private fun log(text: String) {
        if (!::app.isInitialized) return
        LineStore.addLinkEvent(app, "${clock.format(Date())} $text")
    }

    private fun now() = SystemClock.elapsedRealtime()

    fun device(): String = "${Build.MANUFACTURER} ${Build.MODEL}"
}
