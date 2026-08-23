export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      adjustments: {
        Row: {
          amount: number
          created_at: string
          created_by: string | null
          evidence_id: string | null
          id: string
          reason: string | null
          type: Database["public"]["Enums"]["adjustment_type"]
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          amount: number
          created_at?: string
          created_by?: string | null
          evidence_id?: string | null
          id?: string
          reason?: string | null
          type: Database["public"]["Enums"]["adjustment_type"]
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          amount?: number
          created_at?: string
          created_by?: string | null
          evidence_id?: string | null
          id?: string
          reason?: string | null
          type?: Database["public"]["Enums"]["adjustment_type"]
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      audit_log: {
        Row: { id: string; workspace_id: string | null; actor_id: string | null; action: string; entity: string; entity_id: string | null; detail: Json | null; created_at: string }
        Insert: { id?: string; workspace_id?: string | null; actor_id?: string | null; action: string; entity: string; entity_id?: string | null; detail?: Json | null; created_at?: string }
        Update: { id?: string; workspace_id?: string | null; actor_id?: string | null; action?: string; entity?: string; entity_id?: string | null; detail?: Json | null; created_at?: string }
        Relationships: []
      }
      push_subscriptions: {
        Row: { id: string; user_id: string; endpoint: string; p256dh: string; auth: string; created_at: string }
        Insert: { id?: string; user_id: string; endpoint: string; p256dh: string; auth: string; created_at?: string }
        Update: { id?: string; user_id?: string; endpoint?: string; p256dh?: string; auth?: string; created_at?: string }
        Relationships: []
      }
      car_inspection_photos: {
        Row: {
          created_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          inspection_id: string
          storage_path: string
          taken_at: string
          view: Database["public"]["Enums"]["inspection_view"]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          inspection_id: string
          storage_path: string
          taken_at?: string
          view: Database["public"]["Enums"]["inspection_view"]
          workspace_id: string
        }
        Update: {
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          inspection_id?: string
          storage_path?: string
          taken_at?: string
          view?: Database["public"]["Enums"]["inspection_view"]
          workspace_id?: string
        }
        Relationships: []
      }
      car_inspections: {
        Row: {
          car_id: string
          created_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          reason: Database["public"]["Enums"]["inspection_reason"]
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          reason: Database["public"]["Enums"]["inspection_reason"]
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          reason?: Database["public"]["Enums"]["inspection_reason"]
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      car_categories: {
        Row: { id: string; workspace_id: string; name: string; sort_order: number; crew_size: number; created_at: string }
        Insert: { id?: string; workspace_id: string; name: string; sort_order?: number; crew_size?: number; created_at?: string }
        Update: { id?: string; workspace_id?: string; name?: string; sort_order?: number; crew_size?: number; created_at?: string }
        Relationships: []
      }
      cars: {
        Row: {
          category_id: string | null
          active: boolean
          created_at: string
          id: string
          label: string | null
          plate: string
          qr_token: string
          workspace_id: string
        }
        Insert: {
          category_id?: string | null
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          plate: string
          qr_token?: string
          workspace_id: string
        }
        Update: {
          category_id?: string | null
          active?: boolean
          created_at?: string
          id?: string
          label?: string | null
          plate?: string
          qr_token?: string
          workspace_id?: string
        }
        Relationships: []
      }
      check_ins: {
        Row: {
          car_id: string
          checked_in_at: string
          checked_out_at: string | null
          created_at: string
          crew_key: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          out_gps_lat: number | null
          out_gps_lng: number | null
          outside_geofence: boolean
          out_outside_geofence: boolean
          prev_car_id: string | null
          switch_reason: string | null
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          crew_key?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          out_gps_lat?: number | null
          out_gps_lng?: number | null
          outside_geofence?: boolean
          out_outside_geofence?: boolean
          prev_car_id?: string | null
          switch_reason?: string | null
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          checked_in_at?: string
          checked_out_at?: string | null
          created_at?: string
          crew_key?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          out_gps_lat?: number | null
          out_gps_lng?: number | null
          outside_geofence?: boolean
          out_outside_geofence?: boolean
          prev_car_id?: string | null
          switch_reason?: string | null
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      car_issues: {
        Row: {
          car_id: string
          created_at: string
          id: string
          note: string
          photo_path: string | null
          resolved_at: string | null
          resolved_by: string | null
          status: Database["public"]["Enums"]["car_issue_status"]
          user_id: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          id?: string
          note: string
          photo_path?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["car_issue_status"]
          user_id: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          id?: string
          note?: string
          photo_path?: string | null
          resolved_at?: string | null
          resolved_by?: string | null
          status?: Database["public"]["Enums"]["car_issue_status"]
          user_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      swap_requests: {
        Row: {
          created_at: string
          decided_at: string | null
          decided_by: string | null
          id: string
          note: string | null
          partner_decided_at: string | null
          partner_decision: Database["public"]["Enums"]["swap_status"]
          partner_id: string | null
          requested_by: string
          shift_id: string
          status: Database["public"]["Enums"]["swap_status"]
          workspace_id: string
        }
        Insert: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          partner_decided_at?: string | null
          partner_decision?: Database["public"]["Enums"]["swap_status"]
          partner_id?: string | null
          requested_by: string
          shift_id: string
          status?: Database["public"]["Enums"]["swap_status"]
          workspace_id: string
        }
        Update: {
          created_at?: string
          decided_at?: string | null
          decided_by?: string | null
          id?: string
          note?: string | null
          partner_decided_at?: string | null
          partner_decision?: Database["public"]["Enums"]["swap_status"]
          partner_id?: string | null
          requested_by?: string
          shift_id?: string
          status?: Database["public"]["Enums"]["swap_status"]
          workspace_id?: string
        }
        Relationships: []
      }
      payroll_locks: {
        Row: { workspace_id: string; ym: string; locked_by: string | null; locked_at: string }
        Insert: { workspace_id: string; ym: string; locked_by?: string | null; locked_at?: string }
        Update: { workspace_id?: string; ym?: string; locked_by?: string | null; locked_at?: string }
        Relationships: []
      }
      photo_proofs: {
        Row: { id: string; workspace_id: string; storage_path: string; sha256: string; user_id: string | null; taken_at: string }
        Insert: { id?: string; workspace_id: string; storage_path: string; sha256: string; user_id?: string | null; taken_at?: string }
        Update: { id?: string; workspace_id?: string; storage_path?: string; sha256?: string; user_id?: string | null; taken_at?: string }
        Relationships: []
      }
      cleanings: {
        Row: {
          car_id: string
          created_at: string
          done: boolean
          gps_lat: number | null
          gps_lng: number | null
          id: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          done?: boolean
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          done?: boolean
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      evidence_photos: {
        Row: {
          car_id: string | null
          category: Database["public"]["Enums"]["evidence_category"]
          created_at: string
          created_by: string | null
          id: string
          note: string | null
          photo_path: string | null
          taken_at: string
          workspace_id: string
        }
        Insert: {
          car_id?: string | null
          category: Database["public"]["Enums"]["evidence_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          photo_path?: string | null
          taken_at?: string
          workspace_id: string
        }
        Update: {
          car_id?: string | null
          category?: Database["public"]["Enums"]["evidence_category"]
          created_at?: string
          created_by?: string | null
          id?: string
          note?: string | null
          photo_path?: string | null
          taken_at?: string
          workspace_id?: string
        }
        Relationships: []
      }
      fuel_logs: {
        Row: {
          amount: number | null
          car_id: string
          consumption: number | null
          created_at: string
          fuel_date: string | null
          gps_lat: number | null
          gps_lng: number | null
          id: string
          km_warning: boolean
          liters: number | null
          location: string | null
          ocr_amount: number | null
          ocr_date: string | null
          ocr_liters: number | null
          ocr_location: string | null
          odometer_km: number
          photo_path: string | null
          taken_at: string
          user_id: string
          verified: boolean
          work_date: string
          workspace_id: string
        }
        Insert: {
          amount?: number | null
          car_id: string
          consumption?: number | null
          created_at?: string
          fuel_date?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          km_warning?: boolean
          liters?: number | null
          location?: string | null
          ocr_amount?: number | null
          ocr_date?: string | null
          ocr_liters?: number | null
          ocr_location?: string | null
          odometer_km: number
          photo_path?: string | null
          taken_at?: string
          user_id: string
          verified?: boolean
          work_date: string
          workspace_id: string
        }
        Update: {
          amount?: number | null
          car_id?: string
          consumption?: number | null
          created_at?: string
          fuel_date?: string | null
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          km_warning?: boolean
          liters?: number | null
          location?: string | null
          ocr_amount?: number | null
          ocr_date?: string | null
          ocr_liters?: number | null
          ocr_location?: string | null
          odometer_km?: number
          photo_path?: string | null
          taken_at?: string
          user_id?: string
          verified?: boolean
          work_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      incidents: {
        Row: {
          car_id: string | null
          created_at: string
          gps_lat: number | null
          gps_lng: number | null
          id: string
          note: string | null
          photo_path: string | null
          taken_at: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id?: string | null
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          note?: string | null
          photo_path?: string | null
          taken_at?: string
          user_id: string
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string | null
          created_at?: string
          gps_lat?: number | null
          gps_lng?: number | null
          id?: string
          note?: string | null
          photo_path?: string | null
          taken_at?: string
          user_id?: string
          work_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      invites: {
        Row: {
          id: string
          workspace_id: string
          email: string
          full_name: string | null
          role: Database["public"]["Enums"]["user_role"]
          created_by: string
          created_at: string
          expires_at: string
          used_at: string | null
          used_by: string | null
        }
        Insert: {
          id?: string
          workspace_id: string
          email: string
          full_name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          created_by: string
          created_at?: string
          expires_at?: string
          used_at?: string | null
          used_by?: string | null
        }
        Update: {
          id?: string
          workspace_id?: string
          email?: string
          full_name?: string | null
          role?: Database["public"]["Enums"]["user_role"]
          created_by?: string
          created_at?: string
          expires_at?: string
          used_at?: string | null
          used_by?: string | null
        }
        Relationships: []
      }
      manager_workspaces: {
        Row: {
          created_at: string
          manager_id: string
          workspace_id: string
        }
        Insert: {
          created_at?: string
          manager_id: string
          workspace_id: string
        }
        Update: {
          created_at?: string
          manager_id?: string
          workspace_id?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          approved_at: string | null
          approved_by: string | null
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          pay_amount: number | null
          pay_type: Database["public"]["Enums"]["pay_type"] | null
          phone: string | null
          role: Database["public"]["Enums"]["user_role"] | null
          status: Database["public"]["Enums"]["user_status"]
          workspace_id: string | null
        }
        Insert: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          pay_amount?: number | null
          pay_type?: Database["public"]["Enums"]["pay_type"] | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          status?: Database["public"]["Enums"]["user_status"]
          workspace_id?: string | null
        }
        Update: {
          approved_at?: string | null
          approved_by?: string | null
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          pay_amount?: number | null
          pay_type?: Database["public"]["Enums"]["pay_type"] | null
          phone?: string | null
          role?: Database["public"]["Enums"]["user_role"] | null
          status?: Database["public"]["Enums"]["user_status"]
          workspace_id?: string | null
        }
        Relationships: []
      }
      route_stops: {
        Row: {
          address_override: string | null
          city: string | null
          cod_amount: number | null
          created_at: string
          display_order: number | null
          event_note: string | null
          expected_amount: number | null
          geocoded: boolean
          id: string
          is_cash: boolean
          lat: number | null
          lng: number | null
          note: string | null
          payment_method: string | null
          phone: string | null
          planned_time: string | null
          postal_code: string | null
          received_amount: number | null
          recorded_at: string | null
          recorded_by: string | null
          seq: number | null
          sheet_name: string | null
          skip_reason: string | null
          status: Database["public"]["Enums"]["stop_status"]
          street: string | null
          time_window: string | null
          tip: number | null
          upload_id: string
          weight: number | null
          workspace_id: string
        }
        Insert: {
          address_override?: string | null
          city?: string | null
          cod_amount?: number | null
          created_at?: string
          display_order?: number | null
          event_note?: string | null
          expected_amount?: number | null
          geocoded?: boolean
          id?: string
          is_cash?: boolean
          lat?: number | null
          lng?: number | null
          note?: string | null
          payment_method?: string | null
          phone?: string | null
          planned_time?: string | null
          postal_code?: string | null
          received_amount?: number | null
          recorded_at?: string | null
          recorded_by?: string | null
          seq?: number | null
          sheet_name?: string | null
          skip_reason?: string | null
          status?: Database["public"]["Enums"]["stop_status"]
          street?: string | null
          time_window?: string | null
          tip?: number | null
          upload_id: string
          weight?: number | null
          workspace_id: string
        }
        Update: {
          address_override?: string | null
          city?: string | null
          cod_amount?: number | null
          created_at?: string
          display_order?: number | null
          event_note?: string | null
          expected_amount?: number | null
          geocoded?: boolean
          id?: string
          is_cash?: boolean
          lat?: number | null
          lng?: number | null
          note?: string | null
          payment_method?: string | null
          phone?: string | null
          planned_time?: string | null
          postal_code?: string | null
          received_amount?: number | null
          recorded_at?: string | null
          recorded_by?: string | null
          seq?: number | null
          sheet_name?: string | null
          skip_reason?: string | null
          status?: Database["public"]["Enums"]["stop_status"]
          street?: string | null
          time_window?: string | null
          tip?: number | null
          upload_id?: string
          weight?: number | null
          workspace_id?: string
        }
        Relationships: []
      }
      route_uploads: {
        Row: {
          car_id: string | null
          created_at: string
          end_poi: string | null
          file_name: string | null
          id: string
          start_poi: string | null
          uploaded_by: string | null
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id?: string | null
          created_at?: string
          end_poi?: string | null
          file_name?: string | null
          id?: string
          start_poi?: string | null
          uploaded_by?: string | null
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string | null
          created_at?: string
          end_poi?: string | null
          file_name?: string | null
          id?: string
          start_poi?: string | null
          uploaded_by?: string | null
          work_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      shifts: {
        Row: {
          car_id: string
          created_at: string
          created_by: string | null
          driver_id: string | null
          id: string
          loader_id: string | null
          work_date: string
          workspace_id: string
        }
        Insert: {
          car_id: string
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          loader_id?: string | null
          work_date: string
          workspace_id: string
        }
        Update: {
          car_id?: string
          created_at?: string
          created_by?: string | null
          driver_id?: string | null
          id?: string
          loader_id?: string | null
          work_date?: string
          workspace_id?: string
        }
        Relationships: []
      }
      workspaces: {
        Row: {
          created_at: string
          id: string
          name: string
          driver_day_rate: number
          loader_day_rate: number
          geo_lat: number | null
          geo_lng: number | null
          geo_radius_m: number | null
          photo_retention_days: number
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          driver_day_rate?: number
          loader_day_rate?: number
          geo_lat?: number | null
          geo_lng?: number | null
          geo_radius_m?: number | null
          photo_retention_days?: number
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          driver_day_rate?: number
          loader_day_rate?: number
          geo_lat?: number | null
          geo_lng?: number | null
          geo_radius_m?: number | null
          photo_retention_days?: number
        }
        Relationships: []
      }
    }
    Views: { [_ in never]: never }
    Functions: {
      approve_user: {
        Args: {
          p_role: Database["public"]["Enums"]["user_role"]
          p_workspace_id: string
          target_id: string
        }
        Returns: undefined
      }
      can_access_workspace: { Args: { wid: string }; Returns: boolean }
      current_role: { Args: never; Returns: Database["public"]["Enums"]["user_role"] }
      current_status: { Args: never; Returns: Database["public"]["Enums"]["user_status"] }
      is_active: { Args: never; Returns: boolean }
      is_admin: { Args: never; Returns: boolean }
      is_manager_or_admin: { Args: never; Returns: boolean }
      resolve_member_names: { Args: { ids: string[] }; Returns: { id: string; full_name: string }[] }
      set_user_pay: {
        Args: {
          p_pay_amount: number
          p_pay_type: Database["public"]["Enums"]["pay_type"]
          target_id: string
        }
        Returns: undefined
      }
      set_user_status: {
        Args: {
          p_status: Database["public"]["Enums"]["user_status"]
          target_id: string
        }
        Returns: undefined
      }
      set_workspace_rates: {
        Args: {
          p_workspace_id: string
          p_driver_rate: number
          p_loader_rate: number
        }
        Returns: undefined
      }
      set_workspace_geofence: {
        Args: {
          p_workspace_id: string
          p_lat: number | null
          p_lng: number | null
          p_radius_m: number | null
        }
        Returns: undefined
      }
      decide_swap: {
        Args: { p_request_id: string; p_approve: boolean }
        Returns: undefined
      }
      partner_decide_swap: {
        Args: { p_request_id: string; p_accept: boolean }
        Returns: undefined
      }
      storage_workspace_ok: { Args: { objname: string }; Returns: boolean }
      user_workspace_ids: { Args: never; Returns: string[] }
    }
    Enums: {
      adjustment_type: "advance" | "deduction"
      car_issue_status: "open" | "in_progress" | "resolved"
      swap_status: "pending" | "approved" | "rejected"
      evidence_category: "dirt" | "damage" | "cigarette_burn" | "other"
      inspection_reason: "day9" | "driver_change" | "manual"
      inspection_view: "front" | "rear" | "left" | "right" | "interior"
      pay_type: "daily" | "monthly"
      stop_status: "pending" | "done" | "skipped"
      user_role: "driver" | "loader" | "manager" | "admin" | "crew"
      user_status: "pending" | "active" | "disabled"
    }
    CompositeTypes: { [_ in never]: never }
  }
}

type PublicSchema = Database["public"]

export type Tables<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Row"]
export type TablesInsert<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Insert"]
export type TablesUpdate<T extends keyof PublicSchema["Tables"]> =
  PublicSchema["Tables"][T]["Update"]
export type Enums<T extends keyof PublicSchema["Enums"]> =
  PublicSchema["Enums"][T]
