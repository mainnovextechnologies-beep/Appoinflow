import mongoose from 'mongoose'

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true, maxlength: 100 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true, index: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: ['customer', 'professional'], required: true, default: 'customer' },
  emailVerified: { type: Boolean, default: false },
  emailVerificationTokenHash: String,
  emailVerificationExpiresAt: Date,
  resetTokenHash: String,
  resetTokenExpiresAt: Date,
}, { timestamps: true })

const professionalSchema = new mongoose.Schema({
  user: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  name: { type: String, required: true, trim: true },
  slug: { type: String, required: true, unique: true, lowercase: true, index: true },
  category: { type: String, default: 'Professional services' },
  description: { type: String, default: '' },
  phone: { type: String, default: '' },
  fee: { type: Number, required: true, min: 1, max: 1000000, default: 799 },
  mode: { type: String, enum: ['online', 'offline', 'both'], default: 'both' },
  slotDurationMinutes: { type: Number, enum: [15, 30, 45, 60, 90, 120], default: 30 },
  meetLink: { type: String, default: '' },
  officeAddress: { type: String, default: '' },
  timezone: { type: String, default: 'Asia/Kolkata' },
  published: { type: Boolean, default: true },
}, { timestamps: true })

const slotSchema = new mongoose.Schema({
  professional: { type: mongoose.Schema.Types.ObjectId, ref: 'Professional', required: true, index: true },
  date: { type: String, required: true },
  time: { type: String, required: true },
  active: { type: Boolean, default: true },
}, { timestamps: true })
slotSchema.index({ professional: 1, date: 1, time: 1 }, { unique: true })

const appointmentSchema = new mongoose.Schema({
  customer: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  professional: { type: mongoose.Schema.Types.ObjectId, ref: 'Professional', required: true, index: true },
  slot: { type: mongoose.Schema.Types.ObjectId, ref: 'Slot', default: null },
  customerName: { type: String, required: true },
  customerEmail: { type: String, required: true },
  customerPhone: { type: String, required: true },
  reason: { type: String, required: true },
  description: { type: String, default: '' },
  mode: { type: String, enum: ['online', 'offline'], required: true },
  requestedDate: { type: String, required: true },
  requestedTime: { type: String, required: true },
  finalDate: { type: String, default: '' },
  finalTime: { type: String, default: '' },
  meetingLink: { type: String, default: '' },
  officeAddress: { type: String, default: '' },
  fee: { type: Number, required: true },
  status: { type: String, enum: ['pending_payment', 'pending_scheduling', 'confirmed', 'completed', 'cancelled', 'payment_failed'], default: 'pending_payment', index: true },
  paymentStatus: { type: String, enum: ['pending', 'paid', 'failed', 'refunded'], default: 'pending' },
  razorpayOrderId: String,
  razorpayPaymentId: String,
  reminderSentAt: Date,
  cancellationReason: String,
}, { timestamps: true })

export const User = mongoose.model('User', userSchema)
export const Professional = mongoose.model('Professional', professionalSchema)
export const Slot = mongoose.model('Slot', slotSchema)
export const Appointment = mongoose.model('Appointment', appointmentSchema)
