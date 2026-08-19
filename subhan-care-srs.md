
SUBHAN CARE
Hospital Management System
Software Requirements Specification
Prepared in accordance with ISO/IEC/IEEE 29148:2018
Document Version: 1.0
Status: Draft for Client Review
Client: Subhan Care Hospital Management
July 2026


Table of Contents
Table of Contents	2
1. Introduction	4
1.1 Purpose of This Document	4
1.2 Intended Audience	4
1.3 Project Background and Problem Statement	4
1.4 Scope of the System	4
1.5 Definitions, Acronyms, and Abbreviations	5
1.6 References	5
1.7 Document Conventions	6
2. Overall Description	6
2.1 Business Goals and Success Metrics	6
2.2 Product Perspective	7
2.3 Stakeholders and User Classes	7
2.4 Operating Environment	7
2.5 Design and Implementation Constraints	8
2.6 Assumptions and Dependencies	8
2.7 Out-of-Scope Items	8
3. System Features and Functional Requirements	8
3.1 Patient Registration and Records	8
3.2 Doctor and Staff Directory	9
3.3 Appointment Scheduling	9
3.4 Consultation and Prescriptions	10
3.5 Pharmacy and Inventory	10
3.6 Billing and Payments	11
3.7 Reports and Analytics	11
3.8 User Access and Security	12
4. External Interface Requirements	12
4.1 User Interfaces	12
4.2 Hardware Interfaces	12
4.3 Software Interfaces	12
4.4 Communication Interfaces	13
5. Role-Based Access Matrix	13
6. Non-Functional Requirements	13
Performance	14
Usability	14
Reliability and Availability	14
Scalability and Maintainability	14
Portability	14
7. Security and Privacy Requirements	14
8. Data Requirements — Core Entities	15
9. Domain and Regulatory Requirements	16
10. Inverse Requirements	16
11. Backup, Disaster Recovery, and Business Continuity	17
12. Audit and Logging Requirements	17
13. Standard Report Catalogue	18
14. Use Cases	18
UC-1: Registering a New Patient	18
UC-2: Booking an Appointment	18
UC-3: Doctor Consultation and Prescription	18
UC-4: Dispensing Medicine	19
UC-5: Generating an Invoice and Collecting Payment	19
UC-6: Responding to a Low-Stock Alert	19
15. Requirements Traceability	20
16. Acceptance Criteria	20
17. Risks and Mitigations	20
18. Future Enhancements	21
19. Appendix A: Plain-Language Glossary	21
20. Approval and Sign-Off	22



