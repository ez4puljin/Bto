package mn.bto.callbridge

import android.annotation.TargetApi
import android.content.Intent
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.OutcomeReceiver
import android.os.SystemClock
import android.telecom.Call
import android.telecom.CallAudioState
import android.telecom.CallEndpoint
import android.telecom.CallEndpointException
import android.telecom.InCallService
import android.telecom.VideoProfile
import java.util.UUID

/** A call the phone is following, with its record and its pending timers. */
class Tracked(val call: Call, val record: CallRecord) {
    val addedAt: Long = SystemClock.elapsedRealtime()
    var activeAt: Long? = null
    /** Incoming calls only: who takes it, the AI or staff. */
    var decision: RingDecision? = null
    var fallbackTask: Runnable? = null
    /** The AI answered it (the PC said `answer` in time and the phone did). */
    var aiAnswered = false
    /** The route the PC asked for: BLUETOOTH or WIRED_HEADSET. */
    var routeAsked: String? = null
    var reachedWanted = false
    var reRequested = false
    var routeTries = 0
    /** Who ended it as far as the phone knows: "pc" (hangup) or "user" (a button). */
    var endedBy: String? = null
    var finished = false
    lateinit var callback: Call.Callback

    /** The PC heard of this call (`ringing` was sent): it gets its state and route frames. */
    val reported: Boolean get() = record.callRef != null
}

/** The calls in progress, shared by the service and the in-call screen (one process, main thread). */
object CallTracker {
    /** One handler for every timer and for the link, so everything runs on the main thread. */
    val handler = Handler(Looper.getMainLooper())
    val calls = mutableListOf<Tracked>()
    private val listeners = mutableSetOf<() -> Unit>()

    fun find(call: Call): Tracked? = calls.firstOrNull { it.call == call }
    fun findRef(callRef: String): Tracked? =
        calls.firstOrNull { it.record.callRef == callRef && !it.finished }
    fun addListener(l: () -> Unit) { listeners.add(l) }
    fun removeListener(l: () -> Unit) { listeners.remove(l) }
    fun changed() { listeners.toList().forEach { it() } }

    /** A person took the decision on the in-call screen: the PC's late word is ignored. */
    private fun takeByHand(t: Tracked) {
        t.fallbackTask?.let(handler::removeCallbacks)
        t.fallbackTask = null
        val d = t.decision ?: return
        if (d.onManual()) t.record.fallback = RingDecision.Reason.MANUAL.text
    }

    fun answer(t: Tracked) {
        takeByHand(t)
        runCatching { t.call.answer(VideoProfile.STATE_AUDIO_ONLY) }
            .onFailure { t.record.errors.add("answer (button): $it") }
    }

    fun reject(t: Tracked) {
        takeByHand(t)
        t.endedBy = "user"
        runCatching { t.call.reject(false, null) }
            .onFailure { t.record.errors.add("reject: $it") }
    }

    fun hangup(t: Tracked) {
        takeByHand(t)
        t.endedBy = "user"
        runCatching { t.call.disconnect() }
            .onFailure { t.record.errors.add("disconnect (button): $it") }
    }
}

/** The state of a call, through the API each Android version offers. */
fun stateOf(call: Call): Int =
    if (Build.VERSION.SDK_INT >= 31) call.details.state else @Suppress("DEPRECATION") call.state

fun numberOf(call: Call): String = call.details.handle?.schemeSpecificPart.orEmpty()

/**
 * Telecom binds this service while a call exists, once the app holds the dialer role. Every
 * callback comes on the main thread. An incoming call is reported to the PC (`ringing`); the PC
 * says `answer` or `ignore` within the fallback time, or the phone rings normally for staff
 * (ADR-0232 #14). An answered call's audio goes to the endpoint the PC asked for.
 */
class LineInCallService : InCallService(), BridgeLink.CallControl {
    private val handler = CallTracker.handler

