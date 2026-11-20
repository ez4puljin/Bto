package mn.bto.callbridge

import mn.bto.callbridge.RingDecision.Outcome
import mn.bto.callbridge.RingDecision.Reason
import mn.bto.callbridge.RingDecision.Verdict
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class RingDecisionTest {
    private fun waiting(now: Long = 1000, fallback: Long = 3000) =
        RingDecision.start("r1", now, aiOn = true, linkUp = true, otherCall = false, fallbackMs = fallback)

    @Test
    fun neverAsksWhenAiIsOffTheLinkIsDownOrAnotherCallIsOn() {
        assertEquals(
            Outcome.RingNormally(Reason.AI_OFF),
            RingDecision.start("r", 0, aiOn = false, linkUp = true, otherCall = false, fallbackMs = 3000).outcome,
        )
        assertEquals(
            Outcome.RingNormally(Reason.LINK_DOWN),
            RingDecision.start("r", 0, aiOn = true, linkUp = false, otherCall = false, fallbackMs = 3000).outcome,
        )
        assertEquals(
            Outcome.RingNormally(Reason.BUSY),
            RingDecision.start("r", 0, aiOn = true, linkUp = true, otherCall = true, fallbackMs = 3000).outcome,
        )
        val d = RingDecision.start("r", 0, aiOn = false, linkUp = false, otherCall = false, fallbackMs = 3000)
        // Even a PC answer cannot turn it into an AI call.
        assertEquals(Verdict.ALREADY_DECIDED, d.onAnswer(10, "BLUETOOTH"))
        assertEquals(Outcome.RingNormally(Reason.AI_OFF), d.outcome)
    }

    @Test
    fun anAnswerInTimeIsTaken() {
        val d = waiting()
        assertTrue(d.waiting)
        assertEquals(4000, d.deadline)
        assertEquals(Verdict.ACCEPT, d.onAnswer(2200, "BLUETOOTH"))
        assertEquals(Outcome.Answer("BLUETOOTH"), d.outcome)
        assertEquals(1200L, d.pcReplyMs)
        assertEquals("answer BLUETOOTH", d.pcSaid)
        // The timer firing afterwards changes nothing.
        assertFalse(d.onTimeout(4000))
        assertEquals(Outcome.Answer("BLUETOOTH"), d.outcome)
    }

    @Test
    fun anAnswerOnTheDeadlineIsStillInTime() {
        val d = waiting()
        assertEquals(Verdict.ACCEPT, d.onAnswer(4000, "BLUETOOTH"))
    }

    @Test
    fun silenceRingsNormallyAndALateAnswerIsIgnored() {
        val d = waiting()
        assertFalse(d.onTimeout(3999)) // A timer that fires early does nothing.
        assertTrue(d.waiting)
        assertTrue(d.onTimeout(4000))
        assertEquals(Outcome.RingNormally(Reason.TIMEOUT), d.outcome)
        assertEquals(Verdict.LATE, d.onAnswer(4500, "BLUETOOTH"))
        assertEquals(Outcome.RingNormally(Reason.TIMEOUT), d.outcome)
        assertNull(d.pcReplyMs)
        assertEquals("late answer BLUETOOTH at 3500 ms", d.pcSaid)
    }

    @Test
    fun anAnswerPastTheDeadlineIsLateEvenBeforeTheTimerRuns() {
        val d = waiting()
        assertEquals(Verdict.LATE, d.onAnswer(4001, "BLUETOOTH"))
        assertEquals(Outcome.RingNormally(Reason.TIMEOUT), d.outcome)
    }

    @Test
    fun ignoreRingsNormallyAtOnce() {
        val d = waiting()
        assertTrue(d.onIgnore(1800))
        assertEquals(Outcome.RingNormally(Reason.IGNORED), d.outcome)
        assertEquals(800L, d.pcReplyMs)
        assertEquals(Verdict.ALREADY_DECIDED, d.onAnswer(1900, "BLUETOOTH"))
        assertFalse(d.onIgnore(1950))
    }

    @Test
    fun theLinkDroppingWhileAskedRingsNormally() {
        val d = waiting()
        assertTrue(d.onLinkLost())
        assertEquals(Outcome.RingNormally(Reason.LINK_LOST), d.outcome)
        assertEquals(Verdict.ALREADY_DECIDED, d.onAnswer(1500, "BLUETOOTH"))
    }

    @Test
    fun aRingingThatCouldNotBeSentRingsNormally() {
        val d = waiting()
        assertTrue(d.onNotSent())
        assertEquals(Outcome.RingNormally(Reason.NOT_SENT), d.outcome)
    }

    @Test
    fun aPersonTakingTheCallWins() {
        val d = waiting()
        assertTrue(d.onManual())
        assertEquals(Verdict.ALREADY_DECIDED, d.onAnswer(1500, "BLUETOOTH"))
        assertFalse(d.onTimeout(9000))
        assertEquals(Outcome.RingNormally(Reason.MANUAL), d.outcome)
    }

    @Test
    fun anAcceptedAnswerThePhoneCannotCarryOutRingsNormally() {
        val d = waiting()
        assertEquals(Verdict.ACCEPT, d.onAnswer(1500, "BLUETOOTH"))
        d.onAnswerRefused(Reason.NO_ENDPOINT)
        assertEquals(Outcome.RingNormally(Reason.NO_ENDPOINT), d.outcome)
        assertFalse(d.onManual())
    }

    @Test
    fun theFallbackTimeIsTheOneConfigured() {
        val d = waiting(now = 0, fallback = 1500)
        assertEquals(1500, d.deadline)
        assertEquals(Verdict.LATE, d.onAnswer(1501, "BLUETOOTH"))
    }
}
