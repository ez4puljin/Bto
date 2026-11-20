package mn.bto.callbridge

import android.Manifest
import android.annotation.SuppressLint
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.text.InputType
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.Switch
import android.widget.TextView
import android.widget.Toast
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

/**
 * The main screen: the link to the PC (status, address, «Компьютер холбох» with the code, the
 * link log), «AI хариулах» and the fallback seconds, the default-phone-app role, and the last 20
 * calls, which the owner sends back with «Илгээх».
 */
class MainActivity : Activity() {
    private lateinit var linkText: TextView
    private lateinit var wifiText: TextView
    private lateinit var linkLogText: TextView
    private lateinit var addressField: EditText
    private lateinit var codeField: EditText
    private lateinit var aiSwitch: Switch
    private lateinit var fallbackField: EditText
    private lateinit var roleText: TextView
    private lateinit var roleButton: Button
    private lateinit var batteryButton: Button
    private lateinit var logList: LinearLayout
    private val refreshLog: () -> Unit = { renderLog() }
    private val refreshLink: () -> Unit = { renderLink() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = column()

        // The link to the PC.
        linkText = text(sizeSp = 20f, bold = true)
        root.add(linkText)
        wifiText = text(getString(R.string.no_wifi_long), 14f, bold = true).apply {
            setTextColor(0xFFD32F2F.toInt())
        }
        root.add(wifiText)
        root.add(text(getString(R.string.pc_address), 14f))
        addressField = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_URI
            hint = getString(R.string.pc_address_hint)
            setText(LineStore.address(this@MainActivity)?.text.orEmpty())
        }
        root.add(addressField)
        root.add(text(getString(R.string.pair_code), 14f))
        codeField = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER
            hint = getString(R.string.pair_code_hint)
        }
        root.add(codeField)
        root.add(button(getString(R.string.btn_pair)) { pair() })
        root.add(text(getString(R.string.link_log_title), 14f, bold = true))
        linkLogText = text(sizeSp = 12f)
        root.add(linkLogText)

        // The AI.
        root.add(text(getString(R.string.settings_title), 20f, bold = true))
        val s = LineStore.settings(this)
        aiSwitch = Switch(this).apply {
            text = getString(R.string.ai_answer)
            textSize = 18f
            isChecked = s.aiAnswer
            setOnCheckedChangeListener { _, _ -> save(quiet = true) }
        }
        root.add(aiSwitch)
        root.add(text(getString(R.string.fallback_secs), 14f))
        fallbackField = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_FLAG_DECIMAL
            setText(LineSettings.secondsText(s.fallbackMs))
        }
        root.add(fallbackField)
        root.add(button(getString(R.string.btn_save)) { save(quiet = false) })

        // The phone itself.
        roleText = text(sizeSp = 16f, bold = true)
        root.add(roleText)
        roleButton = button(getString(R.string.btn_request_role)) { requestRole() }
        root.add(roleButton)
        batteryButton = button(getString(R.string.btn_battery)) { askBatteryExemption() }
        root.add(batteryButton)
        root.add(button(getString(R.string.btn_default_apps)) {
            startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
        })
        root.add(button(getString(R.string.btn_dialpad)) {
            startActivity(Intent(this, DialerActivity::class.java))
        })

        // The calls.
        root.add(text(getString(R.string.log_title), 20f, bold = true))
        val actions = row()
        actions.add(button(getString(R.string.btn_share)) { share() })
        actions.add(button(getString(R.string.btn_clear)) {
            LineStore.clearCalls(this)
            renderLog()
        })
        root.add(actions)
        logList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.add(logList)

        setContentView(ScrollView(this).apply { addView(root) })
        askPermissions()
        LinkService.start(this)
        if (!batteryExempt()) askBatteryExemption()
    }

    override fun onResume() {
        super.onResume()
        LinkService.start(this)
        renderLink()
        renderRole()
        renderLog()
        CallTracker.addListener(refreshLog)
        BridgeLink.addListener(refreshLink)
    }

    override fun onPause() {
        CallTracker.removeListener(refreshLog)
        BridgeLink.removeListener(refreshLink)
        super.onPause()
    }

    private fun save(quiet: Boolean) {
        val s = LineSettings(
            aiAnswer = aiSwitch.isChecked,
            fallbackMs = LineSettings.fallbackOf(fallbackField.text.toString()),
        )
        LineStore.saveSettings(this, s)
        fallbackField.setText(LineSettings.secondsText(s.fallbackMs))
        if (!quiet) Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show()
    }

    // --- The link ----------------------------------------------------------------------------

    private fun pair() {
        val address = PcAddress.parse(addressField.text.toString())
        if (address == null) {
            Toast.makeText(this, R.string.bad_address, Toast.LENGTH_SHORT).show()
            return
        }
        val code = Pairing.normalizeCode(codeField.text.toString())
        if (code == null) {
            Toast.makeText(this, R.string.bad_code, Toast.LENGTH_SHORT).show()
            return
        }
        addressField.setText(address.text)
        codeField.setText("")
        LinkService.start(this)
        BridgeLink.pair(this, address, code)
        renderLink()
    }

    private fun renderLink() {
        val status = LinkService.statusText(this)
        val where = BridgeLink.address?.text
        val error = BridgeLink.lastError?.let { " ($it)" }.orEmpty()
        linkText.text = getString(R.string.link_line, status + error) + (where?.let { "\n$it" } ?: "")
        wifiText.visibility = if (LinkService.onWifi(this)) android.view.View.GONE else android.view.View.VISIBLE
        linkLogText.text = LineStore.linkLog(this).take(LINK_LOG_SHOWN).joinToString("\n").ifEmpty { "-" }
    }

    // --- The dialer role and the battery ----------------------------------------------------

    private fun roleManager(): RoleManager? = getSystemService(RoleManager::class.java)

    private fun renderRole() {
        val rm = roleManager()
        when {
            rm == null || !rm.isRoleAvailable(RoleManager.ROLE_DIALER) -> {
                roleText.setText(R.string.role_unavailable)
                roleButton.isEnabled = false
            }
            rm.isRoleHeld(RoleManager.ROLE_DIALER) -> {
                roleText.setText(R.string.role_held)
                roleButton.isEnabled = false
            }
            else -> {
                roleText.setText(R.string.role_not_held)
                roleButton.isEnabled = true
            }
        }
        batteryButton.visibility =
            if (batteryExempt()) android.view.View.GONE else android.view.View.VISIBLE
    }

    private fun requestRole() {
        val rm = roleManager() ?: return
        @Suppress("DEPRECATION")
        startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_DIALER), REQUEST_ROLE)
    }

    @Deprecated("Plain Activity: no AndroidX result API.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_ROLE) renderRole()
    }

    private fun batteryExempt(): Boolean =
        getSystemService(PowerManager::class.java)?.isIgnoringBatteryOptimizations(packageName) == true

    /** The line must stay connected while the phone sleeps: the owner allows it once. */
    @SuppressLint("BatteryLife")
    private fun askBatteryExemption() {
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS)
                    .setData(Uri.parse("package:$packageName")),
            )
        } catch (e: Exception) {
            runCatching { startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS)) }
        }
    }

    private fun askPermissions() {
        val wanted = mutableListOf(Manifest.permission.CALL_PHONE)
        if (Build.VERSION.SDK_INT >= 33) wanted.add(Manifest.permission.POST_NOTIFICATIONS)
        val missing = wanted.filter { checkSelfPermission(it) != PackageManager.PERMISSION_GRANTED }
        if (missing.isNotEmpty()) requestPermissions(missing.toTypedArray(), REQUEST_PERMISSIONS)
    }

    // --- The call list ---------------------------------------------------------------------

    private fun renderLog() {
        logList.removeAllViews()
        val calls = LineStore.calls(this)
        if (calls.isEmpty()) {
            logList.add(text(getString(R.string.log_empty), 14f))
            return
        }
        calls.forEach { logList.add(text(describe(it), 14f).apply { setPadding(0, dp(8), 0, dp(8)) }) }
    }

    private fun share() {
        val body = buildString {
            val s = LineStore.settings(this@MainActivity)
            appendLine("Bto дуудлага ${BuildConfig.VERSION_NAME}, ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("dialer role: ${roleManager()?.isRoleHeld(RoleManager.ROLE_DIALER)}; battery exempt: ${batteryExempt()}; wifi: ${LinkService.onWifi(this@MainActivity)}")
            appendLine("link: ${BridgeLink.phase} up=${BridgeLink.isUp()} pc=${BridgeLink.address?.text ?: "-"} error=${BridgeLink.lastError ?: "-"} lastDrop=${BridgeLink.lastDrop ?: "-"}")
            appendLine("settings: ai=${s.aiAnswer} fallback=${s.fallbackMs}ms")
            appendLine()
            appendLine("link log (newest first):")
            LineStore.linkLog(this@MainActivity).forEach { appendLine(it) }
            appendLine()
            LineStore.calls(this@MainActivity).forEach {
                appendLine(describe(it))
                appendLine()
            }
        }
        val send = Intent(Intent.ACTION_SEND).apply {
            type = "text/plain"
            putExtra(Intent.EXTRA_TEXT, body)
        }
        startActivity(Intent.createChooser(send, getString(R.string.share_title)))
    }

    /**
     * One call as text: Mongolian labels, the phone's own values (endpoints, causes, errors) as
     * the phone gave them, since the developer reads them.
     */
    private fun describe(r: CallRecord): String = buildString {
        val time = SimpleDateFormat("yyyy-MM-dd HH:mm:ss", Locale.US).format(Date(r.startedAt))
        val way = if (r.incoming) "ирсэн" else "гарсан"
        val mode = when (r.mode) {
            "ai" -> "PC-ээс асуусан"
            "auto" -> "AI (туршилт)"
            else -> "гараар"
        }
        appendLine("$time  ${r.number.ifBlank { "-" }}  $way  ($mode)")
        if (r.incoming && r.linkUpAtRing != null) {
            appendLine("Дуугарахад PC: ${if (r.linkUpAtRing == true) "холбогдсон" else "салсан"}" +
                "; PC хэлсэн: ${r.pcSaid ?: "-"}" + (r.pcReplyMs?.let { ", $it мс" } ?: ""))
        }
        r.fallback?.let { appendLine("Ажилтанд дуугарсан: $it") }
        val by = when (r.answeredBy) {
            "ai", "probe" -> "AI"
            "user" -> "хүн"
            else -> "үгүй"
        }
        appendLine("Хариулсан: $by; дуугарснаас хариулах хүртэл: ${r.ringToAnswerMs?.let { "$it мс" } ?: "-"}" +
            (r.answerRequestedMs?.let { "; answer() $it мс-д" } ?: ""))
        appendLine("Боломжтой чих: ${r.endpointsAvailable.joinToString(", ").ifBlank { "-" }}")
        appendLine("PC хүссэн: ${r.routeAsked ?: "-"}; ашигласан: ${r.endpointUsed ?: "-"}; шилжүүлэлт: ${r.routeResult ?: "-"}")
        // Who ended it: the PC, a person on this phone, or (neither) the caller or the network,
        // which the cause tells (REMOTE: the caller).
        val who = when (r.endedBy) {
            "pc" -> "PC — "
            "user" -> "хүн — "
            else -> ""
        }
        append("Төгсгөл: ${r.ended?.let { "$who$it" } ?: "(үргэлжилж байна)"}")
        r.talkMs?.let { append("; яриа ${it / 1000} с") }
        r.errors.forEach { append("\nАлдаа: $it") }
    }

    companion object {
        private const val REQUEST_ROLE = 1
        private const val REQUEST_PERMISSIONS = 2
        private const val LINK_LOG_SHOWN = 5
    }
}
