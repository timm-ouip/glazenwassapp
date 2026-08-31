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
    PostgrestVersion: "14.15"
  }
  public: {
    Tables: {
      companies: {
        Row: {
          adres: string
          btw: string
          created_at: string
          email: string
          iban: string
          id: string
          kvk: string
          name: string
          plaats: string
          postcode: string
          telefoon: string
        }
        Insert: {
          adres?: string
          btw?: string
          created_at?: string
          email?: string
          iban?: string
          id?: string
          kvk?: string
          name: string
          plaats?: string
          postcode?: string
          telefoon?: string
        }
        Update: {
          adres?: string
          btw?: string
          created_at?: string
          email?: string
          iban?: string
          id?: string
          kvk?: string
          name?: string
          plaats?: string
          postcode?: string
          telefoon?: string
        }
        Relationships: []
      }
      customers: {
        Row: {
          addition: string
          company_id: string
          created_at: string
          deleted_at: string | null
          frequency: string
          house_number: number
          id: string
          klant_id: string | null
          note: string
          postcode: string
          price: number
          sort_order: number
          street_id: string
        }
        Insert: {
          addition?: string
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          frequency?: string
          house_number: number
          id?: string
          klant_id?: string | null
          note?: string
          postcode?: string
          price?: number
          sort_order?: number
          street_id: string
        }
        Update: {
          addition?: string
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          frequency?: string
          house_number?: number
          id?: string
          klant_id?: string | null
          note?: string
          postcode?: string
          price?: number
          sort_order?: number
          street_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_klant_id_fkey"
            columns: ["klant_id"]
            isOneToOne: false
            referencedRelation: "klanten"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "customers_street_id_fkey"
            columns: ["street_id"]
            isOneToOne: false
            referencedRelation: "streets"
            referencedColumns: ["id"]
          },
        ]
      }
      districts: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          id: string
          name: string
          plaats: string
          sort_order: number
          updated_at: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name: string
          plaats?: string
          sort_order?: number
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          name?: string
          plaats?: string
          sort_order?: number
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "districts_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      employees: {
        Row: {
          company_id: string
          created_at: string
          email: string
          id: string
          naam: string
          rol: string
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          id: string
          naam?: string
          rol?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          id?: string
          naam?: string
          rol?: string
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      klanten: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          email: string
          huisnummer: string
          id: string
          naam: string
          notitie: string
          plaats: string
          postcode: string
          straat: string
          telefoon: string
          updated_at: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          email?: string
          huisnummer?: string
          id?: string
          naam: string
          notitie?: string
          plaats?: string
          postcode?: string
          straat?: string
          telefoon?: string
          updated_at?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          email?: string
          huisnummer?: string
          id?: string
          naam?: string
          notitie?: string
          plaats?: string
          postcode?: string
          straat?: string
          telefoon?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "klanten_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      quick_notes: {
        Row: {
          company_id: string
          created_at: string
          id: string
          label: string
          sort_order: number
        }
        Insert: {
          company_id?: string
          created_at?: string
          id?: string
          label: string
          sort_order?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          label?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "quick_notes_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
        ]
      }
      streets: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          district_id: string
          id: string
          name: string
          print_col: number | null
          print_row: number | null
          sort_desc: boolean
          kolom_start: boolean
          sort_order: number
          volledige_naam: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          district_id: string
          id?: string
          name: string
          print_col?: number | null
          print_row?: number | null
          sort_desc?: boolean
          kolom_start?: boolean
          sort_order?: number
          volledige_naam?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          district_id?: string
          id?: string
          name?: string
          print_col?: number | null
          print_row?: number | null
          sort_desc?: boolean
          kolom_start?: boolean
          sort_order?: number
          volledige_naam?: string
        }
        Relationships: [
          {
            foreignKeyName: "streets_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "streets_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
            referencedColumns: ["id"]
          },
        ]
      }
      wasdag_regels: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string | null
          datum: string
          id: string
          prijs: number
        }
        Insert: {
          company_id?: string
          created_at?: string
          customer_id?: string | null
          datum: string
          id?: string
          prijs?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string | null
          datum?: string
          id?: string
          prijs?: number
        }
        Relationships: [
          {
            foreignKeyName: "wasdag_regels_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "wasdag_regels_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
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
      [_ in never]: never
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
    Enums: {},
  },
} as const