    /** API 34+: what the phone last said about endpoints. */
    private var endpoints: List<CallEndpoint> = emptyList()
    private var currentEndpoint: CallEndpoint? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
        BridgeLink.callControl = this
        // A call came before the app was opened since boot: start the link for the next one.
        if (!LinkService.running) LinkService.start(this)
    }

    override fun onDestroy() {
        if (instance === this) instance = null
        if (BridgeLink.callControl === this) BridgeLink.callControl = null
        super.onDestroy()
    }

    override fun onCallAdded(call: Call) {
        super.onCallAdded(call)
        val state = stateOf(call)
        val incoming = call.details.callDirection == Call.Details.DIRECTION_INCOMING ||
            state == Call.STATE_RINGING
        val now = System.currentTimeMillis()
        val record = CallRecord("$now-${call.hashCode()}", now, numberOf(call), incoming)
        record.noteEndpoints(availableNames())
        val t = Tracked(call, record)
        t.callback = object : Call.Callback() {
            override fun onStateChanged(call: Call, state: Int) = onState(t, state)
            override fun onDetailsChanged(call: Call, details: Call.Details) = CallTracker.changed()
        }
        CallTracker.calls.add(t)
        call.registerCallback(t.callback)

        if (incoming && state == Call.STATE_RINGING) {
            startDecision(t)
        } else {
            Notifications.show(this, t, fullScreen = incoming)
            openScreen()
        }
        save(t)
        CallTracker.changed()
    }

    /** Ask the PC, or ring normally at once when the rules say so. */
    private fun startDecision(t: Tracked) {
        val settings = LineStore.settings(this)
        val linkUp = BridgeLink.isUp()
        val otherCall = CallTracker.calls.any { it !== t && !it.finished }
        val d = RingDecision.start(
            callRef = UUID.randomUUID().toString(),
            now = t.addedAt,
            aiOn = settings.aiAnswer,
            linkUp = linkUp,
            otherCall = otherCall,
            fallbackMs = settings.fallbackMs.toLong(),
        )
        t.decision = d
        if (settings.aiAnswer) t.record.linkUpAtRing = linkUp
        if (!d.waiting) {
            ringNormally(t)
            return
        }
        t.record.mode = "ai"
        t.record.callRef = d.callRef
        if (!BridgeLink.send(Protocol.ringing(d.callRef, t.record.number, t.record.startedAt))) {
            d.onNotSent()
            ringNormally(t)
            return
        }
        val task = Runnable {
            t.fallbackTask = null
            if (d.onTimeout(SystemClock.elapsedRealtime())) ringNormally(t)
        }
        t.fallbackTask = task
        handler.postDelayed(task, (d.deadline - SystemClock.elapsedRealtime()).coerceAtLeast(0))
        Notifications.show(this, t, fullScreen = false)
    }

    /** Staff take it: the normal incoming-call screen, full screen over the lock screen. */
    private fun ringNormally(t: Tracked) {
        t.fallbackTask?.let(handler::removeCallbacks)
        t.fallbackTask = null
        val outcome = t.decision?.outcome
        if (outcome is RingDecision.Outcome.RingNormally) t.record.fallback = outcome.reason.text
        copyDecision(t)
        if (t.finished || stateOf(t.call) != Call.STATE_RINGING) {
            save(t)
            CallTracker.changed()
            return
        }
        Notifications.show(this, t, fullScreen = true)
        openScreen()
        save(t)
        CallTracker.changed()
    }

    private fun copyDecision(t: Tracked) {
        val d = t.decision ?: return
        t.record.pcSaid = d.pcSaid
        t.record.pcReplyMs = d.pcReplyMs
    }

    // --- What the PC asks (BridgeLink.CallControl) -------------------------------------------

    override fun onAnswer(callRef: String, route: String) {
        val t = CallTracker.findRef(callRef) ?: return
        val d = t.decision ?: return
        val verdict = d.onAnswer(SystemClock.elapsedRealtime(), route)
        copyDecision(t)
        if (verdict != RingDecision.Verdict.ACCEPT) {
            if (verdict == RingDecision.Verdict.LATE && t.fallbackTask != null) ringNormally(t)
            save(t)
            return
        }
        t.fallbackTask?.let(handler::removeCallbacks)
        t.fallbackTask = null
        val refusal = when {
            stateOf(t.call) != Call.STATE_RINGING -> "state ${stateOf(t.call)}"
            !LineStore.settings(this).aiAnswer -> "AI off"
            CallTracker.calls.any { it !== t && !it.finished } -> "another call"
            !BridgeLink.isUp() -> "link down"
            else -> null
        }
        if (refusal != null) {
            d.onAnswerRefused()
            t.record.errors.add("not answered: $refusal")
            ringNormally(t)
            return
        }
        // Owner 2026-11-20: the AI never talks into the earpiece. No asked endpoint, no answer.
        val available = availableTypes()
        if (!LineRules.canAnswerOn(route, available)) {
            d.onAnswerRefused(RingDecision.Reason.NO_ENDPOINT)
            t.record.errors.add("not answered: $route not available (${available.joinToString(",").ifEmpty { "-" }})")
            sendRoute(t)
            ringNormally(t)
            return
        }
        try {
            t.aiAnswered = true
            t.routeAsked = route
            t.record.routeAsked = route
            t.call.answer(VideoProfile.STATE_AUDIO_ONLY)
            t.record.answerRequestedMs = SystemClock.elapsedRealtime() - t.addedAt
            BridgeLink.send(Protocol.state(callRef, Protocol.STATE_ANSWERED, "", System.currentTimeMillis()))
            Notifications.show(this, t, fullScreen = false)
        } catch (e: Exception) {
            t.aiAnswered = false
            d.onAnswerRefused()
            t.record.errors.add("answer: $e")
            ringNormally(t)
        }
        save(t)
        CallTracker.changed()
    }

    override fun onIgnore(callRef: String) {
        val t = CallTracker.findRef(callRef) ?: return
        val d = t.decision ?: return
        if (d.onIgnore(SystemClock.elapsedRealtime())) ringNormally(t) else copyDecision(t)
    }

    override fun onHangup(callRef: String) {
        val t = CallTracker.findRef(callRef) ?: return
        t.endedBy = "pc"
        try {
            t.call.disconnect()
        } catch (e: Exception) {
            t.record.errors.add("disconnect (pc): $e")
            save(t)
        }
    }

    override fun onLinkDown() {
        CallTracker.calls.filter { it.decision?.waiting == true }.forEach { t ->
            if (t.decision?.onLinkLost() == true) ringNormally(t)
        }
    }

    // --- Call states --------------------------------------------------------------------------

    private fun onState(t: Tracked, state: Int) {
        when (state) {
            Call.STATE_ACTIVE -> if (t.activeAt == null) {
                val now = SystemClock.elapsedRealtime()
                t.activeAt = now
                t.fallbackTask?.let(handler::removeCallbacks)
                t.fallbackTask = null
                // Answered elsewhere (a button, a headset, Phone Link): the PC's word no longer counts.
                if (!t.aiAnswered && t.decision?.onManual() == true) {
                    t.record.fallback = RingDecision.Reason.MANUAL.text
                }
                if (t.record.incoming) {
                    t.record.ringToAnswerMs = now - t.addedAt
                    t.record.answeredBy = if (t.aiAnswered) "ai" else "user"
                }
                t.record.endpointUsed = currentName()
                if (t.reported) {
                    BridgeLink.send(
                        Protocol.state(t.record.callRef!!, Protocol.STATE_ACTIVE, "", System.currentTimeMillis()),
                    )
                }
                if (t.aiAnswered) routeToAsked(t)
                sendRoute(t)
                Notifications.show(this, t, fullScreen = false)
            }
            Call.STATE_DISCONNECTED -> finish(t)
        }
        save(t)
        CallTracker.changed()
    }

    override fun onCallRemoved(call: Call) {
        super.onCallRemoved(call)
        val t = CallTracker.find(call) ?: return
        finish(t)
        call.unregisterCallback(t.callback)
        CallTracker.calls.remove(t)
        if (CallTracker.calls.isEmpty()) Notifications.cancel(this)
        else Notifications.show(this, CallTracker.calls.first(), fullScreen = false)
        CallTracker.changed()
    }

    /** The call has ended: stop its timer, tell the PC, write how it ended, once. */
    private fun finish(t: Tracked) {
        t.fallbackTask?.let(handler::removeCallbacks)
        t.fallbackTask = null
        if (t.finished) return
        t.finished = true
        t.decision?.onManual() // Nothing the PC says about it counts any more.
        val cause = t.call.details.disconnectCause
        t.record.endedBy = t.endedBy
        t.record.ended = LineRules.endedText(
            null, // Who ended it is endedBy, its own field.
            cause?.code,
            listOfNotNull(cause?.reason, cause?.description?.toString())
                .filter { it.isNotBlank() }.joinToString("; "),
        )
        t.activeAt?.let { t.record.talkMs = SystemClock.elapsedRealtime() - it }
        if (t.reported) {
            BridgeLink.send(
                Protocol.state(
                    t.record.callRef!!,
                    Protocol.STATE_ENDED,
                    cause?.code?.let(LineRules::disconnectCodeName) ?: "",
                    System.currentTimeMillis(),
                ),
            )
        }
        save(t)
    }

    // --- Audio routing ---------------------------------------------------------------------

    /** The AI's call: to the endpoint the PC asked for, once it is there. */
    private fun routeToAsked(t: Tracked) {
        val route = t.routeAsked ?: return
        if (t.routeTries >= MAX_ROUTE_TRIES) return
        try {
            if (Build.VERSION.SDK_INT >= 34) routeToAsked34(t, route) else routeToAskedOld(t, route)
        } catch (e: Exception) {
            t.record.errors.add("route: $e")
        }
    }

    @TargetApi(34) // Called only on API 34+.
    private fun routeToAsked34(t: Tracked, route: String) {
        val type = LineRules.endpointTypeOf(route) ?: return
        if (currentEndpoint?.endpointType == type) {
            t.reachedWanted = true
            t.record.routeResult = "on ${nameOf(currentEndpoint!!)}"
            return
        }
        val target = endpoints.firstOrNull { it.endpointType == type }
        if (target == null) {
            t.record.routeResult = "$route not available: on ${currentName() ?: "?"}"
            return
        }
        t.routeTries++
        t.record.routeResult = "asked ${nameOf(target)}"
        requestCallEndpointChange(
            target,
            mainExecutor,
            object : OutcomeReceiver<Void, CallEndpointException> {
                override fun onResult(result: Void?) {
                    t.reachedWanted = true
                    t.record.routeResult = "moved to ${nameOf(target)}"
                    save(t)
                }

                override fun onError(error: CallEndpointException) {
                    t.record.routeResult = "refused ${nameOf(target)}"
                    t.record.errors.add("endpoint change: code ${error.code} ${error.message}")
                    save(t)
                }
            },
        )
    }

    @Suppress("DEPRECATION")
    private fun routeToAskedOld(t: Tracked, route: String) {
        val wanted = LineRules.audioRouteOf(route) ?: return
        val audio = callAudioState
        if (audio == null) {
            t.record.routeResult = "no audio state"
            return
        }
        if (audio.route == wanted) {
            t.reachedWanted = true
            t.record.routeResult = "on $route"
            return
        }
        if (audio.supportedRouteMask and wanted == 0) {
            t.record.routeResult = "$route not available: on ${LineRules.routeName(audio.route)}"
            return
        }
        t.routeTries++
        setAudioRoute(wanted)
        t.record.routeResult = "asked $route"
    }

    /** The speaker button: speaker on, or back to the headset / earpiece. */
    fun toggleSpeaker() {
        if (Build.VERSION.SDK_INT >= 34) {
            val onSpeaker = currentEndpoint?.endpointType == LineRules.ENDPOINT_SPEAKER
            val target = if (onSpeaker) {
                val i = LineRules.pickAccessoryEndpoint(endpoints.map { it.endpointType })
                if (i >= 0) endpoints[i]
                else endpoints.firstOrNull { it.endpointType == LineRules.ENDPOINT_EARPIECE }
            } else {
                endpoints.firstOrNull { it.endpointType == LineRules.ENDPOINT_SPEAKER }
            } ?: return
            requestCallEndpointChange(
                target,
                mainExecutor,
                object : OutcomeReceiver<Void, CallEndpointException> {
                    override fun onResult(result: Void?) {}
                    override fun onError(error: CallEndpointException) {}
                },
            )
        } else {
            @Suppress("DEPRECATION")
            val audio = callAudioState ?: return
            @Suppress("DEPRECATION")
            setAudioRoute(
                if (audio.route == CallAudioState.ROUTE_SPEAKER) CallAudioState.ROUTE_WIRED_OR_EARPIECE
                else CallAudioState.ROUTE_SPEAKER,
            )
        }
    }

    fun isSpeakerOn(): Boolean =
        if (Build.VERSION.SDK_INT >= 34) {
            currentEndpoint?.endpointType == LineRules.ENDPOINT_SPEAKER
        } else {
            @Suppress("DEPRECATION")
            callAudioState?.route == CallAudioState.ROUTE_SPEAKER
        }

    @TargetApi(34) // Called only on API 34+.
    override fun onAvailableCallEndpointsChanged(availableEndpoints: List<CallEndpoint>) {
        super.onAvailableCallEndpointsChanged(availableEndpoints)
        endpoints = availableEndpoints
        val names = availableEndpoints.map(::nameOf)
        CallTracker.calls.forEach { t ->
            t.record.noteEndpoints(names)
            // Bluetooth that connects after the answer still gets the AI's call.
            if (t.aiAnswered && !t.reachedWanted && !t.finished && t.activeAt != null) routeToAsked(t)
            if (t.activeAt != null && !t.finished) sendRoute(t)
            save(t)
        }
    }

    @TargetApi(34) // Called only on API 34+.
    override fun onCallEndpointChanged(callEndpoint: CallEndpoint) {
        super.onCallEndpointChanged(callEndpoint)
        currentEndpoint = callEndpoint
        CallTracker.calls.forEach { t ->
            if (t.activeAt != null && !t.finished) {
                t.record.endpointUsed = nameOf(callEndpoint)
                afterRouteChange(t, callEndpoint.endpointType)
                sendRoute(t)
                save(t)
            }
        }
        CallTracker.changed()
    }

    @Deprecated("Below API 34 only; onCallEndpointChanged above.")
    override fun onCallAudioStateChanged(audioState: CallAudioState) {
        @Suppress("DEPRECATION")
        super.onCallAudioStateChanged(audioState)
        if (Build.VERSION.SDK_INT >= 34) return
        val names = LineRules.routeNames(audioState.supportedRouteMask)
        CallTracker.calls.forEach { t ->
            t.record.noteEndpoints(names)
            if (t.activeAt != null && !t.finished) {
                t.record.endpointUsed = LineRules.routeName(audioState.route)
                afterRouteChange(t, endpointTypeOfRoute(audioState.route))
                if (t.aiAnswered && !t.reachedWanted) routeToAsked(t)
                sendRoute(t)
            }
            save(t)
        }
        CallTracker.changed()
    }

    /** The audio moved: note when the AI's call reached its endpoint, and ask again once. */
    private fun afterRouteChange(t: Tracked, newType: Int) {
        if (!t.aiAnswered) return
        val wanted = t.routeAsked?.let(LineRules::endpointTypeOf) ?: return
        if (newType == wanted) {
            t.reachedWanted = true
            return
        }
        if (LineRules.shouldReRequest(t.reachedWanted, t.reRequested, newType)) {
            t.reRequested = true
            t.reachedWanted = false
            t.routeTries = 0
            t.record.errors.add("moved back to EARPIECE: asked ${t.routeAsked} again")
            routeToAsked(t)
        }
    }

    /** `route`: where the call's audio is and what the phone offers, for calls the PC knows. */
    private fun sendRoute(t: Tracked) {
        val ref = t.record.callRef ?: return
        val current = currentTypeName() ?: return
        if (!LineRules.isReportedEndpoint(current)) return
        BridgeLink.send(
            Protocol.route(ref, current, availableTypes().filter(LineRules::isReportedEndpoint)),
        )
    }

    private fun endpointTypeOfRoute(route: Int): Int = when (route) {
        LineRules.ROUTE_EARPIECE -> LineRules.ENDPOINT_EARPIECE
        LineRules.ROUTE_BLUETOOTH -> LineRules.ENDPOINT_BLUETOOTH
        LineRules.ROUTE_WIRED_HEADSET -> LineRules.ENDPOINT_WIRED_HEADSET
        LineRules.ROUTE_SPEAKER -> LineRules.ENDPOINT_SPEAKER
        else -> LineRules.ENDPOINT_STREAMING
    }

    @TargetApi(34) // Called only on API 34+.
    private fun nameOf(e: CallEndpoint): String {
        val label = e.endpointName.toString()
        val type = LineRules.endpointTypeName(e.endpointType)
        return if (label.isBlank() || label.equals(type, ignoreCase = true)) type else "$type($label)"
    }

    /** The endpoint types the phone offers now, by name (BLUETOOTH, EARPIECE…). */
    private fun availableTypes(): List<String> {
        if (Build.VERSION.SDK_INT >= 34 && endpoints.isNotEmpty()) {
            return endpoints.map { LineRules.endpointTypeName(it.endpointType) }
        }
        // Before the first endpoint report (or below 34): the older audio state.
        @Suppress("DEPRECATION")
        return callAudioState?.let { LineRules.routeNames(it.supportedRouteMask) }.orEmpty()
    }

    private fun currentTypeName(): String? {
        if (Build.VERSION.SDK_INT >= 34) {
            currentEndpoint?.let { return LineRules.endpointTypeName(it.endpointType) }
        }
        @Suppress("DEPRECATION")
        return callAudioState?.let { LineRules.routeName(it.route) }
    }

    private fun availableNames(): List<String> =
        if (Build.VERSION.SDK_INT >= 34 && endpoints.isNotEmpty()) {
            endpoints.map(::nameOf)
        } else {
            @Suppress("DEPRECATION")
            callAudioState?.let { LineRules.routeNames(it.supportedRouteMask) }.orEmpty()
        }

    private fun currentName(): String? =
        if (Build.VERSION.SDK_INT >= 34 && currentEndpoint != null) {
            nameOf(currentEndpoint!!)
        } else {
            @Suppress("DEPRECATION")
            callAudioState?.let { LineRules.routeName(it.route) }
        }

    // --- Helpers ---------------------------------------------------------------------------

    private fun save(t: Tracked) {
        try {
            LineStore.saveCall(this, t.record)
        } catch (e: Exception) {
            // The record stays in memory; the screen still shows the call.
        }
    }

    private fun openScreen() {
        try {
            startActivity(
                Intent(this, InCallActivity::class.java)
                    .addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_NO_USER_ACTION),
            )
        } catch (e: Exception) {
            // The full-screen notification is the way in then.
        }
    }

    companion object {
        private const val MAX_ROUTE_TRIES = 3

        /** The bound service, for the in-call screen's speaker button. */
        var instance: LineInCallService? = null
            private set
    }
}
