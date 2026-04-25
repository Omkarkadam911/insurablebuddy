import { google } from 'googleapis';
import dotenv from 'dotenv';

dotenv.config();

// ---------------------------------------------------------------------------
// Validation constants
// ---------------------------------------------------------------------------
// Requires at least one dot in the domain (i.e. a TLD): user@example.com ✓, user@example ✗
const EMAIL_REGEX = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;

// ISO datetime without timezone: 2026-03-20T15:00 or 2026-03-20T15:00:00
const ISO_DATETIME_REGEX = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;

// Business hours in Europe/London (inclusive)
const BUSINESS_HOUR_START = 9;
const BUSINESS_HOUR_END   = 17; // last slot = 17:00 → call ends 17:30

const BOOKING_TIMEZONE = 'Europe/London';

// ---------------------------------------------------------------------------
// Build the auth client once per process (credential file is static)
// ---------------------------------------------------------------------------
let _authClient = null;

function getAuth() {
  if (_authClient) return _authClient;

  const raw = process.env.GOOGLE_CREDENTIALS;
  if (!raw) throw new Error('GOOGLE_CREDENTIALS env var is not set');
  const { installed } = JSON.parse(raw);

  if (!installed?.client_id || !installed?.client_secret || !installed?.redirect_uris?.[0]) {
    throw new Error('GOOGLE_CREDENTIALS is missing required fields (client_id / client_secret / redirect_uris)');
  }

  const oAuth2Client = new google.auth.OAuth2(
    installed.client_id,
    installed.client_secret,
    installed.redirect_uris[0]
  );

  const refreshToken = process.env.GOOGLE_REFRESH_TOKEN;
  if (!refreshToken) {
    throw new Error('GOOGLE_REFRESH_TOKEN is not set');
  }

  oAuth2Client.setCredentials({ refresh_token: refreshToken });
  _authClient = oAuth2Client;
  return _authClient;
}

// ---------------------------------------------------------------------------
// validateBookingInput — exported so reactAgent can pre-screen before API call
//
// Returns an array of error strings (empty = valid).
// ---------------------------------------------------------------------------
export function validateBookingInput(name, email, datetimeStr, timezone = BOOKING_TIMEZONE) {
  const errors = [];

  if (!name || typeof name !== 'string' || name.trim().length < 2) {
    errors.push('Name must be at least 2 characters');
  } else if (name.trim().length > 100) {
    errors.push('Name must be under 100 characters');
  }

  if (!email || typeof email !== 'string') {
    errors.push('Email is required');
  } else if (!EMAIL_REGEX.test(email.trim())) {
    errors.push('Email address is not valid');
  }

  if (!datetimeStr || typeof datetimeStr !== 'string') {
    errors.push('Datetime is required');
  } else if (!ISO_DATETIME_REGEX.test(datetimeStr.trim())) {
    errors.push('Datetime must be in ISO format: 2026-03-20T15:00:00');
  } else {
    const dt = parseDatetimeInTz(datetimeStr.trim(), timezone);

    if (!dt || isNaN(dt.getTime())) {
      errors.push('Datetime is not a valid date/time value');
    } else {
      const now = new Date();
      if (dt <= now) {
        errors.push('Booking time must be in the future');
      }

      const maxDate = new Date(now.getTime() + 60 * 24 * 60 * 60 * 1000);
      if (dt > maxDate) {
        errors.push('Bookings can only be made up to 60 days in advance');
      }

      const localHour = getHourInTz(dt, timezone);
      if (localHour < BUSINESS_HOUR_START || localHour > BUSINESS_HOUR_END) {
        errors.push(
          `Booking must be between ${BUSINESS_HOUR_START}:00 and ${BUSINESS_HOUR_END}:00 ` +
          `(provided hour: ${localHour})`
        );
      }

      const localDay = getDayOfWeekInTz(dt, timezone); // 0=Sun, 6=Sat
      if (localDay === 0 || localDay === 6) {
        errors.push('Bookings are only available Monday to Friday');
      }
    }
  }

  return errors;
}

