import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// Re-use the auth client across requests (built once)
// ---------------------------------------------------------------------------
let _authClient = null;

function getAuth() {
  if (_authClient) return _authClient;

  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS env var is not set');
  const { installed } = JSON.parse(raw);

  if (!installed?.client_id || !installed?.client_secret || !installed?.redirect_uris?.[0]) {
    throw new Error('GOOGLE_CREDENTIALS is missing required fields');
  }

  const oAuth2Client = new google.auth.OAuth2(
    installed.client_id,
    installed.client_secret,
    installed.redirect_uris[0]
  );

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) throw new Error('GOOGLE_REFRESH_TOKEN is not set');

  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  _authClient = oAuth2Client;
  return _authClient;
}

// ---------------------------------------------------------------------------
// Sanitize a cell value for safe storage in Google Sheets.
//
// Security: Using valueInputOption='RAW' prevents formula execution, but we
// also strip leading formula-trigger characters as a defence-in-depth measure.
// We also strip control characters and newlines to keep the sheet readable.
// ---------------------------------------------------------------------------
function sanitizeCell(value) {
  if (value === null || value === undefined) return '';
  const str = String(value)
    .replace(/[\x00-\x1F\x7F]/g, ' ')  // strip control chars
    .trim();

  // Strip formula-prefix characters as a belt-and-suspenders measure
  // (RAW mode already prevents execution, but this makes intent explicit)
  if (/^[=+\-@]/.test(str)) {
    return "'" + str; // prefix with single quote — harmless in RAW mode
  }
  return str;
}

// ---------------------------------------------------------------------------
// Validate required booking fields before writing
// ---------------------------------------------------------------------------
function validateLogInput(name, email, datetime, calendarLink) {
  const errors = [];
  if (!name || String(name).trim().length < 2)    errors.push('name is missing or too short');
  if (!email || !String(email).includes('@'))      errors.push('email is missing or invalid');
  if (!datetime || String(datetime).trim() === '') errors.push('datetime is missing');
  // calendarLink is optional but should be a URL if present
  if (calendarLink && typeof calendarLink === 'string' && calendarLink.length > 0) {
    if (!calendarLink.startsWith('https://')) {
      errors.push('calendarLink does not look like a valid URL');
    }
  }
  return errors;
}

// ---------------------------------------------------------------------------
// logBooking — append one row to the tracking sheet
//
// CRITICAL FIX: valueInputOption changed from 'USER_ENTERED' to 'RAW'.
//   USER_ENTERED allows Google Sheets to interpret formulae in cell values,
//   enabling formula injection attacks (e.g. =IMPORTRANGE(...)).
//   RAW stores the literal string, no formula execution.
// ---------------------------------------------------------------------------
export async function logBooking(name, email, datetime, calendarLink) {
  // Validate inputs before touching the Sheets API
  const errors = validateLogInput(name, email, datetime, calendarLink);
  if (errors.length > 0) {
    throw new Error(`logBooking validation failed: ${errors.join('; ')}`);
  }

  const sheetId = process.env.GOOGLE_SHEET_ID;
  if (!sheetId) throw new Error('GOOGLE_SHEET_ID is not set');

  const auth   = getAuth();
  const sheets = google.sheets({ version: 'v4', auth });

  // Timestamp is generated server-side — never from user input
  const timestamp = new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' });

  const row = [
    sanitizeCell(timestamp),
    sanitizeCell(name),
    sanitizeCell(email),
    sanitizeCell(datetime),
    sanitizeCell(calendarLink || ''),
  ];

  await Promise.resolve(sheets.spreadsheets.values.append({
    spreadsheetId: sheetId,
    range:         'Sheet1!A:E',
    // RAW: store literal values — formulas are NOT executed.
    // This prevents =IMPORTRANGE(), =HYPERLINK(), and similar injection attacks.
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    resource: { values: [row] },
  }));

  console.log('[sheetsService] booking logged to sheet');
}
