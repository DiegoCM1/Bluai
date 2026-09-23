/**
 * Shared types for the alerts module
 */

export interface Alert {
  id: string;
  level: number;
  title: string;
  short?: string;
  // Plain-language rewrite (SMN bulletins only) — prefer this over `short`
  // when present; null/absent for every other alert source.
  ai_summary?: string | null;
  timestamp: string;
  score?: number;
  recommendations?: string[];
  factors?: string[];
}

export interface AlertsByYear {
  [year: number]: Alert[];
}

export interface SMNCycloneAdvisory {
  ocean: "atlantico" | "pacifico" | null;
  system_name: string | null;
  aviso_num: number | null;
  level: number;
  synthesis: string | null;
  location_text: string | null;
  lat: number | null;
  lon: number | null;
  movement_text: string | null;
  wind_sustained_kmh: number | null;
  wind_gusts_kmh: number | null;
  pressure_hpa: number | null;
  recommendations: string | null;
  pdf_url: string | null;
  issued_at: string;
}
