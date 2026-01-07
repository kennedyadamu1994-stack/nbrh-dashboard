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
  motivations: string[];
  sessionFormatPreference: string;
  gender: string;
}

interface Event {
  eventID: string;
  sessionTemplateID: string;
  eventName: string;
  category: string;
  date: string;
  time: string;
  endTime: string;
  location: string;
  borough: string;
  price: number;
  spotsRemaining: number;
  bookingUrl: string;
  durationMinutes: number;
  active: string;
  attendeesUrl: string;
  attendeesPublicUrl: string;
  imageUrl: string;
  genderTarget: string;
  motivations: string[];
  sessionFormat: string;
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
  attendeeUrl?: string;
  image?: string;
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
  displayPercentage: number;
  reason: string;
  attendeeUrl?: string;
  image?: string;
  bookingUrl?: string;
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
  if (!location) return '';
  
  // Common London boroughs to look for
  const londonBoroughs = [
    'Westminster', 'Camden', 'Islington', 'Hackney', 'Tower Hamlets', 'Greenwich',
    'Lewisham', 'Southwark', 'Lambeth', 'Wandsworth', 'Hammersmith', 'Fulham',
    'Kensington', 'Chelsea', 'Brent', 'Ealing', 'Hounslow', 'Richmond', 'Kingston',
    'Merton', 'Sutton', 'Croydon', 'Bromley', 'Bexley', 'Havering', 'Barking',
    'Dagenham', 'Redbridge', 'Newham', 'Waltham Forest', 'Haringey', 'Enfield',
    'Barnet', 'Harrow', 'Hillingdon'
  ];
  
  // First, check if any borough name appears in the location
  const locationLower = location.toLowerCase();
  for (const borough of londonBoroughs) {
    if (locationLower.includes(borough.toLowerCase())) {
      return borough;
    }
  }
  
  // Fallback: split by comma and try to find a meaningful part
  // Typically: "Venue, Borough, Postcode, Country"
  const parts = location.split(',').map(p => p.trim());
  
  // Avoid returning UK, England, London, or postcodes
  const meaningfulParts = parts.filter(part => {
    const partLower = part.toLowerCase();
    return !partLower.includes('uk') && 
           !partLower.includes('england') &&
           part !== 'London' &&
           !/ (UK|N1|N2|N3|N4|N5|N6|N7|N8|N9|N10|SW1|SW2|SW3|SE1|SE2|SE3|E1|E2|E3|W1|W2|W3|NW1|NW2)/.test(part);
  });
  
  // Return the second-to-last meaningful part, or last, or first
  if (meaningfulParts.length >= 2) {
    return meaningfulParts[meaningfulParts.length - 2];
  } else if (meaningfulParts.length === 1) {
    return meaningfulParts[0];
  }
  
  return parts[0] || '';
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
  const genderIdx = 3; // Column D (0-indexed: A=0, B=1, C=2, D=3)
  const boroughIdx = getColumnIndex(headers, 'Home Borough');
  const favouriteActivityIdx = getColumnIndex(headers, 'Favourite Activity');
  const experienceLevelIdx = getColumnIndex(headers, 'Experience Level');
  const otherActivitiesIdx = getColumnIndex(headers, 'Other Activities Interested In');
  const motivationsIdx = getColumnIndex(headers, 'Motivations');
  const sessionFormatIdx = getColumnIndex(headers, 'Session Format Preference');

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

  // Parse motivations (comma-separated)
  const motivations = motivationsIdx !== -1 && userRow[motivationsIdx]
    ? parseCommaSeparated(userRow[motivationsIdx].toString())
    : [];

  // Get session format preference
  const sessionFormatPreference = sessionFormatIdx !== -1 && userRow[sessionFormatIdx]
    ? userRow[sessionFormatIdx].toString()
    : '';

  return {
    email: userRow[emailIdx]?.toString() || '',
    firstName,
    lastName,
    homeBorough: boroughIdx !== -1 ? userRow[boroughIdx]?.toString() || '' : '',
    preferredSports: preferredSports.length > 0 ? preferredSports : [],
    preferredDays: [],
    preferredTimes: [],
    fitnessLevel: experienceLevelIdx !== -1 ? userRow[experienceLevelIdx]?.toString() || '' : '',
    motivations,
    sessionFormatPreference,
    gender: genderIdx !== -1 ? userRow[genderIdx]?.toString() || '' : '',
  };
}

