#!/usr/bin/env bash
# Connects the watchman (watch.sh, ADR-0195) to the owner's Telegram. The owner runs it on the PC:
#
#   bash deploy/store/alerts-setup.sh
#
# It asks for the token of the owner's own bot (made with @BotFather; typed hidden, never
# printed), finds the chat of the person who then writes to the bot, keeps both in
# deploy/store/.env and sends one test message. Run again to change the bot or the chat.
set -euo pipefail
# shellcheck source=deploy/store/lib.sh
. "$(dirname "$0")/lib.sh"

if [ ! -t 0 ]; then echo "Терминал дээр өөрөө ажиллуулна уу (нууц утга асууна)." >&2; exit 1; fi
if [ ! -f "$STORE_ENV" ]; then echo "$STORE_ENV алга: эхлээд bash deploy/store/setup.sh" >&2; exit 1; fi

# A call to the bot's API with the token on curl's standard input, never on a command line.
telegram() {
  local method=$1
  shift
  curl -sS -m 20 --config - "$@" <<CONFIG
url = "https://api.telegram.org/bot${TOKEN}/${method}"
CONFIG
}

set_setting() {
  local name=$1 value=$2 tmp
  tmp=$(mktemp "$STORE_ENV.XXXXXX")
  grep -v "^${name}=" "$STORE_ENV" >"$tmp" || true
  printf '%s=%s\n' "$name" "$value" >>"$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$STORE_ENV"
}

cat <<'TEXT'
Утас руу сэрэмжлүүлэг тохируулна. Эхлээд Telegram дээр өөрийн бот үүсгэнэ:
  1. Telegram-д @BotFather гэж хайж нээнэ.
  2. /newbot гэж бичээд, ботын нэр (жишээ нь: Bto харуул) болон хэрэглэгчийн нэр
     (жишээ нь: bto_haruul_bot) өгнө.
  3. BotFather «token» гэсэн урт мөр өгнө. Түүнийг хуулна.
TEXT
read -rsp "Ботын token (бичихэд дэлгэцэд харагдахгүй): " TOKEN
echo
case "$TOKEN" in
  *[!0-9A-Za-z:_-]* | "") echo "Token буруу хэлбэртэй байна." >&2; exit 1 ;;
esac

ME=$(telegram getMe 2>/dev/null || true)
case "$ME" in
  *'"ok":true'*) ;;
  *) echo "Telegram энэ token-ийг хүлээн авсангүй (эсвэл интернэт алга)." >&2; exit 1 ;;
esac
echo "Бот олдлоо: @$(printf '%s' "$ME" | grep -o '"username":"[^"]*"' | head -n 1 | cut -d'"' -f4)"

echo
echo "Одоо сэрэмжлүүлэг авах утаснаасаа энэ бот руу дурын үг бичээд (жишээ нь: сайн уу),"
read -rp "дараа нь энд Enter дарна уу. " _
UPDATES=$(telegram getUpdates 2>/dev/null || true)
CHAT=$(printf '%s' "$UPDATES" | grep -o '"chat":{"id":-\{0,1\}[0-9]*' | tail -n 1 | grep -o -- '-\{0,1\}[0-9]*$' || true)
if [ -z "$CHAT" ]; then
  echo "Бот руу бичсэн мессеж олдсонгүй. Бот руу бичээд дахин ажиллуулна уу." >&2
  exit 1
fi
WHO=$(printf '%s' "$UPDATES" | grep -o '"first_name":"[^"]*"' | tail -n 1 | cut -d'"' -f4 || true)
# Telegram writes Cyrillic as \uXXXX: printf %b turns it back.
printf 'Чат олдлоо: %b (дугаар %s).\n' "${WHO:-?}" "$CHAT"
read -rp "Сэрэмжлүүлгийг энэ чат руу илгээх үү? [y/N] " ANSWER
case "$ANSWER" in y | Y | yes | т | Т | тийм) ;; *) echo "Болилоо, юу ч хадгалсангүй."; exit 0 ;; esac

set_setting STORE_ALERT_TELEGRAM_TOKEN "$TOKEN"
set_setting STORE_ALERT_TELEGRAM_CHAT "$CHAT"
unset TOKEN
echo "Хадгаллаа ($STORE_ENV). Туршилтын мэдэгдэл илгээж байна…"
bash "$(dirname "$0")/watch.sh" --test
echo "Утсан дээрээ мэдэгдэл ирснийг шалгана уу."
echo "Минут тутмын харуул суугаагүй бол:  bash deploy/store/install-watch-timer.sh"