// ---------------------------------------------------------------------------
// Parse a naive ISO datetime string as local time in the given timezone.
// e.g. "2026-03-20T15:00:00" + "Asia/Singapore" → UTC moment when SG clock shows 15:00
// ---------------------------------------------------------------------------
function parseDatetimeInTz(isoStr, tz) {
  // Step 1: assume UTC first to get a rough epoch
  const roughUtc = new Date(isoStr + 'Z');
  if (isNaN(roughUtc.getTime())) return null;

  // Step 2: find what the target timezone displays for that UTC moment
  const formatter = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });

  const parts = formatter.formatToParts(roughUtc);
  const p = {};
  parts.forEach(({ type, value }) => { p[type] = value; });
  const tzOffset =
    roughUtc.getTime() -
    Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);

  // Step 3: actual UTC instant = naive local time + offset
  return new Date(roughUtc.getTime() + tzOffset);
}

function getHourInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', hour12: false,
  }).formatToParts(utcDate);
  return parseInt(parts.find(p => p.type === 'hour').value, 10);
}

function getDayOfWeekInTz(utcDate, tz) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, weekday: 'short',
  }).formatToParts(utcDate);
  const day = parts.find(p => p.type === 'weekday').value;
  return ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(day);
}

// ---------------------------------------------------------------------------
// Check if a time slot is already booked (basic conflict detection)
// Returns true if a conflicting event exists
// ---------------------------------------------------------------------------
async function hasConflict(calendar, calendarId, datetimeStr, tz) {
  const start = parseDatetimeInTz(datetimeStr.trim(), tz);
  if (!start) return false;
  const end   = new Date(start.getTime() + 30 * 60 * 1000);

  try {
    const res = await calendar.events.list({
      calendarId,
      timeMin: start.toISOString(),
      timeMax: end.toISOString(),
      singleEvents: true,
      orderBy: 'startTime',
    });
    return (res.data.items || []).length > 0;
  } catch (err) {
    console.error('[calendarService] conflict check failed:', err.message);
    throw new Error('Could not verify availability — please try again in a moment.');
  }
}

// ---------------------------------------------------------------------------
// bookCall — creates a 30-min Google Calendar event
//
// TIMEZONE FIX: Pass the raw datetime string with timeZone field rather than
// converting to UTC via toISOString().  This ensures "15:00" means 15:00
// London time, not 15:00 UTC which would be 16:00 BST.
// ---------------------------------------------------------------------------
export async function bookCall(name, email, datetimeStr, timezone = BOOKING_TIMEZONE) {
  // Validation (second line of defence — reactAgent also validates)
  const errors = validateBookingInput(name, email, datetimeStr, timezone);
  if (errors.length > 0) {
    throw new Error(`Invalid booking input: ${errors.join('; ')}`);
  }

  const auth     = getAuth();
  const calendar = google.calendar({ version: 'v3', auth });
  const calId    = process.env.GOOGLE_CALENDAR_ID || 'primary';

  // Conflict detection
  const conflict = await hasConflict(calendar, calId, datetimeStr, timezone);
  if (conflict) {
    throw new Error(`The time slot ${datetimeStr} is already booked. Please choose a different time.`);
  }

  // Calculate end time (30 min) — stay in the same local representation
  const startUtc = parseDatetimeInTz(datetimeStr.trim(), timezone);
  const endUtc   = new Date(startUtc.getTime() + 30 * 60 * 1000);

  // Format end time as naive ISO string in the user's timezone
  const endNaive = formatAsNaiveInTz(endUtc, timezone);

  const event = {
    summary:     `Call with ${name.trim()}`,
    description: 'Booked via Insurable Buddy chatbot',
    start: {
      dateTime: datetimeStr.trim(), // e.g. "2026-03-20T15:00:00"
      timeZone: timezone,           // Google interprets it in the user's timezone
    },
    end: {
      dateTime: endNaive,
      timeZone: timezone,
    },
    attendees: [{ email: email.trim() }],
  };

  const response = await calendar.events.insert({
    calendarId: calId,
    resource:   event,
    sendUpdates: 'all',
  });

  console.log('[calendarService] event created:', response.data.htmlLink);
  return response.data;
}

// ---------------------------------------------------------------------------
// Format a UTC Date as a naive ISO string in the given timezone (no trailing Z)
// e.g. for the end time of the calendar event
// ---------------------------------------------------------------------------
function formatAsNaiveInTz(utcDate, tz) {
  const fmt = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  });
  const parts = {};
  fmt.formatToParts(utcDate).forEach(({ type, value }) => { parts[type] = value; });
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}
