// api/user-dashboard.ts

import { VercelRequest, VercelResponse } from '@vercel/node';
import { google } from 'googleapis';
import {
  UserProfile,
  SessionTemplate,
  Event,
  Booking,
  DashboardResponse,
  APIResponse,
  SessionCard,
  RecommendationCard,
  UserStats,
} from '../types';

// ============================================
// CONFIGURATION
// ============================================

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const ONBOARDING_SHEET = process.env.ONBOARDING_SHEET_NAME || 'Onboarding Database';
const SESSIONS_SHEET = process.env.SESSIONS_SHEET_NAME || 'NBRH Sessions';
const EVENTS_SHEET = process.env.EVENTS_SHEET_NAME || 'NBRH Events';
const BOOKINGS_SHEET = process.env.BOOKINGS_SHEET_NAME || 'NBRH Bookings';

const CACHE_TTL_MS = 60 * 1000; // 60 seconds

// In-memory cache (lives within this function execution)
const cache = new Map<string, { data: any; timestamp: number }>();

// ============================================
// GOOGLE SHEETS CLIENT
// ============================================

function getGoogleSheetsClient() {
  const serviceAccountKey = JSON.parse(
    process.env.GOOGLE_SERVICE_ACCOUNT_KEY || '{}'
  );

  const auth = new google.auth.JWT({
    email: serviceAccountKey.client_email,
    key: serviceAccountKey.private_key,
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

// ============================================
// UTILITY: EMAIL NORMALIZATION
// ============================================

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// ============================================
// UTILITY: DATE/TIME HANDLING
// ============================================

function parseEventDateTime(date: string, time: string): Date | null {
  try {
    // Combine YYYY-MM-DD and HH:MM into ISO string in Europe/London timezone
    const dateTimeString = `${date}T${time}:00`;
    const parsed = new Date(dateTimeString);
    
    if (isNaN(parsed.getTime())) {
      return null;
    }
    
    return parsed;
  } catch {
    return null;
  }
}

function getNowInLondon(): Date {
  // For simplicity, using system time
  // In production, consider using a timezone library or API
  return new Date();
}

function getTimeBadge(eventDate: Date, now: Date): string {
  const diffMs = eventDate.getTime() - now.getTime();
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  if (diffDays < 1) return 'Today';
  if (diffDays < 2) return 'Tomorrow';
  if (diffDays < 7) return 'This week';
  if (diffDays < 14) return 'Next week';
  return '';
}

function getDayOfWeek(date: Date): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  return days[date.getDay()];
}

function getWeekNumber(date: Date): string {
  // Simple week calculation: Year + Week number
  const onejan = new Date(date.getFullYear(), 0, 1);
  const week = Math.ceil(((date.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
  return `${date.getFullYear()}-W${week}`;
}

// ============================================
// CACHE HELPERS
// ============================================

function getCachedData<T>(key: string): T | null {
  const cached = cache.get(key);
  if (!cached) return null;

  const age = Date.now() - cached.timestamp;
  if (age > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }

  return cached.data as T;
}

function setCachedData(key: string, data: any): void {
  cache.set(key, { data, timestamp: Date.now() });
}

// ============================================
// DATA FETCHING FUNCTIONS
// ============================================

async function fetchSheetData(sheetName: string): Promise<any[][]> {
  const cacheKey = `sheet:${sheetName}`;
  const cached = getCachedData<any[][]>(cacheKey);
  if (cached) {
    console.log(`[CACHE HIT] ${sheetName}`);
    return cached;
  }

  console.log(`[CACHE MISS] ${sheetName} - fetching from Google Sheets`);
  
  const sheets = getGoogleSheetsClient();
  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${sheetName}!A:Z`, // Adjust range as needed
  });

  const rows = response.data.values || [];
  setCachedData(cacheKey, rows);
  return rows;
}

export async function fetchUserProfile(email: string): Promise<UserProfile | null> {
  const normalizedEmail = normalizeEmail(email);
  const rows = await fetchSheetData(ONBOARDING_SHEET);

  if (rows.length < 2) return null; // No data rows

  const headers = rows[0].map((h: string) => h.trim());
  const emailIndex = headers.findIndex((h: string) => h.toLowerCase() === 'email');

  if (emailIndex === -1) {
    console.error('Email column not found in Onboarding Database');
    return null;
  }

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowEmail = normalizeEmail(row[emailIndex] || '');

    if (rowEmail === normalizedEmail) {
      // Map columns - adjust these indices if your sheet structure differs
      const getColumn = (name: string): string => {
        const idx = headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase());
        return idx >= 0 ? (row[idx] || '') : '';
      };

      return {
        email: normalizedEmail,
        firstName: getColumn('FirstName'),
        lastName: getColumn('LastName'),
        homeBorough: getColumn('HomeBorough'),
        preferredSports: getColumn('PreferredSports').split(',').map(s => s.trim()).filter(Boolean),
        preferredDays: getColumn('PreferredDays').split(',').map(s => s.trim()).filter(Boolean),
        preferredTimes: getColumn('PreferredTimes').split(',').map(s => s.trim()).filter(Boolean),
        fitnessLevel: getColumn('FitnessLevel'),
        motivations: getColumn('Motivations'),
      };
    }
  }

  return null;
}

export async function fetchUserBookings(email: string): Promise<Booking[]> {
  const normalizedEmail = normalizeEmail(email);
  const rows = await fetchSheetData(BOOKINGS_SHEET);

  if (rows.length < 2) return [];

  const headers = rows[0].map((h: string) => h.trim());
  const bookings: Booking[] = [];

  const getColumnIndex = (name: string): number => {
    return headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase().replace(/\s+/g, ''));
  };

  const bookingIDIndex = getColumnIndex('bookingid');
  const eventIDIndex = getColumnIndex('eventid');
  const userEmailIndex = getColumnIndex('useremail');
  const bookingDateTimeIndex = getColumnIndex('bookingdatetime');
  const paymentStatusIndex = getColumnIndex('paymentstatus');
  const attendanceStatusIndex = getColumnIndex('attendancestatus');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const rowEmail = normalizeEmail(row[userEmailIndex] || '');

    if (rowEmail === normalizedEmail) {
      bookings.push({
        bookingID: row[bookingIDIndex] || '',
        eventID: row[eventIDIndex] || '',
        userEmail: normalizedEmail,
        bookingDateTime: row[bookingDateTimeIndex] || '',
        paymentStatus: row[paymentStatusIndex] || '',
        attendanceStatus: (row[attendanceStatusIndex] || 'Pending') as any,
      });
    }
  }

  return bookings;
}

export async function fetchEventsByIds(eventIds: string[]): Promise<Map<string, Event>> {
  const rows = await fetchSheetData(EVENTS_SHEET);
  const eventMap = new Map<string, Event>();

  if (rows.length < 2) return eventMap;

  const headers = rows[0].map((h: string) => h.trim());

  const getColumnIndex = (name: string): number => {
    return headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase().replace(/\s+/g, ''));
  };

  const eventIDIndex = getColumnIndex('eventid');
  const sessionTemplateIDIndex = getColumnIndex('sessiontemplateid');
  const dateIndex = getColumnIndex('date');
  const startTimeIndex = getColumnIndex('starttime');
  const endTimeIndex = getColumnIndex('endtime');
  const venueIndex = getColumnIndex('venue');
  const boroughIndex = getColumnIndex('borough');
  const priceIndex = getColumnIndex('price');
  const capacityIndex = getColumnIndex('capacity');
  const statusIndex = getColumnIndex('status');
  const tagsIndex = getColumnIndex('tags');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const eventID = row[eventIDIndex] || '';

    if (eventIds.includes(eventID)) {
      eventMap.set(eventID, {
        eventID,
        sessionTemplateID: row[sessionTemplateIDIndex] || '',
        date: row[dateIndex] || '',
        startTime: row[startTimeIndex] || '',
        endTime: row[endTimeIndex] || '',
        venue: row[venueIndex] || '',
        borough: row[boroughIndex] || '',
        price: parseFloat(row[priceIndex] || '0'),
        capacity: parseInt(row[capacityIndex] || '0', 10),
        status: (row[statusIndex] || 'Active') as any,
        tags: (row[tagsIndex] || '').split(',').map(t => t.trim()).filter(Boolean),
      });
    }
  }

  return eventMap;
}

export async function fetchSessionTemplatesByIds(templateIds: string[]): Promise<Map<string, SessionTemplate>> {
  const rows = await fetchSheetData(SESSIONS_SHEET);
  const templateMap = new Map<string, SessionTemplate>();

  if (rows.length < 2) return templateMap;

  const headers = rows[0].map((h: string) => h.trim());

  const getColumnIndex = (name: string): number => {
    return headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase().replace(/\s+/g, ''));
  };

  const templateIDIndex = getColumnIndex('sessiontemplateid');
  const titleIndex = getColumnIndex('title');
  const sportIndex = getColumnIndex('sport');
  const difficultyIndex = getColumnIndex('difficulty');
  const durationIndex = getColumnIndex('defaultdurationminutes');
  const tagsIndex = getColumnIndex('tags');
  const descriptionIndex = getColumnIndex('description');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];
    const templateID = row[templateIDIndex] || '';

    if (templateIds.includes(templateID)) {
      templateMap.set(templateID, {
        sessionTemplateID: templateID,
        title: row[titleIndex] || '',
        sport: row[sportIndex] || '',
        difficulty: row[difficultyIndex] || '',
        defaultDurationMinutes: parseInt(row[durationIndex] || '60', 10),
        tags: (row[tagsIndex] || '').split(',').map(t => t.trim()).filter(Boolean),
        description: row[descriptionIndex] || '',
      });
    }
  }

  return templateMap;
}

export async function fetchAllEvents(): Promise<Event[]> {
  const rows = await fetchSheetData(EVENTS_SHEET);
  const events: Event[] = [];

  if (rows.length < 2) return events;

  const headers = rows[0].map((h: string) => h.trim());

  const getColumnIndex = (name: string): number => {
    return headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase().replace(/\s+/g, ''));
  };

  const eventIDIndex = getColumnIndex('eventid');
  const sessionTemplateIDIndex = getColumnIndex('sessiontemplateid');
  const dateIndex = getColumnIndex('date');
  const startTimeIndex = getColumnIndex('starttime');
  const endTimeIndex = getColumnIndex('endtime');
  const venueIndex = getColumnIndex('venue');
  const boroughIndex = getColumnIndex('borough');
  const priceIndex = getColumnIndex('price');
  const capacityIndex = getColumnIndex('capacity');
  const statusIndex = getColumnIndex('status');
  const tagsIndex = getColumnIndex('tags');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    events.push({
      eventID: row[eventIDIndex] || '',
      sessionTemplateID: row[sessionTemplateIDIndex] || '',
      date: row[dateIndex] || '',
      startTime: row[startTimeIndex] || '',
      endTime: row[endTimeIndex] || '',
      venue: row[venueIndex] || '',
      borough: row[boroughIndex] || '',
      price: parseFloat(row[priceIndex] || '0'),
      capacity: parseInt(row[capacityIndex] || '0', 10),
      status: (row[statusIndex] || 'Active') as any,
      tags: (row[tagsIndex] || '').split(',').map(t => t.trim()).filter(Boolean),
    });
  }

  return events;
}

export async function fetchAllSessionTemplates(): Promise<SessionTemplate[]> {
  const rows = await fetchSheetData(SESSIONS_SHEET);
  const templates: SessionTemplate[] = [];

  if (rows.length < 2) return templates;

  const headers = rows[0].map((h: string) => h.trim());

  const getColumnIndex = (name: string): number => {
    return headers.findIndex((h: string) => h.toLowerCase() === name.toLowerCase().replace(/\s+/g, ''));
  };

  const templateIDIndex = getColumnIndex('sessiontemplateid');
  const titleIndex = getColumnIndex('title');
  const sportIndex = getColumnIndex('sport');
  const difficultyIndex = getColumnIndex('difficulty');
  const durationIndex = getColumnIndex('defaultdurationminutes');
  const tagsIndex = getColumnIndex('tags');
  const descriptionIndex = getColumnIndex('description');

  for (let i = 1; i < rows.length; i++) {
    const row = rows[i];

    templates.push({
      sessionTemplateID: row[templateIDIndex] || '',
      title: row[titleIndex] || '',
      sport: row[sportIndex] || '',
      difficulty: row[difficultyIndex] || '',
      defaultDurationMinutes: parseInt(row[durationIndex] || '60', 10),
      tags: (row[tagsIndex] || '').split(',').map(t => t.trim()).filter(Boolean),
      description: row[descriptionIndex] || '',
    });
  }

  return templates;
}

// ============================================
// BUSINESS LOGIC: UPCOMING SESSIONS
// ============================================

export function computeUpcomingSessions(
  bookings: Booking[],
  events: Map<string, Event>,
  templates: Map<string, SessionTemplate>,
  now: Date
): SessionCard[] {
  const upcoming: SessionCard[] = [];

  for (const booking of bookings) {
    const event = events.get(booking.eventID);
    if (!event || event.status !== 'Active') continue;

    const eventDateTime = parseEventDateTime(event.date, event.startTime);
    if (!eventDateTime || eventDateTime <= now) continue;

    const template = templates.get(event.sessionTemplateID);
    if (!template) continue;

    upcoming.push({
      eventID: event.eventID,
      title: template.title,
      sport: template.sport,
      date: event.date,
      time: `${event.startTime} - ${event.endTime}`,
      venue: event.venue,
      borough: event.borough,
      price: event.price,
      difficulty: template.difficulty,
      badge: getTimeBadge(eventDateTime, now),
      bookingID: booking.bookingID,
    });
  }

  // Sort by date/time ascending
  upcoming.sort((a, b) => {
    const dateA = parseEventDateTime(a.date, a.time.split(' - ')[0]);
    const dateB = parseEventDateTime(b.date, b.time.split(' - ')[0]);
    if (!dateA || !dateB) return 0;
    return dateA.getTime() - dateB.getTime();
  });

  return upcoming.slice(0, 8); // Limit to 8
}

// ============================================
// BUSINESS LOGIC: PAST SESSIONS
// ============================================

export function computePastSessions(
  bookings: Booking[],
  events: Map<string, Event>,
  templates: Map<string, SessionTemplate>,
  now: Date,
  page: number = 1,
  pageSize: number = 10
): { sessions: SessionCard[]; total: number } {
  const past: SessionCard[] = [];

  for (const booking of bookings) {
    const event = events.get(booking.eventID);
    if (!event) continue; // Skip if event not found

    const eventDateTime = parseEventDateTime(event.date, event.startTime);
    if (!eventDateTime || eventDateTime > now) continue;

    const template = templates.get(event.sessionTemplateID);
    if (!template) continue;

    past.push({
      eventID: event.eventID,
      title: template.title,
      sport: template.sport,
      date: event.date,
      time: `${event.startTime} - ${event.endTime}`,
      venue: event.venue,
      borough: event.borough,
      price: event.price,
      difficulty: template.difficulty,
      bookingID: booking.bookingID,
      attendanceStatus: booking.attendanceStatus,
    });
  }

  // Sort by date/time descending (most recent first)
  past.sort((a, b) => {
    const dateA = parseEventDateTime(a.date, a.time.split(' - ')[0]);
    const dateB = parseEventDateTime(b.date, b.time.split(' - ')[0]);
    if (!dateA || !dateB) return 0;
    return dateB.getTime() - dateA.getTime();
  });

  const total = past.length;
  const start = (page - 1) * pageSize;
  const end = start + pageSize;
  const paginated = past.slice(start, end);

  return { sessions: paginated, total };
}

// ============================================
// BUSINESS LOGIC: USER STATS
// ============================================

export function computeUserStats(
  bookings: Booking[],
  events: Map<string, Event>,
  templates: Map<string, SessionTemplate>
): UserStats {
  let totalBooked = bookings.length;
  let totalAttended = 0;
  let totalHoursPlayed = 0;
  let totalSpent = 0;
  const sportCounts: Record<string, number> = {};
  const dayCounts: Record<string, number> = {};
  const weekSet = new Set<string>();

  for (const booking of bookings) {
    const event = events.get(booking.eventID);
    if (!event) continue;

    const template = templates.get(event.sessionTemplateID);
    
    // Count spend (all bookings with Paid status)
    if (booking.paymentStatus === 'Paid') {
      totalSpent += event.price;
    }

    // Only count attended sessions for other stats
    if (booking.attendanceStatus === 'Attended') {
      totalAttended++;

      if (template) {
        // Sport tracking
        sportCounts[template.sport] = (sportCounts[template.sport] || 0) + 1;
      }

      // Hours played
      const startDateTime = parseEventDateTime(event.date, event.startTime);
      const endDateTime = parseEventDateTime(event.date, event.endTime);
      if (startDateTime && endDateTime) {
        const durationHours = (endDateTime.getTime() - startDateTime.getTime()) / (1000 * 60 * 60);
        totalHoursPlayed += durationHours;

        // Day of week tracking
        const dayOfWeek = getDayOfWeek(startDateTime);
        dayCounts[dayOfWeek] = (dayCounts[dayOfWeek] || 0) + 1;

        // Weekly consistency
        const weekKey = getWeekNumber(startDateTime);
        weekSet.add(weekKey);
      }
    }
  }

  // Find most played sport
  let mostPlayedSport: string | null = null;
  let maxSportCount = 0;
  for (const [sport, count] of Object.entries(sportCounts)) {
    if (count > maxSportCount) {
      maxSportCount = count;
      mostPlayedSport = sport;
    }
  }

  // Find most common day
  let mostCommonDay: string | null = null;
  let maxDayCount = 0;
  for (const [day, count] of Object.entries(dayCounts)) {
    if (count > maxDayCount) {
      maxDayCount = count;
      mostCommonDay = day;
    }
  }

  return {
    totalBooked,
    totalAttended,
    totalHoursPlayed: Math.round(totalHoursPlayed * 10) / 10, // Round to 1 decimal
    totalSpent: Math.round(totalSpent * 100) / 100, // Round to 2 decimals
    mostPlayedSport,
    mostCommonDay,
    weeklyConsistency: weekSet.size,
  };
}

// ============================================
// BUSINESS LOGIC: RECOMMENDATIONS
// ============================================

export function computeRecommendations(
  userProfile: UserProfile | null,
  bookings: Booking[],
  events: Map<string, Event>,
  templates: Map<string, SessionTemplate>,
  allEvents: Event[],
  allTemplates: SessionTemplate[],
  now: Date
): RecommendationCard[] {
  // Get all booked event IDs
  const bookedEventIds = new Set(bookings.map(b => b.eventID));

  // Build a map of templates for quick lookup
  const templateMap = new Map<string, SessionTemplate>();
  allTemplates.forEach(t => templateMap.set(t.sessionTemplateID, t));

  // Calculate user's sport history
  const sportHistory: Record<string, number> = {};
  const boroughHistory: Record<string, number> = {};
  const recentBookings = bookings.slice(-10); // Last 10 bookings get higher weight

  for (const booking of bookings) {
    const event = events.get(booking.eventID);
    if (!event) continue;

    const template = templates.get(event.sessionTemplateID);
    if (template) {
      const weight = recentBookings.includes(booking) ? 2 : 1;
      sportHistory[template.sport] = (sportHistory[template.sport] || 0) + weight;
      boroughHistory[event.borough] = (boroughHistory[event.borough] || 0) + weight;
    }
  }

  // Score each future active event
  const scored: Array<{ event: Event; template: SessionTemplate; score: number; reason: string }> = [];

  for (const event of allEvents) {
    // Filter criteria
    if (bookedEventIds.has(event.eventID)) continue;
    if (event.status !== 'Active') continue;

    const eventDateTime = parseEventDateTime(event.date, event.startTime);
    if (!eventDateTime || eventDateTime <= now) continue;

    const template = templateMap.get(event.sessionTemplateID);
    if (!template) continue;

    // Calculate score
    let score = 0;
    const reasons: string[] = [];

    // Sport match (history has higher weight than preferences)
    if (sportHistory[template.sport]) {
      score += sportHistory[template.sport] * 10;
      reasons.push(`you often book ${template.sport}`);
    } else if (userProfile?.preferredSports.includes(template.sport)) {
      score += 5;
      reasons.push(`you like ${template.sport}`);
    }

    // Borough match
    if (boroughHistory[event.borough]) {
      score += boroughHistory[event.borough] * 5;
      reasons.push(`in ${event.borough} where you usually go`);
    } else if (userProfile?.homeBorough === event.borough) {
      score += 3;
      reasons.push(`in your home borough ${event.borough}`);
    }

    // Day/time match (simplified)
    if (eventDateTime) {
      const dayOfWeek = getDayOfWeek(eventDateTime);
      const hour = parseInt(event.startTime.split(':')[0], 10);
      
      if (userProfile?.preferredDays.includes(dayOfWeek)) {
        score += 3;
        reasons.push(`on ${dayOfWeek}`);
      }

      if (userProfile?.preferredTimes.includes('Morning') && hour < 12) {
        score += 2;
      } else if (userProfile?.preferredTimes.includes('Afternoon') && hour >= 12 && hour < 17) {
        score += 2;
      } else if (userProfile?.preferredTimes.includes('Evening') && hour >= 17) {
        score += 2;
        reasons.push('in the evening');
      }
    }

    // Proximity bonus (events within next 7 days)
    if (eventDateTime) {
      const daysUntil = (eventDateTime.getTime() - now.getTime()) / (1000 * 60 * 60 * 24);
      if (daysUntil < 7) {
        score += 2;
        reasons.push('coming soon');
      }
    }

    // Price preference (lower is slightly better)
    if (event.price < 10) {
      score += 1;
    }

    // Build reason string
    const reason = reasons.length > 0
      ? `Recommended because ${reasons.slice(0, 2).join(' and ')}.`
      : 'Popular session in your area.';

    scored.push({ event, template, score, reason });
  }

  // Sort by score (desc), then by date (asc), then by price (asc)
  scored.sort((a, b) => {
    if (a.score !== b.score) return b.score - a.score;
    
    const dateA = parseEventDateTime(a.event.date, a.event.startTime);
    const dateB = parseEventDateTime(b.event.date, b.event.startTime);
    if (dateA && dateB && dateA.getTime() !== dateB.getTime()) {
      return dateA.getTime() - dateB.getTime();
    }
    
    return a.event.price - b.event.price;
  });

  // Take top 6 recommendations
  return scored.slice(0, 6).map(({ event, template, score, reason }) => ({
    eventID: event.eventID,
    title: template.title,
    sport: template.sport,
    date: event.date,
    time: `${event.startTime} - ${event.endTime}`,
    venue: event.venue,
    borough: event.borough,
    price: event.price,
    difficulty: template.difficulty,
    score,
    reason,
  }));
}

// ============================================
// MAIN HANDLER
// ============================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
): Promise<void> {
  // Set CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    res.status(200).end();
    return;
  }

  if (req.method !== 'GET') {
    res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Only GET requests allowed' },
    });
    return;
  }

  try {
    // Extract and validate email
    const rawEmail = (req.query.email as string) || '';
    
    if (!rawEmail || !rawEmail.includes('@')) {
      res.status(400).json({
        success: false,
        error: { code: 'INVALID_EMAIL', message: 'Valid email address required' },
      });
      return;
    }

    const email = normalizeEmail(rawEmail);
    console.log(`[API] Dashboard request for: ${email}`);

    // Pagination params
    const page = parseInt((req.query.page as string) || '1', 10);
    const pageSize = parseInt((req.query.pageSize as string) || '10', 10);

    const now = getNowInLondon();

    // Fetch user profile
    const userProfile = await fetchUserProfile(email);
    
    if (!userProfile) {
      console.log(`[API] User not found: ${email}`);
      res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'No profile found for this email' },
      });
      return;
    }

    // Fetch user bookings
    const bookings = await fetchUserBookings(email);
    console.log(`[API] Found ${bookings.length} bookings for ${email}`);

    // Fetch related events
    const eventIds = bookings.map(b => b.eventID);
    const eventsMap = await fetchEventsByIds(eventIds);

    // Fetch related templates
    const templateIds = Array.from(new Set(
      Array.from(eventsMap.values()).map(e => e.sessionTemplateID)
    ));
    const templatesMap = await fetchSessionTemplatesByIds(templateIds);

    // Compute upcoming sessions
    const upcomingSessions = computeUpcomingSessions(bookings, eventsMap, templatesMap, now);

    // Compute past sessions with pagination
    const { sessions: pastSessions, total: pastSessionsTotal } = computePastSessions(
      bookings,
      eventsMap,
      templatesMap,
      now,
      page,
      pageSize
    );

    // Compute stats
    const stats = computeUserStats(bookings, eventsMap, templatesMap);

    // Fetch all events and templates for recommendations
    const allEvents = await fetchAllEvents();
    const allTemplates = await fetchAllSessionTemplates();

    // Compute recommendations
    const recommendations = computeRecommendations(
      userProfile,
      bookings,
      eventsMap,
      templatesMap,
      allEvents,
      allTemplates,
      now
    );

    // Build response
    const response: APIResponse<DashboardResponse> = {
      success: true,
      data: {
        profile: userProfile,
        upcomingSessions,
        pastSessions,
        pastSessionsTotal,
        stats,
        recommendations,
      },
    };

    res.status(200).json(response);
  } catch (error: any) {
    console.error('[API ERROR]', error);
    
    // Check if it's a Google Sheets error
    const isGoogleError = error.message?.includes('spreadsheet') || 
                          error.code === 403 || 
                          error.code === 404;

    res.status(500).json({
      success: false,
      error: {
        code: isGoogleError ? 'SHEETS_ERROR' : 'INTERNAL_ERROR',
        message: isGoogleError 
          ? 'Failed to access Google Sheets. Check permissions and sheet names.'
          : 'An unexpected error occurred.',
      },
    });
  }
}
