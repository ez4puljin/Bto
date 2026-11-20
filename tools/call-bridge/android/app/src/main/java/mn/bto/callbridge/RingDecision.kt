package mn.bto.callbridge

/**
 * Who takes one incoming call: the AI (the PC said `answer` in time) or staff (the phone rings
 * normally). Pure and clock-free: every method takes `now` (elapsed ms), so the unit tests drive
 * it. The safety rules of ADR-0232: never answer when «AI хариулах» is off, when the link is down
 * or when another call is in progress; ring normally when the PC says `ignore`, is silent for the
 * fallback time, or the link drops while it is asked; a late `answer` is ignored.
 */
class RingDecision private constructor(
    val callRef: String,
    val startedAt: Long,
    val fallbackMs: Long,
    initial: Outcome,
) {
    enum class Reason(val text: String) {
        AI_OFF("AI off"),
        LINK_DOWN("link down"),
        BUSY("another call"),
        NOT_SENT("ringing not sent"),
        IGNORED("PC: ignore"),
        TIMEOUT("PC silent"),
        LINK_LOST("link lost while waiting"),
        BAD_ANSWER("PC answer refused"),
        NO_ENDPOINT("asked route not available"),
        MANUAL("taken by hand"),
    }

    sealed class Outcome {
        /** Asked the PC; the phone neither rings for staff nor answers yet. */
        object Waiting : Outcome()
        data class Answer(val route: String) : Outcome()
        data class RingNormally(val reason: Reason) : Outcome()
    }

    /** What to do with an `answer` frame. */
    enum class Verdict { ACCEPT, LATE, ALREADY_DECIDED }

    var outcome: Outcome = initial
        private set

    /** Elapsed ms from the ring to the PC's answer or ignore, or null. */
    var pcReplyMs: Long? = null
        private set

    /** What the PC said, as text for the log: "answer BLUETOOTH", "ignore", "late answer …". */
    var pcSaid: String? = null
        private set

    val waiting: Boolean get() = outcome == Outcome.Waiting

    /** The moment the fallback timer fires, for the handler. */
    val deadline: Long get() = startedAt + fallbackMs

    /** The PC answered: accepted only while waiting and before the deadline. */
    fun onAnswer(now: Long, route: String): Verdict {
        val ms = now - startedAt
        if (!waiting) {
            if (pcSaid == null) pcSaid = "late answer $route at $ms ms"
            return if (outcome is Outcome.RingNormally &&
                (outcome as Outcome.RingNormally).reason == Reason.TIMEOUT
            ) Verdict.LATE else Verdict.ALREADY_DECIDED
        }
        if (ms > fallbackMs) {
            outcome = Outcome.RingNormally(Reason.TIMEOUT)
            pcSaid = "late answer $route at $ms ms"
            return Verdict.LATE
        }
        pcReplyMs = ms
        pcSaid = "answer $route"
        outcome = Outcome.Answer(route)
        return Verdict.ACCEPT
    }

    /** The PC said ring normally. True when this changed the outcome. */
    fun onIgnore(now: Long): Boolean {
        if (!waiting) return false
        pcReplyMs = now - startedAt
        pcSaid = "ignore"
        outcome = Outcome.RingNormally(Reason.IGNORED)
        return true
    }

    /** The fallback timer fired (or a check found the deadline past). True: ring normally now. */
    fun onTimeout(now: Long): Boolean {
        if (!waiting || now < deadline) return false
        outcome = Outcome.RingNormally(Reason.TIMEOUT)
        return true
    }

    /** The link dropped while the PC was asked. True: ring normally now. */
    fun onLinkLost(): Boolean = fallTo(Reason.LINK_LOST)

    /** The `ringing` frame could not be sent. */
    fun onNotSent(): Boolean = fallTo(Reason.NOT_SENT)

    /** A person answered or rejected on the in-call screen. */
    fun onManual(): Boolean = fallTo(Reason.MANUAL)

    /** The accepted answer could not be carried out (state changed, another call, AI turned off). */
    fun onAnswerRefused(reason: Reason = Reason.BAD_ANSWER) {
        outcome = Outcome.RingNormally(reason)
    }

    private fun fallTo(reason: Reason): Boolean {
        if (!waiting) return false
        outcome = Outcome.RingNormally(reason)
        return true
    }

    companion object {
        /**
         * A call starts to ring. [Outcome.Waiting] means: send `ringing` and start the timer;
         * anything else rings normally at once and nothing is sent.
         */
        fun start(
            callRef: String,
            now: Long,
            aiOn: Boolean,
            linkUp: Boolean,
            otherCall: Boolean,
            fallbackMs: Long,
        ): RingDecision {
            val initial = when {
                !aiOn -> Outcome.RingNormally(Reason.AI_OFF)
                otherCall -> Outcome.RingNormally(Reason.BUSY)
                !linkUp -> Outcome.RingNormally(Reason.LINK_DOWN)
                else -> Outcome.Waiting
            }
            return RingDecision(callRef, now, fallbackMs, initial)
        }
    }
}
