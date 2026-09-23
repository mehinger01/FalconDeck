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
      bell_schedules: {
        Row: {
          created_at: string
          description: string | null
          id: string
          is_default: boolean
          name: string
          needs_configuration: boolean
          organization_id: string
          owner_membership_id: string | null
          owner_type: string
          profile_key: string | null
          source: string | null
          time_zone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          description?: string | null
          id: string
          is_default?: boolean
          name: string
          needs_configuration?: boolean
          organization_id: string
          owner_membership_id?: string | null
          owner_type: string
          profile_key?: string | null
          source?: string | null
          time_zone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          description?: string | null
          id?: string
          is_default?: boolean
          name?: string
          needs_configuration?: boolean
          organization_id?: string
          owner_membership_id?: string | null
          owner_type?: string
          profile_key?: string | null
          source?: string | null
          time_zone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "bell_schedules_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "bell_schedules_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      class_presentation_settings: {
        Row: {
          arrival_instructions: string[]
          class_section_id: string
          created_at: string
          organization_id: string
          owner_membership_id: string
          updated_at: string
        }
        Insert: {
          arrival_instructions?: string[]
          class_section_id: string
          created_at?: string
          organization_id: string
          owner_membership_id: string
          updated_at?: string
        }
        Update: {
          arrival_instructions?: string[]
          class_section_id?: string
          created_at?: string
          organization_id?: string
          owner_membership_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_presentation_settings_class_section_id_fkey"
            columns: ["class_section_id"]
            isOneToOne: true
            referencedRelation: "class_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_presentation_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_presentation_settings_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      class_sections: {
        Row: {
          course_id: string
          created_at: string
          id: string
          name: string
          organization_id: string
          owner_membership_id: string
          room: string | null
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          id: string
          name: string
          organization_id: string
          owner_membership_id: string
          room?: string | null
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          id?: string
          name?: string
          organization_id?: string
          owner_membership_id?: string
          room?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "class_sections_organization_id_course_id_fkey"
            columns: ["organization_id", "course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "class_sections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "class_sections_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      classroom_experience_settings: {
        Row: {
          bell_offset_seconds: number
          clean_screen_default_message: string
          created_at: string
          end_of_day_message: string
          final_five_message: string
          organization_id: string
          owner_membership_id: string
          show_clock_on_clean_screen: boolean
          show_end_of_day_screen: boolean
          transition_arrival_instructions_enabled: boolean
          transition_countdown_enabled: boolean
          updated_at: string
          watermark_override_opacity: number | null
          watermark_override_storage_path: string | null
        }
        Insert: {
          bell_offset_seconds?: number
          clean_screen_default_message?: string
          created_at?: string
          end_of_day_message?: string
          final_five_message?: string
          organization_id: string
          owner_membership_id: string
          show_clock_on_clean_screen?: boolean
          show_end_of_day_screen?: boolean
          transition_arrival_instructions_enabled?: boolean
          transition_countdown_enabled?: boolean
          updated_at?: string
          watermark_override_opacity?: number | null
          watermark_override_storage_path?: string | null
        }
        Update: {
          bell_offset_seconds?: number
          clean_screen_default_message?: string
          created_at?: string
          end_of_day_message?: string
          final_five_message?: string
          organization_id?: string
          owner_membership_id?: string
          show_clock_on_clean_screen?: boolean
          show_end_of_day_screen?: boolean
          transition_arrival_instructions_enabled?: boolean
          transition_countdown_enabled?: boolean
          updated_at?: string
          watermark_override_opacity?: number | null
          watermark_override_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "classroom_experience_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "classroom_experience_settings_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: true
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      courses: {
        Row: {
          color_hex: string | null
          created_at: string
          description: string | null
          id: string
          name: string
          organization_id: string
          owner_membership_id: string | null
          owner_type: string
          updated_at: string
        }
        Insert: {
          color_hex?: string | null
          created_at?: string
          description?: string | null
          id: string
          name: string
          organization_id: string
          owner_membership_id?: string | null
          owner_type: string
          updated_at?: string
        }
        Update: {
          color_hex?: string | null
          created_at?: string
          description?: string | null
          id?: string
          name?: string
          organization_id?: string
          owner_membership_id?: string | null
          owner_type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "courses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "courses_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      lesson_class_sections: {
        Row: {
          class_section_id: string
          created_at: string
          lesson_date: string
          lesson_id: string
          organization_id: string
          owner_membership_id: string
          updated_at: string
        }
        Insert: {
          class_section_id: string
          created_at?: string
          lesson_date: string
          lesson_id: string
          organization_id: string
          owner_membership_id: string
          updated_at?: string
        }
        Update: {
          class_section_id?: string
          created_at?: string
          lesson_date?: string
          lesson_id?: string
          organization_id?: string
          owner_membership_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lesson_class_sections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lesson_class_sections_organization_id_owner_membership_id__fkey"
            columns: ["organization_id", "owner_membership_id", "lesson_id"]
            isOneToOne: false
            referencedRelation: "lessons"
            referencedColumns: ["organization_id", "owner_membership_id", "id"]
          },
          {
            foreignKeyName: "lesson_class_sections_organization_id_owner_membership_id_fkey1"
            columns: [
              "organization_id",
              "owner_membership_id",
              "class_section_id",
            ]
            isOneToOne: false
            referencedRelation: "class_sections"
            referencedColumns: ["organization_id", "owner_membership_id", "id"]
          },
          {
            foreignKeyName: "lesson_class_sections_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      lessons: {
        Row: {
          agenda_items: Json
          announcements: Json
          course_id: string
          created_at: string
          id: string
          learning_target: string
          lesson_date: string
          materials: string | null
          organization_id: string
          owner_membership_id: string
          resources: Json
          updated_at: string
        }
        Insert: {
          agenda_items?: Json
          announcements?: Json
          course_id: string
          created_at?: string
          id: string
          learning_target?: string
          lesson_date: string
          materials?: string | null
          organization_id: string
          owner_membership_id: string
          resources?: Json
          updated_at?: string
        }
        Update: {
          agenda_items?: Json
          announcements?: Json
          course_id?: string
          created_at?: string
          id?: string
          learning_target?: string
          lesson_date?: string
          materials?: string | null
          organization_id?: string
          owner_membership_id?: string
          resources?: Json
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "lessons_organization_id_course_id_fkey"
            columns: ["organization_id", "course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "lessons_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "lessons_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      library_resource_courses: {
        Row: {
          course_id: string
          created_at: string
          library_resource_id: string
          organization_id: string
          owner_membership_id: string
          updated_at: string
        }
        Insert: {
          course_id: string
          created_at?: string
          library_resource_id: string
          organization_id: string
          owner_membership_id: string
          updated_at?: string
        }
        Update: {
          course_id?: string
          created_at?: string
          library_resource_id?: string
          organization_id?: string
          owner_membership_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_resource_courses_course_id_fkey"
            columns: ["course_id"]
            isOneToOne: false
            referencedRelation: "courses"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_resource_courses_library_resource_id_fkey"
            columns: ["library_resource_id"]
            isOneToOne: false
            referencedRelation: "library_resources"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_resource_courses_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_resource_courses_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      library_resources: {
        Row: {
          created_at: string
          id: string
          is_favorite: boolean
          notes: string | null
          organization_id: string
          owner_membership_id: string
          source_drive_file_id: string | null
          source_kind: string
          source_mime_type: string | null
          source_web_view_url: string | null
          tags: string[]
          title: string
          type: string
          updated_at: string
          url: string
        }
        Insert: {
          created_at?: string
          id: string
          is_favorite?: boolean
          notes?: string | null
          organization_id: string
          owner_membership_id: string
          source_drive_file_id?: string | null
          source_kind?: string
          source_mime_type?: string | null
          source_web_view_url?: string | null
          tags?: string[]
          title: string
          type: string
          updated_at?: string
          url: string
        }
        Update: {
          created_at?: string
          id?: string
          is_favorite?: boolean
          notes?: string | null
          organization_id?: string
          owner_membership_id?: string
          source_drive_file_id?: string | null
          source_kind?: string
          source_mime_type?: string | null
          source_web_view_url?: string | null
          tags?: string[]
          title?: string
          type?: string
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "library_resources_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "library_resources_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_memberships: {
        Row: {
          account_origin: string
          created_at: string
          id: string
          local_data_migrated_at: string | null
          organization_id: string
          role: string
          status: string
          subject_area: string | null
          updated_at: string
          user_id: string
        }
        Insert: {
          account_origin?: string
          created_at?: string
          id?: string
          local_data_migrated_at?: string | null
          organization_id: string
          role?: string
          status?: string
          subject_area?: string | null
          updated_at?: string
          user_id: string
        }
        Update: {
          account_origin?: string
          created_at?: string
          id?: string
          local_data_migrated_at?: string | null
          organization_id?: string
          role?: string
          status?: string
          subject_area?: string | null
          updated_at?: string
          user_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_memberships_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_memberships_user_id_fkey"
            columns: ["user_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_settings: {
        Row: {
          branding_locked: boolean
          created_at: string
          display_name: string
          organization_id: string
          updated_at: string
          watermark_opacity: number
          watermark_storage_path: string | null
        }
        Insert: {
          branding_locked?: boolean
          created_at?: string
          display_name?: string
          organization_id: string
          updated_at?: string
          watermark_opacity?: number
          watermark_storage_path?: string | null
        }
        Update: {
          branding_locked?: boolean
          created_at?: string
          display_name?: string
          organization_id?: string
          updated_at?: string
          watermark_opacity?: number
          watermark_storage_path?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organization_settings_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string
          id: string
          name: string
          slug: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          id?: string
          name: string
          slug: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          id?: string
          name?: string
          slug?: string
          updated_at?: string
        }
        Relationships: []
      }
      profiles: {
        Row: {
          created_at: string
          email: string | null
          full_name: string | null
          id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          email?: string | null
          full_name?: string | null
          id?: string
          updated_at?: string
        }
        Relationships: []
      }
      schedule_block_overrides: {
        Row: {
          class_section_id: string | null
          class_section_overridden: boolean
          created_at: string
          custom_kind_label: string | null
          end_time: string | null
          id: string
          kind: string | null
          label: string | null
          organization_id: string
          owner_membership_id: string | null
          owner_type: string
          schedule_block_id: string
          start_time: string | null
          updated_at: string
          weekday: string
        }
        Insert: {
          class_section_id?: string | null
          class_section_overridden?: boolean
          created_at?: string
          custom_kind_label?: string | null
          end_time?: string | null
          id: string
          kind?: string | null
          label?: string | null
          organization_id: string
          owner_membership_id?: string | null
          owner_type: string
          schedule_block_id: string
          start_time?: string | null
          updated_at?: string
          weekday: string
        }
        Update: {
          class_section_id?: string | null
          class_section_overridden?: boolean
          created_at?: string
          custom_kind_label?: string | null
          end_time?: string | null
          id?: string
          kind?: string | null
          label?: string | null
          organization_id?: string
          owner_membership_id?: string | null
          owner_type?: string
          schedule_block_id?: string
          start_time?: string | null
          updated_at?: string
          weekday?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_block_overrides_class_section_id_fkey"
            columns: ["class_section_id"]
            isOneToOne: false
            referencedRelation: "class_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_block_overrides_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_block_overrides_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_block_overrides_schedule_block_id_fkey"
            columns: ["schedule_block_id"]
            isOneToOne: false
            referencedRelation: "schedule_blocks"
            referencedColumns: ["id"]
          },
        ]
      }
      schedule_blocks: {
        Row: {
          bell_schedule_id: string
          class_section_id: string | null
          created_at: string
          custom_kind_label: string | null
          end_time: string
          id: string
          is_lunch_window: boolean
          kind: string
          label: string
          organization_id: string
          owner_membership_id: string | null
          owner_type: string
          position: number
          start_time: string
          updated_at: string
        }
        Insert: {
          bell_schedule_id: string
          class_section_id?: string | null
          created_at?: string
          custom_kind_label?: string | null
          end_time: string
          id: string
          is_lunch_window?: boolean
          kind: string
          label: string
          organization_id: string
          owner_membership_id?: string | null
          owner_type: string
          position: number
          start_time: string
          updated_at?: string
        }
        Update: {
          bell_schedule_id?: string
          class_section_id?: string | null
          created_at?: string
          custom_kind_label?: string | null
          end_time?: string
          id?: string
          is_lunch_window?: boolean
          kind?: string
          label?: string
          organization_id?: string
          owner_membership_id?: string | null
          owner_type?: string
          position?: number
          start_time?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "schedule_blocks_bell_schedule_id_fkey"
            columns: ["bell_schedule_id"]
            isOneToOne: false
            referencedRelation: "bell_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_class_section_id_fkey"
            columns: ["class_section_id"]
            isOneToOne: false
            referencedRelation: "class_sections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "schedule_blocks_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      school_calendar_exceptions: {
        Row: {
          bell_schedule_id: string | null
          created_at: string
          dismissal_time: string | null
          end_date: string
          id: string
          notes: string | null
          organization_id: string
          school_year_calendar_id: string
          source_schedule_profile: string | null
          start_date: string
          title: string
          type: string
          updated_at: string
        }
        Insert: {
          bell_schedule_id?: string | null
          created_at?: string
          dismissal_time?: string | null
          end_date: string
          id: string
          notes?: string | null
          organization_id: string
          school_year_calendar_id: string
          source_schedule_profile?: string | null
          start_date: string
          title: string
          type: string
          updated_at?: string
        }
        Update: {
          bell_schedule_id?: string | null
          created_at?: string
          dismissal_time?: string | null
          end_date?: string
          id?: string
          notes?: string | null
          organization_id?: string
          school_year_calendar_id?: string
          source_schedule_profile?: string | null
          start_date?: string
          title?: string
          type?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_calendar_exceptions_bell_schedule_id_fkey"
            columns: ["bell_schedule_id"]
            isOneToOne: false
            referencedRelation: "bell_schedules"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_calendar_exceptions_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_calendar_exceptions_school_year_calendar_id_fkey"
            columns: ["school_year_calendar_id"]
            isOneToOne: false
            referencedRelation: "school_year_calendars"
            referencedColumns: ["id"]
          },
        ]
      }
      school_year_calendars: {
        Row: {
          created_at: string
          default_bell_schedule_id: string
          first_student_day: string | null
          id: string
          is_canonical: boolean
          last_student_day: string | null
          name: string
          organization_id: string
          owner_membership_id: string | null
          owner_type: string
          school_year: string
          time_zone: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          default_bell_schedule_id: string
          first_student_day?: string | null
          id: string
          is_canonical?: boolean
          last_student_day?: string | null
          name: string
          organization_id: string
          owner_membership_id?: string | null
          owner_type?: string
          school_year: string
          time_zone?: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          default_bell_schedule_id?: string
          first_student_day?: string | null
          id?: string
          is_canonical?: boolean
          last_student_day?: string | null
          name?: string
          organization_id?: string
          owner_membership_id?: string | null
          owner_type?: string
          school_year?: string
          time_zone?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "school_year_calendars_organization_id_default_bell_schedul_fkey"
            columns: ["organization_id", "default_bell_schedule_id"]
            isOneToOne: false
            referencedRelation: "bell_schedules"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "school_year_calendars_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "school_year_calendars_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_period_assignments: {
        Row: {
          class_section_id: string
          created_at: string
          id: string
          organization_id: string
          override_weekday: string | null
          owner_membership_id: string
          schedule_block_id: string
          updated_at: string
        }
        Insert: {
          class_section_id: string
          created_at?: string
          id?: string
          organization_id: string
          override_weekday?: string | null
          owner_membership_id: string
          schedule_block_id: string
          updated_at?: string
        }
        Update: {
          class_section_id?: string
          created_at?: string
          id?: string
          organization_id?: string
          override_weekday?: string | null
          owner_membership_id?: string
          schedule_block_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_period_assignments_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_period_assignments_organization_id_owner_membershi_fkey"
            columns: [
              "organization_id",
              "owner_membership_id",
              "class_section_id",
            ]
            isOneToOne: false
            referencedRelation: "class_sections"
            referencedColumns: ["organization_id", "owner_membership_id", "id"]
          },
          {
            foreignKeyName: "teacher_period_assignments_organization_id_schedule_block__fkey"
            columns: ["organization_id", "schedule_block_id"]
            isOneToOne: false
            referencedRelation: "schedule_blocks"
            referencedColumns: ["organization_id", "id"]
          },
          {
            foreignKeyName: "teacher_period_assignments_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: false
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
      teacher_schedule_preferences: {
        Row: {
          created_at: string
          lunch_wave: string
          organization_id: string
          owner_membership_id: string
          updated_at: string
        }
        Insert: {
          created_at?: string
          lunch_wave?: string
          organization_id: string
          owner_membership_id: string
          updated_at?: string
        }
        Update: {
          created_at?: string
          lunch_wave?: string
          organization_id?: string
          owner_membership_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "teacher_schedule_preferences_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "teacher_schedule_preferences_owner_membership_id_fkey"
            columns: ["owner_membership_id"]
            isOneToOne: true
            referencedRelation: "organization_memberships"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      app_is_admin: { Args: { org_id: string }; Returns: boolean }
      app_is_member: { Args: { org_id: string }; Returns: boolean }
      app_owns_membership: { Args: { membership_id: string }; Returns: boolean }
      app_owns_membership_in_org: {
        Args: { membership_id: string; org_id: string }
        Returns: boolean
      }
      bootstrap_organization: {
        Args: { organization_name: string }
        Returns: {
          membership_id: string
          organization_id: string
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
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
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
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
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
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