async function fetchEvents(): Promise<Event[]> {
  const sheets = await getSheets();

  const response = await sheets.spreadsheets.values.get({
    spreadsheetId: SPREADSHEET_ID,
    range: `${EVENTS_SHEET}!A:AG`,
  });

  const rows = response.data.values || [];
  if (rows.length === 0) return [];

  const headers = rows[0];
  const dataRows = rows.slice(1);

  const eventIDIdx = getColumnIndex(headers, 'event_id');
  const sessionTemplateIDIdx = 28; // Column AC - Session ID (0-indexed: A=0, B=1... AC=28)
  const eventNameIdx = getColumnIndex(headers, 'event_name');
  const categoryIdx = getColumnIndex(headers, 'Category');
  const dateIdx = getColumnIndex(headers, 'date');
  const timeIdx = getColumnIndex(headers, 'time');
  const endTimeIdx = getColumnIndex(headers, 'End Time');
  const locationIdx = getColumnIndex(headers, 'location');
  
  // Borough is in Column AB (index 27) of NBRH Events sheet
  // Session ID is in Column AC (index 28) of NBRH Events sheet
  // Gender Target is in Column AD (index 29) of NBRH Events sheet
  // Motivations is in Column AF (index 31) of NBRH Events sheet
  // Session Format is in Column AG (index 32) of NBRH Events sheet
  const boroughIdx = 27;
  const genderTargetIdx = 29;
  const motivationsIdx = 31;
  const sessionFormatIdx = 32;
  
  const priceIdx = getColumnIndex(headers, 'base_price');
  const spotsRemainingIdx = getColumnIndex(headers, 'spots_remaining');
  const bookingUrlIdx = getColumnIndex(headers, 'booking_url');
  const durationIdx = getColumnIndex(headers, 'Duration Minutes');
  const activeIdx = getColumnIndex(headers, 'active');
  const attendeesUrlIdx = getColumnIndex(headers, 'attendees_url');
  const attendeesPublicUrlIdx = getColumnIndex(headers, 'attendees_public_url');
  const imageUrlIdx = getColumnIndex(headers, 'Image URL');

  const events: Event[] = [];

  for (const row of dataRows) {
    if (!row[eventIDIdx]) continue;

    // Parse motivations (comma-separated)
    const motivations = motivationsIdx !== -1 && row[motivationsIdx]
      ? parseCommaSeparated(row[motivationsIdx].toString())
      : [];

    // Get session format
    const sessionFormat = sessionFormatIdx !== -1 && row[sessionFormatIdx]
      ? row[sessionFormatIdx].toString()
      : '';

    const event: Event = {
      eventID: row[eventIDIdx]?.toString() || '',
      sessionTemplateID: sessionTemplateIDIdx !== -1 ? row[sessionTemplateIDIdx]?.toString() || '' : '',
      eventName: eventNameIdx !== -1 ? row[eventNameIdx]?.toString() || '' : '',
      category: categoryIdx !== -1 ? row[categoryIdx]?.toString() || '' : '',
      date: dateIdx !== -1 ? row[dateIdx]?.toString() || '' : '',
      time: timeIdx !== -1 ? row[timeIdx]?.toString() || '' : '',
      endTime: endTimeIdx !== -1 ? row[endTimeIdx]?.toString() || '' : '',
      location: locationIdx !== -1 ? row[locationIdx]?.toString() || '' : '',
      borough: boroughIdx !== -1 ? row[boroughIdx]?.toString() || '' : '',
      price: priceIdx !== -1 ? parsePrice(row[priceIdx]?.toString() || '0') : 0,
      spotsRemaining: spotsRemainingIdx !== -1 ? parseInt(row[spotsRemainingIdx]?.toString() || '0') : 0,
      bookingUrl: bookingUrlIdx !== -1 ? row[bookingUrlIdx]?.toString() || '' : '',
      durationMinutes: durationIdx !== -1 ? parseInt(row[durationIdx]?.toString() || '60') : 60,
      active: activeIdx !== -1 ? row[activeIdx]?.toString() || 'TRUE' : 'TRUE',
      attendeesUrl: attendeesUrlIdx !== -1 ? row[attendeesUrlIdx]?.toString() || '' : '',
      attendeesPublicUrl: attendeesPublicUrlIdx !== -1 ? row[attendeesPublicUrlIdx]?.toString() || '' : '',
      imageUrl: imageUrlIdx !== -1 ? row[imageUrlIdx]?.toString() || '' : '',
      genderTarget: genderTargetIdx !== -1 ? row[genderTargetIdx]?.toString() || '' : '',
      motivations,
      sessionFormat,
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
  
  // Use borough from event if available, otherwise extract from location
  const borough = event?.borough || extractBorough(location);
  
  // Prefer public URL over regular attendees URL
  const attendeeUrl = event?.attendeesPublicUrl || event?.attendeesUrl || '';
  
  // Get image URL from event
  const image = event?.imageUrl || '';

  return {
    eventID: booking.eventID,
    title: eventName,
    sport: category,
    date: eventDate,
    time: formatTime(eventTime),
    venue: location,
    borough: borough,
    price,
    badge: isPast ? undefined : getDateBadge(eventDate),
    difficulty: booking.skillLevel || '',
    bookingID: booking.bookingID,
    attendanceStatus: isPast ? booking.status : undefined,
    attendeeUrl,
    image,
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
  const seenBookingIds = new Set<string>(); // Track to avoid duplicates

  console.log(`[DEBUG] Processing ${bookings.length} bookings`);

  for (const booking of bookings) {
    // Skip duplicate booking IDs
    if (seenBookingIds.has(booking.bookingID)) {
      console.log(`[DEBUG] Skipping duplicate booking: ${booking.bookingID}`);
      continue;
    }
    seenBookingIds.add(booking.bookingID);

    const event = eventMap.get(booking.eventID);
    const eventDate = new Date(event?.date || booking.eventDate);
    eventDate.setHours(0, 0, 0, 0);
    const isPast = eventDate < now;

    console.log(`[DEBUG] Booking ${booking.bookingID}: ${booking.eventName} on ${eventDate.toISOString()} - ${isPast ? 'PAST' : 'UPCOMING'}`);

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

  console.log(`[DEBUG] Result: ${upcoming.length} upcoming, ${pastTotal} past`);

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
  
  console.log(`[DEBUG] Calculating stats for ${bookings.length} bookings`);
  
  // Count attended sessions - check for explicit attendance indicators
  // Status values might be: "Attended", "Confirmed", "Completed", "No-show", "Cancelled"
  const attended = bookings.filter(b => {
    const eventDate = new Date(b.eventDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    
    // Event must be in the past
    if (eventDate >= now) {
      console.log(`[DEBUG] ${b.eventName}: Future event, not counted as attended`);
      return false;
    }
    
    const status = b.status.toLowerCase();
    console.log(`[DEBUG] ${b.eventName}: Past event with status "${status}"`);
    
    // Explicitly attended
    if (status.includes('attended') || status.includes('completed')) return true;
    
    // For "Confirmed" status, assume attended if event is in the past
    if (status.includes('confirmed')) return true;
    
    // Exclude cancellations and no-shows
    if (status.includes('cancelled') || status.includes('cancel') || 
        status.includes('no-show') || status.includes('noshow')) return false;
    
    // Default: if past and not cancelled, consider attended
    return true;
  });

  console.log(`[DEBUG] Attended sessions: ${attended.length}`);

  const totalSpent = bookings.reduce((sum, b) => {
    const status = b.status.toLowerCase();
    // Only count non-cancelled bookings in total spent
    if (status.includes('cancelled') || status.includes('cancel')) {
      console.log(`[DEBUG] Excluding cancelled booking from total: ${b.eventName}`);
      return sum;
    }
    const amount = parsePrice(b.amountPaid);
    console.log(`[DEBUG] Adding £${amount} from ${b.eventName}`);
    return sum + amount;
  }, 0);

  console.log(`[DEBUG] Total spent: £${totalSpent}`);

  let totalMinutes = 0;
  const sportCounts = new Map<string, number>();
  const dayCounts = new Map<string, number>();

  for (const booking of attended) {
    const event = eventMap.get(booking.eventID);
    if (event) {
      console.log(`[DEBUG] Adding ${event.durationMinutes} minutes for ${event.eventName}`);
      totalMinutes += event.durationMinutes;
      if (event.category) {
        sportCounts.set(event.category, (sportCounts.get(event.category) || 0) + 1);
      }
    } else {
      // If event not found, try to estimate duration (default 90 minutes)
      console.log(`[DEBUG] Event not found for ${booking.eventName}, using default 90 minutes`);
      totalMinutes += 90;
    }

    const day = getDayOfWeek(booking.eventDate);
    if (day) {
      dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
    }
  }

  console.log(`[DEBUG] Total minutes: ${totalMinutes}, hours: ${totalMinutes / 60}`);

  const mostPlayedSport = sportCounts.size > 0
    ? Array.from(sportCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const mostCommonDay = dayCounts.size > 0
    ? Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  console.log(`[DEBUG] Most played sport: ${mostPlayedSport}, Most common day: ${mostCommonDay}`);

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

// Helper: Define London borough regions for proximity matching
const LONDON_REGIONS = {
  'East': ['Hackney', 'Tower Hamlets', 'Newham', 'Waltham Forest', 'Redbridge', 'Barking', 'Dagenham', 'Havering'],
  'West': ['Hammersmith', 'Fulham', 'Ealing', 'Hounslow', 'Brent', 'Hillingdon', 'Harrow'],
  'North': ['Camden', 'Islington', 'Haringey', 'Enfield', 'Barnet'],
  'South': ['Lambeth', 'Southwark', 'Lewisham', 'Greenwich', 'Bromley', 'Croydon', 'Sutton', 'Merton'],
  'Central': ['Westminster', 'Kensington', 'Chelsea', 'City of London']
};

function getBoroughRegion(borough: string): string | null {
  for (const [region, boroughs] of Object.entries(LONDON_REGIONS)) {
    if (boroughs.some(b => borough.toLowerCase().includes(b.toLowerCase()))) {
      return region;
    }
  }
  return null;
}

/**
 * Check if a session's gender target is compatible with the user's gender
 * Returns: { isCompatible: boolean, bonusPoints: number, matchReason?: string }
 */
function checkGenderCompatibility(
  sessionGenderTarget: string,
  userGender: string
): { isCompatible: boolean; bonusPoints: number; matchReason?: string } {
  
  // Normalize inputs
  const sessionTarget = sessionGenderTarget.trim().toLowerCase();
  const userGen = userGender.trim().toLowerCase();
  
  console.log(`[DEBUG] Gender check - Session: "${sessionTarget}", User: "${userGen}"`);
  
  // If no gender specified for session or user, it's compatible but no bonus
  if (!sessionTarget || !userGen) {
    return { isCompatible: true, bonusPoints: 0 };
  }
  
  // "Women Only" sessions
  if (sessionTarget.includes('women only') || sessionTarget === 'women only') {
    if (userGen === 'female') {
      console.log('[DEBUG] ✅ Female user matched to Women Only session (+30 points)');
      return { 
        isCompatible: true, 
        bonusPoints: 30,
        matchReason: "women's session"
      };
    } else if (userGen === 'male') {
      console.log('[DEBUG] ❌ Male user excluded from Women Only session');
      return { isCompatible: false, bonusPoints: 0 };
    }
  }
  
  // "Men" or "Men Only" sessions
  if (sessionTarget === 'men' || sessionTarget === 'men only' || sessionTarget.includes('men only')) {
    if (userGen === 'male') {
      console.log('[DEBUG] ✅ Male user matched to Men session (+30 points)');
      return { 
        isCompatible: true, 
        bonusPoints: 30,
        matchReason: "men's session"
      };
    } else if (userGen === 'female') {
      console.log('[DEBUG] ❌ Female user excluded from Men Only session');
      return { isCompatible: false, bonusPoints: 0 };
    }
  }
  
  // Any other value (Mixed, All, Open, or empty) - compatible for everyone, no bonus
  console.log('[DEBUG] ✅ Open session - compatible for all');
  return { isCompatible: true, bonusPoints: 0 };
}

/**
 * Calculate curved display percentage for better UX
 * Transforms raw score into a more meaningful percentage
 * 
 * Updated score ranges (sport match now worth 80 points, max ~260):
 * - 120+ points → 80-100% (Excellent matches - sport + multiple factors)
 * - 90-119 points → 60-79% (Good matches - sport + some factors)
 * - 60-89 points → 40-59% (Moderate matches - sport or several other factors)
 * - 40-59 points → 25-39% (Weak matches)
 * - <40 points → 10-24% (Very weak matches)
 */
function calculateDisplayPercentage(rawScore: number): number {
  if (rawScore >= 120) {
    // Map 120-260 to 80-100%
    const normalized = Math.min((rawScore - 120) / (260 - 120), 1);
    return Math.round(80 + (normalized * 20));
  } else if (rawScore >= 90) {
    // Map 90-119 to 60-79%
    const normalized = (rawScore - 90) / (119 - 90);
    return Math.round(60 + (normalized * 19));
  } else if (rawScore >= 60) {
    // Map 60-89 to 40-59%
    const normalized = (rawScore - 60) / (89 - 60);
    return Math.round(40 + (normalized * 19));
  } else if (rawScore >= 40) {
    // Map 40-59 to 25-39%
    const normalized = (rawScore - 40) / (59 - 40);
    return Math.round(25 + (normalized * 14));
  } else {
    // Map 0-39 to 10-24%
    const normalized = Math.min(rawScore / 39, 1);
    return Math.round(10 + (normalized * 14));
  }
}

/**
 * Check if a sport name matches the user's preferred sport
 * Uses exact matching to avoid false positives like "football" matching "American football"
 */
function isSportMatch(userSport: string, eventCategory: string, eventName: string): boolean {
  const userSportLower = userSport.toLowerCase().trim();
  const categoryLower = eventCategory.toLowerCase().trim();
  const nameLower = eventName.toLowerCase().trim();
  
  // Exact category match
  if (userSportLower === categoryLower) {
    return true;
  }
  
  // Special handling for "Football" to avoid matching compound sports
  if (userSportLower === 'football') {
    // Explicitly exclude American Football, Australian Rules Football, Flag Football, etc.
    const footballCompounds = [
      'american football',
      'american flag football', 
      'flag football',
      'australian rules football',
      'afl', // Australian Football League
      'gridiron'
    ];
    
    // Check if category or name contains any excluded compound
    const textToCheck = `${categoryLower} ${nameLower}`;
    const isCompoundFootball = footballCompounds.some(compound => 
      textToCheck.includes(compound)
    );
    
    if (isCompoundFootball) {
      console.log(`[DEBUG] ❌ Excluding compound football sport: "${eventName}" (${eventCategory})`);
      return false;
    }
    
    // Now check if it's actually football/soccer
    const footballKeywords = ['football', 'soccer', '5-a-side', '7-a-side', '11-a-side'];
    return footballKeywords.some(keyword => 
      categoryLower.includes(keyword) || nameLower.includes(keyword)
    );
  }
  
  // Special handling for "Boxing" to avoid matching "Kids Boxing", "Youth Boxing", etc.
  if (userSportLower === 'boxing') {
    // Check if it's a kids/youth boxing session
    if (isChildrenSession(eventName, eventCategory)) {
      console.log(`[DEBUG] ❌ Excluding children's boxing: "${eventName}"`);
      return false;
    }
    
    // Check for boxing keywords
    return categoryLower.includes('boxing') || nameLower.includes('boxing');
  }
  
  // For other sports, use word boundary matching
  const sportRegex = new RegExp(`\\b${userSportLower}\\b`, 'i');
  
  // Check category with word boundaries
  if (sportRegex.test(categoryLower)) {
    return true;
  }
  
  // Check event name with word boundaries  
  if (sportRegex.test(nameLower)) {
    return true;
  }
  
  return false;
}

/**
 * Check if an event is targeted at children/youth (should be filtered for adults)
 */
function isChildrenSession(eventName: string, eventCategory: string): boolean {
  const text = `${eventName} ${eventCategory}`.toLowerCase();
  
  const childKeywords = [
    'kids', 'children', 'child', 'youth', 'junior', 'juniors',
    'under 16', 'under 18', 'u16', 'u18', 'u14', 'u12', 'u10',
    'primary school', 'secondary school', 'school kids', 'school-age'
  ];
  
  return childKeywords.some(keyword => text.includes(keyword));
}

function matchesSkillLevel(eventName: string, userLevel: string): { matches: boolean; level: string } {
  if (!userLevel) return { matches: false, level: '' };
  
  const eventLower = eventName.toLowerCase();
  const userLower = userLevel.toLowerCase();
  
  // Skill level keywords
  const skillLevels = ['beginner', 'intermediate', 'advanced', 'all levels', 'mixed ability'];
  
  for (const level of skillLevels) {
    if (eventLower.includes(level)) {
      // Check if it's a match or at least accepts all levels
      if (level === 'all levels' || level === 'mixed ability') {
        return { matches: true, level };
      }
      if (userLower.includes(level) || level.includes(userLower)) {
        return { matches: true, level };
      }
    }
  }
  
  return { matches: false, level: '' };
}

function generateRecommendations(
  events: Event[],
  profile: UserProfile,
  bookings: Booking[]
): RecommendationCard[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const bookedEventIDs = new Set(bookings.map(b => b.eventID));

  console.log(`[DEBUG] ===== STARTING RECOMMENDATIONS =====`);
  console.log(`[DEBUG] User gender: ${profile.gender}`);
  console.log(`[DEBUG] User preferred sports:`, profile.preferredSports);
  console.log(`[DEBUG] User motivations:`, profile.motivations);
  console.log(`[DEBUG] User session format preference:`, profile.sessionFormatPreference);
  console.log(`[DEBUG] User home borough:`, profile.homeBorough);

  // Filter to future, active, unbooked events
  let candidates = events.filter(event => {
    const eventDate = new Date(event.date);
    eventDate.setHours(0, 0, 0, 0);
    const isActive = event.active.toLowerCase() === 'true' || event.active.toLowerCase() === 'yes';
    return eventDate >= now && 
           isActive && 
           !bookedEventIDs.has(event.eventID);
  });

  console.log(`[DEBUG] ${candidates.length} candidate events before filtering`);

  // FIRST: Filter out children/youth sessions for adult users
  candidates = candidates.filter(event => {
    if (isChildrenSession(event.eventName, event.category)) {
      console.log(`[DEBUG] ❌ Filtered out children's session: "${event.eventName}"`);
      return false;
    }
    return true;
  });

  console.log(`[DEBUG] ${candidates.length} candidate events after children filtering`);

  // SECOND: Filter out gender-incompatible sessions
  candidates = candidates.filter(event => {
    const genderCheck = checkGenderCompatibility(event.genderTarget, profile.gender);
    if (!genderCheck.isCompatible) {
      console.log(`[DEBUG] ❌ Filtered out "${event.eventName}" due to gender incompatibility`);
    }
    return genderCheck.isCompatible;
  });

  console.log(`[DEBUG] ${candidates.length} candidate events after gender filtering`);

  const userRegion = profile.homeBorough ? getBoroughRegion(profile.homeBorough) : null;

  const scoredEvents = candidates.map(event => {
    let score = 0;
    const reasons: string[] = [];
    let hasSportMatch = false;

    // 1. SPORT/ACTIVITY MATCH (80 points) - INCREASED IMPORTANCE
    const sportMatch = profile.preferredSports.some(s => 
      isSportMatch(s, event.category, event.eventName)
    );
    
    if (sportMatch) {
      score += 80; // Increased from 50 to 80
      hasSportMatch = true;
      const matchedSport = profile.preferredSports.find(s => 
        isSportMatch(s, event.category, event.eventName)
      );
      reasons.push(`${matchedSport || event.category} session`);
      console.log(`[DEBUG] ✅ "${event.eventName}" matched sport: ${matchedSport} (+80 points)`);
    } else {
      console.log(`[DEBUG] ⚠️ "${event.eventName}" (${event.category}) - NO sport match with:`, profile.preferredSports);
    }

    // 2. GEOGRAPHIC PROXIMITY (35 points)
    const eventBorough = event.borough || extractBorough(event.location);
    
    // Exact borough match
    if (profile.homeBorough && eventBorough.toLowerCase().includes(profile.homeBorough.toLowerCase())) {
      score += 35;
      reasons.push(`in ${eventBorough}`);
      console.log(`[DEBUG] ✅ "${event.eventName}" exact borough match (+35 points)`);
    } 
    // Regional proximity (e.g., both in East London)
    else if (userRegion) {
      const eventRegion = getBoroughRegion(eventBorough);
      if (eventRegion === userRegion) {
        score += 25;
        reasons.push(`in ${eventRegion} London`);
        console.log(`[DEBUG] ✅ "${event.eventName}" regional match: ${eventRegion} (+25 points)`);
      }
    }

    // 3. GENDER DEMOGRAPHIC MATCH (30 points)
    // At this point we know the session is compatible (we filtered incompatible ones)
    // Now check if there's a match for bonus points
    const genderCheck = checkGenderCompatibility(event.genderTarget, profile.gender);
    if (genderCheck.bonusPoints > 0 && genderCheck.matchReason) {
      score += genderCheck.bonusPoints;
      reasons.push(genderCheck.matchReason);
      console.log(`[DEBUG] ✅ "${event.eventName}" gender match (+${genderCheck.bonusPoints} points)`);
    }

    // 4. MOTIVATIONS MATCH (25 points)
    // Check if any of the user's motivations match the event's motivations
    if (profile.motivations.length > 0 && event.motivations.length > 0) {
      const motivationMatches = profile.motivations.filter(userMotivation =>
        event.motivations.some(eventMotivation =>
          eventMotivation.toLowerCase().trim() === userMotivation.toLowerCase().trim()
        )
      );
      
      if (motivationMatches.length > 0) {
        score += 25;
        console.log(`[DEBUG] ✅ "${event.eventName}" motivation match: ${motivationMatches.join(', ')} (+25 points)`);
        // Add the first matched motivation to reasons (keep it concise)
        reasons.push(`for ${motivationMatches[0].toLowerCase()}`);
      }
    }

    // 5. SKILL/FITNESS LEVEL MATCH (25 points)
    const skillMatch = matchesSkillLevel(event.eventName, profile.fitnessLevel);
    if (skillMatch.matches) {
      score += 25;
      reasons.push(`${skillMatch.level} level`);
      console.log(`[DEBUG] ✅ "${event.eventName}" skill level match (+25 points)`);
    }

    // 6. SESSION FORMAT MATCH (20 points)
    // Check if the event's session format matches user's preference
    if (profile.sessionFormatPreference && event.sessionFormat) {
      const userFormatLower = profile.sessionFormatPreference.toLowerCase().trim();
      const eventFormatLower = event.sessionFormat.toLowerCase().trim();
      
      if (userFormatLower === eventFormatLower) {
        score += 20;
        console.log(`[DEBUG] ✅ "${event.eventName}" session format match: ${event.sessionFormat} (+20 points)`);
        reasons.push(`${event.sessionFormat.toLowerCase()} format`);
      }
    }

    // 7. DAY PREFERENCE MATCH (20 points)
    if (profile.preferredDays && profile.preferredDays.length > 0) {
      const eventDay = getDayOfWeek(event.date);
      if (eventDay && profile.preferredDays.some(day => day.toLowerCase() === eventDay.toLowerCase())) {
        score += 20;
        reasons.push(`on ${eventDay}`);
        console.log(`[DEBUG] ✅ "${event.eventName}" day match (+20 points)`);
      }
    }

    // 8. TIME PREFERENCE MATCH (15 points)
    if (profile.preferredTimes && profile.preferredTimes.length > 0) {
      const eventTime = event.time.toLowerCase();
      if (profile.preferredTimes.some(time => eventTime.includes(time.toLowerCase()))) {
        score += 15;
        reasons.push('at your preferred time');
        console.log(`[DEBUG] ✅ "${event.eventName}" time match (+15 points)`);
      }
    }

    // 9. PRICE BONUS (5-10 points for affordable sessions)
    if (event.price <= 10) {
      score += 10;
      if (event.price <= 5) {
        reasons.push('budget-friendly');
      }
      console.log(`[DEBUG] ✅ "${event.eventName}" price bonus (+10 points)`);
    }

    // PENALTY: If no sport match, apply heavy penalty (reduce score by 60%)
    // This ensures sport-mismatched sessions rarely appear unless there are no alternatives
    if (!hasSportMatch && profile.preferredSports.length > 0) {
      const originalScore = score;
      score = Math.floor(score * 0.4); // Keep only 40% of score
      console.log(`[DEBUG] ⚠️ "${event.eventName}" NO sport match - applying penalty: ${originalScore} → ${score}`);
    }

    console.log(`[DEBUG] 📊 "${event.eventName}" final score: ${score} points`);

    // Build reason string
    let reason = reasons.length > 0 ? reasons.join(' · ') : 'New session in your area';
    
    // Capitalize first letter
    reason = reason.charAt(0).toUpperCase() + reason.slice(1);

    // Calculate curved display percentage
    const displayPercentage = calculateDisplayPercentage(score);

    return {
      eventID: event.eventID,
      title: event.eventName,
      sport: event.category,
      date: event.date,
      time: formatTime(event.time),
      venue: event.location,
      borough: eventBorough,
      price: event.price,
      difficulty: skillMatch.level || '',
      score,
      displayPercentage,
      reason,
      attendeeUrl: event.attendeesPublicUrl || event.attendeesUrl || '',
      image: event.imageUrl || '',
      bookingUrl: event.bookingUrl || '',
    };
  });

  // Sort by score (highest first)
  scoredEvents.sort((a, b) => b.score - a.score);

  console.log('[DEBUG] ===== TOP 10 SCORED EVENTS =====');
  scoredEvents.slice(0, 10).forEach((event, i) => {
    console.log(`[DEBUG] #${i + 1}: "${event.title}" - ${event.score} pts (${event.displayPercentage}%) - ${event.reason}`);
  });

  // QUALITY THRESHOLD: Only show recommendations with score >= 60
  // This ensures we don't show completely irrelevant sessions
  // With sport match worth 80 points, a good match should score 80+
  const MIN_RECOMMENDATION_SCORE = 60;
  const qualityRecommendations = scoredEvents.filter(rec => rec.score >= MIN_RECOMMENDATION_SCORE);

  console.log(`[DEBUG] ${qualityRecommendations.length} events passed quality threshold (score >= ${MIN_RECOMMENDATION_SCORE})`);

  // Deduplicate by session template ID - only show one instance of each session
  const seenTemplateIDs = new Set<string>();
  const uniqueRecommendations: RecommendationCard[] = [];
  
  for (const rec of qualityRecommendations) {
    // Find the original event to get its sessionTemplateID
    const event = events.find(e => e.eventID === rec.eventID);
    const templateID = event?.sessionTemplateID?.trim() || '';
    
    console.log(`[DEBUG] Event ${rec.eventID}: "${rec.title}", Session ID: "${templateID}"`);
    
    // If no session template ID, use eventID as fallback to ensure uniqueness
    const uniqueKey = templateID || rec.eventID;
    
    // Skip if we've already seen this session template
    if (seenTemplateIDs.has(uniqueKey)) {
      console.log(`[DEBUG] ⏭️ Skipping duplicate session template: ${uniqueKey}`);
      continue;
    }
    
    // Add to results and mark as seen
    seenTemplateIDs.add(uniqueKey);
    uniqueRecommendations.push(rec);
    console.log(`[DEBUG] ✅ Added unique session: ${rec.title} (${uniqueKey})`);
    
    // Stop once we have 5 unique sessions
    if (uniqueRecommendations.length >= 5) {
      break;
    }
  }

  console.log('[DEBUG] ===== FINAL RECOMMENDATIONS =====');
  console.log(`[DEBUG] Returning ${uniqueRecommendations.length} unique recommendations`);
  uniqueRecommendations.forEach((rec, i) => {
    console.log(`[DEBUG] #${i + 1}: "${rec.title}" - ${rec.score} pts (${rec.displayPercentage}%)`);
    console.log(`[DEBUG]       Reason: ${rec.reason}`);
  });

  return uniqueRecommendations;
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
