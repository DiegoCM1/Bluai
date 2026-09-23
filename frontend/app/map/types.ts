export type ZoneType = 'natural' | 'vial' | 'peligro' | 'ayuda'         
                                                                 
export interface Zone {
  id: string           
  latitude: number
  longitude: number                                                     
  description: string
  timestamp: string                                                     
  radius: number   
  type: ZoneType
  upvotes?: number
  downvotes?: number
  userVote?: 1 | -1 | null
  isOwner?: boolean
  distanceKm?: number | null
  withinVotingRadius?: boolean
  canVote?: boolean
  trustStatus?: 'confirmado' | 'en_revision' | 'dudoso'
  address?: string | null
  // --- local-only, never sent by or received from the server ---
  /** True while this report is queued and has not reached the backend yet. */
  pending?: boolean
  /** Client-generated id, kept after sync so queued follow-up writes can be remapped. */
  clientId?: string
  /**
   * When the user actually made the report, on their device. The backend stamps
   * created_at at delivery, so a report queued during an outage would otherwise display
   * as brand new hours later. Used for display only while `pending` is true.
   */
  reportedAt?: string
}     
