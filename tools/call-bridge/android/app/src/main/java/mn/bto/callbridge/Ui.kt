package mn.bto.callbridge

import android.content.Context
import android.util.TypedValue
import android.view.Gravity
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView

// Plain views built in code: the probe needs no layouts, no AndroidX.

fun Context.dp(value: Int): Int =
    TypedValue.applyDimension(TypedValue.COMPLEX_UNIT_DIP, value.toFloat(), resources.displayMetrics)
        .toInt()

fun Context.column(): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.VERTICAL
    val pad = dp(16)
    setPadding(pad, pad, pad, pad)
}

fun Context.row(): LinearLayout = LinearLayout(this).apply {
    orientation = LinearLayout.HORIZONTAL
    gravity = Gravity.CENTER_VERTICAL
}

fun Context.text(value: CharSequence = "", sizeSp: Float = 16f, bold: Boolean = false): TextView =
    TextView(this).apply {
        text = value
        setTextSize(TypedValue.COMPLEX_UNIT_SP, sizeSp)
        if (bold) setTypeface(typeface, android.graphics.Typeface.BOLD)
        setPadding(0, dp(4), 0, dp(4))
    }

fun Context.button(label: CharSequence, onClick: () -> Unit): Button = Button(this).apply {
    text = label
    isAllCaps = false
    setOnClickListener { onClick() }
}

/** Adds [child] filling the width, or sharing a row's width by [weight]. */
fun ViewGroup.add(child: View, weight: Float = 0f): View {
    val lp = if (this is LinearLayout && orientation == LinearLayout.HORIZONTAL) {
        LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, if (weight > 0) weight else 1f)
    } else {
        LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.WRAP_CONTENT)
    }
    addView(child, lp)
    return child
}
