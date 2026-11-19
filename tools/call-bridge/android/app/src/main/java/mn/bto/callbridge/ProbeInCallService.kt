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

/** A call the probe is following, with its record and its pending timers. */
class Tracked(val call: Call, val record: CallRecord) {
    val addedAt: Long = SystemClock.elapsedRealtime()
    var activeAt: Long? = null
    var answerTask: Runnable? = null
    var hangupTask: Runnable? = null
    /** Who ended it as far as the probe knows: "probe" (the hang-up timer) or "user" (a button). */
    var endedBy: String? = null
    var answeredByProbe = false
    var routed = false
    var finished = false
    lateinit var callback: Call.Callback
}

/** The calls in progress, shared by the service and the in-call screen (one process, main thread). */
object CallTracker {
    /** One handler for every timer, so a button can cancel what the service scheduled. */
    val handler = Handler(Looper.getMainLooper())
    val calls = mutableListOf<Tracked>()
    private val listeners = mutableSetOf<() -> Unit>()

    fun find(call: Call): Tracked? = calls.firstOrNull { it.call == call }
    fun addListener(l: () -> Unit) { listeners.add(l) }
    fun removeListener(l: () -> Unit) { listeners.remove(l) }
    fun changed() { listeners.toList().forEach { it() } }

    private fun cancelAutoAnswer(t: Tracked) {
        t.answerTask?.let(handler::removeCallbacks)
        t.answerTask = null
    }

    /** The in-call screen's buttons: the person decides, the probe stands back. */
    fun answer(t: Tracked) {
        cancelAutoAnswer(t)
        runCatching { t.call.answer(VideoProfile.STATE_AUDIO_ONLY) }
            .onFailure { t.record.errors.add("answer (button): $it") }
    }

    fun reject(t: Tracked) {
        cancelAutoAnswer(t)
        t.endedBy = "user"
        runCatching { t.call.reject(false, null) }
            .onFailure { t.record.errors.add("reject: $it") }
    }

