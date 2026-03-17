# StatusSkip — Deployment Guide

> Send weekly status reports in 60 seconds. Built on Google Apps Script + GitHub Pages. Zero infrastructure cost.

---

## Project Structure

```
statusskip/
├── index.html      ← Landing page (GitHub Pages)
├── app.html        ← The report form app
├── Code.gs         ← Google Apps Script backend
└── README.md       ← This file
```

---

## Step 1 — Deploy the Backend (Google Apps Script)

### 1.1 Create the project

1. Go to [script.google.com](https://script.google.com)
2. Click **New project**
3. Rename it: `StatusSkip`
4. Delete the default `function myFunction() {}` code
5. Paste the entire contents of `Code.gs`
6. Click 💾 Save

### 1.2 Deploy as a Web App

1. Click **Deploy** → **New deployment**
2. Click the gear ⚙️ next to "Select type" → choose **Web app**
3. Fill in:
   - Description: `StatusSkip v1.0`
   - Execute as: **Me**
   - Who has access: **Anyone**
4. Click **Deploy**
5. **Authorize** when prompted (Gmail + Sheets permissions)
6. Copy the **Web app URL** — it looks like:
   ```
   https://script.google.com/macros/s/AKfycb.../exec
   ```

### 1.3 Connect to a Google Sheet

1. In the same Apps Script project, go to **Resources** → **Cloud Platform project** (or via Extensions menu)
2. Open any Google Sheet — the script will auto-create `Submissions` and `Pro Users` tabs on first run
3. Optionally: create a new Google Sheet, click **Extensions → Apps Script** and paste the code there — the script will be bound to that sheet

---

## Step 2 — Configure the Frontend

### 2.1 Set the Script URL in `app.html`

Open `app.html` and find this line near the top of the `<script>` block:

```javascript
const SCRIPT_URL = 'https://script.google.com/macros/s/YOUR_DEPLOYMENT_ID_HERE/exec';
```

Replace `YOUR_DEPLOYMENT_ID_HERE` with your actual deployment URL from Step 1.2.

### 2.2 Update domain references (optional)

If you have a custom domain, find and replace `statusskip.com` in both HTML files with your domain.

---

## Step 3 — Deploy to GitHub Pages

### 3.1 Create a GitHub repository

```bash
git init
git add .
git commit -m "Initial StatusSkip launch"
git remote add origin https://github.com/YOUR_USERNAME/statusskip
git push -u origin main
```

### 3.2 Enable GitHub Pages

1. Go to your repo on GitHub
2. Settings → Pages
3. Source: **Deploy from branch** → `main` → `/ (root)`
4. Click **Save**
5. Your site will be live at: `https://YOUR_USERNAME.github.io/statusskip/`

### 3.3 Custom domain (optional)

1. Add a `CNAME` file to the repo root containing your domain:
   ```
   statusskip.com
   ```
2. Point your domain's DNS to GitHub Pages (A records + CNAME)
3. Enable "Enforce HTTPS" in GitHub Pages settings

---

## Step 4 — Test End-to-End

1. Open `https://YOUR_USERNAME.github.io/statusskip/app.html`
2. Fill in:
   - Your Name: `Test User`
   - Manager Email: **your own email** (to catch the test)
   - Task 1: `Test task`, Progress: 75%
3. Click **Send Report**
4. Check that:
   - ✅ You receive the HTML email within 5 seconds
   - ✅ The progress bar is color-coded
   - ✅ The subject line reads `✅ Weekly Update: Test User — ...`
   - ✅ A confirmation copy arrives at your email (if you filled it in)
   - ✅ A new row appears in your Google Sheet `Submissions` tab

---

## Step 5 — Set Up Weekly Reminders (Optional)

To send Friday afternoon reminder emails to users who opted in (provided their email):

1. In Apps Script, go to **Triggers** (clock icon in left sidebar)
2. Click **+ Add Trigger**
3. Configure:
   - Function: `sendWeeklyReminders`
   - Event source: **Time-driven**
   - Time-based trigger: **Week timer**
   - Day: **Every Friday**
   - Time: **3pm to 4pm**
4. Save & authorize

---

## Step 6 — Set Up Stripe (Pro Tier)

### 6.1 Create the product

1. Go to [dashboard.stripe.com](https://dashboard.stripe.com)
2. Products → **+ Add product**
   - Name: `StatusSkip Pro`
   - Price: `$7.00` / month / recurring
3. Copy the **Payment Link** URL

### 6.2 Update the upgrade URLs in `app.html`

Find the upgrade modal and Pro link:
```javascript
// In app.html — modal button
<a href="https://statusskip.com/pro" class="btn-upgrade">Upgrade to Pro — $7/month</a>
```
Replace the href with your Stripe Payment Link.

### 6.3 Mark users as Pro (Zapier automation)

When a user pays via Stripe, you need to add their email to the `Pro Users` sheet:

1. Go to [zapier.com](https://zapier.com) → New Zap
2. Trigger: **Stripe** → Event: **Customer subscription created**
3. Action: **Google Sheets** → **Append Row**
   - Spreadsheet: your StatusSkip sheet
   - Sheet: `Pro Users`
   - Email column: `{{customer.email}}`

---

## Gmail Quota Limits

| Account Type | Daily Email Limit |
|---|---|
| Free Gmail (@gmail.com) | 100 emails/day |
| Google Workspace (paid) | 1,500 emails/day |

**When to upgrade to Workspace:** Once you're consistently hitting 80+ sends/day. Workspace starts at $6/month.

To check current quota usage in Apps Script:
```javascript
function checkQuota() {
  console.log(MailApp.getRemainingDailyQuota());
}
```

---

## URL Pre-fill Parameters

The app supports pre-filling form fields via URL params (used in reminder emails):

```
app.html?name=Alex+Johnson&email=alex@co.com&manager=boss@co.com
```

| Parameter | Field |
|---|---|
| `name` | Your Name |
| `email` | Your Email |
| `manager` | Manager's Email |

---

## CORS Note

Google Apps Script web apps support cross-origin requests but require the response to be `application/json`. The `app.html` fetch call uses `mode: 'cors'`. If you encounter CORS issues:

1. Redeploy the Apps Script (new deployment, not just a version update)
2. Ensure "Who has access" is set to **Anyone** (not "Anyone with Google account")
3. Apps Script may need a JSONP workaround for some browser configurations — the code includes a `mailto:` fallback if the fetch fails

---

## Monitoring

### Check submissions
Open your Google Sheet → `Submissions` tab. Each row = one report sent.

### Check errors
In Apps Script → **Executions** tab. View logs and any failed runs.

### Check quota
```javascript
// Run this function manually to check remaining quota
function checkQuota() {
  Logger.log('Remaining email quota: ' + MailApp.getRemainingDailyQuota());
}
```

---

## Launch Checklist

- [ ] Apps Script deployed, URL copied
- [ ] `SCRIPT_URL` updated in `app.html`
- [ ] Pushed to GitHub Pages
- [ ] End-to-end test email received
- [ ] Google Sheet logging confirmed
- [ ] Stripe payment link created (optional for Day 1)
- [ ] Custom domain pointed (optional)
- [ ] Reddit/Twitter launch post ready

---

## Tech Stack Summary

| Layer | Tech | Cost |
|---|---|---|
| Landing page | Static HTML | $0 (GitHub Pages) |
| Report form | Static HTML/CSS/JS | $0 (GitHub Pages) |
| Backend API | Google Apps Script | $0 |
| Email delivery | GmailApp | $0 (100/day) |
| Data storage | Google Sheets | $0 |
| Payments | Stripe Checkout Link | 2.9% + 30¢ |

**Total monthly cost at launch: $0**

---

_StatusSkip v1.0 · statusskip.com_
