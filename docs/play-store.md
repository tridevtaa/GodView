# Godview on Google Play

The Android app is a **Trusted Web Activity**: a small Android wrapper that
opens godview.in full screen, with no browser bar. There is no second
codebase; every release of the website reaches the app at once, without a
new Play release. A new Play release is only needed to change the wrapper
itself (name, icon, package settings).

- Package name: **`in.godview.app`** (permanent; it can never change)
- Developer account: **personal**, so Google requires a **closed test with
  at least 12 testers for 14 days** before the app can go public.
- Privacy policy: https://godview.in/privacy/
- Account deletion: https://godview.in/delete-account/ (also in the app's
  account menu: Delete account)

## 1. Build the app (PWABuilder, about 10 minutes)

1. Open **pwabuilder.com**, enter `https://godview.in` and press **Start**.
2. **Package for stores > Android > Generate package**, then **Options**:

   | Setting | Value |
   |---|---|
   | Package ID | `in.godview.app` |
   | App name | `Godview` |
   | Launcher name | `Godview` |
   | App version / version code | `1.0.0` / `1` |
   | Host | `godview.in` |
   | Start URL | `/?app=1` |
   | Theme colour / background colour | `#FFFFFF` / `#FFFFFF` |
   | Display mode | Standalone |
   | Orientation | Portrait |
   | Notification delegation | **On** (app notifications work like today's web ones) |
   | Location delegation | Off |
   | Google Play billing | Off |
   | Fallback behaviour | Custom Tabs |
   | Signing key | **Create new** (your name and "Godview" as organisation) |

3. **Download**. Keep the zip somewhere safe and backed up (not in this
   repo): its `signing.keystore` and `signing-key-info.txt` (passwords) are
   needed for every future update.
4. Give Claude the zip's **`assetlinks.json`**. It holds only a public
   fingerprint, so it's safe to share. It goes live at
   `godview.in/.well-known/assetlinks.json`; without it the app shows a
   browser bar at the top.

## 2. Create the app in Play Console

1. **Create app**: name `Godview`, default language **English (India)**,
   **App**, **Free**; accept the declarations.
2. **Test and release > Setup > App integrity**: keep **Play App Signing**
   on. Copy the **App signing key certificate SHA-256** and give it to
   Claude too: it goes in `assetlinks.json` next to PWABuilder's, since Play
   re-signs the app with its own key.

## 3. App content (Policy > App content)

| Form | Answer |
|---|---|
| Privacy policy | `https://godview.in/privacy/` |
| App access | **All or some functionality is restricted**: add a demo school login (staff email + password) and a demo parent login, with one line on what to try |
| Ads | No ads |
| Content rating | Category **Utility, productivity, communication or other**; answer No to violence, sexual content, drugs, gambling. Users interact (messages between parents and school): **Yes**. Shares location: No (no device location is used) |
| Target audience | **18 and over** only. Children don't use the app; schools and parents do |
| News app | No |
| Government app | No |
| Financial features | None (fee records are kept, but no payments are made in the app) |
| Health | No |
| Data safety | See below |
| Account deletion | Yes, URL `https://godview.in/delete-account/` |

### Data safety

Data is collected, **encrypted in transit**, users can **request deletion**,
and none is **shared** in Play's sense (service providers that process data
for us don't count as sharing). Collected, all **for app functionality**,
none optional unless noted:

| Data type | Notes |
|---|---|
| Personal info: name, email address, phone number, address | Staff and parents; students' and applicants' records entered by the school; call back requests |
| Personal info: race and ethnicity | Student category (General, SC, ST, OBC), entered by the school |
| Personal info: political or religious beliefs | Student religion, entered by the school |
| Personal info: other info | Date of birth, gender, admission details, staff KYC proof documents |
| Financial info: other | Fee dues and payment records (no card or bank details) |
| Photos and videos | Student and staff photos, notice and message attachments |
| Files and docs | Documents the school uploads (birth or transfer certificate, Aadhaar copy, staff KYC) |
| Messages: other in-app messages | Parent and school messages and requests |
| App activity: app interactions | Microsoft Clarity heatmaps (**analytics**), with screen content masked |
| App activity: other user-generated content | Assistant questions and replies (Premium) |
| Device or other IDs | Push notification token; browser and device on the fee payment log (**fraud prevention, security**) |
| Audio: voice or sound recordings | **Not collected**: speech is turned into text on the device |

Data is **shared** with no one in Play's sense: Groq, Anthropic, Google
(FCM, Maps, Text-to-Speech), Microsoft Clarity, Supabase and Cloudflare are
service providers processing data for us. Privacy policy URL:
`https://godview.in/privacy/`

## 4. Store listing (Grow > Store presence > Main store listing)

- **App name:** Godview
- **Short description** (max 80): `Students, attendance, fees, results and buses for Indian schools, in one app.`
- **App icon:** `frontend/public/icon-512.png` (512 x 512)
- **Feature graphic:** `docs/play-store/feature-graphic.png` (1024 x 500;
  its source is `feature-graphic.html` beside it)
- **Phone screenshots:** 4 to 8, portrait, from a demo school (Home,
  Students, Attendance, Fees, Bus map, the parent app). Android: power +
  volume down.
- **Category:** Education. **Tags:** school management, education.
- **Contact email:** the support address (also on the privacy page).

**Full description:**

```
Godview runs your whole school in one app: students, attendance, fees, results, homework, notices and school buses, for owners, admins, principals, teachers and parents.

FOR THE SCHOOL OFFICE
• Every student's record in one place: class, parents, documents and photo
• Fees: dues, collections and defaulters at a glance, with receipts
• Staff, app access and roles, so everyone sees only what they should

FOR TEACHERS
• Mark attendance in seconds
• Give homework and enter exam results for your classes
• Message parents and answer their requests

FOR PARENTS
• Your child's attendance, homework, results, fees and timetable
• School notices and messages, with notifications
• Sign in with your phone number

TRANSPORT
• Bus routes, stops and riders on a map

PRIVATE BY DESIGN
• Data stored in India and encrypted
• Each school's data is kept apart from every other school's
• Only the last 4 digits of Aadhaar numbers are kept

Godview is used by schools: ask your school for access, or visit godview.in to set up yours.
```

## 5. Closed test (personal account: 12 testers, 14 days)

1. **Test and release > Testing > Closed testing > Create track**, upload
   the `.aab` from PWABuilder, add release notes ("First release").
2. **Testers:** add at least 12 people (an email list or a Google Group).
   Staff and parents of a pilot school are ideal.
3. Share the opt-in link. Each tester must join, install the app, and keep
   it installed for **14 days in a row**. Ask for a little use and
   feedback, as Google looks at engagement too.
4. After 14 days: **Dashboard > Apply for production**, answer the
   questions about the test, then send a production release.
