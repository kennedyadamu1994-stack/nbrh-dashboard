import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const ONBOARDING_SHEET = 'Onboarding Database';
const EVENTS_SHEET = 'NBRH Events';
const BOOKINGS_SHEET = 'NBRH Bookings';

// ==========================================
// TYPES
// ==========================================

interface UserProfile {
  email: string;
  firstName: string;
  lastName: string;
  homeBorough: string;
  preferredSports: string[];
  preferredDays: string[];
  preferredTimes: string[];
  fitnessLevel: string;
  motivations: string;
}

interface Event {
  eventID: string;
  eventName: string;
  category: string;
  date: string;
  time: string;
  endTime: string;
  location: string;
  price: number;
  spotsRemaining: number;
  bookingUrl: string;
  durationMinutes: number;
  active: string;
}

interface Booking {
  bookingID: string;
  bookingDate: string;
  eventID: string;
  eventName: string;
  customerEmail: string;
  amountPaid: string;
  status: string;
  skillLevel: string;
  eventDate: string;
  eventTime: string;
  eventLocation: string;
}

interface SessionCard {
  eventID: string;
  title: string;
  sport: string;
  date: string;
  time: string;
  venue: string;
  borough: string;
  price: number;
  badge?: string;
  difficulty: string;
  bookingID: string;
  attendanceStatus?: string;
}

interface RecommendationCard {
  eventID: string;
  title: string;
  sport: string;
  date: string;
  time: string;
  venue: string;
  borough: string;
  price: number;
  difficulty: string;
  score: number;
  reason: string;
}

interface UserStats {
  totalBooked: number;
  totalAttended: number;
  totalHoursPlayed: number;
  totalSpent: number;
  mostPlayedSport: string | null;
  mostCommonDay: string | null;
}

interface DashboardResponse {
  profile: UserProfile | null;
  upcomingSessions: SessionCard[];
  pastSessions: SessionCard[];
  pastSessionsTotal: number;
  stats: UserStats;
  recommendations: RecommendationCard[];
}

// ==========================================
// UTILITIES
// ==========================================

function getColumnIndex(headers: any[], columnName: string): number {
  const normalized = columnName.toLowerCase().replace(/\s+/g, '').replace(/[()£_]/g, '');
  return headers.findIndex(
    (h) => h?.toString().toLowerCase().replace(/\s+/g, '').replace(/[()£_]/g, '') === normalized
  );
}

async function getSheets() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is missing');
  }
  
  const credentials = JSON.parse(serviceAccountKey);
  
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

function parseCommaSeparated(value: string): string[] {
  if (!value) return [];
  return value.split(',').map(v => v.trim()).filter(v => v.length > 0);
}

function parsePrice(value: string): number {
  if (!value) return 0;
  const cleaned = value.toString().replace(/[£,\s]/g, '');
  return parseFloat(cleaned) || 0;
}

function formatTime(time: string): string {
  if (!time) return '';
  return time;
}

function getDateBadge(date: string): string | undefined {
  try {
    const eventDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    eventDate.setHours(0, 0, 0, 0);
    
    const diffTime = eventDate.getTime() - today.getTime();
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    
    if (diffDays === 0) return 'Today';
    if (diffDays === 1) return 'Tomorrow';
    if (diffDays > 0 && diffDays <= 7) return 'This week';
    if (diffDays > 7 && diffDays <= 14) return 'Next week';
    return undefined;
  } catch {
    return undefined;
  }
}

function getDayOfWeek(date: string): string | null {
  try {
    const d = new Date(date);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    return days[d.getDay()];
  } catch {
    return null;
  }
}

function extractBorough(location: string): string {
  // Try to extract borough from location string
  // Typical format might be "Venue Name, Borough" or just "Borough"
  if (!location) return '';
  const parts = location.split(',');
  if (parts.length > 1) {
    return parts[parts.length - 1].trim();
  }
  return location.trim();
}

// ==========================================
// DATA FETCHING
// ==========================================

