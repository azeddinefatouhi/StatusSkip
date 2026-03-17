// ================================================================
// StatusSkip — Google Apps Script Backend
// ================================================================
// SETUP INSTRUCTIONS:
//   1. Go to script.google.com → New Project → paste this code
//   2. Deploy → New deployment → Web app
//      - Execute as: Me
//      - Who has access: Anyone
//   3. Copy the web app URL → paste into app.html SCRIPT_URL
//   4. On first run, authorize Gmail + Sheets permissions
// ================================================================

const CONFIG = {
  SHEET_NAME_SUBMISSIONS: 'Submissions',
  SHEET_NAME_PRO_USERS: 'Pro Users',
  FREE_LIMIT_PER_WEEK: 1,
  BRAND_NAME: 'StatusSkip',
  BRAND_URL: 'https://azeddinefatouhi.github.io/StatusSkip',
  UPGRADE_URL: 'https://azeddinefatouhi.github.io/StatusSkip/index.html#pricing', // PayPal subscription page
};

// ================================================================
// MAIN ENTRY POINTS
// ================================================================

function doPost(e) {
  try {
    const raw = e.postData ? e.postData.contents : '{}';

    // Detect PayPal IPN (form-encoded, not JSON)
    const contentType = e.postData ? (e.postData.type || '') : '';
    if (contentType.includes('application/x-www-form-urlencoded') || raw.includes('txn_type=') || raw.includes('payment_status=')) {
      const ipnParams = {};
      raw.split('&').forEach(pair => {
        const [k, v] = pair.split('=');
        if (k) ipnParams[decodeURIComponent(k)] = decodeURIComponent((v || '').replace(/\+/g, ' '));
      });
      handlePayPalIPN(ipnParams);
      return jsonOut({ status: 'ipn_received' });
    }

    const params = JSON.parse(raw);

    const { userName, userEmail, managerEmail, tasks, progress } = params;

    // --- Validate ---
    if (!userName || !userName.trim()) return err('Missing required field: userName');
    if (!managerEmail || !isValidEmail(managerEmail)) return err('Invalid or missing managerEmail');
    if (!tasks || !Array.isArray(tasks) || tasks.length === 0) return err('Missing tasks array');
    if (!progress || !Array.isArray(progress)) return err('Missing progress array');

    // Sanitize
    const cleanName = sanitize(userName, 80);
    const cleanManager = managerEmail.trim().toLowerCase();
    const cleanUserEmail = userEmail ? userEmail.trim().toLowerCase() : '';
    const cleanTasks = tasks.map(t => sanitize(t, 100)).filter(t => t.length >= 1);
    const cleanProgress = progress.map(p => Math.min(100, Math.max(0, parseInt(p) || 0)));

    if (cleanTasks.length === 0) return err('At least one task is required');

    // --- Freemium check (server-side) ---
    if (cleanUserEmail) {
      const isPro = isProUser(cleanUserEmail);
      if (!isPro) {
        const weekCount = getWeeklyCount(cleanUserEmail);
        if (weekCount >= CONFIG.FREE_LIMIT_PER_WEEK) {
          return jsonOut({
            status: 'limit_reached',
            message: `Free plan limit reached. Upgrade to Pro for unlimited reports.`,
            upgrade_url: CONFIG.UPGRADE_URL,
          });
        }
      }
    }

    // --- Generate & send email ---
    const html = generateEmailHTML(cleanName, cleanTasks, cleanProgress, cleanUserEmail);
    const subject = `✅ Weekly Update: ${cleanName} — ${getWeekString()}`;

    GmailApp.sendEmail(cleanManager, subject, buildPlainText(cleanName, cleanTasks, cleanProgress), {
      htmlBody: html,
      name: `${cleanName} via ${CONFIG.BRAND_NAME}`,
      replyTo: cleanUserEmail || cleanManager,
    });

    // --- Confirmation copy ---
    if (cleanUserEmail && isValidEmail(cleanUserEmail)) {
      GmailApp.sendEmail(
        cleanUserEmail,
        `📬 Your status report was sent — ${CONFIG.BRAND_NAME}`,
        '',
        { htmlBody: generateConfirmationHTML(cleanName, cleanManager), name: CONFIG.BRAND_NAME }
      );
    }

    // --- Log submission ---
    logSubmission(cleanName, cleanUserEmail, cleanManager, cleanTasks, cleanProgress);

    return jsonOut({ status: 'success', message: 'Email sent successfully!' });

  } catch (error) {
    console.error('doPost error:', error.toString());
    return err(error.toString());
  }
}

