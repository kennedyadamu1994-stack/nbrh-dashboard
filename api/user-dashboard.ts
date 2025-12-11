import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const ONBOARDING_SHEET = 'Onboarding Database';
const SESSIONS_SHEET = 'NBRH Sessions';
const EVENTS_SHEET = 'NBRH Events';
const BOOKINGS_SHEET = 'NBRH Bookings';

// Parse service account credentials from JSON
function getServiceAccountCredentials() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) {
    throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is missing');
  }
  
  try {
    const credentials = JSON.parse(serviceAccountKey);
    return {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    };
  } catch (error) {
    throw new Error('Failed to parse GOOGLE_SERVICE_ACCOUNT_KEY: ' + (error instanceof Error ? error.message : 'Invalid JSON'));
  }
}

interface UserProfile {
  email: string;
  firstName: string;
  lastName: string;
  preferredSports: string[];
  skillLevel: string;
  location: string;
  homeBorough?: string;
  preferredDays?: string[];
  preferredTimes?: string[];
  fitnessLevel?: string;
  motivations?: string;
}

interface Session {
  id: string;
  activityType: string;
  name: string;
  date: string;
  time: string;
  location: string;
  price: string;
  spotsAvailable: string;
  difficulty: string;
  bookingUrl: string;
}

interface Event {
  id: string;
  name: string;
  date: string;
  time: string;
  location: string;
  price: string;
  spotsRemaining: string;
  bookingUrl: string;
}

interface Booking {
  eventName: string;
  bookingDate: string;
  amountPaid: string;
  status: string;
}

// FIXED: SessionCard matches what frontend expects
interface SessionCard {
  eventID?: string;
  title: string;
  sport: string;
  date: string;
  time: string;
  venue: string;
  borough: string;
  price: number;
  difficulty: string;
  badge?: string;
  attendanceStatus?: string;
  bookingID?: string;
}

// FIXED: Stats with all required fields
interface UserStats {
  totalBooked: number;
  totalAttended: number;
  totalHoursPlayed: number;
  totalSpent: number;
  mostPlayedSport: string | null;
  mostCommonDay: string | null;
}

// FIXED: DashboardData matches frontend expectations
interface DashboardData {
  profile: UserProfile;  // Changed from 'user'
  stats: UserStats;
  upcomingSessions: SessionCard[];
  recommendations: SessionCard[];  // Changed from 'recommendedSessions'
  pastSessions: SessionCard[];  // Changed from 'pastBookings'
  pastSessionsTotal: number;  // Added
}

// FIXED: Proper API response wrapper
interface APIResponse {
  success: boolean;
  data?: DashboardData;
  error?: {
    code: string;
    message: string;
  };
}

// Helper to find column index (case-insensitive, handles spaces)
function getColumnIndex(headers: any[], columnName: string): number {
  const normalized = columnName.toLowerCase().replace(/\s+/g, '').replace(/[()£]/g, '');
  return headers.findIndex(
    (h) => h?.toString().toLowerCase().replace(/\s+/g, '').replace(/[()£]/g, '') === normalized
  );
}

async function getSheets() {
  const credentials = getServiceAccountCredentials();
  
  const auth = new google.auth.GoogleAuth({
    credentials: {
      client_email: credentials.client_email,
      private_key: credentials.private_key,
    },
    scopes: ['https://www.googleapis.com/auth/spreadsheets.readonly'],
  });

  return google.sheets({ version: 'v4', auth });
}

