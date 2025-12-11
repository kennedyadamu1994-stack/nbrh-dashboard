// types.ts

export interface UserProfile {
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

export interface SessionTemplate {
  sessionTemplateID: string;
  title: string;
  sport: string;
  difficulty: string;
  defaultDurationMinutes: number;
  tags: string[];
  description: string;
}

export interface Event {
  eventID: string;
  sessionTemplateID: string;
  date: string; // YYYY-MM-DD
  startTime: string; // HH:MM
  endTime: string; // HH:MM
  venue: string;
  borough: string;
  price: number;
  capacity: number;
  status: 'Active' | 'Cancelled';
  tags: string[];
}

export interface Booking {
  bookingID: string;
  eventID: string;
  userEmail: string;
  bookingDateTime: string; // ISO string
  paymentStatus: string;
  attendanceStatus: 'Attended' | 'No-show' | 'Pending';
}

export interface SessionCard {
  eventID: string;
  title: string;
  sport: string;
  date: string;
  time: string;
  venue: string;
  borough: string;
  price: number;
  badge?: string; // "This week", "Next week", etc.
  difficulty: string;
  bookingID: string;
  attendanceStatus?: string;
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
  reason: string;
}

export interface UserStats {
  totalBooked: number;
  totalAttended: number;
  totalHoursPlayed: number;
  totalSpent: number;
  mostPlayedSport: string | null;
  mostCommonDay: string | null;
}

export interface DashboardResponse {
  profile: UserProfile | null;
  upcomingSessions: SessionCard[];
  pastSessions: SessionCard[];
  pastSessionsTotal: number;
  stats: UserStats;
  recommendations: RecommendationCard[];
}

export interface APIResponse<T = any> {
  success: boolean;
  data?: T;
  error?: {
    code: string;
    message: string;
  };
}