function doGet() {
  return HtmlService.createHtmlOutput(`
    <h2>✅ ${CONFIG.BRAND_NAME} API</h2>
    <p>POST JSON to this URL to send a status report.</p>
    <pre style="font-family:monospace;background:#f5f5f5;padding:16px;border-radius:8px;">
{
  "userName": "Alex Johnson",
  "userEmail": "alex@company.com",
  "managerEmail": "manager@company.com",
  "tasks": ["Task A", "Task B", "Task C"],
  "progress": [85, 60, 30]
}
    </pre>
  `);
}


// ================================================================
// PAYPAL IPN HANDLER
// ================================================================
// PayPal will POST to this same web app URL when a subscription
// is created or payment is received.
// In your PayPal button form, set notify_url to this script's URL.

function handlePayPalIPN(params) {
  try {
    const txnType  = params['txn_type']  || '';
    const status   = params['payment_status'] || params['subscr_status'] || '';
    const payerEmail = (params['payer_email'] || '').toLowerCase().trim();

    // Accept new subscription or recurring payment
    const isNew     = txnType === 'subscr_signup';
    const isPaid    = txnType === 'subscr_payment' && status === 'Completed';

    if ((isNew || isPaid) && payerEmail) {
      // Try to find the StatusSkip email from custom field first,
      // otherwise fall back to PayPal payer email
      const customEmail = (params['custom'] || '').toLowerCase().trim();
      const userEmail = customEmail || payerEmail;

      markUserAsPro(userEmail, payerEmail);
      console.log(`Pro activated for: ${userEmail} (PayPal: ${payerEmail})`);
    }

    // Handle cancellations
    if (txnType === 'subscr_cancel' || txnType === 'subscr_eot') {
      const customEmail = (params['custom'] || '').toLowerCase().trim();
      const userEmail = customEmail || (params['payer_email'] || '').toLowerCase().trim();
      if (userEmail) revokeProAccess(userEmail);
    }

  } catch (err) {
    console.error('PayPal IPN error:', err.toString());
  }
}

function markUserAsPro(userEmail, paypalEmail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(CONFIG.SHEET_NAME_PRO_USERS);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.SHEET_NAME_PRO_USERS);
    sheet.appendRow(['Email', 'PayPal Email', 'Activated At', 'Status']);
    sheet.setFrozenRows(1);
  }
  // Check if already exists
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === userEmail) {
      sheet.getRange(i + 1, 3).setValue(new Date().toISOString());
      sheet.getRange(i + 1, 4).setValue('active');
      return;
    }
  }
  sheet.appendRow([userEmail, paypalEmail, new Date().toISOString(), 'active']);
}

function revokeProAccess(userEmail) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_PRO_USERS);
  if (!sheet) return;
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    if ((data[i][0] || '').toLowerCase() === userEmail) {
      sheet.getRange(i + 1, 4).setValue('cancelled');
    }
  }
}

// ── MANUAL PRO ACTIVATION (run this from Apps Script editor) ──
// If automatic IPN fails, you can manually activate a user:
// 1. Open Apps Script editor
// 2. Run activateProManually('user@email.com')
function activateProManually(email) {
  markUserAsPro(email.toLowerCase().trim(), 'manual');
  Logger.log('Activated Pro for: ' + email);
}

// ================================================================
// EMAIL HTML GENERATOR
// ================================================================

