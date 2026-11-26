package com.gchopro.gateway

data class SegmentCount(
    val encoding: String,
    val units: Int,
    val segments: Int,
    val perSegment: Int,
    val remainingInSegment: Int,
)

private val basic = setOf(
    "@", "£", "$", "¥", "è", "é", "ù", "ì", "ò", "Ç", "\n", "Ø", "ø", "\r", "Å", "å",
    "Δ", "_", "Φ", "Γ", "Λ", "Ω", "Π", "Ψ", "Σ", "Θ", "Ξ", "\u001b", "Æ", "æ", "ß", "É",
    " ", "!", "\"", "#", "¤", "%", "&", "'", "(", ")", "*", "+", ",", "-", ".", "/",
    "0", "1", "2", "3", "4", "5", "6", "7", "8", "9", ":", ";", "<", "=", ">", "?",
    "¡", "A", "B", "C", "D", "E", "F", "G", "H", "I", "J", "K", "L", "M", "N", "O",
    "P", "Q", "R", "S", "T", "U", "V", "W", "X", "Y", "Z", "Ä", "Ö", "Ñ", "Ü", "§",
    "¿", "a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k", "l", "m", "n", "o",
    "p", "q", "r", "s", "t", "u", "v", "w", "x", "y", "z", "ä", "ö", "ñ", "ü", "à",
)

private val extension = setOf("^", "{", "}", "\\", "[", "~", "]", "|", "€", "\u000c")

fun gsmBasicSize(): Int = basic.size

fun countSegments(text: String): SegmentCount {
    val gsm = mutableListOf<Int>()
    for (char in text) {
        val value = char.toString()
        when {
            basic.contains(value) -> gsm.add(1)
            extension.contains(value) -> gsm.add(2)
            else -> return ucs2(text)
        }
    }
    val units = gsm.sum()
    if (units <= 160) return SegmentCount("gsm7", units, 1, 160, 160 - units)
    val walked = walk(gsm, 153)
    return SegmentCount("gsm7", units, walked.first, 153, walked.second)
}

private fun ucs2(text: String): SegmentCount {
    val costs = mutableListOf<Int>()
    var index = 0
    while (index < text.length) {
        val code = text[index].code
        val next = if (index + 1 < text.length) text[index + 1].code else 0
        if (code in 0xD800..0xDBFF && next in 0xDC00..0xDFFF) {
            costs.add(2)
            index += 2
        } else {
            costs.add(1)
            index += 1
        }
    }
    val units = costs.sum()
    if (units <= 70) return SegmentCount("ucs2", units, 1, 70, 70 - units)
    val walked = walk(costs, 67)
    return SegmentCount("ucs2", units, walked.first, 67, walked.second)
}

private fun walk(costs: List<Int>, budgetSize: Int): Pair<Int, Int> {
    if (costs.isEmpty()) return 1 to budgetSize
    var segments = 1
    var budget = budgetSize
    for (cost in costs) {
        if (cost > budget) {
            segments += 1
            budget = budgetSize
        }
        budget -= cost
    }
    return segments to budget
}