async function fetchUserProfile(email: string): Promise<UserProfile | null> {
  const sheets = await getSheets();
  const normalizedEmail = email.toLowerCase().trim();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${ONBOARDING_SHEET}!A:Z`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return null;

  const onboardingHeaders = rows[0];
  const onboardingRows = rows.slice(1);

  const emailColIndex = getColumnIndex(onboardingHeaders, 'Email');
  const nameColIndex = getColumnIndex(onboardingHeaders, 'Name');
  const favouriteActivityColIndex = getColumnIndex(onboardingHeaders, 'Favourite Activity');
  const experienceLevelColIndex = getColumnIndex(onboardingHeaders, 'Experience Level');
  const homeBoroughColIndex = getColumnIndex(onboardingHeaders, 'Home Borough');

  if (emailColIndex === -1) {
    throw new Error('Email column not found in Onboarding Database');
  }

  const userRow = onboardingRows.find(
    (row) => row[emailColIndex]?.toString().toLowerCase().trim() === normalizedEmail
  );

  if (!userRow) {
    return null;
  }

  const fullName = nameColIndex !== -1 ? userRow[nameColIndex]?.toString() || '' : '';
  const nameParts = fullName.split(' ');
  const firstName = nameParts[0] || '';
  const lastName = nameParts.slice(1).join(' ') || '';

  return {
    email: userRow[emailColIndex]?.toString() || '',
    firstName,
    lastName,
    preferredSports: favouriteActivityColIndex !== -1 ? [userRow[favouriteActivityColIndex]?.toString() || ''] : [],
    skillLevel: experienceLevelColIndex !== -1 ? userRow[experienceLevelColIndex]?.toString() || '' : '',
    location: homeBoroughColIndex !== -1 ? userRow[homeBoroughColIndex]?.toString() || '' : '',
    homeBorough: homeBoroughColIndex !== -1 ? userRow[homeBoroughColIndex]?.toString() || '' : '',
    fitnessLevel: experienceLevelColIndex !== -1 ? userRow[experienceLevelColIndex]?.toString() || '' : '',
  };
}

async function fetchSessions(): Promise<Session[]> {
  const sheets = await getSheets();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${SESSIONS_SHEET}!A:Z`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const activityTypeIndex = getColumnIndex(headers, 'Activity Type');
  const classNameIndex = getColumnIndex(headers, 'Class Name');
  const dateIndex = getColumnIndex(headers, 'Date');
  const startTimeIndex = getColumnIndex(headers, 'Start Time');
  const locationIndex = getColumnIndex(headers, 'Location');
  const basePriceIndex = getColumnIndex(headers, 'Base Price');
  const spotsAvailableIndex = getColumnIndex(headers, 'Spots Available');
  const difficultyLevelIndex = getColumnIndex(headers, 'Difficulty Level');
  const bookingUrlIndex = getColumnIndex(headers, 'Booking URL');
  const sessionIdIndex = getColumnIndex(headers, 'Session ID');

  return dataRows
    .filter((row) => row.length > 0)
    .map((row, index) => ({
      id: sessionIdIndex !== -1 && row[sessionIdIndex] ? row[sessionIdIndex].toString() : `session-${index}`,
      activityType: activityTypeIndex !== -1 ? row[activityTypeIndex]?.toString() || '' : '',
      name: classNameIndex !== -1 ? row[classNameIndex]?.toString() || '' : '',
      date: dateIndex !== -1 ? row[dateIndex]?.toString() || '' : '',
      time: startTimeIndex !== -1 ? row[startTimeIndex]?.toString() || '' : '',
      location: locationIndex !== -1 ? row[locationIndex]?.toString() || '' : '',
      price: basePriceIndex !== -1 ? row[basePriceIndex]?.toString() || '' : '',
      spotsAvailable: spotsAvailableIndex !== -1 ? row[spotsAvailableIndex]?.toString() || '' : '',
      difficulty: difficultyLevelIndex !== -1 ? row[difficultyLevelIndex]?.toString() || '' : '',
      bookingUrl: bookingUrlIndex !== -1 ? row[bookingUrlIndex]?.toString() || '' : '',
    }));
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

  const eventIdIndex = getColumnIndex(headers, 'event_id');
  const eventNameIndex = getColumnIndex(headers, 'event_name');
  const dateIndex = getColumnIndex(headers, 'date');
  const timeIndex = getColumnIndex(headers, 'time');
  const locationIndex = getColumnIndex(headers, 'location');
  const basePriceIndex = getColumnIndex(headers, 'base_price');
  const spotsRemainingIndex = getColumnIndex(headers, 'spots_remaining');
  const bookingUrlIndex = getColumnIndex(headers, 'booking_url');

  return dataRows
    .filter((row) => row.length > 0)
    .map((row, index) => ({
      id: eventIdIndex !== -1 && row[eventIdIndex] ? row[eventIdIndex].toString() : `event-${index}`,
      name: eventNameIndex !== -1 ? row[eventNameIndex]?.toString() || '' : '',
      date: dateIndex !== -1 ? row[dateIndex]?.toString() || '' : '',
      time: timeIndex !== -1 ? row[timeIndex]?.toString() || '' : '',
      location: locationIndex !== -1 ? row[locationIndex]?.toString() || '' : '',
      price: basePriceIndex !== -1 ? row[basePriceIndex]?.toString() || '' : '',
      spotsRemaining: spotsRemainingIndex !== -1 ? row[spotsRemainingIndex]?.toString() || '' : '',
      bookingUrl: bookingUrlIndex !== -1 ? row[bookingUrlIndex]?.toString() || '' : '',
    }));
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

  const customerEmailIndex = getColumnIndex(headers, 'customer_email');
  const eventNameIndex = getColumnIndex(headers, 'event_name');
  const bookingDateIndex = getColumnIndex(headers, 'booking_date');
  const amountPaidIndex = getColumnIndex(headers, 'amount_paid');
  const statusIndex = getColumnIndex(headers, 'status');

  if (customerEmailIndex === -1) {
    return [];
  }

  return dataRows
    .filter(
      (row) =>
        row[customerEmailIndex]?.toString().toLowerCase().trim() === normalizedEmail
    )
    .map((row) => ({
      eventName: eventNameIndex !== -1 ? row[eventNameIndex]?.toString() || '' : '',
      bookingDate: bookingDateIndex !== -1 ? row[bookingDateIndex]?.toString() || '' : '',
      amountPaid: amountPaidIndex !== -1 ? row[amountPaidIndex]?.toString() || '' : '',
      status: statusIndex !== -1 ? row[statusIndex]?.toString() || 'completed' : 'completed',
    }));
}

