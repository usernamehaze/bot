# Getting Cassie to people

There are four parts. Each one can be done on its own.

1. [Keep askcassie.pages.dev up to date](#1-keep-askcassiepagesdev-up-to-date) (do this first, about 10 minutes)
2. [Chrome Web Store](#2-chrome-web-store-the-extension), so people install the extension in one click
3. [Google Play Store](#3-google-play-store-android), for Android phones
4. [Apple App Store](#4-apple-app-store-iphone), for iPhones

---

## 1. Keep askcassie.pages.dev up to date

askcassie.pages.dev was uploaded by hand, so it doesn't change when Cassie is
updated. This step makes it update automatically after every change. It also
puts the Chrome extension on the site as a download (`/cassie-extension.zip`).
The website's **Get the Chrome extension** button links to it.

1. **Make a Cloudflare API token**
   - Go to dash.cloudflare.com → your profile icon (top right) → **My Profile**
     → **API Tokens** → **Create Token** → **Create Custom Token**.
   - Name it `GitHub deploy`.
   - Under Permissions, choose **Account** → **Cloudflare Pages** → **Edit**.
   - Click **Continue to summary** → **Create Token**, then copy the token. It is
     shown only once.
2. **Find your Account ID.** Open **Workers & Pages**. The Account ID is in the
   right-hand column; copy it.
3. **Add both to GitHub**
   - Open github.com/usernamehaze/bot → **Settings** → **Secrets and variables**
     → **Actions** → **New repository secret**.
   - Add `CLOUDFLARE_API_TOKEN` with the token as its value.
   - Add `CLOUDFLARE_ACCOUNT_ID` with the Account ID as its value.
4. **Run it once.** Go to the **Actions** tab → **Deploy website** → **Run workflow**.
   After about a minute, askcassie.pages.dev shows the latest Cassie.

**If it doesn't change**, open Cloudflare → Workers & Pages → your Cassie project.

- If the project isn't called `askcassie`, add a repository **variable** (not a
  secret) named `PAGES_PROJECT` with its real name.
- If the latest deploy is marked **Preview**, check **Settings** → **Production
  branch**. Then add a variable named `PAGES_BRANCH` with that branch name.

---

## 2. Chrome Web Store (the extension)

After this, people find **Cassie** in the Chrome Web Store, click **Add to
Chrome**, and get updates automatically. There's no zip file and no Developer
mode.

**Cost:** a one-time **US $5** developer registration. Review usually takes a
few days.

1. Go to **chrome.google.com/webstore/devconsole** and sign in with the Google
   account you want to own Cassie. Pay the $5 fee.
2. Click **New item** and upload **cassie-extension-store-v3.37.0.zip**. In this
   zip, `manifest.json` is at the top level, which the store requires. The zip
   for installing by hand has a folder inside, so don't upload that one.
3. **Store listing**
   - **Description:** what Cassie does. Highlight → Explain / Answer / Code /
     Summarize, Snip, Ask about this page, and the board with graphs.
   - **Category:** Education.
   - **Screenshots:** at least one at 1280×800 (`cassie-screenshot-1280x800.png`).
   - **Icon:** `extension/icons/icon-128.png`.
4. **Privacy tab**
   - **Single purpose:** "Explains, answers, or summarizes text and screenshots
     the user chooses, for studying."
   - **Why each permission is needed:**
     - `activeTab` / `scripting`: read the text the user highlights or the page
       they choose to ask about.
     - `storage`: save the user's API key and settings on their device.
     - `contextMenus`: the right-click "Ask Cassie" menu.
     - `sidePanel`: Cassie's side panel.
     - Host access to all sites: so highlighting works on any site the student
       reads.
   - **Remote code:** No.
   - **Data use:** tick "Website content". Confirm the data isn't sold, isn't
     used for unrelated purposes, and isn't used for credit decisions.
   - **Privacy policy URL:** `https://askcassie.pages.dev/privacy.html`
5. Click **Submit for review**. Cassie can read every site, so Google may take
   a little longer to review it. That's normal.

To publish an update later, bump `version` in `extension/manifest.json`. Then
upload the new zip under **Package** and submit again.

**Microsoft Edge Add-ons** is free. Do the same at partner.microsoft.com →
Edge, using the same zip.

---

## 3. Google Play Store (Android)

Cassie is a web app, so Android wraps it as a **Trusted Web Activity (TWA)**.
It's the real Cassie website running full screen, with no browser bar. Updates
to the website reach the Play Store app automatically.

**Cost:** a one-time **US $25** Google Play developer account.

1. **Package it**
   - Go to **pwabuilder.com**, enter `https://askcassie.pages.dev/start.html`,
     and click **Start**. Cassie already has the icons, screenshots and offline
     support that it checks for.
   - Click **Package for stores** → **Android** → **Generate**.
   - Package ID: something like `dev.pages.askcassie.twa`.
   - Download the zip and keep the **signing key** and its passwords somewhere
     safe. Without them you can never update the app.
2. **Link the app to the website.** The zip contains `assetlinks.json`. Send it
   to Claude, or put it at `.well-known/assetlinks.json` in this repo. The
   deploy publishes it, which removes the browser bar inside the app.
3. **Google Play Console**
   - Go to **play.google.com/console**, pay the $25, and verify your identity.
   - **Create app**, then upload the `.aab` file from step 1.
4. **Testing rule for new personal accounts.** Google currently requires a
   **closed test with at least 12 testers for 14 days** before you can publish
   to everyone. Friends and classmates with Android phones can be testers; they
   join with a link.
5. **Fill in the forms**
   - Store listing: use the screenshots in `icons/screens/`.
   - **Content rating** questionnaire.
   - **Data safety:** the app sends questions to an AI service and anonymous
     usage counts, doesn't sell data, and lets users delete data by clearing it.
   - **Target audience:** if you include **under 13**, Google's stricter
     *Families* rules apply. Choosing **13+** is simpler for a first release.
   - Privacy policy: `https://askcassie.pages.dev/privacy.html`
6. Send it for review. A first review can take a few days to a week.

---

## 4. Apple App Store (iPhone)

This is harder and costs more:

- **US $99 per year** for the Apple Developer Program.
- You need a **Mac with Xcode** to build and upload the app. A borrowed Mac or a
  rented cloud Mac works.
- Apple often rejects apps that are "just a website in a box" (guideline 4.2,
  minimum functionality). The app has to feel like an app. Cassie's offline
  mode, voice, board and file reading help, but it isn't guaranteed.

**Until then, iPhone users can install Cassie for free.** Open
askcassie.pages.dev in **Safari** → **Share** → **Add to Home Screen**. It
opens full screen with its own icon, like an app.

**When you're ready:**

1. Join the Apple Developer Program.
2. On pwabuilder.com, choose **Package for stores** → **iOS** and download the
   Xcode project. Capacitor is another way to make the project.
3. Open the project in Xcode on a Mac, set your team, and click **Archive** →
   **Distribute App** → **App Store Connect**.
4. In **App Store Connect**, fill in the listing, privacy "nutrition label",
   age rating and screenshots. Then submit.

---

### Before any store: Cassie's server

App-store users won't want to make a Groq account. Set up the free Cassie
server first (`server/README.md`) so Cassie works without a key the moment
someone installs her.
