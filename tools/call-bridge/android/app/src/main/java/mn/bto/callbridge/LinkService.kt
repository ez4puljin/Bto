package mn.bto.callbridge

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.net.ConnectivityManager
import android.net.Network
import android.net.NetworkCapabilities
import android.net.NetworkRequest
import android.net.wifi.WifiManager
import android.os.Build
import android.os.IBinder

/**
 * The foreground service that keeps [BridgeLink] alive between calls, with the persistent
 * notification «Bto AI шугам: холбогдсон / салсан». Started when the app opens, after a boot
 * and after an update; restarted by the system when killed (START_STICKY). Holds a Wi-Fi lock so
 * the Wi-Fi stays on while the screen is off.
 */
class LinkService : Service() {
    private var wifiLock: WifiManager.WifiLock? = null
    private var netCallback: ConnectivityManager.NetworkCallback? = null
    private var lastText: String? = null
    private val onLink: () -> Unit = { updateNotification() }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        val n = notification()
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                startForeground(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_SPECIAL_USE)
            } else {
                startForeground(NOTIF_ID, n)
            }
        } catch (e: Exception) {
            // Not allowed from here (a background start Android refused): stop; the app's next
            // opening starts it again.
            stopSelf()
            return
        }
        holdWifi()
        watchNetwork()
        BridgeLink.addListener(onLink)
        running = true
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        BridgeLink.start(this)
        updateNotification()
        return START_STICKY
    }

    override fun onDestroy() {
        running = false
        BridgeLink.removeListener(onLink)
        BridgeLink.stop()
        netCallback?.let { cb ->
            runCatching { getSystemService(ConnectivityManager::class.java)?.unregisterNetworkCallback(cb) }
        }
        wifiLock?.let { if (it.isHeld) it.release() }
        super.onDestroy()
    }

    @Suppress("DEPRECATION") // HIGH_PERF still keeps the radio up with the screen off.
    private fun holdWifi() {
        try {
            val wm = applicationContext.getSystemService(WifiManager::class.java) ?: return
            wifiLock = wm.createWifiLock(WifiManager.WIFI_MODE_FULL_HIGH_PERF, "bto:line").apply {
                setReferenceCounted(false)
                acquire()
            }
        } catch (e: Exception) {
            // Without the lock the link may drop in deep sleep; it reconnects when Wi-Fi returns.
        }
    }

    private fun watchNetwork() {
        val cm = getSystemService(ConnectivityManager::class.java) ?: return
        val cb = object : ConnectivityManager.NetworkCallback() {
            override fun onAvailable(network: Network) {
                CallTracker.handler.post { BridgeLink.networkAvailable(network) }
            }

            override fun onCapabilitiesChanged(network: Network, caps: NetworkCapabilities) {
                CallTracker.handler.post { updateNotification() }
            }

            override fun onLost(network: Network) {
                CallTracker.handler.post {
                    BridgeLink.networkLost(network)
                    updateNotification()
                }
            }
        }
        try {
            cm.registerNetworkCallback(
                NetworkRequest.Builder()
                    .addTransportType(NetworkCapabilities.TRANSPORT_WIFI)
                    // The office LAN may have no internet: the PC is still there.
                    .removeCapability(NetworkCapabilities.NET_CAPABILITY_INTERNET)
                    .build(),
                cb,
            )
            netCallback = cb
        } catch (e: Exception) {
            // No callback: the backoff still reconnects.
        }
    }

    private fun updateNotification() {
        val n = notification()
        if (n.extras.getString(Notification.EXTRA_TEXT) == lastText) return
        try {
            getSystemService(NotificationManager::class.java)?.notify(NOTIF_ID, n)
        } catch (e: SecurityException) {
            // Notifications refused: the service still runs.
        }
    }

    private fun notification(): Notification {
        val nm = getSystemService(NotificationManager::class.java)
        if (nm != null && nm.getNotificationChannel(CHANNEL) == null) {
            val channel = NotificationChannel(
                CHANNEL,
                getString(R.string.link_channel),
                NotificationManager.IMPORTANCE_LOW,
            )
            channel.setShowBadge(false)
            nm.createNotificationChannel(channel)
        }
        val open = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val text = statusText(this)
        lastText = text
        return Notification.Builder(this, CHANNEL)
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentTitle(getString(R.string.link_title, text))
            .setContentText(text)
            .setOngoing(true)
            .setContentIntent(open)
            .build()
    }

    companion object {
        private const val CHANNEL = "link"
        private const val NOTIF_ID = 2

        var running = false
            private set

        fun start(context: Context) {
            try {
                context.startForegroundService(Intent(context, LinkService::class.java))
            } catch (e: Exception) {
                // A background start Android refused (after an update, say): the app's next
                // opening or the next boot starts it.
            }
        }

        /** The link's state in short Mongolian, for the notification and the main screen. */
        fun statusText(context: Context): String {
            val id = when (BridgeLink.phase) {
                LinkMachine.Phase.UP -> if (BridgeLink.isUp()) R.string.link_up else R.string.link_down
                LinkMachine.Phase.CONNECTING, LinkMachine.Phase.HELLO -> R.string.link_connecting
                LinkMachine.Phase.PAIRING -> R.string.link_pairing
                LinkMachine.Phase.NEED_PAIR -> R.string.link_need_pair
                LinkMachine.Phase.NEED_CODE -> R.string.link_need_code
                LinkMachine.Phase.UNPAIRED -> R.string.link_unpaired
                LinkMachine.Phase.RETRY -> R.string.link_down
            }
            val base = context.getString(id)
            return if (!onWifi(context)) "$base · ${context.getString(R.string.no_wifi)}" else base
        }

        /** Is the phone on a Wi-Fi network now (the PC is reached only over the office LAN)? */
        @Suppress("DEPRECATION") // allNetworks: the Wi-Fi may be up but not the default network.
        fun onWifi(context: Context): Boolean {
            val cm = context.getSystemService(ConnectivityManager::class.java) ?: return false
            return try {
                cm.allNetworks.any {
                    cm.getNetworkCapabilities(it)?.hasTransport(NetworkCapabilities.TRANSPORT_WIFI) == true
                }
            } catch (e: Exception) {
                false
            }
        }
    }
}

/** Starts the link after a boot and after the app is updated. */
class StartReceiver : BroadcastReceiver() {
    override fun onReceive(context: Context, intent: Intent) {
        when (intent.action) {
            Intent.ACTION_BOOT_COMPLETED, Intent.ACTION_MY_PACKAGE_REPLACED -> LinkService.start(context)
        }
    }
}
