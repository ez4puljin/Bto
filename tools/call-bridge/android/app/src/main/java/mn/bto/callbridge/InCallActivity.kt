package mn.bto.callbridge

import android.app.Activity
import android.os.Build
import android.os.Bundle
import android.telecom.Call
import android.telecom.PhoneAccountHandle
import android.telecom.TelecomManager
import android.widget.LinearLayout
import android.widget.ScrollView

/**
 * The minimal in-call screen: number, state, answer, reject or hang up, speaker. It is there so
 * that a call the AI does not take can always be taken by hand.
 */
class InCallActivity : Activity() {
    private lateinit var list: LinearLayout
    private val refresh: () -> Unit = { render() }
    private val tick = object : Runnable {
        override fun run() {
            render()
            CallTracker.handler.postDelayed(this, 1000)
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        list = column()
        setContentView(ScrollView(this).apply { addView(list) })
    }

    override fun onStart() {
        super.onStart()
        CallTracker.addListener(refresh)
        CallTracker.handler.post(tick)
    }

    override fun onStop() {
        CallTracker.removeListener(refresh)
        CallTracker.handler.removeCallbacks(tick)
        super.onStop()
    }

    private fun render() {
        list.removeAllViews()
        val calls = CallTracker.calls.filter { !it.finished }
        if (calls.isEmpty()) {
            list.add(text(getString(R.string.no_calls), 20f, bold = true))
            CallTracker.handler.postDelayed({ if (CallTracker.calls.isEmpty()) finish() }, 1500)
            return
        }
        calls.forEach { list.add(callView(it)) }
        val speaker = LineInCallService.instance
        if (speaker != null && calls.any { stateOf(it.call) == Call.STATE_ACTIVE }) {
            val on = speaker.isSpeakerOn()
            list.add(button(getString(R.string.btn_speaker) + if (on) " ✓" else "") { speaker.toggleSpeaker() })
        }
    }

    private fun callView(t: Tracked): LinearLayout {
        val box = column()
        val state = stateOf(t.call)
        box.add(text(t.record.number.ifBlank { getString(R.string.unknown_number) }, 28f, bold = true))
        box.add(text(stateText(state), 18f))
        if (t.decision?.waiting == true) box.add(text(getString(R.string.ai_deciding)))
        if (t.aiAnswered) box.add(text(getString(R.string.ai_talking)))
        t.record.endpointUsed?.let { box.add(text(it, 14f)) }

        val buttons = row()
        when (state) {
            Call.STATE_RINGING -> {
                buttons.add(button(getString(R.string.btn_answer)) { CallTracker.answer(t) })
                buttons.add(button(getString(R.string.btn_reject)) { CallTracker.reject(t) })
            }
            Call.STATE_SELECT_PHONE_ACCOUNT -> {
                box.add(text(getString(R.string.choose_sim)))
                accountsOf(t.call).forEach { handle ->
                    box.add(button(labelOf(handle)) { t.call.phoneAccountSelected(handle, false) })
                }
                buttons.add(button(getString(R.string.btn_hangup)) { CallTracker.hangup(t) })
            }
            else -> buttons.add(button(getString(R.string.btn_hangup)) { CallTracker.hangup(t) })
        }
        box.add(buttons)
        return box
    }

    private fun stateText(state: Int): String = when (state) {
        Call.STATE_RINGING -> getString(R.string.state_ringing)
        Call.STATE_DIALING, Call.STATE_CONNECTING, Call.STATE_NEW, Call.STATE_PULLING_CALL ->
            getString(R.string.state_dialing)
        Call.STATE_ACTIVE -> getString(R.string.state_active)
        Call.STATE_HOLDING -> getString(R.string.state_holding)
        Call.STATE_DISCONNECTING, Call.STATE_DISCONNECTED -> getString(R.string.state_disconnected)
        Call.STATE_SELECT_PHONE_ACCOUNT -> getString(R.string.state_select_sim)
        else -> getString(R.string.state_other, state)
    }

    /** A phone with two SIMs and no default asks which one places the call. */
    private fun accountsOf(call: Call): List<PhoneAccountHandle> {
        val extras = call.details.intentExtras ?: return emptyList()
        @Suppress("DEPRECATION")
        val key = Call.AVAILABLE_PHONE_ACCOUNTS
        return if (Build.VERSION.SDK_INT >= 33) {
            extras.getParcelableArrayList(key, PhoneAccountHandle::class.java)
        } else {
            @Suppress("DEPRECATION")
            extras.getParcelableArrayList(key)
        }.orEmpty()
    }

    private fun labelOf(handle: PhoneAccountHandle): String =
        try {
            getSystemService(TelecomManager::class.java)?.getPhoneAccount(handle)?.label?.toString()
        } catch (e: SecurityException) {
            null
        } ?: handle.id
}
