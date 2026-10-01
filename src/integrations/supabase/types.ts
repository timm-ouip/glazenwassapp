export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      aankondiging_adressen: {
        Row: {
          company_id: string;
          created_at: string;
          customer_id: string | null;
          datum: string;
          id: string;
          ontvanger_id: string;
          soort: string;
          tijdvak_tot: string | null;
          tijdvak_van: string | null;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          datum: string;
          id?: string;
          ontvanger_id: string;
          soort?: string;
          tijdvak_tot?: string | null;
          tijdvak_van?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          datum?: string;
          id?: string;
          ontvanger_id?: string;
          soort?: string;
          tijdvak_tot?: string | null;
          tijdvak_van?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "aankondiging_adressen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "aankondiging_adressen_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "aankondiging_adressen_ontvanger_id_fkey";
            columns: ["ontvanger_id"];
            isOneToOne: false;
            referencedRelation: "mail_ontvangers";
            referencedColumns: ["id"];
          },
        ];
      };
      aanmeldingen: {
        Row: {
          automatisch: Json | null;
          company_id: string;
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
          automatisch?: Json | null;
          company_id?: string;
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
          automatisch?: Json | null;
          company_id?: string;
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
        Relationships: [
          {
            foreignKeyName: "aanmeldingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "aanmeldingen_customer_id_fkey";
            columns: ["customer_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "aanmeldingen_klant_id_fkey";
            columns: ["klant_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id"];
          },
        ];
      };
      adres_klantwissels: {
        Row: {
          company_id: string;
          customer_id: string;
          gemaakt_op: string;
          id: string;
          naar_klant: string | null;
          tot: string;
          van_klant: string;
        };
        Insert: {
          company_id: string;
          customer_id: string;
          gemaakt_op?: string;
          id?: string;
          naar_klant?: string | null;
          tot: string;
          van_klant: string;
        };
        Update: {
          company_id?: string;
          customer_id?: string;
          gemaakt_op?: string;
          id?: string;
          naar_klant?: string | null;
          tot?: string;
          van_klant?: string;
        };
        Relationships: [
          {
            foreignKeyName: "adres_klantwissels_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adres_klantwissels_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      adres_prijzen: {
        Row: {
          company_id: string;
          customer_id: string;
          maandwerk_extra: Json;
          prijs: number;
        };
        Insert: {
          company_id?: string;
          customer_id: string;
          maandwerk_extra?: Json;
          prijs?: number;
        };
        Update: {
          company_id?: string;
          customer_id?: string;
          maandwerk_extra?: Json;
          prijs?: number;
        };
        Relationships: [
          {
            foreignKeyName: "adres_prijzen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "adres_prijzen_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: true;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "bericht_categorieen_bericht_id_company_id_fkey";
            columns: ["bericht_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "berichten";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "bericht_categorieen_categorie_id_company_id_fkey";
            columns: ["categorie_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "mail_categorieen";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "bericht_categorieen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      bericht_sjablonen: {
        Row: {
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          naam: string;
          onderwerp: string;
          soort: string;
          sort_order: number;
          standaard: boolean;
          tekst: string;
          updated_at: string;
          wa_sjabloon_id: string | null;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          naam: string;
          onderwerp?: string;
          soort: string;
          sort_order?: number;
          standaard?: boolean;
          tekst: string;
          updated_at?: string;
          wa_sjabloon_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          naam?: string;
          onderwerp?: string;
          soort?: string;
          sort_order?: number;
          standaard?: boolean;
          tekst?: string;
          updated_at?: string;
          wa_sjabloon_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "bericht_sjablonen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "bericht_sjablonen_wa_sjabloon_id_fkey";
            columns: ["wa_sjabloon_id"];
            isOneToOne: false;
            referencedRelation: "wa_sjablonen";
            referencedColumns: ["id"];
          },
        ];
      };
      berichten: {
        Row: {
          aan: Json;
          afgehandeld_door_paaltje: boolean;
          afgehandeld_op: string | null;
          afgekapt: boolean;
          afspraak_bekeken_op: string | null;
          ai_fout: string;
          antwoord_naar: string;
          beantwoord_op: string | null;
          bijlagen: Json;
          bron: string;
          cc: Json;
          company_id: string;
          concept: string;
          concept_paaltje: string;
          created_at: string;
          deleted_at: string | null;
          doorgevoerd_automatisch: boolean;
          doorgevoerd_op: string | null;
          fragment: string;
          gelezen: boolean;
          gelezen_door_paaltje_op: string | null;
          gemarkeerd: boolean;
          grootte: number;
          herinner_op: string | null;
          html: string;
          id: string;
          in_reply_to: string;
          indeling_door_mens: boolean;
          is_klantmail: boolean | null;
          kanaal: string;
          klant_gok_id: string | null;
          klant_id: string | null;
          klantgegevens: Json;
          mailbox_id: string | null;
          map_id: string | null;
          media: Json;
          message_id: string;
          onderwerp: string;
          ontvangen_op: string;
          op_server: boolean;
          paaltje_pogingen: number;
          paaltje_status: string;
          referenties: string[];
          richting: string;
          samenvatting: string;
          tekst: string;
          uid: number | null;
          uidvalidity: number | null;
          uit_dossier_op: string | null;
          van_email: string;
          van_naam: string;
          voorstel: Json;
          vorige_map_id: string | null;
          wa_antwoord_direct: boolean;
          wa_antwoord_op: string | null;
          wa_antwoord_reden: string;
          wa_antwoord_status: string;
          wa_id: string | null;
          wa_sleutel: string | null;
          wa_status: string;
          wa_telefoon: string;
          wa_type: string;
          weg_sinds: string | null;
          zekerheid: number | null;
        };
        Insert: {
          aan?: Json;
          afgehandeld_door_paaltje?: boolean;
          afgehandeld_op?: string | null;
          afgekapt?: boolean;
          afspraak_bekeken_op?: string | null;
          ai_fout?: string;
          antwoord_naar?: string;
          beantwoord_op?: string | null;
          bijlagen?: Json;
          bron?: string;
          cc?: Json;
          company_id?: string;
          concept?: string;
          concept_paaltje?: string;
          created_at?: string;
          deleted_at?: string | null;
          doorgevoerd_automatisch?: boolean;
          doorgevoerd_op?: string | null;
          fragment?: string;
          gelezen?: boolean;
          gelezen_door_paaltje_op?: string | null;
          gemarkeerd?: boolean;
          grootte?: number;
          herinner_op?: string | null;
          html?: string;
          id?: string;
          in_reply_to?: string;
          indeling_door_mens?: boolean;
          is_klantmail?: boolean | null;
          kanaal?: string;
          klant_gok_id?: string | null;
          klant_id?: string | null;
          klantgegevens?: Json;
          mailbox_id?: string | null;
          map_id?: string | null;
          media?: Json;
          message_id?: string;
          onderwerp?: string;
          ontvangen_op: string;
          op_server?: boolean;
          paaltje_pogingen?: number;
          paaltje_status?: string;
          referenties?: string[];
          richting?: string;
          samenvatting?: string;
          tekst?: string;
          uid?: number | null;
          uidvalidity?: number | null;
          uit_dossier_op?: string | null;
          van_email?: string;
          van_naam?: string;
          voorstel?: Json;
          vorige_map_id?: string | null;
          wa_antwoord_direct?: boolean;
          wa_antwoord_op?: string | null;
          wa_antwoord_reden?: string;
          wa_antwoord_status?: string;
          wa_id?: string | null;
          wa_sleutel?: string | null;
          wa_status?: string;
          wa_telefoon?: string;
          wa_type?: string;
          weg_sinds?: string | null;
          zekerheid?: number | null;
        };
        Update: {
          aan?: Json;
          afgehandeld_door_paaltje?: boolean;
          afgehandeld_op?: string | null;
          afgekapt?: boolean;
          afspraak_bekeken_op?: string | null;
          ai_fout?: string;
          antwoord_naar?: string;
          beantwoord_op?: string | null;
          bijlagen?: Json;
          bron?: string;
          cc?: Json;
          company_id?: string;
          concept?: string;
          concept_paaltje?: string;
          created_at?: string;
          deleted_at?: string | null;
          doorgevoerd_automatisch?: boolean;
          doorgevoerd_op?: string | null;
          fragment?: string;
          gelezen?: boolean;
          gelezen_door_paaltje_op?: string | null;
          gemarkeerd?: boolean;
          grootte?: number;
          herinner_op?: string | null;
          html?: string;
          id?: string;
          in_reply_to?: string;
          indeling_door_mens?: boolean;
          is_klantmail?: boolean | null;
          kanaal?: string;
          klant_gok_id?: string | null;
          klant_id?: string | null;
          klantgegevens?: Json;
          mailbox_id?: string | null;
          map_id?: string | null;
          media?: Json;
          message_id?: string;
          onderwerp?: string;
          ontvangen_op?: string;
          op_server?: boolean;
          paaltje_pogingen?: number;
          paaltje_status?: string;
          referenties?: string[];
          richting?: string;
          samenvatting?: string;
          tekst?: string;
          uid?: number | null;
          uidvalidity?: number | null;
          uit_dossier_op?: string | null;
          van_email?: string;
          van_naam?: string;
          voorstel?: Json;
          vorige_map_id?: string | null;
          wa_antwoord_direct?: boolean;
          wa_antwoord_op?: string | null;
          wa_antwoord_reden?: string;
          wa_antwoord_status?: string;
          wa_id?: string | null;
          wa_sleutel?: string | null;
          wa_status?: string;
          wa_telefoon?: string;
          wa_type?: string;
          weg_sinds?: string | null;
          zekerheid?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "berichten_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "berichten_klant_gok_fkey";
            columns: ["klant_gok_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "berichten_klant_id_fkey";
            columns: ["klant_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "berichten_mailbox_id_fkey";
            columns: ["mailbox_id"];
            isOneToOne: false;
            referencedRelation: "mailboxen";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "berichten_map_id_fkey";
            columns: ["map_id"];
            isOneToOne: false;
            referencedRelation: "mail_mappen";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "berichten_vorige_map_id_fkey";
            columns: ["vorige_map_id"];
            isOneToOne: false;
            referencedRelation: "mail_mappen";
            referencedColumns: ["id"];
          },
        ];
      };
      betaal_gebeurtenissen: {
        Row: {
          aantal: number | null;
          alle_beurten: boolean;
          adres: string;
          bedrag: number;
          botsing_met: string | null;
          bron: string;
          company_id: string;
          customer_id: string;
          door: string | null;
          door_naam: string;
          getoond_open: number | null;
          herroept_id: string | null;
          id: string;
          klant_id: string | null;
          maanden: string[] | null;
          ontvangen_op: string;
          op: string;
          peildatum: string | null;
          prijs_per_beurt: number | null;
          prijs_verwacht: number | null;
          reden: string;
          soort: string;
          vanaf: string | null;
          vaste_korting_id: string | null;
          vrijgave_id: string | null;
        };
        Insert: {
          aantal?: number | null;
          alle_beurten?: boolean;
          adres?: string;
          bedrag?: number;
          botsing_met?: string | null;
          bron?: string;
          company_id?: string;
          customer_id: string;
          door?: string | null;
          door_naam?: string;
          getoond_open?: number | null;
          herroept_id?: string | null;
          id?: string;
          klant_id?: string | null;
          maanden?: string[] | null;
          ontvangen_op?: string;
          op?: string;
          peildatum?: string | null;
          prijs_per_beurt?: number | null;
          prijs_verwacht?: number | null;
          reden?: string;
          soort: string;
          vanaf?: string | null;
          vaste_korting_id?: string | null;
          vrijgave_id?: string | null;
        };
        Update: {
          aantal?: number | null;
          alle_beurten?: boolean;
          adres?: string;
          bedrag?: number;
          botsing_met?: string | null;
          bron?: string;
          company_id?: string;
          customer_id?: string;
          door?: string | null;
          door_naam?: string;
          getoond_open?: number | null;
          herroept_id?: string | null;
          id?: string;
          klant_id?: string | null;
          maanden?: string[] | null;
          ontvangen_op?: string;
          op?: string;
          peildatum?: string | null;
          prijs_per_beurt?: number | null;
          prijs_verwacht?: number | null;
          reden?: string;
          soort?: string;
          vanaf?: string | null;
          vaste_korting_id?: string | null;
          vrijgave_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "betaal_gebeurtenissen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "betaal_gebeurtenissen_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "betaal_gebeurtenissen_herroept_id_fkey";
            columns: ["herroept_id"];
            isOneToOne: false;
            referencedRelation: "betaal_gebeurtenissen";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "betaal_gebeurtenissen_vrijgave_fkey";
            columns: ["vrijgave_id"];
            isOneToOne: false;
            referencedRelation: "geldloop_vrijgaven";
            referencedColumns: ["id"];
          },
        ];
      };
      companies: {
        Row: {
          aanmeld_aan: boolean;
          aanmeld_token: string;
          adres: string;
          btw: string;
          btw_procent: number;
          created_at: string;
          email: string;
          factuur_briefpapier_pad: string | null;
          factuur_eerste_nummer: number | null;
          factuur_eerste_nummer_jaar: number | null;
          factuur_eigen_kop: boolean;
          factuur_eigen_voet: boolean;
          factuur_kader_boven: number;
          factuur_kader_onder: number;
          factuur_kleur: string | null;
          factuur_koptekst: string | null;
          factuur_start_op: string | null;
          factuur_termijn_dagen: number;
          factuur_voettekst: string | null;
          geldloop_eindtijd: string;
          iban: string;
          id: string;
          kvk: string;
          mail_afzender_email: string;
          mail_afzender_naam: string;
          mail_schrijfstijl: string;
          mollie_modus: string | null;
          name: string;
          paaltje_daglimiet: number;
          plaats: string;
          plan_begin: string;
          plan_eind: string;
          plan_groot_pand_min: number;
          plan_pauze_min: number;
          plan_pauze_van: string;
          plan_rijtijd_min: number;
          plan_tarief_uur: number;
          plan_tijdlijn: boolean;
          plan_tijdvak_mailen: boolean;
          postcode: string;
          telefoon: string;
          wa_antwoord_tot: string;
          wa_antwoord_van: string;
          wa_wachttijd_min: number;
          werkdagen: number[];
        };
        Insert: {
          aanmeld_aan?: boolean;
          aanmeld_token?: string;
          adres?: string;
          btw?: string;
          btw_procent?: number;
          created_at?: string;
          email?: string;
          factuur_briefpapier_pad?: string | null;
          factuur_eerste_nummer?: number | null;
          factuur_eerste_nummer_jaar?: number | null;
          factuur_eigen_kop?: boolean;
          factuur_eigen_voet?: boolean;
          factuur_kader_boven?: number;
          factuur_kader_onder?: number;
          factuur_kleur?: string | null;
          factuur_koptekst?: string | null;
          factuur_start_op?: string | null;
          factuur_termijn_dagen?: number;
          factuur_voettekst?: string | null;
          geldloop_eindtijd?: string;
          iban?: string;
          id?: string;
          kvk?: string;
          mail_afzender_email?: string;
          mail_afzender_naam?: string;
          mail_schrijfstijl?: string;
          mollie_modus?: string | null;
          name: string;
          paaltje_daglimiet?: number;
          plaats?: string;
          plan_begin?: string;
          plan_eind?: string;
          plan_groot_pand_min?: number;
          plan_pauze_min?: number;
          plan_pauze_van?: string;
          plan_rijtijd_min?: number;
          plan_tarief_uur?: number;
          plan_tijdlijn?: boolean;
          plan_tijdvak_mailen?: boolean;
          postcode?: string;
          telefoon?: string;
          wa_antwoord_tot?: string;
          wa_antwoord_van?: string;
          wa_wachttijd_min?: number;
          werkdagen?: number[];
        };
        Update: {
          aanmeld_aan?: boolean;
          aanmeld_token?: string;
          adres?: string;
          btw?: string;
          btw_procent?: number;
          created_at?: string;
          email?: string;
          factuur_briefpapier_pad?: string | null;
          factuur_eerste_nummer?: number | null;
          factuur_eerste_nummer_jaar?: number | null;
          factuur_eigen_kop?: boolean;
          factuur_eigen_voet?: boolean;
          factuur_kader_boven?: number;
          factuur_kader_onder?: number;
          factuur_kleur?: string | null;
          factuur_koptekst?: string | null;
          factuur_start_op?: string | null;
          factuur_termijn_dagen?: number;
          factuur_voettekst?: string | null;
          geldloop_eindtijd?: string;
          iban?: string;
          id?: string;
          kvk?: string;
          mail_afzender_email?: string;
          mail_afzender_naam?: string;
          mail_schrijfstijl?: string;
          mollie_modus?: string | null;
          name?: string;
          paaltje_daglimiet?: number;
          plaats?: string;
          plan_begin?: string;
          plan_eind?: string;
          plan_groot_pand_min?: number;
          plan_pauze_min?: number;
          plan_pauze_van?: string;
          plan_rijtijd_min?: number;
          plan_tarief_uur?: number;
          plan_tijdlijn?: boolean;
          plan_tijdvak_mailen?: boolean;
          postcode?: string;
          telefoon?: string;
          wa_antwoord_tot?: string;
          wa_antwoord_van?: string;
          wa_wachttijd_min?: number;
          werkdagen?: number[];
        };
        Relationships: [];
      };
      contant_periodes: {
        Row: {
          company_id: string;
          customer_id: string;
          gemaakt_op: string;
          id: string;
          tot: string | null;
          vanaf: string;
        };
        Insert: {
          company_id?: string;
          customer_id: string;
          gemaakt_op?: string;
          id?: string;
          tot?: string | null;
          vanaf: string;
        };
        Update: {
          company_id?: string;
          customer_id?: string;
          gemaakt_op?: string;
          id?: string;
          tot?: string | null;
          vanaf?: string;
        };
        Relationships: [
          {
            foreignKeyName: "contant_periodes_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "contant_periodes_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      customers: {
        Row: {
          aangemeld_op: string | null;
          addition: string;
          betaalmethode: string | null;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          duur_min: number | null;
          duur_zelf: boolean;
          eigen_blok: boolean | null;
          frequency: string;
          geimporteerd: boolean;
          hoek_kant: string;
          hoek_straat: string;
          hoek_straat_volledig: string;
          house_number: number;
          id: string;
          inactief_op: string | null;
          inactief_reden: string | null;
          interval_maanden: number;
          klant_id: string | null;
          maandwerk: Json;
          markering: string;
          note: string;
          note_even: string;
          note_oneven: string;
          overslaan: string[];
          postcode: string;
          ritme: number;
          sort_order: number;
          start_maand: string;
          street_id: string;
          wissel_gepland_naam: string | null;
          wissel_gepland_op: string | null;
          wissel_naar: string | null;
          wissel_periode_tot: string | null;
          wissel_status: string | null;
          wissel_uitgevoerd_op: string | null;
          wissel_vorige: string | null;
        };
        Insert: {
          aangemeld_op?: string | null;
          addition?: string;
          betaalmethode?: string | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          duur_min?: number | null;
          duur_zelf?: boolean;
          eigen_blok?: boolean | null;
          frequency?: string;
          geimporteerd?: boolean;
          hoek_kant?: string;
          hoek_straat?: string;
          hoek_straat_volledig?: string;
          house_number: number;
          id?: string;
          inactief_op?: string | null;
          inactief_reden?: string | null;
          interval_maanden?: number;
          klant_id?: string | null;
          maandwerk?: Json;
          markering?: string;
          note?: string;
          note_even?: string;
          note_oneven?: string;
          overslaan?: string[];
          postcode?: string;
          ritme?: number;
          sort_order?: number;
          start_maand?: string;
          street_id: string;
          wissel_gepland_naam?: string | null;
          wissel_gepland_op?: string | null;
          wissel_naar?: string | null;
          wissel_periode_tot?: string | null;
          wissel_status?: string | null;
          wissel_uitgevoerd_op?: string | null;
          wissel_vorige?: string | null;
        };
        Update: {
          aangemeld_op?: string | null;
          addition?: string;
          betaalmethode?: string | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          duur_min?: number | null;
          duur_zelf?: boolean;
          eigen_blok?: boolean | null;
          frequency?: string;
          geimporteerd?: boolean;
          hoek_kant?: string;
          hoek_straat?: string;
          hoek_straat_volledig?: string;
          house_number?: number;
          id?: string;
          inactief_op?: string | null;
          inactief_reden?: string | null;
          interval_maanden?: number;
          klant_id?: string | null;
          maandwerk?: Json;
          markering?: string;
          note?: string;
          note_even?: string;
          note_oneven?: string;
          overslaan?: string[];
          postcode?: string;
          ritme?: number;
          sort_order?: number;
          start_maand?: string;
          street_id?: string;
          wissel_gepland_naam?: string | null;
          wissel_gepland_op?: string | null;
          wissel_naar?: string | null;
          wissel_periode_tot?: string | null;
          wissel_status?: string | null;
          wissel_uitgevoerd_op?: string | null;
          wissel_vorige?: string | null;
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
      dag_afmeldingen: {
        Row: {
          company_id: string;
          datum: string;
          door: string | null;
          door_naam: string;
          gedaan: number;
          heropend_door: string | null;
          heropend_naam: string | null;
          heropend_op: string | null;
          id: string;
          op: string;
          ploeg_nr: number | null;
          weg: number;
          weg_kenmerk: string | null;
        };
        Insert: {
          company_id?: string;
          datum: string;
          door?: string | null;
          door_naam?: string;
          gedaan?: number;
          heropend_door?: string | null;
          heropend_naam?: string | null;
          heropend_op?: string | null;
          id?: string;
          op?: string;
          ploeg_nr?: number | null;
          weg?: number;
          weg_kenmerk?: string | null;
        };
        Update: {
          company_id?: string;
          datum?: string;
          door?: string | null;
          door_naam?: string;
          gedaan?: number;
          heropend_door?: string | null;
          heropend_naam?: string | null;
          heropend_op?: string | null;
          id?: string;
          op?: string;
          ploeg_nr?: number | null;
          weg?: number;
          weg_kenmerk?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dag_afmeldingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
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
            foreignKeyName: "dag_ploeg_leden_company_id_datum_nr_fkey";
            columns: ["company_id", "datum", "nr"];
            isOneToOne: false;
            referencedRelation: "dag_ploegen";
            referencedColumns: ["company_id", "datum", "nr"];
          },
          {
            foreignKeyName: "dag_ploeg_leden_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "dag_ploeg_leden_teamlid_fkey";
            columns: ["company_id", "teamlid_id"];
            isOneToOne: false;
            referencedRelation: "teamleden";
            referencedColumns: ["company_id", "id"];
          },
        ];
      };
      dag_ploegen: {
        Row: {
          begin_tijd: string | null;
          company_id: string;
          created_at: string;
          datum: string;
          eind_tijd: string | null;
          nr: number;
          pauze_min: number | null;
          pauze_van: string | null;
        };
        Insert: {
          begin_tijd?: string | null;
          company_id?: string;
          created_at?: string;
          datum: string;
          eind_tijd?: string | null;
          nr: number;
          pauze_min?: number | null;
          pauze_van?: string | null;
        };
        Update: {
          begin_tijd?: string | null;
          company_id?: string;
          created_at?: string;
          datum?: string;
          eind_tijd?: string | null;
          nr?: number;
          pauze_min?: number | null;
          pauze_van?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "dag_ploegen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "dagrapporten_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      districts: {
        Row: {
          betaalmethode: string;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          geld_klaar_door: string | null;
          geld_klaar_op: string | null;
          geld_peildatum: string | null;
          id: string;
          name: string;
          plaats: string;
          sort_order: number;
          updated_at: string;
        };
        Insert: {
          betaalmethode?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          geld_klaar_door?: string | null;
          geld_klaar_op?: string | null;
          geld_peildatum?: string | null;
          id?: string;
          name: string;
          plaats?: string;
          sort_order?: number;
          updated_at?: string;
        };
        Update: {
          betaalmethode?: string;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          geld_klaar_door?: string | null;
          geld_klaar_op?: string | null;
          geld_peildatum?: string | null;
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
      duur_herberekening: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          waarden: Json;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          waarden: Json;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          waarden?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "duur_herberekening_company_id_fkey";
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
          company_id?: string;
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
      facturen: {
        Row: {
          betaald_bedrag: number;
          betaald_op: string | null;
          company_id: string;
          created_at: string;
          crediteert_id: string | null;
          deleted_at: string | null;
          factuurdatum: string | null;
          gemaakt_door: string | null;
          herinnering_trap: number;
          id: string;
          jaar: number | null;
          klant_id: string;
          klantgegevens: Json | null;
          kenmerk: string;
          met_rust_tot: string | null;
          mollie_betaald: number;
          mollie_id: string | null;
          mollie_link: string | null;
          nummer: string | null;
          onderwerp: string;
          opmerking: string;
          pdf_pad: string | null;
          soort: string;
          status: string;
          termijn_dagen: number | null;
          verstuurd_naar: string;
          verstuurd_op: string | null;
          verstuurd_via: string | null;
          vervaldatum: string | null;
          volgnummer: number | null;
        };
        Insert: {
          betaald_bedrag?: number;
          betaald_op?: string | null;
          company_id?: string;
          created_at?: string;
          crediteert_id?: string | null;
          deleted_at?: string | null;
          factuurdatum?: string | null;
          gemaakt_door?: string | null;
          herinnering_trap?: number;
          id?: string;
          jaar?: number | null;
          klant_id: string;
          klantgegevens?: Json | null;
          kenmerk?: string;
          met_rust_tot?: string | null;
          mollie_betaald?: number;
          mollie_id?: string | null;
          mollie_link?: string | null;
          nummer?: string | null;
          onderwerp?: string;
          opmerking?: string;
          pdf_pad?: string | null;
          soort?: string;
          status?: string;
          termijn_dagen?: number | null;
          verstuurd_naar?: string;
          verstuurd_op?: string | null;
          verstuurd_via?: string | null;
          vervaldatum?: string | null;
          volgnummer?: number | null;
        };
        Update: {
          betaald_bedrag?: number;
          betaald_op?: string | null;
          company_id?: string;
          created_at?: string;
          crediteert_id?: string | null;
          deleted_at?: string | null;
          factuurdatum?: string | null;
          gemaakt_door?: string | null;
          herinnering_trap?: number;
          id?: string;
          jaar?: number | null;
          klant_id?: string;
          klantgegevens?: Json | null;
          kenmerk?: string;
          met_rust_tot?: string | null;
          mollie_betaald?: number;
          mollie_id?: string | null;
          mollie_link?: string | null;
          nummer?: string | null;
          onderwerp?: string;
          opmerking?: string;
          pdf_pad?: string | null;
          soort?: string;
          status?: string;
          termijn_dagen?: number | null;
          verstuurd_naar?: string;
          verstuurd_op?: string | null;
          verstuurd_via?: string | null;
          vervaldatum?: string | null;
          volgnummer?: number | null;
        };
        Relationships: [
          {
            foreignKeyName: "facturen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facturen_crediteert_id_fkey";
            columns: ["crediteert_id"];
            isOneToOne: false;
            referencedRelation: "facturen";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "facturen_klant_id_company_id_fkey";
            columns: ["klant_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "facturen_klant_id_fkey";
            columns: ["klant_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id"];
          },
        ];
      };
      factuur_herinneringen: {
        Row: {
          aan: boolean;
          company_id: string;
          created_at: string;
          id: string;
          na_dagen: number;
          onderwerp: string;
          tekst: string;
          volgnummer: number;
        };
        Insert: {
          aan?: boolean;
          company_id?: string;
          created_at?: string;
          id?: string;
          na_dagen: number;
          onderwerp: string;
          tekst: string;
          volgnummer: number;
        };
        Update: {
          aan?: boolean;
          company_id?: string;
          created_at?: string;
          id?: string;
          na_dagen?: number;
          onderwerp?: string;
          tekst?: string;
          volgnummer?: number;
        };
        Relationships: [
          {
            foreignKeyName: "factuur_herinneringen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      factuur_tellers: {
        Row: {
          company_id: string;
          jaar: number;
          laatste: number;
        };
        Insert: {
          company_id?: string;
          jaar: number;
          laatste?: number;
        };
        Update: {
          company_id?: string;
          jaar?: number;
          laatste?: number;
        };
        Relationships: [
          {
            foreignKeyName: "factuur_tellers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      factuurregels: {
        Row: {
          aantal: number;
          bedrag: number;
          bedrag_excl: number;
          bedrag_incl: number | null;
          bedrag_met_de_hand: boolean;
          btw_bedrag: number | null;
          btw_inclusief: boolean;
          btw_procent: number;
          company_id: string;
          created_at: string;
          customer_id: string | null;
          datum: string;
          deleted_at: string | null;
          eenheid: string;
          factuur_id: string | null;
          id: string;
          klant_id: string;
          klus_id: string | null;
          notitie: string;
          omschrijving: string;
          soort: string;
          stukprijs: number | null;
          vervangen_op: string | null;
          wasdag_regel_id: string | null;
        };
        Insert: {
          aantal?: number;
          bedrag: number;
          bedrag_excl: number;
          bedrag_incl?: number | null;
          bedrag_met_de_hand?: boolean;
          btw_bedrag?: number | null;
          btw_inclusief: boolean;
          btw_procent: number;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          datum: string;
          deleted_at?: string | null;
          eenheid?: string;
          factuur_id?: string | null;
          id?: string;
          klant_id: string;
          klus_id?: string | null;
          notitie?: string;
          omschrijving?: string;
          soort: string;
          stukprijs?: number | null;
          vervangen_op?: string | null;
          wasdag_regel_id?: string | null;
        };
        Update: {
          aantal?: number;
          bedrag?: number;
          bedrag_excl?: number;
          bedrag_incl?: number | null;
          bedrag_met_de_hand?: boolean;
          btw_bedrag?: number | null;
          btw_inclusief?: boolean;
          btw_procent?: number;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          datum?: string;
          deleted_at?: string | null;
          eenheid?: string;
          factuur_id?: string | null;
          id?: string;
          klant_id?: string;
          klus_id?: string | null;
          notitie?: string;
          omschrijving?: string;
          soort?: string;
          stukprijs?: number | null;
          vervangen_op?: string | null;
          wasdag_regel_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "factuurregels_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "factuurregels_factuur_fk";
            columns: ["factuur_id"];
            isOneToOne: false;
            referencedRelation: "facturen";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "factuurregels_klant_id_company_id_fkey";
            columns: ["klant_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "factuurregels_klant_id_fkey";
            columns: ["klant_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id"];
          },
        ];
      };
      geldloop_straat_lopers: {
        Row: {
          company_id: string;
          employee_id: string;
          street_id: string;
          vrijgave_id: string;
        };
        Insert: {
          company_id?: string;
          employee_id: string;
          street_id: string;
          vrijgave_id: string;
        };
        Update: {
          company_id?: string;
          employee_id?: string;
          street_id?: string;
          vrijgave_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "geldloop_straat_lopers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_straat_lopers_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_straat_lopers_street_id_fkey";
            columns: ["street_id"];
            isOneToOne: false;
            referencedRelation: "streets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_straat_lopers_vrijgave_id_company_id_fkey";
            columns: ["vrijgave_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "geldloop_vrijgaven";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      geldloop_straat_wijzigingen: {
        Row: {
          company_id: string;
          door: string | null;
          door_naam: string;
          id: string;
          na: string[];
          na_naam: string;
          op: string;
          straat: string;
          street_id: string;
          teruggedraaid_door: string | null;
          teruggedraaid_naam: string | null;
          teruggedraaid_op: string | null;
          voor: string[];
          voor_naam: string;
          vrijgave_id: string;
        };
        Insert: {
          company_id?: string;
          door?: string | null;
          door_naam?: string;
          id?: string;
          na?: string[];
          na_naam?: string;
          op?: string;
          straat?: string;
          street_id: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_naam?: string | null;
          teruggedraaid_op?: string | null;
          voor?: string[];
          voor_naam?: string;
          vrijgave_id: string;
        };
        Update: {
          company_id?: string;
          door?: string | null;
          door_naam?: string;
          id?: string;
          na?: string[];
          na_naam?: string;
          op?: string;
          straat?: string;
          street_id?: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_naam?: string | null;
          teruggedraaid_op?: string | null;
          voor?: string[];
          voor_naam?: string;
          vrijgave_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "geldloop_straat_wijzigingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_straat_wijzigingen_street_id_fkey";
            columns: ["street_id"];
            isOneToOne: false;
            referencedRelation: "streets";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_straat_wijzigingen_vrijgave_id_company_id_fkey";
            columns: ["vrijgave_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "geldloop_vrijgaven";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      geldloop_vrijgave_lopers: {
        Row: {
          company_id: string;
          employee_id: string;
          vrijgave_id: string;
        };
        Insert: {
          company_id?: string;
          employee_id: string;
          vrijgave_id: string;
        };
        Update: {
          company_id?: string;
          employee_id?: string;
          vrijgave_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "geldloop_vrijgave_lopers_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_vrijgave_lopers_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_vrijgave_lopers_vrijgave_id_company_id_fkey";
            columns: ["vrijgave_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "geldloop_vrijgaven";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      geldloop_vrijgave_wijken: {
        Row: {
          company_id: string;
          district_id: string;
          vrijgave_id: string;
        };
        Insert: {
          company_id?: string;
          district_id: string;
          vrijgave_id: string;
        };
        Update: {
          company_id?: string;
          district_id?: string;
          vrijgave_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "geldloop_vrijgave_wijken_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_vrijgave_wijken_district_id_fkey";
            columns: ["district_id"];
            isOneToOne: false;
            referencedRelation: "districts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_vrijgave_wijken_vrijgave_id_company_id_fkey";
            columns: ["vrijgave_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "geldloop_vrijgaven";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      geldloop_vrijgaven: {
        Row: {
          begin_op: string;
          company_id: string;
          datum: string;
          eind_op: string;
          id: string;
          ingetrokken_door: string | null;
          ingetrokken_op: string | null;
          vrijgegeven_door: string | null;
          vrijgegeven_naam: string;
          vrijgegeven_op: string;
        };
        Insert: {
          begin_op: string;
          company_id?: string;
          datum: string;
          eind_op: string;
          id?: string;
          ingetrokken_door?: string | null;
          ingetrokken_op?: string | null;
          vrijgegeven_door?: string | null;
          vrijgegeven_naam?: string;
          vrijgegeven_op?: string;
        };
        Update: {
          begin_op?: string;
          company_id?: string;
          datum?: string;
          eind_op?: string;
          id?: string;
          ingetrokken_door?: string | null;
          ingetrokken_op?: string | null;
          vrijgegeven_door?: string | null;
          vrijgegeven_naam?: string;
          vrijgegeven_op?: string;
        };
        Relationships: [
          {
            foreignKeyName: "geldloop_vrijgaven_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      geldloop_wijzigingen: {
        Row: {
          adres: string;
          company_id: string;
          customer_id: string;
          door: string | null;
          door_naam: string;
          id: string;
          na: Json;
          op: string;
          soort: string;
          teruggedraaid_door: string | null;
          teruggedraaid_naam: string | null;
          teruggedraaid_op: string | null;
          voor: Json;
          vrijgave_id: string | null;
        };
        Insert: {
          adres?: string;
          company_id?: string;
          customer_id: string;
          door?: string | null;
          door_naam?: string;
          id?: string;
          na?: Json;
          op?: string;
          soort: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_naam?: string | null;
          teruggedraaid_op?: string | null;
          voor?: Json;
          vrijgave_id?: string | null;
        };
        Update: {
          adres?: string;
          company_id?: string;
          customer_id?: string;
          door?: string | null;
          door_naam?: string;
          id?: string;
          na?: Json;
          op?: string;
          soort?: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_naam?: string | null;
          teruggedraaid_op?: string | null;
          voor?: Json;
          vrijgave_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "geldloop_wijzigingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geldloop_wijzigingen_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "geldloop_wijzigingen_vrijgave_id_fkey";
            columns: ["vrijgave_id"];
            isOneToOne: false;
            referencedRelation: "geldloop_vrijgaven";
            referencedColumns: ["id"];
          },
        ];
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
          versturen_op: string;
          verstuurd_op: string | null;
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
          versturen_op: string;
          verstuurd_op?: string | null;
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
          versturen_op?: string;
          verstuurd_op?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "geplande_mails_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "geplande_mails_mailbox_id_fkey";
            columns: ["mailbox_id"];
            isOneToOne: false;
            referencedRelation: "mailboxen";
            referencedColumns: ["id"];
          },
        ];
      };
      kapso_klanten: {
        Row: {
          company_id: string;
          created_at: string;
          customer_id: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          customer_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          customer_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "kapso_klanten_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "klacht_berichten_bericht_id_company_id_fkey";
            columns: ["bericht_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "berichten";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "klacht_berichten_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "klacht_berichten_klacht_id_company_id_fkey";
            columns: ["klacht_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "klachten";
            referencedColumns: ["id", "company_id"];
          },
        ];
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
          klant_id: string | null;
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
          klant_id?: string | null;
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
          klant_id?: string | null;
          omschrijving?: string;
          ontvangen_op?: string;
          status?: string;
        };
        Relationships: [
          {
            foreignKeyName: "klachten_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "klachten_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "klachten_klant_id_company_id_fkey";
            columns: ["klant_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id", "company_id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "klant_emails_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "klant_emails_klant_id_company_id_fkey";
            columns: ["klant_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id", "company_id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "klant_telefoons_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "klant_telefoons_klant_id_company_id_fkey";
            columns: ["klant_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      klanten: {
        Row: {
          bedrijfsnaam: string;
          betalingstermijn_dagen: number | null;
          btw_inclusief: boolean | null;
          btw_nummer: string;
          btw_procent: number | null;
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          email: string;
          email2: string;
          factuur_email: string;
          factuur_huisnummer: string;
          factuur_omschrijving: string;
          factuur_per: string;
          factuur_plaats: string;
          factuur_postcode: string;
          factuur_straat: string;
          huisnummer: string;
          id: string;
          kanaal_voorkeur: string;
          klanttype: string;
          kvk: string;
          naam: string;
          notitie: string;
          plaats: string;
          postcode: string;
          straat: string;
          telefoon: string;
          telefoon2: string;
          updated_at: string;
          wa_afgemeld_op: string | null;
          wa_marketing_op: string | null;
          wa_toestemming_bron: string;
          wa_toestemming_op: string | null;
          website: string;
        };
        Insert: {
          bedrijfsnaam?: string;
          betalingstermijn_dagen?: number | null;
          btw_inclusief?: boolean | null;
          btw_nummer?: string;
          btw_procent?: number | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          email?: string;
          email2?: string;
          factuur_email?: string;
          factuur_huisnummer?: string;
          factuur_omschrijving?: string;
          factuur_per?: string;
          factuur_plaats?: string;
          factuur_postcode?: string;
          factuur_straat?: string;
          huisnummer?: string;
          id?: string;
          kanaal_voorkeur?: string;
          klanttype?: string;
          kvk?: string;
          naam: string;
          notitie?: string;
          plaats?: string;
          postcode?: string;
          straat?: string;
          telefoon?: string;
          telefoon2?: string;
          updated_at?: string;
          wa_afgemeld_op?: string | null;
          wa_marketing_op?: string | null;
          wa_toestemming_bron?: string;
          wa_toestemming_op?: string | null;
          website?: string;
        };
        Update: {
          bedrijfsnaam?: string;
          betalingstermijn_dagen?: number | null;
          btw_inclusief?: boolean | null;
          btw_nummer?: string;
          btw_procent?: number | null;
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          email?: string;
          email2?: string;
          factuur_email?: string;
          factuur_huisnummer?: string;
          factuur_omschrijving?: string;
          factuur_per?: string;
          factuur_plaats?: string;
          factuur_postcode?: string;
          factuur_straat?: string;
          huisnummer?: string;
          id?: string;
          kanaal_voorkeur?: string;
          klanttype?: string;
          kvk?: string;
          naam?: string;
          notitie?: string;
          plaats?: string;
          postcode?: string;
          straat?: string;
          telefoon?: string;
          telefoon2?: string;
          updated_at?: string;
          wa_afgemeld_op?: string | null;
          wa_marketing_op?: string | null;
          wa_toestemming_bron?: string;
          wa_toestemming_op?: string | null;
          website?: string;
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
            foreignKeyName: "klus_prijzen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "klus_prijzen_klus_id_company_id_fkey";
            columns: ["klus_id", "company_id"];
            isOneToOne: true;
            referencedRelation: "klussen";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      klussen: {
        Row: {
          company_id: string;
          created_at: string;
          customer_id: string;
          deleted_at: string | null;
          duur_min: number | null;
          duur_zelf: boolean;
          gedaan_op: string | null;
          gepland_op: string | null;
          id: string;
          omschrijving: string;
          ploeg_nr: number | null;
          vaste_start: string | null;
          volgorde: number | null;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          customer_id: string;
          deleted_at?: string | null;
          duur_min?: number | null;
          duur_zelf?: boolean;
          gedaan_op?: string | null;
          gepland_op?: string | null;
          id?: string;
          omschrijving: string;
          ploeg_nr?: number | null;
          vaste_start?: string | null;
          volgorde?: number | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          customer_id?: string;
          deleted_at?: string | null;
          duur_min?: number | null;
          duur_zelf?: boolean;
          gedaan_op?: string | null;
          gepland_op?: string | null;
          id?: string;
          omschrijving?: string;
          ploeg_nr?: number | null;
          vaste_start?: string | null;
          volgorde?: number | null;
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
      mail_categorieen: {
        Row: {
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          id: string;
          naam: string;
          omschrijving: string;
          sleutel: string | null;
          volgorde: number;
          zelf_antwoorden_whatsapp: boolean;
          zelfstandigheid: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          naam: string;
          omschrijving?: string;
          sleutel?: string | null;
          volgorde?: number;
          zelf_antwoorden_whatsapp?: boolean;
          zelfstandigheid?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          naam?: string;
          omschrijving?: string;
          sleutel?: string | null;
          volgorde?: number;
          zelf_antwoorden_whatsapp?: boolean;
          zelfstandigheid?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mail_categorieen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
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
          company_id?: string;
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
        Relationships: [
          {
            foreignKeyName: "mail_mappen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mail_mappen_mailbox_id_fkey";
            columns: ["mailbox_id"];
            isOneToOne: false;
            referencedRelation: "mailboxen";
            referencedColumns: ["id"];
          },
        ];
      };
      mail_ontvangers: {
        Row: {
          adressen: string;
          bezorgstatus: string;
          company_id: string;
          created_at: string;
          email: string;
          fout: string;
          id: string;
          kanaal: string;
          klant_id: string | null;
          mailing_id: string;
          message_id: string;
          naam: string;
          status: string;
          status_op: string | null;
          telefoon: string;
          wa_id: string;
        };
        Insert: {
          adressen?: string;
          bezorgstatus?: string;
          company_id?: string;
          created_at?: string;
          email?: string;
          fout?: string;
          id?: string;
          kanaal?: string;
          klant_id?: string | null;
          mailing_id: string;
          message_id?: string;
          naam?: string;
          status?: string;
          status_op?: string | null;
          telefoon?: string;
          wa_id?: string;
        };
        Update: {
          adressen?: string;
          bezorgstatus?: string;
          company_id?: string;
          created_at?: string;
          email?: string;
          fout?: string;
          id?: string;
          kanaal?: string;
          klant_id?: string | null;
          mailing_id?: string;
          message_id?: string;
          naam?: string;
          status?: string;
          status_op?: string | null;
          telefoon?: string;
          wa_id?: string;
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
        Relationships: [
          {
            foreignKeyName: "mail_regels_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mail_regels_mailbox_id_fkey";
            columns: ["mailbox_id"];
            isOneToOne: false;
            referencedRelation: "mailboxen";
            referencedColumns: ["id"];
          },
        ];
      };
      mail_verzendpogingen: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          mailbox_id: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          mailbox_id: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          mailbox_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mail_verzendpogingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mail_verzendpogingen_mailbox_id_fkey";
            columns: ["mailbox_id"];
            isOneToOne: false;
            referencedRelation: "mailboxen";
            referencedColumns: ["id"];
          },
        ];
      };
      mail_wijzigingen: {
        Row: {
          adres: string;
          antwoord_id: string | null;
          automatisch: boolean;
          bericht_id: string | null;
          company_id: string;
          created_at: string;
          customer_id: string | null;
          details: Json;
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
          adres?: string;
          antwoord_id?: string | null;
          automatisch?: boolean;
          bericht_id?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          details?: Json;
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
          adres?: string;
          antwoord_id?: string | null;
          automatisch?: boolean;
          bericht_id?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          details?: Json;
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
            foreignKeyName: "mail_wijzigingen_bericht_fkey";
            columns: ["bericht_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "berichten";
            referencedColumns: ["id", "company_id"];
          },
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
          {
            foreignKeyName: "mail_wijzigingen_door_fkey";
            columns: ["door"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mail_wijzigingen_teruggedraaid_door_fkey";
            columns: ["teruggedraaid_door"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      mailbox_geheimen: {
        Row: {
          iv: string;
          mailbox_id: string;
          updated_at: string;
          versleuteld: string;
        };
        Insert: {
          iv: string;
          mailbox_id: string;
          updated_at?: string;
          versleuteld: string;
        };
        Update: {
          iv?: string;
          mailbox_id?: string;
          updated_at?: string;
          versleuteld?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mailbox_geheimen_mailbox_id_fkey";
            columns: ["mailbox_id"];
            isOneToOne: true;
            referencedRelation: "mailboxen";
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
        Relationships: [
          {
            foreignKeyName: "mailboxen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "mailboxen_gekoppeld_door_fkey";
            columns: ["gekoppeld_door"];
            isOneToOne: false;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      mailingen: {
        Row: {
          aantal: number;
          aantal_whatsapp: number;
          company_id: string;
          created_at: string;
          datum: string | null;
          id: string;
          kanaal: string;
          mislukt: number;
          onderwerp: string;
          sjabloon_id: string | null;
          soort: string;
          tekst: string;
          test: boolean;
          verzonden_door: string | null;
        };
        Insert: {
          aantal?: number;
          aantal_whatsapp?: number;
          company_id?: string;
          created_at?: string;
          datum?: string | null;
          id?: string;
          kanaal?: string;
          mislukt?: number;
          onderwerp: string;
          sjabloon_id?: string | null;
          soort?: string;
          tekst: string;
          test?: boolean;
          verzonden_door?: string | null;
        };
        Update: {
          aantal?: number;
          aantal_whatsapp?: number;
          company_id?: string;
          created_at?: string;
          datum?: string | null;
          id?: string;
          kanaal?: string;
          mislukt?: number;
          onderwerp?: string;
          sjabloon_id?: string | null;
          soort?: string;
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
            foreignKeyName: "mailingen_sjabloon_id_fkey";
            columns: ["sjabloon_id"];
            isOneToOne: false;
            referencedRelation: "wa_sjablonen";
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
      mollie_geheimen: {
        Row: {
          company_id: string;
          iv: string;
          updated_at: string;
          versleuteld: string;
        };
        Insert: {
          company_id?: string;
          iv: string;
          updated_at?: string;
          versleuteld: string;
        };
        Update: {
          company_id?: string;
          iv?: string;
          updated_at?: string;
          versleuteld?: string;
        };
        Relationships: [
          {
            foreignKeyName: "mollie_geheimen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "paaltje_afspraken_bron_bericht_id_company_id_fkey";
            columns: ["bron_bericht_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "berichten";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "paaltje_afspraken_categorie_id_company_id_fkey";
            columns: ["categorie_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "mail_categorieen";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "paaltje_afspraken_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
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
      paaltje_voorstellen: {
        Row: {
          aangepast_door_keurder: boolean;
          aangevraagd_door: string | null;
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
          aangepast_door_keurder?: boolean;
          aangevraagd_door?: string | null;
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
          aangepast_door_keurder?: boolean;
          aangevraagd_door?: string | null;
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
            foreignKeyName: "paaltje_voorstellen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
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
      snelle_redenen: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          sort_order: number;
          tekst: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          sort_order?: number;
          tekst: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          sort_order?: number;
          tekst?: string;
        };
        Relationships: [
          {
            foreignKeyName: "snelle_redenen_company_id_fkey";
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
          doorlopend: boolean;
          groep_id: string | null;
          id: string;
          kolom_start: boolean;
          name: string;
          print_col: number | null;
          print_row: number | null;
          sort_desc: boolean;
          sort_order: number;
          volledige_naam: string;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          district_id: string;
          doorlopend?: boolean;
          groep_id?: string | null;
          id?: string;
          kolom_start?: boolean;
          name: string;
          print_col?: number | null;
          print_row?: number | null;
          sort_desc?: boolean;
          sort_order?: number;
          volledige_naam?: string;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          district_id?: string;
          doorlopend?: boolean;
          groep_id?: string | null;
          id?: string;
          kolom_start?: boolean;
          name?: string;
          print_col?: number | null;
          print_row?: number | null;
          sort_desc?: boolean;
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
          company_id: string;
          created_at: string;
          deleted_at: string | null;
          employee_id: string | null;
          id: string;
          naam: string;
          uitgenodigd_user_id: string | null;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          employee_id?: string | null;
          id?: string;
          naam: string;
          uitgenodigd_user_id?: string | null;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          deleted_at?: string | null;
          employee_id?: string | null;
          id?: string;
          naam?: string;
          uitgenodigd_user_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "teamleden_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "teamleden_employee_id_fkey";
            columns: ["employee_id"];
            isOneToOne: true;
            referencedRelation: "employees";
            referencedColumns: ["id"];
          },
        ];
      };
      vaste_kortingen: {
        Row: {
          bedrag: number;
          company_id: string;
          customer_id: string;
          deleted_at: string | null;
          deleted_door: string | null;
          gemaakt_door: string | null;
          gemaakt_naam: string;
          gemaakt_op: string;
          id: string;
          naam: string;
        };
        Insert: {
          bedrag: number;
          company_id?: string;
          customer_id: string;
          deleted_at?: string | null;
          deleted_door?: string | null;
          gemaakt_door?: string | null;
          gemaakt_naam?: string;
          gemaakt_op?: string;
          id?: string;
          naam: string;
        };
        Update: {
          bedrag?: number;
          company_id?: string;
          customer_id?: string;
          deleted_at?: string | null;
          deleted_door?: string | null;
          gemaakt_door?: string | null;
          gemaakt_naam?: string;
          gemaakt_op?: string;
          id?: string;
          naam?: string;
        };
        Relationships: [
          {
            foreignKeyName: "vaste_kortingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "vaste_kortingen_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "wa_sjablonen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      wasdag_prijzen: {
        Row: {
          company_id: string;
          normaal: number | null;
          prijs: number;
          regel_id: string;
        };
        Insert: {
          company_id?: string;
          normaal?: number | null;
          prijs?: number;
          regel_id: string;
        };
        Update: {
          company_id?: string;
          normaal?: number | null;
          prijs?: number;
          regel_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "wasdag_prijzen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wasdag_prijzen_regel_id_company_id_fkey";
            columns: ["regel_id", "company_id"];
            isOneToOne: true;
            referencedRelation: "wasdag_regels";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
      wasdag_regels: {
        Row: {
          betaalmethode: string | null;
          company_id: string;
          created_at: string;
          customer_id: string | null;
          datum: string;
          gedaan_bewaard: Json | null;
          gedaan_door: string | null;
          gedaan_op: string | null;
          id: string;
          niet_gewassen_door: string | null;
          niet_gewassen_naam: string | null;
          niet_gewassen_op: string | null;
          notitie: string | null;
          notitie_op_factuur: boolean;
          ploeg_nr: number | null;
          rest: boolean;
          ronde: string;
          vaste_start: string | null;
          volgorde: number | null;
        };
        Insert: {
          betaalmethode?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          datum: string;
          gedaan_bewaard?: Json | null;
          gedaan_door?: string | null;
          gedaan_op?: string | null;
          id?: string;
          niet_gewassen_door?: string | null;
          niet_gewassen_naam?: string | null;
          niet_gewassen_op?: string | null;
          notitie?: string | null;
          notitie_op_factuur?: boolean;
          ploeg_nr?: number | null;
          rest?: boolean;
          ronde?: string;
          vaste_start?: string | null;
          volgorde?: number | null;
        };
        Update: {
          betaalmethode?: string | null;
          company_id?: string;
          created_at?: string;
          customer_id?: string | null;
          datum?: string;
          gedaan_bewaard?: Json | null;
          gedaan_door?: string | null;
          gedaan_op?: string | null;
          id?: string;
          niet_gewassen_door?: string | null;
          niet_gewassen_naam?: string | null;
          niet_gewassen_op?: string | null;
          notitie?: string | null;
          notitie_op_factuur?: boolean;
          ploeg_nr?: number | null;
          rest?: boolean;
          ronde?: string;
          vaste_start?: string | null;
          volgorde?: number | null;
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
      wasdag_weggehaald: {
        Row: {
          company_id: string;
          created_at: string;
          id: string;
          regels: Json;
        };
        Insert: {
          company_id?: string;
          created_at?: string;
          id?: string;
          regels: Json;
        };
        Update: {
          company_id?: string;
          created_at?: string;
          id?: string;
          regels?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "wasdag_weggehaald_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      whatsapp_geheimen: {
        Row: {
          iv: string;
          koppeling_id: string;
          updated_at: string;
          versleuteld: string;
        };
        Insert: {
          iv: string;
          koppeling_id: string;
          updated_at?: string;
          versleuteld: string;
        };
        Update: {
          iv?: string;
          koppeling_id?: string;
          updated_at?: string;
          versleuteld?: string;
        };
        Relationships: [
          {
            foreignKeyName: "whatsapp_geheimen_koppeling_id_fkey";
            columns: ["koppeling_id"];
            isOneToOne: true;
            referencedRelation: "whatsapp_koppelingen";
            referencedColumns: ["id"];
          },
        ];
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
        Relationships: [
          {
            foreignKeyName: "whatsapp_koppelingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: true;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
        ];
      };
      wijzigingen: {
        Row: {
          bron: string;
          company_id: string;
          customer_id: string | null;
          door: string | null;
          door_naam: string;
          herroept: string | null;
          id: string;
          klant_id: string | null;
          na: Json;
          op: string;
          rij_id: string;
          tabel: string;
          teruggedraaid_door: string | null;
          teruggedraaid_naam: string | null;
          teruggedraaid_op: string | null;
          veld: string;
          voor: Json;
        };
        Insert: {
          bron?: string;
          company_id: string;
          customer_id?: string | null;
          door?: string | null;
          door_naam?: string;
          herroept?: string | null;
          id?: string;
          klant_id?: string | null;
          na?: Json;
          op?: string;
          rij_id: string;
          tabel: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_naam?: string | null;
          teruggedraaid_op?: string | null;
          veld: string;
          voor?: Json;
        };
        Update: {
          bron?: string;
          company_id?: string;
          customer_id?: string | null;
          door?: string | null;
          door_naam?: string;
          herroept?: string | null;
          id?: string;
          klant_id?: string | null;
          na?: Json;
          op?: string;
          rij_id?: string;
          tabel?: string;
          teruggedraaid_door?: string | null;
          teruggedraaid_naam?: string | null;
          teruggedraaid_op?: string | null;
          veld?: string;
          voor?: Json;
        };
        Relationships: [
          {
            foreignKeyName: "wijzigingen_company_id_fkey";
            columns: ["company_id"];
            isOneToOne: false;
            referencedRelation: "companies";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "wijzigingen_customer_id_company_id_fkey";
            columns: ["customer_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "customers";
            referencedColumns: ["id", "company_id"];
          },
          {
            foreignKeyName: "wijzigingen_klant_id_company_id_fkey";
            columns: ["klant_id", "company_id"];
            isOneToOne: false;
            referencedRelation: "klanten";
            referencedColumns: ["id", "company_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      aankondigingen_voor: {
        Args: { tot: string; vanaf: string };
        Returns: {
          aangekondigd_voor: string;
          bezorgstatus: string;
          customer_id: string;
          kanaal: string;
          soort: string;
          status: string;
          tijdvak_tot: string;
          tijdvak_van: string;
          verstuurd_op: string;
        }[];
      };
      aanmelding_terugdraaien: {
        Args: { aanmelding: string };
        Returns: undefined;
      };
      adres_heeft_prijs: { Args: { adres: string }; Returns: boolean };
      bekend_adres_overnemen: {
        Args: { aanmelding: string; met_vorige_klant: boolean };
        Returns: string;
      };
      betaalwissel_ongedaan: { Args: { adres: string }; Returns: undefined };
      betaalwissels_bijwerken: {
        Args: { adressen: string[]; bedrijf: string };
        Returns: undefined;
      };
      bericht_echt_wissen: { Args: { bericht: string }; Returns: undefined };
      bericht_uit_dossier: {
        Args: { bericht: string; weg: boolean };
        Returns: undefined;
      };
      current_company_id: { Args: never; Returns: string };
      dag_afmelden: {
        Args: { dag: string; ploeg: number | null; weg?: string[] | null };
        Returns: Json;
      };
      dag_afmelden_terugdraaien: {
        Args: { afmelding: string };
        Returns: undefined;
      };
      dag_afmelding_mag_open: {
        Args: { a: Database["public"]["Tables"]["dag_afmeldingen"]["Row"] };
        Returns: boolean;
      };
      dag_afmeldstatus: { Args: { tot: string; vanaf: string }; Returns: Json };
      dag_geld_stand: { Args: { adres_id: string }; Returns: Json };
      dag_geld_toegang: { Args: { adres_id: string }; Returns: boolean };
      dag_heropenen: { Args: { dag: string; ploeg: number | null }; Returns: number };
      dag_ploegen_zetten: {
        Args: { dag: string; ploegen: Json };
        Returns: number;
      };
      dag_volgorde_zetten: {
        Args: { blokken: Json; dag: string };
        Returns: number;
      };
      duren_herberekenen: {
        Args: { ook_zelf?: boolean | null; tarief: number };
        Returns: Json;
      };
      duren_terugzetten: { Args: { kenmerk: string }; Returns: number };
      duur_uit_prijs: {
        Args: { prijs: number; tarief: number };
        Returns: number;
      };
      enige_klant_bij_email: {
        Args: { adres: string; bedrijf: string };
        Returns: string;
      };
      enige_klant_bij_telefoon: {
        Args: { bedrijf: string; nummer: string };
        Returns: string;
      };
      facturen_herinneringen_straks: { Args: never; Returns: Json };
      facturen_klaarzetten: { Args: { nu_ook?: boolean | null }; Returns: number };
      facturen_klaarzetten_voor: {
        Args: { bedrijf: string; nu_ook: boolean };
        Returns: number;
      };
      facturen_lijst: { Args: { tot?: string | null; vanaf?: string | null }; Returns: Json };
      facturen_maandconcepten: { Args: never; Returns: number };
      facturen_vangnet: {
        Args: never;
        Returns: {
          adres: string;
          customer_id: string;
          klant_id: string;
          naam: string;
          soort: string;
          wijk: string;
        }[];
      };
      factuur_adres_tekst: { Args: { adres: string }; Returns: string };
      factuur_betaald: {
        Args: { bedrag: number; factuur: string; op?: string | null };
        Returns: Json;
      };
      factuur_btw_inclusief: {
        Args: { k: Database["public"]["Tables"]["klanten"]["Row"] };
        Returns: boolean;
      };
      factuur_btw_procent: {
        Args: { k: Database["public"]["Tables"]["klanten"]["Row"] };
        Returns: number;
      };
      factuur_crediteren: {
        Args: { factuur: string; reden?: string | null };
        Returns: string;
      };
      factuur_excl: {
        Args: { bedrag: number; inclusief: boolean; procent: number };
        Returns: number;
      };
      factuur_herinnering_trap: {
        Args: { factuur: string; trap: number };
        Returns: undefined;
      };
      factuur_herinneringen_klaar: {
        Args: { bedrijf?: string | null; op: string };
        Returns: {
          company_id: string;
          dagen_open: number;
          factuur_id: string;
          klant: string;
          mail: string;
          nummer: string;
          onderwerp: string;
          open_bedrag: number;
          tekst: string;
          trap: number;
          vervaldatum: string;
        }[];
      };
      factuur_los_maken: {
        Args: { gegevens?: Json; klant: string; regels: Json };
        Returns: string;
      };
      factuur_mailadres: {
        Args: { k: Database["public"]["Tables"]["klanten"]["Row"] };
        Returns: string;
      };
      factuur_met_rust: {
        Args: { factuur: string; tot?: string | null };
        Returns: undefined;
      };
      factuur_mollie_betaald: {
        Args: { bij_mollie: number; factuur: string; op?: string | null };
        Returns: Json;
      };
      factuur_nummer_trekken: {
        Args: { bedrijf: string; voor_jaar: number };
        Returns: number;
      };
      factuur_opnieuw: {
        Args: { factuur: string; keuzes?: Json | null };
        Returns: number;
      };
      factuur_termijn: {
        Args: { k: Database["public"]["Tables"]["klanten"]["Row"] };
        Returns: number;
      };
      factuur_totalen: { Args: { factuur: string }; Returns: Json };
      factuur_vastzetten: { Args: { factuur: string }; Returns: Json };
      factuur_verstuurd: {
        Args: { factuur: string; naar: string; pdf?: string | null; via: string };
        Returns: undefined;
      };
      factuurregels_maken: { Args: { dag: string }; Returns: number };
      factuurregels_terug: { Args: { dag: string }; Returns: number };
      gebruiker_met_email: { Args: { adres: string }; Returns: string };
      geld_adres: { Args: { adres: string }; Returns: Json };
      geld_adres_tekst: { Args: { adres: string }; Returns: string };
      geld_avond: { Args: { datum: string }; Returns: Json };
      geld_beginstand_zetten: {
        Args: {
          aantal?: number | null;
          adres_id: string;
          bedrag: number;
          maanden?: string[] | null;
        };
        Returns: undefined;
      };
      geld_boeken: {
        Args: {
          aantal?: number | null;
          adres_id: string;
          bedrag?: number | null;
          bron?: string | null;
          getoond_open?: number | null;
          herroept?: string | null;
          id: string;
          op?: string | null;
          prijs_per_beurt?: number | null;
          reden?: string | null;
          soort: string;
          vaste_korting?: string | null;
        };
        Returns: Json;
      };
      geld_gebeurtenis_json: {
        Args: {
          g: Database["public"]["Tables"]["betaal_gebeurtenissen"]["Row"];
        };
        Returns: Json;
      };
      geld_kaart: { Args: { jaar: number; straat: string }; Returns: Json };
      geld_krediet: {
        Args: { adressen: string[]; bedrijf: string };
        Returns: {
          bedrag: number;
          customer_id: string;
          door_naam: string;
          id: string;
          op: string;
          soort: string;
        }[];
      };
      geld_mijn_naam: { Args: never; Returns: string };
      geld_niet_afgemeld: {
        Args: { bedrijf: string; wijken: string[] };
        Returns: Json;
      };
      geld_periode_bijwerken: {
        Args: { adres: string; start?: string | null };
        Returns: undefined;
      };
      geld_pof: { Args: { wijken?: string[] | null }; Returns: Json };
      geld_posten: {
        Args: { adressen: string[]; bedrijf: string };
        Returns: {
          aantal: number;
          bedrag: number;
          customer_id: string;
          datum: string;
          gedekt: number;
          omschrijving: string;
          ref: string;
          soort: string;
          volg: number;
          vooruit: number;
        }[];
      };
      geld_posten_betaald: {
        Args: { adressen: string[]; bedrijf: string };
        Returns: {
          aantal: number;
          bedrag: number;
          betaald_door: string;
          betaald_met: string;
          betaald_op: string;
          betaald_soort: string;
          customer_id: string;
          datum: string;
          gedekt: number;
          omschrijving: string;
          ref: string;
          soort: string;
          vooruit: number;
        }[];
      };
      geld_schuld: {
        Args: { adressen: string[]; bedrijf: string };
        Returns: {
          aantal: number;
          bedrag: number;
          customer_id: string;
          datum: string;
          omschrijving: string;
          ref: string;
          soort: string;
          volg: number;
        }[];
      };
      geld_stand: {
        Args: { adressen: string[]; bedrijf: string };
        Returns: {
          customer_id: string;
          delen: Json;
          open: number;
          open_wassen: number;
          vooruit_over: number;
          vooruit_vast: number;
          vooruit_waarde: number;
        }[];
      };
      geld_stand_wijk: { Args: { wijk: string }; Returns: Json };
      geld_vaste_korting: {
        Args: { adres: string; bedrag: number; naam: string };
        Returns: string;
      };
      geld_vaste_korting_weg: { Args: { korting: string }; Returns: undefined };
      geld_vooruit: {
        Args: { adressen: string[]; bedrijf: string };
        Returns: {
          aantal: number;
          bedrag: number;
          customer_id: string;
          datum: string;
          ref: string;
          soort: string;
          vooruit_id: string;
        }[];
      };
      geld_wijk_klaar: {
        Args: { klaar: boolean; wijk: string };
        Returns: undefined;
      };
      geld_wijk_starten: {
        Args: { peildatum: string; wijk: string };
        Returns: undefined;
      };
      geldloop_dossier: { Args: { adres_id: string }; Returns: Json };
      geldloop_dossier_bewaren: {
        Args: { adres_id: string; wijzigingen: Json };
        Returns: Json;
      };
      geldloop_dossier_toegang: { Args: { adres_id: string }; Returns: string };
      geldloop_eind_wijzigen: {
        Args: { eind: string; vrijgave: string };
        Returns: undefined;
      };
      geldloop_intrekken: { Args: { vrijgave: string }; Returns: undefined };
      geldloop_klacht: {
        Args: { adres: string; omschrijving: string };
        Returns: string;
      };
      geldloop_lijst: { Args: { vrijgave: string }; Returns: Json };
      geldloop_loopt_voor_mij: { Args: { vrijgave: string }; Returns: boolean };
      geldloop_lopers_naam: { Args: { lopers: string[] }; Returns: string };
      geldloop_mogelijke_lopers: { Args: never; Returns: Json };
      geldloop_niet_afgemeld: { Args: { wijken: string[] }; Returns: Json };
      geldloop_niet_gewassen: {
        Args: { adres_id: string; dag: string };
        Returns: undefined;
      };
      geldloop_stoppen: {
        Args: { adres_id: string; planning_weg: boolean; reden: string };
        Returns: Json;
      };
      geldloop_straat_verdelen: {
        Args: { lopers: string[]; straat: string; vrijgave: string };
        Returns: Json;
      };
      geldloop_straat_wijziging_terugdraaien: {
        Args: { wijziging: string };
        Returns: undefined;
      };
      geldloop_straat_wijzigingen_van: {
        Args: { datum: string };
        Returns: Json;
      };
      geldloop_straten_eerlijk: { Args: { vrijgave: string }; Returns: Json };
      geldloop_toegang: { Args: { adres: string }; Returns: boolean };
      geldloop_vergeten: { Args: { tot: string; vanaf: string }; Returns: Json };
      geldloop_vrijgave_voor: {
        Args: { adres: string; moment?: string | null };
        Returns: string;
      };
      geldloop_vrijgaven_vanaf: { Args: { vanaf: string }; Returns: Json };
      geldloop_vrijgeven: {
        Args: {
          datum: string;
          eind?: string | null;
          lopers: string[];
          wijken: string[];
        };
        Returns: Json;
      };
      geldloop_wijziging_terugdraaien: {
        Args: { wijziging: string };
        Returns: undefined;
      };
      geldloop_wijzigingen_van: {
        Args: { adres_id?: string | null; datum?: string | null };
        Returns: Json;
      };
      geplande_mails_oppakken: { Args: { maximaal: number }; Returns: string[] };
      geplande_mails_opruimen: { Args: never; Returns: undefined };
      gesprek_van: {
        Args: { bericht: string };
        Returns: {
          fragment: string;
          id: string;
          onderwerp: string;
          ontvangen_op: string;
          op_server: boolean;
          richting: string;
          van_email: string;
          van_naam: string;
        }[];
      };
      heeft_recht: { Args: { recht: string }; Returns: boolean };
      is_eigenaar: { Args: never; Returns: boolean };
      klant_van_bericht: {
        Args: {
          aan: Json;
          bedrijf: string;
          richting: string;
          van_email: string;
        };
        Returns: string;
      };
      klus_factuurregel_bijwerken: {
        Args: { kl_id: string };
        Returns: undefined;
      };
      lege_concepten_opruimen: { Args: { bedrijf: string }; Returns: undefined };
      maak_standaard_categorieen: {
        Args: { bedrijf: string };
        Returns: undefined;
      };
      maandwerk_extra_van: { Args: { werk: Json }; Returns: Json };
      maandwerk_kern: { Args: { werk: Json }; Returns: Json };
      maandwerk_met_ids: { Args: { werk: Json }; Returns: Json };
      mail_tellingen: {
        Args: never;
        Returns: {
          aantal: number;
          map_id: string;
        }[];
      };
      mailing_vastleggen: {
        Args: {
          bedrijf: string;
          binnen_seconden?: number | null;
          dag: string;
          door: string;
          is_test: boolean;
          kanaal_in: string;
          onderwerp_in: string;
          sjabloon: string;
          soort_in?: string | null;
          tekst_in: string;
        };
        Returns: string;
      };
      mijn_geldloop: { Args: never; Returns: Json };
      nieuw_aanmeld_token: { Args: never; Returns: string };
      openstaande_uitnodigingen: {
        Args: { bedrijf: string };
        Returns: {
          created_at: string;
          email: string;
          id: string;
          invited_at: string;
          uitgenodigd_op: string;
        }[];
      };
      paaltje_verbruik_tellen: {
        Args: {
          bedrijf: string;
          extra_bericht?: number | null;
          invoer: number;
          uitvoer: number;
        };
        Returns: number;
      };
      proefmail_vastleggen: {
        Args: {
          bedrijf: string;
          dag: string;
          door: string;
          onderwerp: string;
          tekst: string;
        };
        Returns: string;
      };
      richtprijs: {
        Args: { straat: string };
        Returns: {
          aantal: number;
          bereik: string;
          prijs: number;
        }[];
      };
      sessies_intrekken: { Args: { gebruiker: string }; Returns: undefined };
      standaard_herinneringen: { Args: { bedrijf: string }; Returns: undefined };
      standaard_sjablonen: { Args: { bedrijf: string }; Returns: undefined };
      stoppen_terugdraaien: {
        Args: { uitkomst: Json; voor_bedrijf?: string | null };
        Returns: number;
      };
      straten_volgorde: { Args: { ids: string[] }; Returns: number };
      telefoon_sleutel: { Args: { tekst: string }; Returns: string };
      vooruit_beurten_open: { Args: { adres: string }; Returns: number };
      vooruit_prijs: { Args: { adres: string }; Returns: number };
      vooruit_wissel_plannen: { Args: { adressen: string[] }; Returns: undefined };
      wa_toestemming_bestaande_klanten: {
        Args: never;
        Returns: {
          aantal: number;
          op: string;
        }[];
      };
      wa_toestemming_bestaande_klanten_terug: {
        Args: { op: string };
        Returns: number;
      };
      wa_toestemming_telling: {
        Args: never;
        Returns: {
          afgemeld: number;
          met: number;
          zonder: number;
        }[];
      };
      wasdag_terugzetten: { Args: { kenmerk: string }; Returns: number };
      wasdag_weghalen: {
        Args: { adressen?: string[] | null; dag: string };
        Returns: string;
      };
      whatsapp_gesprekken: {
        Args: { aantal?: number | null; ouder_dan?: string | null };
        Returns: {
          fragment: string;
          klant_id: string;
          laatste_op: string;
          naam: string;
          ongelezen: number;
          richting: string;
          wa_status: string;
          wa_telefoon: string;
        }[];
      };
      wijk_overmaken_telling: { Args: { wijk: string }; Returns: Json };
      wijzigingen_ongedaan: { Args: { ids: string[] }; Returns: number };
      zet_adressen_actief: {
        Args: { adressen: string[]; voor_bedrijf?: string | null };
        Returns: number;
      };
      zet_adressen_inactief: {
        Args: {
          adressen: string[];
          planning_weg: boolean;
          reden: string;
          voor_bedrijf?: string | null;
        };
        Returns: Json;
      };
      zet_bericht_categorieen: {
        Args: { bericht: string; categorieen: string[] };
        Returns: undefined;
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
