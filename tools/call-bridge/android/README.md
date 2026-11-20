# «Bto дуудлага»: the Android side of the call bridge

Stage 3 of ADR-0232: the phone of the AI order line. Package `mn.bto.callbridge`, version 0.2.0
(versionCode 2), Kotlin, plain Android views, no AndroidX; OkHttp 4.12.0 for the WebSocket. minSdk
29 (RoleManager), compileSdk/targetSdk 36. It replaces the stage-0 probe (0.1) in place.

What it does: it is the phone's default phone app (dialer role, dialpad, in-call screen, so the
phone stays a normal phone). A foreground service keeps a WebSocket to the Windows bridge
(`../windows`) on the office LAN. An incoming call is reported to the PC; the PC says `answer` or
`ignore` within the fallback time (3 s, 1.5–5 s on the main screen); on `answer` the phone answers
and moves the call's audio to Bluetooth (Windows Phone Link: the PC is the phone's Bluetooth
headset) or a wired headset. Otherwise the phone rings normally for staff.

## Protocol v1

JSON text frames over a plain WebSocket, the PC the server on port 8766, path `/phone`; the phone
the client. The Windows side speaks the same frames; neither side changes them alone.

| Direction | Frame |
|---|---|
| phone → PC | `{"type":"pair","code":"123456","device":"<model>","app":"0.2.0"}` once, with the code the PC shows |
| PC → phone | `{"type":"paired","token":"<32+ chars>"}` (kept on the phone) or `{"type":"error","code":…}` |
| phone → PC | `{"type":"hello","token":…,"device":…,"app":…}` on every later connection |
| PC → phone | `{"type":"welcome"}` or `{"type":"error","code":"BAD_TOKEN"}` (the phone drops the token and shows «Дахин холбох») |
| PC → phone | `{"type":"ping","id":n}` every 5 s; the phone answers `{"type":"pong","id":n}` and counts the link down after 12 s without a ping |
| phone → PC | `{"type":"ringing","callRef":"<uuid>","number":"<as the phone shows it, '' if hidden>","at":<epoch ms>}` |
| PC → phone | `{"type":"answer","callRef":…,"route":"BLUETOOTH\|WIRED_HEADSET"}`, `{"type":"ignore","callRef":…}`, `{"type":"hangup","callRef":…}` |
| phone → PC | `{"type":"state","callRef":…,"state":"answered\|active\|ended","cause":"<DisconnectCause name or ''>","at":…}` |
| phone → PC | `{"type":"route","callRef":…,"endpoint":"BLUETOOTH\|WIRED_HEADSET\|EARPIECE\|SPEAKER","available":[…]}` |

How the phone uses them:

- `paired` puts the link up at once (the phone does not wait for a `welcome` after pairing).
- Any `error` while pairing (a wrong or old code) or `BAD_TOKEN` after `hello` stops the
  reconnects until the owner enters a new code. Other errors close the socket and it reconnects
  (1, 2, 4, 8, 16, then every 30 s; at once when the Wi-Fi comes back).
- `state answered` is sent when the phone carries out the PC's `answer`; `active` when any call the
  PC was told of connects (an `active` without `answered` means a person took it); `ended` with the
  cause's name (`REMOTE` = the caller hung up, `LOCAL` = this phone).
- `route` is sent when the call connects and on every change of endpoint, for calls the PC was
  told of; only the four names above are reported.

Safety (ADR-0232 and the owner, 2026-11-20): the phone never answers when «AI хариулах» is off,
the link is down, or another call is in progress; then it sends no `ringing` and rings at once.
It rings normally when the PC says `ignore`, is silent past the fallback time, or the link drops
while it waits; a late `answer` is ignored and written in the log. It answers only when the
endpoint the PC asked for is there at that moment: the AI never talks into the earpiece (without
Bluetooth it sends a `route` frame and rings for staff). After answering it asks for the endpoint
(`requestCallEndpointChange` on API 34+, `setAudioRoute` below), and asks once more if the system
moves the audio back to the earpiece. `hangup` disconnects the call.

## Files

| File | What |
|---|---|
| `Protocol.kt` | the frames: parsing what the PC sends, building what the phone sends |
| `RingDecision.kt` | one incoming call's decision: wait for the PC, answer, or ring normally (the fallback timer's rules) |
| `Pairing.kt` | the PC's address, the code, the backoff, and `LinkMachine`, the link's state without sockets |
| `BridgeLink.kt` | the WebSocket (OkHttp), bound to the Wi-Fi network, driven by `LinkMachine` |
| `LinkService.kt` | the foreground service with «Bto AI шугам: холбогдсон / салсан», the Wi-Fi lock, the start on boot and after an update |
| `LineInCallService.kt` | the InCallService Telecom binds: reports calls, answers, routes, hangs up, writes the call record |
| `MainActivity.kt` | status, PC address and «Холбох», «AI хариулах», fallback seconds, the dialer role, the battery exemption, the last 20 calls, «Илгээх» |
| `InCallActivity.kt`, `DialerActivity.kt` | the in-call screen and the dialpad (from the probe) |
| `LineRules.kt`, `LineStore.kt` | pure rules (settings, endpoints, names) / settings, the PC's address and token, the call list in SharedPreferences |

The JVM unit tests (`app/src/test`) cover the protocol, the decision and its timer, the pairing
state and the rules. The phone keeps its data in the probe's SharedPreferences file, so the
probe's call list stays after the update; `allowBackup` is off, the token is not backed up.

## Build (the Ubuntu PC)

