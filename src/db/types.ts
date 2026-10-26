
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "public": {
          Tables: {
            "activity_log": {
                  Row: {
                    "action": string,"actor_id": string | null,"at": string,"details": NonNullable<Json>,"entity_id": string | null,"entity_type": string | null,"firm_id": string | null
                  }
                  Insert: {
                    "action": string,"actor_id"?: string | null,"at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string | null,"firm_id"?: string | null
                  }
                  Update: {
                    "action"?: string,"actor_id"?: string | null,"at"?: string,"details"?: NonNullable<Json>,"entity_id"?: string | null,"entity_type"?: string | null,"firm_id"?: string | null
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
                },"admin_passkeys": {
                  Row: {
                    "counter": number,"id": string,"public_key": string,"user_id": string
                  }
                  Insert: {
                    "counter"?: number,"id": string,"public_key": string,"user_id": string
                  }
                  Update: {
                    "counter"?: number,"id"?: string,"public_key"?: string,"user_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "admin_passkeys_user_id_fkey"
      columns: ["user_id"]
isOneToOne: false
      referencedRelation: "orelu_admins"
      referencedColumns: ["user_id"]
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
                    "archived_at": string | null,"branch_id": string | null,"email_bidx": string | null,"email_enc": string | null,"firm_id": string,"group_id": string | null,"id": string,"kind": string,"name": string,"purchase_mapping_enc": string | null,"reminders_paused": boolean,"sales_mapping_enc": string | null
                  }
                  Insert: {
                    "archived_at"?: string | null,"branch_id"?: string | null,"email_bidx"?: string | null,"email_enc"?: string | null,"firm_id": string,"group_id"?: string | null,"id"?: string,"kind": string,"name": string,"purchase_mapping_enc"?: string | null,"reminders_paused"?: boolean,"sales_mapping_enc"?: string | null
                  }
                  Update: {
                    "archived_at"?: string | null,"branch_id"?: string | null,"email_bidx"?: string | null,"email_enc"?: string | null,"firm_id"?: string,"group_id"?: string | null,"id"?: string,"kind"?: string,"name"?: string,"purchase_mapping_enc"?: string | null,"reminders_paused"?: boolean,"sales_mapping_enc"?: string | null
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
                    "approved_by": string | null,"client_kinds": (string)[] | null,"code": string,"due_rule": NonNullable<Json>,"effective_from": string | null,"effective_to": string | null,"frequency": string | null,"name": string | null,"period_key": string,"source_url": string | null,"verified_on": string | null
                  }
                  Insert: {
                    "approved_by"?: string | null,"client_kinds"?: (string)[] | null,"code": string,"due_rule": NonNullable<Json>,"effective_from"?: string | null,"effective_to"?: string | null,"frequency"?: string | null,"name"?: string | null,"period_key"?: string,"source_url"?: string | null,"verified_on"?: string | null
                  }
                  Update: {
                    "approved_by"?: string | null,"client_kinds"?: (string)[] | null,"code"?: string,"due_rule"?: NonNullable<Json>,"effective_from"?: string | null,"effective_to"?: string | null,"frequency"?: string | null,"name"?: string | null,"period_key"?: string,"source_url"?: string | null,"verified_on"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"connected_accounts": {
                  Row: {
                    "address_bidx": string | null,"address_enc": string,"credentials_enc": string,"firm_id": string,"id": string,"kind": string,"provider": string,"settings": NonNullable<Json>,"status": string,"sync_cursor": string | null
                  }
                  Insert: {
                    "address_bidx"?: string | null,"address_enc": string,"credentials_enc": string,"firm_id": string,"id"?: string,"kind": string,"provider": string,"settings"?: NonNullable<Json>,"status"?: string,"sync_cursor"?: string | null
                  }
                  Update: {
                    "address_bidx"?: string | null,"address_enc"?: string,"credentials_enc"?: string,"firm_id"?: string,"id"?: string,"kind"?: string,"provider"?: string,"settings"?: NonNullable<Json>,"status"?: string,"sync_cursor"?: string | null
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
                },"datasets": {
                  Row: {
                    "client_id": string,"data": NonNullable<Json>,"firm_id": string,"form_code": string,"id": string,"period_key": string,"revision": number
                  }
                  Insert: {
                    "client_id": string,"data": NonNullable<Json>,"firm_id": string,"form_code": string,"id": string,"period_key": string,"revision"?: number
                  }
                  Update: {
                    "client_id"?: string,"data"?: NonNullable<Json>,"firm_id"?: string,"form_code"?: string,"id"?: string,"period_key"?: string,"revision"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "datasets_firm_id_client_id_fkey"
      columns: ["firm_id","client_id"]
isOneToOne: false
      referencedRelation: "clients"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"devices": {
                  Row: {
                    "branch_id": string | null,"ends_on": string | null,"firm_id": string,"id": string,"key_id": string | null,"key_public": string | null,"kind": string | null,"name": string,"person_id": string | null,"status": string,"token_hash": string
                  }
                  Insert: {
                    "branch_id"?: string | null,"ends_on"?: string | null,"firm_id": string,"id"?: string,"key_id"?: string | null,"key_public"?: string | null,"kind"?: string | null,"name": string,"person_id"?: string | null,"status"?: string,"token_hash": string
                  }
                  Update: {
                    "branch_id"?: string | null,"ends_on"?: string | null,"firm_id"?: string,"id"?: string,"key_id"?: string | null,"key_public"?: string | null,"kind"?: string | null,"name"?: string,"person_id"?: string | null,"status"?: string,"token_hash"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "devices_firm_id_branch_id_fkey"
      columns: ["firm_id","branch_id"]
isOneToOne: false
      referencedRelation: "groups"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "devices_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                },"documents": {
                  Row: {
                    "client_id": string,"document_type": string,"drive_file_id": string,"email_event_id": string | null,"firm_id": string,"id": string,"name": string,"original_name_enc": string | null,"password_enc": string | null,"period_key": string,"prepared": Json | null,"received_at": string,"registration_id": string | null,"scanned_at": string | null,"search_tokens": (string)[],"sha256": string,"share_policy": string | null,"size": number,"status": string,"work_type": string
                  }
                  Insert: {
                    "client_id": string,"document_type": string,"drive_file_id": string,"email_event_id"?: string | null,"firm_id": string,"id"?: string,"name": string,"original_name_enc"?: string | null,"password_enc"?: string | null,"period_key"?: string,"prepared"?: Json | null,"received_at"?: string,"registration_id"?: string | null,"scanned_at"?: string | null,"search_tokens"?: (string)[],"sha256": string,"share_policy"?: string | null,"size": number,"status"?: string,"work_type": string
                  }
                  Update: {
                    "client_id"?: string,"document_type"?: string,"drive_file_id"?: string,"email_event_id"?: string | null,"firm_id"?: string,"id"?: string,"name"?: string,"original_name_enc"?: string | null,"password_enc"?: string | null,"period_key"?: string,"prepared"?: Json | null,"received_at"?: string,"registration_id"?: string | null,"scanned_at"?: string | null,"search_tokens"?: (string)[],"sha256"?: string,"share_policy"?: string | null,"size"?: number,"status"?: string,"work_type"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "documents_email_event_fkey"
      columns: ["firm_id","email_event_id"]
isOneToOne: false
      referencedRelation: "email_events"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "documents_email_event_fkey"
      columns: ["firm_id","email_event_id"]
isOneToOne: false
      referencedRelation: "email_outcomes"
      referencedColumns: ["firm_id","id"]
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
    },{
      foreignKeyName: "documents_registration_fkey"
      columns: ["firm_id","registration_id"]
isOneToOne: false
      referencedRelation: "client_registrations"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"email_events": {
                  Row: {
                    "account_id": string,"client_id": string | null,"contact_id": string | null,"decision_source": string | null,"delivery": NonNullable<Json>,"firm_id": string,"id": string,"label": string | null,"provider_message_id": string,"reason_code": string | null,"received_at": string,"sender_bidx": string,"status": string,"thread_id": string | null
                  }
                  Insert: {
                    "account_id": string,"client_id"?: string | null,"contact_id"?: string | null,"decision_source"?: string | null,"delivery"?: NonNullable<Json>,"firm_id": string,"id"?: string,"label"?: string | null,"provider_message_id": string,"reason_code"?: string | null,"received_at": string,"sender_bidx": string,"status"?: string,"thread_id"?: string | null
                  }
                  Update: {
                    "account_id"?: string,"client_id"?: string | null,"contact_id"?: string | null,"decision_source"?: string | null,"delivery"?: NonNullable<Json>,"firm_id"?: string,"id"?: string,"label"?: string | null,"provider_message_id"?: string,"reason_code"?: string | null,"received_at"?: string,"sender_bidx"?: string,"status"?: string,"thread_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "email_events_account_fkey"
      columns: ["firm_id","account_id"]
isOneToOne: false
      referencedRelation: "connected_accounts"
      referencedColumns: ["firm_id","id"]
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
                    "access": Json | null,"branch_id": string | null,"dismissed": (string)[],"firm_id": string,"role": string,"status": string,"team_id": string | null,"user_id": string
                  }
                  Insert: {
                    "access"?: Json | null,"branch_id"?: string | null,"dismissed"?: (string)[],"firm_id": string,"role": string,"status"?: string,"team_id"?: string | null,"user_id": string
                  }
                  Update: {
                    "access"?: Json | null,"branch_id"?: string | null,"dismissed"?: (string)[],"firm_id"?: string,"role"?: string,"status"?: string,"team_id"?: string | null,"user_id"?: string
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
                },"gst_matches": {
                  Row: {
                    "counts": NonNullable<Json>,"firm_id": string,"register_id": string,"result_enc": string,"statement_id": string
                  }
                  Insert: {
                    "counts": NonNullable<Json>,"firm_id": string,"register_id": string,"result_enc": string,"statement_id": string
                  }
                  Update: {
                    "counts"?: NonNullable<Json>,"firm_id"?: string,"register_id"?: string,"result_enc"?: string,"statement_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "gst_matches_register_fkey"
      columns: ["firm_id","register_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "gst_matches_statement_fkey"
      columns: ["firm_id","statement_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["firm_id","id"]
    }
                  ]
                },"incidents": {
                  Row: {
                    "ended_at": string | null,"id": string,"level": string,"parts": (string)[],"started_at": string,"title": string,"updates": NonNullable<Json>
                  }
                  Insert: {
                    "ended_at"?: string | null,"id"?: string,"level": string,"parts": (string)[],"started_at"?: string,"title": string,"updates"?: NonNullable<Json>
                  }
                  Update: {
                    "ended_at"?: string | null,"id"?: string,"level"?: string,"parts"?: (string)[],"started_at"?: string,"title"?: string,"updates"?: NonNullable<Json>
                  }
                  Relationships: [
                    
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
                },"official_files": {
                  Row: {
                    "bytes": string,"sha256": string
                  }
                  Insert: {
                    "bytes": string,"sha256": string
                  }
                  Update: {
                    "bytes"?: string,"sha256"?: string
                  }
                  Relationships: [
                    
                  ]
                },"orelu_admins": {
                  Row: {
                    "user_id": string
                  }
                  Insert: {
                    "user_id": string
                  }
                  Update: {
                    "user_id"?: string
                  }
                  Relationships: [
                    
                  ]
                },"platform_settings": {
                  Row: {
                    "key": string,"value": NonNullable<Json>
                  }
                  Insert: {
                    "key": string,"value"?: NonNullable<Json>
                  }
                  Update: {
                    "key"?: string,"value"?: NonNullable<Json>
                  }
                  Relationships: [
                    
                  ]
                },"push_subscriptions": {
                  Row: {
                    "endpoint": string,"id": string,"keys": NonNullable<Json>,"user_id": string
                  }
                  Insert: {
                    "endpoint": string,"id"?: string,"keys": NonNullable<Json>,"user_id": string
                  }
                  Update: {
                    "endpoint"?: string,"id"?: string,"keys"?: NonNullable<Json>,"user_id"?: string
                  }
                  Relationships: [
                    
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
                    "code_attempts": number,"code_expires_at": string | null,"code_hash": string | null,"contact_id": string | null,"delivery": Json | null,"document_id": string,"downloads": number,"email_event_id": string | null,"firm_id": string,"id": string,"link_expires_at": string | null,"link_token_hash": string | null,"needs_code": boolean,"status": string
                  }
                  Insert: {
                    "code_attempts"?: number,"code_expires_at"?: string | null,"code_hash"?: string | null,"contact_id"?: string | null,"delivery"?: Json | null,"document_id": string,"downloads"?: number,"email_event_id"?: string | null,"firm_id": string,"id"?: string,"link_expires_at"?: string | null,"link_token_hash"?: string | null,"needs_code"?: boolean,"status"?: string
                  }
                  Update: {
                    "code_attempts"?: number,"code_expires_at"?: string | null,"code_hash"?: string | null,"contact_id"?: string | null,"delivery"?: Json | null,"document_id"?: string,"downloads"?: number,"email_event_id"?: string | null,"firm_id"?: string,"id"?: string,"link_expires_at"?: string | null,"link_token_hash"?: string | null,"needs_code"?: boolean,"status"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "shares_document_fkey"
      columns: ["firm_id","document_id"]
isOneToOne: false
      referencedRelation: "documents"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "shares_email_event_fkey"
      columns: ["firm_id","email_event_id"]
isOneToOne: false
      referencedRelation: "email_events"
      referencedColumns: ["firm_id","id"]
    },{
      foreignKeyName: "shares_email_event_fkey"
      columns: ["firm_id","email_event_id"]
isOneToOne: false
      referencedRelation: "email_outcomes"
      referencedColumns: ["firm_id","id"]
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
                },"templates": {
                  Row: {
                    "form_code": string,"mappings": NonNullable<Json>,"source": NonNullable<Json>,"status": string,"valid_from": string | null,"valid_until": string | null,"version": string
                  }
                  Insert: {
                    "form_code": string,"mappings": NonNullable<Json>,"source": NonNullable<Json>,"status"?: string,"valid_from"?: string | null,"valid_until"?: string | null,"version": string
                  }
                  Update: {
                    "form_code"?: string,"mappings"?: NonNullable<Json>,"source"?: NonNullable<Json>,"status"?: string,"valid_from"?: string | null,"valid_until"?: string | null,"version"?: string
                  }
                  Relationships: [
                    
                  ]
                },"usage_ledger": {
                  Row: {
                    "bytes": number | null,"code": string | null,"due_on": string,"firm_id": string,"period_key": string | null,"ref": string | null,"registration_id": string | null
                  }
                  Insert: {
                    "bytes"?: number | null,"code"?: string | null,"due_on": string,"firm_id": string,"period_key"?: string | null,"ref"?: string | null,"registration_id"?: string | null
                  }
                  Update: {
                    "bytes"?: number | null,"code"?: string | null,"due_on"?: string,"firm_id"?: string,"period_key"?: string | null,"ref"?: string | null,"registration_id"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "usage_ledger_firm_id_fkey"
      columns: ["firm_id"]
isOneToOne: false
      referencedRelation: "firms"
      referencedColumns: ["id"]
    }
                  ]
                }
          }
          Views: {
            "email_outcomes": {
                  Row: {
                    "client_id": string | null,"contact_id": string | null,"decision_source": string | null,"firm_id": string | null,"id": string | null,"label": string | null,"outcomes": (string)[] | null,"provider_message_id": string | null,"received_at": string | null
                  }
                  Relationships: [
                    {
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
                }
          }
          Functions: {
            "accept_invite":
{ Args: { "target_firm": string }; Returns: boolean
                           },
"access_check":
{ Args: { "connection": Json,"country": string,"person": string,"target_firm": string,"token_digest": string }; Returns: (string)[]
                           },
"access_setting":
{ Args: { "key": string,"person": Json,"role": string,"settings": Json }; Returns: Json
                           },
"activity_feed":
{ Args: { "mine"?: boolean,"since": string,"target_firm": string }; Returns: {
              "action": string,"at": string,"client_id": string,"client_name": string
            }[]
                           },
"add_clients":
{ Args: { "clients": Json,"target_firm": string }; Returns: number
                           },
"add_edited_form":
{ Args: { "draft": string,"person": string,"prefix": string,"registration": string,"target": string,"template": string }; Returns: Json
                           },
"admin_accounts":
{ Args: Record<PropertyKey, never>; Returns: {
              "failures": number,"firm": string,"kind": string,"last_error": string,"last_run": string,"provider": string,"status": string
            }[]
                           },
"admin_add_extension":
{ Args: { "link": string,"new_date": string,"rule_code": string,"rule_period": string }; Returns: boolean
                           },
"admin_add_template":
{ Args: { "change_at": string,"change_source": string,"file": string,"starts": string }; Returns: boolean
                           },
"admin_ask_support":
{ Args: { "target": string }; Returns: boolean
                           },
"admin_email_incident":
{ Args: { "incident": string }; Returns: number
                           },
"admin_end_template":
{ Args: { "form": string,"link": string,"until": string,"ver": string }; Returns: boolean
                           },
"admin_failed_jobs":
{ Args: Record<PropertyKey, never>; Returns: {
              "at": string,"attempts": number,"error": string,"firm": string,"id": number,"kind": string
            }[]
                           },
"admin_firm":
{ Args: { "target": string }; Returns: Json
                           },
"admin_firms":
{ Args: Record<PropertyKey, never>; Returns: {
              "created_at": string,"drive": boolean,"id": string,"last_active": string,"mailbox": boolean,"members": number,"name": string,"status": string
            }[]
                           },
"admin_incidents":
{ Args: Record<PropertyKey, never>; Returns: {
              "emailed": number,"ended_at": string,"id": string,"level": string,"parts": (string)[],"started_at": string,"title": string,"updates": Json
            }[]
                           },
"admin_note_update":
{ Args: { "item": string,"keeps"?: string,"uses"?: string }; Returns: boolean
                           },
"admin_office":
{ Args: { "days": number }; Returns: {
              "changes": number,"declined": boolean,"firm": string,"fixed": boolean,"provider": string,"taps": number
            }[]
                           },
"admin_people":
{ Args: Record<PropertyKey, never>; Returns: {
              "email": string,"passkeys": number,"user_id": string
            }[]
                           },
"admin_post_incident":
{ Args: { "incident_level": string,"incident_parts": (string)[],"incident_title": string }; Returns: string
                           },
"admin_reach":
{ Args: { "codes": (string)[],"moved_to"?: string,"period"?: string }; Returns: {
              "firm": string,"returns": number
            }[]
                           },
"admin_remove_passkeys":
{ Args: { "person": string }; Returns: number
                           },
"admin_retry_job":
{ Args: { "job_id": number }; Returns: boolean
                           },
"admin_review_change":
{ Args: { "change_at": string,"change_source": string }; Returns: boolean
                           },
"admin_set_office":
{ Args: { "days": number,"taps": number }; Returns: boolean
                           },
"admin_support_view":
{ Args: { "target": string }; Returns: Json
                           },
"admin_update_incident":
{ Args: { "finish": boolean,"incident": string,"note": string }; Returns: boolean
                           },
"admin_verify_rule":
{ Args: { "checked_by": string,"link": string,"rule_code": string,"rule_period": string }; Returns: boolean
                           },
"admin_watch":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"answer_support":
{ Args: { "decision": string,"target": string }; Returns: boolean
                           },
"append_automatic_dataset":
{ Args: { "body": Json,"client": string,"draft": string,"expected": number,"firm": string,"form": string,"period": string }; Returns: boolean
                           },
"assigned_clients":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"branch_hours":
{ Args: { "actor": string,"branch": string,"changes": Json,"target_firm": string }; Returns: undefined
                           },
"calendar_days":
{ Args: { "first_day": string,"last_day": string,"only_code"?: string,"target_firm": string }; Returns: {
              "due_on": string,"filed": number,"returns": number,"working": number
            }[]
                           },
"calendar_top_up":
{ Args: { "target_firm": string,"today"?: string }; Returns: undefined
                           },
"can_access_client":
{ Args: { "client": string,"target_firm": string }; Returns: boolean
                           },
"can_review_office":
{ Args: { "target_firm": string }; Returns: boolean
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
"claim_notice_alert":
{ Args: { "stage": string,"task_id": string }; Returns: Json
                           },
"claim_return_alert":
{ Args: { "task_id": string }; Returns: (string)[]
                           },
"client_activity":
{ Args: { "target_client": string }; Returns: {
              "action": string,"actor_id": string,"at": string,"document_id": string,"renamed_from": string,"renamed_to": string
            }[]
                           },
"clients_with_right":
{ Args: { "action": string }; Returns: string[]
                           },
"close_firm":
{ Args: { "target_firm": string,"typed_name": string }; Returns: boolean
                           },
"closed_firms":
{ Args: Record<PropertyKey, never>; Returns: {
              "away": boolean,"firm_name": string,"hours": Json,"reason": string
            }[]
                           },
"connect_drive":
{ Args: { "account": string,"address": string,"credentials": string,"drive_provider": string,"drive_settings": Json,"level": string,"target_firm": string,"terms_version": string }; Returns: boolean
                           },
"create_automatic_dataset":
{ Args: { "body": Json,"client": string,"draft": string,"firm": string,"form": string,"period": string }; Returns: boolean
                           },
"decide_form":
{ Args: { "decision": string,"person": string,"reason": Json,"target": string }; Returns: boolean
                           },
"delete_firm":
{ Args: { "target_firm": string }; Returns: boolean
                           },
"dismiss_gov_update":
{ Args: { "item": string,"target_firm": string }; Returns: boolean
                           },
"drive_year_bytes":
{ Args: { "target_firm": string }; Returns: number
                           },
"due_fills":
{ Args: { "target_firm": string }; Returns: {
              "client": string,"client_name": string,"code": string,"due_on": string,"filling": boolean,"missing": string,"open": number,"period_key": string,"ready": boolean,"stage": string,"task": string,"wrong": number
            }[]
                           },
"due_soon":
{ Args: { "target_firm": string }; Returns: {
              "clients": number,"code": string,"due_on": string,"filed": number
            }[]
                           },
"end_other_sessions":
{ Args: Record<PropertyKey, never>; Returns: number
                           },
"file_prepared_form":
{ Args: { "acknowledgement": string,"paper"?: string,"person": string,"target": string }; Returns: boolean
                           },
"fill_form":
{ Args: { "client": string,"extension": string,"firm": string,"form": string,"period": string,"person": string,"prefix": string,"registration": string,"sources": Json,"template": string }; Returns: Json
                           },
"finish_answer":
{ Args: { "actor"?: string,"event_id": string,"template": string }; Returns: undefined
                           },
"finish_form":
{ Args: { "bytes": number,"checksum": string,"file": string,"firm": string,"permission"?: string,"person": string,"target": string }; Returns: boolean
                           },
"finish_job":
{ Args: { "error_code"?: string,"job_id": number,"outcome": string,"retry_at"?: string }; Returns: boolean
                           },
"finish_share":
{ Args: { "actor"?: string,"share_id": string }; Returns: undefined
                           },
"firm_export":
{ Args: { "target_firm": string }; Returns: Json
                           },
"firm_people":
{ Args: { "target_firm": string }; Returns: {
              "branch_id": string,"email": string,"role": string,"status": string,"team_id": string,"user_id": string
            }[]
                           },
"firm_state":
{ Args: { "f": Database["public"]['Tables']["firms"]['Row'] }; Returns: string
                           },
"firm_usage":
{ Args: { "target_firm": string,"today"?: string }; Returns: {
              "returns_so_far": number,"returns_this_year": number,"workspace_by_march": number,"workspace_bytes": number
            }[]
                           },
"form_ready":
{ Args: { "target": string }; Returns: boolean
                           },
"gov_updates":
{ Args: { "target_firm": string }; Returns: Json
                           },
"gst_match_items":
{ Args: { "target_firm": string }; Returns: {
              "client_id": string,"client_name": string,"counts": Json,"due_on": string,"period_key": string,"register_id": string
            }[]
                           },
"invite_member":
{ Args: { "new_role": string,"person": string,"target_firm": string }; Returns: boolean
                           },
"is_orelu_admin":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"late_clients":
{ Args: { "mine"?: boolean,"target_firm": string }; Returns: {
              "client_id": string,"client_name": string,"code": string,"due_on": string,"period_key": string,"returns": number
            }[]
                           },
"late_returns":
{ Args: { "target_firm": string }; Returns: {
              "client_name": string,"due_on": string,"id": string
            }[]
                           },
"looked_after":
{ Args: { "clients": (string)[],"target_firm": string }; Returns: string[]
                           },
"looks_after":
{ Args: { "client": string,"target_firm": string }; Returns: boolean
                           },
"mail_health":
{ Args: { "account_id": string,"expected": string,"failed": boolean,"phase": string }; Returns: number
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
"my_clients":
{ Args: { "target_firm": string }; Returns: string[]
                           },
"my_firms":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"my_invites":
{ Args: Record<PropertyKey, never>; Returns: {
              "firm_id": string,"firm_name": string,"role": string
            }[]
                           },
"notice_alerts":
{ Args: { "target_firm": string }; Returns: {
              "action_date": string,"client_id": string,"client_name": string,"due_on": string,"id": string
            }[]
                           },
"observe_office":
{ Args: { "connection": Json,"pc": string,"person": string,"proven"?: boolean,"target_firm": string }; Returns: boolean
                           },
"office_allows":
{ Args: { "member_role": string,"settings": Json }; Returns: boolean
                           },
"office_closes":
{ Args: { "at"?: string,"settings": Json }; Returns: string
                           },
"office_control":
{ Args: { "actor": string,"branch"?: string,"co_admin"?: string,"connection"?: Json,"decision": string,"deputies"?: (string)[],"request_id"?: string,"target_firm": string }; Returns: undefined
                           },
"office_housekeeping":
{ Args: { "at"?: string,"target_firm": string }; Returns: undefined
                           },
"office_proof_key":
{ Args: Record<PropertyKey, never>; Returns: string
                           },
"office_refused":
{ Args: { "person": string,"reason": string,"target_firm": string }; Returns: undefined
                           },
"open_firms":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"open_to":
{ Args: { "at"?: string,"person": Json,"role": string,"settings": Json }; Returns: boolean
                           },
"paper_items":
{ Args: { "target_firm": string }; Returns: {
              "client_id": string,"client_name": string,"details": Json,"id": string,"kind": string
            }[]
                           },
"queue_fills":
{ Args: { "batch": string,"target_firm": string }; Returns: {
              "clients": number,"first_job": number,"queued": number
            }[]
                           },
"rate_limit":
{ Args: { "bucket": string,"most": number,"seconds": number }; Returns: boolean
                           },
"register_device":
{ Args: { "actor": string,"away"?: boolean,"label": string,"target_firm": string,"token_digest": string }; Returns: {
              "id": string,"status": string
            }[]
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
"requeue_drive_jobs":
{ Args: { "target_firm": string }; Returns: number
                           },
"reserve_form":
{ Args: { "choice"?: Json,"client": string,"extension": string,"firm": string,"form": string,"period": string,"person": string,"prefix": string,"registration": string,"sources": Json,"template": string }; Returns: Json
                           },
"reserve_mail_send":
{ Args: { "account_id": string }; Returns: Json
                           },
"restore_member":
{ Args: { "person": string,"target_firm": string }; Returns: boolean
                           },
"return_drafts":
{ Args: { "task_id": string }; Returns: {
              "document": string,"form_code": string,"id": string,"open": number,"revision": number,"target": string,"wrong": number
            }[]
                           },
"return_pins":
{ Args: { "target_firm": string }; Returns: {
              "client": string,"client_name": string,"code": string,"due_on": string,"form": string,"kind": string,"missing": string,"open": number,"period_key": string,"stage": string,"task": string
            }[]
                           },
"return_stages":
{ Args: { "target_firm": string,"task_ids": (string)[] }; Returns: {
              "form": string,"missing": string,"open": number,"stage": string,"task": string
            }[]
                           },
"review_devices":
{ Args: { "actor": string,"branch"?: string,"decision": string,"target_device": string,"target_firm": string,"until_day"?: string }; Returns: undefined
                           },
"review_firms":
{ Args: Record<PropertyKey, never>; Returns: string[]
                           },
"save_dataset":
{ Args: { "audit": Json,"body": Json,"client": string,"draft": string,"event": string,"expected": number,"firm": string,"form": string,"period": string,"permission"?: string,"person": string }; Returns: boolean
                           },
"save_figure_edit":
{ Args: { "base": string,"client": string,"draft": string,"firm": string,"line": string,"person": string,"value_enc": string }; Returns: boolean
                           },
"service_status":
{ Args: Record<PropertyKey, never>; Returns: Json
                           },
"session_ended":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"session_live":
{ Args: Record<PropertyKey, never>; Returns: boolean
                           },
"sign_up_firm":
{ Args: { "accepted": Json,"firm_name": string,"owner": string,"state": string }; Returns: string
                           },
"stop_fills":
{ Args: { "batch": string,"first_job": number,"target_firm": string }; Returns: number
                           },
"take_form_download":
{ Args: { "person": string,"ticket": string,"token_hash": string }; Returns: string
                           },
"team_load":
{ Args: { "target_firm": string,"until": string }; Returns: {
              "returns": number,"user_id": string
            }[]
                           },
"team_replies":
{ Args: { "target_firm": string }; Returns: {
              "assignee": string,"client_id": string,"client_name": string,"days": number,"email_id": string,"id": string,"late": boolean,"reason_code": string,"received_at": string
            }[]
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
                           },
"work_numbers":
{ Args: { "mine"?: boolean,"since": string,"target_firm": string,"until": string }; Returns: {
              "due": number,"filed": number,"waiting": number
            }[]
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