async function fetchUserProfile(email: string): Promise<UserProfile | null> {
  const sheets = await getSheets();
  const normalizedEmail = email.toLowerCase().trim();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ONBOARDING_SHEET}!A:Z`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return null;

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const emailIdx = getColumnIndex(headers, 'Email');
  const nameIdx = getColumnIndex(headers, 'Name');
  const boroughIdx = getColumnIndex(headers, 'Home Borough');
  const favouriteActivityIdx = getColumnIndex(headers, 'Favourite Activity');
  const experienceLevelIdx = getColumnIndex(headers, 'Experience Level');
  const otherActivitiesIdx = getColumnIndex(headers, 'Other Activities Interested In');

  if (emailIdx === -1) {
    throw new Error('Email column not found in Onboarding Database');
  }

  const userRow = dataRows.find(
    (row) => row[emailIdx]?.toString().toLowerCase().trim() === normalizedEmail
  );

  if (!userRow) return null;

  const fullName = nameIdx !== -1 ? userRow[nameIdx]?.toString() || '' : '';
  const nameParts = fullName.split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  // Build preferred sports from Favourite Activity and Other Activities
  const preferredSports: string[] = [];
  if (favouriteActivityIdx !== -1 && userRow[favouriteActivityIdx]) {
    preferredSports.push(userRow[favouriteActivityIdx].toString());
  }
  if (otherActivitiesIdx !== -1 && userRow[otherActivitiesIdx]) {
    const otherActivities = parseCommaSeparated(userRow[otherActivitiesIdx].toString());
    preferredSports.push(...otherActivities);
  }

  return {
    email: userRow[emailIdx]?.toString() || '',
    firstName,
    lastName,
    homeBorough: boroughIdx !== -1 ? userRow[boroughIdx]?.toString() || '' : '',
    preferredSports: preferredSports.length > 0 ? preferredSports : [],
    preferredDays: [],
    preferredTimes: [],
    fitnessLevel: experienceLevelIdx !== -1 ? userRow[experienceLevelIdx]?.toString() || '' : '',
    motivations: '',
  };
}

async function fetchEvents(): Promise<Event[]> {
  const sheets = await getSheets();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${EVENTS_SHEET}!A:Z`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const eventIDIdx = getColumnIndex(headers, 'event_id');
  const eventNameIdx = getColumnIndex(headers, 'event_name');
  const categoryIdx = getColumnIndex(headers, 'Category');
  const dateIdx = getColumnIndex(headers, 'date');
  const timeIdx = getColumnIndex(headers, 'time');
  const endTimeIdx = getColumnIndex(headers, 'End Time');
  const locationIdx = getColumnIndex(headers, 'location');
  const priceIdx = getColumnIndex(headers, 'base_price');
  const spotsRemainingIdx = getColumnIndex(headers, 'spots_remaining');
  const bookingUrlIdx = getColumnIndex(headers, 'booking_url');
  const durationIdx = getColumnIndex(headers, 'Duration Minutes');
  const activeIdx = getColumnIndex(headers, 'active');

  const events: Event[] = [];

  for (const row of dataRows) {
    if (!row[eventIDIdx]) continue;

    const event: Event = {
      eventID: row[eventIDIdx]?.toString() || '',
      eventName: eventNameIdx !== -1 ? row[eventNameIdx]?.toString() || '' : '',
      category: categoryIdx !== -1 ? row[categoryIdx]?.toString() || '' : '',
      date: dateIdx !== -1 ? row[dateIdx]?.toString() || '' : '',
      time: timeIdx !== -1 ? row[timeIdx]?.toString() || '' : '',
      endTime: endTimeIdx !== -1 ? row[endTimeIdx]?.toString() || '' : '',
      location: locationIdx !== -1 ? row[locationIdx]?.toString() || '' : '',
      price: priceIdx !== -1 ? parsePrice(row[priceIdx]?.toString() || '0') : 0,
      spotsRemaining: spotsRemainingIdx !== -1 ? parseInt(row[spotsRemainingIdx]?.toString() || '0') : 0,
      bookingUrl: bookingUrlIdx !== -1 ? row[bookingUrlIdx]?.toString() || '' : '',
      durationMinutes: durationIdx !== -1 ? parseInt(row[durationIdx]?.toString() || '60') : 60,
      active: activeIdx !== -1 ? row[activeIdx]?.toString() || 'TRUE' : 'TRUE',
    };

    events.push(event);
  }

  return events;
}

