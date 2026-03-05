import { google } from 'googleapis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

const SPREADSHEET_ID = process.env.GOOGLE_SHEETS_SPREADSHEET_ID!;
const ONBOARDING_SHEET = 'Onboarding Database';
const EVENTS_SHEET = 'NBRH Events';

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
  imageUrl: string;
  genderTarget: string;
  motivations: string[];
  sessionFormat: string;
}

export interface RecommendationCard {
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
  image?: string;
  bookingUrl?: string;
  spotsRemaining?: number;
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

  const emailIdx = getColumnIndex(headers, 'Email');
  const nameIdx = getColumnIndex(headers, 'Name');
  const genderIdx = 3;
  const boroughIdx = getColumnIndex(headers, 'Home Borough');
  const favouriteActivityIdx = getColumnIndex(headers, 'Favourite Activity');
  const experienceLevelIdx = getColumnIndex(headers, 'Experience Level');
  const otherActivitiesIdx = getColumnIndex(headers, 'Other Activities Interested In');
  const motivationsIdx = getColumnIndex(headers, 'Motivations');
  const sessionFormatIdx = getColumnIndex(headers, 'Session Format Preference');

  if (emailIdx === -1) throw new Error('Email column not found in Onboarding Database');

  const userRow = dataRows.find(
    (row) => row[emailIdx]?.toString().toLowerCase().trim() === normalizedEmail
  );

  if (!userRow) return null;

  const fullName = nameIdx !== -1 ? userRow[nameIdx]?.toString() || '' : '';
  const nameParts = fullName.split(' ');

  const preferredSports: string[] = [];
  if (favouriteActivityIdx !== -1 && userRow[favouriteActivityIdx]) {
    preferredSports.push(userRow[favouriteActivityIdx].toString());
  }
  if (otherActivitiesIdx !== -1 && userRow[otherActivitiesIdx]) {
    preferredSports.push(...parseCommaSeparated(userRow[otherActivitiesIdx].toString()));
  }

  const motivations = motivationsIdx !== -1 && userRow[motivationsIdx]
    ? parseCommaSeparated(userRow[motivationsIdx].toString())
    : [];

  const sessionFormatPreference = sessionFormatIdx !== -1 && userRow[sessionFormatIdx]
    ? userRow[sessionFormatIdx].toString()
    : '';