// FIXED: Transform Session to SessionCard
function transformSessionToCard(session: Session): SessionCard {
  return {
    eventID: session.id,
    title: session.name,
    sport: session.activityType,
    date: session.date,
    time: session.time,
    venue: session.location,
    borough: extractBorough(session.location),
    price: parsePrice(session.price),
    difficulty: session.difficulty || 'All levels',
  };
}

// FIXED: Transform Booking to SessionCard (needs to lookup session data ideally)
function transformBookingToCard(booking: Booking): SessionCard {
  return {
    title: booking.eventName,
    sport: 'Unknown', // This should be looked up from sessions/events
    date: booking.bookingDate,
    time: 'Unknown', // This should be looked up
    venue: 'Unknown', // This should be looked up
    borough: 'Unknown', // This should be looked up
    price: parsePrice(booking.amountPaid),
    difficulty: 'Unknown',
    attendanceStatus: booking.status === 'completed' ? 'Attended' : 'No-show',
  };
}

// Helper to extract borough from location string
function extractBorough(location: string): string {
  // Simple extraction - might need refinement
  const parts = location.split(',');
  return parts[parts.length - 1]?.trim() || 'London';
}

// Helper to parse price string to number
function parsePrice(priceStr: string): number {
  const cleaned = priceStr.replace(/[£,\s]/g, '');
  return parseFloat(cleaned) || 0;
}

// FIXED: Calculate all stats properly
function calculateStats(bookings: Booking[], sessions: SessionCard[]): UserStats {
  const totalBooked = bookings.length;
  
  // Calculate total attended
  const totalAttended = bookings.filter(
    b => b.status === 'completed' || b.status === 'attended'
  ).length;

  // Calculate total hours played (assuming 1.5 hours per session as default)
  const totalHoursPlayed = totalAttended * 1.5;

  // Calculate total spent
  const totalSpent = bookings.reduce((sum, booking) => {
    const amount = parsePrice(booking.amountPaid);
    return sum + amount;
  }, 0);

  // Calculate most played sport
  const sportCounts = new Map<string, number>();
  sessions.forEach(session => {
    const count = sportCounts.get(session.sport) || 0;
    sportCounts.set(session.sport, count + 1);
  });
  
  let mostPlayedSport: string | null = null;
  let maxCount = 0;
  sportCounts.forEach((count, sport) => {
    if (count > maxCount) {
      maxCount = count;
      mostPlayedSport = sport;
    }
  });

  // Calculate most common day
  const dayCounts = new Map<string, number>();
  sessions.forEach(session => {
    try {
      const date = new Date(session.date);
      const dayName = date.toLocaleDateString('en-GB', { weekday: 'long' });
      const count = dayCounts.get(dayName) || 0;
      dayCounts.set(dayName, count + 1);
    } catch (e) {
      // Skip invalid dates
    }
  });

  let mostCommonDay: string | null = null;
  let maxDayCount = 0;
  dayCounts.forEach((count, day) => {
    if (count > maxDayCount) {
      maxDayCount = count;
      mostCommonDay = day;
    }
  });

  return {
    totalBooked,
    totalAttended,
    totalHoursPlayed: Math.round(totalHoursPlayed * 10) / 10,
    totalSpent: Math.round(totalSpent * 100) / 100,
    mostPlayedSport,
    mostCommonDay,
  };
}