Built by hand, not by the job desk (`pnpm mobile:apk` and `tools/brain/job.sh` are the staff
app's and «Bto300»'s). It uses the staff app's Gradle (9.3.1), Android Gradle Plugin (8.12.0) and
Kotlin (2.1.20) from the Gradle home the staff app's build fills (`~/Android/gradle`), and builds
offline: OkHttp 4.12.0 and Okio 3.6.0 are in that cache under the Gradle Plugin Portal (hence that
repository, limited to those two groups, in `build.gradle.kts`).

```sh
cd tools/call-bridge/android
export ANDROID_HOME=~/Android/Sdk GRADLE_USER_HOME=~/Android/gradle   # JDK 17 on the PATH
nice -n 15 ./gradlew --no-daemon --offline assembleDebug testDebugUnitTest lintDebug
mkdir -p ../../../out && cp app/build/outputs/apk/debug/app-debug.apk ../../../out/bto-call-bridge.apk
```

The APK is signed with the PC's Android debug key (`~/.android/debug.keystore`, made by the
probe's first build on 2026-11-20), the same key as the probe's, so it installs over the probe
without uninstalling. Neither the APK nor any key is ever committed (`.gitignore`).

## Утсан дээр суулгаж ажиллуулах (эзэнд)

Оффисын утас (Samsung S23 FE) дээр хийнэ. PC талын «Bto bridge» (`../windows`) ажиллаж,
дэлгэцэн дээр 6 оронтой код, LAN хаягаа харуулж байх ёстой.

1. **Суулгах.** `bto-call-bridge.apk`-ийг утас руу хуулж нээнэ. Хуучин «Bto дуудлага» (туршилтын
   хувилбар) байгаа бол устгах хэрэггүй: «Шинэчлэх» гэж гарна, дуудлагын жагсаалт хадгалагдана.
   Play Protect шалгахыг асуувал өмнөх шиг «Шалгахгүйгээр суулгах»; «Хязгаарлагдсан
   тохиргоог зөвшөөрөх» шаардвал Тохиргоо → Аппууд → Bto дуудлага → ⋮ → «Allow restricted
   settings».
2. **Аппыг нээх.** Мэдэгдэл харуулах, залгах зөвшөөрөл асуувал «Зөвшөөрөх». «Батарей хэмнэлтээс
   чөлөөлөх» асуувал «Зөвшөөрөх» (асуухгүй бол доорх товчийг дарна). Samsung дээр бас: Тохиргоо →
   Батарей → Арын фоны хэрэглээний хязгаар → «Хэзээ ч унтуулахгүй апп»-д «Bto дуудлага»-г нэмнэ.
   Мэдэгдлийн мөрөнд «Bto AI шугам: …» байнга харагдана, үүнийг унтрааж болохгүй.
3. **Үндсэн утасны апп.** «Үндсэн утасны апп: ТИЙМ» гэж байх ёстой (туршилтаас үлдсэн). ҮГҮЙ бол
   «Үндсэн утасны апп болгох» дарна.
4. **Wi-Fi.** Утас оффисын Wi-Fi-д (PC-тэй нэг сүлжээнд) холбогдсон байх ёстой. Зөвхөн мобайл
   датаар байвал дээд талд «Wi-Fi-д холбогдоогүй» гэж улаанаар бичнэ. Дэлгэц унтарсан үед ч
   апп Wi-Fi-г асаалттай байлгадаг; утсыг цэнэглэгчид залгаатай байлгана.
5. **PC-тэй холбох (нэг удаа).** «PC-ийн хаяг»-т PC дээр гарсан хаягийг (жишээ нь
   `192.168.1.20`), «6 оронтой код»-д PC дээрх кодыг бичээд «Холбох» дарна. Дээд талд
   «PC: холбогдсон» гарвал болсон. Дараа нь утас, PC унтарч асахад өөрөө холбогдоно.
   «Дахин холбох: PC-ийн шинэ код оруулна уу» гарвал PC дээр шинэ код гаргаж дахин «Холбох».
6. **Bluetooth (Phone Link).** PC дээр Phone Link (Утасны холбоос) аппыг нээж утсаа холбоно: утасны
   Bluetooth асаалттай, PC-тэй хослосон (pair) байх ёстой, Phone Link дуудлага хийх боломжтой
   («Calls») болсон байна. Шалгах: Phone Link-ээр PC-ээс нэг удаа гадагш залгаж, яриа PC-ийн
   чанга яригчаар гарч байвал болсон.
7. **AI хариулахыг асаах.** «AI хариулах» унтраалгыг асаана. «PC хариу өгөхийг хүлээх» анх 3 секунд.
8. **Турших.** Өөр утаснаас залгана. PC «хариул» гэвэл утас 3 секундэд багтаан өөрөө авч, дууг
   Bluetooth-ээр PC рүү шилжүүлнэ. PC «хариулахгүй» гэх, 3 секунд дуугүй байх, холбоо салсан эсвэл
   Bluetooth холбогдоогүй бол утас ердийнхөөрөө дуугарч ажилтан авна. Утас дуугарахдаа эхний
   секундүүдэд PC-ийн хариуг хүлээж байх үед ч хонх нь дуугарна.
9. **Жагсаалт илгээх.** «Сүүлийн 20 дуудлага»: дуугарах үед PC холбогдсон эсэх, PC юу гэж хэлсэн, хэдэн
   мс-д, яагаад ажилтанд дуугарсан, PC ямар чих хүссэн, юу ашигласан, хэн тасалсан. «Илгээх» дарж
   хөгжүүлэгчид Telegram-аар явуулна.

**Үндсэн утасны аппыг буцааж солих.** «Үндсэн аппуудын тохиргоо» товч, эсвэл Тохиргоо → Аппууд →
Үндсэн аппууд → Утасны апп руу орж хуучин «Утас» аппаа сонгоно. Аппыг устгавал утас өөрөө хуучин
аппдаа буцна.
