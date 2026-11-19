package mn.bto.callbridge

import android.Manifest
import android.app.Activity
import android.app.role.RoleManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.text.InputType
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
 * The probe's main screen: is it the default phone app, the «AI хариулах» settings, and the
 * last 20 calls, which the owner sends back with «Илгээх».
 */
class MainActivity : Activity() {
    private lateinit var roleText: TextView
    private lateinit var roleButton: android.widget.Button
    private lateinit var autoSwitch: Switch
    private lateinit var delayField: EditText
    private lateinit var hangupField: EditText
    private lateinit var logList: LinearLayout
    private val refresh: () -> Unit = { renderLog() }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = column()

        roleText = text(sizeSp = 18f, bold = true)
        root.add(roleText)
        roleButton = button(getString(R.string.btn_request_role)) { requestRole() }
        root.add(roleButton)
        root.add(button(getString(R.string.btn_default_apps)) {
            startActivity(Intent(Settings.ACTION_MANAGE_DEFAULT_APPS_SETTINGS))
        })
        root.add(button(getString(R.string.btn_dialpad)) {
            startActivity(Intent(this, DialerActivity::class.java))
        })

        root.add(text(getString(R.string.settings_title), 20f, bold = true))
        val s = ProbeStore.settings(this)
        autoSwitch = Switch(this).apply {
            text = getString(R.string.ai_answer)
            textSize = 18f
            isChecked = s.autoAnswer
            setOnCheckedChangeListener { _, _ -> save(quiet = true) }
        }
        root.add(autoSwitch)
        root.add(text(getString(R.string.answer_delay), 14f))
        delayField = numberField(s.answerDelaySec)
        root.add(delayField)
        root.add(text(getString(R.string.hangup_after), 14f))
        hangupField = numberField(s.hangupAfterSec)
        root.add(hangupField)
        root.add(button(getString(R.string.btn_save)) { save(quiet = false) })

        root.add(text(getString(R.string.log_title), 20f, bold = true))
        val actions = row()
        actions.add(button(getString(R.string.btn_share)) { share() })
        actions.add(button(getString(R.string.btn_clear)) {
            ProbeStore.clearCalls(this)
            renderLog()
        })
        root.add(actions)
        logList = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL }
        root.add(logList)

        setContentView(ScrollView(this).apply { addView(root) })
        askPermissions()
    }

    override fun onResume() {
        super.onResume()
        renderRole()
        renderLog()
        CallTracker.addListener(refresh)
    }

    override fun onPause() {
        CallTracker.removeListener(refresh)
        super.onPause()
    }

    private fun numberField(value: Int) = EditText(this).apply {
        inputType = InputType.TYPE_CLASS_NUMBER
        setText(value.toString())
    }

    private fun save(quiet: Boolean) {
        val s = ProbeSettings(
            autoAnswer = autoSwitch.isChecked,
            answerDelaySec = ProbeSettings.delayOf(delayField.text.toString()),
            hangupAfterSec = ProbeSettings.hangupOf(hangupField.text.toString()),
        )
        ProbeStore.saveSettings(this, s)
        delayField.setText(s.answerDelaySec.toString())
        hangupField.setText(s.hangupAfterSec.toString())
        if (!quiet) Toast.makeText(this, R.string.saved, Toast.LENGTH_SHORT).show()
    }

    // --- The dialer role -------------------------------------------------------------------

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
    }

    private fun requestRole() {
        val rm = roleManager() ?: return
        @Suppress("DEPRECATION")
        startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_DIALER), REQUEST_ROLE)
    }

    @Deprecated("Plain Activity: no AndroidX result API in the probe.")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        @Suppress("DEPRECATION")
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQUEST_ROLE) renderRole()
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
        val calls = ProbeStore.calls(this)
        if (calls.isEmpty()) {
            logList.add(text(getString(R.string.log_empty), 14f))
            return
        }
        calls.forEach { logList.add(text(describe(it), 14f).apply { setPadding(0, dp(8), 0, dp(8)) }) }
    }

    private fun share() {
        val body = buildString {
            val s = ProbeStore.settings(this@MainActivity)
            appendLine("Bto call probe 0.1, ${Build.MANUFACTURER} ${Build.MODEL}, Android ${Build.VERSION.RELEASE} (API ${Build.VERSION.SDK_INT})")
            appendLine("dialer role: ${roleManager()?.isRoleHeld(RoleManager.ROLE_DIALER)}")
            appendLine("settings: auto=${s.autoAnswer} delay=${s.answerDelaySec}s hangup=${s.hangupAfterSec}s")
            appendLine()
            ProbeStore.calls(this@MainActivity).forEach {
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
        val mode = if (r.mode == "auto") "AI" else "гараар"
        appendLine("$time  ${r.number.ifBlank { "-" }}  $way  ($mode)")
        val by = when (r.answeredBy) {
            "probe" -> "AI"
            "user" -> "хүн"
            else -> "үгүй"
        }
        appendLine("Хариулсан: $by; дуугарснаас хариулах хүртэл: ${r.ringToAnswerMs?.let { "$it мс" } ?: "-"}" +
            (r.answerRequestedMs?.let { "; answer() $it мс-д" } ?: ""))
        appendLine("Боломжтой чих: ${r.endpointsAvailable.joinToString(", ").ifBlank { "-" }}")
        appendLine("Ашигласан: ${r.endpointUsed ?: "-"}; шилжүүлэлт: ${r.routeResult ?: "-"}")
        append("Төгсгөл: ${r.ended ?: "(үргэлжилж байна)"}")
        r.talkMs?.let { append("; яриа ${it / 1000} с") }
        r.errors.forEach { append("\nАлдаа: $it") }
    }

    companion object {
        private const val REQUEST_ROLE = 1
        private const val REQUEST_PERMISSIONS = 2
    }
}
