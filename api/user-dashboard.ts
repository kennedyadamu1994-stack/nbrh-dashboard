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

interface DashboardData {
  user: UserProfile;
  stats: {
    totalBookings: number;
    upcomingSessions: number;
    totalSpent: number;
  };
  upcomingSessions: (Session | Event)[];
  recommendedSessions: Session[];
  pastBookings: Booking[];
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

  // Find user in Onboarding Database (using actual column headers)
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

  // Parse name into first/last (simple split on first space)
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

  // Using actual NBRH Sessions column headers
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

  // Using actual NBRH Events column headers
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

  // Using actual NBRH Bookings column headers
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

function calculateStats(bookings: Booking[], sessions: (Session | Event)[]): DashboardData['stats'] {
  const totalBookings = bookings.length;
  const upcomingSessions = sessions.filter((s) => {
    const sessionDate = new Date(s.date);
    return sessionDate >= new Date();
  }).length;

  const totalSpent = bookings.reduce((sum, booking) => {
    const amount = parseFloat(booking.amountPaid.replace(/[£,]/g, '')) || 0;
    return sum + amount;
  }, 0);

  return {
    totalBookings,
    upcomingSessions,
    totalSpent: Math.round(totalSpent * 100) / 100,
  };
}

function getRecommendedSessions(
  sessions: Session[],
  userProfile: UserProfile
): Session[] {
  // Simple recommendation: match user's preferred sports and skill level
  const recommended = sessions
    .filter((session) => {
      const matchesSport = userProfile.preferredSports.some((sport) =>
        session.activityType.toLowerCase().includes(sport.toLowerCase())
      );
      const matchesSkill =
        !userProfile.skillLevel ||
        session.difficulty.toLowerCase() === userProfile.skillLevel.toLowerCase();
      return matchesSport || matchesSkill;
    })
    .slice(0, 6);

  // If no matches, return first 6 sessions
  return recommended.length > 0 ? recommended : sessions.slice(0, 6);
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
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const email = req.query.email as string;

  if (!email) {
    return res.status(400).json({ error: 'Email parameter required' });
  }

  try {
    // Validate environment variables
    console.log('[DEBUG] Checking environment variables...');
    if (!SPREADSHEET_ID) {
      throw new Error('GOOGLE_SHEETS_SPREADSHEET_ID is missing');
    }
    if (!process.env.GOOGLE_SERVICE_ACCOUNT_KEY) {
      throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is missing');
    }
    
    // Test parsing credentials
    try {
      getServiceAccountCredentials();
    } catch (error) {
      throw new Error('Invalid service account credentials: ' + (error instanceof Error ? error.message : 'Unknown error'));
    }
    
    console.log('[DEBUG] Environment variables OK');

    // Fetch all data with individual error handling
    console.log('[DEBUG] Fetching user profile...');
    let userProfile: UserProfile | null = null;
    try {
      userProfile = await fetchUserProfile(email);
    } catch (error) {
      console.error('[ERROR] Failed to fetch user profile:', error);
      throw new Error(`User profile fetch failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

    if (!userProfile) {
      console.log('[DEBUG] User not found:', email);
      return res.status(404).json({ error: 'User not found' });
    }
    console.log('[DEBUG] User profile fetched:', userProfile.email);

    console.log('[DEBUG] Fetching sessions...');
    let sessions: Session[] = [];
    try {
      sessions = await fetchSessions();
      console.log(`[DEBUG] Fetched ${sessions.length} sessions`);
    } catch (error) {
      console.error('[ERROR] Failed to fetch sessions:', error);
      // Continue with empty sessions rather than failing
      sessions = [];
    }

    console.log('[DEBUG] Fetching events...');
    let events: Event[] = [];
    try {
      events = await fetchEvents();
      console.log(`[DEBUG] Fetched ${events.length} events`);
    } catch (error) {
      console.error('[ERROR] Failed to fetch events:', error);
      // Continue with empty events rather than failing
      events = [];
    }

    console.log('[DEBUG] Fetching bookings...');
    let bookings: Booking[] = [];
    try {
      bookings = await fetchBookings(email);
      console.log(`[DEBUG] Fetched ${bookings.length} bookings`);
    } catch (error) {
      console.error('[ERROR] Failed to fetch bookings:', error);
      // Continue with empty bookings rather than failing
      bookings = [];
    }

    // Combine sessions and events
    const allSessions = [
      ...sessions.map(s => ({ ...s, type: 'session' })),
      ...events.map(e => ({ 
        ...e, 
        type: 'event',
        activityType: '',
        name: e.name,
        spotsAvailable: e.spotsRemaining,
        difficulty: ''
      }))
    ];

    // Filter upcoming sessions
    const upcomingSessions = allSessions
      .filter((s) => {
        try {
          const sessionDate = new Date(s.date);
          return !isNaN(sessionDate.getTime()) && sessionDate >= new Date();
        } catch {
          return false;
        }
      })
      .slice(0, 10);

    const stats = calculateStats(bookings, allSessions);
    const recommendedSessions = getRecommendedSessions(sessions, userProfile);

    const dashboardData: DashboardData = {
      user: userProfile,
      stats,
      upcomingSessions,
      recommendedSessions,
      pastBookings: bookings.slice(0, 10),
    };

    console.log('[DEBUG] Returning dashboard data successfully');
    return res.status(200).json(dashboardData);
  } catch (error) {
    console.error('[ERROR] Dashboard API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    const errorStack = error instanceof Error ? error.stack : '';
    console.error('[ERROR] Stack trace:', errorStack);
    
    return res.status(500).json({
      error: 'Failed to fetch dashboard data',
      details: errorMessage,
      stack: process.env.NODE_ENV === 'development' ? errorStack : undefined,
    });
  }
}