// FIXED: Better recommendation logic
function getRecommendedSessions(
  sessions: Session[],
  userProfile: UserProfile
): SessionCard[] {
  const scored = sessions.map(session => {
    let score = 0;
    
    // Match preferred sports (highest weight)
    if (userProfile.preferredSports.some(sport =>
      session.activityType.toLowerCase().includes(sport.toLowerCase())
    )) {
      score += 10;
    }
    
    // Match skill level
    if (userProfile.skillLevel &&
        session.difficulty.toLowerCase() === userProfile.skillLevel.toLowerCase()) {
      score += 5;
    }
    
    // Prefer sessions with available spots
    if (session.spotsAvailable && parseInt(session.spotsAvailable) > 0) {
      score += 2;
    }
    
    // Future sessions only
    try {
      const sessionDate = new Date(session.date);
      if (sessionDate >= new Date()) {
        score += 1;
      } else {
        score = -1; // Exclude past sessions
      }
    } catch {
      score = -1;
    }
    
    return { session, score };
  });
  
  // Sort by score and take top 6
  const recommended = scored
    .filter(s => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map(s => transformSessionToCard(s.session));
  
  // If no matches, return upcoming sessions
  if (recommended.length === 0) {
    return sessions
      .filter(s => {
        try {
          return new Date(s.date) >= new Date();
        } catch {
          return false;
        }
      })
      .slice(0, 6)
      .map(transformSessionToCard);
  }
  
  return recommended;
}

export default async function handler(
  req: VercelRequest,
  res: VercelResponse
) {
  // CORS headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') {
    return res.status(200).end();
  }

  if (req.method !== 'GET') {
    return res.status(405).json({ 
      success: false,
      error: {
        code: 'METHOD_NOT_ALLOWED',
        message: 'Method not allowed'
      }
    });
  }

  const email = req.query.email as string;
  
  // FIXED: Parse pagination params
  const page = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;

  if (!email) {
    return res.status(400).json({ 
      success: false,
      error: {
        code: 'MISSING_EMAIL',
        message: 'Email parameter required'
      }
    });
  }

  try {
    console.log('[DEBUG] Checking environment variables...');
    if (!SPREADSHEET_ID) {
      throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is missing');
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is missing');
    }
    
    try {
      getServiceAccountCredentials();
    } catch (error) {
      throw new Error('Invalid service account credentials: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
    
    console.log('[DEBUG] Environment variables OK');

    // Fetch user profile
    console.log('[DEBUG] Fetching user profile...');
    const userProfile = await fetchUserProfile(email);

    if (!userProfile) {
      console.log('[DEBUG] User not found:', email);
      return res.status(404).json({ 
        success: false,
        error: {
          code: 'USER_NOT_FOUND',
          message: 'User not found'
        }
      });
    }
    console.log('[DEBUG] User profile fetched:', userProfile.email);

    // Fetch all data
    console.log('[DEBUG] Fetching sessions...');
    let sessions: Session[] = [];
    try {
      sessions = await fetchSessions();
      console.log(`[DEBUG] Fetched ${sessions.length} sessions`);
    } catch (error) {
      console.error('[ERROR] Failed to fetch sessions:', error);
      sessions = [];
    }

    console.log('[DEBUG] Fetching events...');
    let events: Event[] = [];
    try {
      events = await fetchEvents();
      console.log(`[DEBUG] Fetched ${events.length} events`);
    } catch (error) {
      console.error('[ERROR] Failed to fetch events:', error);
      events = [];
    }

    console.log('[DEBUG] Fetching bookings...');
    let bookings: Booking[] = [];
    try {
      bookings = await fetchBookings(email);
      console.log(`[DEBUG] Fetched ${bookings.length} bookings`);
    } catch (error) {
      console.error('[ERROR] Failed to fetch bookings:', error);
      bookings = [];
    }

    // Transform sessions to cards
    const sessionCards = sessions.map(transformSessionToCard);

    // Filter upcoming sessions
    const upcomingSessions = sessionCards
      .filter((s) => {
        try {
          const sessionDate = new Date(s.date);
          return !isNaN(sessionDate.getTime()) && sessionDate >= new Date();
        } catch {
          return false;
        }
      })
      .slice(0, 10);

    // Get recommendations
    const recommendations = getRecommendedSessions(sessions, userProfile);

    // FIXED: Apply pagination to past bookings
    const totalBookings = bookings.length;
    const start = (page - 1) * pageSize;
    const end = start + pageSize;
    const paginatedBookings = bookings.slice(start, end);
    
    // Transform bookings to session cards
    const pastSessions = paginatedBookings.map(transformBookingToCard);

    // Calculate stats with all fields
    const stats = calculateStats(bookings, sessionCards);

    // FIXED: Return properly formatted response
    const dashboardData: DashboardData = {
      profile: userProfile,  // Changed from 'user'
      stats,
      upcomingSessions,
      recommendations,  // Changed from 'recommendedSessions'
      pastSessions,  // Changed from 'pastBookings'
      pastSessionsTotal: totalBookings,  // Added
    };

    console.log('[DEBUG] Returning dashboard data successfully');
    
    // FIXED: Wrap in API response format
    return res.status(200).json({
      success: true,
      data: dashboardData
    } as APIResponse);
    
  } catch (error) {
    console.error('[ERROR] Dashboard API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[ERROR] Stack trace:', errorStack);
    
    return res.status(500).json({
      success: false,
      error: {
        code: 'INTERNAL_ERROR',
        message: errorMessage
      }
    } as APIResponse);
  }
}
