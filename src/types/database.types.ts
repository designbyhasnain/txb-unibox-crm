export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  __InternalSupabase: {
    PostgrestVersion: "14.1"
  }
  public: {
    Tables: {
      campaign_email_accounts: {
        Row: {
          campaign_id: string
          created_at: string
          email_account_id: string
          id: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          email_account_id: string
          id?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          email_account_id?: string
          id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaign_email_accounts_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "campaign_email_accounts_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          created_at: string
          daily_limit: number | null
          end_date: string | null
          id: string
          name: string
          start_date: string | null
          status: Database["public"]["Enums"]["campaign_status"]
          timezone: string | null
          total_leads: number
          updated_at: string
          user_id: string
        }
        Insert: {
          created_at?: string
          daily_limit?: number | null
          end_date?: string | null
          id?: string
          name: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          timezone?: string | null
          total_leads?: number
          updated_at?: string
          user_id: string
        }
        Update: {
          created_at?: string
          daily_limit?: number | null
          end_date?: string | null
          id?: string
          name?: string
          start_date?: string | null
          status?: Database["public"]["Enums"]["campaign_status"]
          timezone?: string | null
          total_leads?: number
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_accounts: {
        Row: {
          created_at: string
          daily_limit: number
          display_name: string | null
          email_address: string
          id: string
          imap_host: string | null
          imap_password: string | null
          imap_port: number | null
          imap_username: string | null
          last_synced_at: string | null
          oauth_refresh_token: string | null
          provider: Database["public"]["Enums"]["email_provider"]
          sent_count_today: number
          smtp_host: string | null
          smtp_password: string | null
          smtp_port: number | null
          smtp_username: string | null
          status: Database["public"]["Enums"]["email_account_status"]
          updated_at: string
          user_id: string
          warmup_enabled: boolean
        }
        Insert: {
          created_at?: string
          daily_limit?: number
          display_name?: string | null
          email_address: string
          id?: string
          imap_host?: string | null
          imap_password?: string | null
          imap_port?: number | null
          imap_username?: string | null
          last_synced_at?: string | null
          oauth_refresh_token?: string | null
          provider?: Database["public"]["Enums"]["email_provider"]
          sent_count_today?: number
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          status?: Database["public"]["Enums"]["email_account_status"]
          updated_at?: string
          user_id: string
          warmup_enabled?: boolean
        }
        Update: {
          created_at?: string
          daily_limit?: number
          display_name?: string | null
          email_address?: string
          id?: string
          imap_host?: string | null
          imap_password?: string | null
          imap_port?: number | null
          imap_username?: string | null
          last_synced_at?: string | null
          oauth_refresh_token?: string | null
          provider?: Database["public"]["Enums"]["email_provider"]
          sent_count_today?: number
          smtp_host?: string | null
          smtp_password?: string | null
          smtp_port?: number | null
          smtp_username?: string | null
          status?: Database["public"]["Enums"]["email_account_status"]
          updated_at?: string
          user_id?: string
          warmup_enabled?: boolean
        }
        Relationships: [
          {
            foreignKeyName: "email_accounts_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      email_logs: {
        Row: {
          bounced_at: string | null
          campaign_id: string
          clicked_at: string | null
          created_at: string
          email_account_id: string | null
          error_message: string | null
          id: string
          lead_id: string
          message_id: string | null
          opened_at: string | null
          replied_at: string | null
          sent_at: string | null
          sequence_step_id: string
          status: Database["public"]["Enums"]["email_log_status"]
          subject: string | null
          user_id: string
        }
        Insert: {
          bounced_at?: string | null
          campaign_id: string
          clicked_at?: string | null
          created_at?: string
          email_account_id?: string | null
          error_message?: string | null
          id?: string
          lead_id: string
          message_id?: string | null
          opened_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          sequence_step_id: string
          status?: Database["public"]["Enums"]["email_log_status"]
          subject?: string | null
          user_id: string
        }
        Update: {
          bounced_at?: string | null
          campaign_id?: string
          clicked_at?: string | null
          created_at?: string
          email_account_id?: string | null
          error_message?: string | null
          id?: string
          lead_id?: string
          message_id?: string | null
          opened_at?: string | null
          replied_at?: string | null
          sent_at?: string | null
          sequence_step_id?: string
          status?: Database["public"]["Enums"]["email_log_status"]
          subject?: string | null
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "email_logs_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_lead_id_fkey"
            columns: ["lead_id"]
            isOneToOne: false
            referencedRelation: "leads"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_sequence_step_id_fkey"
            columns: ["sequence_step_id"]
            isOneToOne: false
            referencedRelation: "sequences"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "email_logs_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "users"
            referencedColumns: ["id"]
          },
        ]
      }
      leads: {
        Row: {
          campaign_id: string
          company: string | null
          created_at: string
          current_step: number
          custom_variables: Json | null
          email: string
          first_name: string | null
          id: string
          last_contacted_at: string | null
          last_name: string | null
          linkedin_url: string | null
          phone: string | null
          status: Database["public"]["Enums"]["lead_status"]
          title: string | null
          updated_at: string
          website: string | null
        }
        Insert: {
          campaign_id: string
          company?: string | null
          created_at?: string
          current_step?: number
          custom_variables?: Json | null
          email: string
          first_name?: string | null
          id?: string
          last_contacted_at?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          title?: string | null
          updated_at?: string
          website?: string | null
        }
        Update: {
          campaign_id?: string
          company?: string | null
          created_at?: string
          current_step?: number
          custom_variables?: Json | null
          email?: string
          first_name?: string | null
          id?: string
          last_contacted_at?: string | null
          last_name?: string | null
          linkedin_url?: string | null
          phone?: string | null
          status?: Database["public"]["Enums"]["lead_status"]
          title?: string | null
          updated_at?: string
          website?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "leads_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      sequences: {
        Row: {
          campaign_id: string
          created_at: string
          delay_days: number
          email_body: string
          id: string
          step_number: number
          subject: string
          updated_at: string
        }
        Insert: {
          campaign_id: string
          created_at?: string
          delay_days?: number
          email_body: string
          id?: string
          step_number: number
          subject: string
          updated_at?: string
        }
        Update: {
          campaign_id?: string
          created_at?: string
          delay_days?: number
          email_body?: string
          id?: string
          step_number?: number
          subject?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "sequences_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
        ]
      }
      users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          id: string
          name: string
          password: string
          timezone: string | null
          updated_at: string
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          id?: string
          name: string
          password: string
          timezone?: string | null
          updated_at?: string
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          id?: string
          name?: string
          password?: string
          timezone?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      warmup_stats: {
        Row: {
          created_at: string
          date: string
          email_account_id: string
          emails_received: number
          emails_replied: number
          emails_sent: number
          id: string
          landed_inbox: number
          landed_spam: number
          reputation_score: number | null
        }
        Insert: {
          created_at?: string
          date: string
          email_account_id: string
          emails_received?: number
          emails_replied?: number
          emails_sent?: number
          id?: string
          landed_inbox?: number
          landed_spam?: number
          reputation_score?: number | null
        }
        Update: {
          created_at?: string
          date?: string
          email_account_id?: string
          emails_received?: number
          emails_replied?: number
          emails_sent?: number
          id?: string
          landed_inbox?: number
          landed_spam?: number
          reputation_score?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "warmup_stats_email_account_id_fkey"
            columns: ["email_account_id"]
            isOneToOne: false
            referencedRelation: "email_accounts"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      campaign_status: "Draft" | "Running" | "Paused" | "Completed" | "Archived"
      email_account_status: "Active" | "Warmup" | "Paused" | "Disconnected"
      email_log_status:
        | "Queued"
        | "Sent"
        | "Delivered"
        | "Opened"
        | "Clicked"
        | "Replied"
        | "Bounced"
        | "Failed"
      email_provider: "Gmail" | "Outlook" | "SMTP"
      lead_status:
        | "Not Contacted"
        | "Contacted"
        | "Replied"
        | "Interested"
        | "Not Interested"
        | "Bounced"
        | "Unsubscribed"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
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
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      campaign_status: ["Draft", "Running", "Paused", "Completed", "Archived"],
      email_account_status: ["Active", "Warmup", "Paused", "Disconnected"],
      email_log_status: [
        "Queued",
        "Sent",
        "Delivered",
        "Opened",
        "Clicked",
        "Replied",
        "Bounced",
        "Failed",
      ],
      email_provider: ["Gmail", "Outlook", "SMTP"],
      lead_status: [
        "Not Contacted",
        "Contacted",
        "Replied",
        "Interested",
        "Not Interested",
        "Bounced",
        "Unsubscribed",
      ],
    },
  },
} as const
