package mn.bto.callbridge

import android.Manifest
import android.app.Activity
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Bundle
import android.telecom.TelecomManager
import android.text.InputType
import android.view.Gravity
import android.widget.EditText
import android.widget.Toast

/**
 * The dialpad: the dialer role needs one (ACTION_DIAL, with and without tel:), and it keeps the
 * phone usable as a phone while the probe is its default phone app. Calls go out through
 * TelecomManager.placeCall; the in-call screen then follows them.
 */
class DialerActivity : Activity() {
    private lateinit var number: EditText

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val root = column()
        number = EditText(this).apply {
            inputType = InputType.TYPE_CLASS_PHONE
            textSize = 28f
            gravity = Gravity.CENTER
            setText(numberFrom(intent?.data))
        }
        root.add(number)
        listOf("123", "456", "789", "*0#").forEach { keys ->
            val r = row()
            keys.forEach { key -> r.add(button(key.toString()) { number.append(key.toString()) }) }
            root.add(r)
        }
        val last = row()
        last.add(button(getString(R.string.btn_backspace)) {
            val t = number.text
            if (t.isNotEmpty()) t.delete(t.length - 1, t.length)
        })
        last.add(button(getString(R.string.btn_call)) { placeCall() }, 2f)
        root.add(last)
        setContentView(root)
    }

    override fun onNewIntent(intent: android.content.Intent) {
        super.onNewIntent(intent)
        numberFrom(intent.data).takeIf { it.isNotEmpty() }?.let { number.setText(it) }
    }

    private fun numberFrom(data: Uri?): String =
        if (data?.scheme == "tel") data.schemeSpecificPart.orEmpty() else ""

    private fun placeCall() {
        val n = number.text.toString().trim()
        if (n.isEmpty()) {
            Toast.makeText(this, R.string.no_number, Toast.LENGTH_SHORT).show()
            return
        }
        if (checkSelfPermission(Manifest.permission.CALL_PHONE) != PackageManager.PERMISSION_GRANTED) {
            Toast.makeText(this, R.string.need_call_permission, Toast.LENGTH_SHORT).show()
            requestPermissions(arrayOf(Manifest.permission.CALL_PHONE), 1)
            return
        }
        try {
            getSystemService(TelecomManager::class.java).placeCall(Uri.fromParts("tel", n, null), Bundle())
        } catch (e: Exception) {
            Toast.makeText(this, getString(R.string.call_failed, e.message ?: e.toString()), Toast.LENGTH_LONG).show()
        }
    }

    override fun onRequestPermissionsResult(requestCode: Int, permissions: Array<out String>, grantResults: IntArray) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        if (grantResults.firstOrNull() == PackageManager.PERMISSION_GRANTED) placeCall()
    }
}
