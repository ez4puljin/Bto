package mn.bto.callbridge

import android.content.Context
import org.json.JSONArray
import org.json.JSONObject

/**
 * One call as the phone saw it: the evidence the owner sends back. Times are wall-clock
 * milliseconds for [startedAt] and elapsed milliseconds from the first ring for the rest.
 */
class CallRecord(
    val id: String,
    val startedAt: Long,
    val number: String,
    val incoming: Boolean,
) {
    /** "ai" when the PC was asked about it, "manual" otherwise ("auto" in the probe's records). */
    var mode: String = "manual"
    /** The protocol's callRef, null for calls the PC never heard of. */
    var callRef: String? = null
    /** Was the link to the PC up when it started to ring (incoming calls only). */
    var linkUpAtRing: Boolean? = null
    /** What the PC said ("answer BLUETOOTH", "ignore", "late answer …") or null. */
    var pcSaid: String? = null
    /** Elapsed ms from the ring to the PC's answer or ignore. */
    var pcReplyMs: Long? = null
    /** Why it rang for staff, when it did: RingDecision.Reason's text. */
    var fallback: String? = null
    /** The route the PC asked for. */
    var routeAsked: String? = null
    var answerRequestedMs: Long? = null
    var ringToAnswerMs: Long? = null
    /** "ai" ("probe" in old records), "user" or null (not answered). */
    var answeredBy: String? = null
    val endpointsAvailable: MutableList<String> = mutableListOf()
    var endpointUsed: String? = null
    var routeResult: String? = null
    var ended: String? = null
    /** Who ended it: "pc" (hangup), "user" (a button), or null (the caller or the network). */
    var endedBy: String? = null
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
        put("callRef", callRef ?: JSONObject.NULL)
        put("linkUpAtRing", linkUpAtRing ?: JSONObject.NULL)
        put("pcSaid", pcSaid ?: JSONObject.NULL)
        put("pcReplyMs", pcReplyMs ?: JSONObject.NULL)
        put("fallback", fallback ?: JSONObject.NULL)
        put("routeAsked", routeAsked ?: JSONObject.NULL)
        put("endedBy", endedBy ?: JSONObject.NULL)
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
                callRef = o.stringOrNull("callRef")
                linkUpAtRing = if (o.isNull("linkUpAtRing")) null else o.optBoolean("linkUpAtRing")
                pcSaid = o.stringOrNull("pcSaid")
                pcReplyMs = o.longOrNull("pcReplyMs")
                fallback = o.stringOrNull("fallback")
                routeAsked = o.stringOrNull("routeAsked")
                endedBy = o.stringOrNull("endedBy")
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

/**
 * The settings, the PC's address and token, and the last calls, in the app's own
 * SharedPreferences (the probe's file, so its call list survives the update). Nothing leaves the
 * phone except what the owner shares; `allowBackup` is off, so the token is not backed up.
 */
object LineStore {
    private const val PREFS = "probe"
    private const val KEY_AI = "autoAnswer"
    private const val KEY_FALLBACK = "fallbackMs"
    private const val KEY_HOST = "pcHost"
    private const val KEY_PORT = "pcPort"
    private const val KEY_TOKEN = "pcToken"
    private const val KEY_CALLS = "calls"
    private const val KEY_LINK_LOG = "linkLog"
    private const val LINK_LOG_SIZE = 40

    private fun prefs(context: Context) =
        context.applicationContext.getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    fun settings(context: Context): LineSettings {
        val p = prefs(context)
        return LineSettings(
            aiAnswer = p.getBoolean(KEY_AI, false),
            fallbackMs = p.getInt(KEY_FALLBACK, LineSettings.DEFAULT_FALLBACK_MS)
                .coerceIn(LineSettings.MIN_FALLBACK_MS, LineSettings.MAX_FALLBACK_MS),
        )
    }

    fun saveSettings(context: Context, s: LineSettings) {
        prefs(context).edit()
            .putBoolean(KEY_AI, s.aiAnswer)
            .putInt(KEY_FALLBACK, s.fallbackMs)
            .apply()
    }

    fun address(context: Context): PcAddress? {
        val p = prefs(context)
        val host = p.getString(KEY_HOST, null) ?: return null
        return PcAddress(host, p.getInt(KEY_PORT, Protocol.DEFAULT_PORT))
    }

    fun token(context: Context): String? = prefs(context).getString(KEY_TOKEN, null)

    /**
     * The address and token as the link machine now holds them (null removes), written to disk
     * before it returns: a token the PC gave is the only way back after a drop or a restart.
     * False: the write failed.
     */
    fun saveLink(context: Context, address: PcAddress?, token: String?): Boolean {
        val e = prefs(context).edit()
        if (address == null) e.remove(KEY_HOST).remove(KEY_PORT)
        else e.putString(KEY_HOST, address.host).putInt(KEY_PORT, address.port)
        if (token == null) e.remove(KEY_TOKEN) else e.putString(KEY_TOKEN, token)
        return e.commit()
    }

    /** The link's last events, newest first: «HH:mm:ss text». Never a token or a code. */
    fun linkLog(context: Context): List<String> {
        val raw = prefs(context).getString(KEY_LINK_LOG, null) ?: return emptyList()
        return try {
            val a = JSONArray(raw)
            (0 until a.length()).map { a.getString(it) }
        } catch (e: Exception) {
            emptyList()
        }
    }

    fun addLinkEvent(context: Context, line: String) {
        val next = (listOf(line) + linkLog(context)).take(LINK_LOG_SIZE)
        prefs(context).edit().putString(KEY_LINK_LOG, JSONArray(next).toString()).apply()
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
        val next = LineRules.upsertNewestFirst(calls(context), record) { it.id }
        val a = JSONArray()
        next.forEach { a.put(it.toJson()) }
        prefs(context).edit().putString(KEY_CALLS, a.toString()).apply()
    }

    fun clearCalls(context: Context) {
        prefs(context).edit().remove(KEY_CALLS).apply()
    }
}
