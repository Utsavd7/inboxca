
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"at": string,"details": NonNullable<Json>,"entity_id": string | null,"entity_type": string | null,"firm_id": string
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string | null,"firm_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string | null,"firm_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "activity_log_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"activity_log_default": {
                  Row: {
                    "action": string,"actor_id": string | null,"at": string,"details": NonNullable<Json>,"entity_id": string | null,"entity_type": string | null,"firm_id": string
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string | null,"firm_id": string
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string | null,"firm_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"firm_members": {
                  Row: {
                    "access": Json | null,"branch_id": string | null,"firm_id": string,"role": string,"status": string,"team_id": string | null,"user_id": string
                  }
                  Insert: {
                    "access"?: Json | null,"branch_id"?: string | null,"firm_id": string,"role": string,"status"?: string,"team_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "access"?: Json | null,"branch_id"?: string | null,"firm_id"?: string,"role"?: string,"status"?: string,"team_id"?: string | null,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "firm_members_firm_id_branch_id_fkey"
      columns: ["firm_id","branch_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "firm_members_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "firm_members_firm_id_team_id_fkey"
      columns: ["firm_id","team_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"firms": {
                  Row: {
                    "created_at": string,"gstin": string | null,"id": string,"name": string,"settings": NonNullable<Json>,"state_code": string | null,"status": string,"firm_state": string | null
                  }
                  Insert: {
                    "created_at"?: string,"gstin"?: string | null,"id"?: string,"name": string,"settings"?: NonNullable<Json>,"state_code"?: string | null,"status"?: string
                  }
                  Update: {
                    "created_at"?: string,"gstin"?: string | null,"id"?: string,"name"?: string,"settings"?: NonNullable<Json>,"state_code"?: string | null,"status"?: string
                  }
                  Relationships: [
                    
                  ]
                },"groups": {
                  Row: {
                    "firm_id": string,"id": string,"kind": string,"name": string,"settings": NonNullable<Json>
                  }
                  Insert: {
                    "firm_id": string,"id"?: string,"kind": string,"name": string,"settings"?: NonNullable<Json>
                  }
                  Update: {
                    "firm_id"?: string,"id"?: string,"kind"?: string,"name"?: string,"settings"?: NonNullable<Json>
                  }
                  Relationships: [
                    {
      foreignKeyName: "groups_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"jobs": {
                  Row: {
                    "attempts": number,"claimed_until": string | null,"entity_id": string | null,"entity_type": string | null,"firm_id": string | null,"id": number,"idempotency_key": string,"kind": string,"last_error_code": string | null,"run_at": string,"schedule_version": number,"state": string
                  }
                  Insert: {
                    "attempts"?: number,"claimed_until"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"firm_id"?: string | null,"id"?: never,"idempotency_key": string,"kind": string,"last_error_code"?: string | null,"run_at"?: string,"schedule_version"?: number,"state"?: string
                  }
                  Update: {
                    "attempts"?: number,"claimed_until"?: string | null,"entity_id"?: string | null,"entity_type"?: string | null,"firm_id"?: string | null,"id"?: never,"idempotency_key"?: string,"kind"?: string,"last_error_code"?: string | null,"run_at"?: string,"schedule_version"?: number,"state"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "jobs_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "cancel_jobs":
{ Args: { "below_version"?: number,"p_entity_id": string,"p_entity_type": string }; Returns: number
                           },
"claim_jobs":
{ Args: { "batch"?: number,"lease_seconds"?: number }; Returns: {
              "attempts": number,
"claimed_until": string | null,
"entity_id": string | null,
"entity_type": string | null,
"firm_id": string | null,
"id": number,
"idempotency_key": string,
"kind": string,
"last_error_code": string | null,
"run_at": string,
"schedule_version": number,
"state": string
            }[]
                          SetofOptions: {
        from: "*"
        to: "jobs"
        isOneToOne: false
        isSetofReturn: true
      } },
"finish_job":
{ Args: { "error_code"?: string,"job_id": number,"outcome": string,"retry_at"?: string }; Returns: boolean
                           },
"firm_state":
{ Args: { "f": Database["public"]['Tables']["firms"]['Row'] }; Returns: string
                           },
"mark_job_sending":
{ Args: { "job_id": number }; Returns: boolean
                           },
"member_role":
{ Args: { "target_firm": string }; Returns: string
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "public": {
          Enums: {
            
          }
        }
} as const

