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

function safeGet(row: any[], idx: number, fallback = ''): string {
  if (idx < 0 || idx >= row.length) return fallback;
  return row[idx]?.toString() || fallback;
}

async function getSheets() {
  const serviceAccountKey = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!serviceAccountKey) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY is missing');

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

function getDateBadge(date: string): string | undefined {
  try {
    const eventDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    eventDate.setHours(0, 0, 0, 0);
    const diffDays = Math.ceil((eventDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
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
  if (!location) return '';

  const londonBoroughs = [
    'Westminster', 'Camden', 'Islington', 'Hackney', 'Tower Hamlets', 'Greenwich',
    'Lewisham', 'Southwark', 'Lambeth', 'Wandsworth', 'Hammersmith', 'Fulham',
    'Kensington', 'Chelsea', 'Brent', 'Ealing', 'Hounslow', 'Richmond', 'Kingston',
    'Merton', 'Sutton', 'Croydon', 'Bromley', 'Bexley', 'Havering', 'Barking',
    'Dagenham', 'Redbridge', 'Newham', 'Waltham Forest', 'Haringey', 'Enfield',
    'Barnet', 'Harrow', 'Hillingdon',
  ];

  const locationLower = location.toLowerCase();
  for (const borough of londonBoroughs) {
    if (locationLower.includes(borough.toLowerCase())) return borough;
  }

  const parts = location.split(',').map(p => p.trim());
  const meaningfulParts = parts.filter(part => {
    const partLower = part.toLowerCase();
    return !partLower.includes('uk') &&
      !partLower.includes('england') &&
      part !== 'London' &&
      !/ (UK|N1|N2|N3|N4|N5|N6|N7|N8|N9|N10|SW1|SW2|SW3|SE1|SE2|SE3|E1|E2|E3|W1|W2|W3|NW1|NW2)/.test(part);
  });

  if (meaningfulParts.length >= 2) return meaningfulParts[meaningfulParts.length - 2];
  if (meaningfulParts.length === 1) return meaningfulParts[0];
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

  const emailIdx             = getColumnIndex(headers, 'Email');
  const nameIdx              = getColumnIndex(headers, 'Name');
  const genderIdx            = getColumnIndex(headers, 'Gender');
  const boroughIdx           = getColumnIndex(headers, 'Home Borough');
  const favouriteActivityIdx = getColumnIndex(headers, 'Favourite Activity');
  const experienceLevelIdx   = getColumnIndex(headers, 'Experience Level');
  const otherActivitiesIdx   = getColumnIndex(headers, 'Other Activities Interested In');
  const motivationsIdx       = getColumnIndex(headers, 'Motivations');
  const sessionFormatIdx     = getColumnIndex(headers, 'Session Format Preference');

  if (emailIdx === -1) throw new Error('Email column not found in Onboarding Database');

  const userRow = dataRows.find(
    (row) => row[emailIdx]?.toString().toLowerCase().trim() === normalizedEmail
  );

  if (!userRow) return null;

  const fullName  = safeGet(userRow, nameIdx);
  const nameParts = fullName.split(' ');

  const preferredSports: string[] = [];
  const favActivity = safeGet(userRow, favouriteActivityIdx);
  if (favActivity) preferredSports.push(favActivity);
  const otherActivities = safeGet(userRow, otherActivitiesIdx);
  if (otherActivities) preferredSports.push(...parseCommaSeparated(otherActivities));

  return {
    email:                   safeGet(userRow, emailIdx),
    firstName:               nameParts[0] || '',
    lastName:                nameParts.slice(1).join(' ') || '',
    homeBorough:             safeGet(userRow, boroughIdx),
    preferredSports,
    preferredDays:           [],
    preferredTimes:          [],
    fitnessLevel:            safeGet(userRow, experienceLevelIdx),
    motivations:             parseCommaSeparated(safeGet(userRow, motivationsIdx)),
    sessionFormatPreference: safeGet(userRow, sessionFormatIdx),
    gender:                  safeGet(userRow, genderIdx),
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

  // Named lookups
  const eventIDIdx           = getColumnIndex(headers, 'event_id');
  const eventNameIdx         = getColumnIndex(headers, 'event_name');
  const categoryIdx          = getColumnIndex(headers, 'Category');
  const dateIdx              = getColumnIndex(headers, 'date');
  const timeIdx              = getColumnIndex(headers, 'time');
  const endTimeIdx           = getColumnIndex(headers, 'End Time');
  const locationIdx          = getColumnIndex(headers, 'location');
  const priceIdx             = getColumnIndex(headers, 'base_price');
  const spotsRemainingIdx    = getColumnIndex(headers, 'spots_remaining');
  const bookingUrlIdx        = getColumnIndex(headers, 'booking_url');
  const durationIdx          = getColumnIndex(headers, 'Duration Minutes');
  const activeIdx            = getColumnIndex(headers, 'active');
  const attendeesUrlIdx      = getColumnIndex(headers, 'attendees_url');
  const attendeesPublicUrlIdx = getColumnIndex(headers, 'attendees_public_url');
  const imageUrlIdx          = getColumnIndex(headers, 'Image URL');

  // Fixed positional columns — no !== -1 checks needed
  const BOROUGH_COL            = 27;
  const SESSION_TEMPLATE_COL   = 28;
  const GENDER_TARGET_COL      = 29;
  const MOTIVATIONS_COL        = 31;
  const SESSION_FORMAT_COL     = 32;

  const events: Event[] = [];

  for (const row of dataRows) {
    if (!row[eventIDIdx]) continue;

    events.push({
      eventID:            safeGet(row, eventIDIdx),
      sessionTemplateID:  safeGet(row, SESSION_TEMPLATE_COL),
      eventName:          safeGet(row, eventNameIdx),
      category:           safeGet(row, categoryIdx),
      date:               safeGet(row, dateIdx),
      time:               safeGet(row, timeIdx),
      endTime:            safeGet(row, endTimeIdx),
      location:           safeGet(row, locationIdx),
      borough:            safeGet(row, BOROUGH_COL),
      price:              parsePrice(safeGet(row, priceIdx, '0')),
      spotsRemaining:     parseInt(safeGet(row, spotsRemainingIdx, '0')),
      bookingUrl:         safeGet(row, bookingUrlIdx),
      durationMinutes:    parseInt(safeGet(row, durationIdx, '60')),
      active:             safeGet(row, activeIdx, 'TRUE'),
      attendeesUrl:       safeGet(row, attendeesUrlIdx),
      attendeesPublicUrl: safeGet(row, attendeesPublicUrlIdx),
      imageUrl:           safeGet(row, imageUrlIdx),
      genderTarget:       safeGet(row, GENDER_TARGET_COL),
      motivations:        parseCommaSeparated(safeGet(row, MOTIVATIONS_COL)),
      sessionFormat:      safeGet(row, SESSION_FORMAT_COL),
    });
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

  const bookingIDIdx      = getColumnIndex(headers, 'booking_id');
  const bookingDateIdx    = getColumnIndex(headers, 'booking_date');
  const eventIDIdx        = getColumnIndex(headers, 'event_id');
  const eventNameIdx      = getColumnIndex(headers, 'event_name');
  const customerEmailIdx  = getColumnIndex(headers, 'customer_email');
  const amountPaidIdx     = getColumnIndex(headers, 'amount_paid');
  const statusIdx         = getColumnIndex(headers, 'status');
  const skillLevelIdx     = getColumnIndex(headers, 'skill_level');
  const eventDateIdx      = getColumnIndex(headers, 'event_date');
  const eventTimeIdx      = getColumnIndex(headers, 'event_time');
  const eventLocationIdx  = getColumnIndex(headers, 'event_location');

  if (customerEmailIdx === -1) return [];

  const bookings: Booking[] = [];

  for (const row of dataRows) {
    if (row[customerEmailIdx]?.toString().toLowerCase().trim() !== normalizedEmail) continue;

    bookings.push({
      bookingID:     safeGet(row, bookingIDIdx),
      bookingDate:   safeGet(row, bookingDateIdx),
      eventID:       safeGet(row, eventIDIdx),
      eventName:     safeGet(row, eventNameIdx),
      customerEmail: safeGet(row, customerEmailIdx),
      amountPaid:    safeGet(row, amountPaidIdx),
      status:        safeGet(row, statusIdx, 'Confirmed'),
      skillLevel:    safeGet(row, skillLevelIdx),
      eventDate:     safeGet(row, eventDateIdx),
      eventTime:     safeGet(row, eventTimeIdx),
      eventLocation: safeGet(row, eventLocationIdx),
    });
  }

  return bookings;
}

// ==========================================
// DATA TRANSFORMATION
// ==========================================

function createSessionCardFromBooking(booking: Booking, event: Event | undefined, isPast: boolean): SessionCard {
  const eventName = event?.eventName || booking.eventName;
  const eventDate = event?.date || booking.eventDate;
  const eventTime = event?.time || booking.eventTime;
  const location  = event?.location || booking.eventLocation;
  const price     = event?.price || parsePrice(booking.amountPaid);
  const category  = event?.category || '';
  const borough   = event?.borough || extractBorough(location);
  const attendeeUrl = event?.attendeesPublicUrl || event?.attendeesUrl || '';
  const image     = event?.imageUrl || '';

  return {
    eventID:           booking.eventID,
    title:             eventName,
    sport:             category,
    date:              eventDate,
    time:              eventTime,
    venue:             location,
    borough,
    price,
    badge:             isPast ? undefined : getDateBadge(eventDate),
    difficulty:        booking.skillLevel || '',
    bookingID:         booking.bookingID,
    attendanceStatus:  isPast ? booking.status : undefined,
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
  const past: SessionCard[]     = [];
  const seenBookingIds          = new Set<string>();

  for (const booking of bookings) {
    if (seenBookingIds.has(booking.bookingID)) continue;
    seenBookingIds.add(booking.bookingID);

    const event     = eventMap.get(booking.eventID);
    const eventDate = new Date(event?.date || booking.eventDate);
    eventDate.setHours(0, 0, 0, 0);
    const isPast = eventDate < now;

    const card = createSessionCardFromBooking(booking, event, isPast);
    if (isPast) past.push(card);
    else upcoming.push(card);
  }

  upcoming.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  past.sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  const pastTotal = past.length;
  const start     = (page - 1) * pageSize;

  return { upcoming, past: past.slice(start, start + pageSize), pastTotal };
}

// ==========================================
// STATISTICS
// ==========================================

function calculateStats(bookings: Booking[], events: Event[]): UserStats {
  const eventMap = new Map(events.map(e => [e.eventID, e]));

  const attended = bookings.filter(b => {
    const eventDate = new Date(b.eventDate);
    const now = new Date();
    now.setHours(0, 0, 0, 0);
    if (eventDate >= now) return false;
    const status = b.status.toLowerCase();
    if (status.includes('cancelled') || status.includes('cancel') ||
        status.includes('no-show') || status.includes('noshow')) return false;
    return true;
  });

  const totalSpent = bookings.reduce((sum, b) => {
    const status = b.status.toLowerCase();
    if (status.includes('cancelled') || status.includes('cancel')) return sum;
    return sum + parsePrice(b.amountPaid);
  }, 0);

  let totalMinutes = 0;
  const sportCounts = new Map<string, number>();
  const dayCounts   = new Map<string, number>();

  for (const booking of attended) {
    const event = eventMap.get(booking.eventID);
    totalMinutes += event ? event.durationMinutes : 90;
    if (event?.category) {
      sportCounts.set(event.category, (sportCounts.get(event.category) || 0) + 1);
    }
    const day = getDayOfWeek(booking.eventDate);
    if (day) dayCounts.set(day, (dayCounts.get(day) || 0) + 1);
  }

  const mostPlayedSport = sportCounts.size > 0
    ? Array.from(sportCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  const mostCommonDay = dayCounts.size > 0
    ? Array.from(dayCounts.entries()).sort((a, b) => b[1] - a[1])[0][0]
    : null;

  return {
    totalBooked:      bookings.length,
    totalAttended:    attended.length,
    totalHoursPlayed: Math.round((totalMinutes / 60) * 10) / 10,
    totalSpent:       Math.round(totalSpent * 100) / 100,
    mostPlayedSport,
    mostCommonDay,
  };
}

// ==========================================
// RECOMMENDATIONS
// ==========================================

const LONDON_REGIONS: Record<string, string[]> = {
  East:    ['Hackney', 'Tower Hamlets', 'Newham', 'Waltham Forest', 'Redbridge', 'Barking', 'Dagenham', 'Havering'],
  West:    ['Hammersmith', 'Fulham', 'Ealing', 'Hounslow', 'Brent', 'Hillingdon', 'Harrow'],
  North:   ['Camden', 'Islington', 'Haringey', 'Enfield', 'Barnet'],
  South:   ['Lambeth', 'Southwark', 'Lewisham', 'Greenwich', 'Bromley', 'Croydon', 'Sutton', 'Merton'],
  Central: ['Westminster', 'Kensington', 'Chelsea', 'City of London'],
};

function getBoroughRegion(borough: string): string | null {
  for (const [region, boroughs] of Object.entries(LONDON_REGIONS)) {
    if (boroughs.some(b => borough.toLowerCase().includes(b.toLowerCase()))) return region;
  }
  return null;
}

function checkGenderCompatibility(
  sessionGenderTarget: string,
  userGender: string
): { isCompatible: boolean; bonusPoints: number; matchReason?: string } {
  const sessionTarget = sessionGenderTarget.trim().toLowerCase();
  const userGen       = userGender.trim().toLowerCase();

  if (!sessionTarget || !userGen) return { isCompatible: true, bonusPoints: 0 };

  if (sessionTarget.includes('women only')) {
    if (userGen === 'female') return { isCompatible: true, bonusPoints: 30, matchReason: "women's session" };
    if (userGen === 'male')   return { isCompatible: false, bonusPoints: 0 };
  }

  if (sessionTarget.includes('men only') || sessionTarget === 'men') {
    if (userGen === 'male')   return { isCompatible: true, bonusPoints: 30, matchReason: "men's session" };
    if (userGen === 'female') return { isCompatible: false, bonusPoints: 0 };
  }

  return { isCompatible: true, bonusPoints: 0 };
}

function calculateDisplayPercentage(rawScore: number): number {
  if (rawScore >= 120) {
    const normalized = Math.min((rawScore - 120) / (260 - 120), 1);
    return Math.round(80 + normalized * 20);
  } else if (rawScore >= 90) {
    const normalized = (rawScore - 90) / 29;
    return Math.round(60 + normalized * 19);
  } else if (rawScore >= 60) {
    const normalized = (rawScore - 60) / 29;
    return Math.round(40 + normalized * 19);
  } else if (rawScore >= 40) {
    const normalized = (rawScore - 40) / 19;
    return Math.round(25 + normalized * 14);
  } else {
    const normalized = Math.min(rawScore / 39, 1);
    return Math.round(10 + normalized * 14);
  }
}

function isChildrenSession(eventName: string, eventCategory: string): boolean {
  const text = `${eventName} ${eventCategory}`.toLowerCase();
  return ['kids', 'children', 'child', 'youth', 'junior', 'juniors',
    'under 16', 'under 18', 'u16', 'u18', 'u14', 'u12', 'u10',
    'primary school', 'secondary school', 'school kids', 'school-age',
  ].some(k => text.includes(k));
}

function isSportMatch(userSport: string, eventCategory: string, eventName: string): boolean {
  const userSportLower = userSport.toLowerCase().trim();
  const categoryLower  = eventCategory.toLowerCase().trim();
  const nameLower      = eventName.toLowerCase().trim();

  if (userSportLower === categoryLower) return true;

  if (userSportLower === 'football') {
    const compounds = ['american football', 'american flag football', 'flag football', 'australian rules football', 'afl', 'gridiron'];
    if (compounds.some(c => `${categoryLower} ${nameLower}`.includes(c))) return false;
    return ['football', 'soccer', '5-a-side', '7-a-side', '11-a-side'].some(k => categoryLower.includes(k) || nameLower.includes(k));
  }

  if (userSportLower === 'boxing') {
    if (isChildrenSession(eventName, eventCategory)) return false;
    return categoryLower.includes('boxing') || nameLower.includes('boxing');
  }

  const sportRegex = new RegExp(`\\b${userSportLower}\\b`, 'i');
  return sportRegex.test(categoryLower) || sportRegex.test(nameLower);
}

function matchesSkillLevel(eventName: string, userLevel: string): { matches: boolean; level: string } {
  if (!userLevel) return { matches: false, level: '' };
  const eventLower  = eventName.toLowerCase();
  const userLower   = userLevel.toLowerCase();
  const skillLevels = ['beginner', 'intermediate', 'advanced', 'all levels', 'mixed ability'];

  for (const level of skillLevels) {
    if (eventLower.includes(level)) {
      if (level === 'all levels' || level === 'mixed ability') return { matches: true, level };
      if (userLower.includes(level) || level.includes(userLower)) return { matches: true, level };
    }
  }
  return { matches: false, level: '' };
}

function generateRecommendations(events: Event[], profile: UserProfile, bookings: Booking[]): RecommendationCard[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  const bookedEventIDs = new Set(bookings.map(b => b.eventID));

  let candidates = events.filter(event => {
    const eventDate = new Date(event.date);
    eventDate.setHours(0, 0, 0, 0);
    const isActive = event.active.toLowerCase() === 'true' || event.active.toLowerCase() === 'yes';
    return eventDate >= now && isActive && !bookedEventIDs.has(event.eventID) && !isChildrenSession(event.eventName, event.category);
  });

  candidates = candidates.filter(event =>
    checkGenderCompatibility(event.genderTarget, profile.gender).isCompatible
  );

  const userRegion = profile.homeBorough ? getBoroughRegion(profile.homeBorough) : null;

  const scoredEvents = candidates.map(event => {
    let score = 0;
    const reasons: string[] = [];
    let hasSportMatch = false;

    // 1. Sport match (80pts)
    const sportMatch = profile.preferredSports.some(s => isSportMatch(s, event.category, event.eventName));
    if (sportMatch) {
      score += 80;
      hasSportMatch = true;
      const matchedSport = profile.preferredSports.find(s => isSportMatch(s, event.category, event.eventName));
      reasons.push(`${matchedSport || event.category} session`);
    }

    // 2. Geographic proximity (35pts exact, 25pts regional)
    const eventBorough = event.borough || extractBorough(event.location);
    if (profile.homeBorough && eventBorough.toLowerCase().includes(profile.homeBorough.toLowerCase())) {
      score += 35;
      reasons.push(`in ${eventBorough}`);
    } else if (userRegion) {
      const eventRegion = getBoroughRegion(eventBorough);
      if (eventRegion === userRegion) {
        score += 25;
        reasons.push(`in ${eventRegion} London`);
      }
    }

    // 3. Gender match bonus (30pts)
    const genderCheck = checkGenderCompatibility(event.genderTarget, profile.gender);
    if (genderCheck.bonusPoints > 0 && genderCheck.matchReason) {
      score += genderCheck.bonusPoints;
      reasons.push(genderCheck.matchReason);
    }

    // 4. Motivations match (25pts)
    if (profile.motivations.length > 0 && event.motivations.length > 0) {
      const motivationMatches = profile.motivations.filter(um =>
        event.motivations.some(em => em.toLowerCase().trim() === um.toLowerCase().trim())
      );
      if (motivationMatches.length > 0) {
        score += 25;
        reasons.push(`for ${motivationMatches[0].toLowerCase()}`);
      }
    }

    // 5. Skill level match (25pts)
    const skillMatch = matchesSkillLevel(event.eventName, profile.fitnessLevel);
    if (skillMatch.matches) {
      score += 25;
      reasons.push(`${skillMatch.level} level`);
    }

    // 6. Session format match (20pts)
    if (profile.sessionFormatPreference && event.sessionFormat) {
      if (profile.sessionFormatPreference.toLowerCase().trim() === event.sessionFormat.toLowerCase().trim()) {
        score += 20;
        reasons.push(`${event.sessionFormat.toLowerCase()} format`);
      }
    }

    // 7. Day preference (20pts)
    if (profile.preferredDays?.length > 0) {
      const eventDay = getDayOfWeek(event.date);
      if (eventDay && profile.preferredDays.some(d => d.toLowerCase() === eventDay.toLowerCase())) {
        score += 20;
        reasons.push(`on ${eventDay}`);
      }
    }

    // 8. Time preference (15pts)
    if (profile.preferredTimes?.length > 0) {
      const eventTime = event.time.toLowerCase();
      if (profile.preferredTimes.some(t => eventTime.includes(t.toLowerCase()))) {
        score += 15;
        reasons.push('at your preferred time');
      }
    }

    // 9. Price bonus (10pts)
    if (event.price <= 10) {
      score += 10;
      if (event.price <= 5) reasons.push('budget-friendly');
    }

    if (!hasSportMatch && profile.preferredSports.length > 0) {
      score = Math.floor(score * 0.4);
    }

    const reason = reasons.length > 0
      ? (reasons[0].charAt(0).toUpperCase() + reasons[0].slice(1)) + (reasons.length > 1 ? ' · ' + reasons.slice(1).join(' · ') : '')
      : 'New session in your area';

    return {
      eventID:           event.eventID,
      title:             event.eventName,
      sport:             event.category,
      date:              event.date,
      time:              event.time,
      venue:             event.location,
      borough:           eventBorough,
      price:             event.price,
      difficulty:        skillMatch.level || '',
      score,
      displayPercentage: calculateDisplayPercentage(score),
      reason,
      attendeeUrl:       event.attendeesPublicUrl || event.attendeesUrl || '',
      image:             event.imageUrl || '',
      bookingUrl:        event.bookingUrl || '',
    };
  });

  scoredEvents.sort((a, b) => b.score - a.score);

  const MIN_SCORE = 60;
  const quality   = scoredEvents.filter(r => r.score >= MIN_SCORE);

  const seenTemplates = new Set<string>();
  const unique: RecommendationCard[] = [];

  for (const rec of quality) {
    const event = events.find(e => e.eventID === rec.eventID);
    const key   = event?.sessionTemplateID?.trim() || rec.eventID;
    if (seenTemplates.has(key)) continue;
    seenTemplates.add(key);
    unique.push(rec);
    if (unique.length >= 5) break;
  }

  return unique;
}

// ==========================================
// HANDLER
// ==========================================

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: { code: 'METHOD_NOT_ALLOWED', message: 'Method not allowed' } });
  }

  const email    = req.query.email as string;
  const page     = parseInt(req.query.page as string) || 1;
  const pageSize = parseInt(req.query.pageSize as string) || 10;

  if (!email) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_EMAIL', message: 'Email parameter required' } });
  }

  try {
    const [profile, events, bookings] = await Promise.all([
      fetchUserProfile(email),
      fetchEvents(),
      fetchBookings(email),
    ]);

    if (!profile) {
      return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'User not found' } });
    }

    const { upcoming, past, pastTotal } = separateSessions(bookings, events, page, pageSize);
    const stats          = calculateStats(bookings, events);
    const recommendations = generateRecommendations(events, profile, bookings);

    return res.status(200).json({
      success: true,
      data: {
        profile,
        upcomingSessions:  upcoming,
        pastSessions:      past,
        pastSessionsTotal: pastTotal,
        stats,
        recommendations,
      },
    });

  } catch (error) {
    console.error('[ERROR] Dashboard API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
  }
}