function generateEmailHTML(name, tasks, progress, userEmail) {
  const week = getWeekString();
  const taskRows = tasks.map((task, i) => {
    const pct = progress[i] || 0;
    const c = getStatusColors(pct);
    return `
    <tr><td style="padding:0 0 12px 0;">
      <div style="background:${c.bg};border-left:5px solid ${c.bar};border-radius:0 8px 8px 0;padding:14px 18px;">
        <div style="font-weight:700;color:#1a1a2e;font-size:14px;margin-bottom:9px;">${escHtml(task)}</div>
        <div style="background:#e0e0e0;border-radius:999px;height:7px;overflow:hidden;">
          <div style="background:${c.bar};width:${pct}%;height:7px;border-radius:999px;"></div>
        </div>
        <div style="margin-top:6px;display:table;width:100%;">
          <span style="display:table-cell;font-size:12px;color:${c.text};">${c.emoji} ${c.label}</span>
          <span style="display:table-cell;text-align:right;font-size:12px;color:#6b7280;">${pct}%</span>
        </div>
      </div>
    </td></tr>`;
  }).join('');

  const avg = Math.round(progress.reduce((a, b) => a + b, 0) / progress.length);
  const onTrack = progress.filter(p => p >= 80).length;
  const behind = progress.filter(p => p < 50).length;

  const replyTo = userEmail ? `Reply directly to this email to reach ${escHtml(name)}.` : 'Reply to this email to respond.';

  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f4f7fb;font-family:Arial,Helvetica,sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f7fb;padding:32px 16px;">
<tr><td>
<table width="600" cellpadding="0" cellspacing="0" align="center"
  style="max-width:600px;width:100%;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,0.08);">

  <!-- HEADER -->
  <tr><td style="background:linear-gradient(135deg,#1a1a2e 0%,#16213e 50%,#0f3460 100%);padding:32px 36px;">
    <div style="font-size:10px;color:#64748b;letter-spacing:2px;text-transform:uppercase;margin-bottom:8px;">Weekly Status Report</div>
    <div style="font-size:26px;font-weight:700;color:#ffffff;">📊 ${escHtml(name)}</div>
    <div style="font-size:13px;color:#475569;margin-top:6px;">${week}</div>
  </td></tr>

  <!-- BODY -->
  <tr><td style="padding:32px 36px;">
    <p style="font-size:14px;color:#64748b;margin:0 0 20px;padding-bottom:16px;border-bottom:1px solid #f1f5f9;">
      Here's a summary of this week's progress across ${tasks.length} task${tasks.length > 1 ? 's' : ''}.
    </p>
    <table width="100%" cellpadding="0" cellspacing="0">${taskRows}</table>

    <!-- SUMMARY -->
    <div style="background:#f8fafc;border-radius:12px;padding:20px;margin-top:8px;">
      <div style="font-size:10px;color:#94a3b8;text-transform:uppercase;letter-spacing:2px;margin-bottom:14px;font-weight:700;">Week Summary</div>
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td align="center" style="padding:0 8px;">
            <div style="font-size:28px;font-weight:700;color:#1a1a2e;font-family:Georgia,serif;">${avg}%</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px;">Avg Progress</div>
          </td>
          <td align="center" style="padding:0 8px;border-left:1px solid #e2e8f0;">
            <div style="font-size:28px;font-weight:700;color:#16a34a;font-family:Georgia,serif;">${onTrack}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px;">On Track</div>
          </td>
          <td align="center" style="padding:0 8px;border-left:1px solid #e2e8f0;">
            <div style="font-size:28px;font-weight:700;color:#dc2626;font-family:Georgia,serif;">${behind}</div>
            <div style="font-size:11px;color:#94a3b8;margin-top:3px;">Needs Attention</div>
          </td>
        </tr>
      </table>
    </div>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#f8fafc;padding:18px 36px;border-top:1px solid #f1f5f9;">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-size:12px;color:#94a3b8;">
        ${replyTo}
      </td>
      <td align="right" style="font-size:12px;color:#94a3b8;white-space:nowrap;">
        Sent via <a href="${CONFIG.BRAND_URL}" style="color:#4f46e5;text-decoration:none;">${CONFIG.BRAND_NAME}</a>
      </td>
    </tr></table>
  </td></tr>

</table>
</td></tr>
</table>
</body>
</html>`;
}

function generateConfirmationHTML(name, managerEmail) {
  return `<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:40px auto;color:#1a1a2e;padding:24px;">
  <div style="background:linear-gradient(135deg,#1a1a2e,#0f3460);border-radius:16px;padding:36px;text-align:center;margin-bottom:24px;">
    <div style="font-size:48px;margin-bottom:12px;">📬</div>
    <h2 style="color:#fff;margin:0 0 8px;font-size:22px;">Report Sent!</h2>
    <p style="color:#64748b;margin:0;font-size:14px;">Your update is on its way</p>
  </div>
  <p style="font-size:15px;">Hi ${escHtml(name)},</p>
  <p style="font-size:14px;color:#374151;line-height:1.7;margin:12px 0;">
    Your weekly status report was successfully delivered to
    <strong>${escHtml(managerEmail)}</strong>. 
    They can reply directly to this thread to respond to you.
  </p>
  <p style="font-size:14px;color:#374151;line-height:1.7;">See you next week! ✅</p>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="font-size:12px;color:#9ca3af;text-align:center;">
    Sent via <a href="${CONFIG.BRAND_URL}" style="color:#4f46e5;text-decoration:none;">${CONFIG.BRAND_NAME}</a>
    — <a href="${CONFIG.UPGRADE_URL}" style="color:#4f46e5;text-decoration:none;">Upgrade to Pro</a>
  </p>
</body></html>`;
}

function buildPlainText(name, tasks, progress) {
  const week = getWeekString();
  let txt = `Weekly Status Report: ${name}\n${week}\n${'─'.repeat(40)}\n\n`;
  tasks.forEach((t, i) => {
    const c = getStatusColors(progress[i]);
    txt += `${i + 1}. ${t}\n   Progress: ${progress[i]}% — ${c.label}\n\n`;
  });
  const avg = Math.round(progress.reduce((a, b) => a + b, 0) / progress.length);
  txt += `─────────────────────\nAverage progress: ${avg}%\n`;
  txt += `\nSent via ${CONFIG.BRAND_NAME} (${CONFIG.BRAND_URL})`;
  return txt;
}

// ================================================================
// REMINDER SYSTEM (time-driven trigger)
// ================================================================

// Set up: Apps Script → Triggers → Add trigger
//   Function: sendWeeklyReminders
//   Event source: Time-driven → Week timer → Every Friday → 3–4 PM

function sendWeeklyReminders() {
  const sheet = getOrCreateSheet(CONFIG.SHEET_NAME_SUBMISSIONS);
  const data = sheet.getDataRange().getValues();

  // Collect unique user emails that have a confirmed userEmail stored
  const userEmails = new Set();
  for (let i = 1; i < data.length; i++) {
    const email = data[i][2]; // column C = userEmail
    if (email && isValidEmail(email)) userEmails.add(email.toLowerCase());
  }

  userEmails.forEach(email => {
    try {
      sendReminderEmail(email);
    } catch (err) {
      console.warn(`Reminder failed for ${email}:`, err);
    }
  });

  console.log(`Sent reminders to ${userEmails.size} users`);
}

function sendReminderEmail(userEmail) {
  const appUrl = `${CONFIG.BRAND_URL}/app.html?email=${encodeURIComponent(userEmail)}`;
  const html = `<!DOCTYPE html>
<html><body style="font-family:Arial,Helvetica,sans-serif;max-width:480px;margin:40px auto;color:#1a1a2e;padding:24px;">
  <div style="background:linear-gradient(135deg,#1a1a2e,#0f3460);border-radius:16px;padding:32px;text-align:center;margin-bottom:24px;">
    <div style="font-size:40px;margin-bottom:10px;">📊</div>
    <h2 style="color:#fff;margin:0 0 6px;font-size:20px;">Time for your weekly update</h2>
    <p style="color:#64748b;margin:0;font-size:13px;">It takes 60 seconds</p>
  </div>
  <p style="font-size:15px;color:#374151;line-height:1.7;">
    It's Friday! Send your weekly status report before the weekend — your manager will appreciate seeing it in their inbox today.
  </p>
  <div style="text-align:center;margin:28px 0;">
    <a href="${appUrl}" style="background:#1a1a2e;color:#fff;padding:14px 32px;border-radius:10px;text-decoration:none;font-weight:700;font-size:15px;">
      Send This Week's Report →
    </a>
  </div>
  <hr style="border:none;border-top:1px solid #e5e7eb;margin:24px 0;">
  <p style="font-size:11px;color:#9ca3af;text-align:center;">
    ${CONFIG.BRAND_NAME} · <a href="${CONFIG.BRAND_URL}" style="color:#4f46e5;text-decoration:none;">${CONFIG.BRAND_URL}</a>
  </p>
</body></html>`;

  GmailApp.sendEmail(userEmail, `⏰ Reminder: Send your weekly status report`, '', {
    htmlBody: html,
    name: CONFIG.BRAND_NAME,
  });
}

// ================================================================
// GOOGLE SHEETS LOGGING
// ================================================================

function logSubmission(name, userEmail, managerEmail, tasks, progress) {
  try {
    const sheet = getOrCreateSheet(CONFIG.SHEET_NAME_SUBMISSIONS);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(['Timestamp', 'Name', 'User Email', 'Manager Email',
        'Task 1', 'P1%', 'Task 2', 'P2%', 'Task 3', 'P3%']);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, 10).setFontWeight('bold');
    }
    sheet.appendRow([
      new Date().toISOString(),
      name, userEmail || '', managerEmail,
      tasks[0] || '', progress[0] || 0,
      tasks[1] || '', progress[1] || 0,
      tasks[2] || '', progress[2] || 0,
    ]);
  } catch (err) {
    console.warn('Sheet logging failed:', err.toString());
  }
}

function getWeeklyCount(userEmail) {
  try {
    const sheet = getOrCreateSheet(CONFIG.SHEET_NAME_SUBMISSIONS);
    const data = sheet.getDataRange().getValues();
    const now = new Date();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (now.getDay() === 0 ? 6 : now.getDay() - 1));
    mon.setHours(0, 0, 0, 0);

    return data.slice(1).filter(row => {
      const ts = new Date(row[0]);
      const email = (row[2] || '').toLowerCase();
      return email === userEmail.toLowerCase() && ts >= mon;
    }).length;
  } catch (err) {
    console.warn('getWeeklyCount failed:', err);
    return 0;
  }
}

function isProUser(userEmail) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = ss.getSheetByName(CONFIG.SHEET_NAME_PRO_USERS);
    if (!sheet) return false;
    const emails = sheet.getRange(2, 1, Math.max(sheet.getLastRow() - 1, 1), 1).getValues().flat();
    return emails.map(e => (e || '').toString().toLowerCase()).includes(userEmail.toLowerCase());
  } catch (err) {
    return false;
  }
}

// ================================================================
// UTILITIES
// ================================================================

function getOrCreateSheet(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function getStatusColors(pct) {
  if (pct >= 80) return { bar: '#16a34a', bg: '#e8f8f1', text: '#15803d', label: 'On Track', emoji: '✅' };
  if (pct >= 50) return { bar: '#d97706', bg: '#fef3c7', text: '#b45309', label: 'In Progress', emoji: '⚡' };
  return { bar: '#dc2626', bg: '#fee2e2', text: '#b91c1c', label: 'Behind', emoji: '⚠️' };
}

function getWeekString() {
  const now = new Date();
  const day = now.getDay();
  const diffToMon = (day === 0 ? -6 : 1 - day);
  const mon = new Date(now); mon.setDate(now.getDate() + diffToMon);
  const fri = new Date(mon); fri.setDate(mon.getDate() + 4);
  const fmt = d => Utilities.formatDate(d, Session.getScriptTimeZone(), 'MMM d');
  return `Week of ${fmt(mon)} – ${fmt(fri)}, ${fri.getFullYear()}`;
}

function escHtml(str) {
  return String(str || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitize(str, maxLen) {
  return String(str || '').trim().substring(0, maxLen);
}

function isValidEmail(email) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function jsonOut(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function err(msg) {
  return jsonOut({ status: 'error', message: msg });
}