1. Introduction
1.1 Purpose of This Document
This Software Requirements Specification (SRS) describes, in complete and verifiable detail, what the Subhan Care Hospital Management System (HMS) must do. It is written for two audiences at once: the Subhan Care management team, who need to confirm that the system will solve their operational problems, and the development and quality assurance team, who need an unambiguous technical basis for design, build, and testing. Every requirement in this document can be tested and signed off against.
In Plain Terms: This document is the written agreement of exactly what the software will do before anyone starts building it. Reading it carefully now avoids surprises, delays, and extra cost later — if something described here isn't what you expected, this is the right time to say so.
1.2 Intended Audience
Reader	How They Should Use This Document
Subhan Care Management (Client)	Review Sections 1–3, 15–18, and the plain-language boxes throughout to confirm the system matches business needs. Formal requirement tables are provided for reference but do not require a technical background to approve.
Project / Development Team	Use the full document, particularly Sections 3–14, as the binding technical specification for design and implementation.
Quality Assurance Team	Use requirement IDs (FR-, NF-, SEC-, DOM-, INV-, AUD-, BCP-) as the basis for test case design and the Acceptance Criteria in Section 16.
Hospital End Users (Doctors, Front Desk, Pharmacy, Billing)	Refer to Section 2.3 and the relevant module in Section 3 to understand what the system will and will not do for their role.
1.3 Project Background and Problem Statement
Subhan Care currently runs its day-to-day operations using a mix of paper registers, physical patient files, and spreadsheets maintained independently by the front desk, pharmacy, and billing counter. This creates several recurring problems: patient records are sometimes duplicated or misplaced, doctors do not have quick access to a patient's prior visit history at the time of consultation, medicine stock levels are not known in real time (leading to both shortages and wastage), and hospital management has no single, current view of daily patient volume or revenue. The Subhan Care HMS is intended to replace these disconnected manual processes with a single, centralized digital system used by every department.
In Plain Terms: In short: right now, information is scattered across paper files and separate spreadsheets, so nobody has the full picture in one place. This system puts everything — patients, doctors, medicine stock, and bills — into one place that every department can see, according to what they're allowed to see.
1.4 Scope of the System
The Subhan Care HMS is a new, cloud-hosted, browser-based system. It will cover the following eight functional areas, described in full in Section 3:
●Patient Registration & Records
●Doctor & Staff Directory
●Appointment Scheduling
●Consultation & Prescriptions
●Pharmacy & Inventory
●Billing & Payments
●Reports & Analytics
●User Access & Security
The following are explicitly out of scope for this release and are addressed as a future roadmap in Section 18:
●Telemedicine or video consultation.
●Direct, automated insurance claims processing.
●Integration with laboratory diagnostic equipment.
●A patient-facing mobile app or self-service portal.
1.5 Definitions, Acronyms, and Abbreviations
Term	Meaning
HMS	Hospital Management System — the software described in this document.
SRS	Software Requirements Specification — this document.
Admin	A staff member with full administrative access to configure and manage the system.
RBAC	Role-Based Access Control — restricts each user to only the functions their job requires.
CNIC / B-Form	Computerized National Identity Card (Pakistan) for adults, or B-Form for minors.
PHI	Protected Health Information — patient data that must be kept private and secure.
OTP	One-Time Password — a temporary code used to verify identity, e.g. during password reset.
TLS / HTTPS	The encryption technology that protects data while it travels between a browser and the server.
MoSCoW	The prioritization scale used in this document: Must-Have, Should-Have, Nice-to-Have.
UAT	User Acceptance Testing — the stage where hospital staff test the system before go-live.
RTO / RPO	Recovery Time Objective / Recovery Point Objective — see Section 11.
FR / NF / SEC / DOM / INV / AUD / BCP	Requirement-ID prefixes: Functional, Non-Functional, Security, Domain, Inverse, Audit, Backup & Continuity.
1.6 References
●ISO/IEC/IEEE 29148:2018 — Systems and software engineering — Life cycle processes — Requirements engineering.
●Discovery notes and requirement-gathering discussions with the Subhan Care project sponsor and department representatives.
●Applicable provincial healthcare regulatory guidance, to be confirmed with the hospital's legal/compliance advisor (see Section 9).
1.7 Document Conventions
Requirement keywords in this document follow standard IEEE 29148 usage:
●SHALL — a mandatory requirement; the system must implement this and it must be verifiable through testing.
●SHOULD — a recommended requirement that adds value but is not a condition of final acceptance.
●MAY — an optional capability the system is permitted, but not required, to provide.
Each requirement carries a unique ID prefixed by module (e.g. FR-PAT-01 for the first Patient Records requirement) and a priority using the MoSCoW scale:
Priority	Meaning
Must-Have	Required for go-live; the system is not acceptable without it.
Should-Have	Important, expected in the initial release, but go-live is not blocked if briefly deferred.
Nice-to-Have	Adds value; may be scheduled for a later phase without affecting acceptance.
In Plain Terms: Wherever you see a shaded box like this one, it is a plain-language summary of the formal section above it. You can rely on these boxes to understand and approve the intent of each section without needing to read every technical line — the formal wording exists so the development and testing teams have no room for misinterpretation.
2. Overall Description
2.1 Business Goals and Success Metrics
The system is being built to achieve specific, measurable improvements over the current manual process. Development priorities in Section 3 are traceable back to these goals (see also the Traceability table in Section 15).
Business Goal	Target Outcome
Faster patient check-in	Reduce average front-desk registration/check-in time from an estimated 10–15 minutes (paper-based) to under 3 minutes.
No lost or duplicate records	Every patient has exactly one digital record, retrievable in seconds by name, CNIC, phone, or Patient ID.
Real-time medicine visibility	Pharmacy staff and Admin can see current stock levels at any moment, with automatic alerts before a shortage or expiry occurs.
Fewer billing errors	Consultation and medicine charges are calculated automatically from the visit record, reducing manual calculation mistakes.
Management visibility	Hospital management can view daily patient volume, revenue, and stock status without requesting reports from staff.
2.2 Product Perspective
The Subhan Care HMS is a new, self-contained product; it does not replace or extend an existing software system, since the hospital's current process is manual. The system will consist of a web-based front end, an application server, and a centralized cloud database, hosted on a commercial cloud infrastructure provider. All users — regardless of role or physical location within the hospital — access the same system through a standard web browser; no department will maintain its own separate spreadsheet or file once the system is live.
In Plain Terms: Nothing is being installed on individual computers. Staff simply open a web browser and log in — the same way one would use online banking. All data lives in one secure, centrally-managed place instead of scattered spreadsheets and paper files.
2.3 Stakeholders and User Classes
Role	Technical Comfort Level	What They Need From the System
Hospital Management / Owner	Low to moderate	A simple, high-level view of daily operations, revenue, and stock — without needing to interpret raw data.
Admin	Moderate	Full configuration control: user accounts, doctor/staff profiles, and system-wide oversight.
Doctor	Low to moderate; interface must be simple and fast during consultations	Quick access to a patient's history and a fast way to record diagnosis and prescriptions.
Receptionist / Front Desk	Low	A fast, guided workflow for registering patients and booking appointments with minimal typing.
Pharmacist	Low to moderate	A clear view of stock levels and an easy way to record dispensed medicine.
Billing Staff / Cashier	Low	Automatic charge calculation and a simple way to record and print payments.
Patient	N/A (not a direct system user in this release)	Accurate records, correct bills, and timely appointment reminders, delivered indirectly through staff.
Development & QA Team	High	An unambiguous, testable specification — this document.
2.4 Operating Environment
Component	Specification
Hosting	Commercial cloud infrastructure (e.g. AWS, Azure, or equivalent), providing remote accessibility without an on-premise server.
Client hardware	Standard low-to-moderate hardware: minimum 4GB RAM, dual-core processor.
Client software	A modern web browser — Chrome, Firefox, Edge, or Safari (latest two stable versions).
Network	Standard broadband or mobile internet connection at each hospital location.
Server side	Cloud-managed, horizontally scalable application server and database.
2.5 Design and Implementation Constraints
●The system shall be delivered as a web application; no native desktop installation shall be required on any client machine.
●All core hospital records shall be stored in a centralized cloud database; no offline-only or purely local data store is permitted for core records.
●The system shall follow a modular architecture so that individual modules (e.g. Pharmacy, Billing) can be updated without redeploying the entire system.
●The client-facing interface shall remain usable on the low-to-moderate hardware specified in Section 2.4.
●All handling of passwords and sensitive data shall comply with the Security Requirements in Section 7.
2.6 Assumptions and Dependencies
●A stable internet connection is available at each hospital location during operating hours.
●Hospital staff will receive a short structured training session before go-live (see Risk mitigation in Section 17).
●The system's availability depends on the reliability of the selected cloud hosting provider.
●Appointment reminders depend on a third-party SMS/email gateway integration (Section 4.3).
●Patient consent for digital record-keeping is obtained through the hospital's existing administrative process; this is outside the scope of the system itself.
2.7 Out-of-Scope Items
Items identified during discovery but deliberately excluded from this release are listed in full, with rationale, under Future Enhancements (Section 18). Their exclusion does not reflect lower importance — it reflects a decision to deliver a stable, well-tested core system first.
3. System Features and Functional Requirements
Requirements in this section are grouped by functional module. Each module begins with a plain-language summary followed by the formal, testable requirement statements.
3.1 Patient Registration and Records
This module replaces the hospital's paper patient files with a single digital record per patient.
In Plain Terms: This is the digital version of the patient file drawer at the front desk — but searchable in seconds, and impossible to lose or duplicate.
ID	Requirement Statement	Priority
FR-PAT-01	The system shall allow Admin or Front-Desk staff to register a new patient by capturing full name, date of birth, gender, CNIC/B-Form number, contact number, address, and emergency contact.	Must-Have
FR-PAT-02	The system shall automatically assign a unique Patient ID (format SC-PT-000001) upon successful registration.	Must-Have
FR-PAT-03	The system shall prevent registration of a duplicate patient record using an existing CNIC/B-Form number.	Must-Have
FR-PAT-04	The system shall allow authorized staff to search for a patient by name, CNIC, phone number, or Patient ID.	Must-Have
FR-PAT-05	The system shall allow Admin to update a patient's demographic details while retaining a change history.	Should-Have
FR-PAT-06	The system shall allow a patient record to be marked Inactive; permanent deletion shall not be permitted (see INV-01).	Must-Have
FR-PAT-07	The system shall display a consolidated patient profile showing visit history, prescriptions, and billing status on a single screen.	Should-Have
3.2 Doctor and Staff Directory
This module maintains profiles and schedules for every doctor and staff member who uses the system.
In Plain Terms: This is the hospital's digital staff register — who works here, what they do, and when doctors are available for appointments.
ID	Requirement Statement	Priority
FR-DOC-01	The system shall allow Admin to create a doctor profile including name, specialization, qualification, CNIC, contact details, and consultation fee.	Must-Have
FR-DOC-02	The system shall allow Admin to define a weekly availability schedule for each doctor.	Must-Have
FR-DOC-03	The system shall allow Admin to create staff profiles for Receptionist, Pharmacist, and Billing roles, with system access assigned per role.	Must-Have
FR-DOC-04	The system shall allow Admin to deactivate a doctor or staff account upon resignation or termination, without deleting their historical records.	Must-Have
FR-DOC-05	The system shall allow a Doctor to view and request changes to their own contact information and availability, subject to Admin approval.	Should-Have
FR-DOC-06	The system should notify Admin when a doctor's schedule has no configured availability on a day with pending appointment requests.	Nice-to-Have
3.3 Appointment Scheduling
This module manages the booking, rescheduling, and status of patient appointments with doctors.
In Plain Terms: This replaces the appointment diary at the front desk. It stops two patients being booked into the same doctor slot by mistake, and it can text or email the patient a reminder.
ID	Requirement Statement	Priority
FR-APT-01	The system shall allow Front-Desk staff to book an appointment by selecting a registered patient, a doctor, a date, and an available time slot.	Must-Have
FR-APT-02	The system shall display only time slots that are currently available, based on the doctor's configured schedule and existing bookings.	Must-Have
FR-APT-03	The system shall prevent two appointments from being booked into the same doctor time slot (see INV-08).	Must-Have
FR-APT-04	The system shall allow an appointment to be rescheduled or cancelled, recording the reason and timestamp of the change.	Must-Have
FR-APT-05	The system should send an automated SMS or email reminder to the patient at a configurable interval before the appointment.	Should-Have
FR-APT-06	The system shall allow Front-Desk staff or the Doctor to mark an appointment status as Scheduled, Checked-In, Completed, or No-Show.	Must-Have
3.4 Consultation and Prescriptions
This module supports the doctor's consultation workflow, from reviewing patient history to issuing a prescription.
In Plain Terms: When a doctor sits down with a patient, this is what they see and use: the patient's past visits, a place to write notes and diagnosis, and a digital prescription pad that only doctors are allowed to fill out.
ID	Requirement Statement	Priority
FR-RX-01	The system shall allow a Doctor to open an appointment and view the patient's prior visit history and prescriptions before starting a consultation.	Must-Have
FR-RX-02	The system shall allow a Doctor to record consultation notes, diagnosis, and vital signs against the visit.	Must-Have
FR-RX-03	The system shall allow a Doctor to create a digital prescription listing one or more medicines with dosage, frequency, and duration.	Must-Have
FR-RX-04	The system shall timestamp every prescription and permanently link it to the issuing doctor and the specific consultation.	Must-Have
FR-RX-05	The system shall allow a Doctor to generate a printable prescription slip.	Must-Have
FR-RX-06	The system shall restrict creation and editing of prescriptions to users holding the Doctor role (see INV-03).	Must-Have
FR-RX-07	The system shall make a finalized prescription visible to the Pharmacist, in read-only form, for dispensing.	Must-Have
3.5 Pharmacy and Inventory
This module tracks medicine stock from receipt to dispensing, and raises alerts before problems occur.
In Plain Terms: This is the pharmacy's stock register, done automatically. Every time medicine is dispensed against a prescription, the stock count goes down by itself, and the system warns staff before something runs out or expires.
ID	Requirement Statement	Priority
FR-PHM-01	The system shall allow the Pharmacist to add new medicine stock entries with batch number, quantity, unit cost, and expiry date.	Must-Have
FR-PHM-02	The system shall automatically deduct medicine quantity from stock when a prescription is marked as dispensed.	Must-Have
FR-PHM-03	The system shall generate a low-stock alert when a medicine's quantity falls below a configurable reorder threshold.	Must-Have
FR-PHM-04	The system should generate a near-expiry alert for stock expiring within a configurable number of days.	Should-Have
FR-PHM-05	The system shall prevent stock quantity from being reduced below zero (see INV-04).	Must-Have
FR-PHM-06	The system shall maintain a stock movement log recording every addition, dispense, and adjustment with user and timestamp.	Must-Have
3.6 Billing and Payments
This module calculates charges, records payments, and issues invoices for each patient visit.
In Plain Terms: This turns a completed visit and prescription into a bill automatically, so nobody has to add up consultation and medicine charges by hand. Once a bill is finalized, it can't be deleted — only corrected through a proper adjustment, so there's always an honest financial trail.
ID	Requirement Statement	Priority
FR-BIL-01	The system shall automatically calculate consultation and medicine charges based on the completed visit and dispensed prescription.	Must-Have
FR-BIL-02	The system should allow Billing staff to add supplementary charges (e.g. lab tests, procedures) to an invoice.	Should-Have
FR-BIL-03	The system shall support recording of full, partial, or installment payments against an invoice.	Must-Have
FR-BIL-04	The system shall generate a unique, sequential invoice number for every finalized bill.	Must-Have
FR-BIL-05	The system shall generate a printable invoice/receipt for the patient.	Must-Have
FR-BIL-06	The system shall not permit deletion of a finalized invoice; corrections shall be made only through a linked credit/adjustment note (see INV-02).	Must-Have
FR-BIL-07	The system should allow Billing staff to view a patient's outstanding balance across all visits.	Should-Have
3.7 Reports and Analytics
This module gives Admin and Hospital Management a real-time view of hospital performance, and lets staff export data for record-keeping.
In Plain Terms: This is the dashboard hospital management asked for: a single screen showing how many patients were seen today, how much revenue came in, and which medicines are running low — without asking staff to prepare a report.
ID	Requirement Statement	Priority
FR-RPT-01	The system should provide Admin with a real-time dashboard summarizing daily patient footfall, revenue, and pending appointments.	Should-Have
FR-RPT-02	The system should allow Admin to generate a revenue report for a selected date range, filterable by doctor or department.	Should-Have
FR-RPT-03	The system should allow Admin to generate an inventory status report showing current stock, low-stock items, and near-expiry items.	Should-Have
FR-RPT-04	The system should allow generated reports to be exported to PDF and Excel format.	Should-Have
FR-RPT-05	The system may allow Billing staff to view a read-only financial summary relevant to their role.	Nice-to-Have
3.8 User Access and Security
This module controls who can log in, what each person can see, and how accounts are managed.
In Plain Terms: This is the lock on the front door and the individual keys behind it: every staff member logs in with their own account, and each account only opens the doors relevant to that person's job.
ID	Requirement Statement	Priority
FR-AUTH-01	The system shall require every user to log in with a unique username/employee ID and password before accessing any function.	Must-Have
FR-AUTH-02	The system shall enforce role-based access control, restricting each user to the functions and data authorized for their role (see Section 5).	Must-Have
FR-AUTH-03	The system shall allow a user to reset a forgotten password via a One-Time Password sent to their registered email or phone.	Must-Have
FR-AUTH-04	The system shall automatically log out an inactive session after a configurable idle period (default 15 minutes).	Must-Have
FR-AUTH-05	The system shall allow Admin to activate, deactivate, or reassign the role of any user account.	Must-Have
4. External Interface Requirements
4.1 User Interfaces
The system shall provide a responsive, role-specific web dashboard for each user class defined in Section 2.3, displaying only the functions and data relevant to that role.
4.2 Hardware Interfaces
No specialized or proprietary hardware is required. Standard input devices (keyboard, mouse, touchscreen) and a receipt/invoice printer are the only hardware interfaces required at hospital sites.
4.3 Software Interfaces
Interface	Description
Web Browser	The primary client interface; the system shall be accessed exclusively over HTTPS.
SMS / Email Gateway	Third-party integration used for appointment reminders (FR-APT-05) and OTP-based password reset (FR-AUTH-03).
Cloud Database	The centralized data store for all hospital records.
PDF/Excel Export Service	Used to generate downloadable invoices, prescriptions, and reports (FR-BIL-05, FR-RX-05, FR-RPT-04).
4.4 Communication Interfaces
All client-server communication shall occur over HTTPS using TLS 1.2 or higher, as specified in Section 7 (SEC-02).
5. Role-Based Access Matrix
This matrix defines module-level access per role. F = Full access (create/read/update/delete), R = Read-only, L = Limited (a defined subset of actions), — = No access.
In Plain Terms: This table is the simplest way to see, at a glance, exactly what each type of staff member can and cannot do in the system. If a role is missing a permission it needs — or has one it shouldn't — this is the place to flag it.
Module	Admin	Doctor	Reception	Pharmacist	Billing	Mgmt (View)
Patient Records	F	R / L	F	R	R	R
Doctor & Staff Directory	F	R (own)	R	—	—	R
Appointments	F	R (own)	F	—	—	R
Consultations & Prescriptions	R	F (own patients)	—	R (dispense view)	—	—
Pharmacy & Inventory	F	—	—	F	—	R
Billing & Invoices	F	—	—	—	F	R
Reports & Analytics	F	—	—	—	R (financial)	R
User Accounts & Security	F	—	—	—	—	—
Audit Logs	R	—	—	—	—	—
6. Non-Functional Requirements
These requirements describe how well the system must perform its functions, rather than what those functions are.
In Plain Terms: This section is about the quality of the experience — how fast the system feels, how easy it is to learn, and how dependable it is — rather than a specific feature.
Performance
ID	Requirement Statement	Priority
NF-PERF-01	The system shall respond to standard user actions (search, save, load record) within 3 seconds under normal operating load.	Must-Have
NF-PERF-02	The system shall support at least 100 concurrent users across the hospital without noticeable performance degradation.	Should-Have
Usability
ID	Requirement Statement	Priority
NF-USE-01	A new Front-Desk or Billing staff member shall be able to perform core daily tasks (registration, booking, billing) after no more than 2 hours of training.	Must-Have
NF-USE-02	Each role-specific dashboard shall present only the functions relevant to that role, minimizing the number of clicks required for common tasks.	Should-Have
Reliability and Availability
ID	Requirement Statement	Priority
NF-REL-01	The system shall maintain at least 99.5% uptime during hospital operating hours.	Must-Have
NF-REL-02	In the event of a failed save or connection loss, the system shall display a clear error and shall not silently lose entered data.	Must-Have
Scalability and Maintainability
ID	Requirement Statement	Priority
NF-SCAL-01	The system architecture shall support future expansion to additional hospital branches without a fundamental redesign.	Should-Have
NF-MAINT-01	The system shall be built using a modular architecture allowing individual modules to be updated independently.	Should-Have
Portability
ID	Requirement Statement	Priority
NF-PORT-01	The system shall be fully usable on both desktop and tablet-sized browser windows via a responsive layout.	Should-Have
7. Security and Privacy Requirements
Because the system stores sensitive patient and financial data, security requirements are specified separately from general non-functional requirements.
In Plain Terms: Patient medical information is sensitive by nature. This section exists to give the hospital confidence that data is encrypted, access is restricted to the right people, and every important action is traceable.
ID	Requirement Statement	Priority
SEC-01	Passwords shall be stored using a one-way industry-standard hashing algorithm (e.g. bcrypt); plain-text password storage is prohibited.	Must-Have
SEC-02	All client-server traffic shall be encrypted using HTTPS with TLS 1.2 or higher.	Must-Have
SEC-03	Role-based access control shall be enforced both at the interface level and at the underlying data-access level.	Must-Have
SEC-04	Patient medical data (PHI) shall be accessible only to roles explicitly authorized in the Role-Access Matrix (Section 5).	Must-Have
SEC-05	All login attempts, successful and failed, shall be logged with timestamp and account identifier.	Must-Have
SEC-06	An account shall be temporarily locked after 5 consecutive failed login attempts, requiring Admin-controlled unlock.	Must-Have
SEC-07	Sensitive fields such as CNIC and contact number shall be masked in list views and shown in full only on an authorized detail view.	Should-Have
SEC-08	The hosting environment shall receive regular, timely security patches for its server infrastructure.	Must-Have
SEC-09	Data backups shall be encrypted at rest.	Must-Have
SEC-10	Session tokens shall be invalidated immediately upon user logout.	Must-Have
8. Data Requirements — Core Entities
The following entities represent the core data the system must maintain. Detailed field-level data models will be produced during technical design based on this list.
Entity	Description	Retention
Patient	Demographic and contact details for each registered patient.	Indefinite (never deleted, only deactivated)
Doctor / Staff	Profile, role, and schedule for each hospital employee.	Indefinite; deactivated on exit
Appointment	A scheduled visit linking a patient, doctor, date, and time slot.	Minimum 3 years
Consultation	Clinical notes, diagnosis, and vitals for a visit.	Per applicable medical-record regulation (Section 9)
Prescription	Medicines, dosage, and duration issued during a consultation.	Per applicable medical-record regulation (Section 9)
Medicine / Inventory Item	Stock item with batch, quantity, cost, and expiry.	Movement log retained minimum 2 years
Invoice / Payment	Finalized billing record and associated payments.	Minimum 7 years (financial/audit)
Audit Log	Record of user actions across the system.	Minimum 1 year (see AUD-04)
9. Domain and Regulatory Requirements
These requirements reflect standard healthcare-sector practice and record-keeping norms. Exact regulatory retention periods should be confirmed with the hospital's legal or compliance advisor before final sign-off.
ID	Requirement Statement	Priority
DOM-01	The system shall retain patient medical records for a minimum period consistent with applicable healthcare record-keeping regulation (to be confirmed with hospital compliance advisor).	Must-Have
DOM-02	The system shall support CNIC/B-Form as the primary national identification field, consistent with local hospital registration practice.	Must-Have
DOM-03	Prescription creation shall be restricted to users holding a valid Doctor role, consistent with standard clinical governance.	Must-Have
DOM-04	The system shall be able to produce patient and financial records in a format suitable for submission to relevant provincial healthcare regulatory bodies upon request.	Should-Have
DOM-05	Finalized financial records (invoices) shall be retained in a non-editable format to support audit and tax requirements.	Must-Have
10. Inverse Requirements
Inverse requirements explicitly state actions the system must prevent. These are just as binding as the positive requirements above and are verified through negative test cases.
In Plain Terms: As important as what the system does is what it refuses to do. These rules are the guardrails that protect patient safety, financial accuracy, and data integrity even if a user makes a mistake or tries to bypass a rule.
ID	Requirement Statement	Priority
INV-01	The system shall not permit permanent deletion of a patient record; only deactivation is permitted (see FR-PAT-06).	Must-Have
INV-02	The system shall not permit a finalized invoice to be deleted or directly edited (see FR-BIL-06).	Must-Have
INV-03	The system shall not permit any role other than Doctor to create, edit, or delete a prescription (see FR-RX-06).	Must-Have
INV-04	The system shall not permit dispensing of a medicine quantity that would reduce stock below zero (see FR-PHM-05).	Must-Have
INV-05	The system shall not permit a user to view or export patient medical history outside their authorized role.	Must-Have
INV-06	The system shall not permit modification or deletion of audit log entries by any user, including Admin (see AUD-03).	Must-Have
INV-07	The system shall not store any password in plain, unencrypted text at any point (see SEC-01).	Must-Have
INV-08	The system shall not permit two appointments to be booked into the same doctor time slot (see FR-APT-03).	Must-Have
11. Backup, Disaster Recovery, and Business Continuity
In Plain Terms: If a server fails, data is never at risk of being lost for more than a day, and the system can be brought back online within a few hours — this section defines exactly how quickly and how completely.
ID	Requirement Statement	Priority
BCP-01	The system shall perform an automated full database backup at least once every 24 hours.	Must-Have
BCP-02	Backups shall be retained for a minimum of 30 days, stored separately from the primary database.	Must-Have
BCP-03	A documented and tested restoration procedure shall achieve a Recovery Time Objective (RTO) of 4 hours or less.	Must-Have
BCP-04	The backup strategy shall achieve a Recovery Point Objective (RPO) of 24 hours or less.	Must-Have
BCP-05	Backup integrity shall be verified periodically through test restorations.	Should-Have
12. Audit and Logging Requirements
ID	Requirement Statement	Priority
AUD-01	Every create, update, and delete action on patient, prescription, and billing data shall be logged with user, timestamp, and action performed.	Must-Have
AUD-02	Audit logs shall be viewable, in read-only form, by Admin.	Must-Have
AUD-03	Audit logs shall not be editable or deletable by any user, including Admin (see INV-06).	Must-Have
AUD-04	Audit logs shall be retained for a minimum of 1 year for compliance and traceability.	Must-Have
AUD-05	Failed login attempts shall be captured in the audit trail (see SEC-05).	Must-Have
13. Standard Report Catalogue
The following reports shall be available to the roles indicated, in addition to the live dashboard described under FR-RPT-01.
Report	Contents	Audience
Daily Collection Report	Patient count and total revenue for a selected day.	Admin, Billing
Doctor Performance Report	Number of consultations per doctor over a selected period.	Admin
Inventory Status Report	Current stock levels, low-stock items, near-expiry items.	Admin, Pharmacist
Outstanding Dues Report	Patients with unpaid or partially paid balances.	Admin, Billing
14. Use Cases
The following narratives illustrate how the core requirements above come together in everyday hospital use. Each use case names the requirements it exercises.
UC-1: Registering a New Patient

