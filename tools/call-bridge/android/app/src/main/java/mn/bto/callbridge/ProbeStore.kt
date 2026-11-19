package mn.bto.callbridge

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * One call as the probe saw it: the evidence the owner sends back. Times are wall-clock
 * milliseconds for [startedAt] and elapsed milliseconds from the first ring for the rest.
 */
class CallRecord(
    val id: String,
    val startedAt: Long,
    val number: String,
    val incoming: Boolean,
) {
    /** "auto" when the probe was set to answer it, "manual" when the in-call screen took it. */
    var mode: String = "manual"
    var answerRequestedMs: Long? = null
    var ringToAnswerMs: Long? = null
    /** "probe", "user" or null (not answered). */
    var answeredBy: String? = null
    val endpointsAvailable: MutableList<String> = mutableListOf()
    var endpointUsed: String? = null
    var routeResult: String? = null
    var ended: String? = null
    var talkMs: Long? = null
    val errors: MutableList<String> = mutableListOf()

    fun noteEndpoints(names: List<String>) {
        names.forEach { if (it !in endpointsAvailable) endpointsAvailable.add(it) }
    }

    fun toJson(): JSONObject = JSONObject().apply {
        put("id", id)
        put("startedAt", startedAt)
        put("number", number)
        put("incoming", incoming)
        put("mode", mode)
        put("answerRequestedMs", answerRequestedMs ?: JSONObject.NULL)
        put("ringToAnswerMs", ringToAnswerMs ?: JSONObject.NULL)
        put("answeredBy", answeredBy ?: JSONObject.NULL)
        put("endpointsAvailable", JSONArray(endpointsAvailable))
        put("endpointUsed", endpointUsed ?: JSONObject.NULL)
        put("routeResult", routeResult ?: JSONObject.NULL)
        put("ended", ended ?: JSONObject.NULL)
        put("talkMs", talkMs ?: JSONObject.NULL)
        put("errors", JSONArray(errors))
    }

    companion object {
        fun fromJson(o: JSONObject): CallRecord =
            CallRecord(
                id = o.getString("id"),
                startedAt = o.getLong("startedAt"),
                number = o.optString("number"),
                incoming = o.optBoolean("incoming"),
            ).apply {
                mode = o.optString("mode", "manual")
                answerRequestedMs = o.longOrNull("answerRequestedMs")
                ringToAnswerMs = o.longOrNull("ringToAnswerMs")
                answeredBy = o.stringOrNull("answeredBy")
                o.optJSONArray("endpointsAvailable")?.let { a ->
                    for (i in 0 until a.length()) endpointsAvailable.add(a.getString(i))
                }
                endpointUsed = o.stringOrNull("endpointUsed")
                routeResult = o.stringOrNull("routeResult")
                ended = o.stringOrNull("ended")
                talkMs = o.longOrNull("talkMs")
                o.optJSONArray("errors")?.let { a ->
                    for (i in 0 until a.length()) errors.add(a.getString(i))
                }
            }

        private fun JSONObject.longOrNull(key: String): Long? =
            if (isNull(key)) null else optLong(key)

        private fun JSONObject.stringOrNull(key: String): String? =
            if (isNull(key)) null else optString(key)
    }
}

/** The settings and the last calls, in the app's own SharedPreferences: nothing leaves the phone. */
object ProbeStore {
    private const val PREFS = "probe"
    private const val KEY_AUTO = "autoAnswer"
    private const val KEY_DELAY = "answerDelaySec"
    private const val KEY_HANGUP = "hangupAfterSec"
    private const val KEY_CALLS = "calls"

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun settings(context: Context): ProbeSettings {
        val p = prefs(context)
        return ProbeSettings(
            autoAnswer = p.getBoolean(KEY_AUTO, false),
            answerDelaySec = p.getInt(KEY_DELAY, ProbeSettings.DEFAULT_DELAY_SEC),
            hangupAfterSec = p.getInt(KEY_HANGUP, ProbeSettings.DEFAULT_HANGUP_SEC),
        )
    }

    fun saveSettings(context: Context, s: ProbeSettings) {
        prefs(context).edit()
            .putBoolean(KEY_AUTO, s.autoAnswer)
            .putInt(KEY_DELAY, s.answerDelaySec)
            .putInt(KEY_HANGUP, s.hangupAfterSec)
            .apply()
    }

    fun calls(context: Context): List<CallRecord> {
        val raw = prefs(context).getString(KEY_CALLS, null) ?: return emptyList()
        return try {
            val a = JSONArray(raw)
            (0 until a.length()).map { CallRecord.fromJson(a.getJSONObject(it)) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    /** Saved on every change of a call, so a crash still leaves what was seen up to then. */
    fun saveCall(context: Context, record: CallRecord) {
        val next = ProbeRules.upsertNewestFirst(calls(context), record) { it.id }
        val a = JSONArray()
        next.forEach { a.put(it.toJson()) }
        prefs(context).edit().putString(KEY_CALLS, a.toString()).apply()
    }

    fun clearCalls(context: Context) {
        prefs(context).edit().remove(KEY_CALLS).apply()
    }
}