  return {
    email: userRow[emailIdx]?.toString() || '',
    firstName: nameParts[0] || '',
    lastName: nameParts.slice(1).join(' ') || '',
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
  const sessionTemplateIDIdx = 28;
  const eventNameIdx = getColumnIndex(headers, 'event_name');
  const categoryIdx = getColumnIndex(headers, 'Category');
  const dateIdx = getColumnIndex(headers, 'date');
  const timeIdx = getColumnIndex(headers, 'time');
  const endTimeIdx = getColumnIndex(headers, 'End Time');
  const locationIdx = getColumnIndex(headers, 'location');
  const boroughIdx = 27;
  const genderTargetIdx = 29;
  const motivationsIdx = 31;
  const sessionFormatIdx = 32;
  const priceIdx = getColumnIndex(headers, 'base_price');
  const spotsRemainingIdx = getColumnIndex(headers, 'spots_remaining');
  const bookingUrlIdx = getColumnIndex(headers, 'booking_url');
  const durationIdx = getColumnIndex(headers, 'Duration Minutes');
  const activeIdx = getColumnIndex(headers, 'active');
  const imageUrlIdx = getColumnIndex(headers, 'Image URL');

  const events: Event[] = [];

  for (const row of dataRows) {
    if (!row[eventIDIdx]) continue;

    events.push({
      eventID: row[eventIDIdx]?.toString() || '',
      sessionTemplateID: row[sessionTemplateIDIdx]?.toString() || '',
      eventName: eventNameIdx !== -1 ? row[eventNameIdx]?.toString() || '' : '',
      category: categoryIdx !== -1 ? row[categoryIdx]?.toString() || '' : '',
      date: dateIdx !== -1 ? row[dateIdx]?.toString() || '' : '',
      time: timeIdx !== -1 ? row[timeIdx]?.toString() || '' : '',
      endTime: endTimeIdx !== -1 ? row[endTimeIdx]?.toString() || '' : '',
      location: locationIdx !== -1 ? row[locationIdx]?.toString() || '' : '',
      borough: row[boroughIdx]?.toString() || '',
      price: priceIdx !== -1 ? parsePrice(row[priceIdx]?.toString() || '0') : 0,
      spotsRemaining: spotsRemainingIdx !== -1 ? parseInt(row[spotsRemainingIdx]?.toString() || '0') : 0,
      bookingUrl: bookingUrlIdx !== -1 ? row[bookingUrlIdx]?.toString() || '' : '',
      durationMinutes: durationIdx !== -1 ? parseInt(row[durationIdx]?.toString() || '60') : 60,
      active: activeIdx !== -1 ? row[activeIdx]?.toString() || 'TRUE' : 'TRUE',
      imageUrl: imageUrlIdx !== -1 ? row[imageUrlIdx]?.toString() || '' : '',
      genderTarget: row[genderTargetIdx]?.toString() || '',
      motivations: row[motivationsIdx] ? parseCommaSeparated(row[motivationsIdx].toString()) : [],
      sessionFormat: row[sessionFormatIdx]?.toString() || '',
    });
  }

  return events;
}

// ==========================================
// SCORING ENGINE
// ==========================================

const LONDON_REGIONS: Record<string, string[]> = {
  East: ['Hackney', 'Tower Hamlets', 'Newham', 'Waltham Forest', 'Redbridge', 'Barking', 'Dagenham', 'Havering'],
  West: ['Hammersmith', 'Fulham', 'Ealing', 'Hounslow', 'Brent', 'Hillingdon', 'Harrow'],
  North: ['Camden', 'Islington', 'Haringey', 'Enfield', 'Barnet'],
  South: ['Lambeth', 'Southwark', 'Lewisham', 'Greenwich', 'Bromley', 'Croydon', 'Sutton', 'Merton'],
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
  const userGen = userGender.trim().toLowerCase();

  if (!sessionTarget || !userGen) return { isCompatible: true, bonusPoints: 0 };

  // Women-only sessions
  if (sessionTarget.includes('women only')) {
    if (userGen === 'female') return { isCompatible: true, bonusPoints: 30, matchReason: "women's session" };
    if (userGen === 'male') return { isCompatible: false, bonusPoints: 0 };
  }

  // Men-only sessions
  if (sessionTarget.includes('men only') || sessionTarget === 'men') {
    if (userGen === 'male') return { isCompatible: true, bonusPoints: 30, matchReason: "men's session" };
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
  const childKeywords = [
    'kids', 'children', 'child', 'youth', 'junior', 'juniors',
    'under 16', 'under 18', 'u16', 'u18', 'u14', 'u12', 'u10',
    'primary school', 'secondary school', 'school kids', 'school-age',
  ];
  return childKeywords.some(keyword => text.includes(keyword));
}

function isSportMatch(userSport: string, eventCategory: string, eventName: string): boolean {
  const userSportLower = userSport.toLowerCase().trim();
  const categoryLower = eventCategory.toLowerCase().trim();
  const nameLower = eventName.toLowerCase().trim();

  if (userSportLower === categoryLower) return true;

  if (userSportLower === 'football') {
    const footballCompounds = ['american football', 'american flag football', 'flag football', 'australian rules football', 'afl', 'gridiron'];
    if (footballCompounds.some(c => `${categoryLower} ${nameLower}`.includes(c))) return false;
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
  const eventLower = eventName.toLowerCase();
  const userLower = userLevel.toLowerCase();
  const skillLevels = ['beginner', 'intermediate', 'advanced', 'all levels', 'mixed ability'];

  for (const level of skillLevels) {
    if (eventLower.includes(level)) {
      if (level === 'all levels' || level === 'mixed ability') return { matches: true, level };
      if (userLower.includes(level) || level.includes(userLower)) return { matches: true, level };
    }
  }
  return { matches: false, level: '' };
}

function generateRecommendations(events: Event[], profile: UserProfile): RecommendationCard[] {
  const now = new Date();
  now.setHours(0, 0, 0, 0);

  let candidates = events.filter(event => {
    const eventDate = new Date(event.date);
    eventDate.setHours(0, 0, 0, 0);
    const isActive = event.active.toLowerCase() === 'true' || event.active.toLowerCase() === 'yes';
    return eventDate >= now && isActive && !isChildrenSession(event.eventName, event.category);
  });

  candidates = candidates.filter(event => {
    return checkGenderCompatibility(event.genderTarget, profile.gender).isCompatible;
  });

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

    // Penalty for no sport match
    if (!hasSportMatch && profile.preferredSports.length > 0) {
      score = Math.floor(score * 0.4);
    }

    const reason = reasons.length > 0
      ? (reasons[0].charAt(0).toUpperCase() + reasons[0].slice(1)) + (reasons.length > 1 ? ' · ' + reasons.slice(1).join(' · ') : '')
      : 'New session in your area';

    return {
      eventID: event.eventID,
      title: event.eventName,
      sport: event.category,
      date: event.date,
      time: event.time,
      venue: event.location,
      borough: eventBorough,
      price: event.price,
      difficulty: skillMatch.level || '',
      score,
      displayPercentage: calculateDisplayPercentage(score),
      reason,
      image: event.imageUrl || '',
      bookingUrl: event.bookingUrl || '',
      spotsRemaining: event.spotsRemaining,
    };
  });

  scoredEvents.sort((a, b) => b.score - a.score);

  const MIN_SCORE = 60;
  const quality = scoredEvents.filter(r => r.score >= MIN_SCORE);

  const seenTemplates = new Set<string>();
  const unique: RecommendationCard[] = [];

  for (const rec of quality) {
    const event = events.find(e => e.eventID === rec.eventID);
    const key = event?.sessionTemplateID?.trim() || rec.eventID;
    if (seenTemplates.has(key)) continue;
    seenTemplates.add(key);
    unique.push(rec);
    if (unique.length >= 10) break;
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

  const email = req.query.email as string;
  if (!email) {
    return res.status(400).json({ success: false, error: { code: 'MISSING_EMAIL', message: 'Email parameter required' } });
  }

  try {
    const [profile, events] = await Promise.all([
      fetchUserProfile(email),
      fetchEvents(),
    ]);

    if (!profile) {
      return res.status(404).json({ success: false, error: { code: 'USER_NOT_FOUND', message: 'No account found for that email address.' } });
    }

    const recommendations = generateRecommendations(events, profile);

    return res.status(200).json({
      success: true,
      data: {
        profile: {
          firstName: profile.firstName,
          lastName: profile.lastName,
          homeBorough: profile.homeBorough,
          preferredSports: profile.preferredSports,
          fitnessLevel: profile.fitnessLevel,
        },
        recommendations,
        total: recommendations.length,
      },
    });

  } catch (error) {
    console.error('[ERROR] Recommendations API error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return res.status(500).json({ success: false, error: { code: 'INTERNAL_ERROR', message } });
  }
}
