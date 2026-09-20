export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.15";
  };
  public: {
    Tables: {
      aanmeldingen: {
        Row: {
          company_id: string;
          automatisch: Json | null;
          created_at: string;
          customer_id: string | null;
          deleted_at: string | null;
          email: string;
          huisnummer: string;
          id: string;
          ip: string;
          klant_id: string | null;
          naam: string;
          plaats: string;
          postcode: string;
          soort: string;
          status: string;
          straat: string;
          telefoon: string;
          toevoeging: string;
        };
        Insert: {
          company_id?: string;
          automatisch?: Json | null;
          created_at?: string;
          customer_id?: string | null;
          deleted_at?: string | null;
          email?: string;
          huisnummer?: string;
          id?: string;
          ip?: string;
          klant_id?: string | null;
          naam?: string;
          plaats?: string;
          postcode?: string;
          soort: string;
          status?: string;
          straat?: string;
          telefoon?: string;
          toevoeging?: string;
        };
        Update: {
          company_id?: string;
          automatisch?: Json | null;
          created_at?: string;
          customer_id?: string | null;
          deleted_at?: string | null;
          email?: string;
          huisnummer?: string;
          id?: string;
          ip?: string;
          klant_id?: string | null;
          naam?: string;
          plaats?: string;
          postcode?: string;
          soort?: string;
          status?: string;
          straat?: string;
          telefoon?: string;
          toevoeging?: string;
        };
        Relationships: [];
      };
      companies: {
        Row: {
          plan_tarief_uur: number;
          plan_begin: string;
          plan_eind: string;
          plan_pauze_van: string;
          plan_pauze_min: number;
          plan_rijtijd_min: number;
          plan_groot_pand_min: number;
          plan_tijdlijn: boolean;
          plan_tijdvak_mailen: boolean;
          wa_wachttijd_min: number;
          wa_antwoord_van: string;
          wa_antwoord_tot: string;
          aanmeld_aan: boolean;
          aanmeld_token: string;
          adres: string;
          btw: string;
          created_at: string;
          email: string;
          iban: string;
          id: string;
          kvk: string;
          mail_afzender_email: string;
          mail_afzender_naam: string;
          mail_schrijfstijl: string;
          name: string;
          paaltje_daglimiet: number;
          plaats: string;
          postcode: string;
          telefoon: string;
          werkdagen: number[];
        };
        Insert: {
          plan_tarief_uur?: number;
          plan_begin?: string;
          plan_eind?: string;
          plan_pauze_van?: string;
          plan_pauze_min?: number;
          plan_rijtijd_min?: number;
          plan_groot_pand_min?: number;
          plan_tijdlijn?: boolean;
          plan_tijdvak_mailen?: boolean;
          wa_wachttijd_min?: number;
          wa_antwoord_van?: string;
          wa_antwoord_tot?: string;
          aanmeld_aan?: boolean;
          aanmeld_token?: string;
          adres?: string;
          btw?: string;
          created_at?: string;
          email?: string;
          iban?: string;
          id?: string;
          kvk?: string;
          mail_afzender_email?: string;
          mail_afzender_naam?: string;
          mail_schrijfstijl?: string;
          name: string;
          paaltje_daglimiet?: number;
          plaats?: string;
          postcode?: string;
          telefoon?: string;
          werkdagen?: number[];
        };
        Update: {
          plan_tarief_uur?: number;
          plan_begin?: string;
          plan_eind?: string;
          plan_pauze_van?: string;
          plan_pauze_min?: number;
          plan_rijtijd_min?: number;
          plan_groot_pand_min?: number;
          plan_tijdlijn?: boolean;
          plan_tijdvak_mailen?: boolean;
          wa_wachttijd_min?: number;
          wa_antwoord_van?: string;
          wa_antwoord_tot?: string;
          aanmeld_aan?: boolean;
          aanmeld_token?: string;
          adres?: string;
          btw?: string;
          created_at?: string;
          email?: string;
          iban?: string;
          id?: string;
          kvk?: string;
          mail_afzender_email?: string;
          mail_afzender_naam?: string;
          mail_schrijfstijl?: string;
          name?: string;
          paaltje_daglimiet?: number;
          plaats?: string;
          postcode?: string;
          telefoon?: string;
          werkdagen?: number[];
        };
        Relationships: [];
      };
      customers: {
        Row: {
          duur_min: number | null;
          duur_zelf: boolean;
          eigen_blok: boolean | null;
          inactief_op: string | null;
          inactief_reden: string | null;
          aangemeld_op: string | null;
          addition: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          frequency: string;
          geimporteerd: boolean;
          house_number: number;
          hoek_straat: string;
          hoek_straat_volledig: string;
          hoek_kant: string;
          interval_maanden: number;
          ritme: number;
          maandwerk: Json;
          id: string;
          klant_id: string | null;
          markering: string;
          overslaan: string[];
          start_maand: string;
          note: string;
          note_even: string;
          note_oneven: string;
          postcode: string;
          sort_order: number;
          street_id: string;
        };
        Insert: {
          duur_min?: number | null;
          duur_zelf?: boolean;
          eigen_blok?: boolean | null;
          inactief_op?: string | null;
          inactief_reden?: string | null;
          aangemeld_op?: string | null;
          addition?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          frequency?: string;
          geimporteerd?: boolean;
          house_number: number;
          hoek_straat?: string;
          hoek_straat_volledig?: string;
          hoek_kant?: string;
          interval_maanden?: number;
          ritme?: number;
          maandwerk?: Json;
          id?: string;
          klant_id?: string | null;
          markering?: string;
          overslaan?: string[];
          start_maand?: string;
          note?: string;
          note_even?: string;
          note_oneven?: string;
          postcode?: string;
          sort_order?: number;
          street_id: string;
        };
        Update: {
          duur_min?: number | null;
          duur_zelf?: boolean;
          eigen_blok?: boolean | null;
          inactief_op?: string | null;
          inactief_reden?: string | null;
          aangemeld_op?: string | null;
          addition?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          frequency?: string;
          geimporteerd?: boolean;
          house_number?: number;
          hoek_straat?: string;
          hoek_straat_volledig?: string;
          hoek_kant?: string;
          interval_maanden?: number;
          ritme?: number;
          maandwerk?: Json;
          id?: string;
          klant_id?: string | null;
          markering?: string;
          overslaan?: string[];
          start_maand?: string;
          note?: string;
          note_even?: string;
          note_oneven?: string;
          postcode?: string;
          sort_order?: number;
          street_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "customers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_klant_id_fkey";
            columns: ["klant_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "customers_street_id_fkey";
            columns: ["street_id"];
            isOneToOne: false;
            referencedRelation: "streets";
            referencedColumns: ["id"];
          },
        ];
      };
      districts: {
        Row: {
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          name: string;
          plaats: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          name: string;
          plaats?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          name?: string;
          plaats?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "districts_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      employees: {
        Row: {
          company_id: string;
          created_at: string;
          email: string;
          id: string;
          naam: string;
          rol: string;
          rol_id: string | null;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          email: string;
          id: string;
          naam?: string;
          rol?: string;
          rol_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          email?: string;
          id?: string;
          naam?: string;
          rol?: string;
          rol_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "employees_rol_fkey";
            columns: ["rol_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "rollen";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      adres_prijzen: {
        Row: {
          company_id: string;
          customer_id: string;
          prijs: number;
          maandwerk_extra: Json;
        };
        Insert: {
          company_id?: string;
          customer_id: string;
          prijs?: number;
          maandwerk_extra?: Json;
        };
        Update: {
          company_id?: string;
          customer_id?: string;
          prijs?: number;
          maandwerk_extra?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "adres_prijzen_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: true;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      klus_prijzen: {
        Row: {
          company_id: string;
          klus_id: string;
          prijs: number;
        };
        Insert: {
          company_id?: string;
          klus_id: string;
          prijs?: number;
        };
        Update: {
          company_id?: string;
          klus_id?: string;
          prijs?: number;
        };
        Relationships: [
          {
            foreignKeyName: "klus_prijzen_klus_id_company_id_fkey";
            columns: ["klus_id", "company_id"];
            isOneToOne: true;
            referencedRelation: "klussen";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      wasdag_prijzen: {
        Row: {
          company_id: string;
          regel_id: string;
          prijs: number;
        };
        Insert: {
          company_id?: string;
          regel_id: string;
          prijs?: number;
        };
        Update: {
          company_id?: string;
          regel_id?: string;
          prijs?: number;
        };
        Relationships: [
          {
            foreignKeyName: "wasdag_prijzen_regel_id_company_id_fkey";
            columns: ["regel_id", "company_id"];
            isOneToOne: true;
            referencedRelation: "wasdag_regels";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      rollen: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          naam: string;
          rechten: string[];
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          naam: string;
          rechten?: string[];
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          naam?: string;
          rechten?: string[];
        };
        Relationships: [
          {
            foreignKeyName: "rollen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      klanten: {
        Row: {
          kanaal_voorkeur: string;
          wa_toestemming_op: string | null;
          wa_toestemming_bron: string;
          wa_marketing_op: string | null;
          wa_afgemeld_op: string | null;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          email: string;
          email2: string;
          huisnummer: string;
          id: string;
          naam: string;
          notitie: string;
          plaats: string;
          postcode: string;
          straat: string;
          telefoon: string;
          telefoon2: string;
          updated_at: string;
        };
        Insert: {
          kanaal_voorkeur?: string;
          wa_toestemming_op?: string | null;
          wa_toestemming_bron?: string;
          wa_marketing_op?: string | null;
          wa_afgemeld_op?: string | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          email?: string;
          email2?: string;
          huisnummer?: string;
          id?: string;
          naam: string;
          notitie?: string;
          plaats?: string;
          postcode?: string;
          straat?: string;
          telefoon?: string;
          telefoon2?: string;
          updated_at?: string;
        };
        Update: {
          kanaal_voorkeur?: string;
          wa_toestemming_op?: string | null;
          wa_toestemming_bron?: string;
          wa_marketing_op?: string | null;
          wa_afgemeld_op?: string | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          email?: string;
          email2?: string;
          huisnummer?: string;
          id?: string;
          naam?: string;
          notitie?: string;
          plaats?: string;
          postcode?: string;
          straat?: string;
          telefoon?: string;
          telefoon2?: string;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "klanten_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      klussen: {
        Row: {
          duur_min: number | null;
          duur_zelf: boolean;
          ploeg_nr: number | null;
          volgorde: number | null;
          vaste_start: string | null;
          company_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          gedaan_op: string | null;
          gepland_op: string | null;
          id: string;
          omschrijving: string;
        };
        Insert: {
          duur_min?: number | null;
          duur_zelf?: boolean;
          ploeg_nr?: number | null;
          volgorde?: number | null;
          vaste_start?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          gedaan_op?: string | null;
          gepland_op?: string | null;
          id?: string;
          omschrijving: string;
        };
        Update: {
          duur_min?: number | null;
          duur_zelf?: boolean;
          ploeg_nr?: number | null;
          volgorde?: number | null;
          vaste_start?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          gedaan_op?: string | null;
          gepland_op?: string | null;
          id?: string;
          omschrijving?: string;
        };
        Relationships: [
          {
            foreignKeyName: "klussen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "klussen_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      mail_ontvangers: {
        Row: {
          message_id: string;
          wa_id: string;
          bezorgstatus: string;
          status_op: string | null;
          kanaal: string;
          telefoon: string;
          adressen: string;
          company_id: string;
          created_at: string;
          email: string;
          fout: string;
          id: string;
          klant_id: string | null;
          mailing_id: string;
          naam: string;
          status: string;
        };
        Insert: {
          message_id?: string;
          wa_id?: string;
          bezorgstatus?: string;
          status_op?: string | null;
          kanaal?: string;
          telefoon?: string;
          adressen?: string;
          company_id: string;
          created_at?: string;
          email: string;
          fout?: string;
          id?: string;
          klant_id?: string | null;
          mailing_id: string;
          naam?: string;
          status?: string;
        };
        Update: {
          message_id?: string;
          wa_id?: string;
          bezorgstatus?: string;
          status_op?: string | null;
          kanaal?: string;
          telefoon?: string;
          adressen?: string;
          company_id?: string;
          created_at?: string;
          email?: string;
          fout?: string;
          id?: string;
          klant_id?: string | null;
          mailing_id?: string;
          naam?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mail_ontvangers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mail_ontvangers_klant_id_fkey";
            columns: ["klant_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mail_ontvangers_mailing_id_fkey";
            columns: ["mailing_id"];
            isOneToOne: false;
            referencedRelation: "mailingen";
            referencedColumns: ["id"];
          },
        ];
      };
      mail_wijzigingen: {
        Row: {
          bericht_id: string | null;
          details: Json;
          adres: string;
          antwoord_id: string | null;
          automatisch: boolean;
          company_id: string;
          created_at: string;
          customer_id: string | null;
          door: string | null;
          id: string;
          klant: string;
          maanden: string[];
          na_overslaan: string[];
          na_start_maand: string;
          soort: string;
          teruggedraaid_door: string | null;
          teruggedraaid_op: string | null;
          voor_overslaan: string[];
          voor_start_maand: string;
          zekerheid: number | null;
        };
        Insert: {
          bericht_id?: string | null;
          details?: Json;
          adres?: string;
          antwoord_id?: string | null;
          automatisch?: boolean;
          company_id: string;
          created_at?: string;
          customer_id?: string | null;
          door?: string | null;
          id?: string;
          klant?: string;
          maanden?: string[];
          na_overslaan?: string[];
          na_start_maand?: string;
          soort?: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_op?: string | null;
          voor_overslaan?: string[];
          voor_start_maand?: string;
          zekerheid?: number | null;
        };
        Update: {
          bericht_id?: string | null;
          details?: Json;
          adres?: string;
          antwoord_id?: string | null;
          automatisch?: boolean;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          door?: string | null;
          id?: string;
          klant?: string;
          maanden?: string[];
          na_overslaan?: string[];
          na_start_maand?: string;
          soort?: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_op?: string | null;
          voor_overslaan?: string[];
          voor_start_maand?: string;
          zekerheid?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "mail_wijzigingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mail_wijzigingen_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      mailingen: {
        Row: {
          soort: string;
          kanaal: string;
          sjabloon_id: string | null;
          aantal_whatsapp: number;
          aantal: number;
          company_id: string;
          created_at: string;
          datum: string | null;
          id: string;
          mislukt: number;
          onderwerp: string;
          tekst: string;
          test: boolean;
          verzonden_door: string | null;
        };
        Insert: {
          soort?: string;
          kanaal?: string;
          sjabloon_id?: string | null;
          aantal_whatsapp?: number;
          aantal?: number;
          company_id: string;
          created_at?: string;
          datum?: string | null;
          id?: string;
          mislukt?: number;
          onderwerp: string;
          tekst: string;
          test?: boolean;
          verzonden_door?: string | null;
        };
        Update: {
          soort?: string;
          kanaal?: string;
          sjabloon_id?: string | null;
          aantal_whatsapp?: number;
          aantal?: number;
          company_id?: string;
          created_at?: string;
          datum?: string | null;
          id?: string;
          mislukt?: number;
          onderwerp?: string;
          tekst?: string;
          test?: boolean;
          verzonden_door?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "mailingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mailingen_verzonden_door_fkey";
            columns: ["verzonden_door"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      markeringen: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          naam: string;
          sleutel: string;
          sort_order: number;
          tint: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          naam: string;
          sleutel: string;
          sort_order?: number;
          tint: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          naam?: string;
          sleutel?: string;
          sort_order?: number;
          tint?: string;
        };
        Relationships: [
          {
            foreignKeyName: "markeringen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      quick_notes: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          label: string;
          omschrijving: string;
          sort_order: number;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          label: string;
          omschrijving?: string;
          sort_order?: number;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          label?: string;
          omschrijving?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "quick_notes_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      straat_groepen: {
        Row: {
          company_id: string;
          created_at: string;
          district_id: string;
          id: string;
          naam: string;
          sort_order: number;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          district_id: string;
          id?: string;
          naam: string;
          sort_order?: number;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          district_id?: string;
          id?: string;
          naam?: string;
          sort_order?: number;
        };
        Relationships: [
          {
            foreignKeyName: "straat_groepen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "straat_groepen_district_id_fkey";
            columns: ["district_id"];
            isOneToOne: false;
            referencedRelation: "districts";
            referencedColumns: ["id"];
          },
        ];
      };
      streets: {
        Row: {
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          district_id: string;
          groep_id: string | null;
          id: string;
          name: string;
          print_col: number | null;
          print_row: number | null;
          sort_desc: boolean;
          kolom_start: boolean;
          doorlopend: boolean;
          sort_order: number;
          volledige_naam: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          district_id: string;
          groep_id?: string | null;
          id?: string;
          name: string;
          print_col?: number | null;
          print_row?: number | null;
          sort_desc?: boolean;
          kolom_start?: boolean;
          doorlopend?: boolean;
          sort_order?: number;
          volledige_naam?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          district_id?: string;
          groep_id?: string | null;
          id?: string;
          name?: string;
          print_col?: number | null;
          print_row?: number | null;
          sort_desc?: boolean;
          kolom_start?: boolean;
          doorlopend?: boolean;
          sort_order?: number;
          volledige_naam?: string;
        };
        Relationships: [
          {
            foreignKeyName: "streets_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "streets_district_id_fkey";
            columns: ["district_id"];
            isOneToOne: false;
            referencedRelation: "districts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "streets_groep_id_fkey";
            columns: ["groep_id"];
            isOneToOne: false;
            referencedRelation: "straat_groepen";
            referencedColumns: ["id"];
          },
        ];
      };
      teamleden: {
        Row: {
          id: string;
          company_id: string;
          naam: string;
          employee_id: string | null;
          uitgenodigd_user_id: string | null;
          deleted_at: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          naam: string;
          employee_id?: string | null;
          uitgenodigd_user_id?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          naam?: string;
          employee_id?: string | null;
          uitgenodigd_user_id?: string | null;
          deleted_at?: string | null;
          created_at?: string;
        };
        Relationships: [];
      };
      dag_ploegen: {
        Row: {
          company_id: string;
          datum: string;
          nr: number;
          begin_tijd: string | null;
          eind_tijd: string | null;
          pauze_van: string | null;
          pauze_min: number | null;
          created_at: string;
        };
        Insert: {
          company_id?: string;
          datum: string;
          nr: number;
          begin_tijd?: string | null;
          eind_tijd?: string | null;
          pauze_van?: string | null;
          pauze_min?: number | null;
          created_at?: string;
        };
        Update: {
          company_id?: string;
          datum?: string;
          nr?: number;
          begin_tijd?: string | null;
          eind_tijd?: string | null;
          pauze_van?: string | null;
          pauze_min?: number | null;
          created_at?: string;
        };
        Relationships: [];
      };
      dag_ploeg_leden: {
        Row: {
          company_id: string;
          datum: string;
          nr: number;
          teamlid_id: string;
        };
        Insert: {
          company_id?: string;
          datum: string;
          nr: number;
          teamlid_id: string;
        };
        Update: {
          company_id?: string;
          datum?: string;
          nr?: number;
          teamlid_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "dag_ploeg_leden_teamlid_id_fkey";
            columns: ["teamlid_id"];
            isOneToOne: false;
            referencedRelation: "teamleden";
            referencedColumns: ["id"];
          },
        ];
      };
      aankondiging_adressen: {
        Row: {
          id: string;
          company_id: string;
          ontvanger_id: string;
          customer_id: string | null;
          datum: string;
          tijdvak_van: string | null;
          tijdvak_tot: string | null;
          soort: string;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          ontvanger_id: string;
          customer_id?: string | null;
          datum: string;
          tijdvak_van?: string | null;
          tijdvak_tot?: string | null;
          soort?: string;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          ontvanger_id?: string;
          customer_id?: string | null;
          datum?: string;
          tijdvak_van?: string | null;
          tijdvak_tot?: string | null;
          soort?: string;
          created_at?: string;
        };
        Relationships: [];
      };
      bericht_sjablonen: {
        Row: {
          id: string;
          company_id: string;
          soort: string;
          naam: string;
          onderwerp: string;
          tekst: string;
          wa_sjabloon_id: string | null;
          standaard: boolean;
          sort_order: number;
          deleted_at: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          soort: string;
          naam: string;
          onderwerp?: string;
          tekst: string;
          wa_sjabloon_id?: string | null;
          standaard?: boolean;
          sort_order?: number;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          soort?: string;
          naam?: string;
          onderwerp?: string;
          tekst?: string;
          wa_sjabloon_id?: string | null;
          standaard?: boolean;
          sort_order?: number;
          deleted_at?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Relationships: [];
      };
      snelle_redenen: {
        Row: {
          id: string;
          company_id: string;
          tekst: string;
          sort_order: number;
          created_at: string;
        };
        Insert: {
          id?: string;
          company_id?: string;
          tekst: string;
          sort_order?: number;
          created_at?: string;
        };
        Update: {
          id?: string;
          company_id?: string;
          tekst?: string;
          sort_order?: number;
          created_at?: string;
        };
        Relationships: [];
      };
      wasdag_regels: {
        Row: {
          ploeg_nr: number | null;
          volgorde: number | null;
          rest: boolean;
          vaste_start: string | null;
          company_id: string;
          created_at: string;
          customer_id: string | null;
          datum: string;
          id: string;
          notitie: string | null;
        };
        Insert: {
          ploeg_nr?: number | null;
          volgorde?: number | null;
          rest?: boolean;
          vaste_start?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          datum: string;
          id?: string;
          notitie?: string | null;
        };
        Update: {
          ploeg_nr?: number | null;
          volgorde?: number | null;
          rest?: boolean;
          vaste_start?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          datum?: string;
          id?: string;
          notitie?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "wasdag_regels_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wasdag_regels_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
        ];
      };
      mailboxen: {
        Row: {
          adres: string;
          bezig_tot: string | null;
          company_id: string;
          created_at: string;
          fout: string;
          gekoppeld_door: string | null;
          id: string;
          imap_host: string;
          imap_poort: number;
          import_vanaf: string;
          laatste_poging: string | null;
          laatste_sync: string | null;
          paaltje_vanaf: string;
          smtp_host: string;
          smtp_poort: number;
          status: string;
        };
        Insert: {
          adres: string;
          bezig_tot?: string | null;
          company_id?: string;
          created_at?: string;
          fout?: string;
          gekoppeld_door?: string | null;
          id?: string;
          imap_host?: string;
          imap_poort?: number;
          import_vanaf?: string;
          laatste_poging?: string | null;
          laatste_sync?: string | null;
          paaltje_vanaf?: string;
          smtp_host?: string;
          smtp_poort?: number;
          status?: string;
        };
        Update: {
          adres?: string;
          bezig_tot?: string | null;
          company_id?: string;
          created_at?: string;
          fout?: string;
          gekoppeld_door?: string | null;
          id?: string;
          imap_host?: string;
          imap_poort?: number;
          import_vanaf?: string;
          laatste_poging?: string | null;
          laatste_sync?: string | null;
          paaltje_vanaf?: string;
          smtp_host?: string;
          smtp_poort?: number;
          status?: string;
        };
        Relationships: [];
      };
      mail_mappen: {
        Row: {
          aantal: number;
          bijgewerkt_op: string | null;
          company_id: string;
          id: string;
          mailbox_id: string;
          ongelezen: number;
          pad: string;
          rol: string;
          uidvalidity: number | null;
        };
        Insert: {
          aantal?: number;
          bijgewerkt_op?: string | null;
          company_id: string;
          id?: string;
          mailbox_id: string;
          ongelezen?: number;
          pad: string;
          rol?: string;
          uidvalidity?: number | null;
        };
        Update: {
          aantal?: number;
          bijgewerkt_op?: string | null;
          company_id?: string;
          id?: string;
          mailbox_id?: string;
          ongelezen?: number;
          pad?: string;
          rol?: string;
          uidvalidity?: number | null;
        };
        Relationships: [];
      };
      berichten: {
        Row: {
          wa_antwoord_direct: boolean;
          wa_antwoord_op: string | null;
          wa_antwoord_status: string;
          wa_antwoord_reden: string;
          kanaal: string;
          wa_id: string | null;
          wa_telefoon: string;
          wa_type: string;
          wa_status: string;
          media: Json;
          bron: string;
          afgehandeld_door_paaltje: boolean;
          afgehandeld_op: string | null;
          indeling_door_mens: boolean;
          ai_fout: string;
          beantwoord_op: string | null;
          concept: string;
          concept_paaltje: string;
          doorgevoerd_automatisch: boolean;
          doorgevoerd_op: string | null;
          gelezen_door_paaltje_op: string | null;
          is_klantmail: boolean | null;
          klant_gok_id: string | null;
          klantgegevens: Json;
          samenvatting: string;
          voorstel: Json;
          zekerheid: number | null;
          aan: Json;
          afgekapt: boolean;
          antwoord_naar: string;
          bijlagen: Json;
          cc: Json;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          fragment: string;
          gelezen: boolean;
          gemarkeerd: boolean;
          grootte: number;
          html: string;
          id: string;
          in_reply_to: string;
          klant_id: string | null;
          mailbox_id: string | null;
          map_id: string | null;
          message_id: string;
          onderwerp: string;
          ontvangen_op: string;
          op_server: boolean;
          paaltje_pogingen: number;
          paaltje_status: string;
          referenties: string[];
          richting: string;
          tekst: string;
          uid: number | null;
          uit_dossier_op: string | null;
          herinner_op: string | null;
          uidvalidity: number | null;
          van_email: string;
          van_naam: string;
          vorige_map_id: string | null;
          weg_sinds: string | null;
        };
        Insert: {
          wa_antwoord_direct?: boolean;
          wa_antwoord_op?: string | null;
          wa_antwoord_status?: string;
          wa_antwoord_reden?: string;
          kanaal?: string;
          wa_id?: string | null;
          wa_telefoon?: string;
          wa_type?: string;
          wa_status?: string;
          media?: Json;
          bron?: string;
          afgehandeld_door_paaltje?: boolean;
          afgehandeld_op?: string | null;
          indeling_door_mens?: boolean;
          ai_fout?: string;
          beantwoord_op?: string | null;
          concept?: string;
          concept_paaltje?: string;
          doorgevoerd_automatisch?: boolean;
          doorgevoerd_op?: string | null;
          gelezen_door_paaltje_op?: string | null;
          is_klantmail?: boolean | null;
          klant_gok_id?: string | null;
          klantgegevens?: Json;
          samenvatting?: string;
          voorstel?: Json;
          zekerheid?: number | null;
          aan?: Json;
          afgekapt?: boolean;
          antwoord_naar?: string;
          bijlagen?: Json;
          cc?: Json;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          fragment?: string;
          gelezen?: boolean;
          gemarkeerd?: boolean;
          grootte?: number;
          html?: string;
          id?: string;
          in_reply_to?: string;
          klant_id?: string | null;
          mailbox_id?: string | null;
          map_id?: string | null;
          message_id?: string;
          onderwerp?: string;
          ontvangen_op: string;
          op_server?: boolean;
          paaltje_pogingen?: number;
          paaltje_status?: string;
          referenties?: string[];
          richting?: string;
          tekst?: string;
          uid?: number | null;
          uit_dossier_op?: string | null;
          herinner_op?: string | null;
          uidvalidity?: number | null;
          van_email?: string;
          van_naam?: string;
          vorige_map_id?: string | null;
          weg_sinds?: string | null;
        };
        Update: {
          wa_antwoord_direct?: boolean;
          wa_antwoord_op?: string | null;
          wa_antwoord_status?: string;
          wa_antwoord_reden?: string;
          kanaal?: string;
          wa_id?: string | null;
          wa_telefoon?: string;
          wa_type?: string;
          wa_status?: string;
          media?: Json;
          bron?: string;
          afgehandeld_door_paaltje?: boolean;
          afgehandeld_op?: string | null;
          indeling_door_mens?: boolean;
          ai_fout?: string;
          beantwoord_op?: string | null;
          concept?: string;
          concept_paaltje?: string;
          doorgevoerd_automatisch?: boolean;
          doorgevoerd_op?: string | null;
          gelezen_door_paaltje_op?: string | null;
          is_klantmail?: boolean | null;
          klant_gok_id?: string | null;
          klantgegevens?: Json;
          samenvatting?: string;
          voorstel?: Json;
          zekerheid?: number | null;
          aan?: Json;
          afgekapt?: boolean;
          antwoord_naar?: string;
          bijlagen?: Json;
          cc?: Json;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          fragment?: string;
          gelezen?: boolean;
          gemarkeerd?: boolean;
          grootte?: number;
          html?: string;
          id?: string;
          in_reply_to?: string;
          klant_id?: string | null;
          mailbox_id?: string | null;
          map_id?: string | null;
          message_id?: string;
          onderwerp?: string;
          ontvangen_op?: string;
          op_server?: boolean;
          paaltje_pogingen?: number;
          paaltje_status?: string;
          referenties?: string[];
          richting?: string;
          tekst?: string;
          uid?: number | null;
          uit_dossier_op?: string | null;
          herinner_op?: string | null;
          uidvalidity?: number | null;
          van_email?: string;
          van_naam?: string;
          vorige_map_id?: string | null;
          weg_sinds?: string | null;
        };
        Relationships: [];
      };
      mail_categorieen: {
        Row: {
          zelf_antwoorden_whatsapp: boolean;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          naam: string;
          omschrijving: string;
          sleutel: string | null;
          volgorde: number;
          zelfstandigheid: string;
        };
        Insert: {
          zelf_antwoorden_whatsapp?: boolean;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          naam: string;
          omschrijving?: string;
          sleutel?: string | null;
          volgorde?: number;
          zelfstandigheid?: string;
        };
        Update: {
          zelf_antwoorden_whatsapp?: boolean;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          naam?: string;
          omschrijving?: string;
          sleutel?: string | null;
          volgorde?: number;
          zelfstandigheid?: string;
        };
        Relationships: [];
      };
      bericht_categorieen: {
        Row: {
          bericht_id: string;
          categorie_id: string;
          company_id: string;
          created_at: string;
          door: string;
          zekerheid: number | null;
        };
        Insert: {
          bericht_id: string;
          categorie_id: string;
          company_id?: string;
          created_at?: string;
          door?: string;
          zekerheid?: number | null;
        };
        Update: {
          bericht_id?: string;
          categorie_id?: string;
          company_id?: string;
          created_at?: string;
          door?: string;
          zekerheid?: number | null;
        };
        Relationships: [];
      };
      klacht_berichten: {
        Row: {
          bericht_id: string;
          company_id: string;
          created_at: string;
          klacht_id: string;
        };
        Insert: {
          bericht_id: string;
          company_id?: string;
          created_at?: string;
          klacht_id: string;
        };
        Update: {
          bericht_id?: string;
          company_id?: string;
          created_at?: string;
          klacht_id?: string;
        };
        Relationships: [];
      };
      klachten: {
        Row: {
          afgehandeld_op: string | null;
          bron: string;
          company_id: string;
          created_at: string;
          customer_id: string | null;
          deleted_at: string | null;
          door_paaltje: boolean;
          gemaakt_door: string | null;
          id: string;
          klant_id: string;
          omschrijving: string;
          ontvangen_op: string;
          status: string;
        };
        Insert: {
          afgehandeld_op?: string | null;
          bron?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          deleted_at?: string | null;
          door_paaltje?: boolean;
          gemaakt_door?: string | null;
          id?: string;
          klant_id: string;
          omschrijving: string;
          ontvangen_op?: string;
          status?: string;
        };
        Update: {
          afgehandeld_op?: string | null;
          bron?: string;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          deleted_at?: string | null;
          door_paaltje?: boolean;
          gemaakt_door?: string | null;
          id?: string;
          klant_id?: string;
          omschrijving?: string;
          ontvangen_op?: string;
          status?: string;
        };
        Relationships: [];
      };
      geplande_mails: {
        Row: {
          aan_tekst: string;
          company_id: string;
          created_at: string;
          door: string | null;
          fout: string;
          id: string;
          inhoud: Json;
          mailbox_id: string;
          onderwerp: string;
          status: string;
          verstuurd_op: string | null;
          versturen_op: string;
        };
        Insert: {
          aan_tekst?: string;
          company_id?: string;
          created_at?: string;
          door?: string | null;
          fout?: string;
          id?: string;
          inhoud: Json;
          mailbox_id: string;
          onderwerp?: string;
          status?: string;
          verstuurd_op?: string | null;
          versturen_op: string;
        };
        Update: {
          aan_tekst?: string;
          company_id?: string;
          created_at?: string;
          door?: string | null;
          fout?: string;
          id?: string;
          inhoud?: Json;
          mailbox_id?: string;
          onderwerp?: string;
          status?: string;
          verstuurd_op?: string | null;
          versturen_op?: string;
        };
        Relationships: [];
      };
      klant_telefoons: {
        Row: {
          bron: string;
          company_id: string;
          created_at: string;
          id: string;
          klant_id: string;
          telefoon: string;
        };
        Insert: {
          bron?: string;
          company_id?: string;
          created_at?: string;
          id?: string;
          klant_id: string;
          telefoon: string;
        };
        Update: {
          bron?: string;
          company_id?: string;
          created_at?: string;
          id?: string;
          klant_id?: string;
          telefoon?: string;
        };
        Relationships: [];
      };
      wa_sjablonen: {
        Row: {
          afwijsreden: string;
          categorie: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          meta_id: string;
          meta_naam: string;
          status: string;
          tekst: string;
          titel: string;
          updated_at: string;
          variabelen: string[];
        };
        Insert: {
          afwijsreden?: string;
          categorie: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          meta_id?: string;
          meta_naam: string;
          status?: string;
          tekst: string;
          titel: string;
          updated_at?: string;
          variabelen?: string[];
        };
        Update: {
          afwijsreden?: string;
          categorie?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          meta_id?: string;
          meta_naam?: string;
          status?: string;
          tekst?: string;
          titel?: string;
          updated_at?: string;
          variabelen?: string[];
        };
        Relationships: [];
      };
      whatsapp_koppelingen: {
        Row: {
          aanbieder: string;
          company_id: string;
          created_at: string;
          fout: string;
          id: string;
          kapso_webhook_id: string;
          laatste_bericht_op: string | null;
          paaltje_vanaf: string;
          phone_number_id: string;
          soort: string;
          status: string;
          updated_at: string;
          waba_id: string;
          weergavenummer: string;
        };
        Insert: {
          aanbieder?: string;
          company_id?: string;
          created_at?: string;
          fout?: string;
          id?: string;
          kapso_webhook_id?: string;
          laatste_bericht_op?: string | null;
          paaltje_vanaf?: string;
          phone_number_id: string;
          soort?: string;
          status?: string;
          updated_at?: string;
          waba_id?: string;
          weergavenummer?: string;
        };
        Update: {
          aanbieder?: string;
          company_id?: string;
          created_at?: string;
          fout?: string;
          id?: string;
          kapso_webhook_id?: string;
          laatste_bericht_op?: string | null;
          paaltje_vanaf?: string;
          phone_number_id?: string;
          soort?: string;
          status?: string;
          updated_at?: string;
          waba_id?: string;
          weergavenummer?: string;
        };
        Relationships: [];
      };
      kapso_klanten: {
        Row: {
          company_id: string;
          created_at: string;
          customer_id: string;
        };
        Insert: {
          company_id: string;
          created_at?: string;
          customer_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          customer_id?: string;
        };
        Relationships: [];
      };
      klant_emails: {
        Row: {
          bron: string;
          company_id: string;
          created_at: string;
          email: string;
          id: string;
          klant_id: string;
        };
        Insert: {
          bron?: string;
          company_id?: string;
          created_at?: string;
          email: string;
          id?: string;
          klant_id: string;
        };
        Update: {
          bron?: string;
          company_id?: string;
          created_at?: string;
          email?: string;
          id?: string;
          klant_id?: string;
        };
        Relationships: [];
      };
      mail_regels: {
        Row: {
          actie: string;
          company_id: string;
          created_at: string;
          id: string;
          mailbox_id: string;
          van_email: string;
        };
        Insert: {
          actie?: string;
          company_id?: string;
          created_at?: string;
          id?: string;
          mailbox_id: string;
          van_email: string;
        };
        Update: {
          actie?: string;
          company_id?: string;
          created_at?: string;
          id?: string;
          mailbox_id?: string;
          van_email?: string;
        };
        Relationships: [];
      };
      paaltje_afspraken: {
        Row: {
          bron_bericht_id: string | null;
          categorie_id: string | null;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          status: string;
          tekst: string;
        };
        Insert: {
          bron_bericht_id?: string | null;
          categorie_id?: string | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          status?: string;
          tekst: string;
        };
        Update: {
          bron_bericht_id?: string | null;
          categorie_id?: string | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          status?: string;
          tekst?: string;
        };
        Relationships: [];
      };
      dagrapporten: {
        Row: {
          company_id: string;
          created_at: string;
          datum: string;
          gemaild_op: string | null;
          id: string;
          inhoud: Json;
          mail_fout: string;
          tot: string;
          vanaf: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          datum: string;
          gemaild_op?: string | null;
          id?: string;
          inhoud?: Json;
          mail_fout?: string;
          tot: string;
          vanaf: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          datum?: string;
          gemaild_op?: string | null;
          id?: string;
          inhoud?: Json;
          mail_fout?: string;
          tot?: string;
          vanaf?: string;
        };
        Relationships: [];
      };
      paaltje_berichten: {
        Row: {
          company_id: string;
          created_at: string;
          employee_id: string;
          id: string;
          rol: string;
          tekst: string;
          voorstel_id: string | null;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          employee_id: string;
          id?: string;
          rol: string;
          tekst?: string;
          voorstel_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          employee_id?: string;
          id?: string;
          rol?: string;
          tekst?: string;
          voorstel_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "paaltje_berichten_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paaltje_berichten_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paaltje_berichten_voorstel_fkey";
            columns: ["voorstel_id"];
            isOneToOne: false;
            referencedRelation: "paaltje_voorstellen";
            referencedColumns: ["id"];
          },
        ];
      };
      paaltje_voorstellen: {
        Row: {
          aangevraagd_door: string | null;
          aangepast_door_keurder: boolean;
          afgehandeld_door: string | null;
          afgehandeld_op: string | null;
          company_id: string;
          created_at: string;
          doorgevoerd: Json | null;
          gevraagd: Json;
          id: string;
          reden: string;
          samenvatting: string;
          status: string;
          teruggedraaid_door: string | null;
          teruggedraaid_op: string | null;
          updated_at: string;
        };
        Insert: {
          aangevraagd_door?: string | null;
          aangepast_door_keurder?: boolean;
          afgehandeld_door?: string | null;
          afgehandeld_op?: string | null;
          company_id?: string;
          created_at?: string;
          doorgevoerd?: Json | null;
          gevraagd?: Json;
          id?: string;
          reden?: string;
          samenvatting?: string;
          status?: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_op?: string | null;
          updated_at?: string;
        };
        Update: {
          aangevraagd_door?: string | null;
          aangepast_door_keurder?: boolean;
          afgehandeld_door?: string | null;
          afgehandeld_op?: string | null;
          company_id?: string;
          created_at?: string;
          doorgevoerd?: Json | null;
          gevraagd?: Json;
          id?: string;
          reden?: string;
          samenvatting?: string;
          status?: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_op?: string | null;
          updated_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "paaltje_voorstellen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paaltje_voorstellen_aangevraagd_door_fkey";
            columns: ["aangevraagd_door"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paaltje_voorstellen_afgehandeld_door_fkey";
            columns: ["afgehandeld_door"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "paaltje_voorstellen_teruggedraaid_door_fkey";
            columns: ["teruggedraaid_door"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      paaltje_verbruik: {
        Row: {
          berichten: number;
          company_id: string;
          dag: string;
          invoer_tokens: number;
          uitvoer_tokens: number;
        };
        Insert: {
          berichten?: number;
          company_id?: string;
          dag: string;
          invoer_tokens?: number;
          uitvoer_tokens?: number;
        };
        Update: {
          berichten?: number;
          company_id?: string;
          dag?: string;
          invoer_tokens?: number;
          uitvoer_tokens?: number;
        };
        Relationships: [
          {
            foreignKeyName: "paaltje_verbruik_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      gesprek_van: {
        Args: { bericht: string };
        Returns: {
          id: string;
          richting: string;
          van_naam: string;
          van_email: string;
          onderwerp: string;
          fragment: string;
          ontvangen_op: string;
          op_server: boolean;
        }[];
      };
      bericht_uit_dossier: {
        Args: { bericht: string; weg: boolean };
        Returns: undefined;
      };
      bericht_echt_wissen: {
        Args: { bericht: string };
        Returns: undefined;
      };
      paaltje_verbruik_tellen: {
        Args: { bedrijf: string; invoer: number; uitvoer: number; extra_bericht?: number };
        Returns: number;
      };
      duren_herberekenen: {
        Args: { tarief: number; ook_zelf?: boolean };
        Returns: Json;
      };
      duren_terugzetten: {
        Args: { kenmerk: string };
        Returns: number;
      };
      dag_ploegen_zetten: {
        Args: { dag: string; ploegen: Json };
        Returns: number;
      };
      dag_volgorde_zetten: {
        Args: { dag: string; blokken: Json };
        Returns: number;
      };
      aankondigingen_voor: {
        Args: { vanaf: string; tot: string };
        Returns: {
          customer_id: string;
          kanaal: string;
          soort: string;
          aangekondigd_voor: string;
          tijdvak_van: string | null;
          tijdvak_tot: string | null;
          status: string;
          bezorgstatus: string;
          verstuurd_op: string;
        }[];
      };
      wasdag_weghalen: {
        Args: { dag: string; adressen?: string[] };
        Returns: string | null;
      };
      wasdag_terugzetten: {
        Args: { kenmerk: string };
        Returns: number;
      };
      heeft_recht: {
        Args: { recht: string };
        Returns: boolean;
      };
      zet_adressen_inactief: {
        Args: { adressen: string[]; reden: string; planning_weg: boolean; voor_bedrijf?: string };
        Returns: Json;
      };
      zet_adressen_actief: {
        Args: { adressen: string[]; voor_bedrijf?: string };
        Returns: number;
      };
      stoppen_terugdraaien: {
        Args: { uitkomst: Json; voor_bedrijf?: string };
        Returns: number;
      };
      bekend_adres_overnemen: {
        Args: { aanmelding: string; met_vorige_klant: boolean };
        Returns: string;
      };
      aanmelding_terugdraaien: {
        Args: { aanmelding: string };
        Returns: undefined;
      };
      gebruiker_met_email: {
        Args: { adres: string };
        Returns: string | null;
      };
      openstaande_uitnodigingen: {
        Args: { bedrijf: string };
        Returns: {
          id: string;
          email: string;
          uitgenodigd_op: string | null;
          invited_at: string | null;
          created_at: string;
        }[];
      };
      zet_bericht_categorieen: {
        Args: { bericht: string; categorieen: string[] };
        Returns: undefined;
      };
      richtprijs: {
        Args: { straat: string };
        Returns: {
          aantal: number;
          bereik: string;
          prijs: number;
        }[];
      };
      mail_tellingen: {
        Args: never;
        Returns: {
          aantal: number;
          map_id: string;
        }[];
      };
      wa_toestemming_bestaande_klanten: {
        Args: never;
        Returns: { aantal: number; op: string }[];
      };
      wa_toestemming_bestaande_klanten_terug: {
        Args: { op: string };
        Returns: number;
      };
      wa_toestemming_telling: {
        Args: never;
        Returns: { zonder: number; met: number; afgemeld: number }[];
      };
      whatsapp_gesprekken: {
        Args: { ouder_dan?: string | null; aantal?: number };
        Returns: {
          wa_telefoon: string;
          laatste_op: string;
          fragment: string;
          richting: string;
          wa_status: string;
          naam: string;
          klant_id: string | null;
          ongelezen: number;
        }[];
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
