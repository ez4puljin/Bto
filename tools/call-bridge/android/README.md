# «Bto дуудлага»: the Android side of the call bridge

Stage 0, the probe: package `mn.bto.callbridge`, Kotlin, plain Android views, no AndroidX and no
library besides the Kotlin standard library (JUnit for the unit tests). minSdk 29 (RoleManager),
compileSdk/targetSdk 36.

| File | What |
|---|---|
| `MainActivity.kt` | the dialer role (ask, show), the settings («AI хариулах», delay, hang-up), the last 20 calls, «Илгээх» |
| `ProbeInCallService.kt` | the InCallService Telecom binds: auto-answer, audio route, hang-up timer, the call record |
| `InCallActivity.kt` | the minimal in-call screen: number, state, answer / reject / hang up, speaker, SIM choice |
| `DialerActivity.kt` | the dialpad (ACTION_DIAL, `tel:`), places calls with `TelecomManager.placeCall` |
| `ProbeRules.kt` | pure rules (settings ranges, endpoint choice, names), tested in `app/src/test` |
| `ProbeStore.kt` | settings and the call list in the app's SharedPreferences |

Audio route after the AI answers: a wired headset first, then Bluetooth, else it stays where the
phone put it. API 34+ uses `onAvailableCallEndpointsChanged` / `requestCallEndpointChange`, below
34 `setAudioRoute`. The ringtone is the phone's own (Telecom), the probe only shows the screen.

## Build (the Ubuntu PC)

Built by hand, not by the job desk (`pnpm mobile:apk` and `tools/brain/job.sh` are the staff
app's). It uses the same Gradle (9.3.1), Android Gradle Plugin (8.12.0) and Kotlin (2.1.20) as the
staff app, from the Gradle home the staff app's build fills (`~/Android/gradle`), so it needs the
network only for JUnit the first time.

```sh
cd tools/call-bridge/android
export ANDROID_HOME=~/Android/Sdk GRADLE_USER_HOME=~/Android/gradle   # JDK 17 on the PATH
nice -n 15 ./gradlew --no-daemon assembleDebug testDebugUnitTest
mkdir -p ../../../out && cp app/build/outputs/apk/debug/app-debug.apk ../../../out/bto-call-probe.apk
```

The APK is signed with the PC's Android debug key (`~/.android/debug.keystore`, made by Gradle
the first time): good for a test phone, not for a release. Neither the APK nor any key is ever
committed (`.gitignore`).

## Утсан дээр турших (эзэнд)

Нэг туршилтын утсаар (Android 10 буюу түүнээс шинэ) хийнэ. Энэ апп сервертэй холбогдохгүй, зөвхөн
утсан дээрээ жагсаалт хөтөлнө.

1. **Суулгах.** `bto-call-probe.apk` файлыг утас руу хуулж нээнэ (Telegram, кабель…). «Үл мэдэх
   эх сурвалжаас суулгах»-ыг зөвшөөрөхийг асуувал зөвшөөрнө. Апп «Bto дуудлага» нэрээр гарна.
2. **Үндсэн утасны апп болгох.** Аппыг нээгээд «Үндсэн утасны апп болгох» дарна, гарч ирэх
   цонхонд «Bto дуудлага»-г сонгоно. Дээд талд «Үндсэн утасны апп: ТИЙМ» гарвал болсон. Залгах,
   мэдэгдэл харуулах зөвшөөрөл асуувал «Зөвшөөрөх».
3. **Эхлээд энгийнээр шалгах.** «AI хариулах» унтраалттай байхад өөр утаснаас залгана: дэлгэц дээр
   дугаар, «Хариулах», «Татгалзах» гарна, утас ердийнхөөрөө дуугарна. Хариулж, ярьж, «Таслах»
   дарна. «Дугаар залгах» товчоор гадагш залгаж үзнэ.
4. **AI хариулахыг асаах.** «AI хариулах» унтраалгыг асаана. «Хариулах хүртэл» (анх 3 секунд),
   «Хариулснаас хойш таслах» (анх 10 секунд)-ыг хүсвэл өөрчлөөд «Хадгалах» дарна.
5. **Өөр утаснаас залгах.** Залгасан утсанд: хэдэн секунд дуугарсны дараа апп өөрөө хариулна,
   10 секундын дараа өөрөө тасална. Чихэвч (утастай эсвэл Bluetooth) залгаатай бол дуу тийшээ шилжих
   ёстой. Үүнийг хэд хэдэн удаа: чихэвчгүй, утастай чихэвчтэй, Bluetooth-тэй, дэлгэц түгжээтэй үед
   давтаж үзнэ.
6. **Жагсаалт унших, илгээх.** Аппын доод хэсэгт «Сүүлийн 20 дуудлага» гарна: цаг, дугаар, хэн
   хариулсан, дуугарснаас хариулах хүртэл хэдэн мс, ямар чих боломжтой байсан, алийг нь ашигласан,
   хэрхэн тасарсан, алдаа. «Илгээх» дарж Telegram-аар хөгжүүлэгчид явуулна.

**Үндсэн утасны аппыг буцааж солих.** Аппын «Үндсэн аппуудын тохиргоо» товч, эсвэл утасны
Тохиргоо → Аппууд → Үндсэн аппууд → Утасны апп (Samsung: Settings → Apps → Choose default apps →
Phone app) руу орж хуучин «Утас» (Phone) аппаа сонгоно. Аппыг устгавал утас өөрөө хуучин аппдаа
буцна.

## Stage 3 (not in the probe)

The real line's phone will add what the probe does not need:

- a foreground service that keeps the bridge alive between calls, with its ongoing notification;
- an exemption from battery optimisation, and a start on boot;
- a WebSocket over the LAN to the PC's bridge (`windows/`), paired once with a key kept on the
  phone (never in this repository), carrying the call's audio both ways;
- a 3-second fallback: when the PC does not take the call within 3 s, the phone rings normally
  and a person answers.