Actor: Front-Desk Receptionist
Goal: Create a searchable digital record for a patient visiting for the first time.
Flow: The receptionist selects "Register New Patient," enters the patient's demographic and contact details, and submits the form. The system checks the CNIC/B-Form number against existing records, generates a unique Patient ID, and saves the record.
Result: A new, uniquely identified patient record exists and can immediately be used to book an appointment.
Related Requirements: FR-PAT-01, FR-PAT-02, FR-PAT-03
UC-2: Booking an Appointment

Actor: Front-Desk Receptionist
Goal: Schedule a patient for consultation with a specific doctor.
Flow: The receptionist searches for the patient, selects a doctor and date, and chooses from the time slots the system shows as available. On confirmation, the system reserves the slot and updates the doctor's schedule.
Result: The appointment appears with status Scheduled, and the slot is no longer available to other bookings.
Related Requirements: FR-APT-01, FR-APT-02, FR-APT-03
UC-3: Doctor Consultation and Prescription

Actor: Doctor
Goal: Review a patient's history, record a diagnosis, and issue a prescription.
Flow: The doctor opens the scheduled appointment, reviews the patient's prior visits and prescriptions, records consultation notes and diagnosis, and adds one or more medicines to a digital prescription before marking the appointment Completed.
Result: Consultation notes and the prescription are saved to the patient's permanent medical history and made visible to the Pharmacist for dispensing.
Related Requirements: FR-RX-01 through FR-RX-07
UC-4: Dispensing Medicine

