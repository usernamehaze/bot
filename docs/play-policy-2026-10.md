# Google Play policy update, October 2026: what it means for Cassie

Cassie's Android app is a Trusted Web Activity made with PWABuilder: the website
`askcassie.study/start.html` running in Chrome. There is no native Android code in
this repo, so the app can only use what the web page asks the browser for.

Searched in Cassie's own code (web app and Chrome extension, not `tests/` or
`vendor/`): `geolocation`, `navigator.contacts`, `ContactsManager`, local network
and device APIs (`navigator.serial`, `usb`, `bluetooth`, `hid`),
`showDirectoryPicker`, `requestFileSystem`, `OTPCredential`, `sms:`, `getUserMedia`,
`Notification.requestPermission`, ads SDKs (`adsbygoogle`, `admob`, `doubleclick`,
`googletagmanager`). The smoke test "Google Play, October 2026" keeps the
restricted ones out.

What the web app does use: the microphone (`app.js:7827`, `app.js:7938`, `mic.js:55`,
voice chat and dictation), the camera only through the photo picker
(`app.html:208`, `<input type="file" capture>`), notifications for study reminders
(`app.js:6804`), and `tel:` links to the crisis hotlines (`care.js:161`), which open
the dialer and read nothing.

Google's support site (support.google.com) could not be reached from the session
that wrote this, so the policy pages below are cited by address and their full text
is **[unverified]**. Everything else comes from Google's update email and this repo.

| Policy item | Applies to Cassie? | Evidence | Action |
|---|---|---|---|
| **Local Network** permission (declaration for API 37+) | no | No local network or device APIs in the code (search above). A TWA adds no such permission unless asked. | None. Console: "not used". |
| **Manage Contacts** permission | no | No `navigator.contacts` or `ContactsManager` anywhere. | None. Console: "not used". |
| **AppFunctions** API | no | Native Android API; Cassie has no native code. | None. |
| **Subscriptions with ongoing eligibility-based discounts** (student plans) | no, but now said plainly | No plan is priced for students or ages, and nothing is checked to buy one. Plans are passes that never renew (`terms.html`, Paid plans). The ₱ and US$ prices are a currency the buyer picks, not a check. The **Founding price** keeps your price if you buy again before your pass ends; `terms.html` already says the price at that time applies after it ends. | Added the same line to `terms.html` and the pricing fine print in `index.html`: "Each price is the same for everyone. No plan is a student, age or other discount you have to qualify for, so there is nothing to check: no school email, ID or proof of age." |
| **Location** (minimum scope, location button on API 37+, declaration for ACCESS_FINE_LOCATION, mandatory Jan 27, 2027) | no, if packaged right | No `geolocation` in the code. PWABuilder's **Location delegation** would add location permissions to the package. | `STORES.md` section 3: Location delegation OFF. |
| **All Files Access** (MANAGE_EXTERNAL_STORAGE) | no | Files come only from the browser's file picker; no file system APIs. | None. |
| **Accessibility** API (isAccessibilityTool) | no | Native Android API. The extension's permissions are `storage`, `activeTab`, `scripting`, `contextMenus`, `sidePanel` (Chrome, not Android). | None. |
| **Deceptive Behavior** (no manipulating app review) | yes, as always | Nothing to change; the listing in `STORES.md` describes what the app does. | Keep the listing and screenshots true to the app. |
| **Families** Self-Certified Ads SDK program | no | No ads and no ads SDKs (`privacy.html`: "There are no ads and no trackers"). | None. Target audience 13+ keeps the Families rules off (`STORES.md`). |
| **Cryptocurrency** (Hong Kong licences) | no | Cassie sells no crypto. | None. |
| **SMS or Call Log** permission groups (phone call verification ends Jan 27, 2027) | no | No SMS or call log access. Sign in is by email, Google or Apple; `tel:` links only open the dialer. | None. |
| **Payments** (digital purchases, and AI or agentic purchases) | **yes, see below** | Paid plans are digital and bought through PayMongo (`server/worker.src.js` `/pay/*`, `app.js:8931`). Cassie's AI never buys anything. | Decision for you, below. Nothing built. |
| **Play Age Signals** API | no (not available to a web app) | A native Android API; a TWA web page can't call it. Onboarding already asks the age: under 13 sends no usage counts (`app.js:8332`, `app.js:5183`), and topic words only from 18 (`app.js:8447`). | None. Document only. |
| **Japan** payments authorization (by Dec 1, 2026) | console only, if selling there | Prices are in ₱ (Philippines) and US$ (worldwide); no yen anywhere. | Only if Japan is a country you sell in: complete the form. |
| **Trader status** (from Nov 2026) | console only | Selling paid plans may make you a trader [unverified: see the Console's help]. | Declare it in Play Console (`STORES.md` step 7). |
| Games for **Cars** now generally available | no | Cassie isn't a car app. | None. |
| **Memory** and code optimization thresholds (Feb 2027) | console only | The package is a thin Chrome wrapper; the exact thresholds are [unverified]. | After each upload, check the Console for quality warnings. |
| **Android XR** guidelines | no | Not an XR app. | None. |

## Payments: the one real risk

Google Play's Payments policy generally requires apps from Play that sell digital
goods or features (Cassie's Plus and Pro passes are digital) to use Google Play
Billing, with exceptions such as user choice billing in some countries
[unverified: full text at
https://support.google.com/googleplay/android-developer/answer/9858738]. The
October update adds guidance for purchases made through AI or agentic experiences;
Cassie's AI never makes purchases, so that part doesn't apply. Selling passes
through PayMongo **inside the Play app** is the part to settle before the Play app
offers paid plans. (Paid plans are not open yet: the website says they are
launching soon.)

**Option 1: no buying inside the Play app.** When the app runs inside the Play
TWA, hide the buy buttons and the price list's Buy links, and say plans can be
managed on askcassie.study.
- For: no Google fee, PayMongo and GCash/Maya stay, small change in the app.
- Against: Play users can't buy in the app. Google also limits how an app may
  point people to buying elsewhere, so the wording needs checking [unverified].
  The web app must reliably know it's inside the Play TWA (for example a
  `?source=twa` start address set in PWABuilder).

**Option 2: Google Play Billing inside the Play app.** Turn on PWABuilder's Google
Play billing and sell the passes through the Digital Goods API there, keeping
PayMongo on the website.
- For: buying works in the Play app and follows the policy directly.
- Against: Google's service fee on each sale, passes set up as Play products,
  and new server work to check Play purchases and give the plan. It's a bigger
  build, and it changes payments and the server, so it needs your go-ahead.

Neither is built. Until you decide, keep **Google Play billing OFF** in
PWABuilder and don't ship paid plans in the Play app.

## Policy pages (cited by address; text [unverified] from this session)

- Payments: https://support.google.com/googleplay/android-developer/answer/9858738
- Subscriptions: https://support.google.com/googleplay/android-developer/answer/9900533
- Policy Center: https://support.google.com/googleplay/android-developer/topic/9858052
