import { mkdir, writeFile } from 'node:fs/promises';
import { createEmploymentLetterPdf } from '../functions/lib/hr-employment-letter-pdf.js';

// Synthetic data only: this sample must never be sent to a real employee.
const letter = {
  LetterId: 'EMP-SAMPLE-DO-NOT-SEND', EmployeeName: 'Alexandra Chiamaka Example', RecipientEmail: 'employee@example.org',
  EmployerName: 'Example Integrated Services Limited', BranchName: 'North Branch', BranchId: 'north',
  IssuerName: 'Jordan Example', IssuerTitle: 'Human Resources Manager',
  Terms: { LetterDate: '2026-11-10', StartDate: '2026-12-01', Position: 'Operations and Service Delivery Officer', Department: 'Operations',
    EmploymentType: 'Permanent', WorkLocation: 'North Branch offices', ReportingTo: 'Operations Manager',
    Probation: 'Three months. A written performance review will be conducted before confirmation.',
    WorkingHours: 'Monday to Friday, 8:00 am to 4:00 pm, with the agreed lunch break.',
    Benefits: 'The benefits separately agreed in the organisation staff handbook apply to this appointment.',
    NoticePeriod: 'One month in writing, subject to the agreed employment terms.',
    Terms: 'This is a synthetic demonstration document, not a real employment offer. The actual employer must enter its agreed terms before issuing an employment letter.\nPlease keep employee and customer information confidential and follow the organisation policies provided at induction.',
    AcceptanceDeadline: '2026-11-24' },
  Salary: { Currency: 'NGN', PayFrequency: 'Monthly', Earnings: [{ Name: 'Basic salary', Amount: 150000 }, { Name: 'Housing allowance', Amount: 50000 }, { Name: 'Transport allowance', Amount: 25000 }],
    Deductions: [{ Name: 'Agreed staff association contribution', Amount: 1000 }], GrossPay: 225000 }
};
await mkdir('output/pdf', { recursive: true });
await writeFile('output/pdf/employment-letter-sample.pdf', await createEmploymentLetterPdf({
  SchoolName: letter.EmployerName, SchoolAddress: '12 Example Street, North Branch, Abuja', SchoolPhone: '+234 000 000 0000', SchoolEmail: 'hr@example.org'
}, letter));
console.log('output/pdf/employment-letter-sample.pdf');
