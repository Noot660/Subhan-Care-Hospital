export interface Patient {
  id: number;
  patient_id: string;
  full_name: string;
  dob: string;
  gender: string;
  cnic: string;
  phone: string;
  address: string;
  emergency_contact: string;
  status: string;
  created_at: string;
  updated_at: string;
}

export interface Doctor {
  id: number;
  name: string;
  specialization: string;
  qualification: string;
  cnic: string;
  phone: string;
  fee: number;
  status: string;
  created_at: string;
}

export interface DoctorSchedule {
  id: number;
  doctor_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
}

export interface Staff {
  id: number;
  name: string;
  role: string;
  username: string;
  password_hash: string;
  phone: string;
  email: string;
  status: string;
  created_at: string;
}

export interface Appointment {
  id: number;
  patient_id: number;
  doctor_id: number;
  date: string;
  start_time: string;
  end_time: string;
  status: string;
  cancellation_reason: string | null;
  source: string;
  created_at: string;
  updated_at: string;
}

export interface Consultation {
  id: number;
  appointment_id: number;
  patient_id: number;
  doctor_id: number;
  notes: string;
  diagnosis: string;
  vitals: string;
  created_at: string;
}

export interface Prescription {
  id: number;
  consultation_id: number;
  patient_id: number;
  doctor_id: number;
  status: string;
  created_at: string;
}

export interface PrescriptionItem {
  id: number;
  prescription_id: number;
  medicine_name: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
}

export interface Medicine {
  id: number;
  name: string;
  batch_number: string;
  quantity: number;
  unit_cost: number;
  expiry_date: string;
  reorder_threshold: number;
  expiry_alert_days: number;
  created_at: string;
  updated_at: string;
}

export interface StockMovement {
  id: number;
  medicine_id: number;
  type: string;
  quantity_change: number;
  reference: string;
  user_id: number;
  created_at: string;
}

export interface Invoice {
  id: number;
  invoice_number: string;
  patient_id: number;
  appointment_id: number | null;
  status: string;
  subtotal: number;
  total: number;
  created_at: string;
  updated_at: string;
}

export interface InvoiceItem {
  id: number;
  invoice_id: number;
  description: string;
  type: string;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Payment {
  id: number;
  invoice_id: number;
  amount: number;
  method: string;
  reference: string;
  created_at: string;
}

export interface AuditLog {
  id: number;
  user_id: number;
  action: string;
  entity_type: string;
  entity_id: string;
  details: string;
  created_at: string;
}

export interface Session {
  token: string;
  user_id: number;
  staff_id: number;
  role: string;
  username: string;
  name: string;
  created_at: string;
  expires_at: string;
  last_active_at?: string;
}

export interface PatientDemographicHistory {
  id: number;
  patient_id: number;
  changed_by: number;
  field_name: string;
  old_value: string | null;
  new_value: string | null;
  changed_at: string;
}

export interface DoctorChangeRequest {
  id: number;
  doctor_id: number;
  requested_by: number;
  requested_data: string;
  status: string;
  rejection_reason: string | null;
  resolved_by: number | null;
  created_at: string;
  updated_at: string;
}

export type Role = 'admin' | 'doctor' | 'receptionist' | 'pharmacist' | 'billing' | 'management';
