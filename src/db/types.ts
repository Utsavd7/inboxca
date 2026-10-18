
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
                },"client_assignments": {
                  Row: {
                    "client_id": string,"firm_id": string,"role": string,"team_id": string | null,"user_id": string | null
                  }
                  Insert: {
                    "client_id": string,"firm_id": string,"role": string,"team_id"?: string | null,"user_id"?: string | null
                  }
                  Update: {
                    "client_id"?: string,"firm_id"?: string,"role"?: string,"team_id"?: string | null,"user_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_assignments_firm_id_client_id_fkey"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "client_assignments_firm_id_team_id_fkey"
      columns: ["firm_id","team_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "client_assignments_firm_id_user_id_fkey"
      columns: ["firm_id","user_id"]
isOneToOne: false
      referencedRelation: "firm_members"
      referencedColumns: ["firm_id","user_id"]
    }
                  ]
                },"client_registrations": {
                  Row: {
                    "client_id": string,"firm_id": string,"id": string,"kind": string,"number_bidx": string,"number_enc": string,"services": (string)[],"state_code": string | null
                  }
                  Insert: {
                    "client_id": string,"firm_id": string,"id"?: string,"kind": string,"number_bidx": string,"number_enc": string,"services"?: (string)[],"state_code"?: string | null
                  }
                  Update: {
                    "client_id"?: string,"firm_id"?: string,"id"?: string,"kind"?: string,"number_bidx"?: string,"number_enc"?: string,"services"?: (string)[],"state_code"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "client_registrations_firm_id_client_id_fkey"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"clients": {
                  Row: {
                    "archived_at": string | null,"branch_id": string | null,"email_bidx": string | null,"email_enc": string | null,"firm_id": string,"group_id": string | null,"id": string,"kind": string,"name": string
                  }
                  Insert: {
                    "archived_at"?: string | null,"branch_id"?: string | null,"email_bidx"?: string | null,"email_enc"?: string | null,"firm_id": string,"group_id"?: string | null,"id"?: string,"kind": string,"name": string
                  }
                  Update: {
                    "archived_at"?: string | null,"branch_id"?: string | null,"email_bidx"?: string | null,"email_enc"?: string | null,"firm_id"?: string,"group_id"?: string | null,"id"?: string,"kind"?: string,"name"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "clients_firm_id_branch_id_fkey"
      columns: ["firm_id","branch_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "clients_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "clients_firm_id_group_id_fkey"
      columns: ["firm_id","group_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"compliance_types": {
                  Row: {
                    "approved_by": string | null,"code": string,"due_rule": NonNullable<Json>,"effective_from": string | null,"effective_to": string | null,"frequency": string | null,"name": string | null,"period_key": string,"source_url": string | null,"verified_on": string | null
                  }
                  Insert: {
                    "approved_by"?: string | null,"code": string,"due_rule": NonNullable<Json>,"effective_from"?: string | null,"effective_to"?: string | null,"frequency"?: string | null,"name"?: string | null,"period_key"?: string,"source_url"?: string | null,"verified_on"?: string | null
                  }
                  Update: {
                    "approved_by"?: string | null,"code"?: string,"due_rule"?: NonNullable<Json>,"effective_from"?: string | null,"effective_to"?: string | null,"frequency"?: string | null,"name"?: string | null,"period_key"?: string,"source_url"?: string | null,"verified_on"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"connected_accounts": {
                  Row: {
                    "address_enc": string,"credentials_enc": string,"firm_id": string,"id": string,"kind": string,"provider": string,"settings": NonNullable<Json>,"status": string,"sync_cursor": string | null
                  }
                  Insert: {
                    "address_enc": string,"credentials_enc": string,"firm_id": string,"id"?: string,"kind": string,"provider": string,"settings"?: NonNullable<Json>,"status"?: string,"sync_cursor"?: string | null
                  }
                  Update: {
                    "address_enc"?: string,"credentials_enc"?: string,"firm_id"?: string,"id"?: string,"kind"?: string,"provider"?: string,"settings"?: NonNullable<Json>,"status"?: string,"sync_cursor"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "connected_accounts_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"contact_clients": {
                  Row: {
                    "can_receive_documents": boolean,"can_view_status": boolean,"client_id": string,"contact_id": string,"firm_id": string,"relation": string | null
                  }
                  Insert: {
                    "can_receive_documents"?: boolean,"can_view_status"?: boolean,"client_id": string,"contact_id": string,"firm_id": string,"relation"?: string | null
                  }
                  Update: {
                    "can_receive_documents"?: boolean,"can_view_status"?: boolean,"client_id"?: string,"contact_id"?: string,"firm_id"?: string,"relation"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "contact_clients_firm_id_client_id_fkey"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "contact_clients_firm_id_contact_id_fkey"
      columns: ["firm_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"contacts": {
                  Row: {
                    "email_bidx": string,"email_enc": string,"firm_id": string,"id": string,"name_enc": string
                  }
                  Insert: {
                    "email_bidx": string,"email_enc": string,"firm_id": string,"id"?: string,"name_enc": string
                  }
                  Update: {
                    "email_bidx"?: string,"email_enc"?: string,"firm_id"?: string,"id"?: string,"name_enc"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "contacts_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "client_id": string,"document_type": string,"drive_file_id": string,"email_event_id": string | null,"firm_id": string,"id": string,"name": string,"original_name_enc": string | null,"period_key": string,"received_at": string,"search_tokens": (string)[],"sha256": string,"size": number,"status": string,"work_type": string
                  }
                  Insert: {
                    "client_id": string,"document_type": string,"drive_file_id": string,"email_event_id"?: string | null,"firm_id": string,"id"?: string,"name": string,"original_name_enc"?: string | null,"period_key"?: string,"received_at"?: string,"search_tokens"?: (string)[],"sha256": string,"size": number,"status"?: string,"work_type": string
                  }
                  Update: {
                    "client_id"?: string,"document_type"?: string,"drive_file_id"?: string,"email_event_id"?: string | null,"firm_id"?: string,"id"?: string,"name"?: string,"original_name_enc"?: string | null,"period_key"?: string,"received_at"?: string,"search_tokens"?: (string)[],"sha256"?: string,"size"?: number,"status"?: string,"work_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_email_event_id_fkey"
      columns: ["email_event_id"]
isOneToOne: false
      referencedRelation: "email_events"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "documents_firm_id_client_id_fkey"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "documents_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"email_events": {
                  Row: {
                    "account_id": string,"client_id": string | null,"contact_id": string | null,"decision_source": string | null,"firm_id": string,"id": string,"label": string | null,"provider_message_id": string,"reason_code": string | null,"received_at": string,"sender_bidx": string,"status": string,"thread_id": string | null
                  }
                  Insert: {
                    "account_id": string,"client_id"?: string | null,"contact_id"?: string | null,"decision_source"?: string | null,"firm_id": string,"id"?: string,"label"?: string | null,"provider_message_id": string,"reason_code"?: string | null,"received_at": string,"sender_bidx": string,"status"?: string,"thread_id"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"client_id"?: string | null,"contact_id"?: string | null,"decision_source"?: string | null,"firm_id"?: string,"id"?: string,"label"?: string | null,"provider_message_id"?: string,"reason_code"?: string | null,"received_at"?: string,"sender_bidx"?: string,"status"?: string,"thread_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_events_account_id_fkey"
      columns: ["account_id"]
isOneToOne: false
      referencedRelation: "connected_accounts"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "email_events_firm_id_client_id_fkey"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "email_events_firm_id_contact_id_fkey"
      columns: ["firm_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "email_events_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"firm_keys": {
                  Row: {
                    "firm_id": string,"wrapped_key": string
                  }
                  Insert: {
                    "firm_id": string,"wrapped_key": string
                  }
                  Update: {
                    "firm_id"?: string,"wrapped_key"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "firm_keys_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: true
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
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
                },"requests": {
                  Row: {
                    "client_id": string | null,"details": NonNullable<Json>,"entity_id": string,"entity_type": string,"expires_at": string | null,"firm_id": string,"id": string,"kind": string,"reason_code": string | null,"status": string
                  }
                  Insert: {
                    "client_id"?: string | null,"details"?: NonNullable<Json>,"entity_id": string,"entity_type": string,"expires_at"?: string | null,"firm_id": string,"id"?: string,"kind": string,"reason_code"?: string | null,"status"?: string
                  }
                  Update: {
                    "client_id"?: string | null,"details"?: NonNullable<Json>,"entity_id"?: string,"entity_type"?: string,"expires_at"?: string | null,"firm_id"?: string,"id"?: string,"kind"?: string,"reason_code"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "requests_firm_id_client_id_fkey"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "requests_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"shares": {
                  Row: {
                    "contact_id": string | null,"document_id": string,"downloads": number,"firm_id": string,"id": string,"link_expires_at": string,"link_token_hash": string
                  }
                  Insert: {
                    "contact_id"?: string | null,"document_id": string,"downloads"?: number,"firm_id": string,"id"?: string,"link_expires_at": string,"link_token_hash": string
                  }
                  Update: {
                    "contact_id"?: string | null,"document_id"?: string,"downloads"?: number,"firm_id"?: string,"id"?: string,"link_expires_at"?: string,"link_token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shares_document_id_fkey"
      columns: ["document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["id"]
    },{
      foreignKeyName: "shares_firm_id_contact_id_fkey"
      columns: ["firm_id","contact_id"]
isOneToOne: false
      referencedRelation: "contacts"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "shares_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"tasks": {
                  Row: {
                    "client_id": string,"code": string | null,"details": NonNullable<Json>,"due_on": string,"firm_id": string,"id": string,"kind": string,"period_key": string | null,"registration_id": string | null,"status": string
                  }
                  Insert: {
                    "client_id": string,"code"?: string | null,"details"?: NonNullable<Json>,"due_on": string,"firm_id": string,"id"?: string,"kind"?: string,"period_key"?: string | null,"registration_id"?: string | null,"status"?: string
                  }
                  Update: {
                    "client_id"?: string,"code"?: string | null,"details"?: NonNullable<Json>,"due_on"?: string,"firm_id"?: string,"id"?: string,"kind"?: string,"period_key"?: string | null,"registration_id"?: string | null,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "tasks_firm_id_client_id_fkey"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "tasks_firm_id_registration_id_fkey"
      columns: ["firm_id","registration_id"]
isOneToOne: false
      referencedRelation: "client_registrations"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                }
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "accept_invite":
{ Args: { "target_firm": string }; Returns: boolean
                           },
"access_setting":
{ Args: { "key": string,"person": Json,"role": string,"settings": Json }; Returns: Json
                           },
"add_clients":
{ Args: { "clients": Json,"target_firm": string }; Returns: number
                           },
"can_access_client":
{ Args: { "client": string,"target_firm": string }; Returns: boolean
                           },
"cancel_jobs":
{ Args: { "below_version"?: number,"p_entity_id": string,"p_entity_type": string }; Returns: number
                           },
"change_role":
{ Args: { "new_role": string,"person": string,"target_firm": string }; Returns: boolean
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
"closed_firms":
{ Args: Record<PropertyKey, never>; Returns: {
              "firm_name": string,"hours": Json,"reason": string
            }[]
                           },
"connect_drive":
{ Args: { "account": string,"address": string,"credentials": string,"drive_provider": string,"drive_settings": Json,"level": string,"target_firm": string,"terms_version": string }; Returns: boolean
                           },
"finish_job":
{ Args: { "error_code"?: string,"job_id": number,"outcome": string,"retry_at"?: string }; Returns: boolean
                           },
"firm_people":
{ Args: { "target_firm": string }; Returns: {
              "branch_id": string,"email": string,"role": string,"status": string,"team_id": string,"user_id": string
            }[]
                           },
"firm_state":
{ Args: { "f": Database["public"]['Tables']["firms"]['Row'] }; Returns: string
                           },
"invite_member":
{ Args: { "new_role": string,"person": string,"target_firm": string }; Returns: boolean
                           },
"maintain_activity_log":
{ Args: { "as_of"?: string }; Returns: undefined
                           },
"mark_job_sending":
{ Args: { "job_id": number }; Returns: boolean
                           },
"member_role":
{ Args: { "target_firm": string }; Returns: string
                           },
"month_by_return":
{ Args: { "first_day": string }; Returns: {
              "code": string,"due": number,"filed": number
            }[]
                           },
"month_load":
{ Args: { "first_day": string }; Returns: {
              "codes": (string)[],"due": number,"due_on": string,"filed": number
            }[]
                           },
"my_invites":
{ Args: Record<PropertyKey, never>; Returns: {
              "firm_id": string,"firm_name": string,"role": string
            }[]
                           },
"open_to":
{ Args: { "at"?: string,"person": Json,"role": string,"settings": Json }; Returns: boolean
                           },
"remove_document":
{ Args: { "actor": string,"new_file": string,"new_name": string,"new_status": string,"target": string }; Returns: undefined
                           },
"remove_member":
{ Args: { "person": string,"target_firm": string }; Returns: boolean
                           },
"rename_document":
{ Args: { "actor": string,"new_file": string,"new_name": string,"new_period": string,"new_status": string,"new_type": string,"new_work": string,"target": string }; Returns: undefined
                           },
"restore_member":
{ Args: { "person": string,"target_firm": string }; Returns: boolean
                           },
"two_step_at":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"use_share":
{ Args: { "token_hash": string }; Returns: {
              "document_id": string,"firm_id": string
            }[]
                           },
"user_id_for_email":
{ Args: { "address": string }; Returns: string
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