async function fetchBookings(email: string): Promise<Booking[]> {
  const sheets = await getSheets();
  const normalizedEmail = email.toLowerCase().trim();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${BOOKINGS_SHEET}!A:Z`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const bookingIDIdx = getColumnIndex(headers, 'booking_id');
  const bookingDateIdx = getColumnIndex(headers, 'booking_date');
  const eventIDIdx = getColumnIndex(headers, 'event_id');
  const eventNameIdx = getColumnIndex(headers, 'event_name');
  const customerEmailIdx = getColumnIndex(headers, 'customer_email');
  const amountPaidIdx = getColumnIndex(headers, 'amount_paid');
  const statusIdx = getColumnIndex(headers, 'status');
  const skillLevelIdx = getColumnIndex(headers, 'skill_level');
  const eventDateIdx = getColumnIndex(headers, 'event_date');
  const eventTimeIdx = getColumnIndex(headers, 'event_time');
  const eventLocationIdx = getColumnIndex(headers, 'event_location');

  if (customerEmailIdx === -1) {
    return [];
  }

  const bookings: Booking[] = [];

  for (const row of dataRows) {
    if (row[customerEmailIdx]?.toString().toLowerCase().trim() !== normalizedEmail) continue;

    const booking: Booking = {
      bookingID: bookingIDIdx !== -1 ? row[bookingIDIdx]?.toString() || '' : '',
      bookingDate: bookingDateIdx !== -1 ? row[bookingDateIdx]?.toString() || '' : '',
      eventID: eventIDIdx !== -1 ? row[eventIDIdx]?.toString() || '' : '',
      eventName: eventNameIdx !== -1 ? row[eventNameIdx]?.toString() || '' : '',
      customerEmail: row[customerEmailIdx]?.toString() || '',
      amountPaid: amountPaidIdx !== -1 ? row[amountPaidIdx]?.toString() || '' : '',
      status: statusIdx !== -1 ? row[statusIdx]?.toString() || 'Confirmed' : 'Confirmed',
      skillLevel: skillLevelIdx !== -1 ? row[skillLevelIdx]?.toString() || '' : '',
      eventDate: eventDateIdx !== -1 ? row[eventDateIdx]?.toString() || '' : '',
      eventTime: eventTimeIdx !== -1 ? row[eventTimeIdx]?.toString() || '' : '',
      eventLocation: eventLocationIdx !== -1 ? row[eventLocationIdx]?.toString() || '' : '',
    };

    bookings.push(booking);
  }

  return bookings;
}

// ==========================================
// DATA TRANSFORMATION
// ==========================================

function createSessionCardFromBooking(booking: Booking, event: Event | undefined, isPast: boolean): SessionCard {
  // Use event data if available, otherwise fall back to booking data
  const eventName = event?.eventName || booking.eventName;
  const eventDate = event?.date || booking.eventDate;
  const eventTime = event?.time || booking.eventTime;
  const location = event?.location || booking.eventLocation;
  const price = event?.price || parsePrice(booking.amountPaid);
  const category = event?.category || '';

  return {
    eventID: booking.eventID,
    title: eventName,
    sport: category,
    date: eventDate,
    time: formatTime(eventTime),
    venue: location,
    borough: extractBorough(location),
    price,
    badge: isPast ? undefined : getDateBadge(eventDate),
    difficulty: booking.skillLevel || '',
    bookingID: booking.bookingID,
    attendanceStatus: isPast ? booking.status : undefined,
  };
}

function separateSessions(
  bookings: Booking[],
  events: Event[],
  page: number,
  pageSize: number
): { upcoming: SessionCard[]; past: SessionCard[]; pastTotal: number } {
  const eventMap = new Map(events.map(e => [e.eventID, e]));
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const upcoming: SessionCard[] = [];
  const past: SessionCard[] = [];

  for (const booking of bookings) {
    const event = eventMap.get(booking.eventID);
    const eventDate = new Date(event?.date || booking.eventDate);
    eventDate.setHours(0, 0, 0, 0);
    const isPast = eventDate < now;

    const card = createSessionCardFromBooking(booking, event, isPast);

    if (isPast) {
      past.push(card);
    } else {
      upcoming.push(card);
    }
  }

  // Sort upcoming by date (ascending)
  upcoming.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

  // Sort past by date (descending)
  past.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const pastTotal = past.length;
  const start = (page - 1) * pageSize;
  const paginatedPast = past.slice(start, start + pageSize);

  return {
    upcoming,
    past: paginatedPast,
    pastTotal,
  };
}

// ==========================================
// STATISTICS
// ==========================================

function calculateStats(bookings: Booking[], events: Event[]): UserStats {
  const eventMap = new Map(events.map(e => [e.eventID, e]));
  
  // Count attended sessions (status = "Confirmed" or similar)
  const attended = bookings.filter(b => {
    const eventDate = new Date(b.eventDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    return eventDate < now && b.status.toLowerCase() !== 'cancelled';
  });

  const totalSpent = bookings.reduce((sum, b) => {
    return sum + parsePrice(b.amountPaid);
  }, 0);

  let totalMinutes = 0;
  const sportCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();

  for (const booking of attended) {
    const event = eventMap.get(booking.eventID);
    if (event) {
      totalMinutes += event.durationMinutes;
      if (event.category) {
        sportCounts.set(event.category, (sportCounts.get(event.category) || 0) + 1);
      }
    }

    const day = getDayOfWeek(booking.eventDate);
    if (day) {
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    }
  }

  const mostPlayedSport = sportCounts.size > 0
    ? Array.from(sportCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const mostCommonDay = dayCounts.size > 0
    ? Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return {
    totalBooked: bookings.length,
    totalAttended: attended.length,
    totalHoursPlayed: Math.round((totalMinutes / 60) * 10) / 10,
    totalSpent: Math.round(totalSpent * 100) / 100,
    mostPlayedSport,
    mostCommonDay,
  };
}

// ==========================================
// RECOMMENDATIONS
// ==========================================

function generateRecommendations(
  events: Event[],
  profile: UserProfile,
  bookings: Booking[]
): RecommendationCard[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const bookedEventIDs = new Set(bookings.map(b => b.eventID));

  const candidates = events.filter(event => {
    const eventDate = new Date(event.date);
    eventDate.setHours(0, 0, 0, 0);
    return eventDate >= now && 
           event.active.toLowerCase() === 'true' && 
           !bookedEventIDs.has(event.eventID);
  });

  const scoredEvents = candidates.map(event => {
    let score = 0;
    const reasons: string[] = [];

    // Sport match
    if (profile.preferredSports.some(s => 
      s.toLowerCase() === event.category.toLowerCase() ||
      event.eventName.toLowerCase().includes(s.toLowerCase())
    )) {
      score += 50;
      reasons.push(`Matches your interest in ${event.category || 'this sport'}`);
    }

    // Borough match
    const eventBorough = extractBorough(event.location);
    if (profile.homeBorough && eventBorough.toLowerCase().includes(profile.homeBorough.toLowerCase())) {
      score += 30;
      reasons.push('Near your home borough');
    }

    // Default scoring for nearby events
    if (score === 0) {
      score = 10;
    }

    const reason = reasons.length > 0 ? reasons.join(', ') : 'Popular in your area';

    return {
      eventID: event.eventID,
      title: event.eventName,
      sport: event.category,
      date: event.date,
      time: formatTime(event.time),
      venue: event.location,
      borough: eventBorough,
      price: event.price,
      difficulty: '',
      score,
      reason,
    };
  });

  scoredEvents.sort((a, b) => b.score - a.score);

  return scoredEvents.slice(0, 6);
}

// ==========================================
// HANDLER
// ==========================================

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({
      success: false,
      error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' }
    });
  }

  const email = req.query.email as string;
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;

  if (!email) {
    return res.status(400).json({
      success: false,
      error: { code: 'MISSING_EMAIL', message: 'Email parameter required' }
    });
  }

  try {
    // Fetch all data
    const [profile, events, bookings] = await Promise.all([
      fetchUserProfile(email),
      fetchEvents(),
      fetchBookings(email),
    ]);

    console.log('[DEBUG] Profile fetched:', JSON.stringify(profile));
    console.log('[DEBUG] Events count:', events.length);
    console.log('[DEBUG] Bookings count:', bookings.length);

    if (!profile) {
      return res.status(404).json({
        success: false,
        error: { code: 'USER_NOT_FOUND', message: 'User not found' }
      });
    }

    // Transform data
    const { upcoming, past, pastTotal } = separateSessions(bookings, events, page, pageSize);
    const stats = calculateStats(bookings, events);
    const recommendations = generateRecommendations(events, profile, bookings);

    console.log('[DEBUG] Upcoming sessions:', upcoming.length);
    console.log('[DEBUG] Past sessions:', past.length);
    console.log('[DEBUG] Recommendations:', recommendations.length);

    const response: DashboardResponse = {
      profile,
      upcomingSessions: upcoming,
      pastSessions: past,
      pastSessionsTotal: pastTotal,
      stats,
      recommendations,
    };

    console.log('[DEBUG] Response structure:', JSON.stringify(response, null, 2));

    return res.status(200).json({
      success: true,
      data: response,
    });

  } catch (error) {
    console.error('[ERROR] Dashboard API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[ERROR] Stack:', errorStack);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: errorMessage,
      },
    });
  }
}
