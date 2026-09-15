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
      aanmeldingen: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string | null
          deleted_at: string | null
          email: string
          huisnummer: string
          id: string
          ip: string
          klant_id: string | null
          naam: string
          plaats: string
          postcode: string
          soort: string
          status: string
          straat: string
          telefoon: string
          toevoeging: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          email?: string
          huisnummer?: string
          id?: string
          ip?: string
          klant_id?: string | null
          naam?: string
          plaats?: string
          postcode?: string
          soort: string
          status?: string
          straat?: string
          telefoon?: string
          toevoeging?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string | null
          deleted_at?: string | null
          email?: string
          huisnummer?: string
          id?: string
          ip?: string
          klant_id?: string | null
          naam?: string
          plaats?: string
          postcode?: string
          soort?: string
          status?: string
          straat?: string
          telefoon?: string
          toevoeging?: string
        }
        Relationships: []
      }
      companies: {
        Row: {
          aanmeld_aan: boolean
          aanmeld_token: string
          adres: string
          btw: string
          created_at: string
          email: string
          iban: string
          id: string
          kvk: string
          mail_afzender_email: string
          mail_afzender_naam: string
          mail_schrijfstijl: string
          name: string
          plaats: string
          postcode: string
          telefoon: string
          werkdagen: number[]
        }
        Insert: {
          aanmeld_aan?: boolean
          aanmeld_token?: string
          adres?: string
          btw?: string
          created_at?: string
          email?: string
          iban?: string
          id?: string
          kvk?: string
          mail_afzender_email?: string
          mail_afzender_naam?: string
          mail_schrijfstijl?: string
          name: string
          plaats?: string
          postcode?: string
          telefoon?: string
          werkdagen?: number[]
        }
        Update: {
          aanmeld_aan?: boolean
          aanmeld_token?: string
          adres?: string
          btw?: string
          created_at?: string
          email?: string
          iban?: string
          id?: string
          kvk?: string
          mail_afzender_email?: string
          mail_afzender_naam?: string
          mail_schrijfstijl?: string
          name?: string
          plaats?: string
          postcode?: string
          telefoon?: string
          werkdagen?: number[]
        }
        Relationships: []
      }
      customers: {
        Row: {
          inactief_op: string | null
          inactief_reden: string | null
          aangemeld_op: string | null
          addition: string
          company_id: string
          created_at: string
          deleted_at: string | null
          frequency: string
          geimporteerd: boolean
          house_number: number
          hoek_straat: string
          hoek_straat_volledig: string
          hoek_kant: string
          interval_maanden: number
          ritme: number
          maandwerk: Json
          id: string
          klant_id: string | null
          markering: string
          overslaan: string[]
          start_maand: string
          note: string
          note_even: string
          note_oneven: string
          postcode: string
          sort_order: number
          street_id: string
        }
        Insert: {
          inactief_op?: string | null
          inactief_reden?: string | null
          aangemeld_op?: string | null
          addition?: string
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          frequency?: string
          geimporteerd?: boolean
          house_number: number
          hoek_straat?: string
          hoek_straat_volledig?: string
          hoek_kant?: string
          interval_maanden?: number
          ritme?: number
          maandwerk?: Json
          id?: string
          klant_id?: string | null
          markering?: string
          overslaan?: string[]
          start_maand?: string
          note?: string
          note_even?: string
          note_oneven?: string
          postcode?: string
          sort_order?: number
          street_id: string
        }
        Update: {
          inactief_op?: string | null
          inactief_reden?: string | null
          aangemeld_op?: string | null
          addition?: string
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          frequency?: string
          geimporteerd?: boolean
          house_number?: number
          hoek_straat?: string
          hoek_straat_volledig?: string
          hoek_kant?: string
          interval_maanden?: number
          ritme?: number
          maandwerk?: Json
          id?: string
          klant_id?: string | null
          markering?: string
          overslaan?: string[]
          start_maand?: string
          note?: string
          note_even?: string
          note_oneven?: string
          postcode?: string
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
          rol_id: string | null
        }
        Insert: {
          company_id: string
          created_at?: string
          email: string
          id: string
          naam?: string
          rol?: string
          rol_id?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          email?: string
          id?: string
          naam?: string
          rol?: string
          rol_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "employees_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "employees_rol_fkey"
            columns: ["rol_id", "company_id"]
            isOneToOne: false
            referencedRelation: "rollen"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      adres_prijzen: {
        Row: {
          company_id: string
          customer_id: string
          prijs: number
          maandwerk_extra: Json
        }
        Insert: {
          company_id?: string
          customer_id: string
          prijs?: number
          maandwerk_extra?: Json
        }
        Update: {
          company_id?: string
          customer_id?: string
          prijs?: number
          maandwerk_extra?: Json
        }
        Relationships: [
          {
            foreignKeyName: "adres_prijzen_customer_id_company_id_fkey"
            columns: ["customer_id", "company_id"]
            isOneToOne: true
            referencedRelation: "customers"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      klus_prijzen: {
        Row: {
          company_id: string
          klus_id: string
          prijs: number
        }
        Insert: {
          company_id?: string
          klus_id: string
          prijs?: number
        }
        Update: {
          company_id?: string
          klus_id?: string
          prijs?: number
        }
        Relationships: [
          {
            foreignKeyName: "klus_prijzen_klus_id_company_id_fkey"
            columns: ["klus_id", "company_id"]
            isOneToOne: true
            referencedRelation: "klussen"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      wasdag_prijzen: {
        Row: {
          company_id: string
          regel_id: string
          prijs: number
        }
        Insert: {
          company_id?: string
          regel_id: string
          prijs?: number
        }
        Update: {
          company_id?: string
          regel_id?: string
          prijs?: number
        }
        Relationships: [
          {
            foreignKeyName: "wasdag_prijzen_regel_id_company_id_fkey"
            columns: ["regel_id", "company_id"]
            isOneToOne: true
            referencedRelation: "wasdag_regels"
            referencedColumns: ["id", "company_id"]
          },
        ]
      }
      rollen: {
        Row: {
          company_id: string
          created_at: string
          id: string
          naam: string
          rechten: string[]
        }
        Insert: {
          company_id?: string
          created_at?: string
          id?: string
          naam: string
          rechten?: string[]
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          naam?: string
          rechten?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "rollen_company_id_fkey"
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
      klussen: {
        Row: {
          company_id: string
          created_at: string
          customer_id: string
          deleted_at: string | null
          gedaan_op: string | null
          gepland_op: string | null
          id: string
          omschrijving: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          customer_id: string
          deleted_at?: string | null
          gedaan_op?: string | null
          gepland_op?: string | null
          id?: string
          omschrijving: string
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string
          deleted_at?: string | null
          gedaan_op?: string | null
          gepland_op?: string | null
          id?: string
          omschrijving?: string
        }
        Relationships: [
          {
            foreignKeyName: "klussen_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "klussen_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_ontvangers: {
        Row: {
          adressen: string
          company_id: string
          created_at: string
          email: string
          fout: string
          id: string
          klant_id: string | null
          mailing_id: string
          naam: string
          status: string
        }
        Insert: {
          adressen?: string
          company_id: string
          created_at?: string
          email: string
          fout?: string
          id?: string
          klant_id?: string | null
          mailing_id: string
          naam?: string
          status?: string
        }
        Update: {
          adressen?: string
          company_id?: string
          created_at?: string
          email?: string
          fout?: string
          id?: string
          klant_id?: string | null
          mailing_id?: string
          naam?: string
          status?: string
        }
        Relationships: [
          {
            foreignKeyName: "mail_ontvangers_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_ontvangers_klant_id_fkey"
            columns: ["klant_id"]
            isOneToOne: false
            referencedRelation: "klanten"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_ontvangers_mailing_id_fkey"
            columns: ["mailing_id"]
            isOneToOne: false
            referencedRelation: "mailingen"
            referencedColumns: ["id"]
          },
        ]
      }
      mail_wijzigingen: {
        Row: {
          bericht_id: string | null
          details: Json
          adres: string
          antwoord_id: string | null
          automatisch: boolean
          company_id: string
          created_at: string
          customer_id: string | null
          door: string | null
          id: string
          klant: string
          maanden: string[]
          na_overslaan: string[]
          na_start_maand: string
          soort: string
          teruggedraaid_door: string | null
          teruggedraaid_op: string | null
          voor_overslaan: string[]
          voor_start_maand: string
          zekerheid: number | null
        }
        Insert: {
          bericht_id?: string | null
          details?: Json
          adres?: string
          antwoord_id?: string | null
          automatisch?: boolean
          company_id: string
          created_at?: string
          customer_id?: string | null
          door?: string | null
          id?: string
          klant?: string
          maanden?: string[]
          na_overslaan?: string[]
          na_start_maand?: string
          soort?: string
          teruggedraaid_door?: string | null
          teruggedraaid_op?: string | null
          voor_overslaan?: string[]
          voor_start_maand?: string
          zekerheid?: number | null
        }
        Update: {
          bericht_id?: string | null
          details?: Json
          adres?: string
          antwoord_id?: string | null
          automatisch?: boolean
          company_id?: string
          created_at?: string
          customer_id?: string | null
          door?: string | null
          id?: string
          klant?: string
          maanden?: string[]
          na_overslaan?: string[]
          na_start_maand?: string
          soort?: string
          teruggedraaid_door?: string | null
          teruggedraaid_op?: string | null
          voor_overslaan?: string[]
          voor_start_maand?: string
          zekerheid?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "mail_wijzigingen_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mail_wijzigingen_customer_id_fkey"
            columns: ["customer_id"]
            isOneToOne: false
            referencedRelation: "customers"
            referencedColumns: ["id"]
          },
        ]
      }
      mailingen: {
        Row: {
          aantal: number
          company_id: string
          created_at: string
          datum: string | null
          id: string
          mislukt: number
          onderwerp: string
          tekst: string
          test: boolean
          verzonden_door: string | null
        }
        Insert: {
          aantal?: number
          company_id: string
          created_at?: string
          datum?: string | null
          id?: string
          mislukt?: number
          onderwerp: string
          tekst: string
          test?: boolean
          verzonden_door?: string | null
        }
        Update: {
          aantal?: number
          company_id?: string
          created_at?: string
          datum?: string | null
          id?: string
          mislukt?: number
          onderwerp?: string
          tekst?: string
          test?: boolean
          verzonden_door?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "mailingen_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "mailingen_verzonden_door_fkey"
            columns: ["verzonden_door"]
            isOneToOne: false
            referencedRelation: "employees"
            referencedColumns: ["id"]
          },
        ]
      }
      markeringen: {
        Row: {
          company_id: string
          created_at: string
          id: string
          naam: string
          sleutel: string
          sort_order: number
          tint: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          id?: string
          naam: string
          sleutel: string
          sort_order?: number
          tint: string
        }
        Update: {
          company_id?: string
          created_at?: string
          id?: string
          naam?: string
          sleutel?: string
          sort_order?: number
          tint?: string
        }
        Relationships: [
          {
            foreignKeyName: "markeringen_company_id_fkey"
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
      straat_groepen: {
        Row: {
          company_id: string
          created_at: string
          district_id: string
          id: string
          naam: string
          sort_order: number
        }
        Insert: {
          company_id?: string
          created_at?: string
          district_id: string
          id?: string
          naam: string
          sort_order?: number
        }
        Update: {
          company_id?: string
          created_at?: string
          district_id?: string
          id?: string
          naam?: string
          sort_order?: number
        }
        Relationships: [
          {
            foreignKeyName: "straat_groepen_company_id_fkey"
            columns: ["company_id"]
            isOneToOne: false
            referencedRelation: "companies"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "straat_groepen_district_id_fkey"
            columns: ["district_id"]
            isOneToOne: false
            referencedRelation: "districts"
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
          groep_id: string | null
          id: string
          name: string
          print_col: number | null
          print_row: number | null
          sort_desc: boolean
          kolom_start: boolean
          doorlopend: boolean
          sort_order: number
          volledige_naam: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          district_id: string
          groep_id?: string | null
          id?: string
          name: string
          print_col?: number | null
          print_row?: number | null
          sort_desc?: boolean
          kolom_start?: boolean
          doorlopend?: boolean
          sort_order?: number
          volledige_naam?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          district_id?: string
          groep_id?: string | null
          id?: string
          name?: string
          print_col?: number | null
          print_row?: number | null
          sort_desc?: boolean
          kolom_start?: boolean
          doorlopend?: boolean
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
          {
            foreignKeyName: "streets_groep_id_fkey"
            columns: ["groep_id"]
            isOneToOne: false
            referencedRelation: "straat_groepen"
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
          notitie: string | null
        }
        Insert: {
          company_id?: string
          created_at?: string
          customer_id?: string | null
          datum: string
          id?: string
          notitie?: string | null
        }
        Update: {
          company_id?: string
          created_at?: string
          customer_id?: string | null
          datum?: string
          id?: string
          notitie?: string | null
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
      mailboxen: {
        Row: {
          adres: string
          bezig_tot: string | null
          company_id: string
          created_at: string
          fout: string
          gekoppeld_door: string | null
          id: string
          imap_host: string
          imap_poort: number
          import_vanaf: string
          laatste_poging: string | null
          laatste_sync: string | null
          paaltje_vanaf: string
          smtp_host: string
          smtp_poort: number
          status: string
        }
        Insert: {
          adres: string
          bezig_tot?: string | null
          company_id?: string
          created_at?: string
          fout?: string
          gekoppeld_door?: string | null
          id?: string
          imap_host?: string
          imap_poort?: number
          import_vanaf?: string
          laatste_poging?: string | null
          laatste_sync?: string | null
          paaltje_vanaf?: string
          smtp_host?: string
          smtp_poort?: number
          status?: string
        }
        Update: {
          adres?: string
          bezig_tot?: string | null
          company_id?: string
          created_at?: string
          fout?: string
          gekoppeld_door?: string | null
          id?: string
          imap_host?: string
          imap_poort?: number
          import_vanaf?: string
          laatste_poging?: string | null
          laatste_sync?: string | null
          paaltje_vanaf?: string
          smtp_host?: string
          smtp_poort?: number
          status?: string
        }
        Relationships: []
      }
      mail_mappen: {
        Row: {
          aantal: number
          bijgewerkt_op: string | null
          company_id: string
          id: string
          mailbox_id: string
          ongelezen: number
          pad: string
          rol: string
          uidvalidity: number | null
        }
        Insert: {
          aantal?: number
          bijgewerkt_op?: string | null
          company_id: string
          id?: string
          mailbox_id: string
          ongelezen?: number
          pad: string
          rol?: string
          uidvalidity?: number | null
        }
        Update: {
          aantal?: number
          bijgewerkt_op?: string | null
          company_id?: string
          id?: string
          mailbox_id?: string
          ongelezen?: number
          pad?: string
          rol?: string
          uidvalidity?: number | null
        }
        Relationships: []
      }
      berichten: {
        Row: {
          afgehandeld_door_paaltje: boolean
          afgehandeld_op: string | null
          indeling_door_mens: boolean
          ai_fout: string
          beantwoord_op: string | null
          concept: string
          concept_paaltje: string
          doorgevoerd_automatisch: boolean
          doorgevoerd_op: string | null
          gelezen_door_paaltje_op: string | null
          is_klantmail: boolean | null
          klant_gok_id: string | null
          samenvatting: string
          voorstel: Json
          zekerheid: number | null
          aan: Json
          afgekapt: boolean
          antwoord_naar: string
          bijlagen: Json
          cc: Json
          company_id: string
          created_at: string
          deleted_at: string | null
          fragment: string
          gelezen: boolean
          gemarkeerd: boolean
          grootte: number
          html: string
          id: string
          in_reply_to: string
          klant_id: string | null
          mailbox_id: string
          map_id: string
          message_id: string
          onderwerp: string
          ontvangen_op: string
          op_server: boolean
          paaltje_pogingen: number
          paaltje_status: string
          referenties: string[]
          richting: string
          tekst: string
          uid: number
          uidvalidity: number
          van_email: string
          van_naam: string
          vorige_map_id: string | null
          weg_sinds: string | null
        }
        Insert: {
          afgehandeld_door_paaltje?: boolean
          afgehandeld_op?: string | null
          indeling_door_mens?: boolean
          ai_fout?: string
          beantwoord_op?: string | null
          concept?: string
          concept_paaltje?: string
          doorgevoerd_automatisch?: boolean
          doorgevoerd_op?: string | null
          gelezen_door_paaltje_op?: string | null
          is_klantmail?: boolean | null
          klant_gok_id?: string | null
          samenvatting?: string
          voorstel?: Json
          zekerheid?: number | null
          aan?: Json
          afgekapt?: boolean
          antwoord_naar?: string
          bijlagen?: Json
          cc?: Json
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          fragment?: string
          gelezen?: boolean
          gemarkeerd?: boolean
          grootte?: number
          html?: string
          id?: string
          in_reply_to?: string
          klant_id?: string | null
          mailbox_id: string
          map_id: string
          message_id?: string
          onderwerp?: string
          ontvangen_op: string
          op_server?: boolean
          paaltje_pogingen?: number
          paaltje_status?: string
          referenties?: string[]
          richting?: string
          tekst?: string
          uid: number
          uidvalidity: number
          van_email?: string
          van_naam?: string
          vorige_map_id?: string | null
          weg_sinds?: string | null
        }
        Update: {
          afgehandeld_door_paaltje?: boolean
          afgehandeld_op?: string | null
          indeling_door_mens?: boolean
          ai_fout?: string
          beantwoord_op?: string | null
          concept?: string
          concept_paaltje?: string
          doorgevoerd_automatisch?: boolean
          doorgevoerd_op?: string | null
          gelezen_door_paaltje_op?: string | null
          is_klantmail?: boolean | null
          klant_gok_id?: string | null
          samenvatting?: string
          voorstel?: Json
          zekerheid?: number | null
          aan?: Json
          afgekapt?: boolean
          antwoord_naar?: string
          bijlagen?: Json
          cc?: Json
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          fragment?: string
          gelezen?: boolean
          gemarkeerd?: boolean
          grootte?: number
          html?: string
          id?: string
          in_reply_to?: string
          klant_id?: string | null
          mailbox_id?: string
          map_id?: string
          message_id?: string
          onderwerp?: string
          ontvangen_op?: string
          op_server?: boolean
          paaltje_pogingen?: number
          paaltje_status?: string
          referenties?: string[]
          richting?: string
          tekst?: string
          uid?: number
          uidvalidity?: number
          van_email?: string
          van_naam?: string
          vorige_map_id?: string | null
          weg_sinds?: string | null
        }
        Relationships: []
      }
      mail_categorieen: {
        Row: {
          company_id: string
          created_at: string
          deleted_at: string | null
          id: string
          naam: string
          omschrijving: string
          sleutel: string | null
          volgorde: number
          zelfstandigheid: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          naam: string
          omschrijving?: string
          sleutel?: string | null
          volgorde?: number
          zelfstandigheid?: string
        }
        Update: {
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          naam?: string
          omschrijving?: string
          sleutel?: string | null
          volgorde?: number
          zelfstandigheid?: string
        }
        Relationships: []
      }
      bericht_categorieen: {
        Row: {
          bericht_id: string
          categorie_id: string
          company_id: string
          created_at: string
          door: string
          zekerheid: number | null
        }
        Insert: {
          bericht_id: string
          categorie_id: string
          company_id?: string
          created_at?: string
          door?: string
          zekerheid?: number | null
        }
        Update: {
          bericht_id?: string
          categorie_id?: string
          company_id?: string
          created_at?: string
          door?: string
          zekerheid?: number | null
        }
        Relationships: []
      }
      klant_emails: {
        Row: {
          bron: string
          company_id: string
          created_at: string
          email: string
          id: string
          klant_id: string
        }
        Insert: {
          bron?: string
          company_id?: string
          created_at?: string
          email: string
          id?: string
          klant_id: string
        }
        Update: {
          bron?: string
          company_id?: string
          created_at?: string
          email?: string
          id?: string
          klant_id?: string
        }
        Relationships: []
      }
      paaltje_afspraken: {
        Row: {
          bron_bericht_id: string | null
          categorie_id: string | null
          company_id: string
          created_at: string
          deleted_at: string | null
          id: string
          status: string
          tekst: string
        }
        Insert: {
          bron_bericht_id?: string | null
          categorie_id?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          status?: string
          tekst: string
        }
        Update: {
          bron_bericht_id?: string | null
          categorie_id?: string | null
          company_id?: string
          created_at?: string
          deleted_at?: string | null
          id?: string
          status?: string
          tekst?: string
        }
        Relationships: []
      }
      dagrapporten: {
        Row: {
          company_id: string
          created_at: string
          datum: string
          gemaild_op: string | null
          id: string
          inhoud: Json
          mail_fout: string
          tot: string
          vanaf: string
        }
        Insert: {
          company_id?: string
          created_at?: string
          datum: string
          gemaild_op?: string | null
          id?: string
          inhoud?: Json
          mail_fout?: string
          tot: string
          vanaf: string
        }
        Update: {
          company_id?: string
          created_at?: string
          datum?: string
          gemaild_op?: string | null
          id?: string
          inhoud?: Json
          mail_fout?: string
          tot?: string
          vanaf?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      wasdag_weghalen: {
        Args: { dag: string; adressen?: string[] }
        Returns: string | null
      }
      wasdag_terugzetten: {
        Args: { kenmerk: string }
        Returns: number
      }
      heeft_recht: {
        Args: { recht: string }
        Returns: boolean
      }
      zet_adressen_inactief: {
        Args: { adressen: string[]; reden: string; planning_weg: boolean; voor_bedrijf?: string }
        Returns: Json
      }
      zet_adressen_actief: {
        Args: { adressen: string[]; voor_bedrijf?: string }
        Returns: number
      }
      stoppen_terugdraaien: {
        Args: { uitkomst: Json; voor_bedrijf?: string }
        Returns: number
      }
      bekend_adres_overnemen: {
        Args: { aanmelding: string; met_vorige_klant: boolean }
        Returns: string
      }
      zet_bericht_categorieen: {
        Args: { bericht: string; categorieen: string[] }
        Returns: undefined
      }
      richtprijs: {
        Args: { straat: string }
        Returns: {
          aantal: number
          bereik: string
          prijs: number
        }[]
      }
      mail_tellingen: {
        Args: never
        Returns: {
          aantal: number
          map_id: string
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