Actor: Pharmacist
Goal: Fulfill a doctor's prescription and update stock accordingly.
Flow: The pharmacist opens the pending prescription, confirms the medicines against available stock, and marks the prescription as dispensed. The system automatically deducts the dispensed quantity from inventory.
Result: Stock levels are updated in real time, and a low-stock alert is raised automatically if the remaining quantity falls below the configured threshold.
Related Requirements: FR-RX-07, FR-PHM-02, FR-PHM-03
UC-5: Generating an Invoice and Collecting Payment

Actor: Billing Staff
Goal: Bill the patient accurately for a completed visit and record payment.
Flow: The billing clerk opens the patient's pending charges; the system auto-populates consultation and medicine charges from the visit record. The clerk adds any supplementary charges, selects a payment method, and confirms payment.
Result: A finalized, sequentially numbered invoice is generated and can be printed; it cannot subsequently be deleted.
Related Requirements: FR-BIL-01, FR-BIL-03, FR-BIL-04, FR-BIL-06
UC-6: Responding to a Low-Stock Alert

Actor: Pharmacist / Admin
Goal: Prevent a medicine shortage from disrupting patient care.
Flow: The system automatically raises a low-stock alert when a medicine's quantity crosses the configured threshold. The pharmacist or Admin reviews the alert, places a reorder with the supplier outside the system, and records the new stock batch on arrival.
Result: Stock is replenished before the item is fully depleted, and the movement is captured in the stock log.
Related Requirements: FR-PHM-01, FR-PHM-03, FR-PHM-06
15. Requirements Traceability
This table maps each business goal from Section 2.1 to the requirements that deliver it, so the client can confirm every business objective is actually covered by a concrete, testable requirement.
Business Goal	Supporting Requirements
Faster patient check-in	FR-PAT-01 to FR-PAT-04, NF-USE-01
No lost or duplicate records	FR-PAT-02, FR-PAT-03, FR-PAT-06, INV-01
Real-time medicine visibility	FR-PHM-01 to FR-PHM-06, FR-RPT-03
Fewer billing errors	FR-BIL-01 to FR-BIL-07, INV-02
Management visibility	FR-RPT-01 to FR-RPT-05, Role Matrix Management column (Section 5)
16. Acceptance Criteria
The Subhan Care HMS shall be considered ready for User Acceptance Testing (UAT) sign-off when the following conditions are met:
1.All Must-Have functional requirements (Section 3) are implemented and pass their corresponding test cases with zero critical defects.
2.All Security Requirements (Section 7) — password hashing, HTTPS enforcement, RBAC, session timeout, and audit logging — are verified through security testing.
3.All Inverse Requirements (Section 10) are verified through negative test cases confirming that prohibited actions are correctly blocked.
4.System response time meets NF-PERF-01 (≤ 3 seconds) under a simulated load of 100 concurrent users.
5.The system is verified accessible from at least two distinct networks via standard web browsers, confirming cloud accessibility.
6.Automated backup and restoration is successfully demonstrated per BCP-01 and BCP-03.
7.All six core use cases (Section 14) are executed end-to-end without critical defects in a UAT environment.
8.The Role-Based Access Matrix (Section 5) is verified for all roles, confirming no unauthorized cross-role access is possible.
17. Risks and Mitigations
In Plain Terms: No project is risk-free. Listing risks here — and how they will be handled — is meant to give the client confidence that potential problems have already been thought through, not discovered for the first time during rollout.
Risk	Likelihood	Impact	Mitigation
Staff resistance to a new digital workflow	Medium	Medium	Structured training plus a short phased rollout, with a documented fallback process for the first two weeks.
Internet outage at a hospital site	Medium	High	Recommend a backup internet connection; critical-function offline caching considered for a future phase.
Data entry errors during migration from paper/Excel records	Medium	High	A dedicated data-verification phase is run before go-live.
Cloud provider downtime	Low	High	Selection of an SLA-backed provider, combined with the backup/restore plan in Section 11.
Unauthorized access to patient data	Low	High	RBAC, encryption, and audit logging as defined in Section 7.
18. Future Enhancements
The following items were identified during discovery as valuable, but are deliberately deferred to keep the initial release focused and reliable. They may be considered for later phases:
●Telemedicine / video consultation module.
●Insurance claims processing and integration with third-party insurers.
●Direct integration with laboratory diagnostic equipment for automated result import.
●Native mobile applications (iOS/Android) in addition to the responsive web interface.
●A patient-facing self-service portal for appointment booking and viewing personal history.
●Multi-branch / multi-hospital support for future network expansion.
●Offline-capable check-in for continued operation during short internet outages.
19. Appendix A: Plain-Language Glossary
A short, non-technical explanation of terms hospital staff are likely to encounter while using or discussing the system.
Term	In Plain Terms
Cloud	A secure, professionally-managed remote computer that stores the hospital's data, instead of a physical server sitting inside the building.
Dashboard	The main summary screen a user sees after logging in, showing the information most relevant to their job.
RBAC (role-based access)	A rule that each staff account can only see and do what its role allows — a receptionist cannot open billing records, for example.
Backup	An automatic copy of all hospital data, kept safe in case something goes wrong with the main system.
Audit log	A permanent, tamper-proof record of who did what and when — useful for resolving disputes or investigating mistakes.
HTTPS / encryption	The same kind of security technology used by online banking, which scrambles data so it can't be read if intercepted.
OTP (one-time password)	A short code sent by SMS or email, used once to confirm it's really you — for example, when resetting a password.
Invoice	The hospital's official bill given to a patient after a visit.
Module	One functional area of the system, such as Billing or Pharmacy.
20. Approval and Sign-Off
By signing below, each party confirms that this document accurately reflects the agreed scope and requirements for the Subhan Care Hospital Management System.

	
