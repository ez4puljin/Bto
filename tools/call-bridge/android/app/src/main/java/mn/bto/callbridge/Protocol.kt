package mn.bto.callbridge

import org.json.JSONArray
import org.json.JSONException
import org.json.JSONObject

/**
 * Protocol v1 between the phone and the Windows bridge (ADR-0232 stage 3): JSON text frames over
 * a plain WebSocket on the office LAN, the PC the server (`ws://<pc>:8766/phone`), the phone the
 * client. The Windows side (`tools/call-bridge/windows`) speaks the same frames; neither side
 * changes them alone.
 */
object Protocol {
    const val DEFAULT_PORT = 8766
    const val PATH = "/phone"

    /** The PC pings every 5 s; the phone counts the link down after 12 s without one. */
    const val LINK_DEAD_AFTER_MS = 12_000L

    const val ROUTE_BLUETOOTH = "BLUETOOTH"
    const val ROUTE_WIRED_HEADSET = "WIRED_HEADSET"

    /** The routes the PC may ask for in `answer`. */
    val ANSWER_ROUTES = setOf(ROUTE_BLUETOOTH, ROUTE_WIRED_HEADSET)

    /** The endpoint names `route` carries. */
    val ENDPOINTS = setOf(ROUTE_BLUETOOTH, ROUTE_WIRED_HEADSET, "EARPIECE", "SPEAKER")

    const val STATE_ANSWERED = "answered"
    const val STATE_ACTIVE = "active"
    const val STATE_ENDED = "ended"

    const val ERROR_BAD_TOKEN = "BAD_TOKEN"

    // --- PC -> phone ----------------------------------------------------------------------

    sealed class Inbound {
        data class Paired(val token: String) : Inbound()
        object Welcome : Inbound()
        data class Error(val code: String) : Inbound()
        data class Answer(val callRef: String, val route: String) : Inbound()
        data class Ignore(val callRef: String) : Inbound()
        data class Hangup(val callRef: String) : Inbound()
        data class Ping(val id: Long) : Inbound()
        /** A frame of a type this version does not know: skipped (a newer PC may send more). */
        data class Unknown(val type: String) : Inbound()
        /** Not JSON, no type, or a known type with a missing or wrong field. */
        data class Bad(val why: String) : Inbound()
    }

    /** A token shorter than this is refused: the PC promises 32+ random characters. */
    const val MIN_TOKEN_LENGTH = 32

    fun parse(text: String): Inbound {
        val o = try {
            JSONObject(text)
        } catch (e: JSONException) {
            return Inbound.Bad("not a JSON object")
        }
        val type = o.optString("type", "")
        if (type.isEmpty()) return Inbound.Bad("no type")
        return when (type) {
            "paired" -> {
                val token = o.str("token") ?: return Inbound.Bad("paired: no token")
                if (token.length < MIN_TOKEN_LENGTH) Inbound.Bad("paired: token too short")
                else Inbound.Paired(token)
            }
            "welcome" -> Inbound.Welcome
            "error" -> Inbound.Error(o.str("code") ?: "")
            "answer" -> {
                val ref = o.str("callRef") ?: return Inbound.Bad("answer: no callRef")
                val route = o.str("route") ?: return Inbound.Bad("answer: no route")
                if (route !in ANSWER_ROUTES) Inbound.Bad("answer: route $route")
                else Inbound.Answer(ref, route)
            }
            "ignore" -> o.str("callRef")?.let { Inbound.Ignore(it) } ?: Inbound.Bad("ignore: no callRef")
            "hangup" -> o.str("callRef")?.let { Inbound.Hangup(it) } ?: Inbound.Bad("hangup: no callRef")
            "ping" -> {
                val id = o.opt("id")
                if (id is Number) Inbound.Ping(id.toLong()) else Inbound.Bad("ping: no id")
            }
            else -> Inbound.Unknown(type)
        }
    }

    /** A non-empty string field, or null. */
    private fun JSONObject.str(key: String): String? {
        val v = opt(key)
        return if (v is String && v.isNotEmpty()) v else null
    }

    // --- phone -> PC ----------------------------------------------------------------------

    fun pair(code: String, device: String, app: String): String =
        obj("pair").put("code", code).put("device", device).put("app", app).toString()

    fun hello(token: String, device: String, app: String): String =
        obj("hello").put("token", token).put("device", device).put("app", app).toString()

    fun ringing(callRef: String, number: String, at: Long): String =
        obj("ringing").put("callRef", callRef).put("number", number).put("at", at).toString()

    fun state(callRef: String, state: String, cause: String, at: Long): String =
        obj("state").put("callRef", callRef).put("state", state).put("cause", cause).put("at", at)
            .toString()

    fun route(callRef: String, endpoint: String, available: List<String>): String =
        obj("route").put("callRef", callRef).put("endpoint", endpoint)
            .put("available", JSONArray(available)).toString()

    fun pong(id: Long): String = obj("pong").put("id", id).toString()

    private fun obj(type: String) = JSONObject().put("type", type)
}
