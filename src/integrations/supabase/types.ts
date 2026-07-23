export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      ad_sets: {
        Row: {
          account_id: string | null
          bid_strategy: string | null
          campaign_id: string | null
          clicks: number | null
          company_id: string | null
          created_at: string
          daily_budget: number | null
          external_id: string
          form_leads: number | null
          id: string
          impressions: number | null
          landing_page_views: number | null
          last_synced_at: string | null
          leads: number | null
          lifetime_budget: number | null
          link_clicks: number | null
          messaging_started: number | null
          name: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          reach: number | null
          revenue: number | null
          sales: number | null
          spend: number | null
          status: string | null
          targeting: Json | null
        }
        Insert: {
          account_id?: string | null
          bid_strategy?: string | null
          campaign_id?: string | null
          clicks?: number | null
          company_id?: string | null
          created_at?: string
          daily_budget?: number | null
          external_id: string
          form_leads?: number | null
          id?: string
          impressions?: number | null
          landing_page_views?: number | null
          last_synced_at?: string | null
          leads?: number | null
          lifetime_budget?: number | null
          link_clicks?: number | null
          messaging_started?: number | null
          name?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          reach?: number | null
          revenue?: number | null
          sales?: number | null
          spend?: number | null
          status?: string | null
          targeting?: Json | null
        }
        Update: {
          account_id?: string | null
          bid_strategy?: string | null
          campaign_id?: string | null
          clicks?: number | null
          company_id?: string | null
          created_at?: string
          daily_budget?: number | null
          external_id?: string
          form_leads?: number | null
          id?: string
          impressions?: number | null
          landing_page_views?: number | null
          last_synced_at?: string | null
          leads?: number | null
          lifetime_budget?: number | null
          link_clicks?: number | null
          messaging_started?: number | null
          name?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          reach?: number | null
          revenue?: number | null
          sales?: number | null
          spend?: number | null
          status?: string | null
          targeting?: Json | null
        }
        Relationships: []
      }
      ads: {
        Row: {
          account_id: string | null
          adset_external_id: string | null
          body: string | null
          call_to_action_type: string | null
          campaign_id: string | null
          clicks: number | null
          company_id: string | null
          created_at: string
          creative_id: string | null
          external_id: string
          form_leads: number | null
          id: string
          image_url: string | null
          impressions: number | null
          landing_page_views: number | null
          last_synced_at: string | null
          leads: number | null
          link_clicks: number | null
          messaging_started: number | null
          name: string | null
          object_type: string | null
          permalink_url: string | null
          preview_url: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          reach: number | null
          revenue: number | null
          sales: number | null
          spend: number | null
          status: string | null
          thumbnail_url: string | null
          title: string | null
        }
        Insert: {
          account_id?: string | null
          adset_external_id?: string | null
          body?: string | null
          call_to_action_type?: string | null
          campaign_id?: string | null
          clicks?: number | null
          company_id?: string | null
          created_at?: string
          creative_id?: string | null
          external_id: string
          form_leads?: number | null
          id?: string
          image_url?: string | null
          impressions?: number | null
          landing_page_views?: number | null
          last_synced_at?: string | null
          leads?: number | null
          link_clicks?: number | null
          messaging_started?: number | null
          name?: string | null
          object_type?: string | null
          permalink_url?: string | null
          preview_url?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          reach?: number | null
          revenue?: number | null
          sales?: number | null
          spend?: number | null
          status?: string | null
          thumbnail_url?: string | null
          title?: string | null
        }
        Update: {
          account_id?: string | null
          adset_external_id?: string | null
          body?: string | null
          call_to_action_type?: string | null
          campaign_id?: string | null
          clicks?: number | null
          company_id?: string | null
          created_at?: string
          creative_id?: string | null
          external_id?: string
          form_leads?: number | null
          id?: string
          image_url?: string | null
          impressions?: number | null
          landing_page_views?: number | null
          last_synced_at?: string | null
          leads?: number | null
          link_clicks?: number | null
          messaging_started?: number | null
          name?: string | null
          object_type?: string | null
          permalink_url?: string | null
          preview_url?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          reach?: number | null
          revenue?: number | null
          sales?: number | null
          spend?: number | null
          status?: string | null
          thumbnail_url?: string | null
          title?: string | null
        }
        Relationships: []
      }
      ai_recommendations: {
        Row: {
          category: string | null
          company_id: string
          created_at: string
          description: string
          id: string
          impact: string | null
          status: Database["public"]["Enums"]["recommendation_status"]
          title: string
        }
        Insert: {
          category?: string | null
          company_id: string
          created_at?: string
          description: string
          id?: string
          impact?: string | null
          status?: Database["public"]["Enums"]["recommendation_status"]
          title: string
        }
        Update: {
          category?: string | null
          company_id?: string
          created_at?: string
          description?: string
          id?: string
          impact?: string | null
          status?: Database["public"]["Enums"]["recommendation_status"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "ai_recommendations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      alerts: {
        Row: {
          company_id: string
          created_at: string
          description: string | null
          id: string
          resolved: boolean
          severity: Database["public"]["Enums"]["alert_severity"]
          title: string
        }
        Insert: {
          company_id: string
          created_at?: string
          description?: string | null
          id?: string
          resolved?: boolean
          severity?: Database["public"]["Enums"]["alert_severity"]
          title: string
        }
        Update: {
          company_id?: string
          created_at?: string
          description?: string | null
          id?: string
          resolved?: boolean
          severity?: Database["public"]["Enums"]["alert_severity"]
          title?: string
        }
        Relationships: [
          {
            foreignKeyName: "alerts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      approval_requests: {
        Row: {
          action: string
          company_id: string
          conversation_id: string | null
          created_at: string
          entity_id: string | null
          entity_type: Database["public"]["Enums"]["approval_entity"]
          id: string
          payload: Json
          requested_by: string
          review_note: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          status: Database["public"]["Enums"]["approval_status"]
          summary: string
        }
        Insert: {
          action: string
          company_id: string
          conversation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type: Database["public"]["Enums"]["approval_entity"]
          id?: string
          payload?: Json
          requested_by: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          summary: string
        }
        Update: {
          action?: string
          company_id?: string
          conversation_id?: string | null
          created_at?: string
          entity_id?: string | null
          entity_type?: Database["public"]["Enums"]["approval_entity"]
          id?: string
          payload?: Json
          requested_by?: string
          review_note?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          status?: Database["public"]["Enums"]["approval_status"]
          summary?: string
        }
        Relationships: [
          {
            foreignKeyName: "approval_requests_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          company_id: string | null
          created_at: string
          details: Json
          id: string
          target_id: string | null
          target_type: string | null
          user_id: string | null
        }
        Insert: {
          action: string
          company_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Update: {
          action?: string
          company_id?: string | null
          created_at?: string
          details?: Json
          id?: string
          target_id?: string | null
          target_type?: string | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audit_log_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      campaigns: {
        Row: {
          clicks: number
          company_id: string
          created_at: string
          daily_budget: number
          frequency: number
          id: string
          impressions: number
          leads: number
          name: string
          objective: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          reach: number
          revenue: number
          sales: number
          spend: number
          status: string
        }
        Insert: {
          clicks?: number
          company_id: string
          created_at?: string
          daily_budget?: number
          frequency?: number
          id?: string
          impressions?: number
          leads?: number
          name: string
          objective?: string | null
          provider: Database["public"]["Enums"]["integration_provider"]
          reach?: number
          revenue?: number
          sales?: number
          spend?: number
          status?: string
        }
        Update: {
          clicks?: number
          company_id?: string
          created_at?: string
          daily_budget?: number
          frequency?: number
          id?: string
          impressions?: number
          leads?: number
          name?: string
          objective?: string | null
          provider?: Database["public"]["Enums"]["integration_provider"]
          reach?: number
          revenue?: number
          sales?: number
          spend?: number
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "campaigns_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_conversations: {
        Row: {
          company_id: string
          created_at: string
          created_by: string | null
          id: string
          kind: string
          title: string | null
          updated_at: string
        }
        Insert: {
          company_id: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          title?: string | null
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          created_by?: string | null
          id?: string
          kind?: string
          title?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "chat_conversations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      chat_messages: {
        Row: {
          attachments: Json | null
          company_id: string
          content: string | null
          conversation_id: string
          created_at: string
          id: string
          model: string | null
          role: string
          tokens_in: number | null
          tokens_out: number | null
          tool_calls: Json | null
          user_id: string | null
        }
        Insert: {
          attachments?: Json | null
          company_id: string
          content?: string | null
          conversation_id: string
          created_at?: string
          id?: string
          model?: string | null
          role: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json | null
          user_id?: string | null
        }
        Update: {
          attachments?: Json | null
          company_id?: string
          content?: string | null
          conversation_id?: string
          created_at?: string
          id?: string
          model?: string | null
          role?: string
          tokens_in?: number | null
          tokens_out?: number | null
          tool_calls?: Json | null
          user_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "chat_messages_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "chat_messages_conversation_id_fkey"
            columns: ["conversation_id"]
            isOneToOne: false
            referencedRelation: "chat_conversations"
            referencedColumns: ["id"]
          },
        ]
      }
      companies: {
        Row: {
          created_at: string
          created_by: string | null
          id: string
          industry: string | null
          name: string
        }
        Insert: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          name: string
        }
        Update: {
          created_at?: string
          created_by?: string | null
          id?: string
          industry?: string | null
          name?: string
        }
        Relationships: []
      }
      company_members: {
        Row: {
          company_id: string
          created_at: string
          id: string
          user_id: string
        }
        Insert: {
          company_id: string
          created_at?: string
          id?: string
          user_id: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "company_members_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      integrations: {
        Row: {
          account_name: string
          company_id: string
          connected_at: string
          external_id: string | null
          id: string
          provider: Database["public"]["Enums"]["integration_provider"]
          status: string
        }
        Insert: {
          account_name: string
          company_id: string
          connected_at?: string
          external_id?: string | null
          id?: string
          provider: Database["public"]["Enums"]["integration_provider"]
          status?: string
        }
        Update: {
          account_name?: string
          company_id?: string
          connected_at?: string
          external_id?: string | null
          id?: string
          provider?: Database["public"]["Enums"]["integration_provider"]
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "integrations_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          email: string
          full_name: string | null
          id: string
        }
        Insert: {
          created_at?: string
          email: string
          full_name?: string | null
          id: string
        }
        Update: {
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
        }
        Relationships: []
      }
      targets: {
        Row: {
          active: boolean
          campaign_id: string | null
          company_id: string
          created_at: string
          fonte: string
          id: string
          memoria: Json | null
          metric: string
          updated_at: string
          valor: number
        }
        Insert: {
          active?: boolean
          campaign_id?: string | null
          company_id: string
          created_at?: string
          fonte?: string
          id?: string
          memoria?: Json | null
          metric: string
          updated_at?: string
          valor: number
        }
        Update: {
          active?: boolean
          campaign_id?: string | null
          company_id?: string
          created_at?: string
          fonte?: string
          id?: string
          memoria?: Json | null
          metric?: string
          updated_at?: string
          valor?: number
        }
        Relationships: [
          {
            foreignKeyName: "targets_campaign_id_fkey"
            columns: ["campaign_id"]
            isOneToOne: false
            referencedRelation: "campaigns"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "targets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      user_roles: {
        Row: {
          id: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Insert: {
          id?: string
          role: Database["public"]["Enums"]["app_role"]
          user_id: string
        }
        Update: {
          id?: string
          role?: Database["public"]["Enums"]["app_role"]
          user_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      v_account_breakdown: {
        Row: {
          account_id: string | null
          account_name: string | null
          campaigns: number | null
          clicks: number | null
          company_id: string | null
          form_leads: number | null
          landing_page_views: number | null
          leads: number | null
          link_clicks: number | null
          messaging_started: number | null
          revenue: number | null
          sales: number | null
          spend: number | null
          tipo_conta: string | null
        }
        Relationships: []
      }
      v_campaign_breakdown: {
        Row: {
          account_id: string | null
          account_name: string | null
          campaign_id: string | null
          campanha: string | null
          clicks: number | null
          company_id: string | null
          cpc_link: number | null
          cpl: number | null
          empresa: string | null
          form_leads: number | null
          frequency: number | null
          impressions: number | null
          landing_page_views: number | null
          last_synced_at: string | null
          leads: number | null
          link_clicks: number | null
          messaging_started: number | null
          objective: string | null
          reach: number | null
          revenue: number | null
          sales: number | null
          spend: number | null
          status: string | null
          tipo: string | null
        }
        Relationships: []
      }
    }
    Functions: {
      decide_approval: {
        Args: { p_id: string; p_decision: string; p_reason: string | null }
        Returns: Json
      }
      evaluate_alerts: {
        Args: Record<PropertyKey, never>
        Returns: number
      }
      has_role: {
        Args: {
          _role: Database["public"]["Enums"]["app_role"]
          _user_id: string
        }
        Returns: boolean
      }
      is_company_member: {
        Args: { _company_id: string; _user_id: string }
        Returns: boolean
      }
    }
    Enums: {
      alert_severity: "low" | "medium" | "high" | "critical"
      app_role: "admin" | "viewer"
      approval_entity: "campaign" | "budget" | "ad" | "audience" | "config"
      approval_status: "pending" | "approved" | "rejected"
      integration_provider: "meta_ads" | "google_ads" | "ga4" | "gsc" | "gtm"
      recommendation_status: "new" | "accepted" | "dismissed"
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

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      alert_severity: ["low", "medium", "high", "critical"],
      app_role: ["admin", "viewer"],
      approval_entity: ["campaign", "budget", "ad", "audience", "config"],
      approval_status: ["pending", "approved", "rejected"],
      integration_provider: ["meta_ads", "google_ads", "ga4", "gsc", "gtm"],
      recommendation_status: ["new", "accepted", "dismissed"],
    },
  },
} as const