    fun hangup(t: Tracked) {
        cancelAutoAnswer(t)
        t.hangupTask?.let(handler::removeCallbacks)
        t.hangupTask = null
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
 * callback comes on the main thread. Stage 0: answer by itself when «AI хариулах» is on, move the
 * audio to a headset if one is there, hang up after N seconds, and write down what happened.
 */
class ProbeInCallService : InCallService() {
    private val handler = CallTracker.handler

    /** API 34+: what the phone last said about endpoints. */
    private var endpoints: List<CallEndpoint> = emptyList()
    private var currentEndpoint: CallEndpoint? = null

    override fun onCreate() {
        super.onCreate()
        instance = this
    }

    override fun onDestroy() {
        if (instance === this) instance = null
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

        val settings = ProbeStore.settings(this)
        val alone = CallTracker.calls.size == 1
        if (incoming && state == Call.STATE_RINGING && settings.autoAnswer && alone) {
            record.mode = "auto"
            val task = Runnable { answerByProbe(t) }
            t.answerTask = task
            handler.postDelayed(task, settings.answerDelaySec * 1000L)
            Notifications.show(this, t, fullScreen = false)
        } else {
            if (incoming && settings.autoAnswer && !alone) {
                record.errors.add("not auto: another call is in progress")
            }
            Notifications.show(this, t, fullScreen = incoming)
            openScreen()
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

    private fun onState(t: Tracked, state: Int) {
        when (state) {
            Call.STATE_ACTIVE -> if (t.activeAt == null) {
                val now = SystemClock.elapsedRealtime()
                t.activeAt = now
                t.answerTask?.let(handler::removeCallbacks)
                t.answerTask = null
                if (t.record.incoming) {
                    t.record.ringToAnswerMs = now - t.addedAt
                    t.record.answeredBy = if (t.answeredByProbe) "probe" else "user"
                }
                t.record.endpointUsed = currentName()
                if (t.answeredByProbe) {
                    routeToAccessory(t)
                    val secs = ProbeStore.settings(this).hangupAfterSec
                    val task = Runnable { hangupByProbe(t) }
                    t.hangupTask = task
                    handler.postDelayed(task, secs * 1000L)
                }
                Notifications.show(this, t, fullScreen = false)
            }
            Call.STATE_DISCONNECTED -> finish(t)
        }
        save(t)
        CallTracker.changed()
    }

    private fun answerByProbe(t: Tracked) {
        t.answerTask = null
        if (stateOf(t.call) != Call.STATE_RINGING) {
            t.record.errors.add("answer skipped: state ${stateOf(t.call)}")
            save(t)
            return
        }
        try {
            t.answeredByProbe = true
            t.call.answer(VideoProfile.STATE_AUDIO_ONLY)
            t.record.answerRequestedMs = SystemClock.elapsedRealtime() - t.addedAt
        } catch (e: Exception) {
            t.answeredByProbe = false
            t.record.errors.add("answer: $e")
            openScreen()
        }
        save(t)
        CallTracker.changed()
    }

    private fun hangupByProbe(t: Tracked) {
        t.hangupTask = null
        try {
            t.endedBy = "probe"
            t.call.disconnect()
        } catch (e: Exception) {
            t.record.errors.add("disconnect: $e")
            save(t)
        }
    }

    /** The call has ended: stop its timers and write how it ended, once. */
    private fun finish(t: Tracked) {
        t.answerTask?.let(handler::removeCallbacks)
        t.hangupTask?.let(handler::removeCallbacks)
        t.answerTask = null
        t.hangupTask = null
        if (t.finished) return
        t.finished = true
        val cause = t.call.details.disconnectCause
        t.record.ended = ProbeRules.endedText(
            t.endedBy,
            cause?.code,
            listOfNotNull(cause?.reason, cause?.description?.toString())
                .filter { it.isNotBlank() }.joinToString("; "),
        )
        t.activeAt?.let { t.record.talkMs = SystemClock.elapsedRealtime() - it }
        save(t)
    }

    // --- Audio routing ---------------------------------------------------------------------

    /** After the probe answered: to a wired headset or Bluetooth if one is there. */
    private fun routeToAccessory(t: Tracked) {
        try {
            if (Build.VERSION.SDK_INT >= 34) routeToAccessory34(t) else routeToAccessoryOld(t)
        } catch (e: Exception) {
            t.record.errors.add("route: $e")
        }
    }

    @TargetApi(34) // Called only on API 34+.
    private fun routeToAccessory34(t: Tracked) {
        val list = endpoints
        val i = ProbeRules.pickAccessoryEndpoint(list.map { it.endpointType })
        if (i < 0) {
            t.record.routeResult = "no headset or Bluetooth: stayed on ${currentName() ?: "?"}"
            return
        }
        val target = list[i]
        t.routed = true
        t.record.routeResult = "asked ${nameOf(target)}"
        requestCallEndpointChange(
            target,
            mainExecutor,
            object : OutcomeReceiver<Void, CallEndpointException> {
                override fun onResult(result: Void?) {
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
    private fun routeToAccessoryOld(t: Tracked) {
        val audio = callAudioState
        if (audio == null) {
            t.record.routeResult = "no audio state"
            return
        }
        val route = ProbeRules.pickAccessoryRoute(audio.supportedRouteMask)
        if (route == null) {
            t.record.routeResult = "no headset or Bluetooth: stayed on ${ProbeRules.routeName(audio.route)}"
            return
        }
        t.routed = true
        setAudioRoute(route)
        t.record.routeResult = "asked ${ProbeRules.routeName(route)}"
    }

    /** The speaker button: speaker on, or back to the headset / earpiece. */
    fun toggleSpeaker() {
        if (Build.VERSION.SDK_INT >= 34) {
            val onSpeaker = currentEndpoint?.endpointType == ProbeRules.ENDPOINT_SPEAKER
            val target = if (onSpeaker) {
                val i = ProbeRules.pickAccessoryEndpoint(endpoints.map { it.endpointType })
                if (i >= 0) endpoints[i]
                else endpoints.firstOrNull { it.endpointType == ProbeRules.ENDPOINT_EARPIECE }
            } else {
                endpoints.firstOrNull { it.endpointType == ProbeRules.ENDPOINT_SPEAKER }
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
            currentEndpoint?.endpointType == ProbeRules.ENDPOINT_SPEAKER
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
            // A headset that connects after the answer still gets the AI's call.
            if (t.answeredByProbe && !t.routed && !t.finished && t.activeAt != null &&
                ProbeRules.pickAccessoryEndpoint(availableEndpoints.map { it.endpointType }) >= 0
            ) {
                routeToAccessory(t)
            }
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
        val names = ProbeRules.routeNames(audioState.supportedRouteMask)
        CallTracker.calls.forEach { t ->
            t.record.noteEndpoints(names)
            if (t.activeAt != null && !t.finished) {
                t.record.endpointUsed = ProbeRules.routeName(audioState.route)
            }
            save(t)
        }
        CallTracker.changed()
    }

    @TargetApi(34) // Called only on API 34+.
    private fun nameOf(e: CallEndpoint): String {
        val label = e.endpointName.toString()
        val type = ProbeRules.endpointTypeName(e.endpointType)
        return if (label.isBlank() || label.equals(type, ignoreCase = true)) type else "$type($label)"
    }

    private fun availableNames(): List<String> =
        if (Build.VERSION.SDK_INT >= 34) {
            endpoints.map(::nameOf)
        } else {
            @Suppress("DEPRECATION")
            callAudioState?.let { ProbeRules.routeNames(it.supportedRouteMask) }.orEmpty()
        }

    private fun currentName(): String? =
        if (Build.VERSION.SDK_INT >= 34) {
            currentEndpoint?.let(::nameOf)
        } else {
            @Suppress("DEPRECATION")
            callAudioState?.let { ProbeRules.routeName(it.route) }
        }

    // --- Helpers ---------------------------------------------------------------------------

    private fun save(t: Tracked) {
        try {
            ProbeStore.saveCall(this, t.record)
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
        /** The bound service, for the in-call screen's speaker button. */
        var instance: ProbeInCallService? = null
            private set
    }
}
