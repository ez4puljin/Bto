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
                drop("no ping for ${Protocol.LINK_DEAD_AFTER_MS / 1000} s")
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
        }
        if (socket == null && !handler.hasCallbacks(retryTask)) connect()
    }

    fun stop() {
        handler.removeCallbacks(retryTask)
        closeSocket()
        started = false
        changed()
    }

    /** «Холбох»: pair with the code the PC shows. */
    fun pair(context: Context, address: PcAddress, code: String) {
        app = context.applicationContext
        started = true
        machine.startPairing(address, code)
        LineStore.saveLink(app, address, machine.token)
        handler.removeCallbacks(retryTask)
        closeSocket()
        connect()
    }

    /**
     * The Wi-Fi network the socket is bound to: when the office Wi-Fi has no internet, Android
     * may keep mobile data as the default network, and the PC is reached only over the Wi-Fi.
     */
    private var wifi: Network? = null

    fun networkLost(network: Network) {
        if (wifi == network) wifi = null
    }

    /** A Wi-Fi network came up: a waiting reconnect happens now, over it. */
    fun networkAvailable(network: Network) {
        wifi = network
        if (!started || socket != null) return
        if (machine.phase == LinkMachine.Phase.RETRY) {
            machine.resetBackoff()
            handler.removeCallbacks(retryTask)
            handler.post(retryTask)
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
            machine.onClosed()
            scheduleRetry()
            return
        }
        val net = wifi
        val c = if (net != null) client.newBuilder().socketFactory(net.socketFactory).build() else client
        socket = c.newWebSocket(request, Listener(gen))
        handler.removeCallbacks(watchdog)
        handler.postDelayed(watchdog, 1000)
        changed()
    }

    private fun closeSocket() {
        generation++
        socket?.cancel()
        socket = null
        handler.removeCallbacks(watchdog)
    }

    /** The link is gone: tell the calls, schedule a reconnect if there is anything to retry. */
    private fun drop(why: String) {
        val wasUp = machine.phase == LinkMachine.Phase.UP
        lastDrop = why
        closeSocket()
        if (machine.onClosed()) scheduleRetry()
        if (wasUp) callControl?.onLinkDown()
        changed()
    }

    private fun scheduleRetry() {
        handler.removeCallbacks(retryTask)
        handler.postDelayed(retryTask, machine.retryDelayMs())
    }

    private fun openOn(ws: WebSocket) {
        val first = machine.onOpen(now(), device(), BuildConfig.VERSION_NAME)
        if (first == null || !ws.send(first)) drop("could not send hello")
        changed()
    }

    private fun onText(ws: WebSocket, text: String) {
        when (val m = Protocol.parse(text)) {
            is Protocol.Inbound.Paired -> if (machine.onPaired(now(), m.token)) {
                LineStore.saveLink(app, machine.address, machine.token)
            }
            Protocol.Inbound.Welcome -> machine.onWelcome(now())
            is Protocol.Inbound.Error -> if (machine.onError(m.code)) {
                LineStore.saveLink(app, machine.address, machine.token)
                drop("PC: ${m.code}")
                return
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
            onMain { drop("closed by PC ($code)") }
        }

        override fun onClosed(webSocket: WebSocket, code: Int, reason: String) =
            onMain { drop("closed ($code)") }

        override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) =
            onMain { drop(t.javaClass.simpleName) }
    }

    private fun now() = SystemClock.elapsedRealtime()

    fun device(): String = "${Build.MANUFACTURER} ${Build.MODEL}"
}
