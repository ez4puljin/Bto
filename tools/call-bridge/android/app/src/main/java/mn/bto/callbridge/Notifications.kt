package mn.bto.callbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.telecom.Call

/**
 * The call's notification. An incoming call the probe does not take opens the in-call screen
 * full screen (also over the lock screen); the ringtone itself is the phone's (Telecom).
 */
object Notifications {
    private const val CHANNEL = "calls"
    private const val ID = 1

    fun show(context: Context, t: Tracked, fullScreen: Boolean) {
        val nm = context.getSystemService(NotificationManager::class.java) ?: return
        if (nm.getNotificationChannel(CHANNEL) == null) {
            val channel = NotificationChannel(
                CHANNEL,
                context.getString(R.string.notif_channel),
                NotificationManager.IMPORTANCE_HIGH,
            )
            channel.setSound(null, null)
            nm.createNotificationChannel(channel)
        }
        val open = PendingIntent.getActivity(
            context,
            0,
            Intent(context, InCallActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val title = when {
            t.record.mode == "auto" -> R.string.notif_ai
            stateOf(t.call) == Call.STATE_RINGING -> R.string.notif_incoming
            else -> R.string.notif_ongoing
        }
        val builder = Notification.Builder(context, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(context.getString(title))
            .setContentText(t.record.number.ifBlank { context.getString(R.string.unknown_number) })
            .setCategory(Notification.CATEGORY_CALL)
            .setOngoing(true)
            .setContentIntent(open)
        if (fullScreen) builder.setFullScreenIntent(open, true)
        try {
            nm.notify(ID, builder.build())
        } catch (e: SecurityException) {
            // Notifications refused: the in-call screen still opens from the service.
        }
    }

    fun cancel(context: Context) {
        context.getSystemService(NotificationManager::class.java)?.cancel(ID)
    }
}
